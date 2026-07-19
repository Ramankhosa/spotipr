# Novelty search: local-corpus + Voyage cutover

July 2026. The intelligent novelty search now retrieves from the stored patent corpus
using Voyage embeddings and reranking, filtered by patent office. Live provider APIs
are a fallback, PQAI is disabled, and claims come from Postgres rather than BigQuery.

This document covers what changed, what production needs, and how to verify it.

---

## What changed

| Area | Before | After |
|---|---|---|
| Embedding model | `text-embedding-3-small` (OpenAI, 1536-dim float) | `voyage-3.5-lite` (512-dim binary) |
| Retrieval sources | PQAI + Indian corpus + live APIs, fanned out in parallel | Local corpus only; live APIs fire **only if the corpus returns zero results** |
| PQAI | Default source in most modes | Disabled — stripped from every source mode and from saved provider selections |
| Country scope | Provider picker ("Indian patents", "International patents") | Real country selector filtering `local_patents.country` |
| Date range | Not exposed in the intelligent flow | Advanced options: filing and publication from/to |
| Claims for feature mapping | BigQuery claims table, off by default (`NOVELTY_CLAIMS_TOP_REFS=0`) | `local_patents.claimsText`, on by default for the top 12 candidates |

### Code map

- `src/lib/patent-corpus-service.ts` — embedding provider defaults
- `src/lib/patent-search/patent-countries.ts` — country registry and `'INDIA'` → `'IN'` reconciliation
- `src/lib/patent-search/providers/indian-corpus-provider.ts` — country filter in the retrieval SQL
- `src/lib/patent-search/provider-registry.ts` — `resolveProviderIds` / `resolveFallbackProviderIds`
- `src/lib/patent-search/orchestrator.ts` — primary lane, then fallback lane on zero results
- `src/lib/local-patent-claims-service.ts` — claims lookup (replaces `google-patents-claims-service.ts`, deleted)
- `src/components/novelty-search/NoveltySearchSubmission.tsx` — redesigned upload + approval screens

---

## Production requirements

### 1. Environment

```bash
PATENT_CORPUS_EMBEDDING_MODEL=voyage-3.5-lite   # now the code default; set explicitly anyway
PATENT_CORPUS_EMBEDDING_DIMENSIONS=512
PATENT_CORPUS_EMBEDDING_DTYPE=binary
VOYAGE_API_KEY=pa-...                            # REQUIRED — see the warning below
NOVELTY_RERANK_ENABLED=1                         # optional; on by default when the key exists
NOVELTY_CLAIMS_TOP_REFS=12                       # optional; this is the default
```

> **`VOYAGE_API_KEY` is not optional in practice.** Without it the semantic lane is
> skipped silently and retrieval degrades to full-text + trigram matching — the search
> still returns results, so the failure is easy to miss. Confirm the key is present by
> checking for `vector_search_skipped` with `reason: "missing_embedding_api_key"` in
> the logs after a search.

Env vars no longer used by the novelty pipeline: `GOOGLE_PATENTS_CLAIMS_TABLE`,
and the BigQuery project vars insofar as they were only serving claims lookup.

### 2. The corpus must be loaded and embedded

The model name is part of the vector lookup — `local_patent_embeddings.model` must
equal `PATENT_CORPUS_EMBEDDING_MODEL` or every vector query matches zero rows.

```bash
psql "$DATABASE_URL" -c "SELECT model, status, count(*) FROM local_patent_embeddings GROUP BY 1,2;"
```

Expect `voyage-3.5-lite | COMPLETED | <large number>`. If you see only
`text-embedding-3-small`, phases 1–4 of `scripts/google-patents-import/RUNBOOK.md`
have not finished — do those first.

### 3. Country data sanity

The country selector filters on `local_patents.country`. The Google import writes ISO
codes; the older IPIndia pipeline wrote the literal `'INDIA'`. Both are handled in
code, but confirm the distribution looks sane:

```bash
psql "$DATABASE_URL" -c "SELECT country, count(*) FROM local_patents GROUP BY 1 ORDER BY 2 DESC LIMIT 20;"
```

Any country present in the corpus but missing from `PATENT_COUNTRIES` in
`src/lib/patent-search/patent-countries.ts` is still searchable by code, but will not
appear in the picker — add it there if it has meaningful volume.

