ALTER TABLE "drafting_sessions"
ADD COLUMN IF NOT EXISTS "figures_skipped" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "figures_skipped_at" TIMESTAMP(3);
