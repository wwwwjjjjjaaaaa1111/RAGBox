import { requestApi } from "./httpClient";

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
 * 读取当前用户的模型配置（API Key 仅返回脱敏形式）。
 * @returns 脱敏后的配置。
 */
export async function getModelConfig(): Promise<PublicModelConfig> {
  return requestApi<PublicModelConfig>("/model-config");
}

/**
 * 保存当前用户的模型配置；API Key 字段不传 = 保留原值，传入新值 = 覆盖。
 * @param input 更新内容。
 * @returns 脱敏后的最新配置。
 */
export async function updateModelConfig(input: UpdateModelConfigInput): Promise<PublicModelConfig> {
  return requestApi<PublicModelConfig>("/model-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * 清空当前用户的模型配置，回退到服务端默认。
 */
export async function resetModelConfig(): Promise<{ success: boolean }> {
  return requestApi<{ success: boolean }>("/model-config", { method: "DELETE" });
}
