-- =============================================================================
-- Step 1: Build the publications staging table in YOUR BigQuery project.
--
-- Sources (verified against the public dataset docs):
--   patents-public-data.patents.publications         — bibliographic + localized text
--     (title_localized / abstract_localized are REPEATED RECORD {text, language};
--      claims_localized / description_localized exist for US publications ONLY;
--      dates are INT64 in YYYYMMDD form; family_id joins family members)
--   patents-public-data.google_patents_research.publications
--     — English title/abstract (machine-translated where needed) + top_terms
--
-- Run with: bq query --nouse_legacy_sql --project_id=$GCP_PROJECT < 01-bigquery-staging.sql
-- First create the dataset once:  bq mk --location=US $GCP_PROJECT:spotipr_patents
--
-- Replace __PROJECT__ before running (sed "s/__PROJECT__/$GCP_PROJECT/g").
-- Adjust the publication window via the WHERE clause (default: last 10 years).
-- =============================================================================

CREATE OR REPLACE TABLE `__PROJECT__.spotipr_patents.publications_staging`
CLUSTER BY pub_canonical
AS
WITH base AS (
  SELECT
    p.publication_number,
    REGEXP_REPLACE(UPPER(p.publication_number), r'[^A-Z0-9]', '') AS pub_key,
    REGEXP_REPLACE(
      REGEXP_REPLACE(UPPER(p.publication_number), r'[^A-Z0-9]', ''),
      r'[A-Z]\d*$', ''
    ) AS pub_canonical,
    p.country_code,
    p.kind_code,
    CAST(p.family_id AS STRING) AS family_id,
    SAFE.PARSE_DATE('%Y%m%d', CAST(p.publication_date AS STRING)) AS publication_date,
    SAFE.PARSE_DATE('%Y%m%d', CAST(p.filing_date AS STRING)) AS filing_date,
    -- Prefer the research table's English title/abstract (machine-translated when the
    -- original is not English); fall back to the localized English text if present.
    REGEXP_REPLACE(COALESCE(
      NULLIF(TRIM(r.title), ''),
      (SELECT t.text FROM UNNEST(p.title_localized) t WHERE t.language = 'en' LIMIT 1)
    ), r'\s+', ' ') AS title,
    REGEXP_REPLACE(COALESCE(
      NULLIF(TRIM(r.abstract), ''),
      (SELECT a.text FROM UNNEST(p.abstract_localized) a WHERE a.language = 'en' LIMIT 1)
    ), r'\s+', ' ') AS abstract,
    COALESCE(r.abstract_translated, FALSE) AS abstract_translated,
    ARRAY(SELECT DISTINCT c.code FROM UNNEST(p.cpc) c WHERE c.code IS NOT NULL) AS cpc_codes,
    ARRAY(SELECT DISTINCT a.name FROM UNNEST(p.assignee_harmonized) a WHERE a.name IS NOT NULL) AS assignees,
    ARRAY(SELECT DISTINCT i.name FROM UNNEST(p.inventor_harmonized) i WHERE i.name IS NOT NULL) AS inventors
  FROM `patents-public-data.patents.publications` p
  LEFT JOIN `patents-public-data.google_patents_research.publications` r
    ON r.publication_number = p.publication_number
  WHERE p.publication_date >= 20160101
),
usable AS (
  SELECT * FROM base
  WHERE title IS NOT NULL
    AND abstract IS NOT NULL
    AND LENGTH(abstract) >= 40
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(NULLIF(family_id, ''), publication_number)
      ORDER BY
        -- Prefer the US member (claims text exists only for US publications, so the
        -- family representative keeps claims-on-demand available), then granted (B*)
        -- over applications (A*), then the most recent publication.
        CASE WHEN country_code = 'US' THEN 0 ELSE 1 END,
        CASE WHEN STARTS_WITH(kind_code, 'B') THEN 0
             WHEN STARTS_WITH(kind_code, 'A') THEN 1
             ELSE 2 END,
        publication_date DESC
    ) AS family_rank
  FROM usable
)
-- One representative per family for the global corpus, PLUS every Indian publication
-- regardless of family rank: IN rows are additionally routed into the Indian corpus
-- on the Postgres side, and must not disappear behind a US family sibling.
SELECT * EXCEPT(family_rank), (family_rank = 1) AS is_family_representative
FROM ranked
WHERE family_rank = 1 OR country_code = 'IN';
