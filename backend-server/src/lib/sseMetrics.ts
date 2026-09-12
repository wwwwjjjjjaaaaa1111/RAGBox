import { Gauge, register } from "prom-client";

/** SSE 长连接活跃数（按流类型区分）。 */
export const sseActiveConnections = new Gauge({
  name: "ragbox_sse_active_connections",
  help: "当前活跃的 SSE 连接数",
  labelNames: ["kind"] as const,
});
