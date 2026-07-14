-- =============================================================================
-- Step 3: Export the publications staging table to Cloud Storage as gzip CSV.
--
-- Create the bucket once (same region as the dataset):
--   gcloud storage buckets create gs://__BUCKET__ --location=US
--
-- Replace __PROJECT__ and __BUCKET__ before running. Arrays are pipe-joined so
-- the CSV stays flat; the Postgres loader splits them back out.
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
  pub_key,
  pub_canonical,
  country_code,
  IFNULL(kind_code, ''),
  IFNULL(family_id, ''),
  IFNULL(CAST(publication_date AS STRING), ''),
  IFNULL(CAST(filing_date AS STRING), ''),
  title,
  abstract,
  ARRAY_TO_STRING(cpc_codes, '|'),
  ARRAY_TO_STRING(assignees, '|'),
  ARRAY_TO_STRING(inventors, '|'),
  CAST(abstract_translated AS STRING),
  CAST(is_family_representative AS STRING)
FROM `__PROJECT__.spotipr_patents.publications_staging`;
