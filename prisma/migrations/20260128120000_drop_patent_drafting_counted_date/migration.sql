-- Drop the countedDate column from patent_drafting_usage
-- Data has been migrated to countedAt via backfill script

-- Drop the index first
DROP INDEX IF EXISTS "patent_drafting_usage_tenantId_countedDate_idx";

-- Drop the column
ALTER TABLE "patent_drafting_usage" DROP COLUMN IF EXISTS "countedDate";
