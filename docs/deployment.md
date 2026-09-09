# Deploying to production

Production runs `next start -p 3005` under pm2 (process `patentnest`), serving the
build output in `dist/`.

## Never run `npm run build` on the live box

`next build` deletes its output directory in the first seconds and rewrites it over
the next few minutes. Building straight into the live `dist/` breaks the site for the
whole build, and keeps it broken afterwards:

- pm2 still shows `online` and port 3005 still accepts connections — there is no
  "connection refused", so monitoring looks fine while users see errors.
- `/_next/static/...` 404s immediately → chunk-load errors and blank pages.
- Routes Node has not already `require`d are read lazily off disk → 500s. Warm routes
  keep working, so the failures look random.
- Prerendered HTML / RSC payloads / ISR entries under `dist/server/app` disappear.
- When the build finishes, the running process still holds the **old** `BUILD_ID` and
  keeps emitting `/_next/static/<old-id>/…` URLs that no longer exist. Only a restart
  fixes it.

## Use the deploy script

```bash
./scripts/deploy.sh --workers "patentnest-novelty-worker"
```

or `npm run deploy`. It:

1. copies `dist/cache` into `dist-new/cache` so the side-by-side build isn't cold;
2. runs `prisma generate` (nothing else in the deploy does, and new enum values throw
   at runtime until it has run);
3. builds with `NEXT_DIST_DIR=dist-new` — the live `dist/` is untouched and the site
   keeps serving normally for the entire build;
4. renames `dist → dist-old` and `dist-new → dist`, then `pm2 restart patentnest`;
5. polls `/_next/static/<new BUILD_ID>/_buildManifest.js` until the restarted server
   serves the new build, and rolls back to `dist-old` if it never does;
6. restarts any workers passed via `--workers` (they run from source via `tsx`, so
   they need no build — only a restart to pick up new code).

The unserved window is the restart alone (~2s), not the build.

Environment overrides: `APP_NAME` (default `patentnest`), `PORT` (default `3005`),
`WORKERS`, `HEALTH_TIMEOUT` (default 60s).

### Rolling back manually

The previous build stays in `dist-old`:

```bash
rm -rf dist-new && mv dist dist-new && mv dist-old dist && pm2 restart patentnest
```

## `NEXT_DIST_DIR` must never go in `.env`

`next.config.js` reads `process.env.NEXT_DIST_DIR || 'dist'`, and `next start` reads
that same config. If the variable is set for the running process, the live server
would serve the staging directory. The deploy script sets it only for the build
command, and aborts if it finds `NEXT_DIST_DIR` in `.env`.

## Truly zero downtime

Eliminating the ~2s restart needs two instances on different ports behind the reverse
proxy (start the new build on port B, flip the upstream, stop port A). That is not set
up today; the swap-and-restart above is the current deploy.

## Claim drafting: office rules, strategy stage and base prompt

The preliminary-claims stage now resolves a structured claim-rule profile per
office (`src/lib/claim-rules`), plans the claim set in a background LLM stage
(`DRAFT_CLAIM_STRATEGY`), validates and repairs claim form after generation,
and reads its base prompt from `Countries/prompts/claims-base.v2.md`. No Prisma
schema change is involved (everything new lives in `IdeaRecord.normalizedData`),
so the normal deploy applies; then, in this order:

1. `node scripts/add-claim-strategy-stage.js` — registers the `DRAFT_CLAIM_STRATEGY`
   workflow stage and mirrors a model config from `DRAFT_CLAIM_GENERATION` for
   every plan. Stage-coded model resolution fails closed: until this has run,
   every strategy run logs `CONFIGURATION_ERROR` and the claims stage drafts
   without a strategy (it still works, with a "Preparing claim strategy" step).
2. `node scripts/sync-claims-base-prompt.js` (dry run) then `--apply` — pushes
   the v2 base prompt into `SupersetSection('claims')`. Verify in Super Admin
   that the claims prompt preview starts with `CLAIMS-BASE-V2`, then clear the
   section-prompt cache (or wait two minutes).
3. Import the updated country profiles for IN, US, EP and PCT (their claims
   top-ups and `rules.claims` fields changed) through Super Admin → Countries →
   Import, or edit the four claims top-ups by hand. Never run
   `Countries/MasterSeed.js --force` on a live database to push a prompt: it
   reseeds every section and every country.
4. Optional environment flags: `CLAIM_FORM_REPAIR_ENABLED=false` disables the
   automatic office-form repair pass (findings are still reported);
   `CLAIM_STRATEGY_BACKGROUND=false` disables the background strategy job (the
   claims stage then plans inline). Both need a restart to change.

Rollback: the runtime tolerates the v1 prompt and an unregistered strategy
stage, so reverting the code alone is safe; the two scripts are idempotent.
