import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import express from "express";

import { setupTestApp, registerUser, type TestContext } from "./helpers";
import { hashToken } from "../common/tokenHash";
import { requireAuth, requireScope } from "../middleware/auth";
import * as patService from "../services/personalAccessToken.service";

describe("个人访问令牌（签发/脱敏/鉴权/scope/越权隔离）", () => {
  let ctx: TestContext;
  let userA: Awaited<ReturnType<typeof registerUser>>;
  let userB: Awaited<ReturnType<typeof registerUser>>;

  before(async () => {
    ctx = await setupTestApp("pat");
    userA = await registerUser(ctx.baseUrl, "pat_user_a");
    userB = await registerUser(ctx.baseUrl, "pat_user_b");
  });

  after(async () => {
    await ctx.close();
  });

  /** 直接用 service 层签发，避免测试依赖尚未实现的 /v1/tokens 接口。 */
  async function issueToken(
    userId: string,
    scopes: patService.PatScope[] = ["kb:read"],
    ttlDays = 90,
  ) {
    return patService.createPersonalAccessToken({
      userId,
      name: `测试令牌 ${Math.random().toString(36).slice(2, 8)}`,
      scopes,
      ttlDays,
    });
  }

  it("签发只返回一次明文，库里只存哈希", async () => {
    const created = await issueToken(userA.userId, ["kb:read", "chat:write"]);

    assert.ok(created.token.startsWith(patService.PAT_TOKEN_PREFIX), "明文应带前缀");
    assert.deepEqual(created.scopes, ["kb:read", "chat:write"]);

    const row = await ctx.prisma.personalAccessToken.findUnique({ where: { id: created.id } });
    assert.ok(row, "令牌记录应已落库");
    assert.notEqual(row.tokenHash, created.token, "不得明文存储");
    assert.equal(row.tokenHash, hashToken(created.token), "应存 sha256 哈希");
    assert.equal(row.scopes, "kb:read chat:write", "scope 以空格分隔存储");
  });

  it("列表只返回脱敏信息，不含任何哈希或明文", async () => {
    const created = await issueToken(userA.userId);
    const list = await patService.listPersonalAccessTokens(userA.userId);

    assert.ok(list.some((item) => item.id === created.id), "列表应包含刚签发的令牌");
    const serialized = JSON.stringify(list);
    assert.ok(!serialized.includes(created.token), "列表不得泄露明文");
    assert.ok(!serialized.includes("tokenHash"), "列表不得包含哈希字段");
  });

  it("PAT 能通过 requireAuth 访问其 scope 允许的业务接口", async () => {
    const created = await issueToken(userB.userId, ["kb:read"]);
    const response = await fetch(`${ctx.baseUrl}/v1/files?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${created.token}` },
    });

    assert.equal(response.status, 200, "具备 kb:read 的 PAT 应能列出文件");
  });

  it("scope 门禁：只读令牌不能访问会话，对话令牌不能访问知识库", async () => {
    const readOnly = await issueToken(userA.userId, ["kb:read"]);
    const chatOnly = await issueToken(userA.userId, ["chat:write"]);

    const sessionsWithReadOnly = await fetch(`${ctx.baseUrl}/v1/chat/sessions`, {
      headers: { Authorization: `Bearer ${readOnly.token}` },
    });
    const sessionsPayload = (await sessionsWithReadOnly.json()) as { error?: { code?: string } };
    assert.equal(sessionsWithReadOnly.status, 403, "会话读取需要 chat:write");
    assert.equal(sessionsPayload.error?.code, "INSUFFICIENT_SCOPE");

    const filesWithChatOnly = await fetch(`${ctx.baseUrl}/v1/files?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${chatOnly.token}` },
    });
    assert.equal(filesWithChatOnly.status, 403, "文件读取需要 kb:read");

    const searchWithChatOnly = await fetch(`${ctx.baseUrl}/v1/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${chatOnly.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "任意" }),
    });
    assert.equal(searchWithChatOnly.status, 403, "检索需要 kb:read");

    const chartWithReadOnly = await fetch(`${ctx.baseUrl}/v1/charts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${readOnly.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "t",
        chartType: "bar",
        xLabels: ["a"],
        series: [{ name: "s", values: [1] }],
      }),
    });
    assert.equal(chartWithReadOnly.status, 403, "生成图表需要 charts:generate");
  });

  it("个人访问令牌不能访问令牌管理接口（防止权限提升）", async () => {
    const created = await issueToken(userA.userId, ["kb:read", "chat:write", "charts:generate"]);

    const response = await fetch(`${ctx.baseUrl}/v1/tokens`, {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    const payload = (await response.json()) as { error?: { code?: string } };

    assert.equal(response.status, 403, "即便权限全满，PAT 也不得管理令牌");
    assert.equal(payload.error?.code, "SESSION_REQUIRED");
  });

  it("会话 token 可以管理令牌（正常路径）", async () => {
    const response = await fetch(`${ctx.baseUrl}/v1/tokens`, {
      headers: userA.authHeaders,
    });

    assert.equal(response.status, 200, "网页会话应能列出令牌");
  });

  it("伪造或格式合法的未知 PAT 返回 401 INVALID_TOKEN", async () => {
    const response = await fetch(`${ctx.baseUrl}/v1/chat/sessions`, {
      headers: { Authorization: `Bearer ${patService.PAT_TOKEN_PREFIX}${"f".repeat(64)}` },
    });
    const payload = (await response.json()) as { error?: { code?: string } };

    assert.equal(response.status, 401);
    assert.equal(payload.error?.code, "INVALID_TOKEN");
  });

  it("过期 PAT 被拒绝，且被顺带清理", async () => {
    const created = await issueToken(userA.userId);
    // 直接把过期时间改到过去，模拟自然过期。
    await ctx.prisma.personalAccessToken.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await fetch(`${ctx.baseUrl}/v1/chat/sessions`, {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    assert.equal(response.status, 401, "过期令牌应被拒绝");

    const row = await ctx.prisma.personalAccessToken.findUnique({ where: { id: created.id } });
    assert.equal(row, null, "过期令牌应被删除");
  });

  it("PAT 只能看到自己用户的数据（跨用户隔离）", async () => {
    const tokenA = await issueToken(userA.userId, ["chat:write"]);
    const sessionA = await ctx.prisma.chatSession.create({
      data: { userId: userA.userId, title: "A 的会话" },
    });
    await ctx.prisma.chatSession.create({
      data: { userId: userB.userId, title: "B 的会话" },
    });

    const response = await fetch(`${ctx.baseUrl}/v1/chat/sessions`, {
      headers: { Authorization: `Bearer ${tokenA.token}` },
    });
    const payload = (await response.json()) as { data?: Array<{ id: string; title?: string }> };

    assert.equal(response.status, 200);
    const ids = (payload.data || []).map((item) => item.id);
    assert.deepEqual(ids, [sessionA.id], "只应返回本人会话");
  });

  it("吊销后立即失效，且重复吊销返回 404", async () => {
    const created = await issueToken(userA.userId);

    await patService.revokePersonalAccessToken({ userId: userA.userId, tokenId: created.id });

    const response = await fetch(`${ctx.baseUrl}/v1/chat/sessions`, {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    assert.equal(response.status, 401, "吊销后应拒绝");

    await assert.rejects(
      () => patService.revokePersonalAccessToken({ userId: userA.userId, tokenId: created.id }),
      /not found/i,
    );
  });

  it("吊销他人令牌被拒（越权防护）", async () => {
    const createdByB = await issueToken(userB.userId);

    await assert.rejects(
      () => patService.revokePersonalAccessToken({ userId: userA.userId, tokenId: createdByB.id }),
      /not found/i,
    );

    const stillThere = await ctx.prisma.personalAccessToken.findUnique({ where: { id: createdByB.id } });
    assert.ok(stillThere, "他人令牌不应被删除");
  });

  it("拒绝未知 scope，并对重复项去重", async () => {
    assert.throws(() => patService.normalizeRequestedScopes(["kb:read", "admin:all"]), /Unknown scope/);
    assert.deepEqual(patService.normalizeRequestedScopes(["kb:read", "kb:read"]), ["kb:read"]);
  });

  it("lastUsedAt 按节流写入（首次校验即记录）", async () => {
    const created = await issueToken(userA.userId);
    const before = await ctx.prisma.personalAccessToken.findUnique({ where: { id: created.id } });
    assert.equal(before?.lastUsedAt, null, "签发时不应有 lastUsedAt");

    await fetch(`${ctx.baseUrl}/v1/chat/sessions`, {
      headers: { Authorization: `Bearer ${created.token}` },
    });

    const afterUse = await ctx.prisma.personalAccessToken.findUnique({ where: { id: created.id } });
    assert.ok(afterUse?.lastUsedAt, "首次使用后应记录 lastUsedAt");
  });

  it("会话 token 不受 scope 限制（视为全量权限）", async () => {
    const response = await fetch(`${ctx.baseUrl}/v1/chat/sessions`, { headers: userA.authHeaders });
    assert.equal(response.status, 200, "会话 token 应正常通过");
  });

  it("requireScope：缺权限返回 403，有权限放行", async () => {
    // 用独立小应用挂载真实中间件，验证 scope 门禁契约（业务接口在后续步骤接入）。
    const probe = express();
    probe.use(express.json());
    probe.get("/need-kb-read", requireAuth, requireScope("kb:read"), (_req, res) => {
      res.json({ data: { ok: true } });
    });

    const server: Server = probe.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address !== "object") {
      throw new Error("测试服务端口解析失败");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const withScope = await issueToken(userA.userId, ["kb:read"]);
      const allowed = await fetch(`${baseUrl}/need-kb-read`, {
        headers: { Authorization: `Bearer ${withScope.token}` },
      });
      assert.equal(allowed.status, 200, "具备 kb:read 应放行");

      const withoutScope = await issueToken(userA.userId, ["chat:write"]);
      const denied = await fetch(`${baseUrl}/need-kb-read`, {
        headers: { Authorization: `Bearer ${withoutScope.token}` },
      });
      const payload = (await denied.json()) as { error?: { code?: string } };
      assert.equal(denied.status, 403, "缺少 kb:read 应拒绝");
      assert.equal(payload.error?.code, "INSUFFICIENT_SCOPE");

      const asSession = await fetch(`${baseUrl}/need-kb-read`, { headers: userA.authHeaders });
      assert.equal(asSession.status, 200, "会话 token 视为全量权限，应放行");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
