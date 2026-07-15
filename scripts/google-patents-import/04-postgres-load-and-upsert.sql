-- =============================================================================
-- Step 4: Postgres side — staging table, upsert into local_patents, and
-- embedding-queue seeding. Column order matches the GCS export (14 columns).
--
--   psql "$DATABASE_URL" \
--     -v embed_model="'voyage-3.5-lite'" -v embed_dims=512 \
--     -f 04-postgres-load-and-upsert.sql
-- The \copy loading itself is driven by download-and-load.sh.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Staging table (UNLOGGED: bulk-load speed; recoverable from GCS).
-- ---------------------------------------------------------------------------
CREATE UNLOGGED TABLE IF NOT EXISTS google_patents_staging (
  publication_number  TEXT PRIMARY KEY,
  pub_canonical       TEXT,
  title               TEXT,
  abstract            TEXT,
  url                 TEXT,
  cpc                 TEXT,
  top_terms           TEXT,
  country_code        TEXT,
  publication_date    TEXT,
  filing_date         TEXT,
  kind_code           TEXT,
  family_id           TEXT,
  first_claim         TEXT,
  description_snippet  TEXT
);

CREATE TABLE IF NOT EXISTS google_patents_import_files (
  file_name  TEXT PRIMARY KEY,
  loaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_count  BIGINT
);

-- ---------------------------------------------------------------------------
-- B. Loading happens from download-and-load.sh (\copy per shard).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- C. pub_key collision guard: null any pub_key that already belongs to a
-- DIFFERENT publication in local_patents (protects the publicationNumberKey
-- unique constraint; the row stays findable by publicationNumber).
-- ---------------------------------------------------------------------------
UPDATE google_patents_staging s
SET pub_canonical = pub_canonical  -- no-op; kept for symmetry
WHERE FALSE;

-- ---------------------------------------------------------------------------
-- D. Upsert into local_patents.
--    - embeddingText = title + abstract (what the embedding worker embeds -- parity
--      with the Indian corpus; claims/description are NOT embedded, only stored).
--    - first_claim -> claimsText, description_snippet -> descriptionText (US-only;
--      NULL for other countries). Existing IPIndia claims/descriptions are preserved
--      (COALESCE keeps the local value).
--    - top_terms parked in ragText (retained, not embedded).
--    - IN publications join BOTH corpora per product decision.
-- ---------------------------------------------------------------------------
INSERT INTO local_patents (
  "publicationNumber", "publicationNumberKey", "kind", "country", "familyId",
  "filingDate", "publicationDate", "title", "abstract",
  "classifications", "claimsText", "descriptionText", "ragText",
  "corpusSources", "embeddingText", "createdAt", "updatedAt"
)
SELECT
  s.publication_number,
  NULLIF(regexp_replace(upper(s.publication_number), '[^A-Z0-9]', '', 'g'), ''),
  NULLIF(s.kind_code, ''),
  NULLIF(s.country_code, ''),
  NULLIF(s.family_id, ''),
  CASE WHEN s.filing_date ~ '^\d{8}$'      THEN to_date(s.filing_date, 'YYYYMMDD')      ELSE NULL END,
  CASE WHEN s.publication_date ~ '^\d{8}$' THEN to_date(s.publication_date, 'YYYYMMDD') ELSE NULL END,
  LEFT(s.title, 1000),
  s.abstract,
  COALESCE(string_to_array(NULLIF(s.cpc, ''), '|'), ARRAY[]::TEXT[]),
  NULLIF(s.first_claim, ''),
  NULLIF(s.description_snippet, ''),
  NULLIF(s.top_terms, ''),
  CASE WHEN s.country_code = 'IN'
       THEN ARRAY['google-patents-corpus', 'indian-corpus']::TEXT[]
       ELSE ARRAY['google-patents-corpus']::TEXT[] END,
  LEFT(s.title || E'\n' || s.abstract, 20000),
  now(), now()
FROM google_patents_staging s
WHERE s.title IS NOT NULL AND s.abstract IS NOT NULL
  -- Skip a pub_key that a different local_patents row already owns.
  AND NOT EXISTS (
    SELECT 1 FROM local_patents lp
    WHERE lp."publicationNumberKey" = regexp_replace(upper(s.publication_number), '[^A-Z0-9]', '', 'g')
      AND lp."publicationNumber" <> s.publication_number
  )
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
  -- Never overwrite richer IPIndia full text with the (US-only, possibly NULL) import.
  "claimsText"      = COALESCE(local_patents."claimsText", EXCLUDED."claimsText"),
  "descriptionText" = COALESCE(local_patents."descriptionText", EXCLUDED."descriptionText"),
  "ragText"         = COALESCE(local_patents."ragText", EXCLUDED."ragText"),
  "embeddingText"   = COALESCE(NULLIF(local_patents."embeddingText", ''), EXCLUDED."embeddingText"),
  "updatedAt"       = now();

