CREATE TABLE IF NOT EXISTS "patent_drafting_usage" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "patentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "hasDescription" BOOLEAN NOT NULL DEFAULT false,
  "hasClaims" BOOLEAN NOT NULL DEFAULT false,
  "isCounted" BOOLEAN NOT NULL DEFAULT false,
  "countedDate" TIMESTAMP(3),
  "countedMonth" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "countedAt" TIMESTAMP(3),
  CONSTRAINT "patent_drafting_usage_pkey" PRIMARY KEY ("id")
);
