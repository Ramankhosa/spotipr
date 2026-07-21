import { Prisma } from '@prisma/client'
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
export async function fetchLocalPatentClaims(publicationNumbers: string[]): Promise<Map<string, string>> {
  const claims = new Map<string, string>()

  const exactValues = new Set<string>()
  const compactValues = new Set<string>()
  for (const publicationNumber of publicationNumbers) {
    const raw = String(publicationNumber || '').trim()
    if (!raw || !canonicalClaimsKey(raw)) continue
    exactValues.add(raw)
    exactValues.add(raw.toUpperCase())
    const compact = compactPublicationKey(raw)
    if (compact) compactValues.add(compact)
  }
  if (!exactValues.size && !compactValues.size) return claims

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
      }>>(Prisma.sql`
        SELECT p."publicationNumber", p."claimsText",
               -- An explicit marker means we wrote it and recorded what it is;
               -- NULL means legacy, which today can only be the Google US
               -- first-claim. No join needed: the EP import fills this column
               -- directly, so the IN-list index scan is unchanged.
               COALESCE(p."claimsCompleteness", 'FIRST_CLAIM_ONLY') AS "claimsAvailability"
        FROM "local_patents" p
        WHERE (${Prisma.join(conditions, ' OR ')})
          AND p."claimsText" IS NOT NULL
          AND p."claimsText" <> ''
      `),
    ])

    for (const row of rows) {
      const key = canonicalClaimsKey(row?.publicationNumber)
      const text = String(row?.claimsText || '').trim()
      // A family can surface under several kind codes; keep the first non-empty hit.
      if (key && text && !claims.has(key)) claims.set(key, text)
    }
  } catch (error) {
    console.warn('[LocalPatentClaims] Claims lookup failed; continuing without claims text.',
      error instanceof Error ? error.message : error)
  }

  return claims
}
