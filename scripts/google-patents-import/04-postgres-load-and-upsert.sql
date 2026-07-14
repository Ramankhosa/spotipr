-- =============================================================================
-- Step 4: Postgres side — staging table, upsert into local_patents, and
-- embedding-queue seeding. Run sections in order with psql.
--
-- Variables (pass with psql -v, defaults shown):
--   psql "$DATABASE_URL" \
--     -v embed_model="'voyage-3.5-lite'" -v embed_dims=512 \
--     -f 04-postgres-load-and-upsert.sql
-- The \copy loading itself is driven by download-and-load.sh (section B).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Staging table (UNLOGGED: bulk-load speed; data is recoverable from GCS).
-- ---------------------------------------------------------------------------
CREATE UNLOGGED TABLE IF NOT EXISTS google_patents_staging (
  publication_number      TEXT PRIMARY KEY,
  pub_key                 TEXT,
  pub_canonical           TEXT,
  country_code            TEXT,
  kind_code               TEXT,
  family_id               TEXT,
  publication_date        TEXT,
  filing_date             TEXT,
  title                   TEXT,
  abstract                TEXT,
  cpc_codes               TEXT,
  assignees               TEXT,
  inventors               TEXT,
  abstract_translated     TEXT,
  is_family_representative TEXT
);

CREATE TABLE IF NOT EXISTS google_patents_import_files (
  file_name  TEXT PRIMARY KEY,
  loaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_count  BIGINT
);

-- ---------------------------------------------------------------------------
-- B. Loading happens from download-and-load.sh via:
--    \copy google_patents_staging FROM STDIN WITH (FORMAT csv)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- C. Guard: a pub_key that already belongs to a DIFFERENT publication number in
-- local_patents would violate the publicationNumberKey unique constraint during
-- the upsert. Null those (rare; they remain findable by publicationNumber).
-- ---------------------------------------------------------------------------
UPDATE google_patents_staging s
SET pub_key = NULL
WHERE EXISTS (
  SELECT 1 FROM local_patents lp
  WHERE lp."publicationNumberKey" = s.pub_key
    AND lp."publicationNumber" <> s.publication_number
);

-- ---------------------------------------------------------------------------
-- D. Upsert into local_patents.
--    - IN publications join BOTH corpora ('google-patents-corpus' + 'indian-corpus')
--      per product decision: Google-sourced Indian patents live in the Indian corpus.
--    - Existing rows keep their richer fields (claims/description text from the
--      IPIndia pipeline is never overwritten); corpusSources are merged.
--    - embeddingText = title + abstract, the exact text the embedding worker embeds.
-- ---------------------------------------------------------------------------
INSERT INTO local_patents (
  "publicationNumber", "publicationNumberKey", "kind", "country", "familyId",
  "filingDate", "publicationDate", "title", "abstract",
  "applicants", "inventors", "classifications",
  "corpusSources", "embeddingText", "createdAt", "updatedAt"
)
SELECT
  s.publication_number,
  s.pub_key,
  NULLIF(s.kind_code, ''),
  NULLIF(s.country_code, ''),
  NULLIF(s.family_id, ''),
  CASE WHEN s.filing_date ~ '^\d{4}-\d{2}-\d{2}$' THEN s.filing_date::timestamp ELSE NULL END,
  CASE WHEN s.publication_date ~ '^\d{4}-\d{2}-\d{2}$' THEN s.publication_date::timestamp ELSE NULL END,
  LEFT(s.title, 1000),
  s.abstract,
  to_jsonb(string_to_array(NULLIF(s.assignees, ''), '|')),
  COALESCE(string_to_array(NULLIF(s.inventors, ''), '|'), ARRAY[]::TEXT[]),
  COALESCE(string_to_array(NULLIF(s.cpc_codes, ''), '|'), ARRAY[]::TEXT[]),
  CASE WHEN s.country_code = 'IN'
       THEN ARRAY['google-patents-corpus', 'indian-corpus']::TEXT[]
       ELSE ARRAY['google-patents-corpus']::TEXT[] END,
  LEFT(s.title || E'\n' || s.abstract, 20000),
  now(), now()
