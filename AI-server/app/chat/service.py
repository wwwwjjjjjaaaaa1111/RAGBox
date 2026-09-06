"""封装聊天业务中的 RAG 检索、Prompt 组装与流式输出。"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Iterable

from langchain_core.messages import AIMessage, ToolMessage

from app.charts.service import execute_chart_tool
from app.chat.llm import create_chat_llm
from app.chat.prompts import build_llm_messages, build_rewrite_messages, build_title_messages
from app.chat.retriever import build_chat_sources
from app.chat.schemas import ChatRequest, ChatStreamEvent, TitleRequest
from app.config import settings

logger = logging.getLogger(__name__)

# 改写结果的长度上限，防止模型输出整段回答污染检索词。
REWRITE_MAX_LENGTH = 200

# 工具调用最多执行的轮数（1 次工具执行 + 1 次最终回答）。
MAX_TOOL_ROUNDS = 2

# generate_chart 工具的 OpenAI function calling schema。
CHART_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "generate_chart",
        "description": (
            "根据对话或检索到的文档内容中的数值数据，生成折线图或柱状图，"
            "并提供可下载的 PDF 文件。当用户要求画图、绘制图表、可视化数据时调用。"
            "参数中的数值必须来自对话或文档，不要编造数据；没有可绘制的数值数据时不要调用本工具。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "图表标题，不超过 120 字"},
                "chart_type": {"type": "string", "enum": ["line", "bar"], "description": "line=折线图，bar=柱状图"},
                "x_labels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "X 轴标签列表（如时间、类别），最多 200 个",
                },
                "series": {
                    "type": "array",
                    "maxItems": 8,
                    "description": "数据系列列表，每个系列的 values 个数必须与 x_labels 一致",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": "系列名称"},
                            "values": {"type": "array", "items": {"type": "number"}, "description": "与 x_labels 等长的数值数组"},
                        },
                        "required": ["name", "values"],
                    },
                },
                "source_note": {"type": "string", "description": "数据来源说明（可选，如文件名）"},
            },
            "required": ["title", "chart_type", "x_labels", "series"],
        },
    },
}


def _looks_like_tools_unsupported(error: Exception) -> bool:
    """判断上游错误是否由模型/服务商不支持 tools 参数导致。"""

    text = str(error).lower()
    keywords = ("tool", "function", "tools")
    status_hints = ("400", "422", "bad request", "invalid")
    return any(k in text for k in keywords) and any(s in text for s in status_hints)


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


async def _stream_llm_with_tools(
    client,
    messages: list,
    tools_enabled: bool,
):
    """流式调用一次 LLM，逐段 yield ("delta", 文本片段)；结束时 yield ("done", (工具调用列表, 是否 tools 降级))。

    工具调用参数按 tool_call_chunks 的 index 累积拼接。
    """

    bound = client.bind_tools([CHART_TOOL_SCHEMA]) if tools_enabled else client
    calls_by_index: dict[int, dict] = {}

    try:
        async for chunk in bound.astream(messages):
            content = _coerce_chunk_text(chunk.content)
            if content:
                yield "delta", content

            for tc in getattr(chunk, "tool_call_chunks", None) or []:
                index = tc.get("index") if isinstance(tc, dict) else tc.index
                entry = calls_by_index.setdefault(index, {"name": "", "args": "", "id": ""})
                name = tc.get("name") if isinstance(tc, dict) else tc.name
                args = tc.get("args") if isinstance(tc, dict) else tc.args
                call_id = tc.get("id") if isinstance(tc, dict) else tc.id
                if name:
                    entry["name"] = name
                if call_id:
                    entry["id"] = call_id
                if args:
                    entry["args"] += args
    except Exception as error:  # noqa: BLE001
        if tools_enabled and _looks_like_tools_unsupported(error):
            logger.warning("上游模型不支持 tools 参数，本次回答降级为无工具模式", exc_info=True)
            yield "done", ([], True)
            return
        raise

    yield "done", ([entry for entry in calls_by_index.values() if entry["name"]], False)


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

        messages = list(build_llm_messages(payload, sources))
        tools_enabled = settings.chat_tools_enabled

        # 工具循环：模型发起 tool_call → 执行 → 把结果回填给模型生成最终回答。
        for _round in range(MAX_TOOL_ROUNDS):
            round_text = ""
            tool_calls: list[dict] = []
            async for kind, part in _stream_llm_with_tools(client, messages, tools_enabled):
                if kind == "delta":
                    round_text += part
                    yield _sse(
                        "message.delta",
                        ChatStreamEvent(type="message.delta", delta=part).model_dump(exclude_none=True),
                    )
                else:
                    tool_calls, degraded = part

            if degraded:
                tools_enabled = False
                continue

            if not tool_calls:
                break

            # 工具调用轮的文本通常是过渡语，仅累计不覆盖。
            messages.append(AIMessage(
                content=round_text,
                tool_calls=[
                    {"name": tc["name"], "args": json.loads(tc["args"] or "{}"), "id": tc["id"] or tc["name"]}
                    for tc in tool_calls
                ],
            ))

            for tc in tool_calls:
                try:
                    parsed_args = json.loads(tc["args"] or "{}")
                except json.JSONDecodeError:
                    parsed_args = {}

                result = await asyncio.to_thread(execute_chart_tool, parsed_args, payload.userId)
                if result.get("ok"):
                    yield _sse("chart.generated", {
                        "chartId": result["chartId"],
                        "title": result["title"],
                        "chartType": result["chartType"],
                    })

                messages.append(ToolMessage(
                    content=json.dumps(result, ensure_ascii=False),
                    tool_call_id=tc["id"] or tc["name"],
                ))

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