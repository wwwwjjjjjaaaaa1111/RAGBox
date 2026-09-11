import { randomBytes } from "node:crypto";
import { createApiError } from "../common/errors";
import { hashToken } from "../common/tokenHash";
import { prisma } from "../lib/prisma";
import type { AuthenticatedUser } from "./auth.service";

/** 令牌前缀：用于与会话 token 区分，让 requireAuth 不必查库即可分流。 */
export const PAT_TOKEN_PREFIX = "ragbox_pat_";

const DEFAULT_TTL_DAYS = 90;

/** lastUsedAt 写入节流：避免每个请求都产生一次写库。 */
const LAST_USED_THROTTLE_MS = 10 * 60 * 1000;

/** 可选权限集合。kb:read 为默认最小权限，其余需显式勾选。 */
export const PAT_SCOPES = ["kb:read", "chat:write", "charts:generate"] as const;
export type PatScope = (typeof PAT_SCOPES)[number];

const KNOWN_SCOPES = new Set<string>(PAT_SCOPES);

/** 列表展示用的脱敏结构；绝不包含 tokenHash 或明文。 */
export type PersonalAccessTokenSummary = {
  id: string;
  name: string;
  scopes: PatScope[];
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
};

/** 签发结果：明文 token 仅在此处返回一次。 */
export type CreatedPersonalAccessToken = PersonalAccessTokenSummary & {
  token: string;
};

/** 校验通过后的鉴权上下文。 */
export type PersonalAccessTokenAuth = {
  user: AuthenticatedUser;
  scopes: PatScope[];
};

const PAT_SELECT = {
  id: true,
  name: true,
  scopes: true,
  expiresAt: true,
  lastUsedAt: true,
  createdAt: true,
} as const;

type PatRecord = {
  id: string;
  name: string;
  scopes: string;
  expiresAt: Date;
  lastUsedAt: Date | null;
  createdAt: Date;
};

/**
 * 判断 token 是否为个人访问令牌（仅看前缀，不查库）。
 * @param value 待判断的 token。
 * @returns 是 PAT 时返回 true。
 */
export function isPersonalAccessToken(value: string): boolean {
  return value.startsWith(PAT_TOKEN_PREFIX);
}

/**
 * 读取默认有效期天数。在函数内惰性读取，便于测试通过环境变量覆盖。
 * @returns 有效天数。
 */
function getDefaultTtlDays(): number {
  const days = Number(process.env.PAT_DEFAULT_TTL_DAYS || DEFAULT_TTL_DAYS);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_TTL_DAYS;
}

function parseStoredScopes(raw: string): PatScope[] {
  return raw
    .split(/\s+/)
    .filter((item): item is PatScope => KNOWN_SCOPES.has(item));
}

function toSummary(record: PatRecord): PersonalAccessTokenSummary {
  return {
    id: record.id,
    name: record.name,
    scopes: parseStoredScopes(record.scopes),
    expiresAt: record.expiresAt.toISOString(),
    lastUsedAt: record.lastUsedAt ? record.lastUsedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * 校验并规范化调用方请求的 scope 列表（去重、拒绝未知值）。
 * @param input 请求的 scope 列表。
 * @returns 规范化后的 scope 列表。
 * @throws UNKNOWN_SCOPE 当包含未知 scope 时抛出。
 */
export function normalizeRequestedScopes(input: string[]): PatScope[] {
  const unknown = input.filter((item) => !KNOWN_SCOPES.has(item));
  if (unknown.length > 0) {
    throw createApiError(400, "UNKNOWN_SCOPE", `Unknown scope: ${unknown.join(", ")}`);
  }

  return [...new Set(input)] as PatScope[];
}

/**
 * 签发新的个人访问令牌。
 * @param payload 用户 ID、令牌名称、权限列表与可选有效期。
 * @returns 令牌摘要与明文 token（明文仅此一次返回）。
 */
export async function createPersonalAccessToken(payload: {
  userId: string;
  name: string;
  scopes: PatScope[];
  ttlDays?: number;
}): Promise<CreatedPersonalAccessToken> {
  const token = `${PAT_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
  const ttlDays = payload.ttlDays && payload.ttlDays > 0 ? payload.ttlDays : getDefaultTtlDays();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 3600_000);

  const record = await prisma.personalAccessToken.create({
    data: {
      userId: payload.userId,
      name: payload.name,
      tokenHash: hashToken(token),
      scopes: payload.scopes.join(" "),
      expiresAt,
    },
    select: PAT_SELECT,
  });

  return { ...toSummary(record), token };
}

/**
 * 列出某个用户的全部令牌（脱敏）。
 * @param userId 用户 ID。
 * @returns 按创建时间倒序的令牌摘要列表。
 */
export async function listPersonalAccessTokens(userId: string): Promise<PersonalAccessTokenSummary[]> {
  const records = await prisma.personalAccessToken.findMany({
    where: { userId },
    select: PAT_SELECT,
    orderBy: { createdAt: "desc" },
  });

  return records.map(toSummary);
}

/**
 * 吊销令牌。deleteMany 保证幂等且不会抛 P2025；同时天然限制在本人令牌范围内。
 * @param payload 用户 ID 与令牌 ID。
 * @returns 被吊销的令牌 ID。
 * @throws TOKEN_NOT_FOUND 当令牌不存在或不属于该用户时抛出。
 */
export async function revokePersonalAccessToken(payload: { userId: string; tokenId: string }): Promise<{ id: string }> {
  const result = await prisma.personalAccessToken.deleteMany({
    where: { id: payload.tokenId, userId: payload.userId },
  });

  if (result.count === 0) {
    throw createApiError(404, "TOKEN_NOT_FOUND", "Personal access token not found");
  }

  return { id: payload.tokenId };
}

async function touchLastUsedAt(tokenId: string, previous: Date | null): Promise<void> {
  const now = Date.now();
  if (previous && now - previous.getTime() < LAST_USED_THROTTLE_MS) {
    return;
  }

  await prisma.personalAccessToken.updateMany({
    where: { id: tokenId },
    data: { lastUsedAt: new Date(now) },
  });
}

/**
 * 校验个人访问令牌并返回鉴权上下文。
 * @param token 明文令牌。
 * @returns 用户与权限；无效或已过期时返回 null（过期令牌会被顺带清理）。
 */
export async function validatePersonalAccessToken(token: string): Promise<PersonalAccessTokenAuth | null> {
  const record = await prisma.personalAccessToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      scopes: true,
      expiresAt: true,
      lastUsedAt: true,
      user: { select: { id: true, username: true } },
    },
  });

  if (!record) {
    return null;
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    await prisma.personalAccessToken.deleteMany({ where: { id: record.id } });
    return null;
  }

  await touchLastUsedAt(record.id, record.lastUsedAt);

  return {
    user: { id: record.user.id, username: record.user.username },
    scopes: parseStoredScopes(record.scopes),
  };
}
