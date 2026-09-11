"""封装聊天业务中的知识库检索与来源整理。"""

from __future__ import annotations

from app.chat.schemas import ChatRequest, ChatSource, SearchMatch, SearchRequest, SearchResponse
from app.config import settings
from app.knowledge_base.embedding_model import resolve_embedding_model_name
from app.knowledge_base.vector_store import KnowledgeVectorStore

# 来源原文片段的最大长度；检索时实时截断，新回答即时生效。
SNIPPET_MAX_LENGTH = 600

# 独立检索接口（供 MCP 等外部客户端）单条命中的默认长度上限。
# 比 SNIPPET_MAX_LENGTH 更长：外部客户端需要较完整的上下文，而非仅够引用展示。
SEARCH_MAX_CHARS = 2000


def build_chat_sources(payload: ChatRequest, search_query: str | None = None) -> list[ChatSource]:
    """根据检索词从知识库检索来源，并进行去重整理。

    search_query 为多轮对话改写后的查询；不传时回退用户原始输入。
    """

    store = KnowledgeVectorStore(model_override=payload.modelConfig)
    override = payload.modelConfig
    top_k = override.retrievalTopK if override and override.retrievalTopK else settings.chat_retrieval_top_k
    score_threshold = (
        override.retrievalScoreThreshold
        if override and override.retrievalScoreThreshold is not None
        else settings.chat_retrieval_score_threshold
    )
    matches = store.retrieve_chunks(
        search_query or payload.query,
        payload.userId,
        top_k,
        score_threshold,
        file_ids=payload.fileIds or None,
    )
    sources: list[ChatSource] = []

    for document, _score in matches:
        metadata = document.metadata or {}
        raw_page_number = metadata.get("page_number")
        raw_chunk_index = metadata.get("chunk_index")
        snippet = document.page_content.strip().replace("\n", " ")
        sources.append(
            ChatSource(
                fileId=str(metadata.get("file_id") or "") or None,
                fileName=str(metadata.get("file_name") or "") or None,
                pageNumber=raw_page_number if isinstance(raw_page_number, int) else None,
                chunkIndex=raw_chunk_index if isinstance(raw_chunk_index, int) else None,
                snippet=snippet[:SNIPPET_MAX_LENGTH] if snippet else "(empty chunk)",
            )
        )

    deduped: list[ChatSource] = []
    seen: set[tuple[str | None, int | None, int | None, str]] = set()

    for source in sources:
        key = (source.fileId, source.pageNumber, source.chunkIndex, source.snippet)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(source)

    return deduped


def search_knowledge_base(payload: SearchRequest, user_id: str) -> SearchResponse:
    """执行一次只读向量检索（不调用对话模型），返回带分数的命中列表。

    供 MCP 等外部客户端使用：让宿主模型的上下文里带上真实文档片段，
    由宿主模型自己作答，而不是在这里再调一次对话模型。
    """

    store = KnowledgeVectorStore(model_override=payload.modelConfig)
    override = payload.modelConfig
    top_k = (
        payload.topK
        or (override.retrievalTopK if override and override.retrievalTopK else None)
        or settings.chat_retrieval_top_k
    )
    score_threshold = (
        override.retrievalScoreThreshold
        if override and override.retrievalScoreThreshold is not None
        else settings.chat_retrieval_score_threshold
    )
    max_chars = payload.maxChars or SEARCH_MAX_CHARS

    matches = store.retrieve_chunks(
        payload.query,
        user_id,
        top_k,
        score_threshold,
        file_ids=payload.fileIds or None,
    )

    results: list[SearchMatch] = []
    for document, score in matches:
        metadata = document.metadata or {}
        raw_page_number = metadata.get("page_number")
        raw_chunk_index = metadata.get("chunk_index")
        content = document.page_content.strip()

        results.append(
            SearchMatch(
                fileId=str(metadata.get("file_id") or "") or None,
                fileName=str(metadata.get("file_name") or "") or None,
                pageNumber=raw_page_number if isinstance(raw_page_number, int) else None,
                chunkIndex=raw_chunk_index if isinstance(raw_chunk_index, int) else None,
                score=float(score),
                content=content[:max_chars] if content else "(empty chunk)",
            )
        )

    return SearchResponse(
        query=payload.query,
        embeddingModel=resolve_embedding_model_name(payload.modelConfig),
        matchCount=len(results),
        matches=results,
    )