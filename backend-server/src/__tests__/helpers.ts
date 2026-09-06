import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import type { Server } from "node:http";

const BACKEND_ROOT = path.resolve(__dirname, "../..");

export type TestContext = {
  baseUrl: string;
  prisma: typeof import("../lib/prisma").prisma;
  close: () => Promise<void>;
};

/**
 * 搭建隔离的测试环境：
 * - 独立 test db（每个测试文件一个，node --test 并行运行互不干扰）
 * - AI 服务指向必然快速失败的地址（验证派发失败路径）
 * - 固定加密密钥（避免测试生成 .model-key 文件）
 * - app 监听临时端口
 * 注意：node --test 每个测试文件独立进程，因此每个文件各自调用本函数。
 */
export async function setupTestApp(suiteName: string): Promise<TestContext> {
  const dbName = `test-${suiteName}.db`;
  const testDbPath = path.resolve(BACKEND_ROOT, "prisma", dbName);
  const databaseUrl = `file:./${dbName}`;

  process.env.DATABASE_URL = databaseUrl;
  process.env.AI_SERVICE_BASE_URL = "http://127.0.0.1:9";
  process.env.AI_INGESTION_ENDPOINT = "http://127.0.0.1:9/ingestion/jobs";
  process.env.AI_VECTOR_DELETE_ENDPOINT = "http://127.0.0.1:9/vectors/files";
  process.env.AI_SERVICE_SHARED_SECRET = "test-shared-secret";
  process.env.AI_SERVICE_TIMEOUT_MS = "2000";
  process.env.MODEL_KEY_ENCRYPTION_KEY = "test-encryption-secret-0123456789";
  process.env.AUTH_SESSION_TTL_HOURS = "1";

  if (existsSync(testDbPath)) {
    rmSync(testDbPath);
  }
  rmSync(`${testDbPath}-journal`, { force: true });

  execSync("npx prisma db push --skip-generate", {
    cwd: BACKEND_ROOT,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  // 在 DATABASE_URL 就绪后再加载 Prisma client 与 app。
  const { app } = await import("../app");
  const { prisma } = await import("../lib/prisma");

  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("Failed to resolve test server port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    prisma,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.$disconnect();

      // Windows 下 SQLite 引擎释放句柄略有延迟，带重试地清理测试库。
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          rmSync(testDbPath, { force: true });
          rmSync(`${testDbPath}-journal`, { force: true });
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      console.warn(`warning: could not remove ${dbName} after all retries`);
    },
  };
}

/**
 * 注册并返回带 Authorization 头的请求配置。
 */
export async function registerUser(baseUrl: string, username: string, password = "pass1234") {
  const response = await fetch(`${baseUrl}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json() as { data?: { token: string; user: { id: string } } };
  if (!response.ok || !payload.data) {
    throw new Error(`register ${username} failed: HTTP ${response.status}`);
  }

  return {
    token: payload.data.token,
    userId: payload.data.user.id,
    authHeaders: { Authorization: `Bearer ${payload.data.token}` },
  };
}
