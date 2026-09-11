/**
 * stdio 冒烟测试：用真实子进程 + 真实协议握手验证服务可被 MCP 客户端驱动。
 * 不做内部函数单测 —— 这一层要验证的是 JSON-RPC 握手、工具清单与错误可读性。
 */

import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 期望暴露的全部工具（步骤 5 的能力清单）。 */
const EXPECTED_TOOLS = [
  "ragbox_status",
  "search_knowledge_base",
  "list_knowledge_files",
  "get_file_chunks",
  "generate_chart",
  "create_session",
  "list_sessions",
  "get_session_messages",
  "ask_in_session",
];

describe("MCP stdio 握手与工具清单", () => {
  let client: Client;

  before(async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/index.ts"],
      cwd: PACKAGE_ROOT,
      env: {
        PATH: process.env.PATH || "",
        // 指向必然连不上的端口：本层只验证协议与错误文案，不需要真实后端。
        RAGBOX_API_URL: "http://127.0.0.1:9/v1",
        RAGBOX_TOKEN: "ragbox_pat_smoke_test_token",
        RAGBOX_TIMEOUT_MS: "1000",
      },
      stderr: "pipe",
    });

    client = new Client({ name: "ragbox-smoke", version: "0.0.0" });
    await client.connect(transport);
  });

  after(async () => {
    await client?.close();
  });

  it("暴露全部预期工具", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    assert.deepEqual(names, [...EXPECTED_TOOLS].sort());
  });

  it("每个工具都有描述与入参 schema（客户端靠它决定何时调用）", async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      assert.ok(tool.description && tool.description.length > 20, `${tool.name} 描述过短或缺失`);
      assert.ok(tool.inputSchema, `${tool.name} 缺少 inputSchema`);
    }
  });

  it("只读工具被标记为 readOnlyHint（便于客户端做安全提示）", async () => {
    const { tools } = await client.listTools();
    const readOnly = ["ragbox_status", "search_knowledge_base", "list_knowledge_files", "get_file_chunks", "list_sessions", "get_session_messages"];

    for (const name of readOnly) {
      const tool = tools.find((item) => item.name === name);
      assert.equal(tool?.annotations?.readOnlyHint, true, `${name} 应标记 readOnlyHint`);
    }
  });

  it("下发服务级说明，讲清「只读检索不落库 / ask_in_session 才留痕」", async () => {
    const instructions = client.getInstructions();

    assert.ok(instructions && instructions.length > 0, "应下发 instructions");
    assert.match(instructions, /search_knowledge_base/, "应点名只读检索工具");
    assert.match(instructions, /ask_in_session/, "应点名会落库的对话工具");
    assert.match(instructions, /网页上看不到/, "应说明只读检索在网页不可见");
    assert.match(instructions, /generate_chart/, "应说明图表默认走 generate_chart");
  });

  it("检索工具的描述不再引导「回答前先调用」，并声明不落库", async () => {
    const { tools } = await client.listTools();
    const search = tools.find((tool) => tool.name === "search_knowledge_base");
    const description = search?.description || "";

    assert.ok(description.length > 0, "检索工具应有描述");
    assert.ok(
      !description.includes("应先调用本工具"),
      "不应再出现「回答前应先调用本工具」这类引导（它会导致对话全部走只读路径）",
    );
    assert.match(description, /网页上看不到|不写入任何记录/, "应声明不落库");
    assert.match(description, /ask_in_session/, "应指向会留痕的替代工具");
  });

  it("后端不可达时给出可操作的中文错误，且不回显完整令牌", async () => {
    const result = await client.callTool({ name: "ragbox_status", arguments: {} });
    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((part) => part.type === "text")
      .map((part) => part.text || "")
      .join("\n");

    assert.match(text, /http:\/\/127\.0\.0\.1:9\/v1/, "应报告后端地址");
    assert.match(text, /连接状态：失败/, "应报告连接失败");
    assert.match(text, /backend-server 已启动/, "错误文案应给出排查方向");
    assert.ok(!text.includes("smoke_test_token"), "不得回显完整令牌明文");
  });

  it("调用需要后端的工具时，错误以文本形式返回而不是让进程崩溃", async () => {
    const result = await client.callTool({
      name: "search_knowledge_base",
      arguments: { query: "任意问题" },
    });
    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((part) => part.type === "text")
      .map((part) => part.text || "")
      .join("\n");

    assert.match(text, /无法连接 RAGBox 后端|超时/, "应返回可读的连接错误");
  });
});
