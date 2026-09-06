import { Prisma } from "@prisma/client";
import { createApiError } from "../common/errors";
import { access, mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as fileRepository from "../repositories/file.repository";
import * as taskRepository from "../repositories/task.repository";
import * as aiService from "./ai.service";
import * as modelConfigService from "./modelConfig.service";
import { publishIngestionEvent, subscribeToIngestionEvents } from "./ingestionEvents";

const uploadDir = path.resolve(process.cwd(), "upload");
const uploadTmpDir = path.resolve(uploadDir, "tmp");
const uploadChunkRootDir = path.resolve(uploadDir, "chunks");
const cjkFileNameRegex = /[\u3400-\u9fff\uf900-\ufaff]/u;

// 允许入库的文件扩展名白名单（与 AI-server document_loader 的支持范围保持一致）。
const ALLOWED_UPLOAD_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md", ".markdown", ".html", ".htm", ".xlsx"]);
const ALLOWED_EXTENSIONS_LABEL = "PDF / DOCX / TXT / MD / HTML / XLSX";

/**
 * 校验上传文件的扩展名与文件头魔数是否匹配，拦截伪装扩展名的恶意内容。
 * @param tempFilePath 临时文件路径。
 * @param originalName 原始文件名。
 * @throws VALIDATION_ERROR 当扩展名不在白名单或内容与类型不符时抛出。
 */
async function validateUploadedFile(tempFilePath: string, originalName: string) {
  const ext = path.extname(originalName || "").toLowerCase();
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    throw createApiError(400, "UNSUPPORTED_FILE_TYPE", `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS_LABEL}`);
  }

  const handle = await open(tempFilePath, "r");
  try {
    const { buffer } = await handle.read({
      buffer: Buffer.alloc(8),
      position: 0,
      length: 8,
    });

    // 二进制格式校验魔数；文本格式校验非空即可（编码问题由 AI-server 加载阶段兜底）。
    if (ext === ".pdf") {
      if (!buffer.subarray(0, 4).toString("latin1").startsWith("%PDF")) {
        throw createApiError(400, "INVALID_FILE_CONTENT", "File content does not match the declared type");
      }
      return;
    }

    if (ext === ".docx" || ext === ".xlsx") {
      // Office OOXML 均为 ZIP 容器。
      if (buffer.subarray(0, 4).toString("latin1") !== "PK\x03\x04") {
        throw createApiError(400, "INVALID_FILE_CONTENT", "File content does not match the declared type");
      }
      return;
    }

    if (buffer.length === 0) {
      throw createApiError(400, "INVALID_FILE_CONTENT", "File is empty");
    }
  } finally {
    await handle.close();
  }
}

type FileParseStatus = "pending" | "processing" | "failed" | "indexed";
type TaskStatus = "queued" | "running" | "success" | "failed" | "cancelled";

export type KnowledgeFileListItem = {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  parseStatus: FileParseStatus;
  chunkCount: number;
  indexedAt: Date | null;
  uploadedAt: Date;
};

type IngestionChunkSyncInput = {
  taskId: string;
  fileId: string;
  userId: string;
  collectionName: string;
  parseVersion: number;
  chunks: Array<{
    chunkIndex: number;
    vectorId: string;
    chunkHash: string;
    contentPreview: string;
    pageNumber: number | null;
  }>;
};

