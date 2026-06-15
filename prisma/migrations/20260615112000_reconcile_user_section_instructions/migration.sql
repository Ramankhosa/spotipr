DO $$
BEGIN
  IF to_regclass('public.user_section_instructions') IS NULL
     OR to_regclass('public.drafting_sessions') IS NULL
     OR to_regclass('public.users') IS NULL
  THEN
    RETURN;
  END IF;

  ALTER TABLE "user_section_instructions"
    ADD COLUMN IF NOT EXISTS "user_id" TEXT;

  UPDATE "user_section_instructions" usi
  SET "user_id" = ds."userId"
  FROM "drafting_sessions" ds
  WHERE usi."session_id" = ds."id"
  AND usi."user_id" IS NULL;

  DELETE FROM "user_section_instructions" WHERE "user_id" IS NULL;

  ALTER TABLE "user_section_instructions"
    ALTER COLUMN "user_id" SET NOT NULL;

  ALTER TABLE "user_section_instructions"
    ALTER COLUMN "session_id" DROP NOT NULL;

  ALTER TABLE "user_section_instructions"
    DROP CONSTRAINT IF EXISTS "user_section_instructions_session_id_jurisdiction_section_ke_key";
  ALTER TABLE "user_section_instructions"
    DROP CONSTRAINT IF EXISTS "user_section_instructions_userId_sessionId_jurisdiction_secti_key";

  DROP INDEX IF EXISTS "user_section_instructions_session_id_section_key_key";
  DROP INDEX IF EXISTS "user_section_instructions_userId_sessionId_jurisdiction_secti_k";

  CREATE UNIQUE INDEX IF NOT EXISTS "user_section_instructions_user_id_session_id_jurisdiction_s_key"
    ON "user_section_instructions"("user_id", "session_id", "jurisdiction", "section_key");

  CREATE INDEX IF NOT EXISTS "user_section_instructions_user_id_idx"
    ON "user_section_instructions"("user_id");

  CREATE INDEX IF NOT EXISTS "user_section_instructions_user_id_jurisdiction_idx"
    ON "user_section_instructions"("user_id", "jurisdiction");

  CREATE INDEX IF NOT EXISTS "user_section_instructions_user_id_session_id_jurisdiction_idx"
    ON "user_section_instructions"("user_id", "session_id", "jurisdiction");

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_section_instructions_user_id_fkey'
  ) THEN
    ALTER TABLE "user_section_instructions"
      ADD CONSTRAINT "user_section_instructions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
