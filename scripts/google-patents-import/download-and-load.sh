#!/usr/bin/env bash
# =============================================================================
# Step 3.5: Stream the exported gzip CSV shards from GCS into Postgres.
#
# Run ON THE DATABASE SERVER (or a machine close to it). Requirements:
#   - gcloud CLI authenticated (gcloud auth login / service account)
#   - psql in PATH
# Environment:
#   DATABASE_URL   postgres connection string           (required)
#   GCS_PREFIX     gs://bucket/spotipr-patents/publications  (required)
# Resume-safe: loaded shard names are recorded in google_patents_import_files.
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL}"
: "${GCS_PREFIX:?Set GCS_PREFIX, e.g. gs://my-bucket/spotipr-patents/publications}"

echo "Ensuring staging tables exist..."
psql "$DATABASE_URL" -q <<'SQL'
CREATE UNLOGGED TABLE IF NOT EXISTS google_patents_staging (
  publication_number TEXT PRIMARY KEY, pub_key TEXT, pub_canonical TEXT,
  country_code TEXT, kind_code TEXT, family_id TEXT,
  publication_date TEXT, filing_date TEXT, title TEXT, abstract TEXT,
  cpc_codes TEXT, assignees TEXT, inventors TEXT,
  abstract_translated TEXT, is_family_representative TEXT
);
CREATE TABLE IF NOT EXISTS google_patents_import_files (
  file_name TEXT PRIMARY KEY, loaded_at TIMESTAMPTZ NOT NULL DEFAULT now(), row_count BIGINT
);
SQL

shards=$(gcloud storage ls "${GCS_PREFIX}/part-*.csv.gz")
total=$(echo "$shards" | wc -l)
index=0

for shard in $shards; do
  index=$((index + 1))
  name=$(basename "$shard")
  already=$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM google_patents_import_files WHERE file_name = '$name'")
  if [ "$already" = "1" ]; then
    echo "[$index/$total] $name already loaded, skipping."
    continue
  fi
  echo "[$index/$total] Loading $name ..."
  # Download to a temp file first: psql reads the SQL script from stdin, so the
  # CSV must come from a file path via client-side \copy. Re-runs of a partially
  # loaded shard are safe: rows land in a temp table and are inserted with
  # ON CONFLICT DO NOTHING.
  tmpfile=$(mktemp "${TMPDIR:-/tmp}/gp-shard-XXXXXX.csv")
  gcloud storage cat "$shard" | gunzip -c > "$tmpfile"
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 <<SQL
CREATE TEMP TABLE _shard (LIKE google_patents_staging INCLUDING ALL);
\copy _shard FROM '$tmpfile' WITH (FORMAT csv)
INSERT INTO google_patents_staging SELECT * FROM _shard ON CONFLICT (publication_number) DO NOTHING;
SQL
  rm -f "$tmpfile"
  rows=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM google_patents_staging")
  psql "$DATABASE_URL" -qc "INSERT INTO google_patents_import_files(file_name, row_count) VALUES ('$name', $rows) ON CONFLICT DO NOTHING"
  echo "[$index/$total] $name done (staging total: $rows rows)."
done

echo "All shards loaded. Next: run sections C-F of 04-postgres-load-and-upsert.sql"
