/**
 * MCP 服务运行时配置。
 *
 * 凭据来源有两处：MCP 客户端在配置里通过 env 传入（生产用法），
 * 或本包目录下的 .env（本地 `npm run dev` 调试）。显式用包目录解析，
 * 不依赖 cwd —— MCP 客户端启动进程时的 cwd 由客户端决定，不可控。
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(PACKAGE_ROOT, ".env");

/** token 前缀，与后端签发格式保持一致，用于给出更明确的报错。 */
export const TOKEN_PREFIX = "ragbox_pat_";

export type McpConfig = {
  /** RAGBox 后端 API 根地址（含 /v1）。 */
  apiUrl: string;
  /** 个人访问令牌。 */
  token: string;
  /** 单次普通请求超时（毫秒）。 */
  timeoutMs: number;
  /**
   * 流式对话超时（毫秒）。RAG 回答可能生成较久，
   * 用普通请求的超时会中途掐断流，因此单独给一个更宽的上限。
   */
  streamTimeoutMs: number;
};

const DEFAULT_API_URL = "http://127.0.0.1:3001/v1";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_STREAM_TIMEOUT_MS = 120000;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 读取并校验配置。缺少令牌时抛出可读错误（MCP 客户端会把它显示给用户）。
 * @returns 冻结后的配置对象。
 * @throws 当 RAGBOX_TOKEN 缺失或格式明显不对时抛出。
 */
export function loadConfig(): McpConfig {
  if (existsSync(ENV_FILE)) {
    dotenv.config({ path: ENV_FILE, quiet: true });
  }

  const token = (process.env.RAGBOX_TOKEN || "").trim();
  if (!token) {
    throw new Error(
      "缺少 RAGBOX_TOKEN。请在 RAGBox 网页「模型设置 → 外部接入」生成令牌，" +
        "并写入 MCP 客户端配置的 env 字段（或本包目录下的 .env）。",
    );
  }

  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new Error(
      `RAGBOX_TOKEN 格式不正确：应以 ${TOKEN_PREFIX} 开头。` +
        "注意不要误填网页登录用的会话 token。",
    );
  }

  const apiUrl = (process.env.RAGBOX_API_URL || DEFAULT_API_URL).trim().replace(/\/+$/, "");

  return {
    apiUrl,
    token,
    timeoutMs: readPositiveInt(process.env.RAGBOX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    streamTimeoutMs: readPositiveInt(process.env.RAGBOX_STREAM_TIMEOUT_MS, DEFAULT_STREAM_TIMEOUT_MS),
  };
}
