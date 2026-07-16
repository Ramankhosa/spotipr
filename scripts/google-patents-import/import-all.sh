#!/usr/bin/env bash
# =============================================================================
# One-command DB-side import: preflight -> load shards -> upsert.
# Everything here is FREE (no external APIs) and IDEMPOTENT (safe to re-run;
# it resumes where it left off). It does NOT start the paid embedding phase.
#
# Run ON THE VM, inside tmux:
#   export DATABASE_URL='postgresql://postgres:PASS@localhost:5432/spotipr'
#   export GCS_PREFIX='gs://patent-receiving-bucket'
#   bash import-all.sh
# =============================================================================
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==============================================="
echo " PHASE 1/3 — preflight checks (read-only)"
echo "==============================================="
bash "$DIR/preflight-check.sh"

echo
echo "==============================================="
echo " PHASE 2/3 — load shards: bucket -> staging"
echo "==============================================="
bash "$DIR/load-local-csv-from-bucket.sh"

echo
echo "==============================================="
echo " PHASE 3/3 — upsert: staging -> local_patents"
echo "==============================================="
bash "$DIR/run-upsert.sh"

cat <<EOT

===============================================
 DB-SIDE IMPORT COMPLETE.
===============================================
Remaining phases (see RUNBOOK.md):
  A) bash $DIR/seed-indian-voyage-reembed.sh     # keep Indian search working after the model flip
  B) VOYAGE_API_KEY=... bash $DIR/run-embeddings.sh   # PAID + long-running (tmux)
  C) bash $DIR/build-ann-index.sh                # after B completes
  D) flip app env to voyage + restart app       # RUNBOOK.md phase 5
  E) psql "\$DATABASE_URL" -c 'DROP TABLE google_patents_staging;'   # reclaim disk after verifying
EOT
