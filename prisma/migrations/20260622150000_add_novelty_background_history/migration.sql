CREATE TYPE "NoveltySearchJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "novelty_search_clients" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "novelty_search_clients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "novelty_search_groups" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "referenceCode" TEXT,
  "description" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "novelty_search_groups_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "novelty_search_runs" ADD COLUMN "groupId" TEXT;

CREATE TABLE "novelty_search_jobs" (
  "id" TEXT NOT NULL,
  "searchId" TEXT NOT NULL,
  "status" "NoveltySearchJobStatus" NOT NULL DEFAULT 'QUEUED',
  "currentStep" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedBy" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "lastError" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "completionEmailSentAt" TIMESTAMP(3),
  "emailAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "emailNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usageRecordedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "novelty_search_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "novelty_search_clients_userId_normalizedName_key" ON "novelty_search_clients"("userId", "normalizedName");
CREATE INDEX "novelty_search_clients_userId_name_idx" ON "novelty_search_clients"("userId", "name");
CREATE UNIQUE INDEX "novelty_search_groups_clientId_normalizedName_key" ON "novelty_search_groups"("clientId", "normalizedName");
CREATE INDEX "novelty_search_groups_userId_archivedAt_updatedAt_idx" ON "novelty_search_groups"("userId", "archivedAt", "updatedAt");
CREATE UNIQUE INDEX "novelty_search_jobs_searchId_key" ON "novelty_search_jobs"("searchId");
CREATE INDEX "novelty_search_jobs_status_nextAttemptAt_idx" ON "novelty_search_jobs"("status", "nextAttemptAt");
CREATE INDEX "novelty_search_jobs_status_emailNextAttemptAt_idx" ON "novelty_search_jobs"("status", "emailNextAttemptAt");
CREATE INDEX "novelty_search_jobs_lockedUntil_idx" ON "novelty_search_jobs"("lockedUntil");

ALTER TABLE "novelty_search_clients" ADD CONSTRAINT "novelty_search_clients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "novelty_search_groups" ADD CONSTRAINT "novelty_search_groups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "novelty_search_groups" ADD CONSTRAINT "novelty_search_groups_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "novelty_search_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "novelty_search_runs" ADD CONSTRAINT "novelty_search_runs_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "novelty_search_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "novelty_search_jobs" ADD CONSTRAINT "novelty_search_jobs_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "novelty_search_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
