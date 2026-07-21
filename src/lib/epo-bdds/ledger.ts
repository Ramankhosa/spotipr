// Resume ledger: one row per (product, delivery, file).
//
// This is what makes a multi-day backfill safe to kill and restart. A file at
// LOADED is never downloaded, parsed or loaded again, so re-running a completed
// slice is a no-op rather than a duplicate import.
//
// Raw SQL throughout, deliberately:
//   * the loader path needs bulk performance the query builder cannot give
//   * it matches the precedent in scripts/google-patents-import/
//   * it does not depend on `prisma generate` having run, which matters because
//     the Windows dev box intermittently holds a lock on the query engine

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { parseFileSliceInfo, parseDeliverySliceInfo } from './selector'
import { parseFileSize } from './catalog'
import type { BddsDelivery, BddsLane, ChecksumAlgorithm } from './types'

export type LedgerStatus = 'QUEUED' | 'DOWNLOADED' | 'VERIFIED' | 'LOADED' | 'FAILED' | 'SKIPPED'

export interface LedgerFile {
  id: string
  productId: number
  deliveryId: number
  fileId: number
  lane: string
  fileName: string
  sizeBytes: number | null
  checksum: string | null
  checksumAlgo: string | null
  authority: string | null
  pubYearFrom: number | null
  pubYearTo: number | null
  status: LedgerStatus
  attemptCount: number
}

/** Deterministic id, so re-syncing the catalogue updates rather than duplicates. */
const fileKey = (productId: number, deliveryId: number, fileId: number) =>
  `epof_${productId}_${deliveryId}_${fileId}`
const deliveryKey = (productId: number, deliveryId: number) => `epod_${productId}_${deliveryId}`

/**
 * Record the catalogue in the ledger. Idempotent: existing rows keep their
 * status (so a completed file stays LOADED) and only volatile metadata is
 * refreshed.
 */
export async function syncCatalog(
  productId: number,
  productName: string,
  lane: BddsLane,
  deliveries: BddsDelivery[]
): Promise<{ deliveries: number; files: number }> {
  let fileCount = 0

  for (const delivery of deliveries) {
    await prisma.$executeRaw`
      INSERT INTO "epo_bdds_delivery"
        ("id", "productId", "productName", "lane", "deliveryId", "deliveryName", "publishedAt", "expiresAt", "updatedAt")
      VALUES (
        ${deliveryKey(productId, delivery.deliveryId)}, ${productId}, ${productName}, ${lane},
        ${delivery.deliveryId}, ${delivery.deliveryName},
        ${delivery.deliveryPublicationDatetime ? new Date(delivery.deliveryPublicationDatetime) : null},
        ${delivery.deliveryExpiryDatetime ? new Date(delivery.deliveryExpiryDatetime) : null},
        now()
      )
      ON CONFLICT ("productId", "deliveryId") DO UPDATE SET
        "deliveryName" = EXCLUDED."deliveryName",
        "publishedAt"  = EXCLUDED."publishedAt",
        "expiresAt"    = EXCLUDED."expiresAt",
        "updatedAt"    = now()
    `

    // The delivery name is the fallback year source for products whose
    // filenames are opaque (EP full-text ships EPRTBJV… names).
    const deliverySlice = parseDeliverySliceInfo(delivery.deliveryName)

    for (const file of delivery.files ?? []) {
      const fileSlice = parseFileSliceInfo(file.fileName)
      const slice = fileSlice.pubYearFrom == null && fileSlice.pubYearTo == null
        ? { ...deliverySlice, authority: fileSlice.authority ?? deliverySlice.authority }
        : fileSlice

      await prisma.$executeRaw`
        INSERT INTO "epo_bdds_file"
          ("id", "productId", "deliveryId", "fileId", "lane", "fileName", "sizeBytes",
           "checksum", "authority", "pubYearFrom", "pubYearTo", "status", "updatedAt")
        VALUES (
          ${fileKey(productId, delivery.deliveryId, file.fileId)}, ${productId}, ${delivery.deliveryId},
          ${file.fileId}, ${lane}, ${file.fileName}, ${parseFileSize(file.fileSize)},
          ${file.fileChecksum || null}, ${slice.authority}, ${slice.pubYearFrom}, ${slice.pubYearTo},
          'QUEUED', now()
        )
        ON CONFLICT ("productId", "deliveryId", "fileId") DO UPDATE SET
          "fileName"    = EXCLUDED."fileName",
          "sizeBytes"   = EXCLUDED."sizeBytes",
          "checksum"    = EXCLUDED."checksum",
          "authority"   = EXCLUDED."authority",
          "pubYearFrom" = EXCLUDED."pubYearFrom",
          "pubYearTo"   = EXCLUDED."pubYearTo",
          "updatedAt"   = now()
      `
      fileCount++
    }
  }

  return { deliveries: deliveries.length, files: fileCount }
}

