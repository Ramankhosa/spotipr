# Patent corpus — operating notes

**Read this before writing any code that queries `local_patents` or
`local_patent_embeddings`.** Last verified 19 Jul 2026.

## What is in the corpus

| | |
|---|---|
| Rows | **45,392,938** in `local_patents` |
| Source | Google Patents public data, **2000–2026**, worldwide |
| Tagging | `corpusSources = {google-patents-corpus}`; Indian publications **dual-tagged** `{google-patents-corpus, indian-corpus}` |
| Indian corpus | 780,381 rows (pre-existing, also voyage-embedded) |
| Vectors | **29,826,248** — one per DOCDB family |

**Coverage gaps to surface in any UI:** no pre-2000 art; no non-patent literature;
dataset refreshes quarterly (0–3 month lag); claims/description exist for **US only**.

## Embedding contract

```bash
PATENT_CORPUS_EMBEDDING_MODEL=voyage-3.5-lite
PATENT_CORPUS_EMBEDDING_DIMENSIONS=512
PATENT_CORPUS_EMBEDDING_DTYPE=binary        # -> column embeddingBinary bit(512)
VOYAGE_API_KEY=...                          # REQUIRED; see silent-failure note
```

Derived in `src/lib/patent-corpus-service.ts` — **import these, never hardcode**:

- `PATENT_CORPUS_EMBEDDING_COLUMN` → `embeddingBinary` (binary) / `embeddingHalf` (float 512) / `embedding` (float 1536)
- distance operator → `<~>` Hamming (binary) / `<=>` cosine (float)
- similarity → `1 - distance/512`

Code that hardcodes `bit(512)` or `<~>` breaks silently if the model is ever changed.

### query vs document embeddings — easy to get wrong

Voyage embeddings are **asymmetric**. `patent-corpus-service.ts` sets `input_type`
from the request purpose:

```ts
type EmbeddingRequestPurpose = 'search-query' | 'corpus-indexing' | 'diagnostic'
// 'search-query' | 'diagnostic' -> input_type: 'query'
// 'corpus-indexing'             -> input_type: 'document'
```

Use the helpers so this is handled:

- user search text → `requestCorpusEmbedding(text, { purpose: 'search-query' })`
- corpus content → `{ purpose: 'corpus-indexing' }`

Getting it backwards does not error — it quietly returns worse matches.

### What is embedded

| Content | Embedded? | Notes |
|---|---|---|
| `title` + `\n` + `abstract` | **yes — the only thing** | English for every country (MT where needed), capped 20k chars |
| `claimsText` | no (stored) | **US-only**; fetched on demand after retrieval |
| `descriptionText` | no (stored) | **US-only**, first 5k chars |
| `ragText` (top_terms) | no (stored) | part of the full-text index expression, not the vectors |

Semantic recall is therefore **abstract-level**. A feature appearing only deep in
claims will not be found by the vector lane.

### Vector resolution

One vector per **DOCDB family**; representative chosen **US → granted (`B*`) → newest**.
Rows without `familyId` are keyed by `publicationNumber`. Resolve a document's vector
by `publicationNumber` first, then fall back to `familyId`.

### Silent-failure mode

Without `VOYAGE_API_KEY` the semantic lane is **skipped silently** and retrieval
degrades to full-text matching — results still return, so it is easy to miss. Detect:

```bash
pm2 logs patentnest | grep -iE "vector_search_skipped|missing_embedding_api_key"
```

### Unrelated embedding systems

`PATENT_CORPUS_EMBEDDING_*` governs **only** the patent corpus. Grapsi's
public-project embeddings are a separate system with their own config
(`EMBEDDING_PROVIDER`, `EMBEDDING_GENERATION_ENABLED`, …) and their own vectors.
They share the VM and Postgres instance but nothing else. Never mix models or
columns between them.

## Indexes — what is safe to filter on

Created by migration `20260719120000` (built out-of-band CONCURRENTLY on prod):

| Index | Covers | Size |
|---|---|---|
| `local_patent_embeddings_binary_ivf_idx` | IVFFlat Hamming, `lists=5000`, `probes=24` | 2.4 GB |
| `local_patents_google_search_tsv_idx` | full-text GIN, **google corpus only** | 5.8 GB |

Also indexed: `publicationNumber`, `pub_canonical`, `familyId`, `filingDate`,
`publicationDate`, `classifications[]` (GIN), `corpusSources[]` (GIN).

### NOT indexed for Google rows

The **trigram** GINs (`*_trgm_idx`) are **PARTIAL — `indian-corpus` / `pqai` only**
(migration `20260713140000`). Un-scoped they would reach ~150 GB. So `ILIKE` /
trigram similarity against Google rows is a **sequential scan over 45M rows**.

Expressions that will **not** use the google full-text index, and would each need
their own partial index:

- `titleAbstractSearchDocumentExpression()` — omits `ragText`
- `metadataDocumentExpression()` — `'simple'` regconfig over classifications/inventors/applicants

## Postgres tuning (19 Jul 2026)

The instance ran stock defaults until this date. Now set via `ALTER SYSTEM`:

| Setting | Was | Now |
|---|---|---|
| `shared_buffers` | 128 MB | **4 GB** |
| `work_mem` | 4 MB | 64 MB |
| `effective_cache_size` | 4 GB | 11 GB |
| `random_page_cost` | 4.0 | 1.1 (SSD) |
| `maintenance_work_mem` | 64 MB | 2 GB |

Effect: single vector query **691 ms → 172 ms**; planning 95 ms → 4.8 ms.
Budget query latency against the tuned numbers.

## Operating rules

1. **Index builds must be serialized.** Two concurrent builds put 12–14 GB of
   `maintenance_work_mem` in play on a 16 GB box (OOM risk to Postgres) and thrash
   one disk. Serial is both safer and faster in wall-clock.
2. **Always `DROP INDEX IF EXISTS` before a CONCURRENTLY rebuild; never use
   `IF NOT EXISTS` there.** A failed CONCURRENTLY build leaves an **invalid 0-byte
   stub**; a retry with `IF NOT EXISTS` sees the stub and silently skips the real
   build, "succeeding" in seconds.
3. **Verify by `indisvalid` + size, never by "the command returned":**
   ```sql
   SELECT indisvalid, pg_size_pretty(pg_relation_size(indexrelid))
   FROM pg_index WHERE indexrelid = '<index_name>'::regclass;
   ```
4. **After a large corpus refresh, REINDEX the IVFFlat** — its centroids are fixed
   at build time and drift as the corpus grows:
   ```sql
   REINDEX INDEX CONCURRENTLY local_patent_embeddings_binary_ivf_idx;
   ```
   Also drop the full-text GIN before a bulk quarterly upsert and rebuild after —
   a GIN of this size materially slows bulk writes.
5. **`ivfflat.probes` is a runtime setting.** Raising it (24 → 40) improves recall
   at some latency cost and needs **no rebuild**:
   ```sql
   ALTER DATABASE spotipr SET ivfflat.probes = 40;
   ```
6. **Do not re-enable `patent-corpus-batch-embed` in pm2.** It is the OpenAI batch
   worker and refuses voyage models by design; with the current config it crash-loops.
   Voyage embedding runs through `patent-corpus-voyage-batch-embed`.

## Costs

- One-time embedding of 29.8M families: ~$80 (Voyage Batch API).
- Reranker: ~1¢ per search (`rerank-2.5-lite`, one call per search over the merged
  pool, `VOYAGE_RERANK_MAX_DOCS=1000`).
- Voyage account limits: 16M TPM / 2000 RPM.
