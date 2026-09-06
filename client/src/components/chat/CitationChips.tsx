/*
 * @Editor: zhanghang
 * @Description: 
 * @Date: 2026-04-03 14:05:47
 * @LastEditors: zhanghang
 * @LastEditTime: 2026-04-03 14:05:51
 */
import { useState } from "react";
import type { ChatMessageSource } from "../../api";
import MaterialIcon from "../common/MaterialIcon";
import CitationDetailModal from "./CitationDetailModal";

type CitationChipsProps = {
  sources: ChatMessageSource[];
};

const CitationChips = ({ sources }: CitationChipsProps) => {
  // 选中的来源索引；每条消息独立持有，不共享全局状态。
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (!sources.length) {
    return null;
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {sources.map((source, index) => (
          <button
            key={`${source.fileId || source.fileName || "source"}-${index}`}
            type="button"
            onClick={() => setActiveIndex(index)}
            title="查看引用来源"
            className="flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-tight text-slate-600 transition-colors hover:bg-black hover:text-white"
          >
            <MaterialIcon name="description" className="!text-[14px]" />
            {source.fileName || `来源 ${index + 1}`}
            {typeof source.pageNumber === "number" ? ` 第 ${source.pageNumber} 页` : ""}
          </button>
        ))}
      </div>

      {activeIndex !== null && sources[activeIndex] && (
        <CitationDetailModal
          index={activeIndex}
          source={sources[activeIndex]}
          onClose={() => setActiveIndex(null)}
        />
      )}
    </>
  );
};

export default CitationChips;
