import { clearAuthSession, getAuthToken } from "../workservice/authStorage";
import { AUTH_EXPIRED_EVENT, createApiUrl } from "./httpClient";

/**
 * 获取图表预览图（PNG）的 object URL，用于在聊天气泡内直接显示。
 * 图片带鉴权头，无法直接 <img src>，因此先取 blob 再转 URL。
 * @param chartId 图表 ID。
 * @returns object URL（调用方负责在不使用时 revokeObjectURL）。
 * @throws 会话失效或图表过期（404）时抛出错误。
 */
export async function fetchChartPngUrl(chartId: string): Promise<string> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(createApiUrl(`/charts/${encodeURIComponent(chartId)}/png`), { headers });

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthSession();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    if (response.status === 404) {
      throw new Error("图表已过期，请重新生成");
    }
    throw new Error(`加载图表失败（HTTP ${response.status}）`);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * 下载聊天中生成的图表 PDF。
 * @param chartId 图表 ID。
 * @param title 图表标题（用作下载文件名）。
 * @throws 会话失效或图表过期（404）时抛出错误。
 */
export async function downloadChartPdf(chartId: string, title: string): Promise<void> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(createApiUrl(`/charts/${encodeURIComponent(chartId)}/pdf`), { headers });

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthSession();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    if (response.status === 404) {
      throw new Error("图表已过期，请重新生成");
    }
    throw new Error(`下载失败（HTTP ${response.status}）`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title || "图表"}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
