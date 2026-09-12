import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { logger } from "../lib/logger";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const CIPHER_VERSION_PREFIX = "v1:";
const KEY_FILE_NAME = ".model-key";
const KEY_CACHE_SYMBOL = Symbol.for("rag.modelKeyCipher.masterKey");

type KeyCache = { [KEY_CACHE_SYMBOL]?: Buffer };
const globalCache = globalThis as typeof globalThis & KeyCache;

/**
 * 读取或派生用于加密模型密钥的主密钥（32 字节）。
 * 优先级：环境变量 MODEL_KEY_ENCRYPTION_KEY（任意 >=16 字符的口令，经 scrypt 派生）
 * > 首次自动生成并持久化到 backend-server/.model-key 的随机密钥文件。
 */
function getMasterKey(): Buffer {
  if (globalCache[KEY_CACHE_SYMBOL]) {
    return globalCache[KEY_CACHE_SYMBOL]!;
  }

  const envSecret = process.env.MODEL_KEY_ENCRYPTION_KEY?.trim();
  if (envSecret && envSecret.length >= 16) {
    const key = scryptSync(envSecret, "rag-model-key-cipher-salt", 32);
    globalCache[KEY_CACHE_SYMBOL] = key;
    return key;
  }

  const keyPath = path.resolve(process.cwd(), KEY_FILE_NAME);
  let hex: string;
  if (existsSync(keyPath)) {
    hex = readFileSync(keyPath, "utf8").trim();
  } else {
    hex = randomBytes(32).toString("hex");
    writeFileSync(keyPath, hex, { mode: 0o600 });
    logger.warn(
      `Generated a new model-key encryption key at ${keyPath}.`
      + " Keep this file (or set MODEL_KEY_ENCRYPTION_KEY) or previously saved API keys cannot be decrypted.",
    );
  }

  const key = Buffer.from(hex, "hex");
  globalCache[KEY_CACHE_SYMBOL] = key;
  return key;
}

/**
 * 加密明文密钥，输出 v1:<iv>:<authTag>:<ciphertext>。
 * @param plaintext 明文密钥。
 * @returns 加密串。
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${CIPHER_VERSION_PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * 解密数据库中的密钥。
 * 兼容历史明文：不以 v1: 开头的值按原样返回（下次保存时会自动转为加密存储）。
 * @param stored 数据库中存储的密钥值。
 * @returns 明文密钥。
 */
export function decryptSecret(stored: string | null): string | null {
  if (!stored) {
    return null;
  }

  if (!stored.startsWith(CIPHER_VERSION_PREFIX)) {
    return stored;
  }

  try {
    const [, ivHex, tagHex, dataHex] = stored.split(":");
    const decipher = createDecipheriv("aes-256-gcm", getMasterKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
  } catch {
    // 密钥文件丢失或数据损坏时返回 null，让上层表现为"未配置"而不是崩溃。
    logger.error("Failed to decrypt a stored model key; treat it as unset.");
    return null;
  }
}
