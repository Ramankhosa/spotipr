#!/usr/bin/env bash
# ============================================================================
# Prescreen readiness check — run ON THE PRODUCTION BOX from the repo root.
#
#   bash scripts/prescreen-readiness-check.sh
#
# Read-only: SELECTs only, no writes, no API calls. Collects every number the
# deferred embedding-based Stage 1.7 feature prescreen needs before it can be
# implemented:
#   [0] embedding env config            → which absolute floors / scorer path apply
#   [1] embedding inventory             → which vector columns are actually populated
#   [2] corpus + family coverage        → family-fallback viability
#   [3] novelty candidate coverage      → the UNAVAILABLE-rate go/no-go gate
#   [4] calibration corpus              → runs usable for the offline harness
#   [5] feature-cell evidence mix       → bar calibration (Present/Partial/Absent)
#   [6] metering plumbing               → NOVELTY_SEARCH feature row, Voyage usage rows
#   [7] timed 300-doc distance scan     → prescreen SQL cost at production scale
#
# Section [3] builds a normalized publication-number temp table with one
# sequential scan over local_patents — on a large corpus this section can take
# a few minutes. Everything else is fast.
# ============================================================================

PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-spotipr}"
export PGPASSWORD="${PGPASSWORD:-123}"
ENV_FILE="${ENV_FILE:-.env}"

PSQL=(psql -X -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -P pager=off -v ON_ERROR_STOP=0)

banner() { printf '\n============ %s ============\n' "$1"; }

# ---- [0] env snapshot (secrets masked) -------------------------------------
banner "[0] Embedding env config ($ENV_FILE)"
if [ -f "$ENV_FILE" ]; then
  grep -E '^(PATENT_CORPUS_EMBEDDING_|PAS_ELEMENT_ABS_)' "$ENV_FILE" | sort || true
  for key in VOYAGE_API_KEY OPENAI_SEARCH_API_KEY OPENAI_API_KEY; do
    val=$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2-)
    if [ -n "$val" ]; then echo "$key=present (${#val} chars)"; else echo "$key=ABSENT"; fi
  done
else
  echo "WARN: $ENV_FILE not found — run from the repo root or set ENV_FILE=/path/to/.env"
fi

