/**
 * Whitespace Studio — stage 1, the field census.
 *
 * Pure SQL over the local corpus. No language model touches any number here,
 * which is what makes the landscape reproducible: same scope, same corpus, same
 * answer. The census is decomposed into independent facet queries, each under
 * its own statement timeout, so one slow facet degrades to a gap in the result
 * rather than failing the run.
 *
 * Counting conventions, fixed here and declared in every export:
 *   - Families, not publications. COALESCE("familyId", "publicationNumber").
 *   - Filing year, because it approximates R&D timing (WIPO Pub. 946 §8.3.4).
 *   - Recent years are NOT truncated. The ~18-month publication lag is marked
 *     so the reader can see the convention instead of inheriting it silently.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { FieldMapResult, LabelledCount, TextCoverage, WhitespaceScope, YearCount } from './types'
import { CORPUS_FIRST_YEAR } from './types'

/** Per-facet ceiling. A facet that overruns is reported as unavailable, not fatal. */
const FACET_TIMEOUT_MS = 20_000
/** Assignee extraction reads a JSON column, so it runs over a capped sample. */
const ASSIGNEE_SAMPLE_CAP = 25_000
export const PUBLICATION_LAG_MONTHS = 18

async function facet<T>(query: Prisma.Sql, timeoutMs = FACET_TIMEOUT_MS): Promise<T[]> {
  // Sequential transaction rather than an interactive one: Prisma's interactive
  // default expires at 5s, well under the statement timeout we want to allow.
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`,
    prisma.$queryRaw<T[]>(query),
  ])
  return rows
}

/** Runs a facet, converting failure into a null so one bad facet cannot fail the census. */
async function optionalFacet<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (error) {
    console.error(`[Whitespace] Facet "${label}" failed:`, error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * Builds the websearch tsquery for the scope's concepts.
 *
 * websearch_to_tsquery treats whitespace as AND and understands OR and leading
 * "-" for negation. Required concepts are ANDed; each concept's synonyms are
 * ORed within a parenthesised group; exclusions become negated terms.
 *
 * Returns null when the scope has no usable text, in which case retrieval falls
 * back to classification only.
 */
export function buildConceptQuery(scope: WhitespaceScope): string | null {
  const quote = (value: string) => `"${value.replace(/["\\]/g, ' ').trim()}"`

  const groups: string[] = []
  for (const concept of scope.concepts) {
    const terms = [concept.label, ...concept.synonyms].map(t => t.trim()).filter(Boolean)
    if (!terms.length) continue
    const group = terms.map(quote).join(' OR ')
    groups.push(terms.length > 1 ? `(${group})` : group)
  }
  if (!groups.length) return null

  const negations = scope.exclusions
    .map(e => e.term.trim())
    .filter(Boolean)
    .map(term => `-${quote(term)}`)

  return [...groups, ...negations].join(' ')
}

/** Accepted CPC codes, normalised. Empty means "no classification constraint". */
function acceptedCpc(scope: WhitespaceScope): string[] {
  return scope.classifications
    .filter(c => c.accepted && c.code.trim())
    .map(c => c.code.replace(/\s+/g, '').toUpperCase())
}

/**
 * The scope predicate.
 *
 * Every branch is index-backed: classifications by the GIN array index, dates by
 * the filingDate btree, and the concept match by the partial FTS index — whose
 * expression this reproduces exactly, including the corpusSources predicate the
 * planner needs in order to choose it.
 */
