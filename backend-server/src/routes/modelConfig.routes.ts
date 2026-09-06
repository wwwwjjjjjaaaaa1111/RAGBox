import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { updateModelConfigBodySchema } from "../common/schemas";
import { validate } from "../common/validation";
import { getAuthUserId } from "../middleware/auth";
import * as modelConfigService from "../services/modelConfig.service";

const router = Router();

/**
 * 查询当前用户的模型配置（API Key 只返回脱敏形式）。
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await modelConfigService.getModelConfig(getAuthUserId(req));
    res.json({ data: config });
  } catch (error) {
    next(error);
  }
});

/**
 * 保存当前用户的模型配置；API Key 未传 = 保留原值，非空 = 覆盖。
 */
router.put("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = validate(updateModelConfigBodySchema, req.body || {}, "request body");
    const config = await modelConfigService.updateModelConfig(getAuthUserId(req), body);
    res.json({ data: config });
  } catch (error) {
    next(error);
  }
});

/**
 * 清空当前用户的模型配置，回退到服务端 .env 默认。
 */
router.delete("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await modelConfigService.resetModelConfig(getAuthUserId(req));
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
