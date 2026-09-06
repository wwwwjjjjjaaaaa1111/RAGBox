import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { FileParseStatus, KnowledgeFileDetail } from "../api";
import MaterialIcon from "../components/common/MaterialIcon";
import { fetchKnowledgeFileDetailById } from "../workservice/uploadWorkservice";

const CHUNKS_PER_PAGE = 4;

type PaginationItem = number | "ellipsis";

function formatRelativeTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "刚刚";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function formatChunkLabel(index: number) {
  return `#${String(index + 1).padStart(4, "0")}`;
}

function getStatusMeta(status: FileParseStatus) {
  switch (status) {
    case "indexed":
      return { label: "已入库", icon: "check_circle", iconClassName: "text-green-600" };
    case "processing":
      return { label: "处理中", icon: "progress_activity", iconClassName: "text-amber-600" };
    case "failed":
      return { label: "失败", icon: "error", iconClassName: "text-rose-600" };
    case "pending":
    default:
      return { label: "待入库", icon: "schedule", iconClassName: "text-slate-500" };
  }
}

function buildPagination(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 4) return Array.from({ length: totalPages }, (_, i) => i + 1);
  if (currentPage <= 2) return [1, 2, 3, "ellipsis", totalPages];
  if (currentPage >= totalPages - 1) return [1, "ellipsis", totalPages - 2, totalPages - 1, totalPages];
  return [1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

const KnowledgeFileDetailPage = () => {
  const navigate = useNavigate();
  const { fileId = "" } = useParams();
  const [detail, setDetail] = useState<KnowledgeFileDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [fileId]);

  useEffect(() => {
    let cancelled = false;
    async function loadDetail() {
      setIsLoading(true);
      setError("");
      try {
        const result = await fetchKnowledgeFileDetailById(fileId, { page, limit: CHUNKS_PER_PAGE });
        if (!cancelled) {
          setDetail(result);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载文件详情失败");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    if (fileId) { void loadDetail(); }
    else { setError("缺少文件 ID"); setIsLoading(false); }
    return () => { cancelled = true; };
  }, [fileId, page]);

  const statusMeta = detail ? getStatusMeta(detail.parseStatus) : getStatusMeta("pending");
  const totalPages = detail?.pagination.totalPages ?? 1;
  const pagedChunks = detail?.chunks ?? [];
  const paginationItems = useMemo(() => buildPagination(page, totalPages), [page, totalPages]);

  return (
    <section className="min-h-[calc(100vh-4rem)] bg-[#f7f9fb]">
      <div className="mx-auto w-full max-w-7xl px-4 pb-8 pt-8 md:px-8 md:pb-10 md:pt-10 lg:px-10">
          {isLoading && (
            <div className="rounded-3xl bg-white px-8 py-14 text-center text-sm text-slate-500 shadow-sm">
              正在加载文件详情...
            </div>
          )}

          {!isLoading && error && (
            <div className="rounded-3xl bg-[#ffdad6] px-8 py-6 text-sm text-[#93000a]">
              {error}
            </div>
          )}

          {!isLoading && !error && detail && (
            <>
              <div className="mb-4">
                <button
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-semibold text-[#45464d] transition-colors hover:bg-[#f2f4f6] hover:text-[#191c1e]"
                  onClick={() => navigate(-1)}
                  type="button"
                >
                  <MaterialIcon name="arrow_back" className="!text-[18px]" />
                  返回
                </button>
              </div>

              {/* Header Section */}
              <section className="mb-7 md:mb-8">
                <div className="space-y-0">

                  <h2 className="mb-4 font-headline text-[28px] font-extrabold leading-[1.1] tracking-tight text-[#191c1e] md:mb-5">
                    {detail.fileName}
                  </h2>

                  <div className="flex items-center gap-8">
                    <div className="flex flex-col">
                      <span className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#6b6e75]">向量化状态</span>
                      <span className="flex items-center gap-1 text-[13px] font-semibold text-[#191c1e]">
                        <MaterialIcon name={statusMeta.icon} className={`!text-[14px] ${statusMeta.iconClassName}`} filled />
                        {statusMeta.label}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#6b6e75]">分块总数</span>
                      <span className="text-[13px] font-semibold text-[#191c1e]">{detail.chunkCount.toLocaleString()} 段</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#6b6e75]">完成时间</span>
                      <span className="text-[13px] font-semibold text-[#191c1e]">处理于 {formatRelativeTime(detail.indexedAt ?? detail.uploadedAt)}</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Decomposed Text Chunks Card */}
              <section className="rounded-2xl border border-[#e8eaed] bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-[#eceef0] px-5 py-4 md:px-7">
                  <h3 className="text-[16px] font-bold tracking-tight">文本分段详情</h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8e9099]">
                        <th className="w-24 px-5 py-3 md:px-8">序号</th>
                        <th className="px-5 py-3 md:px-8">内容摘要</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#eceef0]">
                      {pagedChunks.length > 0 ? (
                        pagedChunks.map((chunk) => (
                          <tr key={chunk.id} className="transition-colors hover:bg-[#f9fafb]">
                            <td className="px-5 py-5 font-mono text-xs text-[#6b6e75] md:px-8">
                              {formatChunkLabel(chunk.chunkIndex)}
                            </td>
                            <td className="px-5 py-5 md:px-8">
                              <p className="max-w-3xl text-[13px] font-medium leading-relaxed text-[#2d3133] line-clamp-2">
                                {chunk.contentPreview}
                              </p>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={2} className="px-5 py-12 text-center text-sm text-[#45464d] md:px-8">
                            当前文件还没有可展示的分块记录。
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between border-t border-[#eceef0] px-5 py-4 md:px-7">
                  <p className="text-[11px] font-medium text-[#6b6e75]">
                    显示 {pagedChunks.length} / {detail.pagination.totalItems.toLocaleString()} 段
                  </p>

                  <div className="flex items-center gap-1">
                    <button
                      className="rounded-lg p-2 text-[#45464d] transition-colors hover:bg-[#f2f4f6] disabled:opacity-40"
                      disabled={page === 1}
                      onClick={() => setPage((c) => Math.max(1, c - 1))}
                      type="button"
                    >
                      <MaterialIcon name="chevron_left" />
                    </button>

                    {paginationItems.map((item, idx) =>
                      item === "ellipsis" ? (
                        <span key={`ellipsis-${idx}`} className="px-2 text-[#45464d]">...</span>
                      ) : (
                        <button
                          key={item}
                          className={`rounded-lg px-3 py-1 text-xs font-bold transition-colors ${
                            item === page
                              ? "bg-black text-white"
                              : "hover:bg-[#f2f4f6]"
                          }`}
                          onClick={() => setPage(item)}
                          type="button"
                        >
                          {item}
                        </button>
                      )
                    )}

                    <button
                      className="rounded-lg p-2 text-[#45464d] transition-colors hover:bg-[#f2f4f6] disabled:opacity-40"
                      disabled={page === totalPages}
                      onClick={() => setPage((c) => Math.min(totalPages, c + 1))}
                      type="button"
                    >
                      <MaterialIcon name="chevron_right" />
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}
      </div>
    </section>
  );
};

export default KnowledgeFileDetailPage;
