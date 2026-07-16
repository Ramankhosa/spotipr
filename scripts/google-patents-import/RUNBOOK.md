# RUNBOOK — Load the Google Patents corpus into production

For the July 2026 load: ~4000 uncompressed, header-row CSV shards
(`patent_extract_*.csv`, ~130 GB, ~12M patents) sitting in
`gs://patent-receiving-bucket`, going into the `spotipr` Postgres 17 database on
the `patentnest-production` VM (single 500 GB disk, DB data dir on `/`).

Every script is **idempotent and resume-safe**: if anything dies mid-way
(SSH drop, reboot, disk guard), just re-run the same command — it continues
where it stopped. Nothing here deletes production data.

## The phases at a glance

| Phase | What | Cost | Prod impact |
|---|---|---|---|
| 0 | push + pull code, deploy migration | free | none (additive columns) |
| 1 | `import-all.sh` (preflight → load → upsert) | free | extra disk I/O only |
| 2 | verify + drop staging | free | frees ~disk |
| 3 | seed Indian re-embed + run Voyage embedding | **paid (~$20–50)** | none |
| 4 | build ANN index | free | I/O; built CONCURRENTLY |
| 5 | flip app env to voyage + restart | free | **behavior change** (rollback = flip back) |

---

## Phase 0 — Ship the code and migration

**On your machine:** commit and push this directory (`scripts/google-patents-import/`).

**On the VM** (`ssh` in, then — note the app lives at `/var/www/patentnest/spotipr`, absolute path, no `~`):

```bash
cd /var/www/patentnest/spotipr
git pull
npx prisma migrate deploy   # applies 20260713120000_google_patent_corpus (needs pgvector >= 0.7)
```

If `migrate deploy` fails mentioning `halfvec` / `bit` / `vector`, your pgvector is
too old — see Troubleshooting below, fix, and re-run. Nothing else runs until
this succeeds. (If the migration was already applied earlier, this is a no-op.)

## Phase 1 — The DB-side import (one command)

Run inside `tmux` so a dropped SSH session doesn't kill it:

```bash
tmux new -s patents          # (later: Ctrl-b then d to detach; `tmux attach -t patents` to return)
# if tmux prints [exited] immediately: tmux kill-server && tmux new -s patents

export DATABASE_URL='postgresql://postgres:YOUR_PASSWORD@localhost:5432/spotipr'
export GCS_PREFIX='gs://patent-receiving-bucket'

cd /var/www/patentnest/spotipr/scripts/google-patents-import
bash import-all.sh
```

What it does, in order:
1. **Preflight** — read-only checks (DB, pgvector ≥ 0.7, migration columns, bucket
   reachable + shard count, ≥ 200 GB free disk, gcloud auth). Stops with a clear
   message if anything is wrong.
2. **Load** — streams each shard from the bucket into `google_patents_staging`
   (download → `\copy` → delete temp file; never holds 130 GB on disk). Skips
   already-loaded shards via the `google_patents_import_files` ledger. Aborts
   safely if free disk drops below 80 GB.
3. **Upsert** — one big idempotent `INSERT ... ON CONFLICT` from staging into
   `local_patents` (dates parsed, CPC split, IN rows dual-tagged
   `google-patents-corpus` + `indian-corpus`, existing IPIndia text preserved),
   then seeds the embedding queue (one representative per patent family).

Timing: the load is hours-scale (network + \copy); the upsert is a further long
single statement. Prefer a low-traffic window — production stays up, but shares
disk I/O.

## Phase 2 — Verify, then reclaim staging space

`run-upsert.sh` prints before/after counts and a 5-row sample. Sanity checks:

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM local_patents WHERE \"corpusSources\" @> ARRAY['google-patents-corpus']::text[];"
psql "$DATABASE_URL" -c "SELECT \"country\", count(*) FROM local_patents WHERE \"corpusSources\" @> ARRAY['google-patents-corpus']::text[] GROUP BY 1 ORDER BY 2 DESC LIMIT 10;"
psql "$DATABASE_URL" -c "SELECT status, count(*) FROM local_patent_embeddings WHERE model='voyage-3.5-lite' GROUP BY status;"
```

When the numbers look right (row count ≈ staging count minus title/abstract-empty
skips; queue count smaller — one per family):

```bash
psql "$DATABASE_URL" -c "DROP TABLE google_patents_staging;"   # frees tens of GB
```

(Keep `google_patents_import_files` — it's tiny and documents what was loaded.)

## Phase 3 — Embeddings (paid, long-running)

Two steps, both from `scripts/google-patents-import/`, inside tmux:

```bash
# 3a. ALSO queue the existing Indian corpus for voyage vectors (small, cheap).
#     Without this, Indian vector search goes dark after the Phase-5 env flip.
bash seed-indian-voyage-reembed.sh

