"""封装聊天业务中的 prompt 与消息组装。"""

from __future__ import annotations

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from app.chat.schemas import ChatHistoryMessage, ChatRequest, ChatSource
from app.config import settings


def build_system_prompt(sources: list[ChatSource]) -> str:
    """将检索结果格式化为系统提示词。"""

    context_lines = []
    for index, source in enumerate(sources, start=1):
        label = source.fileName or source.fileId or f"source-{index}"
        page_label = f" page {source.pageNumber}" if source.pageNumber is not None else ""
        context_lines.append(f"[{index}] {label}{page_label}: {source.snippet}")

    context_block = "\n".join(context_lines) if context_lines else "No relevant knowledge base passages were retrieved."

    return (
        "You are the chat assistant for a private knowledge base. "
        "Answer using the provided knowledge base context when possible. "
        "If the context is empty or insufficient, say that the knowledge base does not contain enough information. "
        "Do not invent file names or claims. Keep answers concise but useful.\n\n"
        f"Knowledge Base Context:\n{context_block}"
    )


def build_llm_messages(payload: ChatRequest, sources: list[ChatSource]) -> list[BaseMessage]:
    """将会话上下文和检索结果转换为 LangChain 消息列表。"""

    messages: list[BaseMessage] = [SystemMessage(content=build_system_prompt(sources))]

    for message in payload.recentMessages[-settings.chat_context_message_limit:]:
        if message.role == "assistant":
            messages.append(AIMessage(content=message.content))
            continue

        messages.append(HumanMessage(content=message.content))

    if not payload.recentMessages or payload.recentMessages[-1].content != payload.query:
        messages.append(HumanMessage(content=payload.query))

    return messages


# 查询改写最多参考的历史消息条数（与 CHAT_CONTEXT_MESSAGE_LIMIT 语义无关）。
REWRITE_HISTORY_MESSAGE_LIMIT = 6

_REWRITE_SYSTEM_PROMPT = (
    "你是一个检索查询改写器。你的任务是把对话中的最新问题改写成一条适合在向量知识库中检索的独立查询。\n"
    "规则：\n"
    "1. 结合对话历史消解代词和指代（如“它”“上面那个”“第二种方案”），补全省略的主语和背景；\n"
    "2. 改写结果必须是一个独立的搜索查询，不要包含“用户”“上文”等对话字眼；\n"
    "3. 只输出改写后的查询本身，一行以内，不要解释，不要回答问题；\n"
    "4. 如果最新问题本身已经完整自包含，原样输出它；\n"
    "5. 保留问题中的专有名词、文件名和关键术语。"
)


def build_rewrite_messages(
    recent_messages: list[ChatHistoryMessage],
    query: str,
) -> list[BaseMessage]:
    """构造检索查询改写的消息列表（最近几轮历史 + 最新问题）。"""

    messages: list[BaseMessage] = [SystemMessage(content=_REWRITE_SYSTEM_PROMPT)]

    for message in recent_messages[-REWRITE_HISTORY_MESSAGE_LIMIT:]:
        if message.role == "assistant":
            messages.append(AIMessage(content=message.content))
        else:
            messages.append(HumanMessage(content=message.content))

    messages.append(
        HumanMessage(content=f"请改写这条用于检索的问题：\n{query}")
    )
    return messages


_TITLE_SYSTEM_PROMPT = (
    "你是一个会话标题生成器。根据一段问答内容，为该次对话生成一个简短的中文标题。\n"
    "规则：\n"
    "1. 不超过 12 个字，不加引号、句号或感叹号；\n"
    "2. 概括问题的主题，而不是复述内容；\n"
    "3. 只输出标题本身，不要解释。"
)


def build_title_messages(query: str, answer: str) -> list[BaseMessage]:
    """构造会话标题生成的消息列表（问题 + 回答摘要）。"""

    return [
        SystemMessage(content=_TITLE_SYSTEM_PROMPT),
        HumanMessage(content=f"用户问题：{query}\n\n回答摘要：{answer[:500]}"),
    ]