CREATE TABLE "novelty_report_shares" (
  "id" TEXT NOT NULL,
  "searchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "accessCount" INTEGER NOT NULL DEFAULT 0,
  "lastAccessedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "novelty_report_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "novelty_report_shares_tokenHash_key" ON "novelty_report_shares"("tokenHash");
CREATE INDEX "novelty_report_shares_searchId_idx" ON "novelty_report_shares"("searchId");
CREATE INDEX "novelty_report_shares_userId_createdAt_idx" ON "novelty_report_shares"("userId", "createdAt");
CREATE INDEX "novelty_report_shares_expiresAt_idx" ON "novelty_report_shares"("expiresAt");
