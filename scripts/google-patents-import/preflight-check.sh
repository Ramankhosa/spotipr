#!/usr/bin/env bash
# =============================================================================
# Preflight checks for the Google Patents corpus load. READ-ONLY — no mutations.
# Run this on the production VM BEFORE loading. It fails fast (exit 1) if any
# blocking condition is found, with a concrete fix for each.
#
#   DATABASE_URL='postgresql://postgres:PASS@localhost:5432/spotipr' \
#   GCS_PREFIX='gs://patent-receiving-bucket' \
#   bash preflight-check.sh
# =============================================================================
set -uo pipefail   # deliberately NOT -e: we run every check, then summarize.

DATABASE_URL="${DATABASE_URL:-}"
GCS_PREFIX="${GCS_PREFIX:-}"
DATA_MOUNT="${DATA_MOUNT:-/}"                      # where the PG data dir lives
MIN_FREE_GB_START="${MIN_FREE_GB_START:-200}"     # need this much free to start
EMBED_MODEL="${EMBED_MODEL:-voyage-3.5-lite}"

if [ -t 1 ]; then G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; B=$'\033[1m'; N=$'\033[0m'
else G=''; Y=''; R=''; B=''; N=''; fi

fail=0; warn=0
pass()  { printf '  %s[PASS]%s %s\n' "$G" "$N" "$1"; }
fyi()   { printf '         %s\n' "$1"; }
warnf() { printf '  %s[WARN]%s %s\n' "$Y" "$N" "$1"; warn=$((warn+1)); }
failf() { printf '  %s[FAIL]%s %s\n'   "$R" "$N" "$1"; fail=$((fail+1)); }

# Scalar query helper (silent on error, returns empty).
q() { psql "$DATABASE_URL" -tAqc "$1" 2>/dev/null | tr -d '[:space:]'; }
# True if $1 >= $2 (semver-ish).
ver_ge() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]; }

printf '%s== Google Patents load — preflight ==%s\n' "$B" "$N"

# --- 0. Required env --------------------------------------------------------
echo "-- environment"
[ -n "$DATABASE_URL" ] && pass "DATABASE_URL is set" || failf "DATABASE_URL not set"
[ -n "$GCS_PREFIX" ]   && pass "GCS_PREFIX=$GCS_PREFIX" || failf "GCS_PREFIX not set (e.g. gs://patent-receiving-bucket)"
if [ -n "${VOYAGE_API_KEY:-}" ]; then pass "VOYAGE_API_KEY is set (needed later, for embedding)"
else warnf "VOYAGE_API_KEY not set — fine for load/upsert, REQUIRED before the embedding phase"; fi

# Nothing else works without a DB URL.
if [ -z "$DATABASE_URL" ]; then
  printf '\n%s[FAIL]%s Cannot continue without DATABASE_URL.\n' "$R" "$N"; exit 1
fi

# --- 1. Database ------------------------------------------------------------
echo "-- database"
if [ "$(q 'SELECT 1')" = "1" ]; then
  pass "connected to Postgres"
  dbname=$(q 'SELECT current_database()'); fyi "database = $dbname"
else
  failf "cannot connect with DATABASE_URL (check host/user/password/db)"
  printf '\n%s[FAIL]%s Cannot continue without a DB connection.\n' "$R" "$N"; exit 1
fi

pgver=$(q 'SHOW server_version'); fyi "Postgres $pgver"

# pgvector — the critical one. The migration adds halfvec(512)/bit(512),
# which need pgvector >= 0.7. Without it, `prisma migrate deploy` fails.
vecver=$(q "SELECT extversion FROM pg_extension WHERE extname='vector'")
if [ -z "$vecver" ]; then
  failf "pgvector extension not installed. Fix: CREATE EXTENSION vector;  (and ensure the package is >= 0.7)"
elif ver_ge "$vecver" "0.7.0"; then
  pass "pgvector $vecver (>= 0.7 — supports halfvec/bit)"
else
  failf "pgvector $vecver is < 0.7. The migration needs >= 0.7 for halfvec(512)/bit(512)."
  fyi  "Fix on Ubuntu: install a newer pgvector (e.g. 'apt-get install postgresql-17-pgvector' with a 0.7+ build,"
  fyi  "or build from source), then: ALTER EXTENSION vector UPDATE;  — verify with the query above."
