/**
 * Whitespace Studio — stage 1, the field census.
 *
 * Pure SQL over the local corpus. No language model touches any number here,
 * which is what makes the landscape reproducible: same scope, same corpus, same
 * answer.
 *
 * The scope predicate is evaluated EXACTLY ONCE, into a temp table, and every
 * facet then reads that staged set. The earlier shape — seven independent facet
 * queries each repeating the predicate — paid for the full-text scan and the
 * family de-duplication seven times over, which is what pushed the census past
 * its statement timeout on a large corpus and failed the run with a raw
 * `57014` from Postgres. Facets are read inside savepoints, so a slow facet
 * still degrades to a gap in the result rather than killing the census.
 *
 * The census is EXACT OR REFUSED. Staging stops at WHITESPACE_CENSUS_ROW_CAP
 * publications; past that the run fails fast with the real number and concrete
 * narrowing advice, because facets computed over an arbitrary prefix of the
 * match set would be silently biased — the one failure mode this product must
 * never have.
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

/**
 * Ceiling for the staging pass — the only statement that touches the corpus.
 * Raise with WHITESPACE_CENSUS_TIMEOUT_MS on installations with a bigger corpus.
 */
const CENSUS_TIMEOUT_MS = Math.max(10_000, Number(process.env.WHITESPACE_CENSUS_TIMEOUT_MS) || 90_000)
/** Per-facet ceiling. Facets read the staged temp table, so this is generous. */
const FACET_TIMEOUT_MS = 20_000
/** Assignee extraction reads a JSON column, so it runs over a capped sample. */
const ASSIGNEE_SAMPLE_CAP = 25_000
/**
 * Ceiling on staged publications. The census is exact or it is refused: facets
 * over an arbitrary prefix of the match set would be silently biased, so a
 * field bigger than this fails fast with the real number instead of hanging
 * until the statement timeout. ~250k publications is far beyond any field a
 * study can usefully hypothesise over.
 */
const CENSUS_ROW_CAP = Math.max(10_000, Number(process.env.WHITESPACE_CENSUS_ROW_CAP) || 250_000)
export const PUBLICATION_LAG_MONTHS = 18

/**
 * Corpora whose rows the text lanes can read. Each entry has a partial FTS GIN
 * index over SEARCH_TSVECTOR with `"corpusSources" @> ARRAY['<tag>']` as its
 * predicate (migrations 20260619170000, 20260719120000 and 20260729190000),
 * which is why the text predicate below is written as an OR of per-corpus
 * arms: each arm is provable against its own partial index. 'pqai' rows are
 * deliberately not counted — that source is deprecated and its rows would skew
 * the census. European publications mostly arrive via the Google corpus; the
 * 'epo-ops' arm additionally covers documents fetched directly from the EPO.
 */
const TEXT_CORPORA = ['google-patents-corpus', 'indian-corpus', 'epo-ops'] as const

/**
 * The search document. MUST stay byte-identical to the expression of the
 * partial FTS indexes and searchDocumentExpression() in
 * indian-corpus-provider.ts — if they diverge, Postgres silently stops using
 * the indexes and every text lane becomes a sequential scan of the corpus.
 */
const SEARCH_TSVECTOR = Prisma.sql`to_tsvector('english'::regconfig,
        coalesce(lp."ragText", '')   || ' ' ||
        coalesce(lp."title", '')     || ' ' ||
        coalesce(lp."abstract", '')  || ' ' ||
        coalesce(lp."abstractOriginal", ''))`

type Tx = Prisma.TransactionClient

