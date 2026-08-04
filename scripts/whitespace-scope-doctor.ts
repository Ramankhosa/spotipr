/**
 * Whitespace scope doctor — answers "why did my field come back empty?".
 *
 * Rebuilds the scope predicate one clause at a time using the SAME helpers the
 * census uses, so the funnel it prints is the funnel the run saw. Two failure
 * modes it separates, which look identical from the error message alone:
 *
 *   1. The CORPUS is unreachable for this kind of query. The census requires a
 *      filing date and its text lanes only read the corpora with matching
 *      partial FTS indexes (google-patents-corpus, indian-corpus). Bulk EPO rows
 *      carry no filingDate, so a deployment whose corpus is mostly EPO returns
 *      zero for every concept scope, no matter how it is worded.
 *   2. The SCOPE is too narrow. Required concepts intersect, so each one
 *      multiplies the restriction; four required concepts can easily reach zero
 *      on a 30M-row corpus.
 *
 * Usage:
 *   npx tsx scripts/whitespace-scope-doctor.ts               # corpus reachability only
 *   npx tsx scripts/whitespace-scope-doctor.ts <studyId>     # plus that study's funnel
 */

import { Prisma, PrismaClient } from '@prisma/client'
import { buildConceptQuery, textMatchPredicate } from '../src/lib/whitespace/field-map'
import { CORPUS_FIRST_YEAR, type WhitespaceScope } from '../src/lib/whitespace/types'

const prisma = new PrismaClient()

/** Corpora the census text lanes can read — mirrors TEXT_CORPORA in field-map.ts. */
const TEXT_CORPORA = ['google-patents-corpus', 'indian-corpus']

async function count(where: Prisma.Sql): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT COUNT(DISTINCT COALESCE(lp."familyId", lp."publicationNumber"))::bigint AS n
    FROM "local_patents" lp
    WHERE ${where}`)
  return Number(rows[0]?.n ?? 0)
}

async function corpusReachability() {
  console.log('\n=== CORPUS REACHABILITY ===\n')

  const bySource = await prisma.$queryRaw<Array<{ source: string; rows: bigint; with_filing: bigint }>>(Prisma.sql`
    SELECT src AS source,
           COUNT(*)::bigint AS rows,
           COUNT(*) FILTER (WHERE lp."filingDate" IS NOT NULL)::bigint AS with_filing
    FROM "local_patents" lp, unnest(lp."corpusSources") src
    GROUP BY 1
    ORDER BY 2 DESC`)

  console.log('corpus tag                 rows          with filingDate   readable by census')
  console.log('-------------------------------------------------------------------------------')
  let readable = 0
  for (const row of bySource) {
    const isText = TEXT_CORPORA.includes(row.source)
    const usable = isText ? Number(row.with_filing) : 0
    readable += usable
    console.log(
      `${row.source.padEnd(26)} ${Number(row.rows).toLocaleString().padStart(12)}   ` +
        `${Number(row.with_filing).toLocaleString().padStart(14)}   ` +
        `${isText ? (Number(row.with_filing) ? 'yes' : 'no — none dated') : 'no — no text index'}`
    )
  }
  console.log('-------------------------------------------------------------------------------')
  console.log(`\nRows a concept scope can reach at all: ${readable.toLocaleString()}`)
  if (readable === 0) {
    console.log(
      '\n>>> This is the problem. No row carries BOTH a filing date and a corpus tag the\n' +
        '    text lanes index, so every concept-based scope returns zero — whitespace,\n' +
        "    field map and invention alike. Fix the ingest (backfill filingDate, or add a\n" +
        '    corpus tag + matching partial FTS index in field-map.ts TEXT_CORPORA)\n' +
        '    before debugging any individual scope.'
    )
  }
}

async function scopeFunnel(studyId: string) {
  const study = await prisma.whitespaceStudy.findUnique({ where: { id: studyId } })
  if (!study) {
    console.log(`\nNo study ${studyId}.`)
    return
  }
  const scope = study.scope as unknown as WhitespaceScope
  console.log(`\n=== SCOPE FUNNEL — "${study.title}" (${study.kind}, scope v${study.scopeVersion}) ===\n`)

  const yearFrom = Math.max(CORPUS_FIRST_YEAR, scope.filters.yearFrom)
  const dated = Prisma.sql`lp."filingDate" IS NOT NULL`
  const years = Prisma.sql`${dated}
    AND lp."filingDate" >= ${new Date(Date.UTC(yearFrom, 0, 1))}
    AND lp."filingDate" < ${new Date(Date.UTC(scope.filters.yearTo + 1, 0, 1))}`

  const steps: Array<[string, Prisma.Sql]> = [
    ['has a filing date', dated],
    [`filed ${yearFrom}-${scope.filters.yearTo}`, years],
  ]

  const cpc = scope.classifications
    .filter(c => c.accepted && c.code.trim())
    .map(c => c.code.replace(/\s+/g, '').toUpperCase())
  let running = years
  if (cpc.length) {
    const exact = Prisma.sql`lp."classifications" && ${cpc}::text[]`
    const prefixes = cpc.map(
      code => Prisma.sql`EXISTS (SELECT 1 FROM unnest(lp."classifications") c
        WHERE regexp_replace(upper(c), '[[:space:]]+', '', 'g') LIKE ${code + '%'})`
    )
    running = Prisma.sql`${running} AND (${Prisma.join([exact, ...prefixes], ' OR ')})`
    steps.push([`+ classifications (${cpc.join(', ')})`, running])
  }

  // Each required concept is its own AND group, so add them one at a time —
  // this is what shows exactly which concept empties the field.
  const required = scope.concepts.filter(c => c.required && c.label.trim())
  const conceptsToWalk = required.length ? required : scope.concepts.filter(c => c.label.trim())
  for (const concept of conceptsToWalk) {
    const plan = buildConceptQuery({ ...scope, concepts: [{ ...concept, required: true }] } as WhitespaceScope)
    if (!plan) continue
    running = Prisma.sql`${running} AND ${textMatchPredicate(plan)}`
    steps.push([`${required.length ? '+ required' : '+ concept'} "${concept.label.slice(0, 46)}"`, running])
  }

  if (scope.filters.jurisdictions.length) {
    running = Prisma.sql`${running} AND lp."country" = ANY(${scope.filters.jurisdictions}::text[])`
    steps.push([`+ jurisdictions (${scope.filters.jurisdictions.join(', ')})`, running])
  }

  let previous: number | null = null
  for (const [label, where] of steps) {
    const families = await count(where)
    const drop = previous !== null && previous > 0 ? ` (-${Math.round((1 - families / previous) * 100)}%)` : ''
    console.log(`${families.toLocaleString().padStart(12)} families  ${label}${drop}`)
    if (families === 0 && previous !== 0) {
      console.log(`\n>>> The field empties here. ${
        label.startsWith('+ required')
          ? 'Required concepts INTERSECT — every one must appear in the same document.\n    Un-require this concept (or reword its synonyms) and the field reopens.'
          : 'Relax or remove this filter.'
      }`)
    }
    previous = families
  }

  if (!required.length && conceptsToWalk.length > 1) {
    console.log(
      '\nNote: no concept is marked required, so the real census unions them rather than\n' +
        'intersecting. The walk above is therefore stricter than the run — use it to see\n' +
        'which individual concepts match nothing.'
    )
  }
}

async function main() {
  await corpusReachability()
  const studyId = process.argv[2]
  if (studyId) await scopeFunnel(studyId)
  else console.log('\nPass a studyId to also walk that study\'s scope funnel.')
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
