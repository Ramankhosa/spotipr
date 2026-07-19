# spotipr — Pre-Production Fix Handoff

**Audit date:** 2026-07-19 · **Branch:** `master` · **State:** all work staged in git, nothing committed, nothing deployed.

This document hands off a severity-ranked fix list from a pre-deploy audit of three workstreams
built in parallel in one working tree. Read §0 before touching anything — several "obvious" fixes
here are actively dangerous without that context.

---

## §0. CONTEXT YOU MUST HAVE BEFORE EDITING

### The three workstreams

| Code | Workstream | Scope |
|---|---|---|
| **CORPUS** | Google Patents / Voyage cutover | `patent-corpus-service.ts`, `patent-search/**`, `novelty-search-service.ts`, novelty components. Migration: `20260718170000_retrieval_tuning_settings` |
| **PAS** | Prior-Art Studio | `src/{lib,components}/prior-art-studio/**`, `src/app/api/prior-art-studio/**`, `src/app/prior-art-studio/**`. Migrations: `20260717120000_prior_art_studio`, `20260718090000_prior_art_studio_theories` |
| **OA** | Office Action Studio | `src/lib/office-action/**`, `src/app/api/office-actions/**`, `src/app/office-actions/**`, `scripts/office-action-*`. Migrations: `20260717140213_office_action_studio`, `20260718150000_oa_case_documents` |

### Verified production facts (from a live read-only snapshot — do NOT re-derive)

- PG **17.7**, pgvector **0.8.0**, pg_trgm 1.6. Disk 484 G, 51% used. DB 166 GB.
- `local_patents` ≈ **46.18M** rows. `local_patent_embeddings` ≈ **30.6M** rows.
- **`voyage-3.5-lite` COMPLETED = 29,826,248**, all populated in `embeddingBinary bit(512)`, zero float.
  This is **one vector per DOCDB family** (representative: US > granted B* > newest) — it is the
  complete design, NOT a coverage gap. Legacy `embedding vector(1536)` holds only 781,103 old
  OpenAI rows. `embeddingHalf halfvec(512)` is unused.
- ANN index `local_patent_embeddings_binary_ivf_idx`: ivfflat, `bit_hamming_ops`, lists=5000,
  2422 MB, **verified Index Scan @ 171 ms**.
- Only `title + '\n' + abstract` is embedded. `claimsText`/`descriptionText` are stored but
  **US-only and NOT embedded, NOT text-indexed**. `ragText` = top_terms, not embedded.
- **`local_patents_search_tsv_idx` is NON-partial (8658 MB) and DOES cover google rows.**
  A partial `local_patents_google_search_tsv_idx` was building separately.
- Metadata tsvector indexes exist **only** for indian-corpus and pqai (both partial).
  **Nothing covers google metadata** — this is the root of FIXED-4.
- Migration history is **clean** on both prod and dev. No P3009 blockers.
- Env: `PATENT_CORPUS_EMBEDDING_MODEL=voyage-3.5-lite`, `DIMENSIONS=512`, `DTYPE=binary`,
  `VOYAGE_API_KEY` set. `PATENT_SEARCH_DEBUG` **unset**. `PATENT_SEARCH_MAX_VECTOR_QUERIES` **unset** (default 4).

### Canonical contract — always derive, never hardcode

`src/lib/patent-corpus-service.ts` exports the single source of truth:
`PATENT_CORPUS_EMBEDDING_MODEL / _PROVIDER / _DIMENSIONS / _DTYPE / _COLUMN / _SQL_TYPE / _DISTANCE_OP`,
plus `corpusEmbeddingToLiteral()`, `bytesToBitString()`, `requestCorpusEmbedding(s)`,
`requestSearchQueryEmbedding(s)`.

**Voyage is ASYMMETRIC.** Query text MUST use purpose `'search-query'` (`input_type: query`);
corpus content MUST use `'corpus-indexing'` (`input_type: document`). Getting it backwards
degrades retrieval quality with **no error at all**.

### 🚫 NEVER DO THESE

1. **Never `ALTER local_patent_embeddings ALTER COLUMN embeddingBinary SET DATA TYPE`.**
   Prisma proposes this on every `migrate dev` because `schema.prisma` says `Unsupported("bit(512)")`
   while the DB has native `Bit(512)`. Prisma's own generated warning says *"The data in that column
   could be lost."* It is a full rewrite of 30.6M rows. It is deliberately commented out at
   `prisma/migrations/20260717140213_office_action_studio/migration.sql:26`. **Keep it commented.**
2. **Never run `prisma migrate dev` or `prisma db push` against production.**
3. **Never drop `local_patents_search_tsv_idx`** until ISSUE-H2b is fixed AND an `EXPLAIN` proves the
   partial google index is serving queries. It is currently the only index serving google-corpus
   text under parameterized (generic) plans. Dropping it creates a real 46M-row seq-scan cliff.
