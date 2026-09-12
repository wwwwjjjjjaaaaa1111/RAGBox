import { Counter, Gauge, Histogram, collectDefaultMetrics, register } from "prom-client";

/**
 * Prometheus 指标注册与定义。
 *
 * 约定：
 * - route 标签用路由模式（如 /v1/chat/sessions/:id/completions），不用原始路径，
 *   避免会话 ID 之类的高基数值撑爆时序库。
 * - /health 与 /metrics 自身不计入 HTTP 指标。
 */

// 进程级默认指标（GC、事件循环延迟等）。
collectDefaultMetrics({ prefix: "ragbox_" });

export const httpRequestsTotal = new Counter({
  name: "ragbox_http_requests_total",
  help: "HTTP 请求总数",
  labelNames: ["method", "route", "status"] as const,
});

export const httpRequestDuration = new Histogram({
  name: "ragbox_http_request_duration_seconds",
  help: "HTTP 请求耗时（秒）",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// 入库任务按状态分布：collect 时实时查库，保证 scrape 看到的总是当前值。
export const ingestionTasksByStatus = new Gauge({
  name: "ragbox_ingestion_tasks",
  help: "入库任务按状态分布",
  labelNames: ["status"] as const,
  async collect() {
    try {
      const { prisma } = await import("../lib/prisma");
      const grouped = await prisma.ingestionTask.groupBy({ by: ["status"], _count: { _all: true } });
      for (const row of grouped) {
        this.set({ status: row.status }, row._count._all);
      }
    } catch {
      // 数据库不可用时跳过本次采集，不影响其余指标暴露。
    }
  },
});

/** 把 Express 的原始路径归一化为路由模式，避免高基数标签。 */
export function routeLabelOf(req: { baseUrl?: string; route?: { path?: string } }): string {
  if (req.route?.path) {
    return `${req.baseUrl || ""}${req.route.path}` || "unmatched";
  }
  return "unmatched";
}

export async function renderMetrics(): Promise<string> {
  return register.metrics();
}

export const contentType = register.contentType;
