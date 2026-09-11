-- CreateTable
CREATE TABLE "user_model_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "chat_base_url" TEXT,
    "chat_api_key" TEXT,
    "chat_model" TEXT,
    "embedding_base_url" TEXT,
    "embedding_api_key" TEXT,
    "embedding_model" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_model_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "user_model_configs_user_id_key" ON "user_model_configs"("user_id");
