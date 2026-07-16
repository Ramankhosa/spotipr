#!/usr/bin/env bash
# =============================================================================
# Build the BigQuery publications_staging table year-by-year (bounded scan cost
# per query, checkpointed). First year creates the table; later years append.
#
#   GCP_PROJECT=my-proj START_YEAR=2015 END_YEAR=2025 ./run-staging.sh
#
# Env:
#   GCP_PROJECT        (required) billing/query project
#   START_YEAR END_YEAR (required) inclusive publication-year range
#   YEAR_STEP          default 5 (years per query). These tables are NOT date-
#                      partitioned, so each query re-scans the full columns; bigger
#                      batches = fewer scans = cheaper. 5 balances cost vs checkpoints.
#                      Verify with --dry_run before committing (see README).
#   DATASET            default spotipr_patents
#   MAX_BYTES_BILLED   default 4TB per query (hard cap; a batch that would exceed it
#                      FAILS instead of billing — raise if you include description_snippet)
# =============================================================================
set -euo pipefail
: "${GCP_PROJECT:?Set GCP_PROJECT}"
: "${START_YEAR:?Set START_YEAR}"
: "${END_YEAR:?Set END_YEAR}"
YEAR_STEP="${YEAR_STEP:-5}"
DATASET="${DATASET:-spotipr_patents}"
MAX_BYTES="${MAX_BYTES_BILLED:-4000000000000}"
TABLE="${GCP_PROJECT}.${DATASET}.publications_staging"
SELECT_FILE="$(dirname "$0")/staging-select.sql"

first=1
for (( y=START_YEAR; y<=END_YEAR; y+=YEAR_STEP )); do
  batch_end=$(( y + YEAR_STEP - 1 ))
  if [ "$batch_end" -gt "$END_YEAR" ]; then batch_end="$END_YEAR"; fi
  start="${y}0101"; end="${batch_end}1231"
  select_sql="$(sed -e "s/__START__/${start}/g" -e "s/__END__/${end}/g" "$SELECT_FILE")"
  if [ "$first" -eq 1 ]; then
    # No CLUSTER BY: publications_staging is transit-only (exported to GCS then
    # dropped), so a full 130M-row sort would be pure overhead. Clustering only
    # matters for the claims lookup table (02-bigquery-claims-staging.sql).
    stmt="CREATE OR REPLACE TABLE \`${TABLE}\` AS
${select_sql}"
    first=0
  else
    stmt="INSERT INTO \`${TABLE}\`
${select_sql}"
  fi
  echo "=== [${y}..${batch_end}] ==="
  bq query --nouse_legacy_sql --maximum_bytes_billed="${MAX_BYTES}" \
    --project_id="${GCP_PROJECT}" "${stmt}"
  echo "=== [${y}..${batch_end}] done ==="
done

echo "Staging build complete. Row count:"
bq query --nouse_legacy_sql --project_id="${GCP_PROJECT}" \
  "SELECT COUNT(*) AS rows, COUNTIF(country_code='IN') AS india, COUNTIF(first_claim IS NOT NULL AND first_claim<>'') AS with_claims FROM \`${TABLE}\`"
