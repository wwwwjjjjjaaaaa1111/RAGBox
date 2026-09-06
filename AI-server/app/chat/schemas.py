"""定义聊天业务对外暴露的数据结构。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ChatHistoryMessage(BaseModel):
    """描述一次会话内的历史对话消息。"""

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class ModelConfigOverride(BaseModel):
    """Node 转发的用户级模型凭据与参数覆盖；字段为空时回退 .env 配置。"""

    chatBaseUrl: str | None = None
    chatApiKey: str | None = None
    chatModel: str | None = None
    embeddingBaseUrl: str | None = None
    embeddingApiKey: str | None = None
    embeddingModel: str | None = None
    chunkSize: int | None = Field(default=None, ge=200, le=4000)
    chunkOverlap: int | None = Field(default=None, ge=0, le=1000)
    retrievalTopK: int | None = Field(default=None, ge=1, le=20)
    retrievalScoreThreshold: float | None = Field(default=None, ge=0.0, le=1.0)


class ChatRequest(BaseModel):
    """Node 发给 Python 的流式聊天请求体。"""

    query: str = Field(min_length=1)
    sessionId: str | None = None
    userId: str
    recentMessages: list[ChatHistoryMessage] = Field(default_factory=list)
    modelConfig: ModelConfigOverride | None = None
    # 检索范围限定：仅检索这些文件的分块；为空时检索该用户全部文件。
    fileIds: list[str] | None = None


class TitleRequest(BaseModel):
    """Node 发给 Python 的会话标题生成请求体。"""

    query: str = Field(min_length=1)
    answer: str = Field(min_length=1)
    modelConfig: ModelConfigOverride | None = None


class ChatSource(BaseModel):
    """返回给 Node/前端的引用信息。"""

    fileId: str | None = None
    fileName: str | None = None
    pageNumber: int | None = None
    chunkIndex: int | None = None
    snippet: str


class ChatStreamEvent(BaseModel):
    """统一的聊天流事件。"""

    type: Literal[
        "message.started",
        "message.delta",
        "message.sources",
        "message.completed",
        "message.failed",
    ]
    delta: str | None = None
    sources: list[ChatSource] = Field(default_factory=list)
    message: str | None = None
    code: str | None = None