# Values reused by section [7]. Column/op are auto-detected from whichever
# vector column is actually populated when the env does not pin them.
EMB_MODEL=$(grep -E '^PATENT_CORPUS_EMBEDDING_MODEL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)
EMB_MODEL="${EMB_MODEL:-voyage-3.5-lite}"
EMB_COL=$(grep -E '^PATENT_CORPUS_EMBEDDING_COLUMN=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)
EMB_OP=$(grep -E '^PATENT_CORPUS_EMBEDDING_DISTANCE_OP=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)
if [ -z "$EMB_COL" ]; then
  EMB_COL=$(psql -X -t -A -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -c "
    SELECT CASE
      WHEN count(*) FILTER (WHERE \"embeddingBinary\" IS NOT NULL) > 0 THEN 'embeddingBinary'
      WHEN count(*) FILTER (WHERE \"embeddingHalf\"  IS NOT NULL) > 0 THEN 'embeddingHalf'
      ELSE 'embedding' END
    FROM local_patent_embeddings WHERE status='COMPLETED' AND model='${EMB_MODEL}';" 2>/dev/null)
  EMB_COL="${EMB_COL:-embedding}"
fi
if [ -z "$EMB_OP" ]; then
  if [ "$EMB_COL" = "embeddingBinary" ]; then EMB_OP='<~>'; else EMB_OP='<=>'; fi
fi
echo "-- section [7] will probe: model=$EMB_MODEL column=$EMB_COL op=$EMB_OP"

# ---- [1] embedding inventory ------------------------------------------------
banner "[1] Embedding inventory"
"${PSQL[@]}" <<'SQL'
SELECT model, status, count(*) FROM local_patent_embeddings GROUP BY model, status ORDER BY model, status;

SELECT model,
       count(*) FILTER (WHERE embedding IS NOT NULL)         AS float_col,
       count(*) FILTER (WHERE "embeddingHalf" IS NOT NULL)   AS half_col,
       count(*) FILTER (WHERE "embeddingBinary" IS NOT NULL) AS binary_col,
       min(dimensions) AS min_dim, max(dimensions) AS max_dim
FROM local_patent_embeddings
WHERE status = 'COMPLETED'
GROUP BY model;
SQL

# ---- [2] corpus + family coverage -------------------------------------------
banner "[2] Corpus size and family-id coverage"
"${PSQL[@]}" <<'SQL'
SELECT count(*) AS local_patents,
       count(*) FILTER (WHERE "familyId" IS NOT NULL) AS with_family_id,
       round(100.0 * count(*) FILTER (WHERE "familyId" IS NOT NULL) / greatest(count(*), 1), 1) AS family_pct
FROM local_patents;
SQL

# ---- [3] novelty candidate coverage (the go/no-go gate) ----------------------
banner "[3] Novelty candidate coverage vs corpus embeddings (may take minutes)"
"${PSQL[@]}" <<'SQL'
CREATE TEMP TABLE _lp AS
  SELECT id, upper(regexp_replace("publicationNumber", '[^A-Za-z0-9]', '', 'g')) AS pn
  FROM local_patents;
CREATE INDEX ON _lp (pn);

CREATE TEMP TABLE _emb AS
  SELECT DISTINCT "localPatentId" AS id
  FROM local_patent_embeddings WHERE status = 'COMPLETED';
CREATE INDEX ON _emb (id);

WITH cand AS (
  SELECT r.id AS run,
         jsonb_array_elements(coalesce(r."stage1Results"->'retrievalCandidates',
                                       r."stage1Results"->'rawPriorArtResults',
                                       r."stage1Results"->'priorArtResults', '[]'::jsonb)) AS c
  FROM novelty_search_runs r WHERE r."stage1Results" IS NOT NULL
), pn AS (
  SELECT DISTINCT
         upper(regexp_replace(coalesce(c->>'publicationNumber', c->>'pn', c->>'patentNumber', ''), '[^A-Za-z0-9]', '', 'g')) AS pn,
         coalesce(c->>'source', c->>'provider', c->>'sourceProvider', c->>'sourceCorpus', 'unknown') AS src
  FROM cand
  WHERE coalesce(c->>'publicationNumber', c->>'pn', c->>'patentNumber', '') <> ''
)
SELECT src,
       count(*) AS candidates,
       count(*) FILTER (WHERE l.id IS NOT NULL)  AS in_corpus,
       count(*) FILTER (WHERE e.id IS NOT NULL)  AS embedded,
       round(100.0 * count(*) FILTER (WHERE e.id IS NULL) / greatest(count(*), 1), 1) AS unavailable_pct
FROM pn
LEFT JOIN _lp  l ON l.pn = pn.pn
LEFT JOIN _emb e ON e.id = l.id
GROUP BY src
UNION ALL
SELECT 'TOTAL',
       count(*),
       count(*) FILTER (WHERE l.id IS NOT NULL),
       count(*) FILTER (WHERE e.id IS NOT NULL),
       round(100.0 * count(*) FILTER (WHERE e.id IS NULL) / greatest(count(*), 1), 1)
FROM pn
LEFT JOIN _lp  l ON l.pn = pn.pn
LEFT JOIN _emb e ON e.id = l.id
ORDER BY 2 DESC;
SQL

# ---- [4] calibration corpus ---------------------------------------------------
banner "[4] Calibration corpus (runs usable by the offline harness)"
"${PSQL[@]}" <<'SQL'
SELECT count(*) AS usable_runs,
       round(avg(jsonb_array_length(coalesce("stage0Results"->'inventionFeatures','[]'::jsonb))), 1) AS avg_features,
       max(jsonb_array_length(coalesce("stage0Results"->'inventionFeatures','[]'::jsonb))) AS max_features,
       count(*) FILTER (WHERE jsonb_array_length(coalesce("stage0Results"->'inventionFeatures','[]'::jsonb)) >= 12) AS complex_runs
FROM novelty_search_runs
WHERE jsonb_typeof("stage35Results"->'feature_map') = 'array'
  AND jsonb_array_length("stage35Results"->'feature_map') > 0
  AND ("stage1Results" ? 'retrievalCandidates' OR "stage1Results" ? 'rawPriorArtResults');

-- Per-run detail, newest first (cap 40 rows).
SELECT id,
       "createdAt"::date AS created,
       jsonb_array_length(coalesce("stage0Results"->'inventionFeatures','[]'::jsonb)) AS features,
       jsonb_array_length(coalesce("stage35Results"->'feature_map','[]'::jsonb))      AS mapped_refs,
       jsonb_array_length(coalesce("stage1Results"->'retrievalCandidates',
                                   "stage1Results"->'rawPriorArtResults','[]'::jsonb)) AS pool_size,
       ("stage4Results" ? 'report_reference_selection') AS has_selection_blob
FROM novelty_search_runs
WHERE jsonb_typeof("stage35Results"->'feature_map') = 'array'
  AND jsonb_array_length("stage35Results"->'feature_map') > 0
ORDER BY "createdAt" DESC
LIMIT 40;
SQL

# ---- [5] feature-cell evidence mix --------------------------------------------
banner "[5] Feature-cell evidence distribution (last 200 runs)"
"${PSQL[@]}" <<'SQL'
WITH recent AS (
  SELECT "stage35Results" AS s FROM novelty_search_runs
  WHERE jsonb_typeof("stage35Results"->'feature_map') = 'array'
  ORDER BY "createdAt" DESC LIMIT 200
), cells AS (
  SELECT c->>'status' AS status
  FROM recent, jsonb_array_elements(s->'feature_map') m, jsonb_array_elements(m->'feature_analysis') c
)
SELECT status, count(*), round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM cells GROUP BY status ORDER BY 2 DESC;
SQL

# ---- [6] metering plumbing ------------------------------------------------------
banner "[6] Metering plumbing"
"${PSQL[@]}" <<'SQL'
SELECT 'NOVELTY_SEARCH feature row' AS check, count(*)::text AS result FROM features WHERE code = 'NOVELTY_SEARCH'
UNION ALL
SELECT 'usage_logs VOYAGE_EMBEDDING rows (all time)', count(*)::text FROM usage_logs WHERE "apiCode" = 'VOYAGE_EMBEDDING'
UNION ALL
SELECT 'usage_logs VOYAGE_RERANK rows (all time)', count(*)::text FROM usage_logs WHERE "apiCode" = 'VOYAGE_RERANK';
SQL

# ---- [7] timed representative distance scan -------------------------------------
banner "[7] Timed 300-doc x 8-feature distance scan (model=$EMB_MODEL col=$EMB_COL op=$EMB_OP)"
"${PSQL[@]}" <<SQL
\\timing on
WITH probe AS (
  SELECT "${EMB_COL}" AS v
  FROM local_patent_embeddings
  WHERE status = 'COMPLETED' AND model = '${EMB_MODEL}' AND "${EMB_COL}" IS NOT NULL
  LIMIT 1
), sample AS (
  SELECT e."${EMB_COL}" AS emb
  FROM local_patent_embeddings e
  WHERE e.status = 'COMPLETED' AND e.model = '${EMB_MODEL}' AND e."${EMB_COL}" IS NOT NULL
  LIMIT 300
)
SELECT count(*) AS docs_scored,
       round(avg((sample.emb ${EMB_OP} probe.v)::float8)::numeric, 4) AS avg_d1,
       round(avg((sample.emb ${EMB_OP} probe.v)::float8)::numeric, 4) AS avg_d2,
       round(avg((sample.emb ${EMB_OP} probe.v)::float8)::numeric, 4) AS avg_d3,
       round(avg((sample.emb ${EMB_OP} probe.v)::float8)::numeric, 4) AS avg_d4,
       round(avg((sample.emb ${EMB_OP} probe.v)::float8)::numeric, 4) AS avg_d5,
       round(avg((sample.emb ${EMB_OP} probe.v)::float8)::numeric, 4) AS avg_d6,
       round(avg((sample.emb ${EMB_OP} probe.v)::float8)::numeric, 4) AS avg_d7,
       round(avg((sample.emb ${EMB_OP} probe.v)::float8)::numeric, 4) AS avg_d8
FROM sample, probe;
\\timing off
SQL

banner "DONE — send the full output back"
