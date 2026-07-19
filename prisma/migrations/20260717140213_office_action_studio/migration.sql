/*
  Warnings:

  - You are about to alter the column `embeddingBinary` on the `local_patent_embeddings` table. The data in that column could be lost. The data in that column will be cast from `Bit(512)` to `Unsupported("bit(512)")`.

*/
-- CreateEnum
CREATE TYPE "OfficeActionCaseStatus" AS ENUM ('ACTIVE', 'REPLIED', 'HEARING', 'CLOSED');

-- CreateEnum
CREATE TYPE "OaParseStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "OfficeActionJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "FeatureCode" ADD VALUE 'OFFICE_ACTION_RESPONSE';

-- AlterEnum
ALTER TYPE "ServiceType" ADD VALUE 'OFFICE_ACTION_RESPONSE';

-- AlterEnum
ALTER TYPE "TaskCode" ADD VALUE 'LLM8_OA_RESPONSE';

-- AlterTable
-- (drift, intentionally skipped) ALTER TABLE "local_patent_embeddings" ALTER COLUMN "embeddingBinary" SET DATA TYPE bit(512);

-- AlterTable
-- (drift, intentionally skipped) ALTER TABLE "patent_api_clients" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
-- (drift, intentionally skipped) ALTER TABLE "patent_api_usage_buckets" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "office_action_cases" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "patentId" TEXT,
    "jurisdictionCode" TEXT NOT NULL,
    "applicationNumber" TEXT NOT NULL,
    "applicantName" TEXT,
    "title" TEXT,
    "status" "OfficeActionCaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "specificationText" TEXT,
    "claimsText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "office_action_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_action_documents" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "instrumentType" TEXT,
    "issueDate" TIMESTAMP(3),
    "fileKey" TEXT,
    "fileName" TEXT,
    "rawText" TEXT,
    "parseStatus" "OaParseStatus" NOT NULL DEFAULT 'PENDING',
    "parseConfidence" DOUBLE PRECISION,
    "parsedJson" JSONB,
    "deadlinesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "office_action_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oa_objections" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "canonicalCode" TEXT NOT NULL,
    "subTypeId" TEXT,
    "localBasis" TEXT,
    "examinerText" TEXT NOT NULL,
    "quoteVerified" BOOLEAN NOT NULL DEFAULT false,
    "claimsAffected" JSONB,
    "citationLabels" JSONB,
    "status" TEXT NOT NULL DEFAULT 'EXTRACTED',
    "analysisJson" JSONB,
    "strategyJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oa_objections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oa_citations" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PATENT',
    "docNumber" TEXT,
    "normalizedKey" TEXT,
    "resolvedVia" TEXT,
    "fetchStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "fullTextKey" TEXT,
    "passagesJson" JSONB,
    "claimChartJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oa_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oa_response_drafts" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sectionsJson" JSONB NOT NULL,
    "amendedClaimsJson" JSONB,
    "complianceJson" JSONB,
    "exportFileKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oa_response_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_action_jobs" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentId" TEXT,
    "userId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" "OfficeActionJobStatus" NOT NULL DEFAULT 'QUEUED',
    "currentStep" TEXT,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "office_action_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "office_action_cases_userId_createdAt_idx" ON "office_action_cases"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "office_action_cases_tenantId_idx" ON "office_action_cases"("tenantId");

-- CreateIndex
CREATE INDEX "office_action_cases_jurisdictionCode_status_idx" ON "office_action_cases"("jurisdictionCode", "status");

-- CreateIndex
CREATE INDEX "office_action_documents_caseId_createdAt_idx" ON "office_action_documents"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "office_action_documents_parseStatus_idx" ON "office_action_documents"("parseStatus");

-- CreateIndex
CREATE INDEX "oa_objections_documentId_sortOrder_idx" ON "oa_objections"("documentId", "sortOrder");

-- CreateIndex
CREATE INDEX "oa_citations_documentId_label_idx" ON "oa_citations"("documentId", "label");

-- CreateIndex
CREATE INDEX "oa_citations_fetchStatus_idx" ON "oa_citations"("fetchStatus");

-- CreateIndex
CREATE INDEX "oa_response_drafts_caseId_version_idx" ON "oa_response_drafts"("caseId", "version");

-- CreateIndex
CREATE INDEX "office_action_jobs_caseId_createdAt_idx" ON "office_action_jobs"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "office_action_jobs_status_nextAttemptAt_idx" ON "office_action_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "office_action_jobs_lockedUntil_idx" ON "office_action_jobs"("lockedUntil");

-- (drift, intentionally skipped) The four local_patents trigram GIN indexes were
-- re-proposed here by `migrate dev` WITHOUT their partial WHERE predicates because
-- schema.prisma cannot express partial indexes. 20260713140000_partial_trigram_indexes
-- owns them (partial: corpusSources @> '{indian-corpus}'); recreating them non-partial
-- over the ~45M-row Google corpus would build ~150GB of GIN and can lock behind a
-- CONCURRENTLY build. Never re-add these lines. See also 20260718170000's header.

-- AddForeignKey
ALTER TABLE "office_action_documents" ADD CONSTRAINT "office_action_documents_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "office_action_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oa_objections" ADD CONSTRAINT "oa_objections_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "office_action_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oa_citations" ADD CONSTRAINT "oa_citations_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "office_action_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oa_response_drafts" ADD CONSTRAINT "oa_response_drafts_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "office_action_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "patent_drafting_jobs_autoPatentDraftBatchId_autoPatentDraftBatc" RENAME TO "patent_drafting_jobs_autoPatentDraftBatchId_autoPatentDraft_idx";
