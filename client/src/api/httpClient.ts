/*
 * @Editor: zhanghang
 * @Description: 
 * @Date: 2026-03-31 14:16:35
 * @LastEditors: zhanghang
 * @LastEditTime: 2026-03-31 14:16:41
 */
import * as authStorage from "../workservice/authStorage";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001/v1";

export function createApiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

type ApiEnvelope<T> = {
  data?: T;
  error?: {
    code?: string;
    message?: string;
  };
};

export const AUTH_EXPIRED_EVENT = "rag.auth.expired";

function notifyAuthExpired() {
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

/**
 * 合并请求头：当本地存在会话 token 时自动附带 Authorization。
 * @param init 原始请求配置。
 * @returns 注入 token 后的请求配置，并标记是否携带过 token。
 */
function mergeAuthHeaders(init?: RequestInit) {
  const token = authStorage.getAuthToken();
  const headers = new Headers(init?.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return {
    ...init,
    headers,
    hadAuthToken: Boolean(token),
  };
}

/**
 * 统一封装前端 API 请求，并解析后端标准 data/error 包装结构。
 * 请求会自动携带已登录会话的 Bearer token；会话失效时清除本地凭证并广播事件。
 * @param path 接口路径（以 / 开头）。
 * @param init fetch 请求配置。
 * @returns 业务数据对象。
 * @throws 当 HTTP 状态非 2xx 或返回结构不合法时抛出 Error。
 */
export async function requestApi<T>(path: string, init?: RequestInit): Promise<T> {
  const request = mergeAuthHeaders(init);
  const response = await fetch(createApiUrl(path), request);
  const payload = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok) {
    if (response.status === 401 && request.hadAuthToken) {
      // Token expired or revoked: drop local session so the router can bounce to login.
      authStorage.clearAuthSession();
      notifyAuthExpired();
    }
    throw new Error(payload.error?.message || `HTTP ${response.status}`);
  }

  if (!payload.data) {
    throw new Error("接口返回结构异常");
  }

  return payload.data;
}
