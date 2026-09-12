"""封装知识库向量库（Qdrant）读写操作。

替换自 ChromaDB：LangChain 的 Qdrant 封装没有 Chroma 那样的分数归一化与
score_threshold 预过滤，因此「0–1 相关度 + 阈值过滤」的契约改由本类自管，
调用方（retriever / main）与前端 0–1 滑杆无需任何改动。

检索为混合两段式：RRF 融合稠密（语义）与稀疏（中文 BM25 风格词面匹配，
见 sparse_embedding.py）两路召回形成候选集，再按稠密余弦重排取 top_k。
稀疏负责修复精确术语的漏召回，稠密保持排序质量；返回分数仍为 0–1
余弦相似度，阈值语义不变。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from langchain_core.documents import Document
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client import models

from app.config import settings
from app.knowledge_base.embedding_model import create_embedding_model
from app.knowledge_base.sparse_embedding import encode_sparse

if TYPE_CHECKING:
    from app.chat.schemas import ModelConfigOverride

# 高频过滤字段：每次检索与删除都会用到，为其建 payload 索引。
# langchain-qdrant 将 Document.metadata 嵌套存放在 payload["metadata"] 下，
# 因此过滤与索引都要用点路径；所有过滤统一引用这里的常量，避免路径漂移。
FIELD_USER = "metadata.user_id"
FIELD_FILE = "metadata.file_id"
FILTER_FIELDS = (FIELD_USER, FIELD_FILE)

# 命名向量：稠密走 LangChain（embedding），稀疏走原生 client（IDF 加权）。
DENSE_VECTOR = "dense"
SPARSE_VECTOR = "sparse"

# RRF 融合常数：与业界惯例一致（Cormack et al. 的 60）。
RRF_K = 60

# 召回扩量：两路各召回 k*RECALL_MULTIPLIER 个，融合后截回 top_k。
RECALL_MULTIPLIER = 3


def _rrf_fuse(dense_ids: list[str], sparse_ids: list[str]) -> list[str]:
    """倒数排名融合：每个候选的得分为 Σ 1/(RRF_K + rank)，按此排序。"""

    scores: dict[str, float] = {}
    for ranked in (dense_ids, sparse_ids):
        for position, point_id in enumerate(ranked):
            scores[point_id] = scores.get(point_id, 0.0) + 1.0 / (RRF_K + position + 1)
    return sorted(scores, key=scores.get, reverse=True)  # type: ignore[arg-type,return-value]


class KnowledgeVectorStore:
    """负责知识库文件分块向量的删除和批量写入（Qdrant 混合检索实现）。"""

    def __init__(
        self,
        embedding: object | None = None,
        model_override: "ModelConfigOverride | None" = None,
    ) -> None:
        """初始化 Qdrant 客户端与 LangChain 适配层。

        集合若缺失则按「命名稠密向量 + IDF 加权稀疏向量」创建；
        embedding 为 None 时按 覆盖 > .env 顺序创建嵌入客户端。
        """

        self._collection = settings.vector_collection_name
        # trust_env=False：本地向量库不走任何系统/环境代理，避免外部代理软件
        # 的环境变量（如 ALL_PROXY）把本机流量也劫持走。
        self._client = QdrantClient(url=settings.qdrant_url, timeout=30, trust_env=False)
        self._embedding = embedding or create_embedding_model(model_override)
        self._ensure_collection()
        self._store = QdrantVectorStore(
            collection_name=self._collection,
            vector_name=DENSE_VECTOR,
            embedding=self._embedding,
            client=self._client,
        )
        self._embedding_batch_size = settings.embedding_batch_size

    def _ensure_collection(self) -> None:
        """确保集合存在且结构正确（LangChain 封装构造时校验集合，缺失即 404）。

        结构为命名双向量：dense（COSINE，维度随嵌入模型探测）+ sparse
        （Modifier.IDF 让 Qdrant 在查询时按全库文档频率加权，等价 BM25 权重项）。
        集合缺失、缺少稀疏向量、或稠密维度与当前嵌入模型不一致（用户更换
        嵌入模型或调整输出维度）时，删除重建——旧向量在新向量空间中无意义，
        需要重新入库。
        """

        probe_dimension: int | None = None

        if self._client.collection_exists(self._collection):
            info = self._client.get_collection(self._collection)
            sparse = info.config.params.sparse_vectors or {}
            vectors = info.config.params.vectors or {}
            dense_params = vectors.get(DENSE_VECTOR) if isinstance(vectors, dict) else None

            if dense_params is None or SPARSE_VECTOR not in sparse:
                # 旧结构：无法原位升级，删除后按新结构重建。
                self._client.delete_collection(self._collection)
            else:
                probe_dimension = len(self._embedding.embed_query("dimension probe"))
                if dense_params.size == probe_dimension:
                    return
                # 维度漂移（换嵌入模型/改输出维度）：旧向量全部作废，重建。
                self._client.delete_collection(self._collection)

        if probe_dimension is None:
            probe_dimension = len(self._embedding.embed_query("dimension probe"))
        try:
            self._client.create_collection(
                collection_name=self._collection,
                vectors_config={DENSE_VECTOR: models.VectorParams(size=probe_dimension, distance=models.Distance.COSINE)},
                sparse_vectors_config={
                    SPARSE_VECTOR: models.SparseVectorParams(modifier=models.Modifier.IDF)
                },
            )
        except Exception:
            # 并发场景下另一请求可能已创建（409），集合存在即达目的。
            if not self._client.collection_exists(self._collection):
                raise

    def _ensure_payload_indexes(self) -> None:
        """为高频过滤字段创建 payload 索引（幂等，集合不存在时跳过）。"""

        try:
            if not self._client.collection_exists(self._collection):
                return

            existing = {
                field.field_name
                for field in self._client.get_collection(self._collection).payload_schema or {}
            }
            for field in FILTER_FIELDS:
                if field not in existing:
                    self._client.create_payload_index(
                        collection_name=self._collection,
                        field_name=field,
                        field_schema=models.PayloadSchemaType.KEYWORD,
                    )
        except Exception:  # noqa: BLE001 索引仅影响性能，不阻塞主链路
            pass

    def delete_file_chunks(self, file_id: str) -> None:
        """在重新索引前，先清理该知识库文件已有的所有向量。

        调用方（删除/重入库流程）已在上游完成属主校验，这里按 file_id 精确清理。
        """

        self._ensure_payload_indexes()
        self._client.delete(
            collection_name=self._collection,
            points_selector=models.Filter(
                must=[
                    models.FieldCondition(
                        key=FIELD_FILE,
                        match=models.MatchValue(value=file_id),
                    )
                ]
            ),
        )

    def add_chunks(
        self,
        documents: list[Document],
        ids: list[str],
        on_batch_done: "callable | None" = None,
    ) -> None:
        """将知识库文本分块及其元数据批量写入向量库（稠密 + 稀疏双向量）。

        稠密由 LangChain 按批写入（嵌入请求分批提交，避免超时与内存抖动）；
        随后用 update_vectors 为同一批 point 补写稀疏向量——update 只更新
        指定命名向量，不会覆盖已写入的稠密向量和 payload。
        on_batch_done(已完成批数, 总批数) 在每批写完后回调（可为 None）。
        """

        if not documents:
            return

        total_batches = (len(documents) + self._embedding_batch_size - 1) // self._embedding_batch_size
        done_batches = 0

        for start in range(0, len(documents), self._embedding_batch_size):
            end = start + self._embedding_batch_size
            batch_docs = documents[start:end]
            batch_ids = ids[start:end]

            self._store.add_documents(documents=batch_docs, ids=batch_ids)
            self._client.update_vectors(
                collection_name=self._collection,
                points=[
                    models.PointVectors(
                        id=point_id,
                        vector={SPARSE_VECTOR: encode_sparse(doc.page_content)},
                    )
                    for point_id, doc in zip(batch_ids, batch_docs)
                ],
            )

            done_batches += 1
            if on_batch_done is not None:
                on_batch_done(done_batches, total_batches)

        # 首次写入后集合才存在，此时补建过滤索引。
        self._ensure_payload_indexes()

    def retrieve_chunks(
        self,
        query: str,
        user_id: str,
        top_k: int = 5,
        score_threshold: float = 0.35,
        file_ids: list[str] | None = None,
    ) -> list[tuple[Document, float]]:
        """混合检索：稠密（语义）+ 稀疏（词面）双路召回，RRF 融合排序。

        file_ids 非空时仅在这些文件范围内检索。
        返回分数为 0–1 余弦相似度（阈值语义与单路时期一致）；稀疏独有命中
        （稠密没排进召回的词面强相关块）会补算余弦后参与同一阈值过滤。
        """

        must: list[models.FieldCondition] = [
            models.FieldCondition(key=FIELD_USER, match=models.MatchValue(value=user_id))
        ]
        if file_ids:
            must.append(
                models.FieldCondition(key=FIELD_FILE, match=models.MatchAny(any=file_ids))
            )
        qfilter = models.Filter(must=must)

        self._ensure_payload_indexes()

        recall_k = max(top_k * RECALL_MULTIPLIER, top_k)
        query_vector = self._embedding.embed_query(query)
        sparse_query = encode_sparse(query)

        # 双路召回（带 payload 与分数）。
        dense_hits = self._client.query_points(
            collection_name=self._collection,
            using=DENSE_VECTOR,
            query=query_vector,
            query_filter=qfilter,
            limit=recall_k,
            with_payload=True,
        ).points
        sparse_hits = self._client.query_points(
            collection_name=self._collection,
            using=SPARSE_VECTOR,
            query=sparse_query,
            query_filter=qfilter,
            limit=recall_k,
            with_payload=True,
        ).points

        # RRF 融合：两路排名合并出候选集；再按稠密余弦重排取 top_k。
        # 两段式的分工：稀疏把词面强相关的长尾候选捞进集合（修复纯稠密的
        # 精确术语漏召回），稠密决定最终排序（避免稀疏噪声挤掉语义强命中）。
        dense_ids = [p.id for p in dense_hits]
        sparse_ids = [p.id for p in sparse_hits]
        fused_ids = _rrf_fuse(dense_ids, sparse_ids)

        # 稀疏独有命中不在稠密结果里，需要补算余弦分数才能参与重排与阈值过滤。
        dense_set = set(dense_ids)
        sparse_only_ids = [pid for pid in fused_ids if pid not in dense_set]
        dense_scores = {p.id: float(p.score) for p in dense_hits}
        if sparse_only_ids:
            retrieved = self._client.retrieve(
                collection_name=self._collection,
                ids=sparse_only_ids,
                with_vectors=[DENSE_VECTOR],
            )
            for point in retrieved:
                vector = (point.vector or {}).get(DENSE_VECTOR) or []
                numerator = sum(a * b for a, b in zip(query_vector, vector))
                norm_q = sum(a * a for a in query_vector) ** 0.5
                norm_d = sum(b * b for b in vector) ** 0.5
                dense_scores[point.id] = (
                    numerator / (norm_q * norm_d) if norm_q > 0 and norm_d > 0 else 0.0
                )

        candidates = [pid for pid in fused_ids if dense_scores.get(pid, 0.0) >= score_threshold]
        candidates.sort(key=lambda pid: dense_scores.get(pid, 0.0), reverse=True)
        fused_ids = candidates[:top_k]

        results: list[tuple[Document, float]] = []
        for point_id in fused_ids:
            hit = next((p for p in dense_hits + sparse_hits if p.id == point_id), None)
            if hit is None:
                continue
            payload = hit.payload or {}
            document = Document(
                page_content=str(payload.get("page_content", "")),
                metadata=dict(payload.get("metadata") or {}),
            )
            results.append((document, dense_scores.get(point_id, 0.0)))

        return results
