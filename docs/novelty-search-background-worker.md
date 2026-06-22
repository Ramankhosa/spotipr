# Novelty search background worker

Deploy the database migration before deploying code that submits background novelty searches:

```bash
npx prisma migrate deploy
npx prisma generate
```

Run exactly one or more durable workers alongside the Next.js PM2 process:

```bash
pm2 start npm --name patentnest-novelty-worker -- run novelty-search:worker
pm2 save
```

The worker uses database locks, so multiple instances are safe. Start with a batch size of one because deep novelty analysis is LLM intensive:

```bash
NOVELTY_SEARCH_WORKER_BATCH=1
NOVELTY_SEARCH_LOCK_MINUTES=30
```

Set `NEXTAUTH_URL` (or `NEXT_PUBLIC_APP_URL`) to the public application origin so completion emails point to the protected PDF viewer. The worker also needs the same database, JWT, Mailjet, patent-search, LLM-provider, and metering environment values as the web process.

Useful commands:

```bash
npm run novelty-search:worker:once
pm2 logs patentnest-novelty-worker --lines 200
```

Queued work survives web or worker restarts. Do not run the worker before the migration is present.

Users can cancel their own `QUEUED` or `PROCESSING` searches from novelty-search history. Cancellation immediately prevents the worker from claiming or completing the job. An external request already in flight may return before the worker observes cancellation, but no later pipeline stage, completion email, or usage record is produced for the cancelled job.