4. **Never set `SEED_OVERWRITE_STAGE_CONFIGS=true`** — it clobbers hand-tuned production model configs.
   New stages seed fine without it.
5. **Never re-add non-partial trigram indexes on `local_patents`.** Non-partial, the abstract GIN alone
   reaches ~150 GB. See `20260713140000_partial_trigram_indexes` header.
6. **Never run a plain (non-`CONCURRENTLY`) `CREATE INDEX` on `local_patents`** while another index
   build is in flight — SHARE vs SHARE UPDATE EXCLUSIVE conflict stalls all writes.
7. Do not delete any database rows (pqai rows included — see ISSUE-M1).

---

## §1. ALREADY FIXED — DO NOT REDO

All verified by execution (`next build` exit 0, `tsc --noEmit` clean, 71/71 provider tests,
`prisma validate` OK, `smoke-prior-art-studio.ts` PASSED).

| # | Issue | Files changed |
|---|---|---|
| **FIXED-1** | **Build was broken.** `'use client'` `ElementGrid.tsx` imported value exports from `element-scoring.ts` → `@prisma/client` + `patent-corpus-service.ts` → `adm-zip`. `next build` failed `Can't resolve 'fs'`; dev crashed at module-init. | NEW `src/lib/prior-art-studio/element-math.ts` (pure, `import type` only); `element-scoring.ts` (block removed); `ElementGrid.tsx:21`; `scripts/smoke-prior-art-studio.ts:10` |
| **FIXED-2** | **OA retrieval dead on arrival.** `oa_document_chunks.embedding` was `vector(1536)` while the app emits 64 packed ubinary bytes → every write failed (`expected 1536 dimensions, not 512`), silently swallowed; `embedChunks` returned `true` unconditionally so docs were marked `INDEXED` with zero vectors. | `20260718150000_oa_case_documents/migration.sql` (→ `bit(512)` + `bit_hamming_ops`); `schema.prisma:4999`; `office-action/case-document-service.ts` (uses `corpusEmbeddingToLiteral`, `$1::bit(512)`, returns `embedded > 0`) |
| **FIXED-3** | **OA migration re-created four NON-partial trigram GINs on `local_patents`** (the ~150 GB disk bomb the corpus workstream had explicitly defused). | `20260717140213_office_action_studio/migration.sql:191-196` — replaced with a permanent warning comment |
| **FIXED-4** | **Metadata lane ran an unindexed scan of 46M rows on every prod search** (`EXPLAIN` cost 25,188,633 — Parallel Seq Scan). | `patent-search/providers/google-patents-corpus-provider.ts` — added `metadataSearchEnabled: false` |
| **FIXED-5** | **Statement timeouts were the ONE error class that logged nothing** (timeout branch omitted `force`, gated behind unset `PATENT_SEARCH_DEBUG`; all other errors logged). | `indian-corpus-provider.ts:151-156` — now `'warn'` with `force=true` |
| **FIXED-6** | **Google corpus filter was a bind parameter** while indian/pqai/epo used literals — planner cannot prove a partial-index predicate against `$1`. | `indian-corpus-provider.ts:212-217` — added literal `PATENT_CORPUS_SOURCE_GOOGLE` branch |
| **FIXED-7** | **Voyage asymmetry inverted in OA** — query text embedded as a document. | `office-action/context-budget.ts` — `requestSearchQueryEmbedding` + `corpusEmbeddingToLiteral`, retrieval `<~> $1::bit(512)` |
| **FIXED-8** | `db:migrate` mapped to `prisma migrate dev` (prod footgun). | `package.json:23` → `db:migrate:dev` |

---

## §2. OUTSTANDING — BLOCKER (must fix before either Studio ships)

### ISSUE-B6 · Empty results are indistinguishable from failed searches, all the way to the attorney PDF
**Workstream:** CORPUS (+ affects PAS, OA) · **Severity:** BLOCKER

`PatentSearchProvider.search()` returns a bare `Promise<NormalizedPatentResult[]>`
(`src/lib/patent-search/types.ts:237`). A lane that times out returns normally, so the provider
reports `resultCount: 0` with **no** `error`, `warnings` stays `[]`, and `PatentSearchDiagnostics`
(`types.ts:249-267`) carries no degraded flag.

Four lanes swallow through `logOptionalSearchError`: `indian-corpus-provider.ts:800` (full-text),
`:832` (metadata), `:988` (trigram), `:1017` (field).

The diagnostics that *are* produced get severed at the report boundary:
- `src/lib/novelty-attorney-report.ts` — **zero** references to `providerStats` / `searchWarnings` / any degraded field
- `src/components/novelty-search/ConsolidatedNoveltyReport.tsx:510` — holds `stage1.providerStats` and `stage1.searchWarnings` in scope, reads neither
- `novelty-attorney-report.ts:1972` — cover-page `corpus:` string is built from **requested** config
  (`searchRun.config.searchSource`), never realized results. Printed in four places, incl. PDF cover
  (`pdf/route.ts:507`) and §1.2 under the heading *"Patent nationality coverage"* (`:1812`).

