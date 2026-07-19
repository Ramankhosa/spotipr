-- Search indexes for the Google Patents corpus.
--
-- These were built out-of-band on production (CONCURRENTLY, 19 Jul 2026) because
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction and Prisma wraps each
-- migration in one. They are recorded here so that:
--   1. fresh environments (dev/staging/new prod) reproduce them, and
--   2. `prisma migrate dev` does not treat them as drift and emit DROP INDEX.
--
-- ON AN EXISTING LARGE DATABASE: build these CONCURRENTLY out-of-band FIRST
-- (see scripts/google-patents-import/), after which this migration is a no-op
-- because CREATE INDEX IF NOT EXISTS matches on index name.
--
-- ON A FRESH/EMPTY DATABASE: these run inline and are effectively instant.

-- ---------------------------------------------------------------------------
-- 1. ANN index over the binary Voyage vectors (IVFFlat + Hamming).
--    Requires pgvector >= 0.7 for bit_hamming_ops.
--    lists ~= sqrt(row count); 5000 sized for ~30M vectors (29,826,248 as built).
--    Query-time recall is tuned with `ivfflat.probes` (currently 24), which is a
--    runtime setting -- changing it does NOT require rebuilding this index.
--    NOTE: IVFFlat centroids are chosen at build time. After a large corpus
--    refresh (e.g. the quarterly delta), REINDEX to avoid recall drift:
--      REINDEX INDEX CONCURRENTLY local_patent_embeddings_binary_ivf_idx;
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS local_patent_embeddings_binary_ivf_idx
  ON local_patent_embeddings USING ivfflat ("embeddingBinary" bit_hamming_ops)
  WITH (lists = 5000)
  WHERE "embeddingBinary" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Full-text GIN over the Google corpus rows only (partial).
--
--    The expression MUST stay byte-identical to searchDocumentExpression() in
--    src/lib/patent-search/providers/indian-corpus-provider.ts -- same field
--    order, same coalesce, same 'english'::regconfig. If they diverge, Postgres
--    silently stops using this index and the query falls back to a sequential
--    scan over ~45M rows.
--
--    Partial (google-patents-corpus only) to mirror the Indian/PQAI equivalents
--    from 20260619170000 and keep each corpus' index independently sized.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS local_patents_google_search_tsv_idx
  ON local_patents USING GIN (
    to_tsvector('english'::regconfig,
      coalesce("ragText", '')   || ' ' ||
      coalesce("title", '')     || ' ' ||
      coalesce("abstract", '')  || ' ' ||
      coalesce("abstractOriginal", ''))
  )
  WHERE "corpusSources" @> ARRAY['google-patents-corpus']::TEXT[];
