import {
  createChatSession,
  deleteChatSession,
  deleteChatSessions,
  getChatMessages,
  getChatSessions,
  streamChatCompletion,
  type ChatCompletionEvent,
} from "../api";
import { getCurrentUserId } from "./authStorage";

function requireUserId(): string {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error("请先登录后再操作");
  }
  return userId;
}

export async function loadChatSessions() {
  return getChatSessions(requireUserId());
}

export async function loadSessionMessages(sessionId: string) {
  return getChatMessages(sessionId);
}

export async function createChatSessionFromUserMessage(content: string, fileIds?: string[]) {
  return createChatSession(requireUserId(), content.slice(0, 200), fileIds);
}

export async function sendChatMessage(
  sessionId: string,
  content: string,
  onEvent: (event: ChatCompletionEvent) => void,
) {
  return streamChatCompletion(sessionId, requireUserId(), content, onEvent);
}

export async function removeChatSession(sessionId: string) {
  return deleteChatSession(sessionId, requireUserId());
}

export async function removeChatSessions(sessionIds: string[]) {
  return deleteChatSessions(sessionIds, requireUserId());
}
