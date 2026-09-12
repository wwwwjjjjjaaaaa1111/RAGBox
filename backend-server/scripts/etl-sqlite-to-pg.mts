/**
 * 一次性 ETL：SQLite（dev.db）→ PostgreSQL。
 *
 * 运行前提：
 * 1. schema.prisma 已切换到 postgresql 且基线迁移已应用（prisma migrate dev）；
 * 2. 目标库为空——脚本开头逐表检查，任一表非空即中止，避免重复导入；
 * 3. 本脚本不加载 dotenv（避免读到 .env 后误连）：目标连接串从命令行参数或
 *    ETL_DATABASE_URL 取，源文件路径固定为 prisma/dev.db。
 *
 * 用法：npx tsx scripts/etl-sqlite-to-pg.mts [postgres连接串]
 *
 * 注意：向量数据不在迁移范围（ai_chroma 由 Qdrant 替代，文件需重新入库）；
 * file_chunks 行必须完整迁移——它是删除向量时 vectorId 的唯一来源。
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Counters = Record<string, number>;

const TABLES = [
  "app_users",
  "user_model_configs",
  "auth_sessions",
  "personal_access_tokens",
  "knowledge_files",
  "ingestion_tasks",
  "file_chunks",
  "chat_sessions",
  "chat_messages",
] as const;

/** SQLite 时间列在 Prisma/SQLite 下存的是 epoch 毫秒整数，转 Date 供 PG 使用。 */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  const ms = Number(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`非法时间值: ${String(value)}`);
  }
  return new Date(ms);
}

