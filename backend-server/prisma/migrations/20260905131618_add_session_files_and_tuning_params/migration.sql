-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN "file_ids_json" TEXT;

-- AlterTable
ALTER TABLE "user_model_configs" ADD COLUMN "chunk_overlap" INTEGER;
ALTER TABLE "user_model_configs" ADD COLUMN "chunk_size" INTEGER;
ALTER TABLE "user_model_configs" ADD COLUMN "retrieval_score_threshold" REAL;
ALTER TABLE "user_model_configs" ADD COLUMN "retrieval_top_k" INTEGER;
