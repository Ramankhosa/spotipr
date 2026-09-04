-- Invention Miner
--
-- Mines a field for grant-worthy invention leads: extract what each publication
-- ADMITS is unsolved, index those statements as their own vector space, run four
-- gap engines over them, then gate each candidate on anticipation, inventive step
-- and the statutory exclusions before writing an invention brief.
--
-- NOTE FOR DEPLOY: adding enum values requires `prisma generate` and a restart of
-- patentnest and patentnest-novelty-worker, or policy resolution throws
-- "Value IM_EXTRACT not found in enum TaskCode" at runtime.
--
-- Scope note, following the Whitespace Studio migration: this file contains ONLY
-- this feature. `prisma migrate diff` also reports pre-existing drift (the
-- hand-built oa_document_chunks vector index, and column-type ALTERs on 45M-row
-- tables). None of it belongs here and two items would be destructive.

-- AlterEnum
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IM_EXTRACT';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IM_GATE';
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'IM_BRIEF';
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'INVENTION_MINER';
ALTER TYPE "FeatureCode" ADD VALUE IF NOT EXISTS 'INVENTION_MINER';

-- CreateTable: per-publication extraction cache (corpus-level, shared by studies)
CREATE TABLE IF NOT EXISTS "patent_text_extractions" (
    "id" TEXT NOT NULL,
    "publicationNumber" TEXT NOT NULL,
    "familyKey" TEXT NOT NULL,
    -- The tier actually READ: description-full | description-5k | claims | abstract.
    "textTier" TEXT NOT NULL,
    -- sha256(tier || NUL || text). Tier inside the hash, so an EPO claims fill
    -- later writes a NEW row instead of silently overwriting a thinner reading.
    "textHash" TEXT NOT NULL,
    "problems" JSONB NOT NULL,
    "mechanisms" JSONB NOT NULL,
    "technicalEffects" JSONB NOT NULL,
    "teachingAway" JSONB NOT NULL,
    "claimedScope" JSONB,
    "cpcSubclasses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model" TEXT,
    "stageCode" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "patent_text_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: the second vector space (problems, mechanisms, claim cores)
CREATE TABLE IF NOT EXISTS "patent_problem_statements" (
    "id" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "publicationNumber" TEXT NOT NULL,
    "familyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "cpcSubclasses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filingYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "patent_problem_statements_pkey" PRIMARY KEY ("id")
);

-- The embedding column's TYPE is a property of the deployment, not of this file.
-- Production embeds Voyage binary (bit(512)); a dev box pinned to OpenAI embeds
-- vector(1536). Hardcoding either one is how Office Action retrieval silently
-- returned nothing for every objection while every run reported success, so the
-- type is read from whichever local_patent_embeddings column this deployment
-- actually populates. checkMinerIndexConfig() re-checks it at runtime.
DO $$
DECLARE
    corpus_type TEXT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'patent_problem_statements' AND column_name = 'embedding'
    ) THEN
        RAISE NOTICE 'patent_problem_statements.embedding already exists; leaving it alone.';
        RETURN;
    END IF;

    SELECT format_type(a.atttypid, a.atttypmod) INTO corpus_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relname = 'local_patent_embeddings'
      AND a.attname = (
        SELECT col FROM (
            SELECT 'embeddingBinary' AS col, 1 AS rank
            UNION ALL SELECT 'embedding', 2
            UNION ALL SELECT 'embeddingHalf', 3
        ) candidates
        WHERE EXISTS (
            SELECT 1 FROM pg_attribute a2
            JOIN pg_class c2 ON c2.oid = a2.attrelid
            WHERE c2.relname = 'local_patent_embeddings' AND a2.attname = candidates.col
        )
        ORDER BY (
            SELECT CASE candidates.col
                WHEN 'embeddingBinary' THEN (SELECT count(*) FROM local_patent_embeddings WHERE "embeddingBinary" IS NOT NULL LIMIT 1)
                WHEN 'embedding' THEN (SELECT count(*) FROM local_patent_embeddings WHERE "embedding" IS NOT NULL LIMIT 1)
                ELSE (SELECT count(*) FROM local_patent_embeddings WHERE "embeddingHalf" IS NOT NULL LIMIT 1)
            END
        ) DESC, candidates.rank ASC
        LIMIT 1
      );

    IF corpus_type IS NULL THEN
        corpus_type := 'bit(512)';
        RAISE NOTICE 'No populated corpus embedding column found; defaulting to bit(512). Run fix-miner-statement-embedding-column if this deployment embeds floats.';
    END IF;

    EXECUTE format('ALTER TABLE "patent_problem_statements" ADD COLUMN "embedding" %s', corpus_type);
    RAISE NOTICE 'patent_problem_statements.embedding created as %', corpus_type;
