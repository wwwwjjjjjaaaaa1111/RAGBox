import { useEffect, useRef, useState } from "react";
import {
  downloadChartPdf,
  fetchChartPngUrl,
  type ChatMessage,
  type GeneratedChartInfo,
} from "../../api";
import MaterialIcon from "../common/MaterialIcon";
import ChatMarkdown from "./ChatMarkdown";
import CitationChips from "./CitationChips";

type ChatMessageBubbleProps = {
  message: ChatMessage;
};

/**
 * 单张图表卡片：加载内嵌预览图并提供 PDF 下载。
 * 预览图带鉴权头，无法直接 <img src>，需先取 blob 转 object URL。
 */
const ChartCard = ({ chart }: { chart: GeneratedChartInfo }) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [pngError, setPngError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPngUrl(null);
    setPngError(null);

    void (async () => {
      try {
        const url = await fetchChartPngUrl(chart.chartId);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrlRef.current = url;
        setPngUrl(url);
      } catch (error) {
        if (!cancelled) {
          setPngError(error instanceof Error ? error.message : "加载图表失败");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [chart.chartId]);

  async function handleDownload() {
    if (isDownloading) {
      return;
    }

    setIsDownloading(true);
    setDownloadError(null);
    try {
      await downloadChartPdf(chart.chartId, chart.title);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "下载失败");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      {pngUrl && (
        <img src={pngUrl} alt={chart.title} className="w-full rounded-lg border border-slate-100 bg-white" />
      )}
      {!pngUrl && !pngError && (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
          <MaterialIcon name="hourglass_top" className="toast-spin !text-[16px]" />
          正在加载图表…
        </div>
      )}
      {pngError && <p className="text-xs text-red-500">{pngError}</p>}

      <button
        type="button"
        onClick={() => void handleDownload()}
        disabled={isDownloading}
        className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-black hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
      >
        <MaterialIcon name={isDownloading ? "hourglass_top" : "picture_as_pdf"} className="!text-[16px]" />
        {isDownloading ? "下载中…" : `下载图表 PDF · ${chart.title}`}
      </button>
      {downloadError && <span className="text-xs text-red-500">{downloadError}</span>}
    </div>
  );
};

const ChatMessageBubble = ({ message }: ChatMessageBubbleProps) => {
  const isAssistant = message.role === "assistant";
  const charts = message.charts || [];

  return (
    <div className={isAssistant ? "space-y-4" : "flex flex-col items-end space-y-4"}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {isAssistant ? "AI 助手" : "用户提问"}
        </span>
      </div>
      <div
        className={isAssistant
          ? ""
          : "max-w-xl rounded-2xl border border-slate-100 bg-slate-50 px-6 py-4 text-sm text-slate-800 shadow-sm"
        }
      >
        {isAssistant ? <ChatMarkdown content={message.content} /> : message.content}
      </div>

      {isAssistant && charts.map((chart) => (
        <ChartCard key={chart.chartId} chart={chart} />
      ))}

      {isAssistant && message.sources?.length ? <CitationChips sources={message.sources} /> : null}
    </div>
  );
};

export default ChatMessageBubble;
