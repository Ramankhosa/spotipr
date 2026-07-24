#!/usr/bin/env bash
# =============================================================================
# Embedding backfill via the Voyage Batch API (-33% vs realtime).
# Wraps scripts/patent-corpus-voyage-batch-embed.ts with the env contract the
# Google corpus uses: voyage-3.5-lite, 512 dims, BINARY dtype -> embeddingBinary.
#
# COSTS MONEY (Voyage API). Long-running: run inside tmux; state persists in
# scripts/.voyage-batch-state.json, so it resumes if interrupted.
#
#   DATABASE_URL='postgresql://postgres:PASS@localhost:5432/spotipr' \
#   VOYAGE_API_KEY=pa-... \
#   bash run-embeddings.sh
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL}"

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# VOYAGE_API_KEY: shell env wins; otherwise read it from the app env files
# (mirrors the precedence the worker itself uses via scripts/load-env.ts).
if [ -z "${VOYAGE_API_KEY:-}" ]; then
  for f in "$APP_DIR/.env" "$APP_DIR/.env.local"; do
    [ -f "$f" ] || continue
    # `|| true`: under `set -euo pipefail` a non-matching grep exits 1, pipefail
    # propagates it to the assignment, and the script dies here SILENTLY -- even
    # when an earlier file already supplied the key. Also strip CR: .env is CRLF,
    # and a trailing \r in the key makes Voyage reject every request with 401.
    v=$(grep -E '^VOYAGE_API_KEY=' "$f" | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\r' || true)
    [ -n "$v" ] && export VOYAGE_API_KEY="$v"
  done
fi
: "${VOYAGE_API_KEY:?Set VOYAGE_API_KEY (in the shell or in the app .env)}"

export PATENT_CORPUS_EMBEDDING_MODEL="${PATENT_CORPUS_EMBEDDING_MODEL:-voyage-3.5-lite}"
export PATENT_CORPUS_EMBEDDING_DIMENSIONS="${PATENT_CORPUS_EMBEDDING_DIMENSIONS:-512}"
export PATENT_CORPUS_EMBEDDING_DTYPE="${PATENT_CORPUS_EMBEDDING_DTYPE:-binary}"

cd "$APP_DIR"

queued=$(psql "$DATABASE_URL" -tAqc "SELECT count(*) FROM local_patent_embeddings WHERE model='$PATENT_CORPUS_EMBEDDING_MODEL' AND status IN ('QUEUED','FAILED')")
echo "== Voyage batch embedding: $queued rows queued (model=$PATENT_CORPUS_EMBEDDING_MODEL, dtype=$PATENT_CORPUS_EMBEDDING_DTYPE, dims=$PATENT_CORPUS_EMBEDDING_DIMENSIONS) =="
if [ "$queued" = "0" ]; then
  echo "Nothing queued. Either the upsert has not run, or embedding already completed."
  psql "$DATABASE_URL" -c "SELECT status, count(*) FROM local_patent_embeddings WHERE model='$PATENT_CORPUS_EMBEDDING_MODEL' GROUP BY status;"
  exit 0
fi

echo "Starting watcher (Ctrl-C safe: state persists and resumes). Monitor from another shell with:"
echo "  psql \"\$DATABASE_URL\" -c \"SELECT status, count(*) FROM local_patent_embeddings WHERE model='$PATENT_CORPUS_EMBEDDING_MODEL' GROUP BY status;\""
npx tsx scripts/patent-corpus-voyage-batch-embed.ts --watch