fi

# Migration applied? (functional check: the columns the upsert writes.)
echo "-- schema (migration 20260713120000_google_patent_corpus)"
hf=$(q "SELECT 1 FROM information_schema.columns WHERE table_name='local_patents' AND column_name='familyId'")
hb=$(q "SELECT 1 FROM information_schema.columns WHERE table_name='local_patent_embeddings' AND column_name='embeddingBinary'")
hh=$(q "SELECT 1 FROM information_schema.columns WHERE table_name='local_patent_embeddings' AND column_name='embeddingHalf'")
he=$(q "SELECT 1 FROM pg_type WHERE typname='PatentEmbeddingStatus'")
if [ "$hf" = "1" ] && [ "$hb" = "1" ] && [ "$hh" = "1" ]; then
  pass "corpus columns present (familyId, embeddingBinary, embeddingHalf)"
else
  failf "corpus columns missing — run:  npx prisma migrate deploy   (from the app dir, BEFORE loading)"
  [ "$hf" = "1" ] || fyi "missing: local_patents.familyId"
  [ "$hb" = "1" ] || fyi "missing: local_patent_embeddings.embeddingBinary"
  [ "$hh" = "1" ] || fyi "missing: local_patent_embeddings.embeddingHalf"
fi
[ "$he" = "1" ] && pass "enum PatentEmbeddingStatus present" || failf "enum PatentEmbeddingStatus missing — run the migrations"

# --- 2. Current state (so re-runs are understood, not blocked) --------------
echo "-- current state (informational; the load is resumable/idempotent)"
stg=$(q "SELECT count(*) FROM google_patents_staging"); [ -n "$stg" ] && fyi "google_patents_staging rows: $stg" || fyi "google_patents_staging: not created yet"
goog=$(q "SELECT count(*) FROM local_patents WHERE \"corpusSources\" @> ARRAY['google-patents-corpus']::text[]"); fyi "local_patents (google-patents-corpus) rows: ${goog:-0}"
que=$(q "SELECT count(*) FROM local_patent_embeddings WHERE model='$EMBED_MODEL'"); fyi "embedding queue rows (model=$EMBED_MODEL): ${que:-0}"

# --- 3. Disk ----------------------------------------------------------------
echo "-- disk ($DATA_MOUNT)"
freeg=$(df -BG --output=avail "$DATA_MOUNT" 2>/dev/null | tail -n1 | tr -dc '0-9')
if [ -n "$freeg" ]; then
  if [ "$freeg" -ge "$MIN_FREE_GB_START" ]; then pass "free space ${freeg}G (>= ${MIN_FREE_GB_START}G)"
  else failf "only ${freeg}G free on $DATA_MOUNT; want >= ${MIN_FREE_GB_START}G (staging + local_patents coexist at peak)"; fi
else warnf "could not read free space on $DATA_MOUNT"; fi

# --- 4. Bucket / gcloud -----------------------------------------------------
echo "-- bucket / gcloud"
acct=$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n1)
[ -n "$acct" ] && pass "gcloud authenticated as $acct" || failf "gcloud not authenticated — run: gcloud auth login  (or attach a service account)"
if [ -n "$GCS_PREFIX" ]; then
  nfiles=$(gcloud storage ls "${GCS_PREFIX}/patent_extract_*.csv" 2>/dev/null | wc -l | tr -dc '0-9')
  if [ -n "$nfiles" ] && [ "$nfiles" -gt 0 ]; then pass "bucket reachable — ${nfiles} patent_extract_*.csv shards found"
  else failf "no patent_extract_*.csv found under $GCS_PREFIX (check the path and gcloud auth)"; fi
fi

# --- Summary ----------------------------------------------------------------
echo
if [ "$fail" -gt 0 ]; then
  printf '%s%d blocking issue(s), %d warning(s). Fix the FAILs above before loading.%s\n' "$R" "$fail" "$warn" "$N"
  exit 1
elif [ "$warn" -gt 0 ]; then
  printf '%sPreflight OK with %d warning(s). Safe to load; resolve warnings before the embedding phase.%s\n' "$Y" "$warn" "$N"
  exit 0
else
  printf '%sPreflight passed. Safe to start the load.%s\n' "$G" "$N"
  exit 0
fi
