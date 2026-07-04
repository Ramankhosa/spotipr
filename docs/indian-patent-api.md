# Indian Patent Corpus API

## Production configuration

```env
PATENT_PUBLIC_API_ENABLED=false
PATENT_PUBLIC_API_MIN_EMBEDDING_COVERAGE=99
OPENAI_SEARCH_API_KEY=...
```

Keep `PATENT_PUBLIC_API_ENABLED=false` until the Patent API readiness panel reports that pgvector, the query embedding key, and at least 99% of Indian corpus embeddings are available.

Run the existing corpus worker until the backfill is complete:

```bash
npm run patent-corpus:worker
```

The worker queues and embeds new journal imports automatically. Use the super-admin page at `/super-admin/patent-api` to verify coverage, create clients, issue keys, and inspect usage. API keys are displayed once and cannot be recovered.

## Operations

- Public endpoints: `POST /api/v1/patents/search` and `GET /api/v1/patents/{publicationNumber}`.
- OpenAPI: `/api/v1/openapi.json`.
- Human documentation: `/developers/patent-api`.
- Run `npm run patent-api:cleanup` daily to retain detailed request logs for 90 days, minute buckets for 7 days, and daily/monthly aggregates for two years.
- Rotate a key by issuing a replacement, deploying it to the client, and then revoking the old key.
- Suspending a client invalidates all of its keys immediately without deleting usage history.

