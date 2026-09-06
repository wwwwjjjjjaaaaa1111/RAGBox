"""封装聊天业务中的 LLM 客户端创建逻辑。"""

from __future__ import annotations

from typing import TYPE_CHECKING

from langchain_openai import ChatOpenAI

from app.config import settings

if TYPE_CHECKING:
    from app.chat.schemas import ModelConfigOverride


def create_chat_llm(override: "ModelConfigOverride | None" = None) -> ChatOpenAI:
    """创建聊天业务使用的 LangChain ChatOpenAI 客户端。

    优先级：请求级覆盖（前端配置）> .env 配置（OPENAI_*）。
    """

    if override is not None and override.chatApiKey:
        api_key = override.chatApiKey
        base_url = override.chatBaseUrl or None
        model = override.chatModel or settings.openai_chat_model
    else:
        api_key = settings.openai_api_key
        base_url = settings.openai_base_url or None
        model = settings.openai_chat_model

    if not api_key:
        raise RuntimeError(
            "未配置聊天模型凭据：请在 AI-server/.env 填写 OPENAI_API_KEY，"
            "或在页面“模型设置”中保存自定义配置"
        )

    return ChatOpenAI(
        model=model,
        temperature=0.2,
        api_key=api_key,
        base_url=base_url,
    )
