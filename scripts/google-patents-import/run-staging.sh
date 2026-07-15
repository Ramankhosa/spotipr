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
#   DATASET            default spotipr_patents
#   MAX_BYTES_BILLED   default 4TB per query (hard cap; a year that would exceed
#                      it FAILS instead of billing — raise if a year legitimately
#                      needs more, e.g. when description_snippet is included)
# =============================================================================
set -euo pipefail
: "${GCP_PROJECT:?Set GCP_PROJECT}"
: "${START_YEAR:?Set START_YEAR}"
: "${END_YEAR:?Set END_YEAR}"
DATASET="${DATASET:-spotipr_patents}"
MAX_BYTES="${MAX_BYTES_BILLED:-4000000000000}"
TABLE="${GCP_PROJECT}.${DATASET}.publications_staging"
SELECT_FILE="$(dirname "$0")/staging-select.sql"

for (( y=START_YEAR; y<=END_YEAR; y++ )); do
  start="${y}0101"; end="${y}1231"
  select_sql="$(sed -e "s/__START__/${start}/g" -e "s/__END__/${end}/g" "$SELECT_FILE")"
  if [ "$y" -eq "$START_YEAR" ]; then
    stmt="CREATE OR REPLACE TABLE \`${TABLE}\` CLUSTER BY pub_canonical AS
${select_sql}"
  else
    stmt="INSERT INTO \`${TABLE}\`
${select_sql}"
  fi
  echo "=== [$y] ${start}..${end} ==="
  bq query --nouse_legacy_sql --maximum_bytes_billed="${MAX_BYTES}" \
    --project_id="${GCP_PROJECT}" "${stmt}"
  echo "=== [$y] done ==="
done

echo "Staging build complete. Row count:"
bq query --nouse_legacy_sql --project_id="${GCP_PROJECT}" \
  "SELECT COUNT(*) AS rows, COUNTIF(country_code='IN') AS india, COUNTIF(first_claim IS NOT NULL AND first_claim<>'') AS with_claims FROM \`${TABLE}\`"
