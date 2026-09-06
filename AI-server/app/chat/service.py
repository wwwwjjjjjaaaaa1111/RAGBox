"""封装聊天业务中的 RAG 检索、Prompt 组装与流式输出。"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Iterable

from app.chat.llm import create_chat_llm
from app.chat.prompts import build_llm_messages, build_rewrite_messages, build_title_messages
from app.chat.retriever import build_chat_sources
from app.chat.schemas import ChatRequest, ChatStreamEvent, TitleRequest
from app.config import settings

logger = logging.getLogger(__name__)

# 改写结果的长度上限，防止模型输出整段回答污染检索词。
REWRITE_MAX_LENGTH = 200


def _rewrite_search_query(payload: ChatRequest) -> str:
    """把多轮对话中的最新问题改写成独立检索词；失败时回退原始 query。"""

    try:
        client = create_chat_llm(payload.modelConfig).bind(temperature=0)
        response = client.invoke(build_rewrite_messages(payload.recentMessages, payload.query))
        content = response.content

        # content 可能为字符串或分段列表，统一拍平成文本。
        if isinstance(content, list):
            content = "".join(
                part if isinstance(part, str) else str(part.get("text") or "")
                for part in content
            )
        if not isinstance(content, str):
            return payload.query

        rewritten = content.strip().splitlines()[0].strip()[:REWRITE_MAX_LENGTH] if content.strip() else ""
        return rewritten or payload.query
    except Exception:  # noqa: BLE001
        # 改写是增强步骤，任何失败都不应影响聊天主链路。
        logger.warning("检索改写失败，回退原始 query", exc_info=True)
        return payload.query


def generate_title(payload: TitleRequest) -> str:
    """为首次对话生成简短会话标题；失败时抛错由调用方降级。"""

    client = create_chat_llm(payload.modelConfig).bind(temperature=0.3)
    response = client.invoke(build_title_messages(payload.query, payload.answer))
    content = response.content

    if isinstance(content, list):
        content = "".join(
            part if isinstance(part, str) else str(part.get("text") or "")
            for part in content
        )

    title = content.strip().splitlines()[0].strip().strip("\"'“”‘’。.") if isinstance(content, str) else ""
    return title[:60]


def _sse(event: str, payload: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _coerce_chunk_text(content: object) -> str:
    """将 LangChain/OpenAI 返回的 chunk 内容统一转成可流式输出的纯文本。"""

    if content is None:
        return ""

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue

            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
                    continue

                nested_text = item.get("content")
                if isinstance(nested_text, str):
                    parts.append(nested_text)

        return "".join(parts)

    return str(content)


async def stream_chat_events(payload: ChatRequest) -> Iterable[str]:
    """将检索增强聊天响应格式化为 SSE 事件流（异步生成器）。"""

    yield _sse("message.started", ChatStreamEvent(type="message.started").model_dump())

    try:
        # 多轮对话时先改写检索词；单轮或开关关闭时直接用原始 query。
        search_query = payload.query
        if settings.query_rewrite_enabled and payload.recentMessages:
            search_query = await asyncio.to_thread(_rewrite_search_query, payload)

        sources = await asyncio.to_thread(build_chat_sources, payload, search_query)
        client = create_chat_llm(payload.modelConfig)

        # astream 为原生异步迭代，避免逐块输出阻塞事件循环。
        async for chunk in client.astream(build_llm_messages(payload, sources)):
            content = _coerce_chunk_text(chunk.content)
            if not content:
                continue

            yield _sse(
                "message.delta",
                ChatStreamEvent(type="message.delta", delta=content).model_dump(exclude_none=True),
            )

        yield _sse(
            "message.sources",
            ChatStreamEvent(type="message.sources", sources=sources).model_dump(exclude_none=True),
        )
        yield _sse(
            "message.completed",
            ChatStreamEvent(type="message.completed").model_dump(exclude_none=True),
        )
    except Exception as error:  # noqa: BLE001
        yield _sse(
            "message.failed",
            ChatStreamEvent(
                type="message.failed",
                code="AI_CHAT_FAILED",
                message=str(error),
            ).model_dump(exclude_none=True),
        )