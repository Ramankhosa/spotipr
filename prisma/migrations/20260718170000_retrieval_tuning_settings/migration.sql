-- Retrieval tuning: super-admin controlled runtime configuration.
--
-- Purely additive: three new tables, no changes to existing ones. Safe to run
-- against production during traffic.
--
-- NOTE: `prisma migrate diff` against a drifted local database also proposed
-- dropping oa_document_chunks_embedding_idx, altering local_patent_embeddings,
-- and building GIN trigram indexes on local_patents. Those are pre-existing
-- drift, not part of this change, and rebuilding trigram indexes on a ~45M-row
-- table would be a long, IO-heavy operation. They are deliberately excluded.

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "category" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "patent_provider_access" (
    "providerId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowAsFallback" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patent_provider_access_pkey" PRIMARY KEY ("providerId")
);

-- CreateTable
CREATE TABLE "retrieval_calibration_runs" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "configJson" JSONB NOT NULL,
    "searchIds" TEXT[],
    "resultsJson" JSONB,
    "baselineId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT,

    CONSTRAINT "retrieval_calibration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_settings_category_idx" ON "system_settings"("category");

-- CreateIndex
CREATE INDEX "retrieval_calibration_runs_status_idx" ON "retrieval_calibration_runs"("status");

-- CreateIndex
CREATE INDEX "retrieval_calibration_runs_startedAt_idx" ON "retrieval_calibration_runs"("startedAt");
