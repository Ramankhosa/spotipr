# Patent drafting background worker

Deploy the database migration before enabling automated drafting jobs:

```bash
npx prisma migrate deploy
```

Required runtime environment:

```bash
DATABASE_URL=...
JWT_SECRET=...
SITE_URL=https://your-domain.com
# or NEXTAUTH_URL=https://your-domain.com

MAILJET_API_KEY=...
MAILJET_API_SECRET=...

# Configure whichever LLM provider keys are used by Super Admin LLM config.
OPENAI_API_KEY=...
GOOGLE_AI_API_KEY=...
```

Optional worker tuning:

```bash
EMAIL_DRAFTING_WORKER_BATCH=1
EMAIL_DRAFTING_WORKER_ID=patentnest-email-drafting-worker
PATENT_DRAFTING_WORKER_BATCH=1
PATENT_DRAFTING_WORKER_ID=patentnest-drafting-worker
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

## Batch upload

Users can download a fillable batch template, enter one patent idea per row, and upload it to create a server-side drafting batch.

Template downloads:

```http
GET /api/auto-patent-drafting/batches/template
GET /api/auto-patent-drafting/batches/template?format=xlsx
GET /api/auto-patent-drafting/batches/template?format=csv
```

Batch upload:

```http
POST /api/auto-patent-drafting/batches
```

Supported upload formats:

- `.xlsx`
- `.csv`
- `.tsv`
- `.json`

The template uses these columns. Each populated row creates one patent draft request:

```text
title
ideaDetails
noveltyDetails
literatureReviewInstructions
literatureReviewContent
figureRemarks
draftingRemarks
jurisdictions
filingType
claimsText
claimsHandling
claimsNotes
priorArtHandling
illustrativeData
```

Useful batch status/download endpoints:

```http
GET /api/auto-patent-drafting/batches
GET /api/auto-patent-drafting/batches/:batchId
GET /api/auto-patent-drafting/batches/:batchId/download
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