**Result:** a run where every provider failed prints *"Patent nationality coverage: India + Europe +
international patents"* and the conclusion *"The configured search completed without identifying
sufficiently relevant prior-art records"* (`novelty-search-service.ts:3441`).

**Fix:** change the provider return to `{ results, laneStatus: Array<{lane, status:'ok'|'timeout'|'error', ms}> }`.
Fold any timeout/error lane into `providerStats[].error` **and** a new `PatentSearchResponse.degraded`.
Thread it: `stage1Results` → `buildNoveltyAttorneyReportModel` → render a "Coverage limitations for
this run" block. Refuse to render a no-prior-art conclusion when `degraded` is set.
Port the two lines the public API already gets right — `strictSemantic: true` and the
`provider?.error → 503` check (`patent-public-api.ts:181,185-188`) — to `novelty-search-service.ts:4105`.

**This one change also closes ISSUE-H11, H12, H13 and most of H3.**

**Verify:** force a timeout (drop `statement_timeout` to 1ms in a test), confirm the PDF shows a
degradation banner and the "no prior art" conclusion is suppressed.

---

### ISSUE-B7 · Features the system never searched are reported to attorneys as points of novelty
**Workstream:** CORPUS + PAS · **Severity:** BLOCKER · **Fires on a fully healthy system — no failure required**

`retrieval.maxVectorQueries` defaults to **4** (`src/lib/settings/registry.ts:76-86`,
`envNumber('PATENT_SEARCH_MAX_VECTOR_QUERIES', 4)`; env var is **unset** in prod).
Truncation at `indian-corpus-provider.ts:842`:
```ts
const vectorRetrievalQueries = retrievalQueries.slice(0, tuning.maxVectorQueries)
```

- **Novelty** (`novelty-search-service.ts:1231-1286`) emits 1 concept + up to 8 feature queries = up to 9.
  **Five are dropped.** Those features never get embedded/retrieved/mapped → land at
  `present_in: 0, partial_in: 0` → which is **exactly** the filter
  `getPotentialDifferentiatorsFromAggregation` (`:1852-1855`) uses to populate
  **"Potential Differentiators"** in the report and the UI card at `Stage4ResultsDisplay.tsx:81`.
- **PAS** (`prior-art-studio/compiler.ts:52-102`) emits concept → steer → per-element → EXPAND blocks
  **in that order**. Copilot asks for 4–7 elements (`service.ts:115`), so `slice(0,4)` means
  **no EXPAND block probe ever executes** — while `QueryCanvas.tsx:16` tells the attorney EXPAND
  *"is what actually reaches across the 45M-document corpus."*

Truncation is logged only via a `force`-less `logEmbeddingSearch('info', …)` (`:843-855`) → suppressed in prod.

**Fix (both parts required):**
1. *Correctness:* exclude unsearched features from the differentiator computation — they are
   **unknown**, not distinguishing. Surface `{plannedQueries, executedQueries, unsearchedFeatures}`
   in the response and push a user-visible warning.
2. *Capacity:* the ANN probes run **serially** in a `for` loop at `indian-corpus-provider.ts:872-908`,
   so raising the cap multiplies latency directly (measured ~170–215 ms per probe on prod).
   Parallelize with concurrency 3–4 first (probes are independent; `merge()` is order-insensitive),
   **then** raise the cap to 6. Interleave EXPAND probes with element probes in `compiler.ts` so the
   Studio's headline lane survives truncation.

---

## §3. OUTSTANDING — HIGH

### ISSUE-H2b · The new google GIN cannot be used by the Studio — `skipTrigramSearch` is hardcoded
**Workstream:** PAS
`prior-art-studio/service.ts:501` sets `skipTrigramSearch: true` as an unconditional literal, with a
comment explaining it was because no index covered the Google corpus. That premise dies when the
partial GIN lands, but the flag isn't conditional. Same at `patent-drafting-job-service.ts:1176`.
**Fix:** make it conditional on corpus coverage. Confirm index type matches the operator: the trigram
lane emits `p."title" % $1 OR p."abstract" % $1`, which needs `gin_trgm_ops` — a tsvector GIN will not
serve `%`, and a trigram GIN will not serve `@@`.

