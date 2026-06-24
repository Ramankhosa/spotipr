ALTER TABLE "patent_drafting_jobs"
  ADD COLUMN "autoPatentDraftBatchId" TEXT,
  ADD COLUMN "autoPatentDraftBatchItemId" TEXT,
  ADD COLUMN "autoPatentDraftBatchItemNo" INTEGER;

ALTER TABLE "auto_patent_draft_batches"
  ADD COLUMN "jobIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "auto_patent_draft_batch_items" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT,
  "patentId" TEXT,
  "sessionId" TEXT,
  "jobId" TEXT,
  "itemNo" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "jurisdictions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "currentStep" TEXT,
  "progressPct" INTEGER NOT NULL DEFAULT 5,
  "warnings" JSONB,
  "errorMessage" TEXT,
  "artifactIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "auto_patent_draft_batch_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auto_patent_draft_batch_items_batchId_itemNo_key"
  ON "auto_patent_draft_batch_items"("batchId", "itemNo");

CREATE INDEX "auto_patent_draft_batch_items_batchId_status_idx"
  ON "auto_patent_draft_batch_items"("batchId", "status");

CREATE INDEX "auto_patent_draft_batch_items_jobId_idx"
  ON "auto_patent_draft_batch_items"("jobId");

CREATE INDEX "auto_patent_draft_batch_items_patentId_idx"
  ON "auto_patent_draft_batch_items"("patentId");

CREATE INDEX "patent_drafting_jobs_autoPatentDraftBatchId_autoPatentDraftBatchItemNo_idx"
  ON "patent_drafting_jobs"("autoPatentDraftBatchId", "autoPatentDraftBatchItemNo");

ALTER TABLE "auto_patent_draft_batch_items"
  ADD CONSTRAINT "auto_patent_draft_batch_items_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "auto_patent_draft_batches"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auto_patent_draft_batch_items"
  ADD CONSTRAINT "auto_patent_draft_batch_items_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