# 3b. Drain the whole queue via the Voyage Batch API (resumes if interrupted;
#     state in scripts/.voyage-batch-state.json)
export VOYAGE_API_KEY='pa-...'
bash run-embeddings.sh
```

Monitor progress from another shell:

```bash
psql "$DATABASE_URL" -c "SELECT status, count(*) FROM local_patent_embeddings WHERE model='voyage-3.5-lite' GROUP BY status;"
```

Done when `QUEUED`/`PROCESSING` reach 0. Cost scales with the queue count
(title+abstract only, ~150–250 tokens each ≈ **$2–3 per million patents** on the
Batch API). The sample shard held ~5.7k rows, so ~4000 shards ≈ ~20M+ rows;
after family dedup expect a queue of roughly 15–20M → **~$35–70**. The exact
queue count prints at the end of `run-upsert.sh` — multiply by ~$2.7/M for the
real number before committing. If some rows end `FAILED`, re-running
`run-embeddings.sh` retries them.

## Phase 4 — Build the vector index (after Phase 3 completes)

```bash
bash build-ann-index.sh
```

Uses `CREATE INDEX CONCURRENTLY` (production keeps serving) — expect hours on a
small VM. Safe to re-run.

## Phase 5 — Flip the app to Voyage and restart

Add to the production `.env` (app + any workers):

```bash
PATENT_CORPUS_EMBEDDING_MODEL=voyage-3.5-lite
PATENT_CORPUS_EMBEDDING_DIMENSIONS=512
PATENT_CORPUS_EMBEDDING_DTYPE=binary
VOYAGE_API_KEY=pa-...
```

Restart the app process (pm2 / systemd / however `next start` is supervised).
Then verify end-to-end:

```bash
npm run patent-corpus:diagnose-search
```

**Rollback:** remove those four lines and restart — the app falls back to
`text-embedding-3-small` and the untouched OpenAI vectors; Indian search behaves
exactly as before the project, Google corpus simply isn't searched. No data loss
either way.

## Phase 6 — Cleanup (optional, saves money)

- Bucket: once `local_patents` is verified, the CSVs in
  `gs://patent-receiving-bucket` are redundant (~$2.6/mo). Keep until after
  Phase 5 verification, then delete if you wish.
- Disk: if you over-provisioned, note GCP disks can grow but **not shrink**.

## Quarterly refresh (later)

The public dataset updates quarterly. Re-run the BigQuery staging (`01`) with the
date window narrowed to new publications, export (`03`), then Phases 1–3 here —
everything is `ON CONFLICT`-idempotent, so deltas are cheap.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `migrate deploy` fails on `halfvec`/`bit` | pgvector < 0.7 | `sudo apt-get install postgresql-17-pgvector` (0.7+ build), then in psql: `ALTER EXTENSION vector UPDATE;` — verify `SELECT extversion FROM pg_extension WHERE extname='vector';` ≥ 0.7. Re-run deploy. |
| Preflight FAIL: `embeddingBinary` missing | the google_patent_corpus migration was edited after prod applied it (Prisma never re-runs applied migrations) | Fixed by repair migration `20260716120000_add_embedding_binary_column` — `git pull && npx prisma migrate deploy`, re-run preflight. |
| Preflight FAIL: `gcloud not authenticated` | VM lost auth | `gcloud auth login` (or attach a service account with Storage Object Viewer). |
| Loader aborts: `only NNG free (< 80G guard)` | disk filling | Verify what's using space (`sudo du -xh --max-depth=2 / \| sort -h \| tail`), free it or grow the disk (`gcloud compute disks resize ... && sudo growpart /dev/sda 1 && sudo resize2fs /dev/sda1`), re-run — it resumes. |
| Loader interrupted (SSH drop, reboot) | — | Re-run the same command; the ledger skips finished shards, `ON CONFLICT` dedups the partial one. |
| `\copy` error on a specific shard | malformed CSV row | Note the shard name from the log; re-run to confirm it's reproducible; inspect with `gcloud storage cat <shard> \| head`. That shard can be skipped by inserting its name into `google_patents_import_files` — record it and continue; revisit later. |
| Upsert seems stuck | it's one big INSERT over ~12M rows | Check activity: `psql "$DATABASE_URL" -c "SELECT pid, now()-query_start AS runtime, left(query,60) FROM pg_stat_activity WHERE state='active';"` — as long as it's active, it's working. |
| Embedding rows stuck `PROCESSING` | worker killed mid-batch | locks expire (default 18 h) and rows re-queue; or re-run `run-embeddings.sh` — it resumes from `scripts/.voyage-batch-state.json`. |
| App search finds nothing after flip | index missing or dims/model mismatch | `npm run patent-corpus:diagnose-search`; confirm the four env lines exactly; confirm Phase 4 ran. |
| Prod latency during load | shared disk I/O | Pause anytime (Ctrl-C) and re-run later — everything resumes. |

## Files in this directory

| File | Role |
|---|---|
| `preflight-check.sh` | read-only go/no-go checks |
| `load-local-csv-from-bucket.sh` | bucket → `google_patents_staging` (this export's format: uncompressed, header row) |
| `run-upsert.sh` | staging → `local_patents` + embedding queue (wraps `04-*.sql`) |
| `import-all.sh` | phases 1–3 above in one command |
| `seed-indian-voyage-reembed.sh` | queue Indian corpus for voyage vectors (section E2) |
| `run-embeddings.sh` | Voyage Batch backfill (paid) |
| `build-ann-index.sh` | IVFFlat Hamming index (after backfill) |
| `download-and-load.sh` | ORIGINAL loader for gzip no-header `part-*.csv.gz` exports — not used for this load |
| `01…04 *.sql`, `SCHEMA.md`, `README.md` | the underlying pipeline (unchanged) |