export function buildScopeFilter(scope: WhitespaceScope): Prisma.Sql {
  const clauses: Prisma.Sql[] = [Prisma.sql`lp."filingDate" IS NOT NULL`]

  const yearFrom = Math.max(CORPUS_FIRST_YEAR, scope.filters.yearFrom)
  clauses.push(Prisma.sql`lp."filingDate" >= ${new Date(Date.UTC(yearFrom, 0, 1))}`)
  clauses.push(Prisma.sql`lp."filingDate" < ${new Date(Date.UTC(scope.filters.yearTo + 1, 0, 1))}`)

  const cpc = acceptedCpc(scope)
  if (cpc.length) {
    // Prefix match: A61B5 must also capture A61B5/1455. Postgres cannot use the
    // GIN array index for a prefix test, so we OR an exact-overlap test (index
    // eligible) with a prefix test over the same array.
    const exact = Prisma.sql`lp."classifications" && ${cpc}::text[]`
    const prefixes = cpc.map(
      code => Prisma.sql`EXISTS (SELECT 1 FROM unnest(lp."classifications") c WHERE c LIKE ${code + '%'})`
    )
    clauses.push(Prisma.sql`(${Prisma.join([exact, ...prefixes], ' OR ')})`)
  }

  const conceptQuery = buildConceptQuery(scope)
  if (conceptQuery) {
    clauses.push(
      Prisma.sql`to_tsvector('english'::regconfig,
        coalesce(lp."ragText", '')   || ' ' ||
        coalesce(lp."title", '')     || ' ' ||
        coalesce(lp."abstract", '')  || ' ' ||
        coalesce(lp."abstractOriginal", ''))
        @@ websearch_to_tsquery('english'::regconfig, ${conceptQuery})`
    )
    // Required by the partial index predicate; without it the planner will not
    // choose local_patents_google_search_tsv_idx.
    clauses.push(Prisma.sql`lp."corpusSources" @> ARRAY['google-patents-corpus']::TEXT[]`)
  }

  if (scope.filters.jurisdictions.length) {
    clauses.push(Prisma.sql`lp."country" = ANY(${scope.filters.jurisdictions}::text[])`)
  }

  return Prisma.join(clauses, ' AND ')
}

const FAMILY_KEY = Prisma.sql`COALESCE(lp."familyId", lp."publicationNumber")`

function toLabelled(rows: Array<{ label: string | null; families: bigint | number }>): LabelledCount[] {
  return rows
    .filter(r => r.label)
    .map(r => ({ label: String(r.label), families: Number(r.families) }))
}

/**
 * Canonicalises an applicant string for grouping.
 *
 * Deliberately conservative: uppercase, strip punctuation and the common legal
 * suffixes, collapse whitespace. It will merge "Samsung Electronics Co., Ltd."
 * with "SAMSUNG ELECTRONICS CO LTD" and will NOT merge distinct subsidiaries.
 * Wrong merges distort the competitor view badly, so the UI shows what was
 * merged and lets the user correct it.
 */
