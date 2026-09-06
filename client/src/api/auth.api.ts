import { requestApi } from "./httpClient";
import type { AuthUser } from "../workservice/authStorage";

export type AuthSession = {
  token: string;
  expiresAt: string;
  user: AuthUser;
};

/**
 * 注册新用户并获取会话。
 * @param username 用户名。
 * @param password 密码。
 * @returns 会话 token 与用户信息。
 */
export async function registerUser(username: string, password: string): Promise<AuthSession> {
  return requestApi<AuthSession>("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

/**
 * 登录并获取会话。
 * @param username 用户名。
 * @param password 密码。
 * @returns 会话 token 与用户信息。
 */
export async function loginUser(username: string, password: string): Promise<AuthSession> {
  return requestApi<AuthSession>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

/**
 * 注销当前会话 token（服务端删除会话记录）。
 */
export async function logoutSession(): Promise<void> {
  await requestApi<{ success: boolean }>("/auth/logout", { method: "POST" });
}

/**
 * 读取当前登录用户信息（校验本地会话 token 是否仍然有效）。
 * @returns 用户公开信息。
 */
export async function fetchCurrentUser(): Promise<AuthUser> {
  return requestApi<AuthUser>("/auth/me");
}
