ALTER TABLE "drafting_sessions"
ADD COLUMN "normalization_in_progress_at" TIMESTAMP(3),
ADD COLUMN "normalization_request_id" TEXT;
