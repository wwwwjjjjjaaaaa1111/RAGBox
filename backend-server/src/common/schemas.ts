import { z } from "zod";

const md5HexSchema = z.string().regex(/^[a-fA-F0-9]{32}$/);

// Business routes read userId from the authenticated session injected by requireAuth.
export const authedIdentitySchema = z.object({
  userId: z.string().min(1),
});

export const registerBodySchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(32, "Username must be at most 32 characters")
    .regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, '_' and '-'"),
  password: z.string().min(6, "Password must be at least 6 characters").max(128),
});

export const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const uploadBodySchema = authedIdentitySchema;

export const filePrecheckBodySchema = z
  .object({
    userId: z.string().min(1),
    contentMd5: md5HexSchema,
  })
  .transform((data) => ({
    userId: data.userId,
    contentMd5: data.contentMd5.toLowerCase(),
  }));

export const chunkUploadInitBodySchema = z.object({
  uploadId: md5HexSchema,
  userId: z.string().min(1),
  fileName: z.string().min(1),
  fileSizeBytes: z.coerce.number().int().positive(),
  totalChunks: z.coerce.number().int().min(1),
});

export const chunkUploadBodySchema = z.object({
  uploadId: md5HexSchema,
  chunkIndex: z.coerce.number().int().min(0),
});

export const chunkUploadStatusQuerySchema = z.object({
  uploadId: md5HexSchema,
});

export const chunkUploadCompleteBodySchema = z.object({
  uploadId: md5HexSchema,
});

// Knowledge-file parse lifecycle exposed to the frontend.
const parseStatusEnum = z.enum(["pending", "processing", "failed", "indexed"]);

export const filesQuerySchema = z.object({
  parseStatus: parseStatusEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const taskParamsSchema = z.object({
  taskId: z.string().uuid(),
});

export const fileParamsSchema = z.object({
  fileId: z.string().uuid(),
});

export const fileDetailQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const createSessionBodySchema = z.object({
  userId: z.string().min(1),
  title: z.string().max(200).optional(),
  fileIds: z.array(z.string().uuid()).max(50).optional(),
});

export const sessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const sessionParamsSchema = z.object({
  id: z.string().uuid(),
});

export const updateSessionFilesBodySchema = z.object({
  fileIds: z.array(z.string().uuid()).max(50),
});

export const deleteSessionsBodySchema = z.object({
  userId: z.string().min(1),
  sessionIds: z.array(z.string().uuid()).min(1),
});

export const messageBodySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

export const chatCompletionBodySchema = z.object({
  content: z.string().min(1),
  userId: z.string().min(1),
});

export const messageListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// 模型设置：API Key 未传 = 保留原值（空串被拒绝）；其余字段未传或空串 = 保留原值（整体清空走 DELETE）。
const optionalUrlSchema = z.string().trim().max(500).optional();
const optionalModelSchema = z.string().trim().max(200).optional();
const optionalKeySchema = z.string().trim().min(1, "API Key cannot be empty; omit it to keep the current value").max(500).optional();

// 检索/入库调优参数：未传 = 保留原值；传入 null/空 = 也按保留处理（整体清空走 DELETE）。
const optionalChunkSize = z.coerce.number().int().min(200).max(4000).optional();
const optionalChunkOverlap = z.coerce.number().int().min(0).max(1000).optional();
const optionalTopK = z.coerce.number().int().min(1).max(20).optional();
const optionalThreshold = z.coerce.number().min(0).max(1).optional();

export const updateModelConfigBodySchema = z
  .object({
    chatBaseUrl: optionalUrlSchema,
    chatApiKey: optionalKeySchema,
    chatModel: optionalModelSchema,
    embeddingBaseUrl: optionalUrlSchema,
    embeddingApiKey: optionalKeySchema,
    embeddingModel: optionalModelSchema,
    chunkSize: optionalChunkSize,
    chunkOverlap: optionalChunkOverlap,
    retrievalTopK: optionalTopK,
    retrievalScoreThreshold: optionalThreshold,
  })
  .transform((data) => ({
    chatBaseUrl: data.chatBaseUrl || undefined,
    chatApiKey: data.chatApiKey,
    chatModel: data.chatModel || undefined,
    embeddingBaseUrl: data.embeddingBaseUrl || undefined,
    embeddingApiKey: data.embeddingApiKey,
    embeddingModel: data.embeddingModel || undefined,
    chunkSize: data.chunkSize,
    chunkOverlap: data.chunkOverlap,
    retrievalTopK: data.retrievalTopK,
    retrievalScoreThreshold: data.retrievalScoreThreshold,
  }));

const taskStatusEnum = z.enum(["queued", "running", "success", "failed", "cancelled"]);

// AI-server callbacks are authenticated by the shared secret, so userId stays in the payload.
export const ingestionChunkSyncBodySchema = z
  .object({
    taskId: z.string().uuid(),
    fileId: z.string().uuid(),
    userId: z.string().min(1),
    collectionName: z.string().min(1),
    parseVersion: z.coerce.number().int().min(1).default(1),
    chunks: z.array(z.object({
      chunkIndex: z.coerce.number().int().min(0),
      vectorId: z.string().min(1),
      chunkHash: z.string().min(1),
      contentPreview: z.string().min(1),
      pageNumber: z.coerce.number().int().min(0).nullable().optional(),
    })).default([]),
  })
  .transform((data) => ({
    taskId: data.taskId,
    fileId: data.fileId,
    userId: data.userId,
    collectionName: data.collectionName,
    parseVersion: data.parseVersion,
    chunks: data.chunks.map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      vectorId: chunk.vectorId,
      chunkHash: chunk.chunkHash,
      contentPreview: chunk.contentPreview,
      pageNumber: chunk.pageNumber ?? null,
    })),
  }));

export const ingestionCallbackBodySchema = z.object({
  taskId: z.string().uuid(),
  fileId: z.string().uuid().optional(),
  status: taskStatusEnum,
  progress: z.number().min(0).max(100).optional(),
  chunkCount: z.coerce.number().int().min(0).nullable().optional(),
  errorMessage: z.string().nullable().optional(),
});
