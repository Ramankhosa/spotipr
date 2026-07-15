-- =============================================================================
-- Step 1: Build the publications staging table in YOUR BigQuery project.
--
-- Matches the agreed export shape (research-table driven, so English title/abstract
-- exist for EVERY country), plus the keys the Postgres corpus needs.
--
-- THREE corrections vs. the draft query, all important:
--   1. claims/description use language='en' extraction, NOT [SAFE_OFFSET(0)].
--      [0] returns whichever language is first in the array (not guaranteed English)
--      and .text is the FULL claims blob, not "the first independent claim".
--   2. cpc and top_terms are REPEATED -> flattened to '|'-joined strings so the CSV
--      stays flat (EXPORT DATA cannot put a repeated field in a CSV column).
--   3. newlines collapsed to spaces in every text field so quoted CSV rows stay sane.
--
-- COST WARNING: referencing p.description_localized scans the single LARGEST column
-- in the dataset (hundreds of GB - TBs). LEFT(...,5000) does NOT reduce the scan --
-- BigQuery bills bytes SCANNED, not returned. Run year-by-year (edit __START__/__END__)
-- and watch --maximum_bytes_billed. If description isn't essential, delete the
-- description_snippet line to cut most of the cost. Claims/description are US-only.
--
-- Replace __PROJECT__; set the date window. Run:
--   bq query --nouse_legacy_sql --maximum_bytes_billed=2000000000000 --project_id=$GCP_PROJECT < 01-bigquery-staging.sql
-- =============================================================================

CREATE OR REPLACE TABLE `__PROJECT__.spotipr_patents.publications_staging`
CLUSTER BY pub_canonical
AS
SELECT
  r.publication_number,
  -- Canonical key (uppercase alphanumerics, kind code stripped) for clustering,
  -- family grouping, and joins to the claims table. pub_key is computed in Postgres.
  REGEXP_REPLACE(
    REGEXP_REPLACE(UPPER(r.publication_number), r'[^A-Z0-9]', ''),
    r'[A-Z]\d*$', ''
  ) AS pub_canonical,
  REGEXP_REPLACE(TRIM(r.title), r'\s+', ' ') AS title,
  REGEXP_REPLACE(TRIM(r.abstract), r'\s+', ' ') AS abstract,
  r.url,
  ARRAY_TO_STRING(ARRAY(
    SELECT DISTINCT c.code FROM UNNEST(p.cpc) c WHERE c.code IS NOT NULL
  ), '|') AS cpc,
  ARRAY_TO_STRING(r.top_terms, '|') AS top_terms,
  p.country_code,
  IFNULL(CAST(p.publication_date AS STRING), '') AS publication_date,
  IFNULL(CAST(p.filing_date AS STRING), '') AS filing_date,
  IFNULL(p.kind_code, '') AS kind_code,
  IFNULL(CAST(p.family_id AS STRING), '') AS family_id,
  -- Full English claims blob (US publications only; NULL elsewhere).
  REGEXP_REPLACE(
    (SELECT c.text FROM UNNEST(p.claims_localized) c WHERE c.language = 'en' LIMIT 1),
    r'\s+', ' '
  ) AS first_claim,
  -- First 5,000 chars of the English description (US publications only; NULL elsewhere).
  LEFT(REGEXP_REPLACE(
    (SELECT d.text FROM UNNEST(p.description_localized) d WHERE d.language = 'en' LIMIT 1),
    r'\s+', ' '
  ), 5000) AS description_snippet
FROM `patents-public-data.google_patents_research.publications` AS r
JOIN `patents-public-data.patents.publications` AS p
  ON r.publication_number = p.publication_number
WHERE p.publication_date BETWEEN __START__ AND __END__   -- e.g. 20160101 AND 20161231
  AND r.title IS NOT NULL
  AND r.abstract IS NOT NULL
  AND LENGTH(TRIM(r.abstract)) >= 40;
