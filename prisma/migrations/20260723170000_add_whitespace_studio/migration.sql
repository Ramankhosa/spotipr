-- Whitespace Studio
--
-- Field mapping, technology clustering, gap hypotheses and adversarial
-- validation. Mirrors the Prior-Art Studio cluster shape (study + run + trail).
--
-- Scope note: extracted from `prisma migrate diff`, deliberately EXCLUDING
-- pre-existing drift the diff also reported. None of it belongs to this feature
-- and two items would be destructive:
--   * DROP INDEX "oa_document_chunks_embedding_idx" - a hand-built vector index
--     Prisma does not model.
--   * ALTER COLUMN TYPE bit(512) on local_patent_embeddings (45M rows) and
--     oa_document_chunks.
--   * ALTER COLUMN "updatedAt" DROP DEFAULT on two patent_api_* tables.
-- Reconcile those separately and on purpose, not as a side effect of this.

-- AlterEnum
ALTER TYPE "FeatureCode" ADD VALUE 'WHITESPACE_ANALYSIS';

-- AlterEnum
ALTER TYPE "ServiceType" ADD VALUE 'WHITESPACE_ANALYSIS';

-- the enum.


ALTER TYPE "TaskCode" ADD VALUE 'WS_SCOPE';
ALTER TYPE "TaskCode" ADD VALUE 'WS_CLUSTER_LABEL';
ALTER TYPE "TaskCode" ADD VALUE 'WS_CLAIM_ELEMENTS';
ALTER TYPE "TaskCode" ADD VALUE 'WS_HYPOTHESIZE';
ALTER TYPE "TaskCode" ADD VALUE 'WS_VALIDATE';
ALTER TYPE "TaskCode" ADD VALUE 'WS_REDTEAM';

-- CreateTable
CREATE TABLE "whitespace_studies" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Untitled study',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "scope" JSONB NOT NULL,
    "scopeVersion" INTEGER NOT NULL DEFAULT 1,
    "seedText" TEXT,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whitespace_studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whitespace_runs" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "scopeVersion" INTEGER NOT NULL,
    "scopeSnapshot" JSONB NOT NULL,
    "params" JSONB,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "lockedBy" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "results" JSONB,
    "gateCounts" JSONB,
    "durationMs" INTEGER,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whitespace_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whitespace_clusters" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "runId" TEXT,
    "parentClusterId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "centroidBits" TEXT,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "fieldEstimate" INTEGER NOT NULL DEFAULT 0,
    "cohesion" DOUBLE PRECISION,
    "separation" DOUBLE PRECISION,
    "silhouette" DOUBLE PRECISION,
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whitespace_clusters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whitespace_cluster_members" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "clusterId" TEXT,
    "familyKey" TEXT NOT NULL,
    "publicationNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bits" TEXT,
    "distance" DOUBLE PRECISION,
    "isMedoid" BOOLEAN NOT NULL DEFAULT false,
    "year" INTEGER,
    "assigneeCanonical" TEXT,

    CONSTRAINT "whitespace_cluster_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whitespace_area_analyses" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "claimElements" JSONB,
    "problemSolutionMatrix" JSONB,
    "textCoverage" JSONB NOT NULL,
    "results" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whitespace_area_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whitespace_hypotheses" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "clusterId" TEXT,
    "areaAnalysisId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'UNDETERMINED',
    "statement" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "elementCombination" JSONB,
    "scores" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "validation" JSONB,
    "coverageLimitations" JSONB NOT NULL,
    "humanReview" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whitespace_hypotheses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whitespace_evidence" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "hypothesisId" TEXT,
    "clusterId" TEXT,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "passage" TEXT,
    "queryText" TEXT,
    "score" DOUBLE PRECISION,
    "stance" TEXT NOT NULL DEFAULT 'CONTEXT',
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whitespace_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whitespace_concepts" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "hypothesisId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "handoffs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whitespace_concepts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whitespace_literature_items" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "clusterId" TEXT,
    "hypothesisId" TEXT,
    "doi" TEXT,
    "title" TEXT NOT NULL,
    "authors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "year" INTEGER,
    "venue" TEXT,
    "abstract" TEXT,
    "citationCount" INTEGER,
    "url" TEXT,
    "isOpenAccess" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whitespace_literature_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whitespace_trail_entries" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whitespace_trail_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whitespace_studies_userId_updatedAt_idx" ON "whitespace_studies"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "whitespace_studies_tenantId_idx" ON "whitespace_studies"("tenantId");

