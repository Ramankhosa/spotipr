import './load-env'
import { prisma } from '../src/lib/prisma'
import { parseApplicationNumber } from '../src/lib/patent-corpus-extractor'
import { normalizePatentNumberKey } from '../src/lib/patent-number'

/**
 * Re-derives publicationNumber for Indian-corpus rows whose application number
 * carries a regional office code (DEL/MUM/CHE/KOL/MAS/...).
 *
 * Why: publicationNumber used to be built from the application number's digits
 * alone, so 1456/CHE/2009 and 1456/KOL/2009 both became IN14562009A. Two unrelated
 * patents then shared one public identifier and
 * GET /api/v1/patents/IN14562009A returned whichever row came back first.
 *
 * This MUST run in the same window as the extractor fix. Deploying the extractor
 * without backfilling means a re-import of an existing patent lands under the new
 * identifier while the old row keeps the old one — i.e. duplicates.
 *
 * publicationNumber is a public identifier: clients that stored the old value will
 * need the new one. Dry-run is the default; pass --apply to write.
 *
 *   npx tsx scripts/backfill-indian-publication-numbers.ts            # report only
 *   npx tsx scripts/backfill-indian-publication-numbers.ts --apply    # write
 */

const BATCH = Math.max(100, Number(process.env.BACKFILL_BATCH || '2000') || 2000)

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`[BackfillPubNumbers] mode=${apply ? 'APPLY' : 'DRY-RUN'} batch=${BATCH}`)

  let cursor: number | null = null
  let scanned = 0
  let changed = 0
  let unchanged = 0
  let unparsed = 0
  const proposed = new Map<string, number[]>()
  const samples: Array<{ id: number; app: string; from: string; to: string }> = []

  for (;;) {
    const rows: Array<{
      id: number
      publicationNumber: string
      applicationNumberRaw: string | null
    }> = await prisma.localPatent.findMany({
      where: {
        corpusSources: { has: 'indian-corpus' },
        applicationNumberRaw: { not: null },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, publicationNumber: true, applicationNumberRaw: true },
      orderBy: { id: 'asc' },
      take: BATCH,
    })
    if (!rows.length) break
    cursor = rows[rows.length - 1].id
    scanned += rows.length

    for (const row of rows) {
      const app = String(row.applicationNumberRaw || '')
      // Only legacy office-code numbers are affected; all-digit numbers already
      // derive identically under the old and new rules.
      if (!/[A-Za-z]{2,}/.test(app)) { unchanged += 1; continue }
      const derived = parseApplicationNumber(`(21) Application No: ${app}`)
      if (!derived.publicationNumber) { unparsed += 1; continue }
      if (derived.publicationNumber === row.publicationNumber) { unchanged += 1; continue }

      changed += 1
      const list = proposed.get(derived.publicationNumber) || []
      list.push(row.id)
      proposed.set(derived.publicationNumber, list)
      if (samples.length < 10) {
        samples.push({ id: row.id, app, from: row.publicationNumber, to: derived.publicationNumber })
      }

      if (apply) {
        await prisma.localPatent.update({
          where: { id: row.id },
          data: {
            publicationNumber: derived.publicationNumber,
            publicationNumberKey: normalizePatentNumberKey(derived.publicationNumber),
            ...(derived.kind ? { kind: derived.kind } : {}),
          },
        })
      }
    }
    console.log(`[BackfillPubNumbers] scanned=${scanned} changed=${changed}`)
  }

  // A new identifier colliding with itself would mean the office code is not enough
  // to disambiguate — surface it instead of silently creating a duplicate.
  const collisions = Array.from(proposed.entries()).filter(([, ids]) => ids.length > 1)

  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY-RUN',
    scanned,
    changed,
    unchanged,
    unparsed,
    remainingCollisions: collisions.length,
    collisionSamples: collisions.slice(0, 5).map(([number, ids]) => ({ number, ids })),
    samples,
  }, null, 2))

  if (collisions.length) {
    console.warn('[BackfillPubNumbers] Some derived numbers are still not unique — investigate before applying.')
  }
  if (!apply) console.log('[BackfillPubNumbers] Dry run only. Re-run with --apply to write.')
}

main()
  .catch(error => {
    console.error('[BackfillPubNumbers] Failed:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