### ISSUE-H3 · False and missing coverage claims (real-world liability — these go into attorney reports)
**Workstream:** all three
| Claim | Location | Status |
|---|---|---|
| *"Keyword search across a corpus of 30+ million patents…"* | `src/lib/patentnest/features.ts:129` | **FALSE** — no keyword index covered google rows; the Studio's own code says so at `prior-art-studio/service.ts:532` |
| *"Search through 12M+ patents worldwide"* | `src/components/drafting/RelatedArtStage.tsx:1984` | **FALSE** — stale by ~4× |
| Family-representative indexing | **nowhere** | **MISSING** — grep for "one per family"/"family representative" returns zero hits. Vector search covers 29.8M family representatives, not 46M publications; non-representatives are unreachable by *any* lane. `GatesFunnel.tsx:32` frames dedup as post-retrieval convenience when the corpus is pre-collapsed at index time |
| *"hybrid keyword + semantic retrieval with cross-encoder reranking"* | `api/prior-art-studio/sessions/[sessionId]/report/route.ts:56` | **MISLEADING** — keyword is a post-filter; rerank is best-effort (`orchestrator.ts:423`) |
| *"windowed to recent years"* vs *"from 2000 onward"* | `report/route.ts:61` vs `service.ts:325` | **CONTRADICTORY** |
| Corpus size stated as 12M / 30M+ / 45M | `RelatedArtStage.tsx:1984`, `src/app/page.tsx:15` (NEW, homepage), `features.ts:129`, `NoveltyDetail.tsx:116,313`, `DocumentHero.tsx:79,112`, `QueryCanvas.tsx:16` | **INCONSISTENT** |
| *"Scholarly literature is swept in parallel"* | `features.ts:129`, `NoveltyDetail.tsx:115` | **UNVERIFIED** — no scholar/Crossref/arXiv provider found in `provider-registry.ts` or `orchestrator.ts`; `:71-74` restricts local providers to google + indian. Confirm whether this lane still exists |

Also: the five honest disclosures built at `prior-art-studio/service.ts:324-331` are **never persisted**
(`run.create` at `:722-737` omits `gateDetail`) and never reach the DOCX; `run.warnings` **is**
persisted but the report never reads it.
**Fix:** settle on one true pair — **46.2M stored / 29.8M semantically indexed** — everywhere. Persist
`gateDetail`, render `run.warnings` in the DOCX, add a family-representative disclosure. The DOCX must
carry **more** disclosure than the UI, not less.

### ISSUE-H4 · Prior-Art Studio is ungated; all Voyage spend is unmetered
**Workstream:** PAS
**1 of 8** PAS routes calls `enforceServiceAccess` — only `draft` (`sessions/[sessionId]/draft/route.ts:30`).
The expensive one, `sessions/[sessionId]/run`, does not. OA gates 4 of 8. The Studio is linked from
`patent-search/page.tsx:475`, so any logged-in user reaches it.
Grep of `src/lib/metering/` for rerank/voyage/embedding returns **no matches** — `calculateCost()`
prices only input/output tokens, so rerank contributes $0 to every quota and dashboard. Six LLM
providers have metered adapters; Voyage has none.
Unbounded for any authenticated user: `/api/patent-search/advanced` (`route.ts:34`) and
`/api/patent-corpus/search` (`route.ts:9`) — no quota, no rate limit.
*Cost note:* real exposure is ~0.3¢/call, not 1¢ — `orchestrator.ts:216` clamps the pool to 300 before
`VOYAGE_RERANK_MAX_DOCS=1000` can bite, so the Studio's request for 1000 (`service.ts:27`) is silently clamped.
Related: `rerank.maxDocsPerCall` is exposed in the super-admin UI but read nowhere —
`voyage-reranker-service.ts:14` reads `process.env` at module load. The knob does nothing silently.
**Fix:** add a `PRIOR_ART_STUDIO` FeatureCode and gate all 8 routes; meter at the single choke point
`orchestrator.ts:434` and at `patent-corpus-service.ts:1893`; rate-limit the two unbounded endpoints.

### ISSUE-H5 · The element grid manufactures STRONG verdicts
**Workstream:** PAS
`element-scoring.ts:205-213` min-max normalizes similarity **within the candidate set**, so the best
document in any run scores `semanticRel = 1.0` regardless of absolute similarity. With
`combined = 0.6·semanticRel + 0.4·termCoverage` and STRONG at `≥0.66` with any literal support
(`verdictFor`, `:58-64`), ~0.15 term coverage suffices. Those cells feed `findAnticipationCandidates`
→ "§102 candidate" → DOCX section 6.
*In fairness:* the degenerate case is handled (`spread <= 0.0001` → `0.5`) and the comment explains the
tradeoff. The gap is the middle case: real spread but uniformly poor absolute relevance still promotes
its top member to STRONG.
**Fix:** gate STRONG behind an absolute similarity floor in addition to the relative score; suppress the
grid when the absolute band is entirely low.

