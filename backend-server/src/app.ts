import cors from "cors";
import express from "express";
import { errorHandler } from "./common/errors";
import { httpMetrics, metricsEndpoint } from "./middleware/metrics";
import { attachRequestId, logRequest } from "./middleware/requestId";
import routes from "./routes/index";

export const app = express();

// 追踪、日志与指标最先挂载：所有下游日志、错误与 AI 服务转发都携带同一 requestId。
app.use(attachRequestId);
app.use(logRequest);
app.use(httpMetrics);

// 指标端点：Prometheus 抓取目标（不在 HTTP 指标内统计自身）。
app.get("/metrics", metricsEndpoint);

// Restrict cross-origin access to the configured frontend origins.
// Requests without an Origin header (curl, server-to-server callbacks) are allowed.
const DEFAULT_CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const configuredOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigins = configuredOrigins.length > 0 ? configuredOrigins : DEFAULT_CORS_ORIGINS;

app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
}));
// Parse JSON request bodies for all API handlers.
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// All business APIs are served under /v1.
app.use("/v1", routes);

// Keep error middleware last so thrown errors are normalized.
app.use(errorHandler);
