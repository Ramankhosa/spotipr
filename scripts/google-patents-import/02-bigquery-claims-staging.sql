-- =============================================================================
-- Step 2: Claims staging table — STAYS in BigQuery (not imported to Postgres).
--
-- The app fetches claims on demand for the handful of shortlisted references per
-- novelty run (src/lib/google-patents-claims-service.ts). Clustering by
-- pub_canonical means each lookup scans only the matching blocks — fractions of
-- a cent per run instead of importing ~100GB of claims text onto a small server.
--
-- IMPORTANT (verified): claims_localized is populated for US publications only in
-- the public dataset. Non-US references (including IN) have no claims here; the
-- Indian corpus keeps getting claims/descriptions from the IPIndia PDF pipeline.
--
-- Replace __PROJECT__ before running.
-- =============================================================================

CREATE OR REPLACE TABLE `__PROJECT__.spotipr_patents.patent_claims`
CLUSTER BY pub_canonical
AS
SELECT
  p.publication_number,
  REGEXP_REPLACE(
    REGEXP_REPLACE(UPPER(p.publication_number), r'[^A-Z0-9]', ''),
    r'[A-Z]\d*$', ''
  ) AS pub_canonical,
  -- Granted claims (B*) are preferred over application claims at lookup time.
  CASE WHEN STARTS_WITH(p.kind_code, 'B') THEN 0 ELSE 1 END AS kind_preference,
  (SELECT c.text FROM UNNEST(p.claims_localized) c WHERE c.language = 'en' LIMIT 1) AS claims_text
FROM `patents-public-data.patents.publications` p
WHERE p.publication_date >= 20160101
  AND p.country_code = 'US'
  AND ARRAY_LENGTH(p.claims_localized) > 0;
