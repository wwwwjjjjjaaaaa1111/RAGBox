"""封装知识库向量化模型的创建逻辑。"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from langchain_community.embeddings import ZhipuAIEmbeddings
from langchain_core.embeddings import Embeddings
from langchain_openai import OpenAIEmbeddings

from app.config import settings

if TYPE_CHECKING:
    from app.chat.schemas import ModelConfigOverride


def _resolve_embedding_settings(override: "ModelConfigOverride | None" = None) -> dict[str, Any]:
    """按 前端覆盖 > .env 配置 的顺序解析 embedding 凭据。

    返回 {"provider": "openai" | "zhipu", ...}；两者都无凭据时返回空 dict。
    """

    if override is not None:
        if override.embeddingApiKey:
            return {
                "provider": "openai",
                "api_key": override.embeddingApiKey,
                "base_url": override.embeddingBaseUrl or None,
                "model": override.embeddingModel or settings.embedding_model,
            }

    if settings.embedding_api_key:
        return {
            "provider": "openai",
            "api_key": settings.embedding_api_key,
            "base_url": settings.embedding_base_url or None,
            "model": settings.embedding_model,
        }

    if settings.zhipu_api_key:
        return {
            "provider": "zhipu",
            "api_key": settings.zhipu_api_key,
            "model": settings.embedding_model,
        }

    return {}


def resolve_embedding_model_name(override: "ModelConfigOverride | None" = None) -> str | None:
    """返回当前配置下实际会使用的 embedding 模型名；无凭据时返回 None。

    检索接口回显该名字，用于暴露「检索与入库使用了不同向量模型」的隐患。
    """

    return _resolve_embedding_settings(override).get("model")


def create_embedding_model(override: "ModelConfigOverride | None" = None) -> Embeddings:
    """创建知识库文档向量化阶段使用的嵌入模型客户端。

    优先级：请求级覆盖（前端配置）> EMBEDDING_API_KEY（OpenAI 兼容端点）
    > ZHIPUAI_API_KEY（智谱默认）。
    """

    resolved = _resolve_embedding_settings(override)
    provider = resolved.get("provider")

    if provider == "openai":
        return OpenAIEmbeddings(
            model=resolved["model"],
            api_key=resolved["api_key"],
            base_url=resolved["base_url"],
        )

    if provider == "zhipu":
        return ZhipuAIEmbeddings(
            model=resolved["model"],
            api_key=resolved["api_key"],
        )

    raise RuntimeError(
        "未配置向量模型凭据：请在 AI-server/.env 填写 EMBEDDING_API_KEY（OpenAI 兼容端点）"
        "或 ZHIPUAI_API_KEY（智谱），或在页面“模型设置”中保存自定义配置"
    )
