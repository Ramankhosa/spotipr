-- Invention Miner, second pass: scope identity, family joins and text provenance.
--
-- All five tables were created empty minutes ago by 20260903120000 and hold no
-- rows on any deployment, so these columns are added NOT NULL without a default
-- and the partition key is swapped outright.
--
-- Why each change exists (each one is a failure found by walking a real user
-- through the pipeline, not a refinement):
--
--  * scopeFingerprint replaces scopeVersion as the partition key. Saving a scope
--    increments its version even when nothing changed, and keying the staged
--    field on the version alone would have re-staged an entire 120,000-family
--    field - and charged a fresh metered operation - because someone pressed
--    Save. Two scopes that normalise to the same thing now share a fingerprint.
--
--  * Leads carry the fingerprint they were mined and screened against. Without
--    it, a lead screened against the old field kept its verdict after a scope
--    edit, still offered a handoff into novelty search, and still printed in the
--    report, describing coverage of a field that no longer existed.
--
--  * The statement table is corpus-wide and every study adds to it. Counts are
--    per FAMILY (two publications of one family must not count twice), so the
--    family joins cannot be sequential scans.
--
--  * A statement extracted through translation cannot be quoted as evidence -
--    the quote does not appear in the source text - so translated rows are
--    marked and barred from the citation checks rather than silently trusted.
--
--  * miner_handoffs carried a bare leadId with no foreign key, which is exactly
--    the defect that was fixed for evidence rows in the first migration.

-- Text provenance
ALTER TABLE "patent_text_extractions" ADD COLUMN IF NOT EXISTS "language" TEXT;
ALTER TABLE "patent_text_extractions" ADD COLUMN IF NOT EXISTS "translated" BOOLEAN NOT NULL DEFAULT false;

-- Statement joins, applicant and language
ALTER TABLE "patent_problem_statements" ADD COLUMN IF NOT EXISTS "applicantNorm" TEXT;
ALTER TABLE "patent_problem_statements" ADD COLUMN IF NOT EXISTS "language" TEXT;
CREATE INDEX IF NOT EXISTS "patent_problem_statements_familyKey_idx" ON "patent_problem_statements"("familyKey");
CREATE INDEX IF NOT EXISTS "patent_problem_statements_kind_familyKey_idx" ON "patent_problem_statements"("kind", "familyKey");

-- The staged field is keyed on the scope's meaning, not its version number
ALTER TABLE "miner_field_publications" ADD COLUMN IF NOT EXISTS "scopeFingerprint" TEXT NOT NULL;
DROP INDEX IF EXISTS "miner_field_publications_studyId_scopeVersion_publicationNum_key";
DROP INDEX IF EXISTS "miner_field_publications_studyId_scopeVersion_sampled_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "miner_field_publications_studyId_scopeFingerprint_publicati_key" ON "miner_field_publications"("studyId", "scopeFingerprint", "publicationNumber");
CREATE INDEX IF NOT EXISTS "miner_field_publications_studyId_scopeFingerprint_sampled_idx" ON "miner_field_publications"("studyId", "scopeFingerprint", "sampled");

-- A lead knows which field it was screened against
ALTER TABLE "invention_leads" ADD COLUMN IF NOT EXISTS "scopeFingerprint" TEXT NOT NULL;
CREATE INDEX IF NOT EXISTS "invention_leads_studyId_scopeFingerprint_idx" ON "invention_leads"("studyId", "scopeFingerprint");

-- Handoff tokens belong to their lead
CREATE INDEX IF NOT EXISTS "miner_handoffs_userId_expiresAt_idx" ON "miner_handoffs"("userId", "expiresAt");
ALTER TABLE "miner_handoffs" ADD CONSTRAINT "miner_handoffs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "invention_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
