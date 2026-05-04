ALTER TABLE "drafting_sessions"
ADD COLUMN IF NOT EXISTS "persona_style_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "primary_persona_id" TEXT,
ADD COLUMN IF NOT EXISTS "secondary_persona_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "persona_style_updated_at" TIMESTAMP(3);

