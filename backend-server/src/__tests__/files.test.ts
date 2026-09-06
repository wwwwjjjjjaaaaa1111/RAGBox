import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { setupTestApp, registerUser, type TestContext } from "./helpers";

function makeTextFile(content: string) {
  return new Blob([content], { type: "text/plain" });
}

async function uploadFile(ctx: TestContext, authHeaders: Record<string, string>, fileName: string, blob: Blob) {
  const form = new FormData();
  form.append("file", blob, fileName);
  return fetch(`${ctx.baseUrl}/v1/files/upload`, {
    method: "POST",
    headers: authHeaders,
    body: form,
  });
}

async function waitForFileStatus(
  ctx: TestContext,
  authHeaders: Record<string, string>,
  fileId: string,
  expected: string,
  timeoutMs = 5000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${ctx.baseUrl}/v1/files?page=1&limit=50`, { headers: authHeaders });
    const { data } = await response.json() as any;
    const file = data.items.find((item: any) => item.id === fileId);
    if (file?.parseStatus === expected) {
      return file;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`file ${fileId} did not reach status "${expected}" in ${timeoutMs}ms`);
}

describe("文件上传与入库任务状态机", () => {
  let ctx: TestContext;
  let userA: Awaited<ReturnType<typeof registerUser>>;
  let userB: Awaited<ReturnType<typeof registerUser>>;
  let uploadedFileId: string;
  let uploadedTaskId: string;

  before(async () => {
    ctx = await setupTestApp("files");
    userA = await registerUser(ctx.baseUrl, "file_user_a");
    userB = await registerUser(ctx.baseUrl, "file_user_b");
  });

  after(async () => {
    await ctx.close();
  });

  it("上传 txt 文件成功，AI 离线导致派发失败后文件自动转为 failed", async () => {
    const response = await uploadFile(ctx, userA.authHeaders, "note.txt", makeTextFile("hello knowledge base"));
    assert.equal(response.status, 201);
    const { data } = await response.json() as any;
    uploadedFileId = data.file.id;
    assert.equal(data.file.parseStatus, "pending");

    const file = await waitForFileStatus(ctx, userA.authHeaders, uploadedFileId, "failed");
    assert.ok(file);

    const task = await ctx.prisma.ingestionTask.findFirst({ where: { fileId: uploadedFileId } });
    assert.ok(task);
    uploadedTaskId = task.id;
    assert.equal(task.status, "failed");
    assert.match(task.errorMessage || "", /dispatch/i);
  });

  it("伪装成 PDF 的文本文件被内容校验拒绝（400 INVALID_FILE_CONTENT）", async () => {
    const response = await uploadFile(ctx, userA.authHeaders, "fake.pdf", makeTextFile("not a real pdf"));
    assert.equal(response.status, 400);
    const { error } = await response.json() as any;
    assert.equal(error.code, "INVALID_FILE_CONTENT");
  });

  it("白名单之外的扩展名被拒绝（400 UNSUPPORTED_FILE_TYPE）", async () => {
    const response = await uploadFile(ctx, userA.authHeaders, "malware.exe", makeTextFile("MZ fake binary"));
    assert.equal(response.status, 400);
    const { error } = await response.json() as any;
    assert.equal(error.code, "UNSUPPORTED_FILE_TYPE");
  });

  it("AI 回调更新任务与文件状态；错误密钥 401", async () => {
    const headers = { ...userA.authHeaders, "x-ai-service-secret": "wrong-secret" };
    const unauthorized = await fetch(`${ctx.baseUrl}/v1/ai/ingestion/callback`, {
      method: "POST",
      headers,
      body: JSON.stringify({ taskId: uploadedTaskId, status: "running", progress: 5 }),
    });
    assert.equal(unauthorized.status, 401);

    const running = await fetch(`${ctx.baseUrl}/v1/ai/ingestion/callback`, {
      method: "POST",
      headers: { "x-ai-service-secret": "test-shared-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: uploadedTaskId, status: "running", progress: 45, chunkCount: 2 }),
    });
    assert.equal(running.status, 200);

    const file = await waitForFileStatus(ctx, userA.authHeaders, uploadedFileId, "processing");
    assert.ok(file);

    const success = await fetch(`${ctx.baseUrl}/v1/ai/ingestion/callback`, {
      method: "POST",
      headers: { "x-ai-service-secret": "test-shared-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: uploadedTaskId, status: "success", progress: 100, chunkCount: 2 }),
    });
    assert.equal(success.status, 200);

    const indexed = await waitForFileStatus(ctx, userA.authHeaders, uploadedFileId, "indexed");
    assert.equal(indexed.chunkCount, 2);
  });

  it("chunk 同步写入分块元数据并更新 chunkCount", async () => {
    const response = await fetch(`${ctx.baseUrl}/v1/ai/ingestion/chunks`, {
      method: "POST",
      headers: { "x-ai-service-secret": "test-shared-secret", "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: uploadedTaskId,
        fileId: uploadedFileId,
        userId: userA.userId,
        collectionName: "knowledge_chunks",
        parseVersion: 1,
        chunks: [
          { chunkIndex: 0, vectorId: "vec-1", chunkHash: "h1", contentPreview: "chunk one", pageNumber: 1 },
          { chunkIndex: 1, vectorId: "vec-2", chunkHash: "h2", contentPreview: "chunk two", pageNumber: 2 },
        ],
      }),
    });
    assert.equal(response.status, 200);
    const { data } = await response.json() as any;
    assert.equal(data.chunkCount, 2);

    const detail = await fetch(`${ctx.baseUrl}/v1/files/${uploadedFileId}/detail?page=1&limit=10`, {
      headers: userA.authHeaders,
    });
    const { data: detailData } = await detail.json() as any;
    assert.equal(detailData.chunkCount, 2);
    assert.equal(detailData.chunks.length, 2);
  });

  it("跨用户访问文件与任务一律被拒（403/404）", async () => {
    const detail = await fetch(`${ctx.baseUrl}/v1/files/${uploadedFileId}/detail?page=1&limit=10`, {
      headers: userB.authHeaders,
    });
    assert.equal(detail.status, 403);

    const dispatch = await fetch(`${ctx.baseUrl}/v1/files/${uploadedFileId}/ingest`, {
      method: "POST",
      headers: { ...userB.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(dispatch.status, 403);

    const task = await fetch(`${ctx.baseUrl}/v1/tasks/${uploadedTaskId}`, { headers: userB.authHeaders });
    assert.equal(task.status, 404);
  });

  it("删除文件后任务级联清除，任务查询返回 404（未入库文件不涉及向量清理）", async () => {
    // 上传一个新文件（AI 离线 → 派发失败 → parseStatus=failed、chunkCount=0），删除不触发向量清理。
    const upload = await uploadFile(ctx, userA.authHeaders, "deleteme.txt", makeTextFile("to be deleted"));
    assert.equal(upload.status, 201);
    const { data } = await upload.json() as any;
    await waitForFileStatus(ctx, userA.authHeaders, data.file.id, "failed");

    const del = await fetch(`${ctx.baseUrl}/v1/files/${data.file.id}`, {
      method: "DELETE",
      headers: { ...userA.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(del.status, 200);

    const task = await ctx.prisma.ingestionTask.findFirst({ where: { fileId: data.file.id } });
    assert.equal(task, null, "任务应随文件级联删除");

    const detail = await fetch(`${ctx.baseUrl}/v1/files/${data.file.id}/detail?page=1&limit=10`, {
      headers: userA.authHeaders,
    });
    assert.equal(detail.status, 404);
  });

  it("已入库文件在 AI 离线时删除被拒（502），防止向量孤儿污染检索", async () => {
    const del = await fetch(`${ctx.baseUrl}/v1/files/${uploadedFileId}`, {
      method: "DELETE",
      headers: { ...userA.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(del.status, 502);
    const { error } = await del.json() as any;
    assert.equal(error.code, "AI_SERVICE_UNAVAILABLE");

    const detail = await fetch(`${ctx.baseUrl}/v1/files/${uploadedFileId}/detail?page=1&limit=10`, {
      headers: userA.authHeaders,
    });
    assert.equal(detail.status, 200, "文件应仍然存在");
  });
});
