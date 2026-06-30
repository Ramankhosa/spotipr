ALTER TABLE "auto_patent_draft_batch_items"
  ADD COLUMN "generatedTitle" TEXT,
  ADD COLUMN "priorArtAudit" JSONB,
  ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
  ADD COLUMN "attorneyNotes" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedById" TEXT;
