-- AlterTable: Add missing columns to ati_tokens
ALTER TABLE "ati_tokens" ADD COLUMN IF NOT EXISTS "tokenType" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "ati_tokens" ADD COLUMN IF NOT EXISTS "assignedRole" "UserRole";
ALTER TABLE "ati_tokens" ADD COLUMN IF NOT EXISTS "assignedTeamId" TEXT;

-- AddForeignKey (only if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ati_tokens_assignedTeamId_fkey'
    ) THEN
        ALTER TABLE "ati_tokens" ADD CONSTRAINT "ati_tokens_assignedTeamId_fkey" FOREIGN KEY ("assignedTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
