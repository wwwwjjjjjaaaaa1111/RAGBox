import { createApiError } from "../common/errors";

interface AiChatPayload {
  query: string;
  sessionId?: string;
  userId?: string;
  recentMessages?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  // Optional per-user credentials forwarded to AI-server; empty fields fall back to .env there.
  modelConfig?: AiModelConfigOverride;
  // Optional retrieval scope: only search chunks from these file ids.
  fileIds?: string[];
}

export interface AiModelConfigOverride {
  chatBaseUrl?: string | null;
  chatApiKey?: string | null;
  chatModel?: string | null;
  embeddingBaseUrl?: string | null;
  embeddingApiKey?: string | null;
  embeddingModel?: string | null;
  chunkSize?: number | null;
  chunkOverlap?: number | null;
  retrievalTopK?: number | null;
  retrievalScoreThreshold?: number | null;
}

/**
 * 从 AI 服务拉取生成的图表文件（PDF 下载 / PNG 预览），流式透传给前端。
 * @param chartId 图表 ID。
 * @param userId 当前认证用户（AI 服务侧做属主校验）。
 * @param kind 文件类型：pdf 或 png。
 * @returns 上游 Response。
 * @throws AI_SERVICE_TIMEOUT / AI_SERVICE_ERROR / AI_SERVICE_UNAVAILABLE / CHART_NOT_FOUND。
 */
export async function fetchChartFile(chartId: string, userId: string, kind: "pdf" | "png"): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_SERVICE_TIMEOUT_MS);

  try {
    const response = await fetch(`${AI_SERVICE_BASE_URL}/charts/${encodeURIComponent(chartId)}/${kind}`, {
      headers: createAiServiceHeaders({ "x-user-id": userId }),
      signal: controller.signal,
    });

    if (response.status === 404) {
      throw createApiError(404, "CHART_NOT_FOUND", "Chart not found or expired");
    }
    if (!response.ok || !response.body) {
      throw createApiError(502, "AI_SERVICE_ERROR", `AI service returned ${response.status}`);
    }

    clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);

    if (error instanceof Error && error.name === "AbortError") {
      throw createApiError(504, "AI_SERVICE_TIMEOUT", "AI service timeout");
    }
    if ((error as { code?: string })?.code) {
      throw error;
    }
    throw createApiError(502, "AI_SERVICE_UNAVAILABLE", "AI service unavailable");
  }
}

/**
 * 请 AI 服务为首次对话生成简短会话标题。
 * @param payload 首轮问答内容与模型凭据覆盖。
 * @returns 标题文本；上游失败或返回空时为 null。
 */
