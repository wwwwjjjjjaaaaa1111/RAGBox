import pino from "pino";

/**
 * 结构化日志：单行 JSON，供日志采集与人工检索。
 *
 * 每条记录统一携带 requestId（HTTP 请求由 requestLogging 中间件注入，
 * 非请求上下文（启动、定时任务）不带该字段）。
 */

const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : "info");

export const logger = pino({
  level: LOG_LEVEL,
  base: { service: "ragbox-backend" },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

/**
 * 从请求上下文取日志器：所有请求级日志统一走这里，自动带上 requestId。
 * @param requestId 当前请求的追踪 ID。
 * @returns 绑定了 requestId 的 pino 子日志器。
 */
export function requestLogger(requestId: string) {
  return logger.child({ requestId });
}
