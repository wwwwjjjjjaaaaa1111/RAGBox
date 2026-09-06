import MaterialIcon from "../common/MaterialIcon";
import type { KnowledgeBaseFilter, UploadLibraryRow } from "../../workservice/uploadWorkservice";

const filterOptions: Array<{ value: KnowledgeBaseFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待入库" },
  { value: "processing", label: "处理中" },
  { value: "failed", label: "失败" },
  { value: "indexed", label: "已入库" },
];

const pageSizeOptions = [5, 10, 20];

type KnowledgeTableProps = {
  rows: UploadLibraryRow[];
  isLoading?: boolean;
  error?: string;
  activeFilter: KnowledgeBaseFilter;
  onFilterChange: (filter: KnowledgeBaseFilter) => void;
  page: number;
  totalPages: number;
  totalItems: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
  dispatchingRowIds?: string[];
  offloadingRowIds?: string[];
  deletingRowIds?: string[];
  onOpenIndexedRow?: (row: UploadLibraryRow) => void;
  onDispatchRow?: (row: UploadLibraryRow) => void;
  onOffloadRow?: (row: UploadLibraryRow) => void;
  onDeleteRow?: (row: UploadLibraryRow) => void;
};

const KnowledgeTable = ({
  rows,
  isLoading = false,
  error = "",
  activeFilter,
  onFilterChange,
  page,
  totalPages,
  totalItems,
  onPreviousPage,
  onNextPage,
  canGoPrevious,
  canGoNext,
  pageSize,
  onPageSizeChange,
  dispatchingRowIds = [],
  offloadingRowIds = [],
  deletingRowIds = [],
  onOpenIndexedRow,
  onDispatchRow,
  onOffloadRow,
  onDeleteRow,
}: KnowledgeTableProps) => {
  const emptyMessage = isLoading
    ? "正在加载文件…"
    : error || "知识库中还没有文件。";
  const dispatchingSet = new Set(dispatchingRowIds);
  const offloadingSet = new Set(offloadingRowIds);
  const deletingSet = new Set(deletingRowIds);



  const withStopPropagation = <T,>(handler?: (data: T) => void) => {
    return (event: React.MouseEvent, data: T) => {
      event.stopPropagation();
      if (handler) {
        handler(data);
      }
    };
  }
  const handleDispatch = withStopPropagation(onDispatchRow);
  const handleOffload = withStopPropagation(onOffloadRow);
  const handleDelete = withStopPropagation(onDeleteRow);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h3 className="font-headline text-lg font-bold">文件列表</h3>
        <div className="flex flex-col gap-3 md:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 text-slate-400">
              <MaterialIcon name="filter_list" />
            </div>
            {filterOptions.map((option) => (
              <button
                key={option.value}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${activeFilter === option.value
                  ? "border-black bg-black text-white"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-black"
                  }`}
                onClick={() => onFilterChange(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <span>每页行数</span>
            <select
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 outline-none transition-colors hover:border-slate-300 focus:border-black"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>{option} 条 / 页</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="overflow-hidden border-t border-slate-100">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <th className="py-3 font-medium">文件名</th>
              <th className="py-3 font-medium">大小</th>
              <th className="py-3 font-medium">状态</th>
              <th className="py-3 text-right font-medium">上传时间</th>
              <th className="py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.length > 0 ? rows.map((row) => (
              <tr key={row.id} onClick={() => onOpenIndexedRow?.(row)} className="group transition-colors hover:bg-slate-50/50">
                <td className="py-3">
                  <div className="flex items-center gap-3">
                    <MaterialIcon name={row.icon} className="text-slate-300" />
                    <span className="text-sm font-medium text-black">{row.name}</span>
                  </div>
                </td>
                <td className="py-3 text-sm text-slate-500">{row.size}</td>
                <td className="py-3">

                  <span
                    className={`text-[11px] font-bold uppercase tracking-tight ${row.statusTone === "success"
                      ? "text-emerald-600"
                      : row.statusTone === "warning"
                        ? "text-amber-600"
                        : "text-rose-600"
                      }`}
                  >
                    {row.status}
                  </span>

                </td>
                <td className="py-3 text-right text-sm text-slate-400">{row.added}</td>
                <td className="py-3">
                  <div className="flex justify-end gap-2 text-xs font-semibold">
                    {row.canDispatch ? (
                      <button
                        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-800 transition-colors hover:border-amber-400 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={dispatchingSet.has(row.id)}
                        onClick={(event) => handleDispatch(event, row)}
                        type="button"
                      >
                        {dispatchingSet.has(row.id) ? "请求中…" : "入库"}
                      </button>
                    ) : null}
                    {row.canOffload ? (
                      <button
                        className="rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-sky-800 transition-colors hover:border-sky-400 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={offloadingSet.has(row.id)}
                        onClick={(event) => handleOffload(event, row)}
                        type="button"
                      >
                        {offloadingSet.has(row.id) ? "出库中…" : "出库"}
                      </button>
                    ) : null}
                    {row.canDelete ? (
                      <button
                        className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-rose-700 transition-colors hover:border-rose-400 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={deletingSet.has(row.id)}
                        onClick={(event) => handleDelete(event, row)}
                        type="button"
                      >
                        {deletingSet.has(row.id) ? "删除中…" : "删除文件"}
                      </button>
                    ) : null}
                    {!row.canDispatch && !row.canOffload && !row.canDelete ? (
                      <span className="text-xs text-slate-300">-</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-slate-400">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-slate-50 py-5">
          <p className="text-xs text-slate-400">共 {totalItems} 个文件 · 第 {page} / {totalPages} 页</p>
          <div className="flex gap-4">
            <button
              className="text-xs font-semibold text-slate-400 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canGoPrevious}
              onClick={onPreviousPage}
              type="button"
            >
              上一页
            </button>
            <button
              className="text-xs font-semibold text-slate-400 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canGoNext}
              onClick={onNextPage}
              type="button"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeTable;