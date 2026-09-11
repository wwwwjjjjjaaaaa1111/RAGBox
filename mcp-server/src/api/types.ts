/**
 * RAGBox 后端接口的响应类型（与 backend-server 的 DTO 保持一致）。
 */

export type SearchMatch = {
  fileId: string | null;
  fileName: string | null;
  pageNumber: number | null;
  chunkIndex: number | null;
  score: number;
  content: string;
};

export type SearchResult = {
  query: string;
  embeddingModel: string | null;
  matchCount: number;
  matches: SearchMatch[];
};

export type KnowledgeFile = {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  parseStatus: "pending" | "processing" | "failed" | "indexed";
  uploadedAt: string;
};

export type Pagination = {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export type KnowledgeFilesPage = {
  items: KnowledgeFile[];
  pagination: Pagination;
};

export type FileChunk = {
  id: string;
  chunkIndex: number;
  contentPreview: string;
  pageNumber: number | null;
  createdAt: string;
};

export type FileDetail = {
  id: string;
  fileName: string;
  parseStatus: KnowledgeFile["parseStatus"];
  chunkCount: number;
  indexedAt: string | null;
  uploadedAt: string;
  pagination: Pagination;
  chunks: FileChunk[];
};

export type ChatSession = {
  id: string;
  userId: string;
  title?: string | null;
  fileIds?: string[];
  createdAt: string;
  messageCount: number;
};

export type ChatMessageSource = {
  fileId?: string;
  fileName?: string;
  pageNumber?: number | null;
  chunkIndex?: number | null;
  snippet?: string;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sources?: ChatMessageSource[];
};

export type ChartResult = {
  chartId: string;
  title: string;
  chartType: string;
  seriesCount: number;
  pointCount: number;
  pngBase64: string;
};
