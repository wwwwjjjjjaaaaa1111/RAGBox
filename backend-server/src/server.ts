// Load .env before any module reads process.env for configuration.
import "dotenv/config";
import { app } from "./app";
import { failInterruptedIngestionTasks } from "./services/file.service";

const port = Number(process.env.PORT || 3001);

// 运行中任务超过该分钟数没有任何进展（无回调刷新 updatedAt）即判定中断。
const STALE_TASK_MINUTES = Number(process.env.INGESTION_STALE_TIMEOUT_MINUTES || 10);
const REAPER_INTERVAL_MS = 60_000;

// 单进程 HTTP 入口；同时托管入库任务的中断收割器。
app.listen(port, () => {
  console.log(`Backend server listening on http://localhost:${port}`);

  // 启动清扫：上次运行遗留的 queued/running 任务已无人推进，直接置为 failed。
  // （若 AI-server 仍在处理同一任务，其后续进度回调会把状态改回真实值。）
  void failInterruptedIngestionTasks()
    .then((count) => {
      if (count > 0) {
        console.log(`Recovered ${count} interrupted ingestion task(s) from previous run`);
      }
    })
    .catch((error) => {
      console.error("Startup ingestion sweep failed:", error);
    });

  // 运行时收割：AI-server 中途崩溃时，卡在 running 的任务由该定时器兜底。
  const reaper = setInterval(() => {
    void failInterruptedIngestionTasks(STALE_TASK_MINUTES)
      .then((count) => {
        if (count > 0) {
          console.log(`Reaped ${count} stale ingestion task(s) (no progress in ${STALE_TASK_MINUTES} min)`);
        }
      })
      .catch((error) => {
        console.error("Stale ingestion reaper failed:", error);
      });
  }, REAPER_INTERVAL_MS);

  // 进程退出时清理定时器（正常退出信号）。
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => clearInterval(reaper));
  }
});
