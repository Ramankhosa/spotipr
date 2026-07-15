-- Canonical SELECT body for the publications staging table (14 columns, in loader
-- order). Placeholders __START__/__END__ are YYYYMMDD ints. run-staging.sh wraps this
-- in CREATE OR REPLACE (first year) or INSERT INTO (subsequent years).
--
-- LEAN mode: to drop the TB-scale description scan + ~36-80GB of Postgres, replace the
-- description_snippet line with:   '' AS description_snippet
SELECT
  r.publication_number,
  REGEXP_REPLACE(REGEXP_REPLACE(UPPER(r.publication_number), r'[^A-Z0-9]', ''), r'[A-Z]\d*$', '') AS pub_canonical,
  REGEXP_REPLACE(TRIM(r.title),    r'\s+', ' ') AS title,
  REGEXP_REPLACE(TRIM(r.abstract), r'\s+', ' ') AS abstract,
  r.url,
  ARRAY_TO_STRING(ARRAY(SELECT DISTINCT c.code FROM UNNEST(p.cpc) c WHERE c.code IS NOT NULL), '|') AS cpc,
  ARRAY_TO_STRING(r.top_terms, '|') AS top_terms,
  p.country_code,
  IFNULL(CAST(p.publication_date AS STRING), '') AS publication_date,
  IFNULL(CAST(p.filing_date      AS STRING), '') AS filing_date,
  IFNULL(p.kind_code, '') AS kind_code,
  IFNULL(CAST(p.family_id AS STRING), '') AS family_id,
  REGEXP_REPLACE((SELECT c.text FROM UNNEST(p.claims_localized) c WHERE c.language = 'en' LIMIT 1), r'\s+', ' ') AS first_claim,
  LEFT(REGEXP_REPLACE((SELECT d.text FROM UNNEST(p.description_localized) d WHERE d.language = 'en' LIMIT 1), r'\s+', ' '), 5000) AS description_snippet
FROM `patents-public-data.google_patents_research.publications` AS r
JOIN `patents-public-data.patents.publications` AS p
  ON r.publication_number = p.publication_number
WHERE p.publication_date BETWEEN __START__ AND __END__
  AND r.title IS NOT NULL
  AND r.abstract IS NOT NULL
  AND LENGTH(TRIM(r.abstract)) >= 40
