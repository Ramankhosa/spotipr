CREATE TYPE "AutoPatentDraftBatchStatus" AS ENUM (
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED'
);

CREATE TABLE "auto_patent_draft_batches" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT,
  "name" TEXT NOT NULL,
  "sourceFilename" TEXT,
  "status" "AutoPatentDraftBatchStatus" NOT NULL DEFAULT 'QUEUED',
  "totalItems" INTEGER NOT NULL,
  "completedItems" INTEGER NOT NULL DEFAULT 0,
  "failedItems" INTEGER NOT NULL DEFAULT 0,
  "warningItems" INTEGER NOT NULL DEFAULT 0,
  "requestIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "itemSummaries" JSONB,
  "zipDocumentId" TEXT,
  "completionEmailSentAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "auto_patent_draft_batches_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "email_draft_requests"
  ADD COLUMN "autoPatentDraftBatchId" TEXT,
  ADD COLUMN "autoPatentDraftBatchItemNo" INTEGER;

CREATE INDEX "auto_patent_draft_batches_userId_createdAt_idx"
  ON "auto_patent_draft_batches"("userId", "createdAt");

CREATE INDEX "auto_patent_draft_batches_tenantId_status_idx"
  ON "auto_patent_draft_batches"("tenantId", "status");

CREATE INDEX "email_draft_requests_autoPatentDraftBatchId_autoPatentDraftBatchItemNo_idx"
  ON "email_draft_requests"("autoPatentDraftBatchId", "autoPatentDraftBatchItemNo");
