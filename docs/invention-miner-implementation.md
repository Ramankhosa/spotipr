# Invention Miner implementation handoff

Status: milestones A–E are implemented behind `INVENTION_MINER_ENABLED`; the flag remains disabled by default until the target environment completes the release checks below.

## Delivered workflow

The dedicated `MINER` route now supports: define field → inspect and approve workload → harvest → run four engines → review or develop a concrete proposal → approve an immutable revision → assess separately for IN, US, and EP → prepare an English office brief → export Word or open novelty/drafting.

The existing Field and Invention study routes remain intact. The Patent Search navigation item was removed while its internal retrieval infrastructure remains available to the workflows that need it. Preliminary claim generation displays **Standard** in place of Broad and defaults to Standard (`broad` remains the backwards-compatible stored value).

## Milestone record

### A — trustworthy field and evidence

- Added a Miner-only canonical retrieval identity that ignores display metadata and ordering. The global scope fingerprint was not changed.
- Added approved field snapshots with resolved matching, exact family/publication membership, membership hash, coverage, representative records, thresholds, and workload.
- Extraction contract v2 records exact source text/hash, available versus read depth, truncation, language/translation, claim depth/numbers, locations, and evidence spans.
- Every extracted problem, mechanism, effect, teaching-away statement, claim element, and limitation requires supplied-text support. Meaning-changing number, unit, negation, and condition edits are rejected.
- Harvests pin snapshot membership and extraction IDs. Engine evidence is append-only and identifies its run/purpose. Reruns update machine findings and current pointers without deleting reviewed history.
- Focus problems affect priority only; constraints reach proposal feasibility; assignee remains context unless explicitly made a retrieval filter.
- Expiry output is labelled an age-based research signal, never confirmed expiry or freedom to operate.

### B — workspace and recoverable execution

- Added explicit MINER creation, routing, labels, detail/report handling, and a visible unknown-kind error.
- Added preflight/approval, paginated lead/detail, proposal/review, cancellation, report, and handoff endpoints.
- Added immutable operation rows and atomic run/quota reservation before dispatch. Identical work returns its result; explicit refresh creates a charged new operation. Reservations finalize on success and release on terminal failure/cancellation.
- Result writes are lease- and input-revision-fenced, so obsolete work cannot become current.
- The Miner UI shows background progress, measured counters, engine skip reasons, cache reuse, cancellation, reload recovery, and paid refresh actions.
- Added standalone worker mode and `/api/health/whitespace-worker`. Production defaults to standalone; development defaults to inline.

### C — reviewed proposals

- Added `MINER_PROPOSE` with an independently configurable stage and up to three concrete alternatives.
- Proposal content distinguishes source disclosure, user assertion, and AI proposal, and records relationships, hypothesized effects, feasibility constraints, assumptions, experiments, sources, and labelled outside-field inspiration.
- Generated proposals never enter the extraction corpus. Saved revisions are immutable, optimistic-concurrency checked, and separately approved. Material edits preserve history and invalidate current assessments/briefs.

### D — office assessment

- `MINER_GATE` runs independently for IN, US, and EP.
- It runs up to four queries with 25 results each, family-deduplicates, maps up to 12 readable families, and retains one closest plus up to five secondary references.
- Queries, cutoff/search date, diagnostics, actual limits, depth/truncation, hashes, exact quotes, contradictions, missing evidence, and questions are persisted.
- Evidence mapping must pass exact contiguous-quote verification before office reasoning. A full match requires one dated reference supporting every element and relationship. Split references remain inventive-step evidence. Search/text/date uncertainty cannot become a definitive match.
- Results use only `SUPPORTED_FOR_REVIEW`, `CONDITIONAL`, `BLOCKED`, and `UNASSESSED`; there is no grant probability or “grantable” label.
- Versioned rule profiles are grounded separately in the Patents Act 1970, USPTO MPEP 2141/2106, and EPO Guidelines G-VII and persist their guidance with each result.

### E — briefs and handoffs

- `MINER_BRIEF` binds the exact field snapshot, proposal revision, office assessment, rules, and report model.
- Standard-scope claims reuse existing parsing/rule/form checks. Unsupported claim output is removed and replaced by questions; no embodiments, ranges, test results, or confirmations are invented.
- Conditional briefing requires a review note for that assessment. Rejected proposals and verified full matches require revision and reassessment.
- Screen and Word export use one report model and include office/revision IDs; historical runs remain stored.
- Opaque 30-minute handoffs bind user, tenant, target, office, proposal, and current results. Preview does not consume; submission rechecks freshness; compare-and-set consumption makes retries return the stored destination. No invention content appears in URLs.
- Novelty retains feature review. Drafting retains project/jurisdiction/review and receives editable, unfrozen preliminary claims with limitations separate.

