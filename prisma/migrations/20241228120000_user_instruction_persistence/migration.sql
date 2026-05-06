-- Migration: Add user-level persistent instructions
-- This migration preserves existing data by:
-- 1. Adding userId column and populating from related session
-- 2. Making sessionId optional
-- 3. Updating unique constraint

-- Step 1: Add userId column as nullable first
ALTER TABLE "user_section_instructions" 
ADD COLUMN IF NOT EXISTS "user_id" TEXT;

-- Step 2: Populate userId from the related drafting_session
-- This ensures existing records get their userId from their session
UPDATE "user_section_instructions" usi
SET "user_id" = ds."userId"
FROM "drafting_sessions" ds
WHERE usi."session_id" = ds."id"
AND usi."user_id" IS NULL;

-- Step 3: For any orphaned records (session deleted), try to get userId from patent owner via session
UPDATE "user_section_instructions" usi
SET "user_id" = (
  SELECT ds."userId" 
  FROM "drafting_sessions" ds
  WHERE ds."id" = usi."session_id"
  LIMIT 1
)
WHERE usi."user_id" IS NULL;

-- Step 4: Delete any records that still don't have a userId (truly orphaned)
DELETE FROM "user_section_instructions" WHERE "user_id" IS NULL;

-- Step 5: Now make userId NOT NULL
ALTER TABLE "user_section_instructions" 
ALTER COLUMN "user_id" SET NOT NULL;

-- Step 6: Make sessionId nullable (to support user-level persistent instructions)
ALTER TABLE "user_section_instructions" 
ALTER COLUMN "session_id" DROP NOT NULL;

-- Step 7: Drop the old unique constraint
ALTER TABLE "user_section_instructions" 
DROP CONSTRAINT IF EXISTS "user_section_instructions_session_id_jurisdiction_section_ke_key";

-- Step 8: Create the new unique constraint that includes userId
-- This allows both session-level (sessionId not null) and user-level (sessionId null) instructions
ALTER TABLE "user_section_instructions" 
ADD CONSTRAINT "user_section_instructions_userId_sessionId_jurisdiction_secti_key" 
UNIQUE ("user_id", "session_id", "jurisdiction", "section_key");

-- Step 9: Add indexes for better query performance
CREATE INDEX IF NOT EXISTS "user_section_instructions_user_id_idx" 
ON "user_section_instructions"("user_id");

CREATE INDEX IF NOT EXISTS "user_section_instructions_user_id_jurisdiction_idx" 
ON "user_section_instructions"("user_id", "jurisdiction");

CREATE INDEX IF NOT EXISTS "user_section_instructions_user_id_session_id_jurisdiction_idx" 
ON "user_section_instructions"("user_id", "session_id", "jurisdiction");

-- Step 10: Add foreign key constraint to users table
ALTER TABLE "user_section_instructions"
ADD CONSTRAINT "user_section_instructions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
