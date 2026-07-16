#!/usr/bin/env bash
# =============================================================================
# Seeds Voyage re-embedding for the EXISTING Indian corpus (section E2 of
# 04-postgres-load-and-upsert.sql, which ships commented out).
#
# WHY THIS IS NEEDED: the app uses ONE embedding model+dtype for query and
# corpus (src/lib/patent-corpus-service.ts). When production flips to
# voyage-3.5-lite/binary to serve the Google corpus, Indian-corpus vector
# search only keeps working if Indian rows ALSO have voyage binary vectors.
# This adds a SECOND embedding row per Indian patent; the existing OpenAI
# vectors are untouched (instant rollback = flip the env back).
#
# Run AFTER run-upsert.sh, BEFORE (or together with) run-embeddings.sh.
#   DATABASE_URL='postgresql://postgres:PASS@localhost:5432/spotipr' \
#   bash seed-indian-voyage-reembed.sh
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL}"
EMBED_MODEL="${EMBED_MODEL:-voyage-3.5-lite}"
EMBED_DIMS="${EMBED_DIMS:-512}"

q() { psql "$DATABASE_URL" -tAqc "$1"; }

indian=$(q "SELECT count(*) FROM local_patents WHERE \"corpusSources\" @> ARRAY['indian-corpus']::text[]")
before=$(q "SELECT count(*) FROM local_patent_embeddings WHERE model='$EMBED_MODEL'")
echo "Indian-corpus rows: $indian; embedding rows (model=$EMBED_MODEL) before: $before"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v embed_model="'$EMBED_MODEL'" -v embed_dims="$EMBED_DIMS" <<'SQL'
INSERT INTO local_patent_embeddings ("id","localPatentId","model","dimensions","textHash","status","attemptCount","nextAttemptAt","createdAt","updatedAt")
SELECT replace(gen_random_uuid()::text,'-',''), p."id", :embed_model, :embed_dims,
       md5(COALESCE(NULLIF(p."embeddingText",''), NULLIF(p."ragText",''), NULLIF(p."abstract",''), p."title")),
       'QUEUED'::"PatentEmbeddingStatus", 0, now(), now(), now()
FROM local_patents p
WHERE p."corpusSources" @> ARRAY['indian-corpus']::TEXT[]
  AND COALESCE(NULLIF(p."embeddingText",''), NULLIF(p."ragText",''), NULLIF(p."abstract",''), p."title") IS NOT NULL
ON CONFLICT ("localPatentId","model","textHash") DO NOTHING;
SQL

after=$(q "SELECT count(*) FROM local_patent_embeddings WHERE model='$EMBED_MODEL'")
echo "embedding rows (model=$EMBED_MODEL) after: $after  (newly queued: $((after - before)))"
echo "Next: VOYAGE_API_KEY=... bash run-embeddings.sh   (one run drains BOTH the Google and Indian queues)"