export type KnowledgeFileListResponse = {
  items: KnowledgeFileListItem[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
};

export type KnowledgeFileDetail = {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  parseStatus: FileParseStatus;
  parseVersion: number;
  chunkCount: number;
  contentMd5: string | null;
  storagePath: string;
  indexedAt: Date | null;
  uploadedAt: Date;
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
  chunks: Array<{
    id: string;
    chunkIndex: number;
    vectorId: string;
    collectionName: string;
    chunkHash: string;
    contentPreview: string;
    pageNumber: number | null;
    createdAt: Date;
  }>;
};

export type UploadedFileResult = {
  file: {
    id: string;
    fileName: string;
    fileSizeBytes: number;
    parseStatus: FileParseStatus;
    uploadedAt: Date;
  };
};

type ChunkUploadManifest = {
  uploadId: string;
  userId: string;
  fileName: string;
  fileSizeBytes: number;
  totalChunks: number;
  receivedChunks: number[];
  createdAt: string;
};

function normalizeUploadedFileName(fileName: string) {
  if (!fileName || cjkFileNameRegex.test(fileName)) {
    return fileName;
  }

  const decoded = Buffer.from(fileName, "latin1").toString("utf8");
  if (decoded.includes("\uFFFD")) {
    return fileName;
  }

  return cjkFileNameRegex.test(decoded) ? decoded : fileName;
}

function mapTaskStatusToFileStatus(status: TaskStatus): FileParseStatus {
  switch (status) {
    case "queued":
      return "pending";
    case "running":
      return "processing";
    case "success":
      return "indexed";
    case "failed":
    case "cancelled":
      return "failed";
  }
}

function normalizeFileParseStatus(status: string): FileParseStatus {
  switch (status) {
    case "pending":
    case "processing":
    case "failed":
    case "indexed":
      return status;
    case "queued":
    case "running":
    case "success":
    case "cancelled":
      return mapTaskStatusToFileStatus(status);
    default:
      return "failed";
  }
}

function toKnowledgeFileListItem(file: {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  parseStatus: string;
  chunkCount: number;
  indexedAt: Date | null;
  uploadedAt: Date;
}): KnowledgeFileListItem {
  return {
    id: file.id,
    fileName: file.fileName,
    fileSizeBytes: file.fileSizeBytes,
    parseStatus: normalizeFileParseStatus(file.parseStatus),
    chunkCount: file.chunkCount,
    indexedAt: file.indexedAt,
    uploadedAt: file.uploadedAt,
  };
}

function toUploadedFileResult(file: { id: string; fileName: string; fileSizeBytes: number; parseStatus: string; uploadedAt: Date }): UploadedFileResult {
  return {
    file: {
      id: file.id,
      fileName: file.fileName,
      fileSizeBytes: file.fileSizeBytes,
      parseStatus: normalizeFileParseStatus(file.parseStatus),
      uploadedAt: file.uploadedAt,
    },
  };
}

function toIngestionTaskItem(task: { id: string; status: string; progress: number; errorMessage: string | null }) {
  return {
    id: task.id,
    status: task.status,
    progress: task.progress,
    errorMessage: task.errorMessage,
  };
}

function publishTaskAndFileUpdate(
  userId: string,
  payload: {
    file: {
      id: string;
      fileName: string;
      fileSizeBytes: number;
      parseStatus: string;
      chunkCount: number;
      indexedAt: Date | null;
      uploadedAt: Date;
    };
    task?: {
      id: string;
      status: string;
      progress: number;
      errorMessage: string | null;
    };
  },
) {
  publishIngestionEvent(userId, {
    type: "ingestion.updated",
    file: toKnowledgeFileListItem(payload.file),
    task: payload.task ? toIngestionTaskItem(payload.task) : undefined,
  });
}

/**
 * 计算某个上传会话对应的分片目录绝对路径。
 * @param uploadId 上传会话 ID。
 * @returns 分片目录绝对路径。
 */
function getChunkSessionDir(uploadId: string) {
  return path.resolve(uploadChunkRootDir, uploadId);
}

/**
 * 计算某个上传会话对应的清单文件路径。
 * @param uploadId 上传会话 ID。
 * @returns manifest 文件绝对路径。
 */
function getChunkManifestPath(uploadId: string) {
  return path.resolve(uploadChunkRootDir, `${uploadId}.json`);
}

/**
 * 计算某个用户对应的正式文件存储目录。
 * @param userId 用户 ID。
 * @returns 用户目录绝对路径。
 */
function getUserUploadDir(userId: string) {
  return path.resolve(uploadDir, userId);
}

function toDispatchErrorMessage(error: unknown) {
  const reason = error instanceof Error ? error.message : "Unknown error";
  return `Failed to dispatch ingestion job: ${reason}`;
}

/**
 * 组装入库派发用的模型凭据覆盖（入库只消费 embedding 段）。
 * @param userId 用户 ID。
 * @returns embedding 凭据覆盖或 undefined。
 */
async function resolveEmbeddingOverride(userId: string): Promise<aiService.AiModelConfigOverride | undefined> {
  const config = await modelConfigService.getInternalModelConfig(userId);
  if (!config) {
    return undefined;
  }

  return {
    embeddingBaseUrl: config.embeddingBaseUrl,
    embeddingApiKey: config.embeddingApiKey,
    embeddingModel: config.embeddingModel,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
  };
}

/**
 * AI 服务派发失败时，把任务与文件标记为 failed 并广播事件。
 * 状态保持可重试（failed 文件允许再次 Dispatch），避免任务永久卡在 queued。
 * @param taskId 任务 ID。
 * @param message 失败原因。
 * @returns 无返回值。
 */
async function markIngestionDispatchFailure(taskId: string, message: string) {
  const task = await taskRepository.findTaskById(taskId);
  // Do not overwrite a task the AI service already picked up or finished.
  if (!task || task.status === "running" || task.status === "success") {
    return;
  }

  const updatedTask = await taskRepository.updateTaskById(taskId, {
    status: "failed",
    progress: 0,
    errorMessage: message,
  });

  const file = await fileRepository.findFileById(task.fileId);
  if (file) {
    const updatedFile = await fileRepository.updateFileById(file.id, {
      parseStatus: "failed",
      indexedAt: null,
    });
    publishTaskAndFileUpdate(updatedFile.userId, {
      file: updatedFile,
      task: updatedTask,
    });
  }
}

/**
 * 基于已落盘的 .part 文件计算当前会话已收到的分片索引。
 * @param uploadId 上传会话 ID。
 * @param totalChunks 总分片数，用于过滤非法分片名。
 * @returns 已上传分片索引数组（升序）。
 */
async function collectReceivedChunkIndices(uploadId: string, totalChunks: number) {
  const sessionDir = getChunkSessionDir(uploadId);

  try {
    const entries = await readdir(sessionDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".part"))
      .map((entry) => Number.parseInt(entry.name.slice(0, -5), 10))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < totalChunks)
      .sort((left, right) => left - right);
  } catch {
    return [];
  }
}

