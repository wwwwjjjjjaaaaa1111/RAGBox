import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { setupTestApp, registerUser, type TestContext } from "./helpers";

describe("auth API（注册/登录/会话/锁定）", () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await setupTestApp("auth");
  });

  after(async () => {
    await ctx.close();
  });

  it("注册返回会话 token，重复注册返回 409", async () => {
    const response = await fetch(`${ctx.baseUrl}/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "auth_user", password: "pass1234" }),
    });
    assert.equal(response.status, 201);
    const { data } = await response.json() as any;
    assert.ok(data.token.length >= 32);
    assert.equal(data.user.username, "auth_user");

    const dup = await fetch(`${ctx.baseUrl}/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "auth_user", password: "pass1234" }),
    });
    assert.equal(dup.status, 409);
  });

  it("正确密码登录成功，错误密码 401", async () => {
    const ok = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "auth_user", password: "pass1234" }),
    });
    assert.equal(ok.status, 200);

    const bad = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "auth_user", password: "wrong-pass" }),
    });
    assert.equal(bad.status, 401);
  });

  it("无 token 访问业务接口返回 401，伪造 token 也 401", async () => {
    const noToken = await fetch(`${ctx.baseUrl}/v1/chat/sessions`);
    assert.equal(noToken.status, 401);

    const fake = await fetch(`${ctx.baseUrl}/v1/chat/sessions`, {
      headers: { Authorization: "Bearer deadbeef" },
    });
    assert.equal(fake.status, 401);
  });

  it("me 校验会话；登出后 token 立即失效", async () => {
    const user = await registerUser(ctx.baseUrl, "auth_logout_user");

    const me = await fetch(`${ctx.baseUrl}/v1/auth/me`, { headers: user.authHeaders });
    assert.equal(me.status, 200);
    const { data } = await me.json() as any;
    assert.equal(data.username, "auth_logout_user");

    const logout = await fetch(`${ctx.baseUrl}/v1/auth/logout`, {
      method: "POST",
      headers: user.authHeaders,
    });
    assert.equal(logout.status, 200);

    const meAfter = await fetch(`${ctx.baseUrl}/v1/auth/me`, { headers: user.authHeaders });
    assert.equal(meAfter.status, 401);
  });

  it("同一用户名连续失败 5 次后触发锁定（429），正确密码也被拒", async () => {
    for (let i = 0; i < 5; i += 1) {
      const bad = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "lockout_user", password: "wrong" }),
      });
      assert.equal(bad.status, 401);
    }

    const locked = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "lockout_user", password: "pass1234" }),
    });
    assert.equal(locked.status, 429);
    const { error } = await locked.json() as any;
    assert.equal(error.code, "AUTH_LOCKED");
  });

  it("其他用户名不受锁定影响", async () => {
    await registerUser(ctx.baseUrl, "lockout_other_user");
    const ok = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "lockout_other_user", password: "pass1234" }),
    });
    assert.equal(ok.status, 200);
  });
});
