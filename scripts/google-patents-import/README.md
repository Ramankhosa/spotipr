# Google Patents BigQuery → Local Corpus Import

End-to-end guide for importing the Google Patents Public Data corpus (last 10 years,
title + English abstract) into the `local_patents` corpus, embedding it with Voyage,
and serving it through the `google-patents-corpus` search provider.

## Verified dataset facts (research notes)

- `patents-public-data.patents.publications`: worldwide bibliographic records.
  `title_localized` / `abstract_localized` / `claims_localized` / `description_localized`
  are REPEATED RECORDs of `{text, language}`. **Full text (claims/description) exists
  for US publications only** — non-US rows (including IN) are bibliographic + abstract.
  Dates are INT64 `YYYYMMDD`. `family_id` groups family members.
- `patents-public-data.google_patents_research.publications`: **English title and
  abstract for every publication** (machine-translated where the original is not
  English, flagged via `*_translated`), plus `top_terms`. This is what we embed —
  it solves the CN/JP/KR language problem at the retrieval layer.
- Dataset updates **quarterly** (provided by IFI CLAIMS + Google, CC-BY 4.0 —
  keep the attribution in your docs/UI). Plan the delta job around that cadence
  and keep the live API lanes (PQAI/EPO) for freshness and pre-window art.
- Reference pipeline: `googleapis/python-bigquery-dataframes` notebook
  `bq_dataframes_llm_vector_search.ipynb` (same source table, embeds abstracts,
  IVF index) — we follow the same shape but land vectors in our Postgres/pgvector.

## Architecture decisions

| Decision | Choice | Why |
|---|---|---|
| What is embedded | `title + '\n' + abstract` (English, research table) | Matches the reference pipeline; uniform language |
| Embedding model | `voyage-3.5-lite`, `output_dimension: 512` | $0.02/1M tokens; Matryoshka 512-dim keeps the index small |
| Storage | `local_patent_embeddings.embeddingHalf halfvec(512)` | ~30GB vectors for ~30M rows; fits a 16GB-RAM box with IVFFlat |
| ANN index | IVFFlat (`lists ≈ 6000`, `probes ≈ 24`) | Builds in hours on 2 vCPU (HNSW would take days and more RAM) |
| Family dedup | One representative per `family_id`, US preferred | US member keeps claims-on-demand available |
| Indian publications | **All** IN rows kept and tagged `['google-patents-corpus','indian-corpus']` | Product decision: Google-sourced IN patents join the Indian corpus |
| Claims (US only) | Stay in BigQuery, clustered table, fetched on demand | ~100GB of text; per-run lookups cost fractions of a cent |
| IN claims/descriptions | **Not available in BigQuery** — keep the IPIndia PDF pipeline | Verified: full text is US-only in the public dataset |

## Cost estimate (one-time, ~25–35M rows after dedup)

| Item | Estimate |
|---|---|
| BigQuery staging queries (scans a few TB) | $20–60 |
| BigQuery storage for staging + claims tables | ~$2–4/month |
| GCS export + egress to your server (~40–70GB gz) | $5–15 |
| Voyage embeddings (~9–12B tokens @ $0.02/1M) | $180–240 (−33% via Batch API) |
| Postgres disk (+~120GB: rows, text, vectors, index) | per your provider |

## Step-by-step

### 0. One-time setup

```bash
gcloud auth login
export GCP_PROJECT=your-project-id
export GCS_BUCKET=your-bucket-name
bq mk --location=US ${GCP_PROJECT}:spotipr_patents
gcloud storage buckets create gs://${GCS_BUCKET} --location=US
```

App env (server + workers):

```bash
VOYAGE_API_KEY=...
PATENT_CORPUS_EMBEDDING_MODEL=voyage-3.5-lite
PATENT_CORPUS_EMBEDDING_DIMENSIONS=512
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_PATENTS_CLAIMS_TABLE=your-project-id.spotipr_patents.patent_claims
NOVELTY_CLAIMS_TOP_REFS=10          # 0 disables claims-aware analysis
NOVELTY_CLAIMS_MAX_CHARS=6000
```

> Switching `PATENT_CORPUS_EMBEDDING_MODEL` switches BOTH query-time and corpus
> embeddings (they must match). The pre-existing Indian corpus keeps working only
> if its OpenAI vectors are re-embedded with the new model — the queue-seeding SQL
> in step 5 covers `google-patents-corpus` rows; run the same INSERT with the
> `indian-corpus` filter to re-embed the Indian rows into `embeddingHalf` too.