/**
 * 读取分片上传清单。
 * @param uploadId 上传会话 ID。
 * @returns 分片清单对象。
 * @throws UPLOAD_SESSION_NOT_FOUND 当上传会话不存在时抛出。
 */
async function readChunkManifest(uploadId: string): Promise<ChunkUploadManifest> {
  const manifestPath = getChunkManifestPath(uploadId);
  try {
    const content = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(content) as ChunkUploadManifest;
    const receivedChunks = await collectReceivedChunkIndices(uploadId, parsed.totalChunks);

    return {
      ...parsed,
      receivedChunks,
    };
  } catch {
    throw createApiError(404, "UPLOAD_SESSION_NOT_FOUND", "Upload session not found");
  }
}

/**
 * 持久化分片上传清单到磁盘。
 * @param manifest 分片清单对象。
 * @returns 无返回值。
 */
async function writeChunkManifest(manifest: ChunkUploadManifest) {
  await mkdir(uploadChunkRootDir, { recursive: true });
  await writeFile(getChunkManifestPath(manifest.uploadId), JSON.stringify(manifest), "utf8");
}

/**
 * 处理已落盘的临时文件：计算 MD5、写入正式文件并创建任务。
 * @param payload 处理参数（用户 ID、临时文件路径、原始文件名、文件大小）。
 * @returns 新创建的文件记录。
 */
