import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { loginBodySchema, registerBodySchema } from "../common/schemas";
import { validate } from "../common/validation";
import { requireAuth } from "../middleware/auth";
import * as authService from "../services/auth.service";

const router = Router();

/**
 * 注册新用户并返回会话 token。
 */
router.post("/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = validate(registerBodySchema, req.body || {}, "request body");
    const session = await authService.registerUser(payload);
    res.status(201).json({ data: session });
  } catch (error) {
    next(error);
  }
});

/**
 * 校验用户名密码并返回会话 token。
 */
router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = validate(loginBodySchema, req.body || {}, "request body");
    const session = await authService.loginUser(payload);
    res.json({ data: session });
  } catch (error) {
    next(error);
  }
});

/**
 * 返回当前认证用户信息。
 */
router.get("/me", requireAuth, (req: Request, res: Response) => {
  res.json({ data: req.authUser });
});

/**
 * 注销当前会话 token。
 */
router.post("/logout", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const header = req.header("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (token) {
      await authService.revokeSessionToken(token);
    }
    res.json({ data: { success: true } });
  } catch (error) {
    next(error);
  }
});

export default router;
