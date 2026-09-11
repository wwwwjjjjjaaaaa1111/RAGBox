import type { NextFunction, Request, RequestHandler, Response } from "express";
import { sendApiError } from "../common/errors";
import * as authService from "../services/auth.service";
import * as personalAccessTokenService from "../services/personalAccessToken.service";
import type { PatScope } from "../services/personalAccessToken.service";

export type AuthenticatedUser = {
  id: string;
  username: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
      /**
       * 当前凭据的权限集合。
       * null 表示会话 token（账号全量权限）；数组表示个人访问令牌的受限权限。
       * requireAuth 必定会赋值。
       */
      authScopes?: PatScope[] | null;
    }
  }
}

function extractSessionToken(req: Request) {
  const header = req.header("authorization") || "";
  if (header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }

  // EventSource cannot set custom headers, so SSE clients pass the token in the query string.
  const queryToken = req.query?.token;
  return typeof queryToken === "string" ? queryToken.trim() : "";
}

function injectAuthenticatedIdentity(req: Request, userId: string) {
  // Business POST bodies read userId from the body; overwrite whatever the client
  // sent so identity always comes from the authenticated session.
  if (req.body && typeof req.body === "object") {
    (req.body as Record<string, unknown>).userId = userId;
  } else {
    req.body = { userId };
  }
}

/**
 * 校验 Bearer token（或 query token）并将认证身份注入请求。
 * 支持两种凭据：网页会话 token，以及供 MCP 等外部客户端使用的个人访问令牌。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const token = extractSessionToken(req);
    if (!token) {
      sendApiError(res, 401, "UNAUTHENTICATED", "Authentication required");
      return;
    }

    if (personalAccessTokenService.isPersonalAccessToken(token)) {
      const auth = await personalAccessTokenService.validatePersonalAccessToken(token);
      if (!auth) {
        sendApiError(res, 401, "INVALID_TOKEN", "Invalid or expired personal access token");
        return;
      }

      req.authUser = auth.user;
      req.authScopes = auth.scopes;
      injectAuthenticatedIdentity(req, auth.user.id);
      next();
      return;
    }

    const user = await authService.validateSessionToken(token);
    if (!user) {
      sendApiError(res, 401, "INVALID_SESSION", "Invalid or expired session token");
      return;
    }

    req.authUser = user;
    // 会话 token 代表账号本身，不受 scope 限制。
    req.authScopes = null;
    injectAuthenticatedIdentity(req, user.id);
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * 要求当前凭据具备指定权限。会话 token 视为具备全部权限。
 * 必须挂在 requireAuth 之后。
 * @param scope 需要的权限。
 * @returns Express 中间件。
 */
export function requireScope(scope: PatScope): RequestHandler {
  return (req, res, next) => {
    const scopes = req.authScopes;

    if (scopes === null || scopes === undefined || scopes.includes(scope)) {
      next();
      return;
    }

    sendApiError(
      res,
      403,
      "INSUFFICIENT_SCOPE",
      `This credential is missing the required scope: ${scope}`,
    );
  };
}

/**
 * 仅允许网页会话 token 访问，个人访问令牌一律拒绝。
 * 用于令牌管理等会造成权限提升的接口：PAT 若能签发新令牌，
 * 就等于绕过了自身的 scope 限制（例如持 kb:read 的令牌自造一个 chat:write）。
 * 必须挂在 requireAuth 之后。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export const requireSessionAuth: RequestHandler = (req, res, next) => {
  if (!req.authUser || req.authScopes !== null) {
    sendApiError(
      res,
      403,
      "SESSION_REQUIRED",
      "This endpoint requires a web session; personal access tokens cannot be used here",
    );
    return;
  }

  next();
};

/**
 * 读取当前请求的认证用户 ID，供控制器安全取用。
 * @param req Express 请求对象。
 * @returns 认证用户 ID；未经过 requireAuth 时返回空字符串。
 */
export function getAuthUserId(req: Request) {
  return req.authUser?.id || "";
}

/**
 * 读取当前请求的权限集合。
 * @param req Express 请求对象。
 * @returns 会话 token 返回 null（全量权限）；PAT 返回其 scope 列表。
 */
export function getAuthScopes(req: Request): PatScope[] | null {
  return req.authScopes ?? null;
}
