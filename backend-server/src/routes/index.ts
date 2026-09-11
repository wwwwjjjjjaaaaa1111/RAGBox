import { Router } from "express";
import * as chartController from "../controllers/chart.controller";
import * as chatController from "../controllers/chat.controller";
import * as fileController from "../controllers/file.controller";
import * as searchController from "../controllers/search.controller";
import { requireAuth, requireScope, requireSessionAuth } from "../middleware/auth";
import { upload } from "../middleware/upload";
import aiRouter from "./ai.routes";
import authRouter from "./auth.routes";
import modelConfigRouter from "./modelConfig.routes";
import personalAccessTokenRouter from "./personalAccessToken.routes";

const router = Router();

router.use("/auth", authRouter);
router.use("/model-config", requireAuth, modelConfigRouter);

// Personal access token management. requireSessionAuth blocks PATs, otherwise a
// token could mint a higher-privileged token and escape its own scopes.
router.use("/tokens", requireAuth, requireSessionAuth, personalAccessTokenRouter);

// Upload route requires multipart field `file` and runs multer before auth so req.body is parsed.
router.post("/files/precheck", requireAuth, fileController.precheckFileUpload);
router.post("/files/upload", upload.single("file"), requireAuth, fileController.uploadFile);
router.post("/files/upload/chunked/init", requireAuth, fileController.initChunkUpload);
router.post("/files/upload/chunked/chunk", upload.single("file"), requireAuth, fileController.uploadChunk);
router.get("/files/upload/chunked/status", requireAuth, fileController.getChunkUploadStatus);
router.post("/files/upload/chunked/complete", requireAuth, fileController.completeChunkUpload);
router.get("/files", requireAuth, requireScope("kb:read"), fileController.getFiles);
router.get("/files/:fileId/detail", requireAuth, requireScope("kb:read"), fileController.getFileDetail);
router.post("/files/:fileId/ingest", requireAuth, fileController.dispatchPendingFileIngestion);
router.post("/files/:fileId/offload", requireAuth, fileController.offloadIndexedFile);
router.delete("/files/:fileId", requireAuth, fileController.deleteKnowledgeFile);
router.get("/files/events", requireAuth, fileController.streamFileEvents);
router.get("/tasks/:taskId", requireAuth, fileController.getTask);

// Chat routes map session and message operations.
// /chat/events 注册在参数化路由之前，避免被 :id 之类的模式抢先匹配。
router.get("/chat/events", requireAuth, chatController.streamChatEvents);

// 会话读取同样归入 chat:write —— 该 scope 的语义是「对话访问（读+写）」，
// 否则只持 kb:read 的令牌也能读到全部对话历史。
router.post("/chat/sessions", requireAuth, chatController.createSession);
router.get("/chat/sessions", requireAuth, requireScope("chat:write"), chatController.getSessions);
router.delete("/chat/sessions", requireAuth, chatController.deleteSessions);
router.post("/chat/sessions/:id/messages", requireAuth, chatController.createMessage);
router.get("/chat/sessions/:id/messages", requireAuth, requireScope("chat:write"), chatController.getMessages);
router.put("/chat/sessions/:id/files", requireAuth, chatController.updateSessionFiles);
router.delete("/chat/sessions/:id", requireAuth, chatController.deleteSession);
router.post("/chat/sessions/:id/completions", requireAuth, chatController.completeSessionChat);

// AI proxy routes are isolated for future Python service evolution.
router.use("/ai", aiRouter);

// Chat-generated chart downloads & inline previews (ownership enforced on the AI service side).
router.get("/charts/:chartId/pdf", requireAuth, chartController.getChartFile);
router.get("/charts/:chartId/png", requireAuth, chartController.getChartFile);

// External integration surface for MCP clients: read-only retrieval and
// explicit chart creation. Both are scope-gated for personal access tokens.
router.post("/search", requireAuth, requireScope("kb:read"), searchController.searchKnowledge);
router.post("/charts", requireAuth, requireScope("charts:generate"), chartController.createChart);

export default router;
