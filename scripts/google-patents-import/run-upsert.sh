#!/usr/bin/env bash
# =============================================================================
# Runs 04-postgres-load-and-upsert.sql (staging -> local_patents + embedding
# queue seed) with before/after counts so the change is observable.
# Idempotent: ON CONFLICT everywhere; safe to re-run after an interruption.
#
#   DATABASE_URL='postgresql://postgres:PASS@localhost:5432/spotipr' \
#   bash run-upsert.sh
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL}"
EMBED_MODEL="${EMBED_MODEL:-voyage-3.5-lite}"
EMBED_DIMS="${EMBED_DIMS:-512}"
DIR="$(cd "$(dirname "$0")" && pwd)"

q() { psql "$DATABASE_URL" -tAqc "$1"; }

stg=$(q "SELECT count(*) FROM google_patents_staging" 2>/dev/null || true)
if [ -z "$stg" ] || [ "$stg" = "0" ]; then
  echo "ABORT: google_patents_staging is empty or missing — run load-local-csv-from-bucket.sh first."
  exit 1
fi

echo "== Upsert: staging ($stg rows) -> local_patents =="
echo "before: local_patents (google corpus) = $(q "SELECT count(*) FROM local_patents WHERE \"corpusSources\" @> ARRAY['google-patents-corpus']::text[]")"
echo "before: embedding queue (model=$EMBED_MODEL) = $(q "SELECT count(*) FROM local_patent_embeddings WHERE model='$EMBED_MODEL'")"
echo "This is the heavy step (one big INSERT ... ON CONFLICT). Expect it to run a while. Started $(date)."

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v embed_model="'$EMBED_MODEL'" -v embed_dims="$EMBED_DIMS" \
  -f "$DIR/04-postgres-load-and-upsert.sql"

echo "== Done $(date) =="
echo "after: local_patents (google corpus) = $(q "SELECT count(*) FROM local_patents WHERE \"corpusSources\" @> ARRAY['google-patents-corpus']::text[]")"
echo "after: embedding queue (model=$EMBED_MODEL) = $(q "SELECT count(*) FROM local_patent_embeddings WHERE model='$EMBED_MODEL'")"
echo "sample: "
psql "$DATABASE_URL" -c "SELECT \"publicationNumber\", \"country\", \"publicationDate\", left(\"title\", 60) AS title FROM local_patents WHERE \"corpusSources\" @> ARRAY['google-patents-corpus']::text[] ORDER BY \"id\" DESC LIMIT 5;"
cat <<'EOT'

Verify the numbers look right, then:
  1) reclaim staging space:   psql "$DATABASE_URL" -c 'DROP TABLE google_patents_staging;'
  2) embedding phase:         VOYAGE_API_KEY=... bash run-embeddings.sh
EOT
