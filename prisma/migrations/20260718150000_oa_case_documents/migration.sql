-- Office Action Studio: attorney-provided invention context + supplementary material.
-- Index-once / retrieve-per-need (OFFICE_ACTION_CONTEXT_AND_COST.md).

ALTER TABLE "office_action_cases" ADD COLUMN "inventionDigest" JSONB;

CREATE TABLE "oa_case_documents" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT,
    "fileKey" TEXT,
    "text" TEXT,
    "sectionsJson" JSONB,
    "intentNote" TEXT,
    "targetCodes" JSONB,
    "newMatterSafe" BOOLEAN NOT NULL DEFAULT false,
    "indexStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "oa_case_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oa_document_chunks" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sectionRef" TEXT,
    "text" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    -- Matches the corpus embedding contract (voyage-3.5-lite, 512-dim binary,
    -- Hamming) — NOT the legacy OpenAI vector(1536). requestCorpusEmbedding
    -- returns 64 packed ubinary bytes; a vector(1536) column rejects every
    -- write ("expected 1536 dimensions, not 512") and the catch swallows it.
    "embedding" bit(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oa_document_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "oa_case_documents_caseId_kind_idx" ON "oa_case_documents"("caseId", "kind");
CREATE INDEX "oa_document_chunks_caseId_kind_idx" ON "oa_document_chunks"("caseId", "kind");
CREATE INDEX "oa_document_chunks_documentId_idx" ON "oa_document_chunks"("documentId");

-- Hamming ANN over case chunks (small per-case volume; IVFFlat is plenty).
CREATE INDEX "oa_document_chunks_embedding_idx" ON "oa_document_chunks"
  USING ivfflat ("embedding" bit_hamming_ops) WITH (lists = 100);

ALTER TABLE "oa_case_documents" ADD CONSTRAINT "oa_case_documents_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "office_action_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oa_document_chunks" ADD CONSTRAINT "oa_document_chunks_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "oa_case_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
