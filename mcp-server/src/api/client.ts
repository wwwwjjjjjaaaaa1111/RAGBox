/**
 * RAGBox 后端 API 客户端。
 *
 * 只负责 HTTP 与错误转译；错误信息要面向最终用户（他们会直接看到 MCP 工具的报错），
 * 因此 401/403/404 都翻译成「该怎么做」而不是裸状态码。
 */

import type { McpConfig } from "../config.js";

export class RagboxApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "RagboxApiError";
    this.status = status;
    this.code = code;
  }
}

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string };
};

export type RagboxApiClient = {
  /** 发起请求并解开后端的 { data, error } 信封。 */
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  /** 发起请求并返回原始 Response（用于 SSE 流）。 */
  stream: (path: string, init?: RequestInit) => Promise<Response>;
  /** 取回二进制内容并转为 base64（用于把图表 PNG 内联进 MCP 响应）。 */
  requestBase64: (path: string) => Promise<{ base64: string; mimeType: string }>;
  apiUrl: string;
};

function describeHttpError(status: number, code: string | null, message: string | null): string {
  if (status === 401) {
    return "RAGBox 鉴权失败：令牌无效或已过期。请在 RAGBox 网页「模型设置 → 外部接入」重新生成，并更新 MCP 配置里的 RAGBOX_TOKEN。";
  }

  if (status === 403 && code === "INSUFFICIENT_SCOPE") {
    return `RAGBox 拒绝了本次调用：${message || "当前令牌权限不足。"}请在网页「外部接入」为该令牌补上对应权限。`;
  }

  if (status === 403 && code === "SESSION_REQUIRED") {
    return "该操作只允许在 RAGBox 网页中以登录会话执行，个人访问令牌不能调用。";
  }

  if (status === 404) {
    return message || "目标资源不存在（可能已被删除，或图表已过期）。";
  }

  if (status === 503) {
    return `RAGBox 后端尚未配置完成：${message || "请检查向量模型等设置。"}`;
  }

  return message || `RAGBox 后端返回 HTTP ${status}。`;
}

/**
 * 创建绑定到该配置的 API 客户端。
 * @param config 运行时配置（后端地址、令牌、超时）。
 * @returns 客户端实例。
 */
export function createApiClient(config: McpConfig): RagboxApiClient {
  async function send(path: string, init?: RequestInit, timeoutMs = config.timeoutMs): Promise<Response> {
    const url = `${config.apiUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/json",
          ...(init?.headers || {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new RagboxApiError(
          `请求 RAGBox 后端超时（${timeoutMs} ms）：${url}`,
          504,
        );
      }

      throw new RagboxApiError(
        `无法连接 RAGBox 后端（${config.apiUrl}）。请确认 backend-server 已启动，且 RAGBOX_API_URL 配置正确。`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function readError(response: Response): Promise<RagboxApiError> {
    let code: string | null = null;
    let message: string | null = null;

    try {
      const payload = (await response.json()) as ApiEnvelope<unknown>;
      code = payload.error?.code ?? null;
      message = payload.error?.message ?? null;
    } catch {
      // 非 JSON 响应（如反代错误页）：保持 code/message 为 null。
    }

    return new RagboxApiError(describeHttpError(response.status, code, message), response.status, code);
  }

  return {
    apiUrl: config.apiUrl,

    async request<T>(path: string, init?: RequestInit): Promise<T> {
      const response = await send(path, init);

      if (!response.ok) {
        throw await readError(response);
      }

      const payload = (await response.json()) as ApiEnvelope<T>;
      if (payload.data === undefined) {
        throw new RagboxApiError("RAGBox 返回了非预期的响应结构（缺少 data 字段）。", response.status);
      }

      return payload.data;
    },

    async stream(path: string, init?: RequestInit): Promise<Response> {
      const response = await send(
        path,
        {
          ...init,
          headers: { Accept: "text/event-stream", ...(init?.headers || {}) },
        },
        config.streamTimeoutMs,
      );

      if (!response.ok || !response.body) {
        throw await readError(response);
      }

      return response;
    },

    async requestBase64(path: string): Promise<{ base64: string; mimeType: string }> {
      const response = await send(path, { headers: { Accept: "image/png" } });

      if (!response.ok) {
        throw await readError(response);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        base64: buffer.toString("base64"),
        mimeType: response.headers.get("content-type") || "application/octet-stream",
      };
    },
  };
}