async function processUploadedTempFile(payload: { userId: string; tempFilePath: string; originalName: string; sizeBytes: number }) {
  const normalizedOriginalName = normalizeUploadedFileName(payload.originalName);

  try {
    await validateUploadedFile(payload.tempFilePath, normalizedOriginalName);
  } catch (error) {
    // 校验失败时清理临时文件再抛出，避免垃圾残留。
    await unlink(payload.tempFilePath).catch(() => {
      // Ignore cleanup errors.
    });
    throw error;
  }

  const contentMd5 = await computeFileMd5(payload.tempFilePath);
  const ext = path.extname(normalizedOriginalName || "") || ".bin";
  const storageRelativePath = path.join("upload", payload.userId, `${contentMd5}${ext}`).replace(/\\/g, "/");
  const storageAbsolutePath = path.resolve(process.cwd(), storageRelativePath);

  await mkdir(getUserUploadDir(payload.userId), { recursive: true });

  let movedToStorage = false;
  try {
    await access(storageAbsolutePath);
    await unlink(payload.tempFilePath).catch(() => {
      // If target already exists, drop temp file.
    });
  } catch {
    await rename(payload.tempFilePath, storageAbsolutePath);
    movedToStorage = true;
  }

  let result;
  try {
    result = await fileRepository.createFileAndTask({
      userId: payload.userId,
      fileName: normalizedOriginalName,
      contentMd5,
      fileSizeBytes: payload.sizeBytes,
      storagePath: storageRelativePath,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      if (movedToStorage) {
        await unlink(storageAbsolutePath).catch(() => {
          // Ignore cleanup errors for duplicate uploads.
        });
      }

      throw createApiError(409, "FILE_ALREADY_EXISTS", "File already exists for current user", [{ path: "contentMd5", message: "Duplicate file. Call precheck before upload." }]);
    }

    throw error;
  }

  // Fire-and-forget dispatch: upload call returns success immediately.
  // Failures are recorded on the task/file so the UI can prompt a retry.
  const embeddingOverride = await resolveEmbeddingOverride(payload.userId);
  void aiService.dispatchIngestionTask({
    taskId: result.task.id,
    fileId: result.file.id,
    userId: result.file.userId,
    fileName: result.file.fileName,
    fileExt: ext,
    fileSizeBytes: result.file.fileSizeBytes,
    contentMd5,
    storagePath: result.file.storagePath,
    absoluteFilePath: storageAbsolutePath,
    parseVersion: result.file.parseVersion,
    modelConfig: embeddingOverride,
  }).catch(async (error: unknown) => {
    await markIngestionDispatchFailure(result.task.id, toDispatchErrorMessage(error));
  });

  publishTaskAndFileUpdate(result.file.userId, {
    file: result.file,
    task: {
      ...result.task,
      errorMessage: result.task.errorMessage,
    },
  });

  return result.file;
}

/**
 * 以流式方式计算文件 MD5，避免大文件占用过多内存。
 * @param filePath 文件绝对路径。
 * @returns 小写十六进制 MD5 字符串。
 */
async function computeFileMd5(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const md5 = crypto.createHash("md5");
    const stream = createReadStream(filePath);

    stream.on("data", (chunk) => md5.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(md5.digest("hex")));
  });
}

/**
 * 上传前检查当前用户是否已存在相同内容文件。
 * @param payload 预检参数。
 * @returns 去重命中结果与已有文件摘要。
 */
export async function precheckFileUpload(payload: { userId: string; contentMd5: string }) {
  const file = await fileRepository.findByUserIdAndMd5(payload.userId, payload.contentMd5);

  return {
    exists: Boolean(file),
    file: file
      ? {
          id: file.id,
          fileName: file.fileName,
          parseStatus: file.parseStatus,
          uploadedAt: file.uploadedAt,
        }
      : null,
  };
}

/**
 * 创建文件与任务记录，并触发异步 ingestion 流程。
 * @param payload 上传参数（用户 ID 与文件二进制）。
 * @returns 上传成功后的文件摘要。
 */
export async function uploadFile(payload: { userId: string; file: Express.Multer.File }) {
  if (!payload.file.path) {
    throw createApiError(500, "UPLOAD_STORAGE_ERROR", "Upload file path not available");
  }

  const file = await processUploadedTempFile({
    userId: payload.userId,
    tempFilePath: payload.file.path,
    originalName: payload.file.originalname,
    sizeBytes: payload.file.size,
  });

  return toUploadedFileResult(file);
}

/**
 * 初始化分片上传会话。
 * @param payload 初始化参数。
 * @returns uploadId 与已上传分片索引。
 */
