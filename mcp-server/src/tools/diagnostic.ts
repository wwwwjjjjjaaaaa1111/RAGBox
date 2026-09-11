/**
 * 诊断类工具：帮助用户确认 MCP 客户端配置是否正确。
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { RagboxApiClient } from "../api/client.js";
import { TOKEN_PREFIX, type McpConfig } from "../config.js";

/**
 * 注册诊断工具。
 * @param server 已创建的 McpServer 实例。
 * @param config 运行时配置。
 * @param client API 客户端（用于实际连通性探测）。
 */
export function registerDiagnosticTools(
  server: McpServer,
  config: McpConfig,
  client: RagboxApiClient,
): void {
  server.registerTool(
    "ragbox_status",
    {
      title: "检查 RAGBox 连接",
      description:
        "检查 MCP 服务与 RAGBox 后端的连通性和令牌状态。任何工具报鉴权或连接错误时，先用本工具定位问题。",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const maskedToken = `${config.token.slice(0, TOKEN_PREFIX.length + 6)}…（共 ${config.token.length} 字符）`;
      const lines = [
        `后端地址：${config.apiUrl}`,
        `请求超时：${config.timeoutMs} ms｜流式超时：${config.streamTimeoutMs} ms`,
        `令牌：${maskedToken}`,
      ];

      try {
        // 用会话列表做一次轻量探测：既验证连通性，也验证令牌有效性与 chat:write 权限。
        await client.request<unknown[]>("/chat/sessions?limit=1");
        lines.push("连接状态：正常（令牌有效，且具备 chat:write 权限）");
      } catch (error) {
        lines.push(`连接状态：失败 —— ${error instanceof Error ? error.message : String(error)}`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
