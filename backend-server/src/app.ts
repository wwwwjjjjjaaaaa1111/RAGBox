import cors from "cors";
import express from "express";
import { errorHandler } from "./common/errors";
import routes from "./routes/index";

export const app = express();

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
