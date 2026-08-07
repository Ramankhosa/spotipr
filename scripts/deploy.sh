#!/usr/bin/env bash
#
# Zero-build-outage deploy.
#
# `next build` wipes its output directory in the first seconds of the build and
# rewrites it over the next few minutes. Building straight into the live `dist`
# therefore breaks the running server for the whole build (404s on /_next/static,
# 500s on any route not already in Node's require cache) — and it stays broken
# after the build finishes, because the process still holds the old BUILD_ID.
#
# This script builds into `dist-new`, swaps it into place with two renames, and
# restarts pm2. The only unserved window is the restart (~2s).
#
# Usage (from the repo root, on the prod box):
#   ./scripts/deploy.sh
#   ./scripts/deploy.sh --workers "patentnest-novelty-worker patentnest-drafting-worker"
#   APP_NAME=patentnest PORT=3005 ./scripts/deploy.sh
#
# Rolls back to the previous build automatically if the new one fails to serve.

set -euo pipefail

cd "$(dirname "$0")/.."

APP_NAME="${APP_NAME:-patentnest}"
PORT="${PORT:-3005}"
WORKERS="${WORKERS:-}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"

LIVE_DIR=dist
BUILD_DIR=dist-new
PREV_DIR=dist-old

while [ $# -gt 0 ]; do
  case "$1" in
    --workers) WORKERS="$2"; shift 2 ;;
    --app)     APP_NAME="$2"; shift 2 ;;
    --port)    PORT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n=== %s\n' "$1"; }

# `next start` reads next.config.js too. If NEXT_DIST_DIR is set for the running
# process (typically via .env), the live server would serve the staging build.
if [ -f .env ] && grep -qE '^\s*NEXT_DIST_DIR=' .env; then
  echo "NEXT_DIST_DIR is set in .env — remove it. It must only be set for the build." >&2
  exit 1
fi

# --- build into the staging directory; the live one is untouched -------------
say "Building into $BUILD_DIR (live $LIVE_DIR still serving)"

rm -rf "$BUILD_DIR"

# Carry the webpack/SWC cache over so the side-by-side build isn't a cold one.
if [ -d "$LIVE_DIR/cache" ]; then
  mkdir -p "$BUILD_DIR"
  cp -r "$LIVE_DIR/cache" "$BUILD_DIR/cache"
fi

# The build embeds the generated Prisma client; nothing else in the deploy runs
# this, so new enum values throw at runtime until it does.
npx prisma generate

NEXT_DIST_DIR="$BUILD_DIR" npx next build

if [ ! -f "$BUILD_DIR/BUILD_ID" ]; then
  echo "Build produced no $BUILD_DIR/BUILD_ID — aborting, live build untouched." >&2
  exit 1
fi
NEW_BUILD_ID="$(cat "$BUILD_DIR/BUILD_ID")"

# --- swap + restart: this is the entire outage -------------------------------
say "Swapping in build $NEW_BUILD_ID and restarting $APP_NAME"

rm -rf "$PREV_DIR"
HAVE_PREV=0
if [ -d "$LIVE_DIR" ]; then
  mv "$LIVE_DIR" "$PREV_DIR"
  HAVE_PREV=1
fi
mv "$BUILD_DIR" "$LIVE_DIR"

pm2 restart "$APP_NAME" --update-env

# --- verify the restarted server is actually serving the new build -----------
rollback() {
  if [ "$HAVE_PREV" -eq 1 ]; then
    say "Rolling back to the previous build"
    rm -rf "$BUILD_DIR"
    mv "$LIVE_DIR" "$BUILD_DIR"
    mv "$PREV_DIR" "$LIVE_DIR"
    pm2 restart "$APP_NAME" --update-env
    echo "Rolled back. The failed build is in $BUILD_DIR." >&2
  else
    echo "No previous build to roll back to." >&2
  fi
  exit 1
}

say "Waiting for $APP_NAME to serve build $NEW_BUILD_ID"
probe="http://127.0.0.1:$PORT/_next/static/$NEW_BUILD_ID/_buildManifest.js"
deadline=$((SECONDS + HEALTH_TIMEOUT))
until [ "$(curl -s -o /dev/null -w '%{http_code}' "$probe" || true)" = "200" ]; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "Server did not serve build $NEW_BUILD_ID within ${HEALTH_TIMEOUT}s." >&2
    pm2 logs "$APP_NAME" --lines 40 --nostream || true
    rollback
  fi
  sleep 1
done

# --- workers run from source via tsx, so they only need a restart ------------
if [ -n "$WORKERS" ]; then
  say "Restarting workers: $WORKERS"
  # shellcheck disable=SC2086
  pm2 restart $WORKERS --update-env
fi

say "Deployed build $NEW_BUILD_ID. Previous build kept in $PREV_DIR."
