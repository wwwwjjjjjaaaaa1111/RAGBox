#!/usr/bin/env node
/**
 * RAGBox MCP 服务入口（stdio 传输）。
 *
 * 注意：stdio 传输下 stdout 是 JSON-RPC 通道，任何日志都必须走 stderr，
 * 否则会污染协议流导致客户端解析失败。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { registerAllTools } from "./tools/index.js";

const SERVER_NAME = "ragbox";
const SERVER_VERSION = "0.1.0";

/**
 * 服务级说明，随初始化响应下发给客户端模型。
 *
 * 这段文字解决一个具体的误用：知识库有「只读检索」和「交给 RAGBox 回答」两条路径，
 * 前者不落库、网页端看不到，后者才留痕。若不说明，模型会一律选检索，
 * 于是用户以为在和 RAGBox 对话，网页上却什么都没有。
 */
const SERVER_INSTRUCTIONS = [
  "RAGBox 是用户本机的知识库问答应用（网页端 http://127.0.0.1:5173）。",
  "",
  "访问知识库有两条路径，行为差别很大，请按用户意图选择：",
  "",
  "1) 只读检索：search_knowledge_base / list_knowledge_files / get_file_chunks。",
  "   把知识库原文送进你自己（当前模型）的上下文，由你作答。",
  "   特点：不写入任何记录，用户在 RAGBox 网页上看不到这次交流。",
  "   适用于：用户只想马上得到答案，或明确要你用当前模型回答。",
  "",
  "2) 交给 RAGBox 回答：ask_in_session。",
  "   由 RAGBox 自己的模型检索并作答，提问与回答都会保存到会话。",
  "   特点：用户在网页端打开同一会话即可看到，且网页开着该会话时会自动刷新。",
  "   适用于：用户提到「网页上」「记录」「保存」「我的 RAGBox」等，或希望答案带",
  "   知识库引用来源、希望这段对话能留存与回看。",
  "",
  "同一个问题不要两条路径都用，否则会产生重复回答。",
  "",
  "图表：默认用 generate_chart，它把图片直接返回给你转呈用户，不产生会话记录。",
  "只有当用户明确要求把图表留存到 RAGBox 时，才改用 ask_in_session —— 它也会内联返回图片。",
  "",
  "遇到鉴权或连接错误时，先调用 ragbox_status 获取具体原因再向用户解释。",
].join("\n");

async function main(): Promise<void> {
  // 先读配置：令牌缺失时立即失败，让客户端把可读的错误显示给用户。
  const config = loadConfig();

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerAllTools(server, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[ragbox-mcp] 已启动，目标后端 ${config.apiUrl}`);
}

main().catch((error: unknown) => {
  console.error(`[ragbox-mcp] 启动失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