### ISSUE-H6 · Office Action Studio needs four setup steps that exist in no runbook, and is fail-closed
**Workstream:** OA
Model resolution is fail-closed: `metering/model-resolver.ts:94-106` throws when a stage code has no
config, and `return result` at `:105` makes the task-only ladder below **unreachable** for stage-coded calls.
Required in strict order: `migrate deploy` → `Seed/seed-llm-models.js` → `scripts/add-office-action-feature.js`
→ `npx tsx scripts/sync-oa-profile.ts IN` (without the last, `createCase` throws "No active office-action
profile", `oa-case-service.ts:47`).
**Note the asymmetry:** PAS *has* a working fallback (`prior-art-studio/service.ts:157-180` retries
task-only on `LLM5_NOVELTY_ASSESS` and releases the reservation). OA has **none**
(`oa-llm-service.ts:194-196` returns failure and stops).
**Trap:** `scripts/add-office-action-feature.js` registers **no** WorkflowStage and no model config despite
a header claiming it makes the feature resolvable "for every OA pipeline stage". Running only that script
yields a fully quota'd feature whose every stage throws.
**Fix:** write the four steps into a runbook and into the script banners.

### ISSUE-H7 · The cutover doc's rollback procedure would silently kill retrieval
**Workstream:** CORPUS
`docs/novelty-search-local-corpus-cutover.md:121-124` says removing the `PATENT_CORPUS_EMBEDDING_*` /
`VOYAGE_API_KEY` lines makes the app *"fall back to text-embedding-3-small"*. It does not —
`patent-corpus-service.ts:20` **defaults** to `voyage-3.5-lite` (the same doc says so at line 39).
Removing the vars keeps Voyage and removes the key → the vector lane dies entirely.
`scripts/google-patents-import/RUNBOOK.md:148-151` repeats the error.
Its companion claim at `:47-49` (no key → "degrades to full-text + trigram, still returns results") is
true for the Indian corpus only.
**Fix:** rewrite rollback as an explicit `PATENT_CORPUS_EMBEDDING_MODEL=text-embedding-3-small` **set**,
not an unset. Pin the model explicitly in prod env rather than relying on the code default.

### ISSUE-H8 · Two Office Action failure paths render as success
**Workstream:** OA
1. **Failed objection classification shows a green toast.** `oa-case-service.ts:207` puts the error on the
   *success* object; `api/office-actions/[caseId]/documents/route.ts:82` maps it to HTTP **207**;
   `src/app/office-actions/[caseId]/page.tsx:160` guards with `if (!res.ok) throw` — **false for 207**.
   User sees *"Report read — 0 objections found"* in green, upload panel disappears, and the doc is written
   `parseStatus: 'COMPLETED'` so the DB cannot distinguish it either.
2. **Empty draft sections export into the filing DOCX as finished sections.** `response-drafter.ts:57`
   ignores `res.success` (`bodyText: res.data?.bodyText || ''`); `compliance-lint.ts:47-51` gates on the
   `approved` flag with **no non-empty check**. Lint passes green, Export unblocks, and
   `oa-docx-export.ts:144-150` emits the heading, examiner quote, bold *"Applicant's submission:"* — then nothing.
**Fix:** return 4xx/5xx when `result.error` is set (or check `data.error` client-side); propagate
`res.success` and add a body-length check to the lint.

### ISSUE-H9 · Five test suites fail to load — including all three covering the cutover
**Workstream:** CORPUS
`npx vitest run` reports **463 passed, 0 failed** — but **5 suites never execute**, dying at import with
`Timeout calling "fetch" … ssr`. Three are the safety net for this deploy:
`novelty-search-service.stage15.test.ts`, `__tests__/novelty-search-guardrails.test.ts`,
`novelty-attorney-report.test.ts`. (Also `auto-patent-draft-batch-controls.test.ts`, `support-data-sources.test.ts`.)
The suites that *do* run cover none of this audit's bug class — no test exercises a timeout, a failed lane,
a missing API key, or a degraded provider. The embedding config tests pass **vacuously**:
`__tests__/patent-corpus-service.test.ts:9` sets the model to `text-embedding-3-small` in `vi.hoisted()`,
so `requestVoyageEmbeddings` is **never executed by any test in the repo**, and nothing asserts `input_type`.
**Fix:** raise the vitest transform timeout so the three cutover suites run. Add a test that stubs fetch and
asserts `input_type === 'query'` for search vs `'document'` for corpus, plus `output_dtype === 'ubinary'`
and `output_dimension === 512`.

### ISSUE-H11 · The trigram lane still fires on the Google corpus for novelty and calibration
**Workstream:** CORPUS
`indian-corpus-provider.ts:957` gates the lane on `!request.skipTrigramSearch`. Only PAS
(`service.ts:501`) and drafting (`patent-drafting-job-service.ts:1176`) set it — novelty
(`novelty-search-service.ts:4105`) and calibration (`calibration-service.ts:151`) do **not**.
It is gated on `!hasEnoughCandidatesForRequestedLimit` (`:956`) — i.e. it fires precisely when the other
lanes came back short, which is exactly when they timed out. Failures compound.
**Fix:** make trigram opt-**in** per provider (a `trigramSearchEnabled` flag defaulting false on
`GooglePatentsCorpusProvider`, same shape as the FIXED-4 metadata fix) rather than relying on every caller.

### ISSUE-H12 · Zero candidates is recorded as a successful Stage 1, then dead-ends misleadingly
**Workstream:** CORPUS
`novelty-search-service.ts:2306-2308` sets `STAGE_1_COMPLETED` without inspecting `searchWarnings` or
`providerStats[].error`. The run jumps to Stage 4, which rejects it at `:9058` with *"Stage 1 results are
required for report generation. Please ensure Stage 1 is completed."* The user is told to re-run a stage
that did complete; re-running reproduces it exactly.
**Fix:** if `candidatePool.length === 0 && (searchWarnings.length || providerStats.some(s => s.error))`,
mark the run FAILED with the provider errors in the message.

### ISSUE-H13 · Sanitizers rewrite honest degradation language into confident language
**Workstream:** CORPUS
Three near-identical regex passes: `novelty-attorney-report.ts:350-405`,
`ConsolidatedNoveltyReport.tsx:~140-193`, `Stage4ResultsDisplay.tsx:16-48`. Among them:
`\bfallback\b` → `'record-based review'`, `\bunavailable\b` → `'to be confirmed'`,
`\binsufficient\b` → `'marked for review'`, `no prior art (was )?found` → a softer phrase.
These strip the exact words that would flag a degraded run.
**Fix:** exempt diagnostic/system-status text; run the sanitizer only over LLM-authored analytical prose.

### ISSUE-H14 · No `.env.example` exists anywhere
**Workstream:** all three
~60 env vars govern these workstreams; most degrade **silently** when absent. Notably
`GOOGLE_PATENTS_PAGE_FETCH` (`office-action/google-patents-fulltext.ts:15`) defaults **ON**, sending
undocumented outbound scraping traffic to google.com from OA citation resolution.
**Fix:** create `.env.example` covering all three workstreams with a comment per var stating the
missing-value behaviour.

---

## §4. OUTSTANDING — MEDIUM

| ID | Issue | Evidence |
|---|---|---|
| **M1** | **PQAI is the default corpus source** — `const corpusSource = context.corpusSource \|\| PATENT_CORPUS_SOURCE_PQAI`. Any caller omitting the context stamps **new** rows as pqai. Same pattern for `providerId` at `:899`. PQAI is deprecated per product direction. **Do not delete pqai DB rows** — historical novelty reports reference them, and `pqaiResults` is the persisted stage-1 JSON key (~89 refs in `novelty-search-service.ts`); renaming breaks stored reports. | `patent-corpus-service.ts:899-900` |
| **M2** | OA hardcodes `::bit(512)` instead of deriving from `PATENT_CORPUS_EMBEDDING_DIMENSIONS`. Correct today; if DTYPE flips to float, `corpusEmbeddingToLiteral` returns a bracketed float list, the cast throws, and both catch blocks swallow it into `return false` / `return []`. | `office-action/case-document-service.ts:122`, `context-budget.ts:82` |
| **M3** | Dead `searchPatentCorpus()` hardcodes `::vector` / `<=>` / no `/512`. **Zero callers repo-wide** — delete it before someone wires it up. | `patent-corpus-service.ts:2227,2309,2315` |
| **M4** | The incident-response diagnostic is broken under the binary config — builds a float literal from binary bytes. This is the tool you'd reach for during an outage and it reports "no vectors" against a healthy prod. Its `requiredProductionIndexes` list also omits google entirely, and it looks for `%embedding_hnsw%`/`%embedding_ivfflat%` while the real index is `local_patent_embeddings_binary_ivf_idx` → permanent false alarm. | `scripts/diagnose-patent-embedding-search.ts:114-122,225,231` |
| **M5** | OA ivfflat index is created on an **empty** table → degenerate centroids, poor recall until reindexed. | `20260718150000_oa_case_documents/migration.sql:47` |
| **M6** | **Two family-key derivations disagree.** `prior-art-studio/service.ts:563` uses `familyByPub.get(pub) \|\| pub` (raw publication number fallback) while `patent-search/utils.ts:40-45` `canonicalPublicationNumber` strips the kind-code suffix. For null-`familyId` rows, `US1234567A1` and `US1234567B2` are two families in the Studio, one in the orchestrator. `element-scoring.ts:96,157` drops null-`familyId` rows entirely — a third behaviour within the same feature. | as cited |
| **M7** | **MATCH enforcement disables itself globally.** `service.ts:542` uses `.some()` across *all* providers, so one indian-corpus text hit sets `matchMode: 'lane'` and the Studio stops literal-testing Google vector hits that were never keyword-tested — while the funnel reports `matchRemoved: 0`. Make it per-provider. | `prior-art-studio/service.ts:411,542` |
| **M8** | `semanticLaneRan` only checks for an API key (`hasSearchEmbeddingApiKey()`). Key present + Voyage 429 → `castOnly: 0`, `semanticLaneRan: true`, no warning, and the DOCX prints the zeros as findings about the art. The Studio never sets `strictSemantic` (contrast `patent-public-api.ts:181`). | `prior-art-studio/service.ts:694` |
| **M9** | Element-scoring failure produces an all-NONE grid that reads as a novelty finding. Two silent catches drop to literal-only (max `combined` 0.4 → every cell WEAK/NONE), then `ElementGrid.tsx:351-354` renders *"on this evidence the claim set looks distinguishable"* — an affirmative patentability statement from a failed subsystem. Propagate an `elementScoringRan` flag. | `service.ts:685-687`, `element-scoring.ts:173-177` |
| **M10** | Documents past rank 40 print as `[NONE]`. `ELEMENT_GRID_LIMIT = 40` but 100+ families are shown; `report/route.ts:150` renders `cell?.verdict \|\| 'NONE'`, so **unscored** is indistinguishable from **assessed as teaching nothing**. | `service.ts:48,676`; `report/route.ts:150` |
| **M11** | Unvalidated plan PATCH permanently bricks a session — writes arbitrary JSON with no shape validation, then `:91` calls `renderBooleanPreview` which iterates `plan.blocks` → TypeError **after** the write commits. GET calls the same function, so the session never loads again. Zod-validate before persisting; cap JSON size. | `api/prior-art-studio/sessions/[sessionId]/route.ts:48,70-73,91` |
| **M12** | The reranker receives a **boolean string** as its query (e.g. `(torque OR clutch) -bicycle`). A cross-encoder scoring that against title+abstract is out of distribution. Inconsistent too: EXPAND-only plans correctly fall back to natural language via `compiler.ts:170`. | `orchestrator.ts:428` |
| **M13** | Quarterly reload runbook has **no index management at all** — no GIN drop before, no rebuild after — and stops at "Phases 1–3", excluding embeddings, so IVFFlat centroids drift each quarter. Note `build-ann-index.sh:14` defaults `LISTS=2000` while prod runs **5000**. | `scripts/google-patents-import/RUNBOOK.md:160-164` |
| **M14** | A poisoned invention digest is persisted permanently — an all-empty digest is written on failure, and the `if (!digest)` guard means "Re-prepare reply" never rebuilds it. `"Problem: \nSolution: "` then goes into every downstream prompt for the life of the case. | `office-action/reply-pipeline.ts:51,58-59` |
| **M15** | **The case-law whitelist is never enforced.** `oa-llm-service.ts:41` instructs the model to *"Cite only authorities supplied to you in the case-law whitelist"*, but `caseLawWhitelist` is only defined in the profile schema (`oa-profile-schema.ts:107`) and never read, injected, or post-hoc stripped. IN.json's five curated authorities reach no model; invented Indian case law passes every gate including export lint. | as cited |
| **M16** | Incomplete cited documents are marked `RESOLVED` regardless of `doc.complete` → biblio-only record gets an enabled "Read" button, `claim-chart-service.ts:114` verifies against an abstract, every feature returns NOT_DISCLOSED, shown in green as *"absent — your distinction"*. Also `:280` claims an inline fallback that does not exist; the code only enqueues. | `office-action/citation-resolver.ts:111-125,280` |
| **M17** | Untyped dynamic imports on both OA embedding paths (`const mod: any = await import(...)`) — TypeScript cannot check them, so renaming an export compiles fine and turns OA retrieval into a permanent silent no-op. `citation-resolver.ts:217,233,248,258` uses destructured dynamic imports (type-checked) — match that pattern. | `context-budget.ts:50`, `case-document-service.ts:105-109` |
| **M18** | **`core.autocrlf=true` with no `.gitattributes`.** Migration `.sql` files are stored LF (prod checks out LF, checksums match) but the next `git checkout` **on Windows** rewrites them to CRLF, changing sha256 → local "migration checksum mismatch". Add `*.sql text eol=lf`. | repo config |
| **M19** | No `ecosystem.config.js`, systemd unit, or cron anywhere in the repo — the entire prod process topology (10 pm2 processes) exists only in `~/.pm2/dump.pm2`. `scripts/office-action-worker.ts` has no documented launch at all, unlike the novelty and drafting workers. | repo-wide |

---

## §5. OUTSTANDING — LOW

| ID | Issue |
|---|---|
| **L1** | `local_patent_embeddings_embedding_hnsw_idx` is **6150 MB** on the legacy `vector(1536)` column, which holds only 781,103 obsolete rows. Reclaimable after a stable week — but only once the H7 rollback path is corrected, since that's the lane it would serve. |
| **L2** | `pm2 delete patent-corpus-batch-embed` — the OpenAI worker that crash-looped 651× (its guard at `scripts/patent-corpus-batch-embed.ts:704-711` correctly refuses to run under a voyage model, then `process.exit(1)`, which under pm2 = restart loop). Still registered as pm2 id 5. Change the guard to `exit(0)`. |
| **L3** | 2,540 `voyage-3.5-lite QUEUED` rows unembedded. `patent-corpus-worker` is registered and `PATENT_CORPUS_EMBEDDING_MODE` is unset, so it should drain them — confirm it is online. |
| **L4** | `oa_document_chunks.caseId` has no FK (only `documentId` does). Cascade works transitively; referential integrity does not. |
| **L5** | The only reasoning model (`gpt-5.6-terra-thinking`) is assigned to `OA_ARGUMENT`, a stage that is **declared but never invoked** — all legal argument is written by `gemini-3.5-flash` via `OA_DRAFT_SECTION`. |
| **L6** | OA's "jurisdiction-agnostic" architecture is India-shaped where it counts: `oa-parser.ts:180-188` `buildTriggerDates()` emits only `dateOfReport`/`hearingDate`, so any profile with a different trigger silently yields no deadlines. Four validated profile fields are never read at runtime. `meta.status: "draft"` profiles are fully live (`oa-case-service.ts:28-34` never checks). Only `Countries/IN.json` has an `officeActionProfile` (0 of 17 others). |
| **L7** | Five idea-bank components import a value-position binding from a Prisma-importing module (`IdeaBankIdeaWithDetails` from `@/lib/idea-bank-service`). Harmless only because it resolves to an `interface` and SWC elides it — add `type` before someone adds a real value export and detonates six components. |
| **L8** | Three `oa:test*` npm scripts point at files matched by `.gitignore:77` (`scripts/test-*.ts`) — they will never run on a fresh clone or prod. |
| **L9** | `schema.prisma:4998` comment still reads "text-embedding-3-small default (1536)" above the now-`bit(512)` field. |
| **L10** | `metering/utils.ts:161-171` `isValidTaskCode` omits `LLM8_OA_RESPONSE`, `LLM6`, all `IDEATION_*`; `isValidFeatureCode` omits `OFFICE_ACTION_RESPONSE`. Harmless — **zero callers** — but a trap. |
| **L11** | `20260717120000` uses `ADD VALUE IF NOT EXISTS` while `20260717140213:17,20,23` do not. Inconsistent; not a correctness issue since Prisma never re-runs applied migrations. |
| **L12** | Duplicate stage seeding: `ADVANCED_MANUAL_SEARCH_QUERY_GENERATOR` is defined in **both** `Seed/seed-llm-models.js:1188` and `scripts/add-advanced-manual-search-stage.js:27-37`, and they disagree on `temperature` (0.4 vs schema default 0.7). Whichever runs first wins. Consider dropping the standalone script. |
| **L13** | `tsconfig.tsbuildinfo` is tracked and modified — should probably be gitignored. |

---

## §6. RECOMMENDED SEQUENCING

**Wave 1 — CORPUS (ready now).** All its blockers are FIXED. Ship the code with **no migration**
(settings tables fail open by design), verify search, then apply `20260718170000_retrieval_tuning_settings`
alone. Do not run migrations while an index build is in flight.
Optional env-only win: `PATENT_SEARCH_MAX_VECTOR_QUERIES=6` — but only **after** ISSUE-B7's
parallelization, since the probes are serial (~170–215 ms each on prod).

**Wave 2 — before either Studio ships:** B6, B7, H3, H4, H5, H8, H9, H2b, M1.
B6 is the highest-leverage single fix — it closes H11, H12, H13 and most of H3 with it.

**Wave 3 — Studio launch:** commit Studio code **with** its four migrations together (they cannot be
split: both add adjacent lines to `metering/gateway.ts:723-725`, both edit `seed-llm-models.js` and
`schema.prisma`, and a partial seed run leaves one workstream fail-closed). Then seed in strict order:
`seed-llm-models.js` (no `SEED_OVERWRITE_STAGE_CONFIGS`) → `add-office-action-feature.js` →
`sync-oa-profile.ts IN` → start `oa:worker`.

**Wave 4 — deferred estate cleanup:** L1, L2, M13, and only then reconsider the 8.6 GB non-partial
`local_patents_search_tsv_idx` (see §0 rule 3).

---

## §7. WHAT WAS NEVER VERIFIED — TREAT AS UNKNOWN

1. **The Prior-Art Studio UI has never rendered.** FIXED-1 unblocked the build; it means the page *can*
   now load for the first time. **Nobody has ever clicked** the reader, filters, element grid, theory
   pinning, or term harvesting. This is the single largest unknown in the audit and the most likely
   source of the next FIXED-1-class discovery. **Drive it before shipping.**
2. **No live LLM or Voyage call was made.** Every finding about model output, rerank quality, and the
   practical magnitude of the asymmetry bug is traced through code, not observed.
3. **OA runtime was never exercised.** `oa:test:*` and `oa:eval` were not run against live APIs. The
   deterministic eval (`npm run oa:eval`, 21/21) covers parsing and date arithmetic only — the plan's
   "≥90% objection classification F1 over ~50 FERs" bar has **no harness at all**.
4. **All latency/cost figures are analytical**, except the measured 171 ms ANN scan and ~170–215 ms
   per-probe estimate.
5. **Whether the partial `local_patents_google_search_tsv_idx` finished building** and whether an
   `EXPLAIN` now shows it being chosen over the 8.6 GB non-partial index. Verify before acting on §0 rule 3.
6. **Whether the scholarly-literature lane still exists** (see ISSUE-H3, last row).
