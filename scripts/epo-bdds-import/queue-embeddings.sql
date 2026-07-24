-- Queue the EPO-created rows for Voyage embedding.
--
--   psql "$DATABASE_URL" -v embed_model="'voyage-3.5-lite'" -v embed_dims=512 \
--     -f scripts/epo-bdds-import/queue-embeddings.sql
--
-- WHY THIS IS NEEDED
-- The EPO import deliberately never writes to local_patent_embeddings — that is
-- the safety property protecting the pre-existing vectors. But the batch worker
-- (scripts/patent-corpus-voyage-batch-embed.ts) only processes rows that ALREADY
-- have a QUEUED/FAILED entry there; it does not scan local_patents for gaps. So
-- without this step the worker reports "nothing queued" and the EPO rows never
-- get vectors.
--
-- WHAT IS AND IS NOT QUEUED
--   created rows (corpusSources @> {epo-ep-fulltext})  -> QUEUED here.
--   filled rows  (existing Google/Indian rows that gained claims) -> NOT queued,
--     and must not be: the fill never touched title/abstract, so embeddingText is
--     unchanged and their existing vectors are still exactly correct. Queueing
--     them would pay to recompute identical vectors.
--
-- Mirrors 04-postgres-load-and-upsert.sql: md5(embeddingText) as textHash (the
-- bulk-path convention), DISTINCT ON family with the US -> granted -> newest
-- representative rule from CORPUS-NOTES.md. EPO rows carry no familyId, so the
-- COALESCE falls back to publicationNumber and each gets its own vector.
--
-- Idempotent: ON CONFLICT DO NOTHING, so re-running queues only what is missing.

\set ON_ERROR_STOP on
\timing on

\echo '=== BEFORE ==='
SELECT status::text, count(*) FROM local_patent_embeddings
WHERE model = :embed_model GROUP BY 1 ORDER BY 1;

\echo ''
\echo '=== rows that will be queued ==='
SELECT count(*) AS epo_rows_needing_vectors
FROM local_patents p
WHERE p."corpusSources" @> ARRAY['epo-ep-fulltext']::TEXT[]
  AND p."embeddingText" IS NOT NULL AND p."embeddingText" <> ''
  AND NOT EXISTS (
    SELECT 1 FROM local_patent_embeddings e
    WHERE e."localPatentId" = p."id" AND e."model" = :embed_model
  );

\echo ''
\echo '=== queueing ==='
INSERT INTO local_patent_embeddings (
  "id", "localPatentId", "model", "dimensions", "textHash",
  "status", "attemptCount", "nextAttemptAt", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (COALESCE(NULLIF(p."familyId", ''), p."publicationNumber"))
  replace(gen_random_uuid()::text, '-', ''),
  p."id", :embed_model, :embed_dims, md5(p."embeddingText"),
  'QUEUED'::"PatentEmbeddingStatus", 0, now(), now(), now()
FROM local_patents p
WHERE p."corpusSources" @> ARRAY['epo-ep-fulltext']::TEXT[]
  AND p."embeddingText" IS NOT NULL AND p."embeddingText" <> ''
ORDER BY
  COALESCE(NULLIF(p."familyId", ''), p."publicationNumber"),
  CASE WHEN p."country" = 'US' THEN 0 ELSE 1 END,
  CASE WHEN p."kind" LIKE 'B%' THEN 0 WHEN p."kind" LIKE 'A%' THEN 1 ELSE 2 END,
  p."publicationDate" DESC NULLS LAST
ON CONFLICT ("localPatentId", "model", "textHash") DO NOTHING;

\echo ''
\echo '=== AFTER ==='
SELECT status::text, count(*) FROM local_patent_embeddings
WHERE model = :embed_model GROUP BY 1 ORDER BY 1;

\echo ''
\echo 'Now run the batch worker (COSTS MONEY, long-running, use tmux):'
\echo '  bash scripts/google-patents-import/run-embeddings.sh'