### 4. Claims coverage

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM local_patents WHERE \"claimsText\" IS NOT NULL AND \"claimsText\" <> '';"
```

Coverage is partial by design: the Google import stores the **first claim** for US
publications only, and the IPIndia pipeline stores full claims for Indian patents.
References without claims are mapped on title + abstract, and nothing in the prompts
or the report indicates that claims were unavailable.

---

## Verification

### Retrieval

```bash
npm run patent-corpus:diagnose-search
```

Then run a real novelty search from the UI and check the logs for:

- `[PatentSearch] {"event":"dispatch", ...}` — `providerIds` should be
  `["google-patents-corpus","indian-corpus"]`, with no `pqai` entries
- `[PatentEmbeddingSearch] {"event":"vector_query_completed", ...}` — vector lane ran
- `[PatentSearch] {"event":"rerank_completed", ...}` — Voyage reranking applied
- `[PatentSearch] {"event":"fallback_dispatch", ...}` — should be **absent** on a normal
  search; its presence means the corpus returned nothing for that query

### Country filter

Verified locally against a multi-country corpus slice — selecting `US`, `KR`, `WO`
returned only those offices, and `IN` correctly matched rows stored as `'INDIA'`.
Re-check on production with a query you know has hits in several offices.

### Rollback

Remove the four `PATENT_CORPUS_EMBEDDING_*` / `VOYAGE_API_KEY` lines and restart. The
app falls back to `text-embedding-3-small` and the untouched OpenAI vectors, so Indian
search behaves as before; the Google corpus simply is not searched semantically. No
data is lost either way.

Note this does **not** roll back PQAI removal, the country filter, or the claims
source — those are code-level and would need a revert.

---

## Retrieval tuning module (super admin)

`/super-admin/retrieval-tuning` exposes the funnel's knobs at runtime, so the values
below can be changed without a redeploy.

### What is tunable

| Category | Settings |
|---|---|
| Corpus retrieval | vector queries per search, full-text / trigram / metadata candidate caps, trigram threshold, statement timeout |
| Reranking & cutoff | rerank on/off, **minimum rerank score**, documents per rerank call |
| Deep analysis | candidate pool, visible limit, deep-analysis ceiling, batch size |
| Claims evidence | hydration depth, excerpt length |

Each setting's type, default, range and description live in
`src/lib/settings/registry.ts`. The admin UI and the API validation are both generated
from that registry, so adding a knob later is one entry there — not a change in four
places. Defaults still come from the original env vars, so an untouched deployment
behaves exactly as before.

**Not tunable, deliberately:** `PATENT_CORPUS_EMBEDDING_MODEL` / `_DIMENSIONS` /
`_DTYPE`. The model name is part of the vector lookup, so a runtime change would make
every query match zero rows while search still appeared to work.

### Provider access

Each provider has two independent switches: `enabled` (may it be dispatched at all)
and `allowAsFallback` (may it be used in the automatic lane that fires when the corpus
returns nothing). They are separate because the fallback lane is where metered spend
happens — you may want a provider available for explicit selection but out of the
automatic path. Both fail open: if the access table is unreadable, code defaults apply
rather than every provider silently switching off.

### Choosing `rerank.minScore`

This is the pipeline's only absolute cutoff. Everything else is rank-based, which means
that without a floor the corpus always fills its quota — a search with no genuinely
close prior art produces the same shaped output as one with plenty.

Do not guess the value. Use the calibration panel:

1. Pick ~10 past searches as a benchmark set (ideally a mix: some you know are crowded,
   some you believe are clean).
2. Run a calibration with the current config to establish a baseline.
3. Read the **median** and **min** score columns. A floor between the median of genuine
   matches and the max of the filler removes noise without losing real art.
4. Change `rerank.minScore` in the draft form and re-run against the same baseline. The
   overlap percentage tells you whether the config changed ordering or membership.

Calibration replays **retrieval and reranking only** — no LLM stages run, so a sweep
costs embedding and rerank calls rather than deep analysis. Runs are stored in
`retrieval_calibration_runs` for later comparison.

### Score semantics

Before this change, `relevanceScore` was normalised against the best hit in its own
result set — the top result always scored ~0.99 regardless of quality — and it was not
recomputed after reranking, so results were sorted by one number and labelled with
another. Now, when reranking succeeds, `relevanceScore` is the Voyage score: absolute
and comparable across searches. The old fused value is preserved as
`scores.preRerankRelevance` for diagnostics; it is relative and must not be thresholded.

### Deployment

```bash
npx prisma migrate deploy   # adds system_settings, patent_provider_access, retrieval_calibration_runs
```

Purely additive — no changes to existing tables. Settings are cached per process for
~30s (`SETTINGS_CACHE_TTL_MS`), so with multiple app processes a change is visible
everywhere within that window.
