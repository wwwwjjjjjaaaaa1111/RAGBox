
"""FastAPI 入口，暴露健康检查、摄取、聊天、检索与图表接口。"""

from __future__ import annotations

import base64

import uvicorn
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from app.charts.schemas import ChartRequest
from app.charts.service import ChartNotFoundError, execute_chart_tool, resolve_chart_file
from app.chat.retriever import search_knowledge_base
from app.chat.schemas import ChatRequest, SearchRequest, SearchResponse, TitleRequest
from app.chat.service import generate_title, stream_chat_events
from app.config import settings
from app.knowledge_base.ingestion_service import process_knowledge_ingestion_job
from app.knowledge_base.schemas import IngestionJob
from app.knowledge_base.vector_store import KnowledgeVectorStore

app = FastAPI(title="AI Server", version="0.1.0")


@app.get("/health")
def health() -> dict[str, bool]:
    """返回轻量级健康检查结果。"""

    return {"ok": True}


@app.post("/ingestion/jobs", status_code=202)
async def create_ingestion_job(
    payload: IngestionJob,
    background_tasks: BackgroundTasks,
    x_ai_service_secret: str | None = Header(default=None),
) -> dict[str, object]:
    """接收摄取任务，并在后台异步执行。"""

    if settings.ai_service_secret and x_ai_service_secret != settings.ai_service_secret:
        raise HTTPException(status_code=401, detail="Invalid AI service secret")

    # 通过 BackgroundTasks 将耗时的解析和向量化流程移出请求主链路。
    background_tasks.add_task(process_knowledge_ingestion_job, payload)
    return {
        "accepted": True,
        "taskId": payload.taskId,
        "fileId": payload.fileId,
    }


@app.delete("/vectors/files/{file_id}")
def delete_file_vectors(
    file_id: str,
    x_ai_service_secret: str | None = Header(default=None),
) -> dict[str, object]:
    """删除某个文件在向量库中的所有分块。"""

    if settings.ai_service_secret and x_ai_service_secret != settings.ai_service_secret:
        raise HTTPException(status_code=401, detail="Invalid AI service secret")

    vector_store = KnowledgeVectorStore()
    vector_store.delete_file_chunks(file_id)

    return {
        "deleted": True,
        "fileId": file_id,
    }


@app.post("/chat/stream")
async def stream_chat(
    payload: ChatRequest,
    x_ai_service_secret: str | None = Header(default=None),
) -> StreamingResponse:
    """执行一次基于知识库检索增强的流式聊天。"""

    if settings.ai_service_secret and x_ai_service_secret != settings.ai_service_secret:
        raise HTTPException(status_code=401, detail="Invalid AI service secret")

    return StreamingResponse(stream_chat_events(payload), media_type="text/event-stream")


@app.post("/chat/title")
def generate_session_title(
    payload: TitleRequest,
    x_ai_service_secret: str | None = Header(default=None),
) -> dict[str, object]:
    """为首次对话生成简短的会话标题。"""

    if settings.ai_service_secret and x_ai_service_secret != settings.ai_service_secret:
        raise HTTPException(status_code=401, detail="Invalid AI service secret")

    title = generate_title(payload)
    return {"title": title}


@app.post("/search")
def search_knowledge(
    payload: SearchRequest,
    x_user_id: str = Header(),
    x_ai_service_secret: str | None = Header(default=None),
) -> SearchResponse:
    """只读向量检索：返回带相似度分数的命中分块，不调用对话模型。

    供 MCP 等外部客户端使用（由 Node 服务代理转发）。
    路由声明为同步函数，FastAPI 会在线程池中执行，避免阻塞事件循环。
    """

    if settings.ai_service_secret and x_ai_service_secret != settings.ai_service_secret:
        raise HTTPException(status_code=401, detail="Invalid AI service secret")

    try:
        return search_knowledge_base(payload, x_user_id)
    except RuntimeError as error:
        # 向量模型凭据缺失等配置类问题：给出可操作的提示而不是 500。
        raise HTTPException(status_code=503, detail=str(error)) from None


@app.post("/charts", status_code=201)
def create_chart(
    payload: ChartRequest,
    x_user_id: str = Header(),
    x_ai_service_secret: str | None = Header(default=None),
) -> dict[str, object]:
    """按显式参数生成图表（不经由 LLM 工具调用），返回 chartId 与 PNG 的 base64。

    返回内联 PNG 是为了让 MCP 客户端直接把图片放进对话；
    图表文件默认永久保留（CHARTS_TTL_MINUTES=0），供网页端历史会话回显。
    """

    if settings.ai_service_secret and x_ai_service_secret != settings.ai_service_secret:
        raise HTTPException(status_code=401, detail="Invalid AI service secret")

    try:
        result = execute_chart_tool(payload.to_tool_args(), x_user_id)
    except RuntimeError as error:
        # render_chart 在缺 matplotlib 等环境下抛出。
        raise HTTPException(status_code=503, detail=str(error)) from None

    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=str(result.get("message") or "图表参数不合法"))

    chart_id = str(result["chartId"])
    try:
        png_path = resolve_chart_file(chart_id, x_user_id, ".png")
    except ChartNotFoundError:
        raise HTTPException(status_code=404, detail="Chart not found or expired") from None

    return {
        "chartId": chart_id,
        "title": result["title"],
        "chartType": result["chartType"],
        "seriesCount": result["seriesCount"],
        "pointCount": result["pointCount"],
        "pngBase64": base64.b64encode(png_path.read_bytes()).decode("ascii"),
    }


@app.get("/charts/{chart_id}/pdf")
def get_chart_pdf(
    chart_id: str,
    x_user_id: str = Header(),
    x_ai_service_secret: str | None = Header(default=None),
) -> FileResponse:
    """下载生成的图表 PDF（仅限属主；由 Node 服务代理转发）。"""

    if settings.ai_service_secret and x_ai_service_secret != settings.ai_service_secret:
        raise HTTPException(status_code=401, detail="Invalid AI service secret")

    try:
        pdf_path = resolve_chart_file(chart_id, x_user_id, ".pdf")
    except ChartNotFoundError:
        raise HTTPException(status_code=404, detail="Chart not found or expired") from None

    return FileResponse(pdf_path, media_type="application/pdf", filename=f"{chart_id}.pdf")


@app.get("/charts/{chart_id}/png")
def get_chart_png(
    chart_id: str,
    x_user_id: str = Header(),
    x_ai_service_secret: str | None = Header(default=None),
) -> FileResponse:
    """获取图表预览图（仅限属主；由 Node 服务代理转发）。"""

    if settings.ai_service_secret and x_ai_service_secret != settings.ai_service_secret:
        raise HTTPException(status_code=401, detail="Invalid AI service secret")

    try:
        png_path = resolve_chart_file(chart_id, x_user_id, ".png")
    except ChartNotFoundError:
        raise HTTPException(status_code=404, detail="Chart not found or expired") from None

    return FileResponse(png_path, media_type="image/png")


if __name__ == "__main__":
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=True)