export async function generateChatTitle(payload: {
  query: string;
  answer: string;
  modelConfig?: AiModelConfigOverride;
}): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_SERVICE_TIMEOUT_MS);

  try {
    const response = await fetch(`${AI_SERVICE_BASE_URL}/chat/title`, {
      method: "POST",
      headers: createAiServiceHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { data?: { title?: string } };
    const title = data.data?.title?.trim();
    return title || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const AI_SERVICE_BASE_URL = process.env.AI_SERVICE_BASE_URL || "http://127.0.0.1:8000";
const AI_SERVICE_TIMEOUT_MS = Number(process.env.AI_SERVICE_TIMEOUT_MS || 12000);
const ingestionEndpoint = process.env.AI_INGESTION_ENDPOINT || `${AI_SERVICE_BASE_URL}/ingestion/jobs`;
const vectorDeleteEndpoint = process.env.AI_VECTOR_DELETE_ENDPOINT || `${AI_SERVICE_BASE_URL}/vectors/files`;
const aiServiceSharedSecret = process.env.AI_SERVICE_SHARED_SECRET || "";

function createAiServiceHeaders(extraHeaders?: Record<string, string>) {
  const headers: Record<string, string> = {
    ...(extraHeaders || {}),
  };

  if (aiServiceSharedSecret) {
    headers["x-ai-service-secret"] = aiServiceSharedSecret;
  }

  return headers;
}

/**
 * 向 Python AI 服务发起流式聊天请求。
 * @param payload AI 对话请求参数。
 * @returns 上游 Response 对象。
 */
export async function streamChat(payload: AiChatPayload): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_SERVICE_TIMEOUT_MS);

  try {
    const response = await fetch(`${AI_SERVICE_BASE_URL}/chat/stream`, {
      method: "POST",
      headers: createAiServiceHeaders({
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      }),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw createApiError(502, "AI_SERVICE_ERROR", `AI service returned ${response.status}`);
    }

    clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);

    if (error instanceof Error && error.name === "AbortError") {
      throw createApiError(504, "AI_SERVICE_TIMEOUT", "AI service timeout");
    }

    if ((error as { code?: string })?.code) {
      throw error;
    }

    throw createApiError(502, "AI_SERVICE_UNAVAILABLE", "AI service unavailable");
  }
}

/**
 * 派发向量化任务到 AI 服务。
 * 调用方负责决定失败后的任务状态（通常标记为 failed 以便手动重试）。
 * @param payload 向量化任务参数。
 * @throws AI_SERVICE_TIMEOUT 当请求超时。
 * @throws AI_SERVICE_ERROR 当 AI 服务返回非 2xx。
 * @throws AI_SERVICE_UNAVAILABLE 当网络不可用或服务不可达。
 */
export async function dispatchIngestionTask(payload: {
  taskId: string;
  fileId: string;
  userId: string;
  fileName: string;
  fileExt: string;
  fileSizeBytes: number;
  contentMd5: string;
  storagePath: string;
  absoluteFilePath: string;
  parseVersion: number;
  modelConfig?: AiModelConfigOverride;
}) {
  if (!ingestionEndpoint) {
    throw createApiError(502, "AI_SERVICE_UNAVAILABLE", "AI ingestion endpoint is not configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_SERVICE_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      ...createAiServiceHeaders(),
      "Content-Type": "application/json",
    };

    const response = await fetch(ingestionEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw createApiError(502, "AI_SERVICE_ERROR", `AI service returned ${response.status}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw createApiError(504, "AI_SERVICE_TIMEOUT", "AI service timeout");
    }

    if ((error as { code?: string })?.code) {
      throw error;
    }

    throw createApiError(502, "AI_SERVICE_UNAVAILABLE", "AI service unavailable");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 删除某个文件在 AI 向量服务中的全部向量分块。
 * @param fileId 文件 ID。
 * @returns 无返回值。
 */
export async function deleteFileVectors(fileId: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_SERVICE_TIMEOUT_MS);

  try {
    const headers = createAiServiceHeaders();

    const response = await fetch(`${vectorDeleteEndpoint}/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw createApiError(502, "AI_SERVICE_ERROR", `AI service returned ${response.status}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw createApiError(504, "AI_SERVICE_TIMEOUT", "AI service timeout");
    }

    if ((error as { code?: string })?.code) {
      throw error;
    }

    throw createApiError(502, "AI_SERVICE_UNAVAILABLE", "AI service unavailable");
  } finally {
    clearTimeout(timer);
  }
}

export type AiSearchMatch = {
  fileId: string | null;
  fileName: string | null;
  pageNumber: number | null;
  chunkIndex: number | null;
  score: number;
  content: string;
};

export type AiSearchResult = {
  query: string;
  embeddingModel: string | null;
  matchCount: number;
  matches: AiSearchMatch[];
};

export type AiChartSeriesInput = {
  name: string;
  values: number[];
};

export type AiChartResult = {
  chartId: string;
  title: string;
  chartType: string;
  seriesCount: number;
  pointCount: number;
  pngBase64: string;
};

/**
 * 读取 AI 服务的错误详情。FastAPI 用 detail 字段承载可读信息，
 * 其中包含「向量模型未配置」「系列长度不匹配」这类可操作提示，值得透传给调用方。
 * @param response 上游响应。
 * @returns 详情文本；无法解析时返回 null。
 */
async function readUpstreamDetail(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    return typeof payload.detail === "string" && payload.detail ? payload.detail : null;
  } catch {
    return null;
  }
}

/**
 * 将上游非 2xx 响应映射为 ApiError，尽量保留可操作的错误详情。
 * @param response 上游响应。
 * @param fallbackCode 无法取到详情时使用的错误码。
 * @returns 抛出的 ApiError（本函数总是抛出）。
 */
async function throwUpstreamError(response: Response, fallbackCode: string): Promise<never> {
  const detail = await readUpstreamDetail(response);

  // 503 表示 AI 服务自身配置不完整（如缺少向量模型凭据），属于可操作错误，原样透传状态码。
  if (response.status === 503 && detail) {
    throw createApiError(503, "AI_SERVICE_NOT_CONFIGURED", detail);
  }

  if (response.status === 400 && detail) {
    throw createApiError(400, fallbackCode, detail);
  }

  throw createApiError(502, "AI_SERVICE_ERROR", `AI service returned ${response.status}`);
}

/**
 * 只读向量检索：调用 AI 服务的 /search，不触发对话模型。
 * @param payload 检索参数。
 * @returns 带相似度分数的命中列表。
 * @throws AI_SERVICE_TIMEOUT / AI_SERVICE_ERROR / AI_SERVICE_NOT_CONFIGURED / AI_SERVICE_UNAVAILABLE。
 */
export async function searchKnowledge(payload: {
  query: string;
  userId: string;
  topK?: number;
  fileIds?: string[];
  maxChars?: number;
  modelConfig?: AiModelConfigOverride;
}): Promise<AiSearchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_SERVICE_TIMEOUT_MS);

  try {
    const response = await fetch(`${AI_SERVICE_BASE_URL}/search`, {
      method: "POST",
      headers: createAiServiceHeaders({
        "Content-Type": "application/json",
        "x-user-id": payload.userId,
      }),
      body: JSON.stringify({
        query: payload.query,
        topK: payload.topK,
        fileIds: payload.fileIds,
        maxChars: payload.maxChars,
        modelConfig: payload.modelConfig,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      await throwUpstreamError(response, "INVALID_SEARCH_REQUEST");
    }

    return (await response.json()) as AiSearchResult;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw createApiError(504, "AI_SERVICE_TIMEOUT", "AI service timeout");
    }

    if ((error as { code?: string })?.code) {
      throw error;
    }

    throw createApiError(502, "AI_SERVICE_UNAVAILABLE", "AI service unavailable");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 按显式参数生成图表（不走 LLM 工具调用），返回内联 PNG 的 base64。
 * @param payload 图表参数与调用者身份。
 * @returns 图表元信息与 PNG base64。
 * @throws INVALID_CHART_REQUEST / AI_SERVICE_NOT_CONFIGURED / AI_SERVICE_TIMEOUT / AI_SERVICE_UNAVAILABLE。
 */
export async function createChart(payload: {
  userId: string;
  title: string;
  chartType: string;
  xLabels: string[];
  series: AiChartSeriesInput[];
  sourceNote?: string | null;
}): Promise<AiChartResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_SERVICE_TIMEOUT_MS);

  try {
    const response = await fetch(`${AI_SERVICE_BASE_URL}/charts`, {
      method: "POST",
      headers: createAiServiceHeaders({
        "Content-Type": "application/json",
        "x-user-id": payload.userId,
      }),
      body: JSON.stringify({
        title: payload.title,
        chartType: payload.chartType,
        xLabels: payload.xLabels,
        series: payload.series,
        sourceNote: payload.sourceNote ?? null,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      await throwUpstreamError(response, "INVALID_CHART_REQUEST");
    }

    return (await response.json()) as AiChartResult;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw createApiError(504, "AI_SERVICE_TIMEOUT", "AI service timeout");
    }

    if ((error as { code?: string })?.code) {
      throw error;
    }

    throw createApiError(502, "AI_SERVICE_UNAVAILABLE", "AI service unavailable");
  } finally {
    clearTimeout(timer);
  }
}
