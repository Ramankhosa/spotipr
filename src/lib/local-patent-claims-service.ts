import { Prisma } from '@prisma/client'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'

// Claims lookup for shortlisted prior-art candidates, served from the local corpus.
//
// local_patents."claimsText" is populated by two importers:
//   - the Google Patents bulk load, which stores the first (broadest independent)
//     claim for US publications — the public dataset carries no claims for other
//     countries;
//   - the EPO BDDS EP full-text import (src/lib/epo-bdds), which fills FULL claims
//     for EP publications that had none. It is strictly NULL-fill: a row that
//     already carried claims is never overwritten.
//
// Coverage is therefore uneven, and the rows differ in KIND as well as presence: a
// US row holds one independent claim, an EP row holds the complete set. That
// difference is now reported as `claimsAvailability` so callers can surface it
// instead of treating a one-claim stub and a 15-claim specification alike.
//
// Provenance rules (migration 20260721120000):
//   claimsCompleteness NOT NULL -> we wrote it; the value says exactly what it is
//   claimsCompleteness NULL     -> legacy, i.e. the Google US first-claim
//
// NOTE Indian rows hold title + abstract only; the IPIndia pipeline does not
// currently populate claims, despite what this comment previously asserted.

const CLAIMS_LOOKUP_STATEMENT_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.NOVELTY_CLAIMS_LOOKUP_TIMEOUT_MS || '8000') || 8000
)

export type LocalPatentClaimsCompleteness = 'FULL' | 'FIRST_CLAIM_ONLY' | 'PARTIAL'

export interface LocalPatentClaimEvidence {
  publicationNumber: string
  text: string
  completeness: LocalPatentClaimsCompleteness
  source: string
  contentHash: string
}

export interface LocalPatentClaimLookupResult {
  records: Map<string, LocalPatentClaimEvidence>
  status: 'complete' | 'failed'
  checked: number
  error?: string
}

function normalizeClaimsCompleteness(value: unknown): LocalPatentClaimsCompleteness {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'FULL' || normalized === 'FULL_EPO' || normalized === 'COMPLETE') return 'FULL'
  if (normalized === 'FIRST_CLAIM_ONLY' || normalized === 'FIRST_CLAIM') return 'FIRST_CLAIM_ONLY'
  return 'PARTIAL'
}

function completenessRank(value: LocalPatentClaimsCompleteness): number {
  if (value === 'FULL') return 3
  if (value === 'PARTIAL') return 2
  return 1
}

/** Compact, kind-code-stripped form used as the join key across the novelty pipeline. */
export function canonicalClaimsKey(publicationNumber: unknown): string {
  const compact = String(publicationNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!compact || compact.startsWith('PAPER')) return ''
  const kindSuffixMatch = compact.match(/^(.+\d)[A-Z]\d?$/)
  return kindSuffixMatch?.[1] || compact
}

/** Compact form that keeps the kind code — matches local_patents."publicationNumberKey". */
function compactPublicationKey(publicationNumber: unknown): string {
  return String(publicationNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Fetch claims text for the given publications from the local corpus, keyed by
 * canonical publication number.
 *
 * Lookups go through `publicationNumber` and `publicationNumberKey`, both of which
 * carry unique indexes — matching on a computed kind-stripped expression instead
 * would sequential-scan the ~45M-row corpus. Failures are non-fatal: an empty map
 * is returned so the pipeline continues on title/abstract evidence alone.
 */
export async function fetchLocalPatentClaimEvidence(publicationNumbers: string[]): Promise<LocalPatentClaimLookupResult> {
  const records = new Map<string, LocalPatentClaimEvidence>()
  const exactValues = new Set<string>()
  const compactValues = new Set<string>()
  const checkedKeys = new Set<string>()
  for (const publicationNumber of publicationNumbers) {
    const raw = String(publicationNumber || '').trim()
    const canonicalKey = canonicalClaimsKey(raw)
    if (!raw || !canonicalKey) continue
    checkedKeys.add(canonicalKey)
    exactValues.add(raw)
    exactValues.add(raw.toUpperCase())
    const compact = compactPublicationKey(raw)
    if (compact) compactValues.add(compact)
  }
  if (!exactValues.size && !compactValues.size) {
    return { records, status: 'complete', checked: 0 }
  }

  try {
    const conditions: Prisma.Sql[] = []
    if (exactValues.size) {
      conditions.push(Prisma.sql`p."publicationNumber" IN (${Prisma.join(
        Array.from(exactValues).map(value => Prisma.sql`${value}`), ', '
      )})`)
    }
    if (compactValues.size) {
      conditions.push(Prisma.sql`p."publicationNumberKey" IN (${Prisma.join(
        Array.from(compactValues).map(value => Prisma.sql`${value}`), ', '
      )})`)
    }

    const [, rows] = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(CLAIMS_LOOKUP_STATEMENT_TIMEOUT_MS)}, true)`,
      prisma.$queryRaw<Array<{
        publicationNumber: string
        claimsText: string | null
        claimsAvailability: string | null
        claimsSource: string | null
      }>>(Prisma.sql`
        SELECT p."publicationNumber",
               CASE
                 WHEN eft."claimsComplete" AND eft."claimsText" IS NOT NULL THEN eft."claimsText"
                 ELSE COALESCE(p."claimsText", eft."claimsText")
               END AS "claimsText",
               CASE
                 WHEN eft."claimsComplete" AND eft."claimsText" IS NOT NULL THEN 'FULL'
                 WHEN p."claimsText" IS NOT NULL THEN COALESCE(p."claimsCompleteness", 'FIRST_CLAIM_ONLY')
                 ELSE 'PARTIAL'
               END AS "claimsAvailability",
               CASE
                 WHEN eft."claimsComplete" AND eft."claimsText" IS NOT NULL THEN 'epo-ep-fulltext'
                 ELSE COALESCE(p."claimsSource", 'legacy-local-corpus')
               END AS "claimsSource"
        FROM "local_patents" p
        LEFT JOIN "epo_ep_fulltext" eft
          ON eft."publicationNumberKey" = p."publicationNumberKey"
        WHERE (${Prisma.join(conditions, ' OR ')})
          AND COALESCE(p."claimsText", eft."claimsText") IS NOT NULL
          AND COALESCE(p."claimsText", eft."claimsText") <> ''
      `),
    ])

    for (const row of rows) {
      const key = canonicalClaimsKey(row?.publicationNumber)
      const text = String(row?.claimsText || '').trim()
      const completeness = normalizeClaimsCompleteness(row?.claimsAvailability)
      const existing = records.get(key)
      // A family can surface under several kind codes. Prefer the most complete
      // deterministic record instead of depending on database row order.
      if (key && text && (!existing || completenessRank(completeness) > completenessRank(existing.completeness))) {
        records.set(key, {
          publicationNumber: String(row.publicationNumber || '').trim(),
          text,
          completeness,
          source: String(row.claimsSource || 'local-corpus'),
          contentHash: crypto.createHash('sha256').update(text).digest('hex'),
        })
      }
    }
    return { records, status: 'complete', checked: checkedKeys.size }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[LocalPatentClaims] Claims lookup failed; continuing without claims text.',
      message)
    return { records, status: 'failed', checked: checkedKeys.size, error: message }
  }
}

export async function fetchLocalPatentClaims(publicationNumbers: string[]): Promise<Map<string, string>> {
  const result = await fetchLocalPatentClaimEvidence(publicationNumbers)
  const claims = new Map<string, string>()
  for (const [key, record] of Array.from(result.records.entries())) claims.set(key, record.text)
  return claims
}
