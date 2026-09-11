import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ChatMessage, ChatSession } from "../api";
import { createChatEventSource, updateSessionFiles, type ChatStreamEvent } from "../api";
import { useAuth } from "../components/auth/AuthProvider";
import ChatComposer from "../components/chat/ChatComposer";
import ChatHistoryDrawer from "../components/chat/ChatHistoryDrawer";
import ChatMessageList from "../components/chat/ChatMessageList";
import RetrievalScopeSelector from "../components/chat/RetrievalScopeSelector";
import { useChatSubmit } from "../hooks/useChatSubmit";
import {
  loadChatSessions,
  loadSessionMessages,
  removeChatSession,
  removeChatSessions,
} from "../workservice/chatWorkservice";

/** 会话事件流的最大重连次数，与入库事件流保持一致。 */
const MAX_CHAT_STREAM_RECONNECT_ATTEMPTS = 5;
const CHAT_STREAM_RECONNECT_BASE_DELAY_MS = 2000;

/**
 * 聊天路由容器，负责管理会话、处理流式消息，并协调聊天页面的各个子组件。
 * Chat route container responsible for session management, message streaming,
 * and coordinating the chat layout subcomponents.
 */
const ChatPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const skipNextSessionLoadRef = useRef<string | null>(null);
  // 事件回调里需要读到最新值，用 ref 规避闭包捕获旧状态。
  const activeSessionIdRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);
  const startNewChatAt =
    typeof location.state === "object"
    && location.state !== null
    && "startNewChatAt" in location.state
    && typeof location.state.startNewChatAt === "number"
      ? location.state.startNewChatAt
      : null;

  // 历史抽屉中展示的全部聊天会话，按最近使用时间排序。
  // All chat sessions shown in the history drawer, ordered by recency.
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  // 当前选中的会话 id，用于展示消息并作为新消息发送目标。
  // Session currently selected for viewing and sending new messages.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // 主会话区域当前渲染的消息列表。
  // Messages currently rendered in the main conversation panel.
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // 底部输入框当前的草稿内容。
  // Current text entered in the bottom composer.
  const [draft, setDraft] = useState("");

  // 流式请求进行中时的加载状态，用来锁定输入区避免重复提交。
  // Loading flag used to lock the composer during a streaming request.
  const [isLoading, setIsLoading] = useState(false);

  // 最近一次可恢复错误，会在对话面板中反馈给用户。
  // Latest recoverable error surfaced to the user in the conversation panel.
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 是否处于“新聊天”空白态；该状态下不应自动选中历史会话。
  // Whether the page is in blank new-chat mode; when true, history auto-select is suppressed.
  const [isNewChatMode, setIsNewChatMode] = useState(false);

  // 新聊天模式下暂存的检索范围；首次发送消息时随会话一起持久化。
  const [pendingFileIds, setPendingFileIds] = useState<string[]>([]);

  const activeSession = sessions.find((session) => session.id === activeSessionId) || null;

  const { handleSubmit } = useChatSubmit({
    activeSessionId,
    draft,
    isLoading,
    pendingFileIds,
    onSessionCreated: (sessionId) => {
      skipNextSessionLoadRef.current = sessionId;
      setPendingFileIds([]);
    },
    setActiveSessionId,
    setSessions,
    setMessages,
    setDraft,
    setIsLoading,
    setErrorMessage,
  });

  /**
   * 保存当前会话的检索范围；新聊天模式仅更新本地暂存。
   * @param fileIds 文件 ID 列表（空数组 = 检索全部文件）。
   */
  function handleSaveScope(fileIds: string[]) {
    if (isNewChatMode || !activeSessionId) {
      setPendingFileIds(fileIds);
      return;
    }

    void (async () => {
      try {
        const result = await updateSessionFiles(activeSessionId, fileIds);
        setSessions((current) => current.map((session) => (
          session.id === result.id ? { ...session, fileIds: result.fileIds } : session
        )));
        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "保存检索范围失败");
      }
    })();
  }

  useEffect(() => {
    let cancelled = false;

    /**
     * 页面首次挂载时加载已保存的聊天会话，并默认打开最新会话，确保用户进入页面即可继续对话。
     * Loads the saved chat sessions when the page first mounts and opens the
     * newest session by default so the user lands on a usable conversation.
     */
    async function bootstrap() {
      const nextSessions = await loadChatSessions();
      if (cancelled) {
        return;
      }

      setSessions(nextSessions);
      if (!startNewChatAt && !isNewChatMode && nextSessions[0]) {
        setActiveSessionId(nextSessions[0].id);
      }
    }

    void bootstrap().catch((error: unknown) => {
      if (!cancelled) {
        setErrorMessage(error instanceof Error ? error.message : "加载会话列表失败");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isNewChatMode, startNewChatAt]);

  useEffect(() => {
    if (!startNewChatAt) {
      return;
    }

    handleCreateSession();
    navigate("/chat", { replace: true, state: null });
  }, [navigate, startNewChatAt]);

  useEffect(() => {
    if (activeSessionId) {
      setIsNewChatMode(false);
    }
  }, [activeSessionId]);

  // 同步最新状态到 ref，供 SSE 回调读取。
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  /**
   * 订阅会话事件流：MCP 等外部客户端往某个会话写入消息后，
   * 网页端无需手动刷新即可看到新问答。
   * Subscribes to the chat event stream so messages written by external MCP
   * clients show up without a manual page refresh.
   */
  useEffect(() => {
    if (!token || !user?.id) {
      return;
    }

    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: number | null = null;
    let reconnectAttempts = 0;

    function handleChatEvent(event: MessageEvent) {
      let payload: ChatStreamEvent;
      try {
        payload = JSON.parse(event.data as string) as ChatStreamEvent;
      } catch {
        return;
      }

      if (payload.type !== "message.created" || !payload.sessionId) {
        return;
      }

      // 本页正在流式接收自己的回答时不要刷新，否则会覆盖正在渲染的草稿。
      if (isLoadingRef.current) {
        return;
      }

      const targetSessionId = payload.sessionId;
      if (targetSessionId === activeSessionIdRef.current) {
        void loadSessionMessages(targetSessionId)
          .then((nextMessages) => setMessages(nextMessages))
          .catch(() => {
            // 刷新失败时保留当前内容，下次事件或手动切换会重试。
          });
      }

      // 消息数等会话元信息也可能变化，顺带同步列表。
      void loadChatSessions()
        .then((nextSessions) => setSessions(nextSessions))
        .catch(() => {
          // 忽略：会话列表会在下次进入页面时重新加载。
        });
    }

    function connect() {
      if (disposed) {
        return;
      }

      source = createChatEventSource(user!.id, token);
      source.onopen = () => {
        reconnectAttempts = 0;
      };
      source.onmessage = handleChatEvent;
      source.onerror = () => {
        source?.close();
        source = null;

        if (disposed || reconnectAttempts >= MAX_CHAT_STREAM_RECONNECT_ATTEMPTS) {
          return;
        }

        // EventSource 在鉴权失败时会静默停止，退避重连若干次后放弃。
        reconnectAttempts += 1;
        retryTimer = window.setTimeout(connect, CHAT_STREAM_RECONNECT_BASE_DELAY_MS * reconnectAttempts);
      };
    }

    connect();

    return () => {
      disposed = true;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
      source?.close();
    };
  }, [token, user?.id]);

  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }

    const sessionId = activeSessionId;
    if (skipNextSessionLoadRef.current === sessionId) {
      skipNextSessionLoadRef.current = null;
      return;
    }

    let cancelled = false;

    /**
     * 根据历史抽屉当前选中的会话拉取消息，保证主消息区与当前会话保持同步。
     * Fetches messages for the session selected in the history drawer and keeps
     * the main panel aligned with the current session id.
     */
    async function loadMessages() {
      const nextMessages = await loadSessionMessages(sessionId);
      if (!cancelled) {
        setMessages(nextMessages);
      }
    }

    void loadMessages().catch((error: unknown) => {
      if (!cancelled) {
        setErrorMessage(error instanceof Error ? error.message : "加载消息失败");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  /**
   * 将页面重置为“新聊天”状态，但此时不会立刻创建持久化会话；真正的会话会在首次发送消息时创建。
   * Resets the page into a new-chat state without immediately creating a
   * persisted session. The actual session is created on the first message send.
   */
  function handleCreateSession() {
    setIsNewChatMode(true);
    setActiveSessionId(null);
    setMessages([]);
    setErrorMessage(null);
  }

  /**
   * 选中历史会话时退出“新聊天”空白态。
   * Exits blank new-chat mode when the user selects a session from history.
   */
  function handleSelectSession(sessionId: string) {
    setIsNewChatMode(false);
    setActiveSessionId(sessionId);
  }

  /**
   * 在删除一个或多个会话后，决定哪个会话应继续保持激活；如果当前会话未被删除则继续保留，
   * 否则回退到剩余会话中最新的一条。
   * Chooses which session should stay active after one or more sessions have
   * been deleted. If the current session survives, keep it selected; otherwise
   * fall back to the newest remaining session.
   */
  function resolveNextActiveSessionId(nextSessions: ChatSession[], deletedIds: string[]) {
    if (activeSessionId && !deletedIds.includes(activeSessionId)) {
      return activeSessionId;
    }

    return nextSessions[0]?.id || null;
  }

  /**
   * 在用户确认后删除单个会话，并同步更新当前激活会话以及右侧展示的消息列表。
   * Deletes a single session after user confirmation and updates the active
   * session and visible message list accordingly.
   */
  async function handleDeleteSession(sessionId: string) {
    const confirmed = window.confirm("确认删除该会话及其全部消息吗？");
    if (!confirmed) {
      return false;
    }

    try {
      await removeChatSession(sessionId);
      const nextSessions = sessions.filter((session) => session.id !== sessionId);
      const nextActiveSessionId = resolveNextActiveSessionId(nextSessions, [sessionId]);

      setSessions(nextSessions);
      setIsNewChatMode(!nextActiveSessionId);
      setActiveSessionId(nextActiveSessionId);
      if (!nextActiveSessionId) {
        setMessages([]);
      }
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除会话失败");
      return false;
    }
  }

  /**
   * 删除传入的会话集合，并重新计算下一个激活会话，避免右侧面板仍指向已删除会话。
   * Deletes the provided sessions and recomputes the next active
   * session so the right panel never points to a removed conversation.
   */
  async function handleDeleteSelectedSessions(sessionIds: string[]) {
    if (!sessionIds.length) {
      return false;
    }

    const confirmed = window.confirm(
      `确认删除选中的 ${sessionIds.length} 个会话及其全部消息吗？`,
    );
    if (!confirmed) {
      return false;
    }

    try {
      await removeChatSessions(sessionIds);
      const deletedIds = [...sessionIds];
      const nextSessions = sessions.filter((session) => !deletedIds.includes(session.id));
      const nextActiveSessionId = resolveNextActiveSessionId(nextSessions, deletedIds);

      setSessions(nextSessions);
      setIsNewChatMode(!nextActiveSessionId);
      setActiveSessionId(nextActiveSessionId);
      if (!nextActiveSessionId) {
        setMessages([]);
      }
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "批量删除会话失败");
      return false;
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-white">
      <main className="relative flex min-w-0 flex-1 flex-col bg-white">
        <ChatMessageList messages={messages} errorMessage={errorMessage} isLoading={isLoading} />

        <ChatComposer
          draft={draft}
          isLoading={isLoading}
          onDraftChange={setDraft}
          onSubmit={handleSubmit}
          scopeSelector={(
            <RetrievalScopeSelector
              fileIds={isNewChatMode ? pendingFileIds : activeSession?.fileIds ?? null}
              isNewChat={isNewChatMode || !activeSessionId}
              onSaved={handleSaveScope}
            />
          )}
        />
      </main>

      <ChatHistoryDrawer
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onDeleteSelected={handleDeleteSelectedSessions}
      />
    </div>
  );
};

export default ChatPage;