export async function initChunkUpload(payload: { uploadId: string; userId: string; fileName: string; fileSizeBytes: number; totalChunks: number }) {
  const uploadId = payload.uploadId;
  const normalizedFileName = normalizeUploadedFileName(payload.fileName);

  try {
    const existed = await readChunkManifest(uploadId);
    if (existed.userId !== payload.userId || existed.fileName !== normalizedFileName || existed.fileSizeBytes !== payload.fileSizeBytes) {
      throw createApiError(409, "UPLOAD_SESSION_CONFLICT", "Upload session already exists with different file metadata");
    }

    return {
      uploadId,
      totalChunks: existed.totalChunks,
      uploadedChunks: existed.receivedChunks,
    };
  } catch (error) {
    if ((error as { code?: string })?.code && (error as { code?: string }).code !== "UPLOAD_SESSION_NOT_FOUND") {
      throw error;
    }
  }

  await mkdir(getChunkSessionDir(uploadId), { recursive: true });

  const manifest: ChunkUploadManifest = {
    uploadId,
    userId: payload.userId,
    fileName: normalizedFileName,
    fileSizeBytes: payload.fileSizeBytes,
    totalChunks: payload.totalChunks,
    receivedChunks: [],
    createdAt: new Date().toISOString(),
  };

  await writeChunkManifest(manifest);
  return {
    uploadId,
    totalChunks: payload.totalChunks,
    uploadedChunks: [],
  };
}

/**
 * 写入单个分片并记录上传进度。
 * @param payload 分片上传参数。
 * @returns 当前上传进度信息。
 */
export async function uploadChunk(payload: { uploadId: string; chunkIndex: number; file: Express.Multer.File }) {
  if (!payload.file.path) {
    throw createApiError(500, "UPLOAD_STORAGE_ERROR", "Upload file path not available");
  }

  const manifest = await readChunkManifest(payload.uploadId);
  if (payload.chunkIndex >= manifest.totalChunks) {
    throw createApiError(400, "VALIDATION_ERROR", "Invalid request body", [{ path: "chunkIndex", message: "Out of range" }]);
  }

  const chunkTargetPath = path.resolve(getChunkSessionDir(payload.uploadId), `${payload.chunkIndex}.part`);
  await rename(payload.file.path, chunkTargetPath);

  manifest.receivedChunks = await collectReceivedChunkIndices(payload.uploadId, manifest.totalChunks);
  await writeChunkManifest(manifest);

  return {
    uploadId: payload.uploadId,
    totalChunks: manifest.totalChunks,
    uploadedChunks: manifest.receivedChunks,
  };
}

/**
 * 查询分片上传状态，供断点续传。
 * @param uploadId 上传会话 ID。
 * @returns 上传进度信息。
 */
export async function getChunkUploadStatus(uploadId: string) {
  const manifest = await readChunkManifest(uploadId);
  return {
    uploadId,
    totalChunks: manifest.totalChunks,
    uploadedChunks: manifest.receivedChunks,
  };
}

/**
 * 合并分片并完成上传流程（去重入库+异步向量化）。
 * @param uploadId 上传会话 ID。
 * @returns 上传成功后的文件摘要。
 */
export async function completeChunkUpload(uploadId: string) {
  const manifest = await readChunkManifest(uploadId);
  for (let index = 0; index < manifest.totalChunks; index += 1) {
    if (!manifest.receivedChunks.includes(index)) {
      throw createApiError(400, "CHUNK_UPLOAD_INCOMPLETE", "Chunk upload incomplete", [{ path: "uploadId", message: `Missing chunk index ${index}` }]);
    }
  }

  await mkdir(uploadTmpDir, { recursive: true });
  const ext = path.extname(manifest.fileName || "") || ".bin";
  const mergedFilePath = path.resolve(uploadTmpDir, `${uploadId}_merged${ext}`);
  const handle = await open(mergedFilePath, "w");

  try {
    for (let index = 0; index < manifest.totalChunks; index += 1) {
      const chunkPath = path.resolve(getChunkSessionDir(uploadId), `${index}.part`);
      const bytes = await readFile(chunkPath);
      await handle.write(bytes);
    }
  } finally {
    await handle.close();
  }

  const mergedStat = await stat(mergedFilePath);
  const file = await processUploadedTempFile({
    userId: manifest.userId,
    tempFilePath: mergedFilePath,
    originalName: manifest.fileName,
    sizeBytes: Number(mergedStat.size),
  });

  await rm(getChunkSessionDir(uploadId), { recursive: true, force: true });
  await unlink(getChunkManifestPath(uploadId)).catch(() => {
    // Ignore manifest cleanup errors.
  });

  return toUploadedFileResult(file);
}

/**
 * 查询用户下的文件列表。
 * @param query 查询条件（用户 ID、解析状态、分页上限）。
 * @returns 文件列表数组。
 */
