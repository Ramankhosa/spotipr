-- AlterTable
ALTER TABLE "prior_art_studio_runs" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "depth" TEXT NOT NULL DEFAULT 'deep',
ADD COLUMN     "error" TEXT,
ADD COLUMN     "gateDetail" JSONB,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'COMPLETE',
ADD COLUMN     "suggestedTerms" JSONB;

-- CreateIndex
CREATE INDEX "prior_art_studio_runs_sessionId_status_idx" ON "prior_art_studio_runs"("sessionId", "status");
