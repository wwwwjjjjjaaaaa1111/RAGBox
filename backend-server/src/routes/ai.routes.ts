import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { sendApiError } from "../common/errors";
import * as fileController from "../controllers/file.controller";

const aiRouter = Router();
const aiServiceSharedSecret = process.env.AI_SERVICE_SHARED_SECRET || "";

function requireAiServiceSecret(req: Request, res: Response, next: NextFunction) {
  if (!aiServiceSharedSecret) {
    next();
    return;
  }

  const provided = req.header("x-ai-service-secret") || "";
  if (provided !== aiServiceSharedSecret) {
    sendApiError(res, 401, "UNAUTHORIZED_AI_CALLBACK", "Invalid AI service secret");
    return;
  }

  next();
}

// Inbound callbacks from the Python AI service (authenticated by shared secret).
aiRouter.post("/ingestion/callback", requireAiServiceSecret, fileController.ingestionCallback);
aiRouter.post("/ingestion/chunks", requireAiServiceSecret, fileController.syncIngestionChunks);

export default aiRouter;
