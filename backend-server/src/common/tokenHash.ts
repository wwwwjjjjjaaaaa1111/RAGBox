import { createHash } from "node:crypto";

/**
 * 计算 token 的存储哈希。
 *
 * 会话 token 与个人访问令牌共用同一策略（无盐 sha256）。无盐是有意为之：
 * token 本身是 32 字节随机值、熵足够，且需要靠唯一索引做 O(1) 查表，
 * 不能用逐条 scrypt 校验。
 *
 * @param token 明文 token。
 * @returns 十六进制哈希。
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
