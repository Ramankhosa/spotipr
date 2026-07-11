-- Add deferred analysis state for user-uploaded/imported diagram images.
CREATE TYPE "DiagramImageAnalysisStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "diagram_sources"
  ADD COLUMN "imageAnalysisStatus" "DiagramImageAnalysisStatus",
  ADD COLUMN "imageAnalysisError" TEXT,
  ADD COLUMN "imageAnalysisWarnings" JSONB,
  ADD COLUMN "imageAnalysisModel" TEXT,
  ADD COLUMN "imageAnalysisQueuedAt" TIMESTAMP(3),
  ADD COLUMN "imageAnalysisStartedAt" TIMESTAMP(3),
  ADD COLUMN "imageAnalysisCompletedAt" TIMESTAMP(3);

CREATE TABLE "diagram_image_analysis_jobs" (
  "id" TEXT NOT NULL,
  "diagramSourceId" TEXT NOT NULL,
  "patentId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tenantId" TEXT,
  "status" "PatentDraftingJobStatus" NOT NULL DEFAULT 'QUEUED',
  "payload" JSONB,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedBy" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "lastError" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "diagram_image_analysis_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "diagram_image_analysis_jobs_diagramSourceId_idx" ON "diagram_image_analysis_jobs"("diagramSourceId");
CREATE INDEX "diagram_image_analysis_jobs_status_nextAttemptAt_idx" ON "diagram_image_analysis_jobs"("status", "nextAttemptAt");
CREATE INDEX "diagram_image_analysis_jobs_lockedUntil_idx" ON "diagram_image_analysis_jobs"("lockedUntil");
CREATE INDEX "diagram_image_analysis_jobs_sessionId_idx" ON "diagram_image_analysis_jobs"("sessionId");
CREATE INDEX "diagram_image_analysis_jobs_patentId_idx" ON "diagram_image_analysis_jobs"("patentId");

ALTER TABLE "diagram_image_analysis_jobs"
  ADD CONSTRAINT "diagram_image_analysis_jobs_diagramSourceId_fkey"
  FOREIGN KEY ("diagramSourceId") REFERENCES "diagram_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
