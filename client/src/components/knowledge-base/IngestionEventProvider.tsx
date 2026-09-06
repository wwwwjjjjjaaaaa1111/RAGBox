
/*
 * @Editor: zhanghang
 * @Description:
 * @Date: 2026-04-01 15:07:24
 * @LastEditors: zhanghang
 * @LastEditTime: 2026-04-01 15:07:30
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { createKnowledgeBaseEventSource, type IngestionStreamEvent } from "../../api";
import { useAuth } from "../auth/AuthProvider";
import IngestionToastStack, { type IngestionToastItem } from "./IngestionToastStack";

const TOAST_DURATION_MS = 5600;
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY_MS = 2000;

type IngestionToastStage = "started" | "success" | "failed";

type IngestionEventsContextValue = {
  latestEvent: IngestionStreamEvent | null;
};

const IngestionEventsContext = createContext<IngestionEventsContextValue | null>(null);

function getToastStage(event: IngestionStreamEvent): IngestionToastStage | null {
  if (event.type !== "ingestion.updated" || !event.file) {
    return null;
  }

  if (
    (event.file.parseStatus === "pending" || event.file.parseStatus === "processing")
    && (event.task?.status === "queued" || event.task?.status === "running")
  ) {
    return "started";
  }

  if (event.file.parseStatus === "indexed") {
    return "success";
  }

  if (event.file.parseStatus === "failed") {
    return "failed";
  }

  return null;
}

function buildIngestionToast(event: IngestionStreamEvent): IngestionToastItem | null {
  if (event.type !== "ingestion.updated" || !event.file) {
    return null;
  }

  const file = event.file;

  if (
    (file.parseStatus === "pending" || file.parseStatus === "processing")
    && (event.task?.status === "queued" || event.task?.status === "running")
  ) {
    return {
      id: file.id,
      fileId: file.id,
      title: "开始入库",
      description: `正在解析并入库：${file.fileName}`,
      tone: "info",
      label: "进行中",
    };
  }

  if (file.parseStatus === "indexed") {
    return {
      id: file.id,
      fileId: file.id,
      title: "入库成功",
      description: `「${file.fileName}」已可用于检索和对话。`,
      tone: "success",
      label: "成功",
    };
  }

  if (file.parseStatus === "failed") {
    return {
      id: file.id,
      fileId: file.id,
      title: "入库失败",
      description: event.task?.errorMessage || `「${file.fileName}」未能加入知识库。`,
      tone: "error",
      label: "失败",
    };
  }

  return null;
}

export function IngestionEventProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<IngestionToastItem[]>([]);
  const [latestEvent, setLatestEvent] = useState<IngestionStreamEvent | null>(null);
  const notifiedStatusRef = useRef(new Map<string, string>());
  const toastTimeoutsRef = useRef(new Map<string, number>());
  const { token, user } = useAuth();
  const userId = user?.id || "";

  function dismissToast(toastId: string) {
    const timeoutId = toastTimeoutsRef.current.get(toastId);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      toastTimeoutsRef.current.delete(toastId);
    }

    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }

  function showToast(toast: IngestionToastItem) {
    const existingTimeout = toastTimeoutsRef.current.get(toast.id);
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }

    setToasts((current) => {
      const next = current.filter((item) => item.id !== toast.id);
      return [toast, ...next].slice(0, 4);
    });

    const timeoutId = window.setTimeout(() => {
      dismissToast(toast.id);
    }, TOAST_DURATION_MS);

    toastTimeoutsRef.current.set(toast.id, timeoutId);
  }

  useEffect(() => {
    if (!token || !userId) {
      return;
    }

    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: number | null = null;
    let reconnectAttempts = 0;

    function handleIngestionMessage(event: MessageEvent) {
      try {
        const payload = JSON.parse(event.data as string) as IngestionStreamEvent;
        setLatestEvent(payload);

        const nextToastStage = getToastStage(payload);
        if (!nextToastStage || !payload.file) {
          return;
        }

        const lastNotifiedStage = notifiedStatusRef.current.get(payload.file.id);
        if (lastNotifiedStage === nextToastStage) {
          return;
        }

        notifiedStatusRef.current.set(payload.file.id, nextToastStage);

        const toast = buildIngestionToast(payload);
        if (!toast) {
          return;
        }

        showToast(toast);
      } catch {
        // Ignore malformed SSE payloads.
      }
    }

    function connect() {
      if (disposed) {
        return;
      }

      source = createKnowledgeBaseEventSource(userId, token);
      source.onopen = () => {
        reconnectAttempts = 0;
      };
      source.onmessage = handleIngestionMessage;
      source.onerror = () => {
        source?.close();
        source = null;

        if (disposed || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          return;
        }

        // EventSource stops silently on 401/auth errors; back off a few times, then give up.
        reconnectAttempts += 1;
        retryTimer = window.setTimeout(connect, BASE_RECONNECT_DELAY_MS * reconnectAttempts);
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
  }, [token, userId]);

  useEffect(() => {
    return () => {
      for (const timeoutId of toastTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }

      toastTimeoutsRef.current.clear();
    };
  }, []);

  const contextValue = useMemo<IngestionEventsContextValue>(() => ({
    latestEvent,
  }), [latestEvent]);

  return (
    <IngestionEventsContext.Provider value={contextValue}>
      {children}
      <IngestionToastStack toasts={toasts} onDismiss={dismissToast} />
    </IngestionEventsContext.Provider>
  );
}

export function useIngestionEvents() {
  const context = useContext(IngestionEventsContext);
  if (!context) {
    throw new Error("useIngestionEvents must be used within IngestionEventProvider");
  }

  return context;
}