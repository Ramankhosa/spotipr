ALTER TABLE "patent_import_files"
  ADD COLUMN IF NOT EXISTS "warningBreakdown" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "ignoredPageBreakdown" JSONB NOT NULL DEFAULT '{}'::jsonb;
