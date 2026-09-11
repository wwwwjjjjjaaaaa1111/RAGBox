/**
 * 会话事件的用户级 SSE 广播（内存实现，无外部依赖）。
 *
 * 用途：MCP 等外部客户端通过后端写入消息后，网页端需要即时看到，
 * 否则用户得手动刷新才会出现新问答。
 *
 * 与 ingestionEvents 保持同一套约定：按 userId 分桶、15 秒 keep-alive、
 * 只写 data 行（客户端靠 event.type 分发）、连接关闭时清理。
 */

import type { Response } from "express";

export type ChatEvent = {
  type: string;
  timestamp: string;
  sessionId?: string;
  role?: string;
};

type Client = {
  response: Response;
  keepAlive: NodeJS.Timeout;
};

const clients = new Map<string, Set<Client>>();

const KEEP_ALIVE_INTERVAL_MS = 15000;

function writeEvent(response: Response, event: ChatEvent) {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * 订阅当前用户的会话事件流。
 * @param userId 用户 ID。
 * @param response Express 响应对象（断言为 SSE 流）。
 */
export function subscribeToChatEvents(userId: string, response: Response) {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();

  const client: Client = {
    response,
    keepAlive: setInterval(() => {
      response.write(": keep-alive\n\n");
    }, KEEP_ALIVE_INTERVAL_MS),
  };

  const bucket = clients.get(userId) ?? new Set<Client>();
  bucket.add(client);
  clients.set(userId, bucket);

  writeEvent(response, {
    type: "stream.connected",
    timestamp: new Date().toISOString(),
  });

  response.on("close", () => {
    clearInterval(client.keepAlive);
    const current = clients.get(userId);
    if (!current) {
      return;
    }

    current.delete(client);
    if (current.size === 0) {
      clients.delete(userId);
    }
  });
}

/**
 * 向该用户的所有已连接客户端广播会话事件。
 * 没有活跃连接时直接返回，不影响写入主链路。
 * @param userId 用户 ID。
 * @param event 事件内容（timestamp 由本函数补齐）。
 */
export function publishChatEvent(userId: string, event: Omit<ChatEvent, "timestamp">) {
  const bucket = clients.get(userId);
  if (!bucket || bucket.size === 0) {
    return;
  }

  const payload: ChatEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  for (const client of bucket) {
    writeEvent(client.response, payload);
  }
}