END
$$;

-- No vector index here, deliberately. IVFFlat fixes its centroids at BUILD time:
-- an index created on an empty table sorts every later insert into an arbitrary
-- list, and a 24-probe scan then misses most true neighbours. Statements are
-- harvested per study (~12k rows each), so exact scans are correct and cheap
-- until the table is large; scripts/build-miner-statement-index.ts builds the
-- real index CONCURRENTLY once there are enough rows to place centroids.

-- CreateTable: the field a mining run staged, so "inside the field" is a join
CREATE TABLE IF NOT EXISTS "miner_field_publications" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "scopeVersion" INTEGER NOT NULL,
    "publicationNumber" TEXT NOT NULL,
    "familyKey" TEXT NOT NULL,
    "textTier" TEXT NOT NULL,
    "sampled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "miner_field_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable: the leads themselves
CREATE TABLE IF NOT EXISTS "invention_leads" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "runId" TEXT,
    "origin" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "problemStatement" TEXT NOT NULL,
    "proposedMechanism" TEXT,
    "elements" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "sourceRefs" JSONB NOT NULL,
    "gate" JSONB,
    "scores" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "brief" JSONB,
    "humanReview" JSONB,
    "coverageLimitations" JSONB NOT NULL,
    "handoffs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "invention_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable: single-use carrier so a brief never travels in a query string
CREATE TABLE IF NOT EXISTS "miner_handoffs" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "miner_handoffs_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "patent_text_extractions_publicationNumber_textHash_key" ON "patent_text_extractions"("publicationNumber", "textHash");
CREATE INDEX IF NOT EXISTS "patent_text_extractions_publicationNumber_supersededAt_idx" ON "patent_text_extractions"("publicationNumber", "supersededAt");
CREATE UNIQUE INDEX IF NOT EXISTS "patent_problem_statements_publicationNumber_kind_textHash_key" ON "patent_problem_statements"("publicationNumber", "kind", "textHash");
CREATE INDEX IF NOT EXISTS "patent_problem_statements_kind_idx" ON "patent_problem_statements"("kind");
CREATE INDEX IF NOT EXISTS "patent_problem_statements_extractionId_idx" ON "patent_problem_statements"("extractionId");
CREATE INDEX IF NOT EXISTS "patent_problem_statements_cpcSubclasses_idx" ON "patent_problem_statements" USING GIN ("cpcSubclasses");
CREATE UNIQUE INDEX IF NOT EXISTS "miner_field_publications_studyId_scopeVersion_publicationNum_key" ON "miner_field_publications"("studyId", "scopeVersion", "publicationNumber");
CREATE INDEX IF NOT EXISTS "miner_field_publications_studyId_scopeVersion_sampled_idx" ON "miner_field_publications"("studyId", "scopeVersion", "sampled");
CREATE UNIQUE INDEX IF NOT EXISTS "invention_leads_studyId_fingerprint_key" ON "invention_leads"("studyId", "fingerprint");
CREATE INDEX IF NOT EXISTS "invention_leads_studyId_status_idx" ON "invention_leads"("studyId", "status");
CREATE INDEX IF NOT EXISTS "invention_leads_studyId_origin_idx" ON "invention_leads"("studyId", "origin");
CREATE INDEX IF NOT EXISTS "miner_handoffs_leadId_idx" ON "miner_handoffs"("leadId");

-- Foreign keys
ALTER TABLE "patent_problem_statements" ADD CONSTRAINT "patent_problem_statements_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "patent_text_extractions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "miner_field_publications" ADD CONSTRAINT "miner_field_publications_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "whitespace_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invention_leads" ADD CONSTRAINT "invention_leads_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "whitespace_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Evidence and concepts can now belong to a lead. Evidence cascades (it has no
-- meaning without its subject); a promoted concept outlives the lead, as it
-- already outlives its hypothesis.
ALTER TABLE "whitespace_evidence" ADD COLUMN IF NOT EXISTS "leadId" TEXT;
ALTER TABLE "whitespace_concepts" ADD COLUMN IF NOT EXISTS "leadId" TEXT;
CREATE INDEX IF NOT EXISTS "whitespace_evidence_leadId_stance_idx" ON "whitespace_evidence"("leadId", "stance");
ALTER TABLE "whitespace_evidence" ADD CONSTRAINT "whitespace_evidence_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "invention_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whitespace_concepts" ADD CONSTRAINT "whitespace_concepts_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "invention_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
