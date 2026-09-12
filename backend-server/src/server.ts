// Load .env before any module reads process.env for configuration.
import "dotenv/config";
import { app } from "./app";
import { logger } from "./lib/logger";
import { failInterruptedIngestionTasks } from "./services/file.service";

const port = Number(process.env.PORT || 3001);

// 运行中任务超过该分钟数没有任何进展（无回调刷新 updatedAt）即判定中断。
const STALE_TASK_MINUTES = Number(process.env.INGESTION_STALE_TIMEOUT_MINUTES || 10);
const REAPER_INTERVAL_MS = 60_000;
// 优雅停机时等待存量连接收尾的上限；超时强制退出，避免无限挂起。
const SHUTDOWN_DRAIN_MS = 10_000;

// 单进程 HTTP 入口；同时托管入库任务的中断收割器。
const server = app.listen(port, () => {
  logger.info({ port }, "backend server listening");

  // 启动清扫：上次运行遗留的 queued/running 任务已无人推进，直接置为 failed。
  // （若 AI-server 仍在处理同一任务，其后续进度回调会把状态改回真实值。）
  void failInterruptedIngestionTasks()
    .then((count) => {
      if (count > 0) {
        logger.info({ count }, "recovered interrupted ingestion tasks from previous run");
      }
    })
    .catch((error) => {
      logger.error({ err: error }, "startup ingestion sweep failed");
    });

  // 运行时收割：AI-server 中途崩溃时，卡在 running 的任务由该定时器兜底。
  const reaper = setInterval(() => {
    void failInterruptedIngestionTasks(STALE_TASK_MINUTES)
      .then((count) => {
        if (count > 0) {
          logger.warn({ count, staleMinutes: STALE_TASK_MINUTES }, "reaped stale ingestion tasks");
        }
      })
      .catch((error) => {
        logger.error({ err: error }, "stale ingestion reaper failed");
      });
  }, REAPER_INTERVAL_MS);

  // 优雅停机：停止接新请求，等待存量连接（含 SSE 流）收尾，限时后强制退出。
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      logger.info({ signal }, "shutting down: closing server and draining connections");
      clearInterval(reaper);
      server.close(() => {
        logger.info("server closed cleanly");
        process.exit(0);
      });
      setTimeout(() => {
        logger.warn("drain timeout elapsed, forcing exit");
        process.exit(1);
      }, SHUTDOWN_DRAIN_MS).unref();
    });
  }
});