export function canonicaliseAssignee(raw: string): string {
  const SUFFIXES =
    /\b(INC|INCORPORATED|LLC|L\.?L\.?C|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|GMBH|AG|KG|KK|K\.?K|AB|OY|SA|S\.?A|NV|N\.?V|BV|B\.?V|PLC|SPA|S\.?P\.?A|PTY|PTE|LP|LLP|SARL|SAS)\b/g
  return raw
    .toUpperCase()
    .replace(/[.,()]/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/[^A-Z0-9&\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Pulls display strings out of the applicants JSON without assuming its shape. */
function extractApplicantNames(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return []
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (Array.isArray(value)) return value.flatMap(v => extractApplicantNames(v, depth + 1))
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['name', 'applicant', 'applicant_name', 'value', 'text']) {
      if (typeof record[key] === 'string' && (record[key] as string).trim()) {
        return [(record[key] as string).trim()]
      }
    }
    return Object.values(record).flatMap(v => extractApplicantNames(v, depth + 1))
  }
  return []
}

export interface FieldMapOptions {
  /** Bounds the assignee facet. Beyond this the result is a sample, and says so. */
  assigneeSampleCap?: number
}

export async function runFieldMap(
  scope: WhitespaceScope,
  options: FieldMapOptions = {}
): Promise<FieldMapResult> {
  const where = buildScopeFilter(scope)
  const sampleCap = options.assigneeSampleCap ?? ASSIGNEE_SAMPLE_CAP
  const coverageNotes: string[] = []

  // --- Facet 1: size -------------------------------------------------------
  const totals = await facet<{ families: bigint; publications: bigint }>(
    Prisma.sql`
      SELECT COUNT(DISTINCT ${FAMILY_KEY})::bigint AS families,
             COUNT(*)::bigint                      AS publications
      FROM "local_patents" lp
      WHERE ${where}`
  )
  const familyCount = Number(totals[0]?.families ?? 0)
  const publicationCount = Number(totals[0]?.publications ?? 0)

  // --- Facet 2: filing trend ----------------------------------------------
  const yearRows =
    (await optionalFacet('filingsByYear', () =>
      facet<{ year: number; families: bigint }>(
        Prisma.sql`
          SELECT EXTRACT(YEAR FROM lp."filingDate")::int AS year,
                 COUNT(DISTINCT ${FAMILY_KEY})::bigint   AS families
          FROM "local_patents" lp
          WHERE ${where}
          GROUP BY 1
          ORDER BY 1`
      )
    )) ?? []
  const filingsByYear: YearCount[] = yearRows.map(r => ({ year: Number(r.year), families: Number(r.families) }))

  // --- Facet 3: jurisdictions ---------------------------------------------
  const jurisdictions =
    (await optionalFacet('jurisdictions', async () =>
      toLabelled(
        await facet<{ label: string | null; families: bigint }>(
          Prisma.sql`
            SELECT lp."country" AS label, COUNT(DISTINCT ${FAMILY_KEY})::bigint AS families
            FROM "local_patents" lp
            WHERE ${where}
            GROUP BY 1
            ORDER BY 2 DESC
            LIMIT 40`
        )
      )
    )) ?? []

  // --- Facet 4: classifications -------------------------------------------
  // Truncated to subgroup level: full CPC codes are too granular to read, and
  // comparing counts across hierarchy depths is meaningless (parent codes are
  // structurally sparse because examiners push documents down the tree).
  const classifications =
    (await optionalFacet('classifications', async () =>
      toLabelled(
        await facet<{ label: string | null; families: bigint }>(
          Prisma.sql`
            SELECT split_part(c, '/', 1) AS label,
                   COUNT(DISTINCT ${FAMILY_KEY})::bigint AS families
            FROM "local_patents" lp, unnest(lp."classifications") c
            WHERE ${where}
            GROUP BY 1
            ORDER BY 2 DESC
            LIMIT 30`
        )
      )
    )) ?? []

  // --- Facet 5: status proxy ----------------------------------------------
  // Kind codes only. This is a proxy and the UI must never call it legal status:
  // B/C are grants in most offices, A is an application, and the corpus has no
  // legal-event data of any kind.
  const statusRows =
    (await optionalFacet('statusProxy', () =>
      facet<{ bucket: string; families: bigint }>(
        Prisma.sql`
          SELECT CASE
                   WHEN lp."kind" ~ '^[BC]' THEN 'granted'
                   WHEN lp."kind" ~ '^[AU]' THEN 'pending'
                   ELSE 'unknown'
                 END AS bucket,
                 COUNT(DISTINCT ${FAMILY_KEY})::bigint AS families
          FROM "local_patents" lp
          WHERE ${where}
          GROUP BY 1`
      )
    )) ?? []
  const statusProxy = { granted: 0, pending: 0, unknown: 0 }
  for (const row of statusRows) {
    const key = row.bucket as keyof typeof statusProxy
    if (key in statusProxy) statusProxy[key] = Number(row.families)
  }

  // --- Facet 6: text coverage ---------------------------------------------
  // Reads patent_text_availability, the view the corpus migration designates as
  // the single resolver for text provenance.
  //
  // ON_DEMAND_BIGQUERY counts as NOT readable: it means the text exists only in
  // BigQuery, and this module is local-only by design. Reporting it as available
  // would overstate what claim-element analysis can actually see.
  const coverageRows =
    (await optionalFacet('textCoverage', () =>
      facet<{
        country: string | null
        families: bigint
        with_claims: bigint
        with_description: bigint
      }>(
        Prisma.sql`
          SELECT lp."country" AS country,
                 COUNT(DISTINCT ${FAMILY_KEY})::bigint AS families,
                 COUNT(DISTINCT ${FAMILY_KEY}) FILTER (
                   WHERE v."claimsAvailability" IN ('FULL_EPO', 'FULL', 'FIRST_CLAIM_ONLY')
                 )::bigint AS with_claims,
                 COUNT(DISTINCT ${FAMILY_KEY}) FILTER (
                   WHERE v."descriptionAvailability" <> 'NONE'
                 )::bigint AS with_description
          FROM "local_patents" lp
          JOIN "patent_text_availability" v ON v."id" = lp."id"
          WHERE ${where}
          GROUP BY 1
          ORDER BY 2 DESC
          LIMIT 40`
      )
    )) ?? []

  const textCoverage: TextCoverage = {
    familiesTotal: familyCount,
    withClaims: coverageRows.reduce((sum, r) => sum + Number(r.with_claims), 0),
    withDescription: coverageRows.reduce((sum, r) => sum + Number(r.with_description), 0),
    byJurisdiction: coverageRows
      .filter(r => r.country)
      .map(r => ({
        country: String(r.country),
        families: Number(r.families),
        withClaims: Number(r.with_claims),
      })),
  }

  // --- Facet 7: assignees --------------------------------------------------
  // applicants is an unnormalised JSON blob, so names are extracted and
  // canonicalised in TypeScript over a capped sample rather than parsed in SQL
  // against a shape we do not control.
  let assignees: LabelledCount[] = []
  let assigneesSampled = false
  const applicantRows =
    (await optionalFacet('assignees', () =>
      facet<{ familyKey: string; applicants: unknown }>(
        Prisma.sql`
          SELECT DISTINCT ON (${FAMILY_KEY})
                 ${FAMILY_KEY} AS "familyKey",
                 lp."applicants" AS applicants
          FROM "local_patents" lp
          WHERE ${where} AND lp."applicants" IS NOT NULL
          ORDER BY ${FAMILY_KEY}, lp."publicationDate" DESC NULLS LAST
          LIMIT ${sampleCap}`
      )
    )) ?? []

  if (applicantRows.length) {
    assigneesSampled = applicantRows.length >= sampleCap
    const counts = new Map<string, number>()
    for (const row of applicantRows) {
      // De-duplicate within a family first: a family listing the same applicant
      // on several members must still count once.
      const names = Array.from(
        new Set(
          extractApplicantNames(row.applicants)
            .map(canonicaliseAssignee)
            .filter(name => name.length > 2)
        )
      )
      for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    assignees = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([label, families]) => ({ label, families }))
  }

  // --- Coverage notes ------------------------------------------------------
  // These travel onto every hypothesis this study later produces.
  coverageNotes.push(`Corpus covers ${CORPUS_FIRST_YEAR}-present. No art before ${CORPUS_FIRST_YEAR} was searched.`)
  if (familyCount > 0) {
    const pct = Math.round((textCoverage.withClaims / familyCount) * 100)
    coverageNotes.push(`Claim text readable for ${pct}% of families in this field.`)
    if (pct < 40) {
      coverageNotes.push(
        'Claim coverage is below 40% — element-level findings in this field are indicative only.'
      )
    }
  }
  const unreadable = textCoverage.byJurisdiction.filter(
    j => j.families >= 50 && j.withClaims / j.families < 0.25
  )
  if (unreadable.length) {
    coverageNotes.push(
      `Claims are largely unreadable for ${unreadable.map(j => j.country).join(', ')} — those jurisdictions are counted but not analysed at claim level.`
    )
  }
  if (assigneesSampled) {
    coverageNotes.push(`Assignee ranking computed from a ${sampleCap.toLocaleString()}-family sample.`)
  }
  coverageNotes.push('No citation data, legal status or commercial evidence is available to this analysis.')

  return {
    familyCount,
    publicationCount,
    filingsByYear,
    publicationLagMonths: PUBLICATION_LAG_MONTHS,
    jurisdictions,
    classifications,
    assignees,
    statusProxy,
    textCoverage,
    gateCounts: {
      corpus: publicationCount,
      afterFilters: publicationCount,
      afterConcepts: publicationCount,
      families: familyCount,
    },
    coverageNotes,
    generatedAt: new Date().toISOString(),
  }
}