/** Transaction-local, so it applies to the following statements and nothing else. */
async function setStatementTimeout(tx: Tx, ms: number): Promise<void> {
  await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(ms)}, true)`
}

/** True for Postgres 57014 — query_canceled, i.e. the statement timeout fired. */
function isStatementTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const code = (error as { meta?: { code?: string } })?.meta?.code
  return code === '57014' || /57014|statement timeout|canceling statement/i.test(message)
}

/**
 * Reads one facet off the staged census inside a savepoint.
 *
 * The savepoint matters: the census runs in a single transaction now, and in
 * Postgres a failed statement poisons the whole transaction unless it is rolled
 * back to a savepoint. Without this, one slow facet would take the entire map
 * down — the failure mode this module explicitly promises not to have.
 */
async function facet<T>(tx: Tx, label: string, query: Prisma.Sql, gaps: string[]): Promise<T[] | null> {
  const savepoint = `ws_facet_${label.replace(/[^a-z0-9_]/gi, '_')}`
  await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`)
  try {
    const rows = await tx.$queryRaw<T[]>(query)
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`)
    return rows
  } catch (error) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    console.error(`[Whitespace] Facet "${label}" failed:`, error instanceof Error ? error.message : error)
    gaps.push(label)
    return null
  }
}

/**
 * The concept text query, as flat OR-of-phrases groups that are composed with
 * the tsquery && / !! operators in SQL.
 *
 * This structure exists because websearch_to_tsquery has NO grouping syntax:
 * parentheses are ignored as punctuation and OR binds LOWER than the implicit
 * AND, so a single string '("a" OR "b") ("c" OR "d")' parses as
 * a | (b & c) | d — any lone synonym of the first concept matches the whole
 * corpus slice. (That mis-parse is what made every census of a multi-concept
 * scope match millions of rows and time out.) Inside ONE group there is no AND,
 * so '"a" OR "b" OR "c"' is safe; groups are then ANDed with the tsquery &&
 * operator and exclusions negated with !!, which parse exactly as intended.
 *
 * Group semantics follow the scope contract: REQUIRED concepts must appear, so
 * each becomes an AND group. Optional concepts must never narrow the field —
 * with at least one required concept they add no predicate (they inform later
 * stages); with none, the field is the union of all concepts, as one OR group.
 */
export interface ConceptQueryPlan {
  /** One websearch string per AND group: '"term" OR "term" OR ...'. */
  groups: string[]
  /** Concept labels behind each group, index-aligned, for error messages. */
  groupLabels: string[][]
  /** Exclusion terms as one OR group for the negated arm, or null. */
  exclusions: string | null
}

const quotePhrase = (value: string) => `"${value.replace(/["\\]/g, ' ').trim()}"`

function conceptTerms(concept: { label: string; synonyms: string[] }): string[] {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of [concept.label, ...concept.synonyms]) {
    const term = raw.trim()
    if (!term) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push(term)
  }
  return terms
}

export function buildConceptQuery(scope: WhitespaceScope): ConceptQueryPlan | null {
  const usable = scope.concepts
    .map(concept => ({ label: concept.label.trim(), required: concept.required, terms: conceptTerms(concept) }))
    .filter(concept => concept.terms.length > 0)
  if (!usable.length) return null

  const required = usable.filter(concept => concept.required)
  const groups: string[] = []
  const groupLabels: string[][] = []
  if (required.length) {
    for (const concept of required) {
      groups.push(concept.terms.map(quotePhrase).join(' OR '))
      groupLabels.push([concept.label])
    }
  } else {
    // No required concept: the field is the union of every concept.
    groups.push(usable.flatMap(concept => concept.terms).map(quotePhrase).join(' OR '))
    groupLabels.push(usable.map(concept => concept.label))
  }

  const exclusionTerms = scope.exclusions.map(exclusion => exclusion.term.trim()).filter(Boolean)
  return {
    groups,
    groupLabels,
    exclusions: exclusionTerms.length ? exclusionTerms.map(quotePhrase).join(' OR ') : null,
  }
}

/** groups && groups && !!exclusions, as a single tsquery expression. */
function composedTsquery(plan: ConceptQueryPlan): Prisma.Sql {
  let query = plan.groups
    .map(group => Prisma.sql`websearch_to_tsquery('english'::regconfig, ${group})`)
    .reduce((acc, part) => Prisma.sql`${acc} && ${part}`)
  if (plan.exclusions) {
    query = Prisma.sql`${query} && !!websearch_to_tsquery('english'::regconfig, ${plan.exclusions})`
  }
  return Prisma.sql`(${query})`
}

/**
 * The text-match predicate: one arm per readable corpus, OR'd.
 *
 * Each arm repeats the tsvector match AND carries its corpus tag as a LITERAL
 * `@>` test — a bind parameter here would stop the planner proving the partial
 * index predicates (the exact trap FIXED-6 removed from the search providers).
 */
export function textMatchPredicate(plan: ConceptQueryPlan): Prisma.Sql {
  const query = composedTsquery(plan)
  const arms = TEXT_CORPORA.map(
    tag =>
      Prisma.sql`(${SEARCH_TSVECTOR} @@ ${query}
        AND lp."corpusSources" @> ${Prisma.raw(`ARRAY['${tag}']::TEXT[]`)})`
  )
  return Prisma.sql`(${Prisma.join(arms, ' OR ')})`
}

