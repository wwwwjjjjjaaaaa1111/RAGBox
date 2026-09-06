import type { RefObject } from "react";
import MaterialIcon from "../common/MaterialIcon";

type KnowledgeUploadPanelProps = {
  fileInputRef: RefObject<HTMLInputElement>;
  isUploading: boolean;
  uploadMessage: string;
  uploadProgress: number;
  uploadPhase: string;
  onFilesSelected: (files: FileList | null) => void | Promise<void>;
  onOpenFilePicker: () => void;
};

const KnowledgeUploadPanel = ({
  fileInputRef,
  isUploading,
  uploadMessage,
  uploadProgress,
  uploadPhase,
  onFilesSelected,
  onOpenFilePicker,
}: KnowledgeUploadPanelProps) => {
  // 上传阶段内部键到中文展示的映射。
  const uploadPhaseLabels: Record<string, string> = {
    hashing: "计算哈希",
    uploading: "上传中",
    done: "完成",
    failed: "失败",
  };

  return (
    <div className="group flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-slate-100 bg-slate-50/50 p-7 transition-all hover:border-slate-200 md:p-8">
      <div className="mb-3 text-slate-400 transition-colors group-hover:text-black">
        <MaterialIcon name="cloud_upload" className="!text-3xl" />
      </div>
      <h3 className="font-headline mb-1 text-lg font-semibold text-black">上传文件</h3>
      <p className="mb-4 text-sm text-slate-400">拖入或选择 PDF / DOCX / TXT / MD / HTML / XLSX 文件</p>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={(event) => {
          void onFilesSelected(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      <button
        className="rounded-lg bg-black px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isUploading}
        onClick={onOpenFilePicker}
      >
        选择文件
      </button>

      {uploadPhase ? (
        <div className="mt-3 w-full max-w-md">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-black transition-all"
              style={{ width: `${Math.max(0, Math.min(100, uploadProgress))}%` }}
            />
          </div>
          <p className="mt-1.5 text-center text-xs text-slate-500">{`${uploadPhaseLabels[uploadPhase] || uploadPhase} ${uploadProgress}%`}</p>
        </div>
      ) : null}

      {uploadMessage ? <p className="mt-2 text-xs text-slate-500">{uploadMessage}</p> : null}
    </div>
  );
};

export default KnowledgeUploadPanel;