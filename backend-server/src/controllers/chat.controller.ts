import type { NextFunction, Request, Response } from "express";
import {
  chatCompletionBodySchema,
  createSessionBodySchema,
  deleteSessionsBodySchema,
  messageBodySchema,
  messageListQuerySchema,
  sessionParamsSchema,
  sessionsQuerySchema,
  updateSessionFilesBodySchema,
} from "../common/schemas";
import { validate } from "../common/validation";
import { getAuthUserId } from "../middleware/auth";
import * as aiService from "../services/ai.service";
import * as chatService from "../services/chat.service";
import * as modelConfigService from "../services/modelConfig.service";
import * as chatMetrics from "../lib/chatMetrics";

type StreamEventPayload = Record<string, unknown>;

const DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT = 12;
const DEFAULT_AUTO_SESSION_TITLE = true;

/**
 * 读取是否自动生成会话标题（AUTO_SESSION_TITLE）。
 * @returns 布尔开关。
 */
function isAutoSessionTitleEnabled() {
  const raw = (process.env.AUTO_SESSION_TITLE || "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

/**
 * 读取发送给 AI 服务的历史消息条数（CHAT_CONTEXT_MESSAGE_LIMIT）。
 * @returns 正整数条数上限。
 */
function getChatContextMessageLimit() {
  const limit = Number(process.env.CHAT_CONTEXT_MESSAGE_LIMIT || DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT);
  return Number.isFinite(limit) && limit >= 1
    ? Math.floor(limit)
    : DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT;
}

function writeSseEvent(res: Response, event: string, data: StreamEventPayload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function parseSseEventBlock(block: string) {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (!lines.length) {
    return null;
  }

  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (!dataLines.length) {
    return null;
  }

  return {
    event,
    data: JSON.parse(dataLines.join("\n")) as StreamEventPayload,
  };
}

/**
 * 为指纹用户创建新的会话。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 * @returns 写入 201 成功响应或将错误传递给全局错误中间件。
 */
export async function createSession(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = validate(createSessionBodySchema, req.body || {}, "request body");
    const session = await chatService.createChatSession({
      userId: payload.userId,
      title: payload.title,
      fileIds: payload.fileIds,
    });
    res.status(201).json({ data: session });
  } catch (error) {
    next(error);
  }
}

/**
 * 查询指纹用户下的会话列表。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 * @returns 写入标准成功响应或将错误传递给全局错误中间件。
 */
export async function getSessions(req: Request, res: Response, next: NextFunction) {
  try {
    const query = validate(sessionsQuerySchema, req.query || {}, "query params");
    const sessions = await chatService.getChatSessions({
      userId: getAuthUserId(req),
      limit: query.limit,
    });
    res.json({ data: sessions });
  } catch (error) {
    next(error);
  }
}

/**
 * 删除单个会话及其关联消息。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export async function deleteSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = validate(sessionParamsSchema, req.params || {}, "path params");
    const result = await chatService.deleteChatSession({
      sessionId: id,
      userId: getAuthUserId(req),
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

/**
 * 批量删除多个会话及其关联消息。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export async function deleteSessions(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(deleteSessionsBodySchema, req.body || {}, "request body");
    const result = await chatService.deleteChatSessions(body);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

/**
 * 向指定会话追加一条消息。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 * @returns 写入 201 成功响应或将错误传递给全局错误中间件。
 */
export async function createMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = validate(sessionParamsSchema, req.params || {}, "path params");
    const body = validate(messageBodySchema, req.body || {}, "request body");

    await chatService.requireOwnedSession({
      sessionId: id,
      userId: getAuthUserId(req),
    });

    const message = await chatService.createChatMessage({
      sessionId: id,
      role: body.role,
      content: body.content,
    });

    res.status(201).json({ data: message });
  } catch (error) {
    next(error);
  }
}

/**
 * 查询会话内按时间排序的消息。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 * @returns 写入标准成功响应或将错误传递给全局错误中间件。
 */
export async function getMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = validate(sessionParamsSchema, req.params || {}, "path params");
    const { limit } = validate(messageListQuerySchema, req.query || {}, "query params");

    await chatService.requireOwnedSession({
      sessionId: id,
      userId: getAuthUserId(req),
    });

    const messages = await chatService.getChatMessages({ sessionId: id, limit });
    res.json({ data: messages });
  } catch (error) {
    next(error);
  }
}

