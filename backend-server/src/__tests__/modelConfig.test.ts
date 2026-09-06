import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { setupTestApp, registerUser, type TestContext } from "./helpers";

const CHAT_KEY = "sk-or-v1-abcd1234efgh5678";
const EMBED_KEY = "zk-embedding-secret-99";

describe("模型配置（脱敏回显/覆盖语义/加密存储/参数校验）", () => {
  let ctx: TestContext;
  let userA: Awaited<ReturnType<typeof registerUser>>;
  let userB: Awaited<ReturnType<typeof registerUser>>;

  before(async () => {
    ctx = await setupTestApp("model-config");
    userA = await registerUser(ctx.baseUrl, "config_user_a");
    userB = await registerUser(ctx.baseUrl, "config_user_b");
  });

  after(async () => {
    await ctx.close();
  });

  async function putConfig(authHeaders: Record<string, string>, body: Record<string, unknown>) {
    return fetch(`${ctx.baseUrl}/v1/model-config`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function getConfig(authHeaders: Record<string, string>) {
    const response = await fetch(`${ctx.baseUrl}/v1/model-config`, { headers: authHeaders });
    return (await response.json() as any).data;
  }

  it("保存后 GET 只返回脱敏 Key（尾 4 位），绝不回传明文", async () => {
    const put = await putConfig(userA.authHeaders, {
      chatBaseUrl: "https://openrouter.ai/api/v1",
      chatApiKey: CHAT_KEY,
      chatModel: "provider/model:free",
      embeddingApiKey: EMBED_KEY,
      embeddingModel: "embedding-3",
    });
    assert.equal(put.status, 200);

    const config = await getConfig(userA.authHeaders);
    assert.equal(config.chatApiKey.configured, true);
    assert.equal(config.chatApiKey.maskedKey, `****${CHAT_KEY.slice(-4)}`);
    assert.equal(config.embeddingApiKey.maskedKey, `****${EMBED_KEY.slice(-4)}`);
    const raw = JSON.stringify(config);
    assert.ok(!raw.includes(CHAT_KEY), "明文 chat key 不应出现在响应中");
    assert.ok(!raw.includes(EMBED_KEY), "明文 embedding key 不应出现在响应中");
  });

  it("数据库层为加密存储，内部读取可解密回明文（加密往返）", async () => {
    const record = await ctx.prisma.userModelConfig.findUnique({ where: { userId: userA.userId } });
    assert.ok(record);
    assert.match(record.chatApiKey || "", /^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/, "DB 中应为 v1 加密格式");
    assert.ok(!record.chatApiKey?.includes(CHAT_KEY), "DB 中不应有明文");

    const { getInternalModelConfig } = await import("../services/modelConfig.service");
    const internal = await getInternalModelConfig(userA.userId);
    assert.equal(internal?.chatApiKey, CHAT_KEY);
    assert.equal(internal?.embeddingApiKey, EMBED_KEY);
  });

  it("不传 Key 字段 = 保留原值；只更新其他字段生效", async () => {
    await putConfig(userA.authHeaders, { chatModel: "provider/other-model" });
    const config = await getConfig(userA.authHeaders);
    assert.equal(config.chatModel, "provider/other-model");
    assert.equal(config.chatApiKey.maskedKey, `****${CHAT_KEY.slice(-4)}`);
    assert.equal(config.chatBaseUrl, "https://openrouter.ai/api/v1");
  });

  it("空字符串 Key 被拒绝（400），防止误清空", async () => {
    const response = await putConfig(userA.authHeaders, { chatApiKey: "" });
    assert.equal(response.status, 400);
  });

  it("调优参数保存并按用户隔离；越界值被拒绝", async () => {
    const bad = await putConfig(userA.authHeaders, { chunkSize: 100 });
    assert.equal(bad.status, 400);

    const ok = await putConfig(userA.authHeaders, {
      chunkSize: 1000,
      chunkOverlap: 150,
      retrievalTopK: 8,
      retrievalScoreThreshold: 0.3,
    });
    assert.equal(ok.status, 200);

    const configA = await getConfig(userA.authHeaders);
    assert.equal(configA.chunkSize, 1000);
    assert.equal(configA.retrievalTopK, 8);

    const configB = await getConfig(userB.authHeaders);
    assert.equal(configB.chunkSize, null, "userB 不应看到 userA 的参数");
    assert.equal(configB.chatApiKey.configured, false, "userB 不应看到 userA 的 Key");
  });

  it("DELETE 清空配置，回退未配置状态", async () => {
    const del = await fetch(`${ctx.baseUrl}/v1/model-config`, {
      method: "DELETE",
      headers: userA.authHeaders,
    });
    assert.equal(del.status, 200);

    const config = await getConfig(userA.authHeaders);
    assert.equal(config.chatApiKey.configured, false);
    assert.equal(config.chunkSize, null);
    assert.equal(config.chatModel, null);
  });
});
