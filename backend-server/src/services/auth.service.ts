import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createApiError } from "../common/errors";
import { prisma } from "../lib/prisma";

const SCRYPT_KEY_LENGTH = 64;
const DEFAULT_SESSION_TTL_HOURS = 72;

// 登录失败锁定：同一用户名连续失败 N 次后锁定一段时间（内存实现，进程重启即清零）。
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MINUTES = 15;

type LoginFailureRecord = { count: number; lockedUntil: number };
const loginFailures = new Map<string, LoginFailureRecord>();

function loginKey(username: string) {
  return username.trim().toLowerCase();
}

/**
 * 检查用户名是否处于登录锁定状态。
 * @param username 用户名。
 * @returns 剩余锁定秒数；未锁定返回 0。
 */
function getLockRemainingSeconds(username: string): number {
  const record = loginFailures.get(loginKey(username));
  if (!record?.lockedUntil) {
    return 0;
  }

  const remainingMs = record.lockedUntil - Date.now();
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

function recordLoginFailure(username: string) {
  const key = loginKey(username);
  const record = loginFailures.get(key) || { count: 0, lockedUntil: 0 };
  record.count += 1;

  if (record.count >= LOGIN_MAX_FAILURES) {
    record.lockedUntil = Date.now() + LOGIN_LOCK_MINUTES * 60_000;
    record.count = 0;
  }

  loginFailures.set(key, record);
}

export type AuthenticatedUser = {
  id: string;
  username: string;
};

export type AuthSessionPayload = {
  token: string;
  expiresAt: string;
  user: AuthenticatedUser;
};

function getSessionTtlHours() {
  const hours = Number(process.env.AUTH_SESSION_TTL_HOURS || DEFAULT_SESSION_TTL_HOURS);
  return Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SESSION_TTL_HOURS;
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, derived] = storedHash.split(":");
  if (!salt || !derived) {
    return false;
  }

  const expected = Buffer.from(derived, "hex");
  const actual = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function toPublicUser(user: { id: string; username: string }): AuthenticatedUser {
  return { id: user.id, username: user.username };
}

async function issueSession(userId: string): Promise<Pick<AuthSessionPayload, "token" | "expiresAt">> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + getSessionTtlHours() * 3600_000);

  await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
    },
  });

  return { token, expiresAt: expiresAt.toISOString() };
}

/**
 * 注册新用户并直接签发会话 token。
 * @param payload 用户名与明文密码。
 * @returns 会话 token 与用户公开信息。
 * @throws USERNAME_TAKEN 当用户名已被占用时抛出。
 */
export async function registerUser(payload: { username: string; password: string }): Promise<AuthSessionPayload> {
  const username = payload.username.trim();

  const existing = await prisma.appUser.findUnique({ where: { username } });
  if (existing) {
    throw createApiError(409, "USERNAME_TAKEN", "Username is already taken");
  }

  const user = await prisma.appUser.create({
    data: {
      username,
      passwordHash: hashPassword(payload.password),
    },
  });

  return { ...(await issueSession(user.id)), user: toPublicUser(user) };
}

/**
 * 校验用户名密码并签发会话 token。
 * 同一用户名连续失败达到上限会触发临时锁定（防止暴力破解）。
 * @param payload 用户名与明文密码。
 * @returns 会话 token 与用户公开信息。
 * @throws AUTH_LOCKED 当账号处于登录锁定状态时抛出。
 * @throws INVALID_CREDENTIALS 当用户名或密码错误时抛出。
 */
export async function loginUser(payload: { username: string; password: string }): Promise<AuthSessionPayload> {
  const username = payload.username.trim();

  const remainingSeconds = getLockRemainingSeconds(username);
  if (remainingSeconds > 0) {
    throw createApiError(
      429,
      "AUTH_LOCKED",
      `Too many failed attempts. Try again in ${Math.ceil(remainingSeconds / 60)} minute(s).`,
    );
  }

  const user = await prisma.appUser.findUnique({ where: { username } });
  if (!user || !verifyPassword(payload.password, user.passwordHash)) {
    recordLoginFailure(username);
    throw createApiError(401, "INVALID_CREDENTIALS", "Invalid username or password");
  }

  loginFailures.delete(loginKey(username));
  return { ...(await issueSession(user.id)), user: toPublicUser(user) };
}

/**
 * 校验会话 token 并返回归属用户。
 * @param token 客户端携带的会话 token。
 * @returns 用户公开信息；token 无效或过期时返回 null。
 */
export async function validateSessionToken(token: string): Promise<AuthenticatedUser | null> {
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: { expiresAt: true, user: { select: { id: true, username: true } } },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.authSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
    return null;
  }

  return toPublicUser(session.user);
}

/**
 * 注销会话 token。
 * @param token 客户端携带的会话 token。
 * @returns 无返回值。
 */
export async function revokeSessionToken(token: string) {
  await prisma.authSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}
