/**
 * 会话工具：让 MCP 客户端参与 RAGBox 的持久化对话。
 *
 * 关键设计：ask_in_session 直接调用网页同款的完成接口，并累积 SSE 流。
 * 这样提问与回答都由 RAGBox 落库，网页端打开该会话即可看到完整记录 ——
 * MCP 侧不另起一套回答逻辑，避免「agent 里问过、网页上看不到」。
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { RagboxApiClient } from "../api/client.js";
import type { ChatMessage, ChatMessageSource, ChatSession } from "../api/types.js";

type CompletionOutcome = {
  text: string;
  sources: ChatMessageSource[];
  chart: { chartId: string; title: string } | null;
  failure: string | null;
};

function parseSseBlock(block: string): { event: string; data: Record<string, unknown> } | null {
  const lines = block.split(/\r?\n/);
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

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return { event, data: JSON.parse(dataLines.join("\n")) as Record<string, unknown> };
  } catch {
    return null;
  }
}

/**
 * 消费一次流式回答，累积文本、引用与图表信息。
 * 单块解析失败不影响整体（跳过该块），但 message.failed 会被记录为失败原因。
 * @param response SSE 响应。
 * @returns 累积结果。
 */
async function consumeCompletion(response: Response): Promise<CompletionOutcome> {
  const body = response.body;
  if (!body) {
    return { text: "", sources: [], chart: null, failure: "后端未返回响应体" };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let sources: ChatMessageSource[] = [];
  let chart: CompletionOutcome["chart"] = null;
  let failure: string | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n/);
    // 最后一段可能不完整，留到下一轮拼接。
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      const parsed = parseSseBlock(block);
      if (!parsed) {
        continue;
      }

      if (parsed.event === "message.delta") {
        text += String(parsed.data.delta || "");
        continue;
      }

      if (parsed.event === "message.sources") {
        sources = (parsed.data.sources as ChatMessageSource[] | undefined) || [];
        continue;
      }

      if (parsed.event === "chart.generated") {
        chart = {
          chartId: String(parsed.data.chartId || ""),
          title: String(parsed.data.title || "图表"),
        };
        continue;
      }

      if (parsed.event === "message.failed") {
        failure = String(parsed.data.message || "对话生成失败");
      }
    }
  }

  return { text, sources, chart, failure };
}

function renderCitations(sources: ChatMessageSource[]): string {
  if (sources.length === 0) {
    return "";
  }

  const lines = sources.map((source, index) => {
    const location = [
      source.fileName || "未知文件",
      typeof source.pageNumber === "number" ? `第 ${source.pageNumber} 页` : null,
      typeof source.chunkIndex === "number" ? `第 ${source.chunkIndex + 1} 段` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return `[${index + 1}] ${location}`;
  });

  return `\n\n引用来源：\n${lines.join("\n")}`;
}

/**
 * 注册会话工具。
 * @param server MCP 服务实例。
 * @param client RAGBox API 客户端。
 */
export function registerChatTools(server: McpServer, client: RagboxApiClient): void {
  server.registerTool(
    "list_sessions",
    {
      title: "列出会话",
      description: "列出 RAGBox 中的聊天会话（按最近使用排序）。用于找到要续聊的 sessionId。",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe("返回条数，默认 20"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      const sessions = await client.request<ChatSession[]>(`/chat/sessions?limit=${limit ?? 20}`);

      if (sessions.length === 0) {
        return {
          content: [{ type: "text", text: "还没有任何会话。可用 create_session 新建一个。" }],
        };
      }

      const lines = sessions.map((session) => {
        const title = session.title || "（未命名）";
        return `- ${title}｜${session.messageCount} 条消息｜${session.createdAt}｜ID ${session.id}`;
      });

      return { content: [{ type: "text", text: `共 ${sessions.length} 个会话：\n${lines.join("\n")}` }] };
    },
  );

  server.registerTool(
    "create_session",
    {
      title: "新建会话",
      description:
        "在 RAGBox 中新建一个聊天会话并返回 sessionId。之后用 ask_in_session 在该会话里提问，" +
        "网页端打开同一会话即可看到这些问答。",
      inputSchema: {
        title: z.string().max(200).optional().describe("会话标题（可选）"),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ title }) => {
      const session = await client.request<ChatSession>("/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });

      return {
        content: [
          {
            type: "text",
            text: `已创建会话「${session.title || "未命名"}」，sessionId：${session.id}\n后续用该 ID 调用 ask_in_session 提问。`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_session_messages",
    {
      title: "读取会话消息",
      description: "读取指定会话的历史消息（含引用来源）。用于了解此前聊过什么，或接续被中断的对话。",
      inputSchema: {
        sessionId: z.string().min(1).describe("会话 ID"),
        limit: z.number().int().min(1).max(200).optional().describe("返回条数，默认 50"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ sessionId, limit }) => {
      const messages = await client.request<ChatMessage[]>(
        `/chat/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit ?? 50}`,
      );

      if (messages.length === 0) {
        return { content: [{ type: "text", text: "该会话还没有消息。" }] };
      }

      const body = messages
        .map((message) => {
          const role = message.role === "user" ? "用户" : "助手";
          return `【${role}】${message.content}${renderCitations(message.sources || [])}`;
        })
        .join("\n\n");

      return { content: [{ type: "text", text: body }] };
    },
  );

  server.registerTool(
    "ask_in_session",
    {
      title: "在会话中提问",
      description:
        "在指定 RAGBox 会话中提问，由 RAGBox 自身的知识库检索与对话模型作答。" +
        "提问和回答都会持久化到该会话，网页端可见。回答可能较慢（要检索并生成），请耐心等待。" +
        "需要先有 sessionId（用 list_sessions 取，或 create_session 新建）。" +
        "若 RAGBox 同时生成了图表，图片会一并返回。",
      inputSchema: {
        sessionId: z.string().min(1).describe("会话 ID"),
        question: z.string().min(1).describe("要问的问题"),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ sessionId, question }) => {
      const response = await client.stream(
        `/chat/sessions/${encodeURIComponent(sessionId)}/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: question }),
        },
      );

      const outcome = await consumeCompletion(response);

      if (outcome.failure) {
        return {
          content: [
            {
              type: "text",
              text: `在会话中提问失败：${outcome.failure}`,
            },
          ],
          isError: true,
        };
      }

      const text = `${outcome.text || "（模型未返回文本内容）"}${renderCitations(outcome.sources)}`;
      const content: Array<
        { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
      > = [{ type: "text", text }];

      if (outcome.chart) {
        // 图表由 RAGBox 的模型生成，图片文件带 TTL，这里立即取回并内联返回，
        // 否则客户端只能看到一句「去网页看」，体验反而比直接画图更差。
        try {
          const png = await client.requestBase64(
            `/charts/${encodeURIComponent(outcome.chart.chartId)}/png`,
          );
          content.push({ type: "image", data: png.base64, mimeType: "image/png" });
          content[0] = {
            type: "text",
            text: `${text}\n\n（RAGBox 同时生成了图表「${outcome.chart.title}」，图片见下；该会话可在网页端查看。）`,
          };
        } catch (error) {
          content[0] = {
            type: "text",
            text:
              `${text}\n\n（RAGBox 同时生成了图表「${outcome.chart.title}」，` +
              `但取回图片失败：${error instanceof Error ? error.message : String(error)}。` +
              "可在网页端该会话中查看。）",
          };
        }
      }

      return { content };
    },
  );
}
