import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { requestLogger } from "../lib/logger";
import { aiRequestStorage } from "../lib/requestContext";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** 本请求的追踪 ID（贯穿后端与 AI 服务的日志）。 */
      id?: string;
      /** 绑定 requestId 的日志器（由 attachRequestId 挂载）。 */
      log?: Logger;
    }
  }
}

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * 请求追踪：继承上游 x-request-id 或生成新 UUID，写入响应头、req.id 与
 * AsyncLocalStorage（供深层模块如 ai.service 读取）。
 * 必须挂在中间件链最前面，保证下游日志与 AI 服务转发都带同一 ID。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export const attachRequestId: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId = incoming && incoming.trim() ? incoming.trim() : randomUUID();

  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);
  req.log = requestLogger(requestId);

  aiRequestStorage.run({ requestId }, () => next());
};

/**
 * 请求完成日志：方法、路径、状态码与耗时。
 * 健康检查与指标端点不记录（高频率、无排障价值），避免日志噪声。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export const logRequest: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const path = req.originalUrl.split("?")[0];
    if (path === "/health" || path === "/metrics") {
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    req.log?.info(
      {
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      },
      "request completed",
    );
  });

  next();
};
