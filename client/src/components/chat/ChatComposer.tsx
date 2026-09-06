import type { KeyboardEvent, ReactNode } from "react";
import MaterialIcon from "../common/MaterialIcon";

type ChatComposerProps = {
  draft: string;
  isLoading: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  /** 渲染在输入框上方的可选扩展区（如检索范围选择器）。 */
  scopeSelector?: ReactNode;
};

const ChatComposer = ({ draft, isLoading, onDraftChange, onSubmit, scopeSelector }: ChatComposerProps) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void onSubmit();
    }
  };

  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white to-transparent p-8">
      <div className="pointer-events-auto mx-auto max-w-3xl">
        {scopeSelector}
        <div className="relative flex items-center rounded-xl border border-slate-200 bg-white p-1.5 pl-4 shadow-sm transition-all focus-within:ring-1 focus-within:ring-black">
          <textarea
            rows={1}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的问题…"
            className="no-scrollbar h-[42px] flex-1 resize-none border-none bg-transparent px-0 py-2.5 text-sm focus:ring-0"
          />
          <button
            onClick={() => void onSubmit()}
            disabled={!draft.trim() || isLoading}
            className="flex items-center justify-center rounded-lg bg-black p-2 text-white transition-transform active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <MaterialIcon name="send" className="!text-[18px]" />
          </button>
        </div>
        <div className="mt-4 flex justify-center gap-6 opacity-40">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            基于知识库检索 · 流式回答
          </span>
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            已启用会话上下文
          </span>
        </div>
      </div>
    </div>
  );
};

export default ChatComposer;