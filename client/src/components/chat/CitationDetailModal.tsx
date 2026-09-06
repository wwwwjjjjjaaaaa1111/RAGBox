import { useEffect, useState } from "react";
import type { ChatMessageSource } from "../../api";
import MaterialIcon from "../common/MaterialIcon";

type CitationDetailModalProps = {
  index: number;
  onClose: () => void;
  source: ChatMessageSource;
};

/**
 * 引用来源详情弹窗：展示来源原文片段与定位信息。
 * 点击遮罩 / 按 ESC / 点关闭按钮均可关闭；打开期间锁定页面滚动。
 */
const CitationDetailModal = ({ index, onClose, source }: CitationDetailModalProps) => {
  const [copied, setCopied] = useState(false);

  // ESC 关闭 + 打开期间锁定 body 滚动。
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(source.snippet || "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板不可用时静默忽略。
    }
  }

  const title = source.fileName || `来源 ${index + 1}`;
  const fileIdTail = source.fileId ? source.fileId.slice(-8) : null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="toast-slide-in flex max-h-[80vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="引用来源详情"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              引用来源 {index + 1}
            </p>
            <h3 className="font-headline mt-0.5 truncate text-base font-bold text-black" title={title}>
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-black"
          >
            <MaterialIcon name="close" className="!text-[20px]" />
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-50 px-6 py-3 text-xs text-slate-500">
          {typeof source.pageNumber === "number" && <span>第 {source.pageNumber} 页</span>}
          {typeof source.chunkIndex === "number" && (
            <span>分块 #{String(source.chunkIndex + 1).padStart(4, "0")}</span>
          )}
          {fileIdTail && <span className="font-mono text-[10px] text-slate-400">ID 尾号 {fileIdTail}</span>}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <blockquote className="rounded-r-lg border-l-4 border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
            {source.snippet || "（该来源没有可展示的原文片段。）"}
          </blockquote>
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={!source.snippet}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copied ? "已复制" : "复制原文"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-80"
          >
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
};

export default CitationDetailModal;
