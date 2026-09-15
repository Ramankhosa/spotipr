ALTER TABLE "patent_text_extractions" ADD COLUMN "contractVersion" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "sourceText" TEXT, ADD COLUMN "readCoverage" JSONB, ADD COLUMN "sourceEvidence" JSONB;
ALTER TABLE "miner_field_publications" ADD COLUMN "snapshotId" TEXT, ADD COLUMN "extractionId" TEXT;
ALTER TABLE "invention_leads" ADD COLUMN "snapshotId" TEXT, ADD COLUMN "proposalVersion" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "currentProposalId" TEXT, ADD COLUMN "currentAssessments" JSONB, ADD COLUMN "currentBriefs" JSONB;
ALTER TABLE "miner_handoffs" ADD COLUMN "tenantId" TEXT, ADD COLUMN "target" TEXT,
 ADD COLUMN "proposalRevisionId" TEXT, ADD COLUMN "office" TEXT, ADD COLUMN "destination" JSONB;
CREATE TABLE "miner_field_snapshots" (
 "id" TEXT PRIMARY KEY, "studyId" TEXT NOT NULL REFERENCES "whitespace_studies"("id") ON DELETE CASCADE,
 "runId" TEXT NOT NULL UNIQUE REFERENCES "whitespace_runs"("id"), "retrievalIdentity" TEXT NOT NULL,
 "scope" JSONB NOT NULL, "matchingRule" JSONB NOT NULL, "membershipHash" TEXT NOT NULL, "members" JSONB NOT NULL,
 "coverage" JSONB NOT NULL, "workload" JSONB NOT NULL, "eligible" BOOLEAN NOT NULL, "limitations" JSONB NOT NULL,
 "approvedBy" TEXT, "approvedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "miner_field_snapshots_studyId_createdAt_idx" ON "miner_field_snapshots"("studyId", "createdAt");
CREATE TABLE "miner_proposal_revisions" (
 "id" TEXT PRIMARY KEY, "leadId" TEXT NOT NULL REFERENCES "invention_leads"("id") ON DELETE CASCADE,
 "snapshotId" TEXT NOT NULL REFERENCES "miner_field_snapshots"("id"), "revision" INTEGER NOT NULL,
 "content" JSONB NOT NULL, "evidence" JSONB NOT NULL, "createdBy" TEXT NOT NULL,
 "approvedBy" TEXT, "approvedAt" TIMESTAMP(3), "reviews" JSONB NOT NULL DEFAULT '[]',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "miner_proposal_revisions_leadId_revision_key" UNIQUE ("leadId", "revision")
);
CREATE TABLE "miner_operations" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL,
 "studyId" TEXT NOT NULL REFERENCES "whitespace_studies"("id") ON DELETE CASCADE,
 "operationKey" TEXT NOT NULL, "runId" TEXT NOT NULL UNIQUE REFERENCES "whitespace_runs"("id"),
 "state" TEXT NOT NULL DEFAULT 'RESERVED', "inputs" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
 CONSTRAINT "miner_operations_tenantId_operationKey_key" UNIQUE ("tenantId", "operationKey")
);
CREATE INDEX "miner_operations_tenantId_state_createdAt_idx" ON "miner_operations"("tenantId", "state", "createdAt");

ALTER TABLE "miner_field_publications"
  ADD CONSTRAINT "miner_field_publications_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "miner_field_snapshots"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "miner_field_publications_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "patent_text_extractions"("id") ON DELETE SET NULL;
ALTER TABLE "invention_leads"
  ADD CONSTRAINT "invention_leads_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "miner_field_snapshots"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "invention_leads_currentProposalId_fkey" FOREIGN KEY ("currentProposalId") REFERENCES "miner_proposal_revisions"("id") ON DELETE SET NULL;
ALTER TABLE "miner_handoffs"
  ADD CONSTRAINT "miner_handoffs_proposalRevisionId_fkey" FOREIGN KEY ("proposalRevisionId") REFERENCES "miner_proposal_revisions"("id") ON DELETE SET NULL;
CREATE INDEX "miner_field_publications_snapshotId_idx" ON "miner_field_publications"("snapshotId");
CREATE INDEX "miner_proposal_revisions_snapshotId_idx" ON "miner_proposal_revisions"("snapshotId");
CREATE INDEX "invention_leads_currentProposalId_idx" ON "invention_leads"("currentProposalId");
