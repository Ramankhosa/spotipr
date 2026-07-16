#!/usr/bin/env bash
# =============================================================================
# FINAL step — build the ANN index over the binary vectors. Run ONLY after the
# embedding backfill completes (IVFFlat centroids need the data present).
# Uses CREATE INDEX CONCURRENTLY: production reads/writes keep working, but
# expect it to take a while (hours-scale on small vCPU counts).
#
#   DATABASE_URL='postgresql://postgres:PASS@localhost:5432/spotipr' \
#   bash build-ann-index.sh
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL}"
LISTS="${LISTS:-2000}"   # ~sqrt-ish of expected vector count; 2000 fits ~4-12M vectors
PROBES="${PROBES:-24}"

pending=$(psql "$DATABASE_URL" -tAqc "SELECT count(*) FROM local_patent_embeddings WHERE status IN ('QUEUED','PROCESSING') AND \"embeddingBinary\" IS NULL")
done_ct=$(psql "$DATABASE_URL" -tAqc "SELECT count(*) FROM local_patent_embeddings WHERE \"embeddingBinary\" IS NOT NULL")
echo "vectors present: $done_ct; still pending: $pending"
if [ "$pending" != "0" ]; then
  echo "WARN: $pending embeddings still pending. The index only covers rows embedded so far."
  echo "      Prefer to wait for the backfill to finish, or re-run this script later (drop + recreate)."
fi
if [ "$done_ct" = "0" ]; then
  echo "ABORT: no binary vectors yet — run run-embeddings.sh first."
  exit 1
fi

dbname=$(psql "$DATABASE_URL" -tAqc "SELECT current_database()")
echo "Building IVFFlat Hamming index (lists=$LISTS) on $dbname — CONCURRENTLY, prod stays up..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
SET maintenance_work_mem = '2GB';
CREATE INDEX CONCURRENTLY IF NOT EXISTS local_patent_embeddings_binary_ivf_idx
  ON local_patent_embeddings USING ivfflat ("embeddingBinary" bit_hamming_ops)
  WITH (lists = $LISTS)
  WHERE "embeddingBinary" IS NOT NULL;
ANALYZE local_patent_embeddings;
ALTER DATABASE "$dbname" SET ivfflat.probes = $PROBES;
SQL
echo "Index built. Verify search with:  npm run patent-corpus:diagnose-search"
