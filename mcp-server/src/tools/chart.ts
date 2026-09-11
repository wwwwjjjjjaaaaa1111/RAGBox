/**
 * 图表生成工具：把显式数据渲染成折线图/柱状图，并以图片内容块返回。
 *
 * 这里刻意只接收显式数值，不做任何「从文档里猜数据」的动作 ——
 * 数据由宿主模型从检索到的原文中提取后再传进来，避免编造。
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { RagboxApiClient } from "../api/client.js";
import type { ChartResult } from "../api/types.js";

/**
 * 注册图表工具。
 * @param server MCP 服务实例。
 * @param client RAGBox API 客户端。
 */
export function registerChartTools(server: McpServer, client: RagboxApiClient): void {
  server.registerTool(
    "generate_chart",
    {
      title: "生成图表",
      description:
        "根据给定的数值生成折线图或柱状图，返回可直接展示的 PNG 图片。" +
        "数值必须来自知识库检索结果或用户提供的数据，不要编造。" +
        "每个系列的 values 个数必须与 xLabels 个数一致。",
      inputSchema: {
        title: z.string().min(1).max(120).describe("图表标题"),
        chartType: z.enum(["line", "bar"]).describe("line=折线图，bar=柱状图"),
        xLabels: z
          .array(z.string())
          .min(1)
          .max(200)
          .describe("X 轴标签（如时间、类别），最多 200 个"),
        series: z
          .array(
            z.object({
              name: z.string().min(1).max(100).describe("系列名称"),
              values: z.array(z.number()).min(1).max(200).describe("与 xLabels 等长的数值数组"),
            }),
          )
          .min(1)
          .max(8)
          .describe("数据系列，最多 8 条"),
        sourceNote: z.string().max(200).optional().describe("数据来源说明（可选，如文件名）"),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ title, chartType, xLabels, series, sourceNote }) => {
      const result = await client.request<ChartResult>("/charts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, chartType, xLabels, series, sourceNote }),
      });

      const summary = [
        `已生成${chartType === "line" ? "折线图" : "柱状图"}「${result.title}」`,
        `（${result.seriesCount} 个系列，共 ${result.pointCount} 个数据点）。`,
        "图片如下，可直接查看。",
      ].join("");

      return {
        content: [
          { type: "text", text: summary },
          { type: "image", data: result.pngBase64, mimeType: "image/png" },
        ],
      };
    },
  );
}