export async function getFiles(query: { userId: string; parseStatus?: FileParseStatus; page: number; limit: number }): Promise<KnowledgeFileListResponse> {
  const { items, total } = await fileRepository.listFiles(
    {
      userId: query.userId,
      parseStatus: query.parseStatus,
    },
    query.page,
    query.limit,
  );

  const totalPages = Math.max(1, Math.ceil(total / query.limit));

  return {
    items: items.map(toKnowledgeFileListItem),
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems: total,
      totalPages,
      hasPreviousPage: query.page > 1,
      hasNextPage: query.page < totalPages,
    },
  };
}

export async function getFileDetail(payload: { userId: string; fileId: string; page: number; limit: number }): Promise<KnowledgeFileDetail> {
  const file = await fileRepository.findFileDetailById(payload.fileId);
  if (!file) {
    throw createApiError(404, "FILE_NOT_FOUND", "File not found");
  }

  if (file.userId !== payload.userId) {
    throw createApiError(403, "FILE_ACCESS_DENIED", "File does not belong to current user");
  }

  const chunkPage = await fileRepository.listFileChunksByFileId(payload.fileId, payload.page, payload.limit);
  const totalPages = Math.max(1, Math.ceil(chunkPage.total / payload.limit));

  return {
    id: file.id,
    fileName: file.fileName,
    fileSizeBytes: file.fileSizeBytes,
    parseStatus: normalizeFileParseStatus(file.parseStatus),
    parseVersion: file.parseVersion,
    chunkCount: file.chunkCount,
    contentMd5: file.contentMd5,
    storagePath: file.storagePath,
    indexedAt: file.indexedAt,
    uploadedAt: file.uploadedAt,
    pagination: {
      page: payload.page,
      limit: payload.limit,
      totalItems: chunkPage.total,
      totalPages,
      hasPreviousPage: payload.page > 1,
      hasNextPage: payload.page < totalPages,
    },
    chunks: chunkPage.items.map((chunk) => ({
      id: chunk.id,
      chunkIndex: chunk.chunkIndex,
      vectorId: chunk.vectorId,
      collectionName: chunk.collectionName,
      chunkHash: chunk.chunkHash,
      contentPreview: chunk.contentPreview,
      pageNumber: chunk.pageNumber,
      createdAt: chunk.createdAt,
    })),
  };
}

/**
 * 把单个进行中任务标记为"被中断"并同步文件状态、广播事件。
 * 仅当任务仍处于 queued/running 时生效，避免覆盖 AI-server 已回写的最终状态。
 * @param taskId 任务 ID。
 * @param message 中断原因。
 */
async function failIngestionTaskAsInterrupted(taskId: string, message: string) {
  const task = await taskRepository.findTaskById(taskId);
  if (!task || (task.status !== "queued" && task.status !== "running")) {
    return;
  }

  const updatedTask = await taskRepository.updateTaskById(taskId, {
    status: "failed",
    progress: 0,
    errorMessage: message,
  });

  const file = await fileRepository.findFileById(task.fileId);
  if (!file) {
    return;
  }

  const updatedFile = file.parseStatus === "processing"
    ? await fileRepository.updateFileById(file.id, { parseStatus: "failed", indexedAt: null })
    : file;

  publishTaskAndFileUpdate(updatedFile.userId, {
    file: updatedFile,
    task: updatedTask,
  });
}

/**
 * 收割被中断的入库任务并返回处理数量。
 * - 启动清扫：maxAgeMinutes=0 时收割全部 queued/running 任务（上次运行遗留，不会有人再推进它们；
 *   若 AI-server 仍在处理并回调，后续回调会自动把状态改回真实值，此标记是安全的临时占位）。
 * - 运行中超时收割：maxAgeMinutes>0 时仅收割 updatedAt 早于阈值的任务（AI-server 中途崩溃的场景，
 *   活跃任务每个批次回调都会刷新 updatedAt，因此不会被误伤）。
 * @param maxAgeMinutes 任务无进展的最长分钟数；0 表示不限（用于启动清扫）。
 * @returns 收割的任务数量。
 */
