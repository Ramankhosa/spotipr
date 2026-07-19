-- Prior-Art Studio: advanced manual search sessions, runs, review state, evidence trail
-- Plus new LLM task code for the "Advanced Manual Search Query Generator" stage.

-- AlterEnum (safe on PG >= 12; value unused within this migration)
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'LLM7_ADVANCED_MANUAL_SEARCH';

-- CreateTable
CREATE TABLE "prior_art_studio_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Untitled search',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "plan" JSONB NOT NULL,
    "planVersion" INTEGER NOT NULL DEFAULT 1,
    "seedText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prior_art_studio_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prior_art_studio_runs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "planVersion" INTEGER NOT NULL,
    "planSnapshot" JSONB NOT NULL,
    "planHash" TEXT NOT NULL,
    "gateCounts" JSONB NOT NULL,
    "providerStats" JSONB,
    "warnings" JSONB,
    "results" JSONB NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "familyCount" INTEGER NOT NULL DEFAULT 0,
    "newFamilyCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prior_art_studio_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prior_art_studio_doc_states" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "familyKey" TEXT NOT NULL,
    "publicationNumber" TEXT NOT NULL,
    "tag" TEXT,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prior_art_studio_doc_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prior_art_studio_trail_entries" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prior_art_studio_trail_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prior_art_studio_sessions_userId_updatedAt_idx" ON "prior_art_studio_sessions"("userId", "updatedAt");
CREATE INDEX "prior_art_studio_sessions_tenantId_idx" ON "prior_art_studio_sessions"("tenantId");
CREATE INDEX "prior_art_studio_runs_sessionId_createdAt_idx" ON "prior_art_studio_runs"("sessionId", "createdAt");
CREATE UNIQUE INDEX "prior_art_studio_doc_states_sessionId_familyKey_key" ON "prior_art_studio_doc_states"("sessionId", "familyKey");
CREATE INDEX "prior_art_studio_doc_states_sessionId_tag_idx" ON "prior_art_studio_doc_states"("sessionId", "tag");
CREATE INDEX "prior_art_studio_trail_entries_sessionId_createdAt_idx" ON "prior_art_studio_trail_entries"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "prior_art_studio_runs" ADD CONSTRAINT "prior_art_studio_runs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "prior_art_studio_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prior_art_studio_doc_states" ADD CONSTRAINT "prior_art_studio_doc_states_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "prior_art_studio_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prior_art_studio_trail_entries" ADD CONSTRAINT "prior_art_studio_trail_entries_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "prior_art_studio_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
