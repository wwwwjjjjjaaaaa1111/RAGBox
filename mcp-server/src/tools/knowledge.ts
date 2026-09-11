/**
 * 知识库只读工具：检索、列文件、读分块。
 * 这三个工具不落库、不调用对话模型，纯粹把资料送进宿主模型的上下文。
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { RagboxApiClient } from "../api/client.js";
import type { FileDetail, KnowledgeFilesPage, SearchResult } from "../api/types.js";

/** 检索结果的展示上限：命中过多会把宿主模型的上下文撑爆。 */
const MAX_RENDERED_MATCHES = 20;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function renderSearchResult(result: SearchResult): string {
  if (result.matchCount === 0) {
    return [
      `未在知识库中检索到与「${result.query}」相关的内容。`,
      "可能原因：知识库还没有已入库的文件、相关度阈值偏高，或该账号名下没有该文件。",
    ].join("\n");
  }

  const lines = [
    `检索「${result.query}」命中 ${result.matchCount} 段（向量模型：${result.embeddingModel || "未知"}）。`,
    "以下内容来自知识库原文，请据此作答并标注文件名与页码：",
    "",
  ];

  result.matches.slice(0, MAX_RENDERED_MATCHES).forEach((match, index) => {
    const location = [
      match.fileName || "未知文件",
      match.pageNumber !== null ? `第 ${match.pageNumber} 页` : null,
      match.chunkIndex !== null ? `第 ${match.chunkIndex + 1} 段` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    lines.push(`[${index + 1}] ${location}（相似度 ${match.score.toFixed(3)}）`);
    lines.push(match.content);
    lines.push("");
  });

  if (result.matchCount > MAX_RENDERED_MATCHES) {
    lines.push(`（仅展示前 ${MAX_RENDERED_MATCHES} 段，共 ${result.matchCount} 段。）`);
  }

  return lines.join("\n");
}

/**
 * 注册知识库只读工具。
 * @param server MCP 服务实例。
 * @param client RAGBox API 客户端。
 */
export function registerKnowledgeTools(server: McpServer, client: RagboxApiClient): void {
  server.registerTool(
    "search_knowledge_base",
    {
      title: "检索知识库",
      description:
        "在 RAGBox 知识库中做语义检索，返回与查询最相关的原文片段、文件名、页码与相似度分数。" +
        "它只检索、不生成答案，请基于返回的原文自行作答并标注来源。" +
        "注意：本工具不写入任何记录，用户在 RAGBox 网页上看不到这次检索或你的回答；" +
        "若用户希望这段问答留存在 RAGBox（网页端可见），请改用 ask_in_session。",
      inputSchema: {
        query: z.string().min(1).describe("检索词或问题，用自然语言描述要查什么"),
        topK: z.number().int().min(1).max(20).optional().describe("返回条数，默认 5"),
        maxChars: z
          .number()
          .int()
          .min(100)
          .max(8000)
          .optional()
          .describe("每段内容最多返回多少字符，默认 2000"),
        fileIds: z
          .array(z.string())
          .optional()
          .describe("只在这些文件内检索（文件 ID 列表），省略则检索全部已入库文件"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, topK, maxChars, fileIds }) => {
      const result = await client.request<SearchResult>("/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, topK, maxChars, fileIds }),
      });

      return { content: [{ type: "text", text: renderSearchResult(result) }] };
    },
  );

  server.registerTool(
    "list_knowledge_files",
    {
      title: "列出知识库文件",
      description:
        "列出 RAGBox 知识库中的文件及其入库状态（pending/processing/failed/indexed）。" +
        "只有 indexed 的文件才能被检索到；用它来了解可检索的范围，或确认某个文件是否已入库。",
      inputSchema: {
        parseStatus: z
          .enum(["pending", "processing", "failed", "indexed"])
          .optional()
          .describe("只看某个状态的文件，省略则返回全部"),
        page: z.number().int().min(1).optional().describe("页码，默认 1"),
        limit: z.number().int().min(1).max(200).optional().describe("每页条数，默认 50"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ parseStatus, page, limit }) => {
      const params = new URLSearchParams();
      if (parseStatus) params.set("parseStatus", parseStatus);
      params.set("page", String(page ?? 1));
      params.set("limit", String(limit ?? 50));

      const result = await client.request<KnowledgeFilesPage>(`/files?${params.toString()}`);

      if (result.items.length === 0) {
        return {
          content: [
            { type: "text", text: "知识库中没有符合条件的文件。用户需要先在 RAGBox 网页上传并完成入库。" },
          ],
        };
      }

      const lines = result.items.map((file) => {
        const statusLabel =
          file.parseStatus === "indexed" ? "已入库（可检索）" : `状态：${file.parseStatus}`;
        return `- ${file.fileName}｜${statusLabel}｜${formatBytes(file.fileSizeBytes)}｜ID ${file.id}`;
      });

      return {
        content: [
          {
            type: "text",
            text: [
              `共 ${result.pagination.totalItems} 个文件，当前第 ${result.pagination.page}/${result.pagination.totalPages} 页：`,
              ...lines,
            ].join("\n"),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_file_chunks",
    {
      title: "读取文件分块",
      description:
        "读取某个已入库文件被切分后的文本分块（分页返回）。当需要通读某个文件的细节、" +
        "或检索结果不够时用它补足上下文。可先用 list_knowledge_files 取得文件 ID。",
      inputSchema: {
        fileId: z.string().min(1).describe("文件 ID"),
        page: z.number().int().min(1).optional().describe("页码，默认 1"),
        limit: z.number().int().min(1).max(200).optional().describe("每页分块数，默认 20"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ fileId, page, limit }) => {
      const params = new URLSearchParams();
      params.set("page", String(page ?? 1));
      params.set("limit", String(limit ?? 20));

      const detail = await client.request<FileDetail>(
        `/files/${encodeURIComponent(fileId)}/detail?${params.toString()}`,
      );

      if (detail.chunks.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `文件「${detail.fileName}」（状态：${detail.parseStatus}）暂无分块内容。若状态不是 indexed，请先在网页完成入库。`,
            },
          ],
        };
      }

      const body = detail.chunks
        .map((chunk) => {
          const pageLabel = chunk.pageNumber !== null ? `第 ${chunk.pageNumber} 页` : "无页码";
          return `--- 第 ${chunk.chunkIndex + 1} 段（${pageLabel}）---\n${chunk.contentPreview}`;
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: [
              `文件「${detail.fileName}」，共 ${detail.chunkCount} 段，第 ${detail.pagination.page}/${detail.pagination.totalPages} 页：`,
              "",
              body,
            ].join("\n"),
          },
        ],
      };
    },
  );
}
