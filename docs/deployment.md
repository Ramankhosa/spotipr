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
