/*
  Warnings:

  - A unique constraint covering the columns `[patentId]` on the table `email_draft_requests` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[sessionId]` on the table `email_draft_requests` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "email_draft_requests_patentId_key" ON "email_draft_requests"("patentId");

-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "email_draft_requests_sessionId_key" ON "email_draft_requests"("sessionId");
