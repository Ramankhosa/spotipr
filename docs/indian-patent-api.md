# Indian Patent Corpus API

## Production configuration

```env
PATENT_PUBLIC_API_ENABLED=false
PATENT_PUBLIC_API_MIN_EMBEDDING_COVERAGE=99
OPENAI_SEARCH_API_KEY=...
# v1.1 AI analysis endpoints (features extraction + feature mapping + MCP tools)
PATENT_PUBLIC_API_LLM_USER_EMAIL=api-service@yourdomain.com
```

Keep `PATENT_PUBLIC_API_ENABLED=false` until the Patent API readiness panel reports that pgvector, the query embedding key, and at least 99% of Indian corpus embeddings are available.

Run the existing corpus worker until the backfill is complete:

```bash
npm run patent-corpus:worker
```

The worker queues and embeds new journal imports automatically. Use the super-admin page at `/super-admin/patent-api` to verify coverage, create clients, issue keys, and inspect usage. API keys are displayed once and cannot be recovered.

## AI analysis endpoints (v1.1)

`POST /api/v1/analysis/features` and `POST /api/v1/analysis/feature-mapping` run LLM analyses through the standard metering gateway by impersonating a dedicated platform service user, exactly like the background workers do.

Setup:

1. Create (or pick) a service user and set `PATENT_PUBLIC_API_LLM_USER_EMAIL` to its email. The user must belong to a tenant whose plan has stage model configs for `NOVELTY_QUERY_GENERATION` and `NOVELTY_FEATURE_ANALYSIS` (the same stages the in-app novelty search uses) and enough token quota for expected API volume.
2. If the variable is unset, the analysis endpoints and the analysis MCP tools return `503 ANALYSIS_UNAVAILABLE`; search and lookup keep working.
3. LLM costs for these endpoints are metered against the service user's tenant — watch it on the usage analytics pages and size client rate limits accordingly (analysis calls are far more expensive than search calls).

## MCP endpoint (v1.1)

`POST /api/v1/mcp` speaks Model Context Protocol (streamable HTTP transport, JSON responses) and exposes `search_patents`, `get_patent`, `extract_invention_features`, and `map_features_to_patent`. `initialize` and `tools/list` are open for discovery; `tools/call` requires a `pn_live_` bearer key and consumes the same quotas as REST requests. Request logs record the tool as `/api/v1/mcp#<tool>`.

## Operations

- Public endpoints: `POST /api/v1/patents/search` (now includes a `coverage` manifest), `GET /api/v1/patents/{publicationNumber}`, `POST /api/v1/analysis/features`, `POST /api/v1/analysis/feature-mapping`, `POST /api/v1/mcp`.
- OpenAPI: `/api/v1/openapi.json`.
- Human documentation: `/developers/patent-api`.
- Run `npm run patent-api:cleanup` daily to retain detailed request logs for 90 days, minute buckets for 7 days, and daily/monthly aggregates for two years.
- Rotate a key by issuing a replacement, deploying it to the client, and then revoking the old key.
- Suspending a client invalidates all of its keys immediately without deleting usage history.
- Smoke test: `npm run patent-api:smoke` (set `SMOKE_ANALYSIS=1` to also exercise the LLM analysis endpoints — this spends real tokens).
