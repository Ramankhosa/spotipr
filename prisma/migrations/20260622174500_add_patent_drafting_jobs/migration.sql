CREATE TYPE "PatentDraftingJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "patent_drafting_jobs" (
  "id" TEXT NOT NULL,
  "patentId" TEXT NOT NULL,
  "sessionId" TEXT,
  "userId" TEXT NOT NULL,
  "status" "PatentDraftingJobStatus" NOT NULL DEFAULT 'QUEUED',
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
  "cancelledById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "patent_drafting_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "patent_drafting_jobs_patentId_userId_createdAt_idx" ON "patent_drafting_jobs"("patentId", "userId", "createdAt");
CREATE INDEX "patent_drafting_jobs_status_nextAttemptAt_idx" ON "patent_drafting_jobs"("status", "nextAttemptAt");
CREATE INDEX "patent_drafting_jobs_lockedUntil_idx" ON "patent_drafting_jobs"("lockedUntil");
CREATE INDEX "patent_drafting_jobs_sessionId_idx" ON "patent_drafting_jobs"("sessionId");

ALTER TABLE "patent_drafting_jobs" ADD CONSTRAINT "patent_drafting_jobs_patentId_fkey" FOREIGN KEY ("patentId") REFERENCES "patents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patent_drafting_jobs" ADD CONSTRAINT "patent_drafting_jobs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "patent_drafting_jobs" ADD CONSTRAINT "patent_drafting_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
