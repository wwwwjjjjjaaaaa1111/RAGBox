import type { NextFunction, Request, Response } from "express";
import { searchBodySchema } from "../common/schemas";
import { validate } from "../common/validation";
import { getAuthUserId } from "../middleware/auth";
import * as aiService from "../services/ai.service";
import * as modelConfigService from "../services/modelConfig.service";

/**
 * 只读检索：把知识库命中的分块（含相似度分数）返回给调用方。
 * 供 MCP 等外部客户端使用；不调用对话模型，由宿主模型自行作答。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export async function searchKnowledge(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(searchBodySchema, req.body || {}, "request body");
    const userId = getAuthUserId(req);
    // 检索必须使用与入库时相同的向量模型，否则向量空间不一致；这里带上用户级覆盖。
    const modelConfig = await modelConfigService.getModelConfigOverride(userId);

    const result = await aiService.searchKnowledge({
      query: body.query,
      userId,
      topK: body.topK,
      fileIds: body.fileIds,
      maxChars: body.maxChars,
      modelConfig,
    });

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}