export async function failInterruptedIngestionTasks(maxAgeMinutes = 0) {
  const cutoff = maxAgeMinutes > 0 ? new Date(Date.now() - maxAgeMinutes * 60_000) : undefined;
  const tasks = await taskRepository.findTasksInProgress(cutoff);
  const message = maxAgeMinutes > 0
    ? "任务长时间无进展，已自动标记为失败，请重新入库"
    : "服务重启导致任务中断，请重新入库";

  for (const task of tasks) {
    await failIngestionTaskAsInterrupted(task.id, message);
  }

  return tasks.length;
}

/**
 * 查询单个 ingestion 任务（仅限任务所属用户）。
 * @param taskId 任务 ID。
 * @param userId 当前认证用户 ID。
 * @returns 任务详情。
 * @throws TASK_NOT_FOUND 当任务不存在或不属于当前用户时抛出。
 */
export async function getTask(taskId: string, userId: string) {
  const task = await taskRepository.findTaskById(taskId);
  if (!task || task.userId !== userId) {
    throw createApiError(404, "TASK_NOT_FOUND", "Task not found");
  }
  return task;
}

export async function dispatchPendingFileIngestion(payload: { userId: string; fileId: string }) {
  const file = await fileRepository.findFileById(payload.fileId);
  if (!file) {
    throw createApiError(404, "FILE_NOT_FOUND", "File not found");
  }

  if (file.userId !== payload.userId) {
    throw createApiError(403, "FILE_ACCESS_DENIED", "File does not belong to current user");
  }

  if (file.parseStatus !== "pending" && file.parseStatus !== "failed") {
    throw createApiError(409, "FILE_STATUS_INVALID", "Only pending or failed files can start ingestion");
  }

  const task = await taskRepository.findLatestTaskByFileId(file.id);
  if (!task) {
    throw createApiError(404, "TASK_NOT_FOUND", "Task not found");
  }

  const queuedTask = await taskRepository.updateTaskById(task.id, {
    status: "queued",
    progress: 0,
    errorMessage: null,
  });

  publishTaskAndFileUpdate(file.userId, {
    file,
    task: queuedTask,
  });

  const fileExt = path.extname(file.fileName || "") || ".bin";
  const absoluteFilePath = path.resolve(process.cwd(), file.storagePath);
  const embeddingOverride = await resolveEmbeddingOverride(payload.userId);

  void aiService.dispatchIngestionTask({
    taskId: queuedTask.id,
    fileId: file.id,
    userId: file.userId,
    fileName: file.fileName,
    fileExt,
    fileSizeBytes: file.fileSizeBytes,
    contentMd5: file.contentMd5 || "",
    storagePath: file.storagePath,
    absoluteFilePath,
    parseVersion: file.parseVersion,
    modelConfig: embeddingOverride,
  }).catch(async (error: unknown) => {
    await markIngestionDispatchFailure(queuedTask.id, toDispatchErrorMessage(error));
  });

  return {
    accepted: true,
    file: toKnowledgeFileListItem(file),
    task: toIngestionTaskItem(queuedTask),
  };
}

export async function offloadIndexedFile(payload: { userId: string; fileId: string }) {
  const file = await fileRepository.findFileById(payload.fileId);
  if (!file) {
    throw createApiError(404, "FILE_NOT_FOUND", "File not found");
  }

  if (file.userId !== payload.userId) {
    throw createApiError(403, "FILE_ACCESS_DENIED", "File does not belong to current user");
  }

  if (file.parseStatus !== "indexed") {
    throw createApiError(409, "FILE_STATUS_INVALID", "Only indexed files can be offloaded");
  }

  await aiService.deleteFileVectors(file.id);

  const latestTask = await taskRepository.findLatestTaskByFileId(file.id);
  const updatedTask = latestTask
    ? await taskRepository.updateTaskById(latestTask.id, {
        status: "cancelled",
        progress: 0,
        errorMessage: null,
      })
    : undefined;

  const updatedFile = await fileRepository.resetIndexedFileToPending(file.id);

  publishTaskAndFileUpdate(updatedFile.userId, {
    file: updatedFile,
    task: updatedTask,
  });

  return {
    success: true,
    file: toKnowledgeFileListItem(updatedFile),
    task: updatedTask ? toIngestionTaskItem(updatedTask) : null,
  };
}

