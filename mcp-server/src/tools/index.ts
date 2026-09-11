/**
 * 工具注册入口。每个工具一个文件，集中在这里挂到 server 上。
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createApiClient } from "../api/client.js";
import type { McpConfig } from "../config.js";
import { registerChartTools } from "./chart.js";
import { registerChatTools } from "./chat.js";
import { registerDiagnosticTools } from "./diagnostic.js";
import { registerKnowledgeTools } from "./knowledge.js";

/**
 * 注册全部 MCP 工具。
 * @param server 已创建的 McpServer 实例。
 * @param config 运行时配置（后端地址与令牌）。
 */
export function registerAllTools(server: McpServer, config: McpConfig): void {
  const client = createApiClient(config);

  registerDiagnosticTools(server, config, client);
  registerKnowledgeTools(server, client);
  registerChartTools(server, client);
  registerChatTools(server, client);
}
