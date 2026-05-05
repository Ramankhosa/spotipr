-- Drop the countedDate column from patent_drafting_usage
-- Data has been migrated to countedAt via backfill script
-- Table may not exist on fresh/shadow databases (created via db push)

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'patent_drafting_usage') THEN
        DROP INDEX IF EXISTS "patent_drafting_usage_tenantId_countedDate_idx";
        ALTER TABLE "patent_drafting_usage" DROP COLUMN IF EXISTS "countedDate";
    END IF;
END $$;
