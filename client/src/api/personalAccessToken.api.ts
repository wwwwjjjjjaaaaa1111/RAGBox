import { requestApi } from "./httpClient";

/** 与后端 scope 定义保持一致。 */
export type AccessTokenScope = "kb:read" | "chat:write" | "charts:generate";

export type AccessTokenSummary = {
  id: string;
  name: string;
  scopes: AccessTokenScope[];
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
};

/** 签发结果：token 明文只在此结构中出现一次。 */
export type CreatedAccessToken = AccessTokenSummary & {
  token: string;
};

/**
 * 列出当前用户的个人访问令牌（脱敏）。
 * @returns 令牌摘要列表，按创建时间倒序。
 */
export async function listAccessTokens(): Promise<AccessTokenSummary[]> {
  return requestApi<AccessTokenSummary[]>("/tokens");
}

/**
 * 签发新的个人访问令牌。返回的 token 明文仅此一次可见，需立即保存。
 * @param input 令牌名称、权限列表与可选有效期。
 * @returns 令牌摘要与明文。
 */
export async function createAccessToken(input: {
  name: string;
  scopes: AccessTokenScope[];
  ttlDays?: number;
}): Promise<CreatedAccessToken> {
  return requestApi<CreatedAccessToken>("/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * 吊销指定令牌。
 * @param tokenId 令牌 ID。
 * @returns 被吊销的令牌 ID。
 */
export async function revokeAccessToken(tokenId: string): Promise<{ id: string }> {
  return requestApi<{ id: string }>(`/tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" });
}
