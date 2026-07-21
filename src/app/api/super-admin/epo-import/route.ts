import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { DiskGuard, describeSnapshot } from '@/lib/epo-bdds/disk-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Read-only status for the EPO BDDS import (src/lib/epo-bdds).
 *
 * Deliberately has no POST: a backfill moves hundreds of GB over hours or days,
 * which a web request cannot own. Runs are started from the CLI
 * (scripts/epo-bdds-import/cli.ts) under tmux; this endpoint only reports.
 */
async function verifySuperAdmin(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return { error: NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 }) }
  }
  const roles = auth.user.roles || []
  if (!roles.includes('SUPER_ADMIN') && !roles.includes('SUPER_ADMIN_VIEWER')) {
    return { error: NextResponse.json({ error: 'Super admin access required' }, { status: 403 }) }
  }
  return { user: auth.user }
}

/** Every query is wrapped: the epo_* tables do not exist until the migration is
 *  deployed, and a missing table must render an empty panel, not a 500. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

export async function GET(request: NextRequest) {
  const auth = await verifySuperAdmin(request)
  if (auth.error) return auth.error

  const [ledger, coverage, recentFiles, failures, textProvenance, epFullText] = await Promise.all([
    safe(() => prisma.$queryRaw<Array<{ lane: string; status: string; files: number; records: number; bytes: bigint }>>`
      SELECT "lane", "status"::text AS "status",
             count(*)::int AS "files",
             COALESCE(sum("recordsLoaded"), 0)::int AS "records",
             COALESCE(sum("bytesDownloaded"), 0)::bigint AS "bytes"
      FROM "epo_bdds_file"
      GROUP BY "lane", "status"
      ORDER BY "lane", "status"
    `, []),

    safe(() => prisma.$queryRaw<Array<{ publicationYear: number; status: string; loadedDocs: number; expectedDocs: number | null; textPolicy: string | null }>>`
      SELECT "publicationYear", "status"::text AS "status", "loadedDocs", "expectedDocs", "textPolicy"
      FROM "epo_ep_coverage"
      ORDER BY "publicationYear" DESC
    `, []),

    safe(() => prisma.$queryRaw<Array<{ fileName: string; lane: string; status: string; recordsLoaded: number; completedAt: Date | null }>>`
      SELECT "fileName", "lane", "status"::text AS "status", "recordsLoaded", "completedAt"
      FROM "epo_bdds_file"
      WHERE "status" IN ('LOADED', 'FAILED')
      ORDER BY COALESCE("completedAt", "updatedAt") DESC
      LIMIT 15
    `, []),

    safe(() => prisma.$queryRaw<Array<{ fileName: string; attemptCount: number; errorMessage: string | null }>>`
      SELECT "fileName", "attemptCount", "errorMessage"
      FROM "epo_bdds_file"
      WHERE "status" = 'FAILED'
      ORDER BY "updatedAt" DESC
      LIMIT 10
    `, []),

    // How much of the corpus now has claims, and from where. The legacy branch
    // (marker NULL, text present) is the Google US first-claim.
    safe(() => prisma.$queryRaw<Array<{ source: string; rows: number }>>`
      SELECT COALESCE("claimsCompleteness", 'FIRST_CLAIM_ONLY (legacy)') AS "source",
             count(*)::int AS "rows"
      FROM "local_patents"
      WHERE "claimsText" IS NOT NULL AND "claimsText" <> ''
      GROUP BY 1
      ORDER BY 2 DESC
    `, []),

    safe(() => prisma.$queryRaw<Array<{ rows: number; withClaims: number; withDescription: number; created: number }>>`
      SELECT (SELECT count(*)::int FROM "epo_ep_fulltext") AS "rows",
             (SELECT count(*)::int FROM "epo_ep_fulltext" WHERE "claimsComplete") AS "withClaims",
             (SELECT count(*)::int FROM "epo_ep_fulltext" WHERE "descriptionText" IS NOT NULL) AS "withDescription",
             (SELECT count(*)::int FROM "local_patents" WHERE 'epo-ep-fulltext' = ANY("corpusSources")) AS "created"
    `, []),
  ])

  const disk = await safe(async () => {
    const guard = new DiskGuard(process.env.EPO_DATA_DIR || process.cwd())
    const snapshot = await guard.snapshot()
    return { ...snapshot, summary: describeSnapshot(snapshot) }
  }, null)

  return NextResponse.json({
    // BigInt is not JSON-serialisable; bytes are returned as strings.
    ledger: ledger.map(row => ({ ...row, bytes: String(row.bytes) })),
    coverage,
    recentFiles,
    failures,
    textProvenance,
    epFullText: epFullText[0] ?? null,
    disk,
    migrationApplied: ledger.length > 0 || coverage.length > 0 || Boolean(epFullText[0]),
  })
}
