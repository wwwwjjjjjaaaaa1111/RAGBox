import { Router } from "express";
import * as chartController from "../controllers/chart.controller";
import * as chatController from "../controllers/chat.controller";
import * as fileController from "../controllers/file.controller";
import { requireAuth } from "../middleware/auth";
import { upload } from "../middleware/upload";
import aiRouter from "./ai.routes";
import authRouter from "./auth.routes";
import modelConfigRouter from "./modelConfig.routes";

const router = Router();

router.use("/auth", authRouter);
router.use("/model-config", requireAuth, modelConfigRouter);

// Upload route requires multipart field `file` and runs multer before auth so req.body is parsed.
router.post("/files/precheck", requireAuth, fileController.precheckFileUpload);
router.post("/files/upload", upload.single("file"), requireAuth, fileController.uploadFile);
router.post("/files/upload/chunked/init", requireAuth, fileController.initChunkUpload);
router.post("/files/upload/chunked/chunk", upload.single("file"), requireAuth, fileController.uploadChunk);
router.get("/files/upload/chunked/status", requireAuth, fileController.getChunkUploadStatus);
router.post("/files/upload/chunked/complete", requireAuth, fileController.completeChunkUpload);
router.get("/files", requireAuth, fileController.getFiles);
router.get("/files/:fileId/detail", requireAuth, fileController.getFileDetail);
router.post("/files/:fileId/ingest", requireAuth, fileController.dispatchPendingFileIngestion);
router.post("/files/:fileId/offload", requireAuth, fileController.offloadIndexedFile);
router.delete("/files/:fileId", requireAuth, fileController.deleteKnowledgeFile);
router.get("/files/events", requireAuth, fileController.streamFileEvents);
router.get("/tasks/:taskId", requireAuth, fileController.getTask);

// Chat routes map session and message operations.
router.post("/chat/sessions", requireAuth, chatController.createSession);
router.get("/chat/sessions", requireAuth, chatController.getSessions);
router.delete("/chat/sessions", requireAuth, chatController.deleteSessions);
router.post("/chat/sessions/:id/messages", requireAuth, chatController.createMessage);
router.get("/chat/sessions/:id/messages", requireAuth, chatController.getMessages);
router.put("/chat/sessions/:id/files", requireAuth, chatController.updateSessionFiles);
router.delete("/chat/sessions/:id", requireAuth, chatController.deleteSession);
router.post("/chat/sessions/:id/completions", requireAuth, chatController.completeSessionChat);

// AI proxy routes are isolated for future Python service evolution.
router.use("/ai", aiRouter);

// Chat-generated chart downloads & inline previews (ownership enforced on the AI service side).
router.get("/charts/:chartId/pdf", requireAuth, chartController.getChartFile);
router.get("/charts/:chartId/png", requireAuth, chartController.getChartFile);

export default router;
