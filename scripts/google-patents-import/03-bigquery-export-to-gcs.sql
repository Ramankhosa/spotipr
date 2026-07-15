-- =============================================================================
-- Step 3: Export the publications staging table to Cloud Storage as gzip CSV.
--
-- Column order MUST match google_patents_staging in 04-postgres-load-and-upsert.sql
-- and download-and-load.sh. header=FALSE so the loader can \copy directly.
--
-- Create the bucket once (same region as the dataset):
--   gcloud storage buckets create gs://__BUCKET__ --location=US
-- Replace __PROJECT__ and __BUCKET__ before running.
-- =============================================================================

EXPORT DATA OPTIONS (
  uri = 'gs://__BUCKET__/spotipr-patents/publications/part-*.csv.gz',
  format = 'CSV',
  compression = 'GZIP',
  overwrite = TRUE,
  header = FALSE,
  field_delimiter = ','
) AS
SELECT
  publication_number,
  pub_canonical,
  title,
  abstract,
  IFNULL(url, ''),
  IFNULL(cpc, ''),
  IFNULL(top_terms, ''),
  IFNULL(country_code, ''),
  publication_date,
  filing_date,
  kind_code,
  family_id,
  IFNULL(first_claim, ''),
  IFNULL(description_snippet, '')
FROM `__PROJECT__.spotipr_patents.publications_staging`;
