-- Materialized corpus coverage census.
--
-- The census is several full-table scans of local_patents plus an aggregate over
-- local_patent_embeddings, i.e. minutes of work on the production corpus. The
-- public search API used to await it on every request and hung indefinitely
-- (no statement timeout). It is now computed by the corpus worker or an explicit
-- admin refresh and read from this table, so requests never pay for it, the
-- numbers survive a restart, and every app instance sees the same values.
--
-- Keyed by embedding model so switching PATENT_CORPUS_EMBEDDING_MODEL never reads
-- coverage that was computed for a different vector space.
CREATE TABLE IF NOT EXISTS "patent_corpus_coverage_snapshots" (
    "model" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patent_corpus_coverage_snapshots_pkey" PRIMARY KEY ("model")
);