/**
 * Verifies every group survives stemming/stopword removal. A group whose every
 * term is stopwords ("the", "of") composes to an EMPTY tsquery, and the tsquery
 * && operator treats empty as identity — the group would silently vanish from
 * the predicate and the census would answer a broader question than the scope
 * states. Refusing loudly is the honest behaviour.
 */
export async function assertConceptQueryUsable(plan: ConceptQueryPlan): Promise<void> {
  const checks = await prisma.$queryRaw<Array<{ idx: number; nodes: number }>>(Prisma.sql`
    SELECT idx::int AS idx, numnode(websearch_to_tsquery('english'::regconfig, q))::int AS nodes
    FROM unnest(${plan.groups}::text[]) WITH ORDINALITY AS t(q, idx)`)
  const dead = checks.filter(check => check.nodes === 0)
  if (dead.length) {
    const labels = dead.flatMap(check => plan.groupLabels[check.idx - 1] ?? [])
    throw new Error(
      `The concept${labels.length === 1 ? '' : 's'} ${labels.map(label => `"${label}"`).join(', ')} contain${
        labels.length === 1 ? 's' : ''
      } no searchable words after common-word removal. Reword ${labels.length === 1 ? 'it' : 'them'} or remove ${
        labels.length === 1 ? 'it' : 'them'
      } before running.`
    )
  }
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
    clauses.push(textMatchPredicate(conceptQuery))
  }

  if (scope.filters.jurisdictions.length) {
    clauses.push(Prisma.sql`lp."country" = ANY(${scope.filters.jurisdictions}::text[])`)
  }

  // Assignee restriction, matched as case-insensitive substrings of the raw
  // applicants JSON. Coarser than the canonicalised facet, and said so in the
  // census coverage notes — but silently ignoring the filter, as this module
  // once did, showed the whole field to a user who asked for one competitor.
  const assigneePatterns = scope.filters.assignees
    .map(name => name.trim().replace(/([\\%_])/g, '\\$1'))
    .filter(name => name.length >= 2)
    .map(name => `%${name}%`)
  if (assigneePatterns.length) {
    clauses.push(Prisma.sql`lp."applicants"::text ILIKE ANY(${assigneePatterns}::text[])`)
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
export function extractApplicantNames(value: unknown, depth = 0): string[] {
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
  /** Ceiling for the staging pass. Defaults to WHITESPACE_CENSUS_TIMEOUT_MS or 90s. */
  censusTimeoutMs?: number
  /** Ceiling on staged publications. Defaults to WHITESPACE_CENSUS_ROW_CAP or 250k. */
  censusRowCap?: number
}

/**
 * Stages rows matching the scope into a temp table, carrying only the columns
 * the facets need. Dropped when the transaction commits.
 *
 * `applicants` is deliberately NOT copied — it is an unbounded JSON blob and
 * copying it for millions of rows would spill temp space for no reason. Only the
 * capped assignee sample joins back to fetch it.
 *
 * The LIMIT is the row cap plus one: staging stops the moment the field proves
 * bigger than the census will count exactly, instead of materialising millions
 * of rows and dying on the statement timeout. One extra row is how the caller
 * distinguishes "exactly at the cap" from "over it".
 */
function stageCensus(where: Prisma.Sql, rowCap: number): Prisma.Sql {
  return Prisma.sql`
    CREATE TEMP TABLE ws_census ON COMMIT DROP AS
    SELECT lp."id"                                         AS id,
           ${FAMILY_KEY}                                   AS family_key,
           lp."country"                                    AS country,
           lp."kind"                                       AS kind,
           EXTRACT(YEAR FROM lp."filingDate")::int         AS filing_year,
           lp."publicationDate"                            AS publication_date,
           lp."classifications"                            AS classifications,
           (lp."applicants" IS NOT NULL)                   AS has_applicants
    FROM "local_patents" lp
    WHERE ${where}
    LIMIT ${rowCap + 1}`
}

/** Shared advice for a scope that must be narrowed before it can be counted. */
function narrowingAdvice(scope: WhitespaceScope): string {
  const plan = buildConceptQuery(scope)
  if (!plan && acceptedCpc(scope).length > 0) {
    return 'This scope matches on classification alone, which cannot use the text index and so reads the whole corpus. Add a concept — even one — and the search becomes index-backed.'
  }
  const hasRequired = scope.concepts.some(c => c.required && c.label.trim())
  const requiredHint = hasRequired
    ? 'mark more concepts as required'
    : 'mark a concept as required (required concepts intersect; with none marked, the field is the union of every concept)'
  return `Narrow it: ${requiredHint}, tighten the filing years, restrict jurisdictions, or add exclusions.`
}

/**
 * The message the user sees when the census cannot finish. It has to say what to
 * do about it — "statement timeout" is true and useless.
 */
function tooBroadMessage(scope: WhitespaceScope, timeoutMs: number): string {
  return `This field is too broad to count within ${Math.max(1, Math.round(timeoutMs / 1000))}s. ${narrowingAdvice(scope)}`
}

/** The field is countable but bigger than the exact-census ceiling. */
function overCapMessage(scope: WhitespaceScope, rowCap: number): string {
  return `This field matches more than ${rowCap.toLocaleString()} publications — bigger than the census will count exactly. ${narrowingAdvice(
    scope
  )}`
}

export async function runFieldMap(
  scope: WhitespaceScope,
  options: FieldMapOptions = {}
): Promise<FieldMapResult> {
  const conceptQuery = buildConceptQuery(scope)
  // Outside the transaction: a scope whose concepts stem away to nothing must
  // fail with the concept named, not count a silently different field.
  if (conceptQuery) await assertConceptQueryUsable(conceptQuery)

  const where = buildScopeFilter(scope)
  const sampleCap = options.assigneeSampleCap ?? ASSIGNEE_SAMPLE_CAP
  const censusTimeoutMs = options.censusTimeoutMs ?? CENSUS_TIMEOUT_MS
  const rowCap = options.censusRowCap ?? CENSUS_ROW_CAP
  const coverageNotes: string[] = []
  const gaps: string[] = []

  // One interactive transaction, because the temp table lives on a single
  // connection and Prisma's pool would otherwise hand each facet a different one.
  return prisma.$transaction(
    async tx => {
  // --- The single pass over the corpus -------------------------------------
  await setStatementTimeout(tx, censusTimeoutMs)
  try {
    await tx.$executeRaw(stageCensus(where, rowCap))
  } catch (error) {
    if (isStatementTimeout(error)) throw new Error(tooBroadMessage(scope, censusTimeoutMs))
    throw error
  }
  await setStatementTimeout(tx, FACET_TIMEOUT_MS)

  // --- Facet 1: size -------------------------------------------------------
  // Not savepoint-tolerant: every other number is a proportion of this one, so a
  // map without it would be a map of nothing.
  let totals: Array<{ families: bigint; publications: bigint }>
  try {
    totals = await tx.$queryRaw<Array<{ families: bigint; publications: bigint }>>(
      Prisma.sql`
        SELECT COUNT(DISTINCT family_key)::bigint AS families,
               COUNT(*)::bigint                   AS publications
        FROM ws_census`
    )
  } catch (error) {
    if (isStatementTimeout(error)) {
      throw new Error(
        `The field staged but could not be counted within ${Math.round(FACET_TIMEOUT_MS / 1000)}s. ${narrowingAdvice(scope)}`
      )
    }
    throw error
  }
  const familyCount = Number(totals[0]?.families ?? 0)
  const publicationCount = Number(totals[0]?.publications ?? 0)

  // Over the exact-census ceiling: the staged rows are an arbitrary subset, and
  // facets over an arbitrary subset would be quietly biased. Refuse with the
  // real number rather than publish proportions of an unknown population.
  if (publicationCount > rowCap) {
    throw new Error(overCapMessage(scope, rowCap))
  }

  // --- Facet 2: filing trend ----------------------------------------------
  const yearRows =
    (await facet<{ year: number; families: bigint }>(
      tx,
      'filingsByYear',
      Prisma.sql`
        SELECT filing_year AS year, COUNT(DISTINCT family_key)::bigint AS families
        FROM ws_census
        WHERE filing_year IS NOT NULL
        GROUP BY 1
        ORDER BY 1`,
      gaps
    )) ?? []
  const filingsByYear: YearCount[] = yearRows.map(r => ({ year: Number(r.year), families: Number(r.families) }))

  // --- Facet 3: jurisdictions ---------------------------------------------
  const jurisdictions = toLabelled(
    (await facet<{ label: string | null; families: bigint }>(
      tx,
      'jurisdictions',
      Prisma.sql`
        SELECT country AS label, COUNT(DISTINCT family_key)::bigint AS families
        FROM ws_census
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 40`,
      gaps
    )) ?? []
  )

  // --- Facet 4: classifications -------------------------------------------
  // Truncated to subgroup level: full CPC codes are too granular to read, and
  // comparing counts across hierarchy depths is meaningless (parent codes are
  // structurally sparse because examiners push documents down the tree).
  const classifications = toLabelled(
    (await facet<{ label: string | null; families: bigint }>(
      tx,
      'classifications',
      Prisma.sql`
        SELECT split_part(c, '/', 1) AS label,
               COUNT(DISTINCT ws.family_key)::bigint AS families
        FROM ws_census ws, unnest(ws.classifications) c
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 30`,
      gaps
    )) ?? []
  )

  // --- Facet 5: status proxy ----------------------------------------------
  // Kind codes only. This is a proxy and the UI must never call it legal status:
  // B/C are grants in most offices, A is an application, and the corpus has no
  // legal-event data of any kind.
  const statusRows =
    (await facet<{ bucket: string; families: bigint }>(
      tx,
      'statusProxy',
      Prisma.sql`
        SELECT CASE
                 WHEN kind ~ '^[BC]' THEN 'granted'
                 WHEN kind ~ '^[AU]' THEN 'pending'
                 ELSE 'unknown'
               END AS bucket,
               COUNT(DISTINCT family_key)::bigint AS families
        FROM ws_census
        GROUP BY 1`,
      gaps
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
    (await facet<{
      country: string | null
      families: bigint
      with_claims: bigint
      with_description: bigint
    }>(
      tx,
      'textCoverage',
      Prisma.sql`
        SELECT ws.country AS country,
               COUNT(DISTINCT ws.family_key)::bigint AS families,
               COUNT(DISTINCT ws.family_key) FILTER (
                 WHERE v."claimsAvailability" IN ('FULL_EPO', 'FULL', 'FIRST_CLAIM_ONLY')
               )::bigint AS with_claims,
               COUNT(DISTINCT ws.family_key) FILTER (
                 WHERE v."descriptionAvailability" <> 'NONE'
               )::bigint AS with_description
        FROM ws_census ws
        JOIN "patent_text_availability" v ON v."id" = ws.id
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 40`,
      gaps
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
  // against a shape we do not control. The sample is picked from the staged set
  // and only then joined back for the JSON itself.
  let assignees: LabelledCount[] = []
  let assigneesSampled = false
  const applicantRows =
    (await facet<{ familyKey: string; applicants: unknown }>(
      tx,
      'assignees',
      Prisma.sql`
        WITH picked AS (
          SELECT DISTINCT ON (family_key) id, family_key
          FROM ws_census
          WHERE has_applicants
          ORDER BY family_key, publication_date DESC NULLS LAST
          LIMIT ${sampleCap}
        )
        SELECT p.family_key AS "familyKey", lp."applicants" AS applicants
        FROM picked p
        JOIN "local_patents" lp ON lp."id" = p.id`,
      gaps
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
  if (conceptQuery) {
    coverageNotes.push(
      'Concept matching reads the Google Patents, Indian and EPO-fetched corpora; rows from other ingestion sources are not text-searchable and are not counted.'
    )
    const optionalCount = scope.concepts.filter(c => !c.required && c.label.trim()).length
    if (scope.concepts.some(c => c.required && c.label.trim()) && optionalCount > 0) {
      coverageNotes.push(
        `${optionalCount} optional concept${optionalCount === 1 ? '' : 's'} did not restrict this count — only required concepts define the field. Optional concepts inform clustering and validation.`
      )
    } else if (!scope.concepts.some(c => c.required && c.label.trim())) {
      coverageNotes.push(
        'No concept is marked required, so this field is the union of every concept. Mark concepts as required to intersect them.'
      )
    }
  }
  if (scope.filters.assignees.length) {
    coverageNotes.push(
      `Restricted to ${scope.filters.assignees.length} assignee name${
        scope.filters.assignees.length === 1 ? '' : 's'
      }, matched as substrings of applicant records — subsidiaries filed under other names are not caught.`
    )
  }
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
  if (gaps.length) {
    coverageNotes.push(
      `These parts of the map could not be computed and are missing rather than empty: ${gaps.join(', ')}.`
    )
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
    },
    // Must exceed the census plus every facet, or Prisma aborts a transaction the
    // database is still happily working on.
    { timeout: censusTimeoutMs + 7 * FACET_TIMEOUT_MS + 10_000, maxWait: 20_000 }
  )
}
