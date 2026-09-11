import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import * as tokenController from "../controllers/personalAccessToken.controller";

const router = Router();

/**
 * 令牌管理接口。注意：requireAuth + requireSessionAuth 在 index.ts 挂载时统一加上，
 * 因为个人访问令牌不得访问这些接口（会造成权限提升）。
 */
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  await tokenController.createToken(req, res, next);
});

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  await tokenController.listTokens(req, res, next);
});

router.delete("/:tokenId", async (req: Request, res: Response, next: NextFunction) => {
  await tokenController.revokeToken(req, res, next);
});

export default router;
