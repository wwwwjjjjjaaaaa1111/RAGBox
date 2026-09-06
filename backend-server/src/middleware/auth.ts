import type { NextFunction, Request, RequestHandler, Response } from "express";
import { sendApiError } from "../common/errors";
import * as authService from "../services/auth.service";

export type AuthenticatedUser = {
  id: string;
  username: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
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

    const user = await authService.validateSessionToken(token);
    if (!user) {
      sendApiError(res, 401, "INVALID_SESSION", "Invalid or expired session token");
      return;
    }

    req.authUser = user;
    injectAuthenticatedIdentity(req, user.id);
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * 读取当前请求的认证用户 ID，供控制器安全取用。
 * @param req Express 请求对象。
 * @returns 认证用户 ID；未经过 requireAuth 时返回空字符串。
 */
export function getAuthUserId(req: Request) {
  return req.authUser?.id || "";
}
