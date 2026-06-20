# Production embedding-search debugging

The intelligent local-corpus search uses three independent retrieval paths: PostgreSQL full-text, trigram matching, and OpenAI query embeddings followed by pgvector nearest-neighbor search. Manual search uses exact field filters and intentionally does not run the vector branch.

Query embeddings are sent immediately to the OpenAI embeddings endpoint. They never enter `local_patent_embeddings`, never wait for a corpus batch size, and never use the OpenAI Batch API process. Query calls have their own timeout/retry policy and can use `OPENAI_SEARCH_API_KEY`; corpus indexing can independently use `OPENAI_CORPUS_API_KEY`. Both fall back to `OPENAI_API_KEY` when dedicated keys are not configured.

## Return production to incremental embedding mode

Stop and remove only the historical OpenAI Batch API embedder. Keep either the Next.js in-process runner or one standalone realtime corpus worker so newly extracted patents continue to receive vectors:

```bash
pm2 status
pm2 stop <historical-batch-embedder-name>
pm2 delete <historical-batch-embedder-name>
```

The historical process is the one started with `patent-corpus:batch-embed:auto` or `patent-corpus-batch-embed.ts --watch`. Do not stop the main Next.js app. If production uses `patent-corpus:worker` for journal polling/extraction, keep that process online.

As an additional safeguard, the historical batch script no longer submits new OpenAI Batch API jobs while `PATENT_CORPUS_EMBEDDING_MODE=realtime`. It may still poll an already-submitted job so completed output is not stranded. A future intentional historical backfill must explicitly set `PATENT_CORPUS_EMBEDDING_MODE=batch` or pass `--force-submit`.

Set the normal realtime configuration in the PM2 ecosystem/environment:

```bash
export PATENT_CORPUS_EMBEDDING_MODE=realtime
export PATENT_CORPUS_REALTIME_EMBEDDINGS=true
export PATENT_CORPUS_EMBEDDING_BATCH=32
export PATENT_CORPUS_AUTO_EMBEDDING_BATCH=32
export PATENT_CORPUS_EMBEDDING_API_BATCH=32
export PATENT_SEARCH_EMBEDDING_TIMEOUT_MS=15000
export PATENT_SEARCH_OPENAI_MAX_ATTEMPTS=2
pm2 restart <app-name> --update-env
pm2 restart <corpus-worker-name> --update-env
```

For rate-limit isolation, configure separate OpenAI project keys:

```bash
export OPENAI_SEARCH_API_KEY=<latency-sensitive-search-project-key>
export OPENAI_CORPUS_API_KEY=<background-indexing-project-key>
```

This is optional. Without dedicated keys, both paths use `OPENAI_API_KEY`, but they still have separate code paths and no shared application queue or batch-size gate.

## Observe one search in PM2

Enable detailed search events in the environment used to start the application, then reload that environment into PM2:

```bash
export PATENT_SEARCH_DEBUG=true
pm2 restart <app-name> --update-env
pm2 logs <app-name> --lines 0 | grep --line-buffered -E 'OpenAIQueryEmbedding|PatentEmbeddingSearch|PatentSearch|PatentCorpus'
```

Run one intelligent search from the UI. Events with the same `traceId` describe that request:

- `OpenAIQueryEmbedding` `request_dispatched` proves the query vectors were sent immediately to OpenAI. It reports the model, input count and lengths, fingerprints, timeout, attempt, and key source without logging query text or credentials.
- `OpenAIQueryEmbedding` `response_received` proves OpenAI responded. It reports HTTP status, latency, the OpenAI request ID, and server processing time when provided.
- `OpenAIQueryEmbedding` `vectors_received` proves the response was parsed and reports vector count and dimensions.
- `OpenAIQueryEmbedding` `request_failed` reports timeouts, network/API errors, and whether another attempt will run.
- `vector_search_skipped` identifies `missing_openai_api_key`, `manual_mode`, or `no_retrieval_queries`.
- `query_embeddings_created` proves the PM2 process can call OpenAI and reports the returned dimension.
- `vector_query_completed` proves PostgreSQL accepted the vector query and reports its row count and duration.
- `vector_search_returned_no_rows` distinguishes a current-model inventory gap from a general absence of vectors.
- `vector_search_failed` includes the failing stage (`openai_embedding_request` or `postgres_vector_query`) and the actual error.
- `search_completed` reports how many displayed results had vector versus text ranks.
- `PatentCorpusWorker` `runner_started` shows whether the worker received the key and whether realtime embedding creation is enabled.
- `PatentCorpusWorker` `embedding_batch_processed` reports completed and failed jobs with up to three stored error samples.

Also verify that an always-on corpus worker is present if production relies on the standalone worker:

```bash
pm2 status
pm2 logs <corpus-worker-name> --lines 100
```

The Next.js in-process runner is kicked by upload/retry actions; it is not automatically kicked merely by a PM2 restart. Queued work after a restart therefore requires the standalone `patent-corpus:worker` process or a manual worker kick.

Do not print `OPENAI_API_KEY` or dump the complete PM2 environment. The structured events report only whether the key is present.

For only the OpenAI query request/response lifecycle:

```bash
pm2 logs <app-name> --lines 200 | grep -E 'OpenAIQueryEmbedding'
```

Expected successful sequence:

```text
[OpenAIQueryEmbedding] {"event":"request_dispatched","traceId":"...","model":"text-embedding-3-small","inputCount":4,"requestedDimensions":1536,...}
[OpenAIQueryEmbedding] {"event":"response_received","traceId":"...","status":200,"ok":true,"durationMs":...,"openAIRequestId":"req_..."}
[OpenAIQueryEmbedding] {"event":"vectors_received","traceId":"...","vectorCount":4,"vectorDimensions":1536,...}
```

## Run the database and OpenAI smoke test

From the deployed release directory, using the same environment values as the PM2 app:

```bash
npm run patent-corpus:diagnose-search
```

To inspect database inventory without making an OpenAI request:

```bash
npm run patent-corpus:diagnose-search -- --skip-openai
```

The final `findings` event checks the PM2/runtime key, pgvector extension and column dimension, vector indexes, configured-model inventory, source coverage, recent failed jobs, OpenAI response dimensions, and a live nearest-neighbor query.

## Common findings

- Prisma `P2028 Transaction already closed` at about 8 seconds means an older build is using a 5-second interactive transaction around an 8-second PostgreSQL statement timeout. Deploy the current build; it uses a sequential transaction so the configured database timeout applies correctly.
- If searches then report PostgreSQL statement timeout, run `npx prisma migrate deploy`. The `20260619170000_optimize_local_patent_search` migration adds the corpus-specific full-text and metadata indexes required by the current queries.
- `missing_openai_api_key`: PM2 did not receive `OPENAI_SEARCH_API_KEY` or the fallback `OPENAI_API_KEY`. Set one in the deployment environment and restart with `--update-env`.
- Completed vectors exist, but not for the configured model: align `PATENT_CORPUS_EMBEDDING_MODEL` with the indexed rows or re-embed the corpus.
- Queued rows with no completed rows: start or repair the patent corpus worker and verify its PM2 process also has the OpenAI key.
- Failed rows: use `failed_embedding_samples` to distinguish authentication, quota/rate-limit, network, and dimension errors.
- OpenAI succeeds but PostgreSQL fails: verify the `vector` extension, `vector(1536)` column, migration state, and vector operator/index.

After debugging, disable verbose per-query events and restart:

```bash
export PATENT_SEARCH_DEBUG=false
pm2 restart <app-name> --update-env
```
