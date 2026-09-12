"""AI 服务可观测性：request-id 上下文、结构化日志、Prometheus 指标。

request-id 由 Node 侧透传（x-request-id），存入 ContextVar——
asyncio.to_thread 与后台任务里都能取到，保证日志跨服务可串联。
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from contextvars import ContextVar

from fastapi import Request
from prometheus_client import Counter, Gauge, Histogram

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

# 路径中的 UUID 归一化为 {id}，避免图表/文件 ID 撑爆指标基数。
_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


class RequestIdFilter(logging.Filter):
    """把当前 request_id 注入每条日志记录。"""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    """单行 JSON 日志格式，便于采集与检索。"""

    def format(self, record: logging.LogRecord) -> str:
        import json

        payload = {
            "service": "ragbox-ai",
            "level": record.levelname.lower(),
            "requestId": getattr(record, "request_id", "-"),
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["error"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> None:
    """替换根日志处理器为 JSON 格式（幂等，重复调用不叠加处理器）。"""

    root = logging.getLogger()
    if any(isinstance(h, logging.StreamHandler) and getattr(h, "_ragbox_json", False) for h in root.handlers):
        return

    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    handler._ragbox_json = True  # type: ignore[attr-defined]
    root.addHandler(handler)
    root.setLevel(logging.INFO)


# ---- Prometheus 指标 ----

http_requests_total = Counter(
    "ragbox_ai_http_requests_total",
    "AI 服务 HTTP 请求总数",
    ["method", "path", "status"],
)
http_request_seconds = Histogram(
    "ragbox_ai_http_request_seconds",
    "AI 服务 HTTP 请求耗时（秒）",
    ["method", "path"],
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)
embedding_batch_seconds = Histogram(
    "ragbox_ai_embedding_batch_seconds",
    "嵌入单批调用耗时（秒）",
    buckets=(0.25, 0.5, 1, 2, 4, 8, 16, 32),
)
embedding_retry_total = Counter(
    "ragbox_ai_embedding_retry_total",
    "嵌入服务限流（429）重试总次数",
)
qdrant_query_seconds = Histogram(
    "ragbox_ai_qdrant_query_seconds",
    "Qdrant 检索耗时（秒）",
    ["route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1),
)
ingestion_chunks_total = Counter(
    "ragbox_ai_ingestion_chunks_total",
    "已写入向量库的分块总数",
)


async def request_context_middleware(request: Request, call_next):
    """request-id 透传 + HTTP 指标计时（异常按 500 计数后继续抛出）。"""

    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    token = request_id_var.set(request_id)
    start = time.perf_counter()
    status = 500
    response = None
    try:
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        status = response.status_code
        return response
    finally:
        elapsed = time.perf_counter() - start
        normalized = _UUID_RE.sub("{id}", request.url.path)
        http_requests_total.labels(request.method, normalized, str(status)).inc()
        http_request_seconds.labels(request.method, normalized).observe(elapsed)
        request_id_var.reset(token)
