import { decryptSecret, encryptSecret } from "../common/secretCipher";
import * as modelConfigRepository from "../repositories/modelConfig.repository";
import type { AiModelConfigOverride } from "./ai.service";
import type { UserModelConfigRecord } from "../repositories/modelConfig.repository";

export type MaskedSecret = {
  configured: boolean;
  maskedKey: string | null;
};

export type PublicModelConfig = {
  chatBaseUrl: string | null;
  chatModel: string | null;
  embeddingBaseUrl: string | null;
  embeddingModel: string | null;
  chunkSize: number | null;
  chunkOverlap: number | null;
  retrievalTopK: number | null;
  retrievalScoreThreshold: number | null;
  chatApiKey: MaskedSecret;
  embeddingApiKey: MaskedSecret;
};

/**
 * 将密钥脱敏为「尾 4 位」展示形式，杜绝任何明文回传。
 * @param key 数据库中的明文密钥。
 * @returns configured + maskedKey 形式。
 */
function maskSecret(key: string | null): MaskedSecret {
  if (!key) {
    return { configured: false, maskedKey: null };
  }

  const tail = key.slice(-4);
  return { configured: true, maskedKey: `****${tail}` };
}

function toPublicModelConfig(record: UserModelConfigRecord): PublicModelConfig {
  // DB 中密钥为加密存储，脱敏展示前先解密（只取尾 4 位）。
  return {
    chatBaseUrl: record.chatBaseUrl,
    chatModel: record.chatModel,
    embeddingBaseUrl: record.embeddingBaseUrl,
    embeddingModel: record.embeddingModel,
    chunkSize: record.chunkSize,
    chunkOverlap: record.chunkOverlap,
    retrievalTopK: record.retrievalTopK,
    retrievalScoreThreshold: record.retrievalScoreThreshold,
    chatApiKey: maskSecret(decryptSecret(record.chatApiKey)),
    embeddingApiKey: maskSecret(decryptSecret(record.embeddingApiKey)),
  };
}

/**
 * 查询用户级模型配置（密钥脱敏）。
 * @param userId 用户 ID。
 * @returns 脱敏后的配置。
 */
export async function getModelConfig(userId: string): Promise<PublicModelConfig> {
  const record = await modelConfigRepository.findModelConfigByUserId(userId);
  if (!record) {
    return {
      chatBaseUrl: null,
      chatModel: null,
      embeddingBaseUrl: null,
      embeddingModel: null,
      chunkSize: null,
      chunkOverlap: null,
      retrievalTopK: null,
      retrievalScoreThreshold: null,
      chatApiKey: { configured: false, maskedKey: null },
      embeddingApiKey: { configured: false, maskedKey: null },
    };
  }

  return toPublicModelConfig(record);
}

/**
 * 查询用户的明文模型凭据，供转发 AI-server 使用（仅内部调用，不对外暴露）。
 * 数据库中密钥为加密存储，这里解密后返回。
 * @param userId 用户 ID。
 * @returns 明文配置记录或 null。
 */
export async function getInternalModelConfig(userId: string) {
  const record = await modelConfigRepository.findModelConfigByUserId(userId);
  if (!record) {
    return null;
  }

  return {
    ...record,
    chatApiKey: decryptSecret(record.chatApiKey),
    embeddingApiKey: decryptSecret(record.embeddingApiKey),
  };
}

/**
 * 组装转发给 AI-server 的用户级模型凭据覆盖；未保存过配置时返回 undefined。
 * 聊天与检索两条链路共用，避免各自复制一份字段映射。
 * @param userId 用户 ID。
 * @returns modelConfig 覆盖对象或 undefined。
 */
export async function getModelConfigOverride(
  userId: string,
): Promise<AiModelConfigOverride | undefined> {
  const config = await getInternalModelConfig(userId);
  if (!config) {
    return undefined;
  }

  return {
    chatBaseUrl: config.chatBaseUrl,
    chatApiKey: config.chatApiKey,
    chatModel: config.chatModel,
    embeddingBaseUrl: config.embeddingBaseUrl,
    embeddingApiKey: config.embeddingApiKey,
    embeddingModel: config.embeddingModel,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    retrievalTopK: config.retrievalTopK,
    retrievalScoreThreshold: config.retrievalScoreThreshold,
  };
}

export type UpdateModelConfigInput = {
  chatBaseUrl?: string;
  chatApiKey?: string;
  chatModel?: string;
  embeddingBaseUrl?: string;
  embeddingApiKey?: string;
  embeddingModel?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  retrievalTopK?: number;
  retrievalScoreThreshold?: number;
};

/**
 * 更新用户级模型配置。
 * API Key 字段语义：请求中缺省 = 保留原值；非空字符串 = 覆盖。空串在 schema 层被拒绝。
 * API Key 在落库前统一加密存储（AES-256-GCM，主密钥来自 MODEL_KEY_ENCRYPTION_KEY 或自动生成的 .model-key）。
 * @param userId 用户 ID。
 * @param input 更新输入。
 * @returns 脱敏后的最新配置。
 */
export async function updateModelConfig(userId: string, input: UpdateModelConfigInput): Promise<PublicModelConfig> {
  const existing = await getInternalModelConfig(userId);

  const chatApiKey = input.chatApiKey ?? existing?.chatApiKey ?? null;
  const embeddingApiKey = input.embeddingApiKey ?? existing?.embeddingApiKey ?? null;

  const data = {
    chatBaseUrl: input.chatBaseUrl ?? existing?.chatBaseUrl ?? null,
    chatApiKey: chatApiKey ? encryptSecret(chatApiKey) : null,
    chatModel: input.chatModel ?? existing?.chatModel ?? null,
    embeddingBaseUrl: input.embeddingBaseUrl ?? existing?.embeddingBaseUrl ?? null,
    embeddingApiKey: embeddingApiKey ? encryptSecret(embeddingApiKey) : null,
    embeddingModel: input.embeddingModel ?? existing?.embeddingModel ?? null,
    chunkSize: input.chunkSize ?? existing?.chunkSize ?? null,
    chunkOverlap: input.chunkOverlap ?? existing?.chunkOverlap ?? null,
    retrievalTopK: input.retrievalTopK ?? existing?.retrievalTopK ?? null,
    retrievalScoreThreshold: input.retrievalScoreThreshold ?? existing?.retrievalScoreThreshold ?? null,
  };

  const record = await modelConfigRepository.upsertModelConfig(userId, data);
  return toPublicModelConfig(record);
}

/**
 * 清空用户级模型配置，回退到 .env 默认。
 * @param userId 用户 ID。
 */
export async function resetModelConfig(userId: string) {
  await modelConfigRepository.deleteModelConfig(userId);
  return { success: true };
}
