-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('queued', 'running', 'success', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "FileParseStatus" AS ENUM ('pending', 'processing', 'failed', 'indexed');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant');

-- CreateTable
CREATE TABLE "app_users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_model_configs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chat_base_url" TEXT,
    "chat_api_key" TEXT,
    "chat_model" TEXT,
    "embedding_base_url" TEXT,
    "embedding_api_key" TEXT,
    "embedding_model" TEXT,
    "chunk_size" INTEGER,
    "chunk_overlap" INTEGER,
    "retrieval_top_k" INTEGER,
    "retrieval_score_threshold" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_access_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_files" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_md5" TEXT,
    "file_size_bytes" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "parse_status" "FileParseStatus" NOT NULL DEFAULT 'pending',
    "parse_version" INTEGER NOT NULL DEFAULT 1,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "indexed_at" TIMESTAMP(3),
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'queued',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_chunks" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "vector_id" TEXT NOT NULL,
    "collection_name" TEXT NOT NULL,
    "chunk_hash" TEXT NOT NULL,
    "content_preview" TEXT NOT NULL,
    "page_number" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT,
    "file_ids_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "sources_json" TEXT,
    "charts_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_users_username_key" ON "app_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "user_model_configs_user_id_key" ON "user_model_configs"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "idx_auth_sessions_user" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "personal_access_tokens_token_hash_key" ON "personal_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "idx_personal_access_tokens_user" ON "personal_access_tokens"("user_id");

-- CreateIndex
CREATE INDEX "idx_knowledge_files_user_status_uploaded" ON "knowledge_files"("user_id", "parse_status", "uploaded_at");

-- CreateIndex
CREATE UNIQUE INDEX "uk_knowledge_files_user_md5" ON "knowledge_files"("user_id", "content_md5");

-- CreateIndex
CREATE INDEX "idx_ingestion_tasks_user_status_created" ON "ingestion_tasks"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "idx_ingestion_tasks_file" ON "ingestion_tasks"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_chunks_vector_id_key" ON "file_chunks"("vector_id");

-- CreateIndex
CREATE INDEX "idx_file_chunks_file_order" ON "file_chunks"("file_id", "chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "file_chunks_file_id_chunk_index_key" ON "file_chunks"("file_id", "chunk_index");

-- CreateIndex
CREATE INDEX "idx_chat_sessions_user_last_message" ON "chat_sessions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_chat_messages_session_created" ON "chat_messages"("session_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_model_configs" ADD CONSTRAINT "user_model_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_files" ADD CONSTRAINT "knowledge_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_tasks" ADD CONSTRAINT "ingestion_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_tasks" ADD CONSTRAINT "ingestion_tasks_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "knowledge_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "knowledge_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
