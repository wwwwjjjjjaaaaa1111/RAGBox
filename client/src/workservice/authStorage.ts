const TOKEN_KEY = "rag.auth.token";
const USER_KEY = "rag.auth.user";

export type AuthUser = {
  id: string;
  username: string;
};

/**
 * 读取当前会话 token。
 * @returns token；未登录时返回 null。
 */
export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * 读取当前登录用户信息。
 * @returns 用户对象；未登录或数据损坏时返回 null。
 */
export function getCurrentUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as AuthUser;
    return parsed && typeof parsed.id === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 获取当前用户 ID（供业务接口拼装参数使用）。
 * @returns 用户 ID；未登录时返回空字符串。
 */
export function getCurrentUserId(): string {
  return getCurrentUser()?.id || "";
}

/**
 * 持久化登录会话。
 * @param token 会话 token。
 * @param user 用户公开信息。
 */
export function setAuthSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * 清除本地会话数据（登出或 token 失效时调用）。
 */
export function clearAuthSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
