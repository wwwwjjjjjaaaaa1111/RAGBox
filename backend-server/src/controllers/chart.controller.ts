import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { createChartBodySchema } from "../common/schemas";
import { validate } from "../common/validation";
import { getAuthUserId } from "../middleware/auth";
import * as aiService from "../services/ai.service";

const chartParamsSchema = z.object({
  chartId: z.string().uuid(),
});

/**
 * 按显式参数创建图表（供 MCP 等外部客户端使用，不经由 LLM 工具调用）。
 * 返回内联 PNG 的 base64，使调用方无需在图表 TTL 内抢着下载。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export async function createChart(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(createChartBodySchema, req.body || {}, "request body");

    const result = await aiService.createChart({
      userId: getAuthUserId(req),
      title: body.title,
      chartType: body.chartType,
      xLabels: body.xLabels,
      series: body.series,
      sourceNote: body.sourceNote ?? null,
    });

    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
}

/**
 * 代理获取聊天中生成的图表文件（PDF 下载 / PNG 内嵌预览，AI 服务侧做属主校验）。
 * 文件类型由命中的路由路径推导（…/pdf 或 …/png），不依赖 query 参数。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export async function getChartFile(req: Request, res: Response, next: NextFunction) {
  try {
    const { chartId } = validate(chartParamsSchema, req.params || {}, "path params");
    const kind: "pdf" | "png" = req.path.endsWith("/png") ? "png" : "pdf";
    const upstream = await aiService.fetchChartFile(chartId, getAuthUserId(req), kind);

    res.status(upstream.status);
    res.setHeader("Content-Type", kind === "pdf" ? "application/pdf" : "image/png");
    const disposition = upstream.headers.get("content-disposition");
    if (kind === "pdf") {
      res.setHeader("Content-Disposition", disposition || `attachment; filename="${chartId}.pdf"`);
    }

    const reader = upstream.body!.getReader();
    const pump = async (): Promise<void> => {
      const { value, done } = await reader.read();
      if (done) {
        res.end();
        return;
      }
      res.write(Buffer.from(value));
      await pump();
    };

    await pump();
  } catch (error) {
    next(error);
  }
}
