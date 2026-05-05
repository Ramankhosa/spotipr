-- Convert partial unique indexes to non-partial (matching schema.prisma @unique)
-- The original migration created them with WHERE clauses, but Prisma expects plain unique indexes.

DROP INDEX IF EXISTS "email_draft_requests_patentId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "email_draft_requests_patentId_key" ON "email_draft_requests"("patentId");

DROP INDEX IF EXISTS "email_draft_requests_sessionId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "email_draft_requests_sessionId_key" ON "email_draft_requests"("sessionId");