-- CreateIndex
CREATE INDEX "whitespace_runs_studyId_createdAt_idx" ON "whitespace_runs"("studyId", "createdAt");

-- CreateIndex
CREATE INDEX "whitespace_runs_studyId_stage_status_idx" ON "whitespace_runs"("studyId", "stage", "status");

-- CreateIndex
CREATE INDEX "whitespace_runs_status_nextAttemptAt_idx" ON "whitespace_runs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "whitespace_clusters_studyId_depth_idx" ON "whitespace_clusters"("studyId", "depth");

-- CreateIndex
CREATE INDEX "whitespace_clusters_parentClusterId_idx" ON "whitespace_clusters"("parentClusterId");

-- CreateIndex
CREATE INDEX "whitespace_cluster_members_clusterId_idx" ON "whitespace_cluster_members"("clusterId");

-- CreateIndex
CREATE UNIQUE INDEX "whitespace_cluster_members_studyId_familyKey_key" ON "whitespace_cluster_members"("studyId", "familyKey");

-- CreateIndex
CREATE INDEX "whitespace_area_analyses_studyId_idx" ON "whitespace_area_analyses"("studyId");

-- CreateIndex
CREATE INDEX "whitespace_area_analyses_clusterId_idx" ON "whitespace_area_analyses"("clusterId");

-- CreateIndex
CREATE INDEX "whitespace_hypotheses_studyId_status_idx" ON "whitespace_hypotheses"("studyId", "status");

-- CreateIndex
CREATE INDEX "whitespace_hypotheses_areaAnalysisId_idx" ON "whitespace_hypotheses"("areaAnalysisId");

-- CreateIndex
CREATE INDEX "whitespace_evidence_hypothesisId_stance_idx" ON "whitespace_evidence"("hypothesisId", "stance");

-- CreateIndex
CREATE INDEX "whitespace_evidence_studyId_kind_idx" ON "whitespace_evidence"("studyId", "kind");

-- CreateIndex
CREATE INDEX "whitespace_concepts_studyId_idx" ON "whitespace_concepts"("studyId");

-- CreateIndex
CREATE INDEX "whitespace_literature_items_studyId_clusterId_idx" ON "whitespace_literature_items"("studyId", "clusterId");

-- CreateIndex
CREATE INDEX "whitespace_literature_items_doi_idx" ON "whitespace_literature_items"("doi");

-- CreateIndex
CREATE INDEX "whitespace_trail_entries_studyId_createdAt_idx" ON "whitespace_trail_entries"("studyId", "createdAt");

-- AddForeignKey
ALTER TABLE "whitespace_runs" ADD CONSTRAINT "whitespace_runs_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "whitespace_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whitespace_clusters" ADD CONSTRAINT "whitespace_clusters_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "whitespace_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whitespace_cluster_members" ADD CONSTRAINT "whitespace_cluster_members_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "whitespace_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whitespace_cluster_members" ADD CONSTRAINT "whitespace_cluster_members_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "whitespace_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whitespace_area_analyses" ADD CONSTRAINT "whitespace_area_analyses_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "whitespace_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whitespace_area_analyses" ADD CONSTRAINT "whitespace_area_analyses_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "whitespace_clusters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whitespace_hypotheses" ADD CONSTRAINT "whitespace_hypotheses_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "whitespace_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whitespace_hypotheses" ADD CONSTRAINT "whitespace_hypotheses_areaAnalysisId_fkey" FOREIGN KEY ("areaAnalysisId") REFERENCES "whitespace_area_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whitespace_evidence" ADD CONSTRAINT "whitespace_evidence_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "whitespace_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whitespace_evidence" ADD CONSTRAINT "whitespace_evidence_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "whitespace_hypotheses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whitespace_concepts" ADD CONSTRAINT "whitespace_concepts_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "whitespace_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whitespace_concepts" ADD CONSTRAINT "whitespace_concepts_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "whitespace_hypotheses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whitespace_literature_items" ADD CONSTRAINT "whitespace_literature_items_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "whitespace_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whitespace_trail_entries" ADD CONSTRAINT "whitespace_trail_entries_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "whitespace_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
