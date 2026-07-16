#!/usr/bin/env bash
# =============================================================================
# Loader for THIS export: uncompressed, HEADER-row CSV shards named
# patent_extract_*.csv at the root of the bucket (gs://patent-receiving-bucket).
#
# Differs from download-and-load.sh (which expects gzip, no-header, part-*.csv.gz):
#   - no gunzip (files are plain .csv)
#   - \copy ... WITH (FORMAT csv, HEADER true)   <- skips the header row
#   - glob patent_extract_*.csv
#
# Behavior:
#   - Streams each shard: download -> \copy into a temp table -> INSERT ... ON
#     CONFLICT DO NOTHING into google_patents_staging -> delete temp file.
#     The full corpus is never held on disk.
#   - Resume-safe: loaded shards are recorded in google_patents_import_files.
#     Re-running skips them. A shard that half-loaded before a crash is safe to
#     re-run (ON CONFLICT dedups).
#   - Disk guard: aborts cleanly if free space on DATA_MOUNT drops below
#     MIN_FREE_GB (default 80), leaving headroom for the upsert phase.
#
# Run ON THE VM (inside tmux — this takes a while):
#   DATABASE_URL='postgresql://postgres:PASS@localhost:5432/spotipr' \
#   GCS_PREFIX='gs://patent-receiving-bucket' \
#   bash load-local-csv-from-bucket.sh
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL, e.g. postgresql://postgres:PASS@localhost:5432/spotipr}"
: "${GCS_PREFIX:?Set GCS_PREFIX, e.g. gs://patent-receiving-bucket (no trailing slash)}"
DATA_MOUNT="${DATA_MOUNT:-/}"
MIN_FREE_GB="${MIN_FREE_GB:-80}"

tmpfile=""
cleanup() { [ -n "$tmpfile" ] && rm -f "$tmpfile" || true; }
trap cleanup EXIT INT TERM

free_gb() { df -BG --output=avail "$DATA_MOUNT" 2>/dev/null | tail -n1 | tr -dc '0-9'; }

echo "Ensuring staging tables exist..."
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE UNLOGGED TABLE IF NOT EXISTS google_patents_staging (
  publication_number TEXT PRIMARY KEY, pub_canonical TEXT,
  title TEXT, abstract TEXT, url TEXT, cpc TEXT, top_terms TEXT,
  country_code TEXT, publication_date TEXT, filing_date TEXT,
  kind_code TEXT, family_id TEXT, first_claim TEXT, description_snippet TEXT
);
CREATE TABLE IF NOT EXISTS google_patents_import_files (
  file_name TEXT PRIMARY KEY, loaded_at TIMESTAMPTZ NOT NULL DEFAULT now(), row_count BIGINT
);
SQL

echo "Listing shards under ${GCS_PREFIX} ..."
shards=$(gcloud storage ls "${GCS_PREFIX}/patent_extract_*.csv")
total=$(echo "$shards" | wc -l)
echo "Found $total shards. Starting (resume-safe; already-loaded shards are skipped)."

index=0; loaded=0; skipped=0; started=$(date +%s)
for shard in $shards; do
  index=$((index + 1))
  name=$(basename "$shard")

  already=$(psql "$DATABASE_URL" -tAqc "SELECT 1 FROM google_patents_import_files WHERE file_name = '$name'")
  if [ "$already" = "1" ]; then
    skipped=$((skipped + 1))
    [ $((index % 200)) -eq 0 ] && echo "[$index/$total] ...skipping already-loaded shards ($skipped so far)"
    continue
  fi

  # Disk guard: stop BEFORE we run the box out of space.
  fg=$(free_gb)
  if [ -n "$fg" ] && [ "$fg" -lt "$MIN_FREE_GB" ]; then
    echo "ABORT: only ${fg}G free on $DATA_MOUNT (< ${MIN_FREE_GB}G guard)."
    echo "The load is resume-safe — free up space (or grow the disk), then re-run this script."
    exit 2
  fi

  tmpfile=$(mktemp "${TMPDIR:-/tmp}/gp-shard-XXXXXX.csv")
  gcloud storage cat "$shard" > "$tmpfile"
  # Row count for the ledger = file lines minus header (cheap; no table scan).
  shard_rows=$(( $(wc -l < "$tmpfile") - 1 ))

  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 <<SQL
CREATE TEMP TABLE _shard (LIKE google_patents_staging INCLUDING DEFAULTS);
\copy _shard FROM '$tmpfile' WITH (FORMAT csv, HEADER true)
INSERT INTO google_patents_staging
SELECT * FROM _shard
WHERE publication_number IS NOT NULL AND publication_number <> ''
  AND publication_number <> 'publication_number'  -- header literal, defense-in-depth
ON CONFLICT (publication_number) DO NOTHING;
SQL
  rm -f "$tmpfile"; tmpfile=""

  psql "$DATABASE_URL" -qc "INSERT INTO google_patents_import_files(file_name, row_count) VALUES ('$name', $shard_rows) ON CONFLICT (file_name) DO NOTHING"
  loaded=$((loaded + 1))

  if [ $((loaded % 50)) -eq 0 ]; then
    elapsed=$(( $(date +%s) - started ))
    rate=$(( loaded * 60 / (elapsed + 1) ))
    remain=$(( (total - index) / (rate > 0 ? rate : 1) ))
    echo "[$index/$total] $loaded loaded, $skipped skipped | ~${rate} shards/min | ~${remain} min left | ${fg:-?}G free"
  fi
done

echo "Shard loop complete: $loaded loaded, $skipped skipped (of $total)."
echo "Final staging count (single full count, may take a minute):"
psql "$DATABASE_URL" -c "SELECT count(*) AS staging_rows FROM google_patents_staging;"
psql "$DATABASE_URL" -c "SELECT count(*) AS ledger_files, sum(row_count) AS ledger_rows FROM google_patents_import_files;"
echo "Next: bash run-upsert.sh   (staging -> local_patents + embedding queue)"
