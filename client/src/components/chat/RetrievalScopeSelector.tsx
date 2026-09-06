import { useEffect, useRef, useState } from "react";
import { getKnowledgeFiles, type KnowledgeFileInfo } from "../../api";
import { getCurrentUserId } from "../../workservice/authStorage";
import MaterialIcon from "../common/MaterialIcon";

type RetrievalScopeSelectorProps = {
  /** 当前会话已保存的检索范围；null 表示尚未保存过（视为全部文件）。 */
  fileIds: string[] | null;
  /** 新聊天模式（尚无会话）：范围暂存本地，首次发送时随会话创建。 */
  isNewChat: boolean;
  onSaved: (fileIds: string[]) => void;
};

/**
 * 检索范围选择器：把当前对话限定在某些已入库文件内。
 * 已有会话时保存即持久化到会话；新聊天时暂存，随首次发送一起创建。
 */
const RetrievalScopeSelector = ({ fileIds, isNewChat, onSaved }: RetrievalScopeSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<KnowledgeFileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(fileIds || []));
  const [loadError, setLoadError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // 外部 props（会话切换）变化时同步本地勾选。
  useEffect(() => {
    setSelected(new Set(fileIds || []));
  }, [fileIds, isNewChat]);

  // 点击组件外部时收起面板。
  useEffect(() => {
    if (!isOpen) return;

    function handleMouseDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  async function handleToggleOpen() {
    const next = !isOpen;
    setIsOpen(next);
    if (next && files.length === 0 && !isLoading) {
      setIsLoading(true);
      setLoadError("");
      try {
        const page = await getKnowledgeFiles(getCurrentUserId(), { parseStatus: "indexed", limit: 200 });
        setFiles(page.items);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "加载文件列表失败");
      } finally {
        setIsLoading(false);
      }
    }
  }

  function toggleFile(fileId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }

  async function handleSave() {
    const fileIdsToSave = Array.from(selected);
    setIsOpen(false);
    onSaved(fileIdsToSave);
  }

  function handleClear() {
    setSelected(new Set());
  }

  const effectiveCount = isNewChat ? selected.size : fileIds?.length || 0;
  const scopeLabel = effectiveCount > 0 ? `${effectiveCount} 个文件` : "全部文件";

  return (
    <div ref={containerRef} className="relative mb-2 inline-block">
      <button
        type="button"
        onClick={() => void handleToggleOpen()}
        className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-black"
      >
        <MaterialIcon name="filter_alt" className="!text-[14px]" />
        检索范围：{scopeLabel}
        <MaterialIcon name={isOpen ? "expand_less" : "expand_more"} className="!text-[14px]" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-72 rounded-xl border border-slate-100 bg-white p-3 shadow-xl">
          <p className="mb-2 text-xs font-semibold text-slate-700">
            {isNewChat ? "新对话的检索范围" : "本会话的检索范围"}
          </p>

          {isLoading && <p className="py-3 text-center text-xs text-slate-400">正在加载文件…</p>}
          {loadError && <p className="py-2 text-xs text-red-500">{loadError}</p>}

          {!isLoading && !loadError && files.length === 0 && (
            <p className="py-3 text-center text-xs text-slate-400">知识库中还没有已入库的文件。</p>
          )}

          <div className="no-scrollbar max-h-52 space-y-1 overflow-y-auto">
            {files.map((file) => (
              <label
                key={file.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(file.id)}
                  onChange={() => toggleFile(file.id)}
                  className="h-3.5 w-3.5 accent-black"
                />
                <span className="min-w-0 flex-1 truncate" title={file.fileName}>{file.fileName}</span>
              </label>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5">
            <button
              type="button"
              onClick={handleClear}
              className="text-xs font-medium text-slate-400 transition-colors hover:text-black"
            >
              清空（检索全部）
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-80"
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RetrievalScopeSelector;
