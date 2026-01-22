-- Add patent type decision fields to drafting_sessions
-- Patent type is decided in a dedicated pre-claims step, separate from idea normalization

ALTER TABLE "drafting_sessions" ADD COLUMN "patent_type_primary" TEXT;
ALTER TABLE "drafting_sessions" ADD COLUMN "patent_type_decided_at" TIMESTAMP(3);
ALTER TABLE "drafting_sessions" ADD COLUMN "patent_type_frozen_at" TIMESTAMP(3);
ALTER TABLE "drafting_sessions" ADD COLUMN "patent_type_components_hash" TEXT;

-- Add index for querying sessions by patent type
CREATE INDEX "drafting_sessions_patent_type_primary_idx" ON "drafting_sessions"("patent_type_primary");

-- Comment: patent_type_primary stores one of: 'PRODUCT', 'SYSTEM', 'PROCESS', 'COMPOSITION'
-- Comment: patent_type_decided_at is when the LLM made the decision
-- Comment: patent_type_frozen_at is when claims were frozen (locks the patent type)
-- Comment: patent_type_components_hash is MD5 hash of components+logic to detect changes for re-decision


