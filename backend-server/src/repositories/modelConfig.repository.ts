import { prisma } from "../lib/prisma";

export type UserModelConfigRecord = {
  userId: string;
  chatBaseUrl: string | null;
  chatApiKey: string | null;
  chatModel: string | null;
  embeddingBaseUrl: string | null;
  embeddingApiKey: string | null;
  embeddingModel: string | null;
  chunkSize: number | null;
  chunkOverlap: number | null;
  retrievalTopK: number | null;
  retrievalScoreThreshold: number | null;
};

type UpsertData = {
  chatBaseUrl?: string | null;
  chatApiKey?: string | null;
  chatModel?: string | null;
  embeddingBaseUrl?: string | null;
  embeddingApiKey?: string | null;
  embeddingModel?: string | null;
  chunkSize?: number | null;
  chunkOverlap?: number | null;
  retrievalTopK?: number | null;
  retrievalScoreThreshold?: number | null;
};

const MODEL_CONFIG_SELECT = {
  userId: true,
  chatBaseUrl: true,
  chatApiKey: true,
  chatModel: true,
  embeddingBaseUrl: true,
  embeddingApiKey: true,
  embeddingModel: true,
  chunkSize: true,
  chunkOverlap: true,
  retrievalTopK: true,
  retrievalScoreThreshold: true,
} as const;

/**
 * 查询用户级模型配置。
 * @param userId 用户 ID。
 * @returns 配置记录；未保存过时返回 null。
 */
export async function findModelConfigByUserId(userId: string): Promise<UserModelConfigRecord | null> {
  return prisma.userModelConfig.findUnique({
    where: { userId },
    select: MODEL_CONFIG_SELECT,
  });
}

/**
 * 创建或更新用户级模型配置（整体覆盖语义由 service 层决定字段值）。
 * @param userId 用户 ID。
 * @param data 待写入字段。
 * @returns 最新配置记录。
 */
export async function upsertModelConfig(userId: string, data: UpsertData): Promise<UserModelConfigRecord> {
  return prisma.userModelConfig.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
    select: MODEL_CONFIG_SELECT,
  });
}

/**
 * 删除用户级模型配置（恢复 .env 默认）。
 * @param userId 用户 ID。
 */
export async function deleteModelConfig(userId: string) {
  await prisma.userModelConfig.deleteMany({ where: { userId } });
}
