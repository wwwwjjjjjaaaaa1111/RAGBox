/*
  Warnings:

  - You are about to drop the column `browser_fingerprint_hash` on the `app_users` table. All the data in the column will be lost.
  - Added the required column `password_hash` to the `app_users` table without a default value. This is not possible if the table is not empty.
  - Added the required column `username` to the `app_users` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN "sources_json" TEXT;

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_app_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_app_users" ("created_at", "id") SELECT "created_at", "id" FROM "app_users";
DROP TABLE "app_users";
ALTER TABLE "new_app_users" RENAME TO "app_users";
CREATE UNIQUE INDEX "app_users_username_key" ON "app_users"("username");
CREATE TABLE "new_knowledge_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_md5" TEXT,
    "file_size_bytes" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "parse_status" TEXT NOT NULL DEFAULT 'pending',
    "parse_version" INTEGER NOT NULL DEFAULT 1,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "indexed_at" DATETIME,
    "uploaded_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_knowledge_files" ("content_md5", "file_name", "file_size_bytes", "id", "parse_status", "storage_path", "uploaded_at", "user_id") SELECT "content_md5", "file_name", "file_size_bytes", "id", "parse_status", "storage_path", "uploaded_at", "user_id" FROM "knowledge_files";
DROP TABLE "knowledge_files";
ALTER TABLE "new_knowledge_files" RENAME TO "knowledge_files";
CREATE INDEX "idx_knowledge_files_user_status_uploaded" ON "knowledge_files"("user_id", "parse_status", "uploaded_at");
CREATE UNIQUE INDEX "uk_knowledge_files_user_md5" ON "knowledge_files"("user_id", "content_md5");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "idx_auth_sessions_user" ON "auth_sessions"("user_id");
