"""matplotlib 图表渲染器：数据 JSON → PNG 预览 + 两页 PDF（图表页 + 数据核对页）。

matplotlib 采用函数内惰性导入：未安装时聊天主链路不受影响，仅图表生成报错。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.charts.schemas import ChartToolArgs

# 中文字体候选：Windows 本地用微软雅黑，Docker 内用 Noto Sans CJK（Dockerfile 已安装）。
FONT_CANDIDATES = [
    "Microsoft YaHei",
    "Noto Sans CJK SC",
    "WenQuanYi Zen Hei",
    "SimHei",
    "PingFang SC",
    "sans-serif",
]

CHART_TYPE_LABELS = {"line": "折线图", "bar": "柱状图"}


@dataclass
class ChartRenderResult:
    """渲染产物路径。"""

    chart_id: str
    pdf_path: Path
    png_path: Path


def _configure_chinese_font() -> None:
    """配置中文字体，避免图中文字变成方块。"""

    import matplotlib

    matplotlib.rcParams["font.family"] = "sans-serif"
    matplotlib.rcParams["font.sans-serif"] = FONT_CANDIDATES
    # 坐标轴负号正常显示。
    matplotlib.rcParams["axes.unicode_minus"] = False


def _draw_chart(ax, args: ChartToolArgs) -> None:
    """在给定坐标系上绘制折线图或柱状图。"""

    x = range(len(args.x_labels))

    if args.chart_type == "line":
        for item in args.series:
            ax.plot(x, item.values, marker="o", linewidth=2, label=item.name)
    else:
        # 多系列时按组偏移，形成并列柱状图。
        series_count = len(args.series)
        width = 0.8 / series_count
        for index, item in enumerate(args.series):
            offsets = [i + index * width - 0.4 + width / 2 for i in x]
            ax.bar(offsets, item.values, width=width, label=item.name)

    ax.set_title(args.title)
    ax.set_xticks(list(x))
    ax.set_xticklabels(
        args.x_labels,
        rotation=30 if len(args.x_labels) > 6 else 0,
        ha="right" if len(args.x_labels) > 6 else "center",
    )
    ax.grid(axis="y", linestyle="--", alpha=0.4)
    ax.legend(loc="best")
    ax.set_xlabel("类别")
    ax.set_ylabel("数值")


def _draw_data_table(fig, args: ChartToolArgs) -> None:
    """在第二页绘制数据核对表，方便使用者校对 LLM 提取的数值。"""

    ax = fig.add_subplot(111)
    ax.axis("off")
    ax.set_title(f"{args.title} · 数据核对表")

    cell_text = [[label, *[item.values[i] for item in args.series]] for i, label in enumerate(args.x_labels)]
    table = ax.table(
        cellText=cell_text,
        colLabels=["X 轴", *[item.name for item in args.series]],
        loc="center",
        cellLoc="center",
    )
    table.auto_set_font_size(False)
    table.scale(1, 1.4)


def render_chart(chart_id: str, args: ChartToolArgs, output_dir: Path) -> ChartRenderResult:
    """渲染图表并输出 PNG 与两页 PDF。"""

    try:
        import matplotlib
    except ImportError as error:
        raise RuntimeError(
            "服务器未安装 matplotlib，无法生成图表（pip install matplotlib）"
        ) from error

    matplotlib.use("Agg")
    _configure_chinese_font()

    from matplotlib import pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages

    output_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = output_dir / f"{chart_id}.pdf"
    png_path = output_dir / f"{chart_id}.png"

    fig, ax = plt.subplots(figsize=(9, 5.5), layout="tight")
    _draw_chart(ax, args)

    fig.savefig(png_path, dpi=150)
    with PdfPages(pdf_path) as pdf:
        pdf.savefig(fig)

        table_fig = plt.figure(figsize=(9, max(5.5, 0.5 * len(args.x_labels))), layout="tight")
        _draw_data_table(table_fig, args)
        pdf.savefig(table_fig)
        plt.close(table_fig)

    plt.close(fig)
    return ChartRenderResult(chart_id=chart_id, pdf_path=pdf_path, png_path=png_path)
