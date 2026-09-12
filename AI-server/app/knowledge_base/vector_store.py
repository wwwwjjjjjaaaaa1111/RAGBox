"""封装知识库向量库（Qdrant）读写操作。

替换自 ChromaDB：LangChain 的 Qdrant 封装没有 Chroma 那样的分数归一化与
score_threshold 预过滤，因此「0–1 相关度 + 阈值过滤」的契约改由本类自管，
调用方（retriever / main）与前端 0–1 滑杆无需任何改动。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from langchain_core.documents import Document
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client import models

from app.config import settings
from app.knowledge_base.embedding_model import create_embedding_model

if TYPE_CHECKING:
    from app.chat.schemas import ModelConfigOverride

# 高频过滤字段：每次检索与删除都会用到，为其建 payload 索引。
# langchain-qdrant 将 Document.metadata 嵌套存放在 payload["metadata"] 下，
# 因此过滤与索引都要用点路径；所有过滤统一引用这里的常量，避免路径漂移。
FIELD_USER = "metadata.user_id"
FIELD_FILE = "metadata.file_id"
FILTER_FIELDS = (FIELD_USER, FIELD_FILE)


class KnowledgeVectorStore:
    """负责知识库文件分块向量的删除和批量写入（Qdrant 实现）。"""

    def __init__(
        self,
        embedding: object | None = None,
        model_override: "ModelConfigOverride | None" = None,
    ) -> None:
        """初始化 Qdrant 客户端与 LangChain 适配层。

        集合在首次写入时由 LangChain 自动创建（Distance.COSINE）；
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
            embedding=self._embedding,
            client=self._client,
        )
        self._embedding_batch_size = settings.embedding_batch_size

    def _ensure_collection(self) -> None:
        """确保集合存在（LangChain 封装在构造时会校验集合，不存在则 404）。

        维度需与当前嵌入模型一致：用一次探测嵌入获得，仅在集合缺失时发生；
        集合创建后本方法不再产生任何嵌入调用。 Distance.COSINE 与
        similarity_search_with_score 的「越高越好」语义配套。
        """

        if self._client.collection_exists(self._collection):
            return

        dimension = len(self._embedding.embed_query("dimension probe"))
        try:
            self._client.create_collection(
                collection_name=self._collection,
                vectors_config=models.VectorParams(
                    size=dimension,
                    distance=models.Distance.COSINE,
                ),
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
        """将知识库文本分块及其元数据批量写入向量库。

        on_batch_done(已完成批数, 总批数) 在每批写完后回调（可为 None）。
        """

        if not documents:
            return

        total_batches = (len(documents) + self._embedding_batch_size - 1) // self._embedding_batch_size
        done_batches = 0

        # 嵌入请求按批次提交，避免单次写入过大导致超时或内存抖动。
        for start in range(0, len(documents), self._embedding_batch_size):
            end = start + self._embedding_batch_size
            self._store.add_documents(
                documents=documents[start:end],
                ids=ids[start:end],
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
        """按用户维度检索最相关的知识库分块，并过滤低相关结果。

        file_ids 非空时仅在这些文件范围内检索。
        相关度契约与 Chroma 时期一致：0–1、越高越好，低于阈值的不返回。
        """

        must: list[models.FieldCondition] = [
            models.FieldCondition(key=FIELD_USER, match=models.MatchValue(value=user_id))
        ]
        if file_ids:
            must.append(
                models.FieldCondition(key=FIELD_FILE, match=models.MatchAny(any=file_ids))
            )

        self._ensure_payload_indexes()
        pairs = self._store.similarity_search_with_score(
            query=query,
            k=top_k,
            filter=models.Filter(must=must),
        )

        results: list[tuple[Document, float]] = []
        for document, score in pairs:
            # 余弦相似度理论上在 [-1, 1]，实际嵌入结果集中在 0–1；clamp 保证契约。
            relevance = max(0.0, min(1.0, float(score)))
            if relevance < score_threshold:
                continue
            results.append((document, relevance))

        return results