export interface PendingFilter {
  lane: BddsLane
  productId?: number
  fromYear?: number | null
  toYear?: number | null
  authorities?: string[] | null
  /**
   * Exclude files whose publication year could not be read from the name.
   *
   * MUST mirror SliceFilter.onlyDated in selector.ts. The dry run selects from
   * the live catalogue and the real run selects from the ledger; if only one of
   * them honours this flag, the dry run under-reports what the real run will do.
   * On EP full-text that is the difference between 316 GB and 4.1 TB.
   */
  onlyDated?: boolean
  /** Re-attempt files that previously failed. Default true. */
  includeFailed?: boolean
  limit?: number
}

/**
 * Files still to do, oldest publication year first.
 *
 * LOADED files are excluded — that is the resume guarantee. Files whose parsed
 * year falls outside the requested range are excluded too, so they are never
 * downloaded; a NULL year is included, because we cannot rule it out on the
 * filename and must filter at record level instead.
 */
export async function pendingFiles(filter: PendingFilter): Promise<LedgerFile[]> {
  const conditions: Prisma.Sql[] = [Prisma.sql`f."lane" = ${filter.lane}`]

  const statuses = filter.includeFailed === false
    ? ['QUEUED', 'DOWNLOADED', 'VERIFIED']
    : ['QUEUED', 'DOWNLOADED', 'VERIFIED', 'FAILED']
  conditions.push(Prisma.sql`f."status"::text = ANY(${statuses})`)

  if (filter.productId) conditions.push(Prisma.sql`f."productId" = ${filter.productId}`)
  if (filter.fromYear != null) {
    conditions.push(Prisma.sql`(f."pubYearTo" IS NULL OR f."pubYearTo" >= ${filter.fromYear})`)
  }
  if (filter.toYear != null) {
    conditions.push(Prisma.sql`(f."pubYearFrom" IS NULL OR f."pubYearFrom" <= ${filter.toYear})`)
  }
  if (filter.onlyDated && (filter.fromYear != null || filter.toYear != null)) {
    conditions.push(Prisma.sql`(f."pubYearFrom" IS NOT NULL OR f."pubYearTo" IS NOT NULL)`)
  }
  if (filter.authorities?.length) {
    const upper = filter.authorities.map(a => a.toUpperCase())
    conditions.push(Prisma.sql`(f."authority" IS NULL OR f."authority" = ANY(${upper}))`)
  }

  const limit = filter.limit ?? 100_000
  return prisma.$queryRaw<LedgerFile[]>(Prisma.sql`
    SELECT f."id", f."productId", f."deliveryId", f."fileId", f."lane", f."fileName",
           f."sizeBytes"::bigint AS "sizeBytes", f."checksum", f."checksumAlgo",
           f."authority", f."pubYearFrom", f."pubYearTo", f."status"::text AS "status",
           f."attemptCount"
    FROM "epo_bdds_file" f
    WHERE ${Prisma.join(conditions, ' AND ')}
    ORDER BY COALESCE(f."pubYearFrom", f."pubYearTo", 9999) ASC, f."fileId" ASC
    LIMIT ${limit}
  `)
}

export async function markStarted(id: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "epo_bdds_file"
    SET "status" = 'QUEUED', "attemptCount" = "attemptCount" + 1,
        "startedAt" = now(), "errorMessage" = NULL, "updatedAt" = now()
    WHERE "id" = ${id}
  `
}

export async function markDownloaded(id: string, bytes: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "epo_bdds_file"
    SET "status" = 'DOWNLOADED', "bytesDownloaded" = ${bytes}, "updatedAt" = now()
    WHERE "id" = ${id}
  `
}

export async function markVerified(id: string, algorithm: ChecksumAlgorithm): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "epo_bdds_file"
    SET "status" = 'VERIFIED', "checksumAlgo" = ${algorithm}, "updatedAt" = now()
    WHERE "id" = ${id}
  `
}

export async function markLoaded(id: string, recordsLoaded: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "epo_bdds_file"
    SET "status" = 'LOADED', "recordsLoaded" = ${recordsLoaded},
        "completedAt" = now(), "errorMessage" = NULL, "updatedAt" = now()
    WHERE "id" = ${id}
  `
}

export async function markFailed(id: string, message: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "epo_bdds_file"
    SET "status" = 'FAILED', "errorMessage" = ${message.slice(0, 1000)}, "updatedAt" = now()
    WHERE "id" = ${id}
  `
}

export async function markSkipped(id: string, reason: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "epo_bdds_file"
    SET "status" = 'SKIPPED', "errorMessage" = ${reason.slice(0, 1000)}, "updatedAt" = now()
    WHERE "id" = ${id}
  `
}

export interface LedgerSummary {
  status: string
  files: number
  records: number
  bytes: number
}

/** Per-status roll-up for the run report. */
export async function ledgerSummary(lane?: BddsLane): Promise<LedgerSummary[]> {
  const where = lane ? Prisma.sql`WHERE "lane" = ${lane}` : Prisma.empty
  return prisma.$queryRaw<LedgerSummary[]>(Prisma.sql`
    SELECT "status"::text AS "status",
           count(*)::int AS "files",
           COALESCE(sum("recordsLoaded"), 0)::int AS "records",
           COALESCE(sum("bytesDownloaded"), 0)::bigint AS "bytes"
    FROM "epo_bdds_file"
    ${where}
    GROUP BY "status"
    ORDER BY "status"
  `)
}
