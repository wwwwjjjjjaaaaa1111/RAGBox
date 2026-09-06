"""封装知识库 Chroma 向量库读写操作。"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from langchain_core.documents import Document
from langchain_chroma import Chroma

from app.config import settings
from app.knowledge_base.embedding_model import create_embedding_model

if TYPE_CHECKING:
    from app.chat.schemas import ModelConfigOverride


class KnowledgeVectorStore:
    """负责知识库文件分块向量的删除和批量写入。"""

    def __init__(
        self,
        embedding: object | None = None,
        model_override: "ModelConfigOverride | None" = None,
    ) -> None:
        """初始化知识库入库流程使用的 Chroma collection。

        embedding 为 None 时按 覆盖 > .env 顺序创建嵌入客户端。
        """

        Path(settings.chroma_persist_directory).mkdir(parents=True, exist_ok=True)
        self._store = Chroma(
            collection_name=settings.chroma_collection_name,
            embedding_function=embedding or create_embedding_model(model_override),
            persist_directory=settings.chroma_persist_directory,
        )
        self._embedding_batch_size = settings.embedding_batch_size

    def delete_file_chunks(self, file_id: str) -> None:
        """在重新索引前，先清理该知识库文件已有的所有向量。"""

        self._store.delete(where={"file_id": file_id})

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
        """

        if file_ids:
            where: dict = {"$and": [{"user_id": user_id}, {"file_id": {"$in": file_ids}}]}
        else:
            where = {"user_id": user_id}

        return self._store.similarity_search_with_relevance_scores(
            query=query,
            k=top_k,
            filter=where,
            score_threshold=score_threshold,
        )
