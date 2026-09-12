import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";

export type ApiError = Error & {
  status?: number;
  code?: string;
  details?: unknown;
};

/**
 * 创建标准化 API 错误对象，供全局错误中间件统一处理。
 * @param status HTTP 状态码。
 * @param code 业务错误码。
 * @param message 对外错误消息。
 * @param details 可选的结构化错误详情。
 * @returns 可被错误处理中间件识别的 ApiError。
 */
export function createApiError(status: number, code: string, message: string, details?: unknown): ApiError {
  const error = new Error(message) as ApiError;
  error.status = status;
  error.code = code;
  if (details) {
    error.details = details;
  }
  return error;
}

/**
 * 向客户端返回统一的错误响应结构。
 * @param res Express 响应对象。
 * @param status HTTP 状态码。
 * @param code 业务错误码。
 * @param message 对外错误消息。
 * @param details 可选的结构化错误详情。
 * @returns Express 响应对象。
 */
export function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  const payload: {
    error: {
      code: string;
      message: string;
      details?: unknown;
    };
  } = {
    error: {
      code,
      message,
    },
  };

  if (details) {
    payload.error.details = details;
  }

  return res.status(status).json(payload);
}

/**
 * Express 全局错误中间件，负责错误码映射与结构化错误日志。
 * 4xx 记 warn（客户端问题，需可检索但非故障）；5xx 与未知错误记 error。
 * 所有记录均带 requestId 与错误码，供跨服务串联。
 * @param error 捕获到的错误对象。
 * @param req Express 请求对象（用于取 requestId）。
 * @param res Express 响应对象。
 * @param _next Express next（当前未使用）。
 * @returns 已写入的错误响应。
 */
export function errorHandler(error: ApiError, req: Request, res: Response, _next: NextFunction) {
  // Prisma not-found write operations map to a domain-neutral 404 response.
  if (error && error.code === "P2025") {
    req.log?.warn({ code: "RESOURCE_NOT_FOUND", err: error }, "resource not found");
    return sendApiError(res, 404, "RESOURCE_NOT_FOUND", "Resource not found");
  }

  if (error && error.code && error.status) {
    const payload = { code: error.code, err: error };
    if (error.status >= 500) {
      req.log?.error(payload, `request failed: ${error.message}`);
    } else {
      req.log?.warn(payload, `request rejected: ${error.message}`);
    }
    return sendApiError(res, error.status, error.code, error.message, error.details);
  }

  // Hide unknown runtime errors behind a generic 500 response.
  req.log?.error({ err: error }, "unhandled internal error");
  return sendApiError(res, 500, "INTERNAL_SERVER_ERROR", "Internal server error");
}