/**
 * 更新会话限定的检索文件范围（空数组 = 检索全部文件）。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export async function updateSessionFiles(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = validate(sessionParamsSchema, req.params || {}, "path params");
    const body = validate(updateSessionFilesBodySchema, req.body || {}, "request body");
    const result = await chatService.setSessionFiles({
      sessionId: id,
      userId: getAuthUserId(req),
      fileIds: body.fileIds,
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

/**
 * 为指定会话执行一次流式聊天完成。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export async function completeSessionChat(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = validate(sessionParamsSchema, req.params || {}, "path params");
    const body = validate(chatCompletionBodySchema, req.body || {}, "request body");

    const session = await chatService.requireOwnedSession({
      sessionId: id,
      userId: body.userId,
    });

    const sessionFileIds = chatService.parseSessionFileIds(session.fileIdsJson);

    const userMessage = await chatService.createChatMessage({
      sessionId: id,
      role: "user",
      content: body.content,
    });

    const recentMessages = await chatService.getRecentChatMessages({
      sessionId: id,
      limit: getChatContextMessageLimit(),
    });

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    writeSseEvent(res, "message.started", {
      sessionId: id,
      userMessage,
    });

    const modelConfig = await modelConfigService.getModelConfigOverride(body.userId);

    const upstream = await aiService.streamChat({
      query: body.content,
      sessionId: id,
      userId: body.userId,
      modelConfig,
      fileIds: sessionFileIds.length ? sessionFileIds : undefined,
      recentMessages: recentMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });

    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assistantContent = "";
    let assistantSources: Array<Record<string, unknown>> = [];

    // 首字延迟：从发出提问到首个回答分块到达；断连检测用于指标与停止空读上游。
    const streamStart = process.hrtime.bigint();
    let firstTokenRecorded = false;
    let clientAborted = false;
    res.on("close", () => {
      if (!completed && !failed) {
        clientAborted = true;
        chatMetrics.clientAborts.inc();
      }
    });
    // 工具调用生成的图表，随 assistant 消息一并持久化（历史会话需回显原生图片）。
    const assistantCharts: Array<{ chartId: string; title: string; chartType: "line" | "bar" }> = [];
    let completed = false;
    let failed = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done || clientAborted) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        separatorIndex = buffer.indexOf("\n\n");

        const parsed = parseSseEventBlock(block);
        if (!parsed) {
          continue;
        }

        if (parsed.event === "message.delta") {
          if (!firstTokenRecorded) {
            firstTokenRecorded = true;
            chatMetrics.firstToken.observe(Number(process.hrtime.bigint() - streamStart) / 1e9);
          }
          const delta = typeof parsed.data.delta === "string" ? parsed.data.delta : "";
          assistantContent += delta;
          writeSseEvent(res, parsed.event, parsed.data);
          continue;
        }

        if (parsed.event === "message.started") {
          continue;
        }

        if (parsed.event === "message.sources") {
          assistantSources = Array.isArray(parsed.data.sources)
            ? (parsed.data.sources as Array<Record<string, unknown>>)
            : [];
          writeSseEvent(res, parsed.event, parsed.data);
          continue;
        }

        if (parsed.event === "message.completed") {
          completed = true;
          chatMetrics.streams.inc({ outcome: "completed" });
          const assistantMessage = await chatService.createAssistantMessage({
            sessionId: id,
            content: assistantContent,
            sources: assistantSources,
            charts: assistantCharts,
          });
          writeSseEvent(res, parsed.event, {
            ...parsed.data,
            assistantMessage,
          });
          continue;
        }

        if (parsed.event === "chart.generated") {
          const chartId = typeof parsed.data.chartId === "string" ? parsed.data.chartId : "";
          if (chartId) {
            assistantCharts.push({
              chartId,
              title: typeof parsed.data.title === "string" ? parsed.data.title : "图表",
              chartType: parsed.data.chartType === "bar" ? "bar" : "line",
            });
          }
          writeSseEvent(res, parsed.event, parsed.data);
          continue;
        }

        if (parsed.event === "message.failed") {
          failed = true;
          chatMetrics.streams.inc({ outcome: "failed" });
          writeSseEvent(res, parsed.event, parsed.data);
          continue;
        }

        writeSseEvent(res, parsed.event, parsed.data);
      }
    }

    if (!completed && !failed) {
      writeSseEvent(res, "message.failed", {
        code: "STREAM_TERMINATED",
        message: "AI response ended unexpectedly",
      });
    }

    // 首次对话结束后自动生成会话标题；失败静默跳过，不影响本次回答。
    if (completed && !failed && isAutoSessionTitleEnabled() && recentMessages.length === 1) {
      try {
        const title = await aiService.generateChatTitle({
          query: body.content,
          answer: assistantContent,
          modelConfig,
        });
        if (title) {
          await chatService.updateSessionTitle(id, body.userId, title);
          writeSseEvent(res, "session.title", { sessionId: id, title });
        }
      } catch {
        // Title generation is best-effort.
      }
    }

    res.end();
  } catch (error) {
    if (!res.headersSent) {
      next(error);
      return;
    }

    writeSseEvent(res, "message.failed", {
      code: (error as { code?: string })?.code || "CHAT_STREAM_ERROR",
      message: error instanceof Error ? error.message : "Chat stream failed",
    });
    res.end();
  }
}

/**
 * 订阅当前用户的会话事件流。MCP 等外部客户端写入消息后会推送 message.created，
 * 网页端据此即时刷新，无需手动刷新页面。
 * @param req Express 请求对象。
 * @param res Express 响应对象。
 * @param next Express next 回调。
 */
export async function streamChatEvents(req: Request, res: Response, next: NextFunction) {
  try {
    chatService.streamChatEvents(getAuthUserId(req), res);
  } catch (error) {
    next(error);
  }
}