export async function deleteKnowledgeFile(payload: { userId: string; fileId: string }) {
  const file = await fileRepository.findFileById(payload.fileId);
  if (!file) {
    throw createApiError(404, "FILE_NOT_FOUND", "File not found");
  }

  if (file.userId !== payload.userId) {
    throw createApiError(403, "FILE_ACCESS_DENIED", "File does not belong to current user");
  }

  if (file.parseStatus === "processing") {
    throw createApiError(409, "FILE_STATUS_INVALID", "Processing files cannot be deleted");
  }

  if (file.parseStatus === "indexed" || file.chunkCount > 0) {
    await aiService.deleteFileVectors(file.id);
  }

  const absoluteFilePath = path.resolve(process.cwd(), file.storagePath);
  await unlink(absoluteFilePath).catch(() => {
    // Ignore missing physical files so metadata cleanup can still finish.
  });

  const deletedFile = await fileRepository.deleteFileById(file.id);

  publishIngestionEvent(deletedFile.userId, {
    type: "knowledge.deleted",
    file: toKnowledgeFileListItem(deletedFile),
  });

  return {
    success: true,
    fileId: deletedFile.id,
  };
}

/**
 * 处理 AI 服务回调并同步更新任务与文件向量化状态。
 * @param payload AI 回调参数。
 * @returns 更新后的任务和文件记录。
 * @throws TASK_NOT_FOUND 当任务不存在时抛出。
 */
export async function handleIngestionCallback(payload: { taskId: string; fileId?: string; status: TaskStatus; progress?: number; chunkCount?: number | null; errorMessage?: string | null }) {
  const task = await taskRepository.findTaskById(payload.taskId);
  if (!task) {
    throw createApiError(404, "TASK_NOT_FOUND", "Task not found");
  }

  if (payload.fileId && payload.fileId !== task.fileId) {
    throw createApiError(409, "TASK_FILE_MISMATCH", "Task does not belong to the provided file");
  }

  const progress = payload.progress ?? (payload.status === "success" ? 100 : task.progress);
  const updatedTask = await taskRepository.updateTaskById(payload.taskId, {
    status: payload.status,
    progress,
    errorMessage: payload.errorMessage ?? null,
  });

  const updatedFile = await fileRepository.updateFileById(task.fileId, {
    parseStatus: mapTaskStatusToFileStatus(payload.status),
    chunkCount: payload.chunkCount ?? undefined,
    indexedAt: payload.status === "success" ? new Date() : payload.status === "failed" ? null : undefined,
  });

  publishTaskAndFileUpdate(updatedFile.userId, {
    file: updatedFile,
    task: updatedTask,
  });

  return {
    task: updatedTask,
    file: updatedFile,
  };
}

export async function syncIngestionChunks(payload: IngestionChunkSyncInput) {
  const task = await taskRepository.findTaskById(payload.taskId);
  if (!task) {
    throw createApiError(404, "TASK_NOT_FOUND", "Task not found");
  }

  if (task.fileId !== payload.fileId || task.userId !== payload.userId) {
    throw createApiError(409, "TASK_FILE_MISMATCH", "Task does not match the provided file or user");
  }

  const file = await fileRepository.findFileById(payload.fileId);
  if (!file) {
    throw createApiError(404, "FILE_NOT_FOUND", "File not found");
  }

  await fileRepository.replaceFileChunks(
    payload.fileId,
    payload.chunks.map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      vectorId: chunk.vectorId,
      collectionName: payload.collectionName,
      chunkHash: chunk.chunkHash,
      contentPreview: chunk.contentPreview,
      pageNumber: chunk.pageNumber,
    })),
  );

  const updatedFile = await fileRepository.updateFileById(payload.fileId, {
    parseVersion: payload.parseVersion,
    chunkCount: payload.chunks.length,
  });

  const updatedTask = await taskRepository.updateTaskById(payload.taskId, {
    status: "running",
    progress: Math.max(task.progress, 85),
  });

  publishTaskAndFileUpdate(updatedFile.userId, {
    file: updatedFile,
    task: updatedTask,
  });

  return {
    chunkCount: payload.chunks.length,
    file: updatedFile,
    task: updatedTask,
  };
}

export function streamFileEvents(userId: string, response: import("express").Response) {
  subscribeToIngestionEvents(userId, response);
}