### 1. Run the migration

```bash
npx prisma migrate deploy   # adds local_patents.familyId + local_patent_embeddings.embeddingHalf (needs pgvector >= 0.7)
```

### 2. Build the BigQuery staging tables

```bash
sed "s/__PROJECT__/${GCP_PROJECT}/g" 01-bigquery-staging.sql        | bq query --nouse_legacy_sql --project_id=${GCP_PROJECT}
sed "s/__PROJECT__/${GCP_PROJECT}/g" 02-bigquery-claims-staging.sql | bq query --nouse_legacy_sql --project_id=${GCP_PROJECT}
```

Sanity checks:

```sql
SELECT country_code, COUNT(*) FROM `PROJECT.spotipr_patents.publications_staging` GROUP BY 1 ORDER BY 2 DESC LIMIT 15;
SELECT COUNT(*) FROM `PROJECT.spotipr_patents.publications_staging` WHERE country_code = 'IN';
SELECT COUNT(*) FROM `PROJECT.spotipr_patents.patent_claims`;
```

### 3. Export to GCS and load into Postgres

```bash
sed -e "s/__PROJECT__/${GCP_PROJECT}/g" -e "s/__BUCKET__/${GCS_BUCKET}/g" 03-bigquery-export-to-gcs.sql | bq query --nouse_legacy_sql --project_id=${GCP_PROJECT}

# on the database server:
chmod +x download-and-load.sh
DATABASE_URL=postgres://... GCS_PREFIX=gs://${GCS_BUCKET}/spotipr-patents/publications ./download-and-load.sh
```

### 4. Upsert into local_patents

```bash
psql "$DATABASE_URL" -v embed_model="'voyage-3.5-lite'" -v embed_dims=512 -f 04-postgres-load-and-upsert.sql
```

This runs the pub_key guard, the upsert (IN rows tagged into both corpora), and
seeds the embedding queue. Section E (IN reconciliation with IPO-numbered rows) is
commented out — review it before running.

### 5. Run the embedding backfill

Voyage models embed through the **realtime worker** (the OpenAI Batch-API script
`patent-corpus:batch-embed` refuses voyage models by design):

```bash
PATENT_CORPUS_EMBEDDING_BATCH=512 PATENT_CORPUS_EMBEDDING_API_BATCH=128 npm run patent-corpus:worker
```

Run 2–4 worker processes in parallel (row locking makes this safe). Throughput
math: ~128 texts/request, ~2 requests/s/worker → ~30M rows in roughly 1.5–3 days
with 2 workers. Monitor:

```sql
SELECT status, count(*) FROM local_patent_embeddings WHERE model = 'voyage-3.5-lite' GROUP BY status;
```

### 6. Build the ANN index (AFTER backfill completes)

Uncomment and run section G of `04-postgres-load-and-upsert.sql`. On the 2 vCPU /
16GB box set `maintenance_work_mem = '2GB'` first and expect a few hours. Then set
`ivfflat.probes = 24` at query time (start there; raise for recall, lower for speed).

### 7. Verify search

```bash
npm run patent-corpus:diagnose-search   # confirm vector inventory for the new model
```

The `google-patents-corpus` provider is registered alongside `pqai-corpus` in all
international source modes and inherits the Indian provider's multi-query retrieval
(concept + per-feature vector queries) and rank blending. Because Google-sourced IN
rows carry the `indian-corpus` tag, the Indian provider picks them up automatically.

### 8. Quarterly delta

The dataset updates quarterly. Re-run steps 2–5 with the staging WHERE clause
narrowed to new publications, e.g. `p.publication_date >= 20260401` — the upsert
and queue-seeding are idempotent (`ON CONFLICT`), so deltas are cheap.

## Claims-aware deep analysis

With `NOVELTY_CLAIMS_TOP_REFS > 0` and `GOOGLE_PATENTS_CLAIMS_TABLE` set, the
consolidated novelty analysis fetches English claims for the top candidates (US
publications only) from the clustered BigQuery table, includes a bounded excerpt in
the prompt, instructs the model to prefer claim language as evidence, and verifies
evidence quotes verbatim against title + abstract + claims. Leave it at `0` until
the corpus import is verified.
