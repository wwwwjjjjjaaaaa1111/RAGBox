import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  contentType,
  httpRequestsTotal,
  httpRequestDuration,
  renderMetrics,
  routeLabelOf,
} from "../lib/metrics";

/** 不计入 HTTP 指标的路径（自身与探活）。 */
const EXCLUDED = new Set(["/health", "/metrics"]);

/**
 * HTTP 指标：请求数与耗时（路由模式标签，完成时结算）。
 * 必须挂在中间件链最前面（res.on finish 才能覆盖全部路由）。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export const httpMetrics: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (EXCLUDED.has(req.path)) {
    next();
    return;
  }

  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const route = routeLabelOf(req);
    const status = String(res.statusCode);
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestsTotal.inc({ method: req.method, route, status });
    httpRequestDuration.observe({ method: req.method, route, status }, seconds);
  });

  next();
};

/**
 * 暴露 Prometheus 指标。
 * @param _req Express 请求对象（未使用）。
 * @param res Express 响应对象。
 */
export async function metricsEndpoint(_req: Request, res: Response): Promise<void> {
  res.set("Content-Type", contentType);
  res.end(await renderMetrics());
}