FROM google_patents_staging s
WHERE s.title IS NOT NULL AND s.abstract IS NOT NULL
ON CONFLICT ("publicationNumber") DO UPDATE SET
  "corpusSources" = (
    SELECT ARRAY(SELECT DISTINCT source FROM unnest(local_patents."corpusSources" || EXCLUDED."corpusSources") AS source)
  ),
  "familyId"        = COALESCE(local_patents."familyId", EXCLUDED."familyId"),
  "kind"            = COALESCE(local_patents."kind", EXCLUDED."kind"),
  "country"         = COALESCE(local_patents."country", EXCLUDED."country"),
  "filingDate"      = COALESCE(local_patents."filingDate", EXCLUDED."filingDate"),
  "publicationDate" = COALESCE(local_patents."publicationDate", EXCLUDED."publicationDate"),
  "abstract"        = COALESCE(NULLIF(local_patents."abstract", ''), EXCLUDED."abstract"),
  "classifications" = CASE WHEN COALESCE(array_length(local_patents."classifications", 1), 0) = 0
                           THEN EXCLUDED."classifications" ELSE local_patents."classifications" END,
  "embeddingText"   = COALESCE(NULLIF(local_patents."embeddingText", ''), EXCLUDED."embeddingText"),
  "updatedAt"       = now();

-- ---------------------------------------------------------------------------
-- E. OPTIONAL — reconcile Google IN rows with pre-existing indian-corpus rows
-- that use IPO-style numbering (digit-core match). One-time, sequential scan on
-- the indian subset only; review counts before/after.
-- ---------------------------------------------------------------------------
-- UPDATE local_patents lp
-- SET "corpusSources" = (
--       SELECT ARRAY(SELECT DISTINCT source FROM unnest(lp."corpusSources" || ARRAY['google-patents-corpus']) AS source)
--     ),
--     "familyId" = COALESCE(lp."familyId", s.family_id),
--     "updatedAt" = now()
-- FROM google_patents_staging s
-- WHERE s.country_code = 'IN'
--   AND lp."corpusSources" @> ARRAY['indian-corpus']::TEXT[]
--   AND NOT lp."corpusSources" @> ARRAY['google-patents-corpus']::TEXT[]
--   AND regexp_replace(lp."publicationNumber", '\D', '', 'g') = regexp_replace(s.publication_number, '\D', '', 'g');

-- ---------------------------------------------------------------------------
-- F. Seed the embedding queue for every corpus row that has no completed vector
-- for the configured model. The realtime worker (npm run patent-corpus:worker)
-- drains this queue through the Voyage/OpenAI dispatcher.
-- ---------------------------------------------------------------------------
INSERT INTO local_patent_embeddings (
  "id", "localPatentId", "model", "dimensions", "textHash",
  "status", "attemptCount", "nextAttemptAt", "createdAt", "updatedAt"
)
SELECT
  replace(gen_random_uuid()::text, '-', ''),
  p."id",
  :embed_model,
  :embed_dims,
  md5(p."embeddingText"),
  'QUEUED'::"PatentEmbeddingStatus",
  0, now(), now(), now()
FROM local_patents p
WHERE p."corpusSources" @> ARRAY['google-patents-corpus']::TEXT[]
  AND p."embeddingText" IS NOT NULL AND p."embeddingText" <> ''
ON CONFLICT ("localPatentId", "model", "textHash") DO NOTHING;

-- ---------------------------------------------------------------------------
-- G. AFTER the embedding backfill completes (check with the query below), build
-- the ANN index. IVFFlat builds in one pass (hours on 2 vCPU, vs days for HNSW)
-- and its index fits small-RAM boxes; lists ~= sqrt(rows).
--
--   SELECT status, count(*) FROM local_patent_embeddings
--   WHERE model = :embed_model GROUP BY status;
-- ---------------------------------------------------------------------------
-- SET maintenance_work_mem = '2GB';
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS local_patent_embeddings_half_ivf_idx
--   ON local_patent_embeddings USING ivfflat ("embeddingHalf" halfvec_cosine_ops)
--   WITH (lists = 6000)
--   WHERE "embeddingHalf" IS NOT NULL;
-- ANALYZE local_patent_embeddings;
-- At query time (session level, set via PGOPTIONS or per connection):
--   SET ivfflat.probes = 24;

-- ---------------------------------------------------------------------------
-- H. Cleanup once verified.
-- ---------------------------------------------------------------------------
-- DROP TABLE google_patents_staging;
