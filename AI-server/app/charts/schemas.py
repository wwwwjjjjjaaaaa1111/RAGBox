"""定义图表工具的参数结构与校验规则。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

# 防止把整本表格书塞进一张图。
MAX_X_LABELS = 200
MAX_SERIES = 8


class ChartSeries(BaseModel):
    """图表中的一条数据系列。"""

    name: str = Field(min_length=1, max_length=100)
    values: list[float] = Field(min_length=1, max_length=MAX_X_LABELS)


class ChartToolArgs(BaseModel):
    """generate_chart 工具的调用参数（由 LLM 从对话/文档内容中提取）。"""

    title: str = Field(min_length=1, max_length=120)
    chart_type: Literal["line", "bar"]
    x_labels: list[str] = Field(min_length=1, max_length=MAX_X_LABELS)
    series: list[ChartSeries] = Field(min_length=1, max_length=MAX_SERIES)
    source_note: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _check_lengths_match(self) -> "ChartToolArgs":
        for item in self.series:
            if len(item.values) != len(self.x_labels):
                raise ValueError(
                    f"系列「{item.name}」的数值个数({len(item.values)})必须与 x 轴标签个数({len(self.x_labels)})一致"
                )
        return self
