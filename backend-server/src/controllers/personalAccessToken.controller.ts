import type { NextFunction, Request, Response } from "express";
import { createTokenBodySchema, tokenParamsSchema } from "../common/schemas";
import { validate } from "../common/validation";
import { getAuthUserId } from "../middleware/auth";
import * as patService from "../services/personalAccessToken.service";

/**
 * 签发个人访问令牌。明文仅在本次响应中返回一次。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export async function createToken(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(createTokenBodySchema, req.body || {}, "request body");
    const scopes = patService.normalizeRequestedScopes(body.scopes);

    const created = await patService.createPersonalAccessToken({
      userId: getAuthUserId(req),
      name: body.name,
      scopes,
      ttlDays: body.ttlDays,
    });

    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
}

/**
 * 列出当前用户的全部令牌（脱敏，不含明文与哈希）。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export async function listTokens(req: Request, res: Response, next: NextFunction) {
  try {
    const tokens = await patService.listPersonalAccessTokens(getAuthUserId(req));
    res.json({ data: tokens });
  } catch (error) {
    next(error);
  }
}

/**
 * 吊销令牌（幂等语义之外返回 404，便于前端区分「已不存在」）。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export async function revokeToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { tokenId } = validate(tokenParamsSchema, req.params || {}, "path params");
    const result = await patService.revokePersonalAccessToken({
      userId: getAuthUserId(req),
      tokenId,
    });

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}
