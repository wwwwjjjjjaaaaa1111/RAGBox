"""图表工具执行器与生成产物的存取管理。"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.charts.renderer import render_chart
from app.charts.schemas import ChartToolArgs
from app.config import settings


class ChartNotFoundError(Exception):
    """图表不存在、已过期或不属于当前用户。"""


def _charts_dir() -> Path:
    return Path(settings.charts_output_dir)


def cleanup_expired_charts() -> int:
    """删除超过 TTL 的图表文件与元数据，返回清理的图表数量。"""

    charts_dir = _charts_dir()
    if not charts_dir.exists():
        return 0

    removed = 0
    now = time.time()
    for meta_path in charts_dir.glob("*.json"):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if now - meta.get("createdAt", 0) > settings.charts_ttl_minutes * 60:
                chart_id = meta_path.stem
                for suffix in (".json", ".pdf", ".png"):
                    (charts_dir / f"{chart_id}{suffix}").unlink(missing_ok=True)
                removed += 1
        except Exception:  # noqa: BLE001
            continue

    return removed


def execute_chart_tool(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    """执行 generate_chart 工具：校验参数 → 渲染 → 落盘。

    返回结构中 ok=False 时，message 面向 LLM（它会据此向用户解释失败原因）。
    """

    cleanup_expired_charts()

    try:
        chart_args = ChartToolArgs.model_validate(args)
    except ValidationError as error:
        return {
            "ok": False,
            "message": f"图表参数不合法，无法生成：{error.errors()[0].get('msg', str(error))}",
        }

    chart_id = str(uuid.uuid4())
    result = render_chart(chart_id, chart_args, _charts_dir())

    meta = {
        "chartId": chart_id,
        "userId": user_id,
        "title": chart_args.title,
        "chartType": chart_args.chart_type,
        "createdAt": time.time(),
    }
    (_charts_dir() / f"{chart_id}.json").write_text(
        json.dumps(meta, ensure_ascii=False), encoding="utf-8"
    )

    points = sum(len(item.values) for item in chart_args.series)
    return {
        "ok": True,
        "chartId": chart_id,
        "title": chart_args.title,
        "chartType": chart_args.chart_type,
        "seriesCount": len(chart_args.series),
        "pointCount": points,
        "message": (
            f"图表「{chart_args.title}」已生成"
            f"（{len(chart_args.series)} 个系列，共 {points} 个数据点），"
            "用户界面已提供 PDF 下载。请在回答中提醒用户核对 PDF 第二页的数据核对表。"
        ),
    }


def resolve_chart_file(chart_id: str, user_id: str, suffix: str) -> Path:
    """按 chartId 解析文件路径，并校验属主与有效期。"""

    if not chart_id or any(ch in chart_id for ch in "/\\."):
        raise ChartNotFoundError()

    meta_path = _charts_dir() / f"{chart_id}.json"
    file_path = _charts_dir() / f"{chart_id}{suffix}"
    if not meta_path.exists() or not file_path.exists():
        raise ChartNotFoundError()

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        raise ChartNotFoundError() from None

    if meta.get("userId") != user_id:
        raise ChartNotFoundError()

    if time.time() - meta.get("createdAt", 0) > settings.charts_ttl_minutes * 60:
        raise ChartNotFoundError()

    return file_path
