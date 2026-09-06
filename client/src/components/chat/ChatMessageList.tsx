import { useLayoutEffect, useRef } from "react";
import type { ChatMessage } from "../../api";
import MaterialIcon from "../common/MaterialIcon";
import ChatMessageBubble from "./ChatMessageBubble";

type ChatMessageListProps = {
  messages: ChatMessage[];
  errorMessage: string | null;
  isLoading: boolean;
};

const ChatMessageList = ({ messages, errorMessage, isLoading }: ChatMessageListProps) => {
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const bottomAnchor = bottomAnchorRef.current;

    if (!scrollContainer || !bottomAnchor) {
      return;
    }

    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [isLoading, messages]);

  return (
    <section ref={scrollContainerRef} className="no-scrollbar flex-1 overflow-y-auto pb-32 pt-8">
      <div className="mx-auto max-w-3xl space-y-10 px-6 md:px-12">
        {!messages.length ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                AI 助手
              </span>
            </div>
            <div className="max-w-2xl text-[15px] font-medium leading-relaxed text-black">
              就知识库中已入库的文件提问，最近的对话轮次也会作为上下文参与回答。
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {messages.map((message) => (
              <ChatMessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}
        {errorMessage ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <MaterialIcon name="hourglass_top" className="toast-spin !text-base" />
            正在生成回答…
          </div>
        ) : null}
        <div ref={bottomAnchorRef} aria-hidden="true" />
      </div>
    </section>
  );
};

export default ChatMessageList;