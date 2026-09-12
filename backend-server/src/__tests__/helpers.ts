import { execSync } from "node:child_process";
import path from "node:path";
import type { Server } from "node:http";

import { PrismaClient } from "@prisma/client";

const BACKEND_ROOT = path.resolve(__dirname, "../..");

export type TestContext = {
  baseUrl: string;
  prisma: typeof import("../lib/prisma").prisma;
  close: () => Promise<void>;
};

/**
 * 测试数据库的基础连接串（管理通道，用于建库/删库）。
 * 通过 TEST_DATABASE_URL 覆盖；默认指向 compose 启动的本地 postgres。
 */
const ADMIN_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgresql://ragbox:ragbox-dev-password@127.0.0.1:5432/postgres";

/**
 * 从管理连接串推导出套件专属库的连接串。
 * 例如 .../postgres → .../ragbox_test_auth
 */
function buildSuiteDatabaseUrl(suiteName: string): { adminUrl: string; suiteUrl: string; dbName: string } {
  const url = new URL(ADMIN_DATABASE_URL);
  const dbName = `ragbox_test_${suiteName}`;
  url.pathname = `/${dbName}`;
  return {
    adminUrl: ADMIN_DATABASE_URL,
    suiteUrl: url.toString(),
    dbName,
  };
}

async function createPrismaAdmin(url: string) {
  const admin = new PrismaClient({ datasources: { db: { url } } });
  await admin.$connect();
  return admin;
}

/**
 * 搭建隔离的测试环境：
 * - 每个测试套件一个独立 PostgreSQL 数据库（node --test 每文件独立进程，互不干扰）
 * - AI 服务指向必然快速失败的地址（验证派发失败路径）
 * - 固定加密密钥（避免测试生成 .model-key 文件）
 * - app 监听临时端口
 * 前置条件：TEST_DATABASE_URL（或默认本机 compose postgres）可达。
 */
export async function setupTestApp(suiteName: string): Promise<TestContext> {
  const { adminUrl, suiteUrl, dbName } = buildSuiteDatabaseUrl(suiteName);

  process.env.DATABASE_URL = suiteUrl;
  process.env.AI_SERVICE_BASE_URL = "http://127.0.0.1:9";
  process.env.AI_INGESTION_ENDPOINT = "http://127.0.0.1:9/ingestion/jobs";
  process.env.AI_VECTOR_DELETE_ENDPOINT = "http://127.0.0.1:9/vectors/files";
  process.env.AI_SERVICE_SHARED_SECRET = "test-shared-secret";
  process.env.AI_SERVICE_TIMEOUT_MS = "2000";
  process.env.MODEL_KEY_ENCRYPTION_KEY = "test-encryption-secret-0123456789";
  process.env.AUTH_SESSION_TTL_HOURS = "1";

  // 确保套件库存在：先连管理库建库（存在则跳过），再对套件库同步 schema。
  const admin = await createPrismaAdmin(adminUrl);
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } catch (error) {
    // 42P10 之外：已存在（42P04）属预期；其余错误直接抛出，避免掩盖连接问题。
    const code = (error as { code?: string; meta?: { code?: string } });
    const pgCode = code.meta?.code || code.code;
    if (pgCode !== "42P04") {
      await admin.$disconnect();
      throw new Error(
        `无法创建测试数据库 ${dbName}（PG 错误码 ${pgCode ?? "unknown"}）。` +
          "请确认 postgres 已启动且 TEST_DATABASE_URL 正确。",
      );
    }
  }
  await admin.$disconnect();

  execSync("npx prisma db push --skip-generate", {
    cwd: BACKEND_ROOT,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: suiteUrl },
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

      // 删除套件库：WITH (FORCE) 会踢掉残留连接（PG 13+），无需重试循环。
      const cleaner = await createPrismaAdmin(adminUrl);
      try {
        await cleaner.$executeRawUnsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
      } catch (error) {
        console.warn(`warning: could not drop ${dbName}:`, error instanceof Error ? error.message : error);
      } finally {
        await cleaner.$disconnect();
      }
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