async function main() {
  const dsn = process.argv[2] || process.env.ETL_DATABASE_URL;
  if (!dsn) {
    throw new Error("缺少 PostgreSQL 连接串：作为第一个参数传入，或设置 ETL_DATABASE_URL");
  }

  const sqlitePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../prisma/dev.db");
  const source = new DatabaseSync(sqlitePath, { readOnly: true });

  // 目标库必须为空：本脚本不做 upsert，重复运行会造成主键冲突或数据翻倍。
  const existingUsers = await prisma.appUser.count();
  if (existingUsers > 0) {
    throw new Error(`目标库非空（app_users 已有 ${existingUsers} 行），拒绝执行。如需重来请先清库。`);
  }

  const counts: Counters = {};

  // ---- 读取全部源数据（先取完再写，数据量 1.7MB 级，可整体载入内存）----
  const rows = {} as Record<(typeof TABLES)[number], Record<string, unknown>[]>;
  for (const table of TABLES) {
    rows[table] = source.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
  }

  // ---- 按外键依赖顺序写入 ----
  for (const r of rows.app_users) {
    await prisma.appUser.create({
      data: {
        id: String(r.id),
        username: String(r.username),
        passwordHash: String(r.password_hash),
        createdAt: toDate(r.created_at)!,
      },
    });
  }
  counts.app_users = rows.app_users.length;

  for (const r of rows.user_model_configs) {
    await prisma.userModelConfig.create({
      data: {
        id: String(r.id),
        userId: String(r.user_id),
        chatBaseUrl: nullable(r.chat_base_url),
        chatApiKey: nullable(r.chat_api_key),
        chatModel: nullable(r.chat_model),
        embeddingBaseUrl: nullable(r.embedding_base_url),
        embeddingApiKey: nullable(r.embedding_api_key),
        embeddingModel: nullable(r.embedding_model),
        chunkSize: nullableNumber(r.chunk_size),
        chunkOverlap: nullableNumber(r.chunk_overlap),
        retrievalTopK: nullableNumber(r.retrieval_top_k),
        retrievalScoreThreshold: nullableNumber(r.retrieval_score_threshold),
        createdAt: toDate(r.created_at)!,
        updatedAt: toDate(r.updated_at)!,
      },
    });
  }
  counts.user_model_configs = rows.user_model_configs.length;

  for (const r of rows.auth_sessions) {
    await prisma.authSession.create({
      data: {
        id: String(r.id),
        userId: String(r.user_id),
        tokenHash: String(r.token_hash),
        expiresAt: toDate(r.expires_at)!,
        createdAt: toDate(r.created_at)!,
      },
    });
  }
  counts.auth_sessions = rows.auth_sessions.length;

  for (const r of rows.personal_access_tokens) {
    await prisma.personalAccessToken.create({
      data: {
        id: String(r.id),
        userId: String(r.user_id),
        name: String(r.name),
        tokenHash: String(r.token_hash),
        scopes: String(r.scopes),
        expiresAt: toDate(r.expires_at)!,
        lastUsedAt: toDate(r.last_used_at),
        createdAt: toDate(r.created_at)!,
      },
    });
  }
  counts.personal_access_tokens = rows.personal_access_tokens.length;

  for (const r of rows.knowledge_files) {
    await prisma.knowledgeFile.create({
      data: {
        id: String(r.id),
        userId: String(r.user_id),
        fileName: String(r.file_name),
        contentMd5: nullable(r.content_md5),
        fileSizeBytes: Number(r.file_size_bytes),
        storagePath: String(r.storage_path),
        parseStatus: String(r.parse_status) as "pending" | "processing" | "failed" | "indexed",
        parseVersion: Number(r.parse_version),
        chunkCount: Number(r.chunk_count),
        indexedAt: toDate(r.indexed_at),
        uploadedAt: toDate(r.uploaded_at)!,
      },
    });
  }
  counts.knowledge_files = rows.knowledge_files.length;

  for (const r of rows.ingestion_tasks) {
    await prisma.ingestionTask.create({
      data: {
        id: String(r.id),
        userId: String(r.user_id),
        fileId: String(r.file_id),
        status: String(r.status) as "queued" | "running" | "success" | "failed" | "cancelled",
        progress: Number(r.progress),
        errorMessage: nullable(r.error_message),
        createdAt: toDate(r.created_at)!,
        updatedAt: toDate(r.updated_at)!,
      },
    });
  }
  counts.ingestion_tasks = rows.ingestion_tasks.length;

  for (const r of rows.file_chunks) {
    await prisma.fileChunk.create({
      data: {
        id: String(r.id),
        fileId: String(r.file_id),
        chunkIndex: Number(r.chunk_index),
        vectorId: String(r.vector_id),
        collectionName: String(r.collection_name),
        chunkHash: String(r.chunk_hash),
        contentPreview: String(r.content_preview),
        pageNumber: nullableNumber(r.page_number),
        createdAt: toDate(r.created_at)!,
      },
    });
  }
  counts.file_chunks = rows.file_chunks.length;

  for (const r of rows.chat_sessions) {
    await prisma.chatSession.create({
      data: {
        id: String(r.id),
        userId: String(r.user_id),
        title: nullable(r.title),
        fileIdsJson: nullable(r.file_ids_json),
        createdAt: toDate(r.created_at)!,
      },
    });
  }
  counts.chat_sessions = rows.chat_sessions.length;

  for (const r of rows.chat_messages) {
    await prisma.chatMessage.create({
      data: {
        id: String(r.id),
        sessionId: String(r.session_id),
        role: String(r.role) as "user" | "assistant",
        content: String(r.content),
        sourcesJson: nullable(r.sources_json),
        chartsJson: nullable(r.charts_json),
        createdAt: toDate(r.created_at)!,
      },
    });
  }
  counts.chat_messages = rows.chat_messages.length;

  // ---- 对账 ----
  console.log("=== ETL 对账（源 → 目标）===");
  let allMatch = true;
  for (const table of TABLES) {
    const target = await prisma.$queryRawUnsafe<{ count: bigint }>(
      `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
    );
    const targetCount = Number(target[0].count);
    const match = targetCount === counts[table];
    allMatch = allMatch && match;
    console.log(`  ${table}: ${counts[table]} → ${targetCount} ${match ? "OK" : "MISMATCH"}`);
  }
  console.log(allMatch ? "全部一致 ✓" : "存在不一致，请检查！");

  source.close();
}

function nullable(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

main()
  .catch((error: unknown) => {
    console.error("ETL 失败:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