-- ---------------------------------------------------------------------------
-- E. Seed the embedding queue.
--    DEFAULT below embeds ONE representative per family (US/granted/newest first) to
--    save embedding cost and avoid duplicate near-identical vectors. Non-representative
--    family members stay searchable via text/trigram but have no vector.
--    To embed EVERY row instead, use the ALL-ROWS variant at the bottom.
-- ---------------------------------------------------------------------------
INSERT INTO local_patent_embeddings (
  "id", "localPatentId", "model", "dimensions", "textHash",
  "status", "attemptCount", "nextAttemptAt", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (COALESCE(NULLIF(p."familyId", ''), p."publicationNumber"))
  replace(gen_random_uuid()::text, '-', ''),
  p."id", :embed_model, :embed_dims, md5(p."embeddingText"),
  'QUEUED'::"PatentEmbeddingStatus", 0, now(), now(), now()
FROM local_patents p
WHERE p."corpusSources" @> ARRAY['google-patents-corpus']::TEXT[]
  AND p."embeddingText" IS NOT NULL AND p."embeddingText" <> ''
ORDER BY
  COALESCE(NULLIF(p."familyId", ''), p."publicationNumber"),
  CASE WHEN p."country" = 'US' THEN 0 ELSE 1 END,
  CASE WHEN p."kind" LIKE 'B%' THEN 0 WHEN p."kind" LIKE 'A%' THEN 1 ELSE 2 END,
  p."publicationDate" DESC NULLS LAST
ON CONFLICT ("localPatentId", "model", "textHash") DO NOTHING;

-- ALL-ROWS variant (embed every publication, no family dedup):
-- INSERT INTO local_patent_embeddings ("id","localPatentId","model","dimensions","textHash","status","attemptCount","nextAttemptAt","createdAt","updatedAt")
-- SELECT replace(gen_random_uuid()::text,'-',''), p."id", :embed_model, :embed_dims, md5(p."embeddingText"),
--        'QUEUED'::"PatentEmbeddingStatus", 0, now(), now(), now()
-- FROM local_patents p
-- WHERE p."corpusSources" @> ARRAY['google-patents-corpus']::TEXT[] AND p."embeddingText" IS NOT NULL AND p."embeddingText" <> ''
-- ON CONFLICT ("localPatentId","model","textHash") DO NOTHING;

-- ---------------------------------------------------------------------------
-- E2. (OPTIONAL) Give the EXISTING Indian corpus a Voyage representation too, so
-- both corpora search in one vector space. This adds a SECOND embedding row per
-- Indian patent (model = :embed_model) ALONGSIDE its OpenAI row; the OpenAI vector
-- is untouched and still serves until you flip the app to Voyage. Then run the same
-- worker/batch driver. No new column needed -- it writes the configured dtype column
-- (embeddingBinary for binary, embeddingHalf for float) keyed by :embed_model.
-- ---------------------------------------------------------------------------
-- INSERT INTO local_patent_embeddings ("id","localPatentId","model","dimensions","textHash","status","attemptCount","nextAttemptAt","createdAt","updatedAt")
-- SELECT replace(gen_random_uuid()::text,'-',''), p."id", :embed_model, :embed_dims,
--        md5(COALESCE(NULLIF(p."embeddingText",''), NULLIF(p."ragText",''), NULLIF(p."abstract",''), p."title")),
--        'QUEUED'::"PatentEmbeddingStatus", 0, now(), now(), now()
-- FROM local_patents p
-- WHERE p."corpusSources" @> ARRAY['indian-corpus']::TEXT[]
--   AND COALESCE(NULLIF(p."embeddingText",''), NULLIF(p."ragText",''), NULLIF(p."abstract",''), p."title") IS NOT NULL
-- ON CONFLICT ("localPatentId","model","textHash") DO NOTHING;

-- ---------------------------------------------------------------------------
-- F. ANN index + cleanup: see README (build AFTER the backfill; index type
-- depends on the chosen vector dtype). Then: DROP TABLE google_patents_staging;
-- ---------------------------------------------------------------------------
