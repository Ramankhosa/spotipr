# Patent drafting background worker

Deploy the database migration before enabling automated drafting jobs:

```bash
npx prisma migrate deploy
```

Start the worker:

```bash
pm2 start npm --name patentnest-drafting-worker -- run patent-drafting:worker
```

Run once for smoke testing:

```bash
npm run patent-drafting:worker:once
```

The worker claims rows from `patent_drafting_jobs` with a lease, so multiple instances are safe. Start with a batch size of one because claims, figures, and draft generation are LLM intensive:

```bash
PATENT_DRAFTING_WORKER_BATCH=1 npm run patent-drafting:worker
```

Queue an automated draft with:

```http
POST /api/patents/:patentId/drafting/automation
```

Minimal JSON body:

```json
{
  "title": "Adaptive thermal control assembly",
  "ideaDetails": "Detailed invention disclosure text...",
  "novelty": "The control loop predicts thermal drift before load changes.",
  "jurisdictions": ["IN"],
  "literatureReview": {
    "instructions": "Use these references only for background context.",
    "content": "Prior literature review text...",
    "priorArtEntries": [
      { "patentNumber": "US1234567", "title": "Thermal controller", "snippet": "Relevant disclosure..." }
    ]
  },
  "figureRemarks": "Generate a block diagram and a method flow. Avoid battery-management figures.",
  "draftingRemarks": "Keep the draft broad and emphasize predictive control."
}
```

Status and controls:

```http
GET  /api/patents/:patentId/drafting/automation
GET  /api/patents/:patentId/drafting/automation/:jobId
POST /api/patents/:patentId/drafting/automation/:jobId/cancel
POST /api/patents/:patentId/drafting/automation/:jobId/retry
```

The API expects text already extracted from uploaded files. Use the existing draft ingestion endpoint to extract supported file formats, then submit the normalized text and review sections in the automation payload.