## Schema and migration order

Apply additive migrations in order:

1. `prisma/migrations/20260914120000_miner_completion/migration.sql` — evidence/version fields, snapshots, extraction references, proposal/current pointers, operation records, and expanded handoffs.
2. `prisma/migrations/20260914150000_whitespace_worker_health/migration.sql` — worker heartbeat storage.

Then generate Prisma Client and run `npm run im:seed-stages`. Legacy results remain history and require a v2 harvest plus approved proposal before a current assessment.

## API contracts

- `POST /api/whitespace/studies/:studyId/miner/preflight`
- `POST /api/whitespace/studies/:studyId/miner/field-snapshots/:snapshotId/approve`
- `GET /api/whitespace/studies/:studyId/leads?page=&pageSize=` (default 24, maximum 100)
- `GET /api/whitespace/studies/:studyId/leads/:leadId`
- `POST /api/whitespace/studies/:studyId/leads/:leadId/proposals`
- `POST /api/whitespace/studies/:studyId/leads/:leadId/review`
- `POST /api/whitespace/studies/:studyId/runs` for propose, gate, brief, harvest, and engines
- `POST /api/whitespace/studies/:studyId/runs/:runId/cancel`
- `GET /api/whitespace/studies/:studyId/report?leadId=&office=`
- `POST /api/whitespace/studies/:studyId/leads/:leadId/handoffs`
- `GET|POST /api/whitespace/miner-handoffs/:token`
- `GET /api/health/whitespace-worker`

Mutation endpoints authenticate ownership/tenant, require MINER, check revisions/prerequisites, and use 409 for stale/duplicate work and 422 for recoverable prerequisites. Shared validated types live in `src/lib/whitespace/miner/contracts.ts`.

## Model configuration and accounting

`npm run im:seed-stages` registers these fail-closed Super Admin stages without replacing an administrator-selected model:

- `MINER_EXTRACT`, `MINER_LEAD_TITLES`, `MINER_PROPOSE`
- `MINER_RETRIEVAL_PLAN`, `MINER_EVIDENCE_MAP`
- `MINER_INVENTIVE_STEP`, `MINER_EXCLUSION_SCREEN`, `MINER_BRIEF`

Preflight is entitlement-checked but uncharged. One operation is reserved for each harvest, engines run, proposal-generation action, office assessment, and office brief. Identity includes the approved snapshot and algorithm/input version, plus lead/proposal/office/assessment where applicable. Paid retries remain resumable with no new-operation quota, but authentication, tenant, role, entitlement, and account checks remain enforced. Actual model usage is recorded separately from operation charging.

## Deployment and recovery

```text
INVENTION_MINER_ENABLED=false
WHITESPACE_WORKER_MODE=standalone
```

Use `WHITESPACE_WORKER_MODE=inline` locally, or `hybrid` only under intentional supervision. Run production work with `npm run ws:worker` and monitor `/api/health/whitespace-worker`; standalone health requires a heartbeat under 60 seconds old. Cancellation invalidates the worker completion fence while retaining completed cache/extraction work. Terminal failures release reservations and the same paid logical operation can resume.

Rollback is operational: set `INVENTION_MINER_ENABLED=false` to stop new Miner work while retaining history/exports. Do not reverse additive migrations during ordinary rollback.

## Verification evidence

Completed locally on 2026-09-15:

- Prisma validation/client generation, both migrations, migration-safety check, and model-stage seeding.
- TypeScript type check and optimized production build.
- Focused identity, extraction-evidence, citation-mutation, harvest, engine-integrity, and Standard claim-default tests.
- Full suite: 2,090 passed, 5 skipped, 4 failed. The four failures are outside Miner: three embedding-default assertions are overridden by this machine’s `.env`, and one billing-window fixture fixes a June date while the current date is September.

Before enabling the flag, capture release-environment evidence for:

- authenticated desktop/mobile walkthrough, reload, cancellation, retry, and recovery;
- visual inspection of an actual Word brief;
- real novelty/drafting submissions, including expiry, replay, double-submit, tenant isolation, and stale-form cases;
- reviewed IN/US/EP assessments for mechanical, software/control, and chemical/material fields;
- measured latency, token/model cost, citation validity, relevance, and coverage;
- healthy production worker and reviewed administrator model configuration.

Synthetic fixtures prove deterministic execution only, not real-world finding quality. Keep the feature flag off until these live release gates are signed off.

## Known limits

- Research is bounded by available patent corpus/search lanes; no new literature provider is included.
- Filing activity is an interest signal, not market-demand evidence.
- Preflight does not guess cache hits before exact source hashes exist; harvest reports actual reuse.
- First-release briefs are English; full specifications remain in the drafting workflow.
