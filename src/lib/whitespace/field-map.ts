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
import type { FieldMapResult, FieldRule, LabelledCount, TextCoverage, WhitespaceScope, YearCount } from './types'
import { CORPUS_FIRST_YEAR } from './types'
import { WhitespacePermanentError } from './run-lease'
import { fieldRuleNote, ladderSummary, minimumRungFor, narrowingAdviceFor, rungPhrase } from './field-rule'

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
export const CENSUS_ROW_CAP = Math.max(10_000, Number(process.env.WHITESPACE_CENSUS_ROW_CAP) || 250_000)
export const PUBLICATION_LAG_MONTHS = 18

/**
 * Corpora whose rows the text lanes can read. Each entry has a partial FTS GIN
 * index over SEARCH_TSVECTOR with `"corpusSources" @> ARRAY['<tag>']` as its
 * predicate (migrations 20260619170000 and 20260719120000), which is why the
 * text predicate below is written as an OR of per-corpus arms: each arm is
 * provable against its own partial index.
 *
 * Three sources are deliberately absent:
 *   - 'pqai' is deprecated; its rows would skew the census.
 *   - 'epo-ops' is an opportunistic cache of live EPO OPS API results, written
 *     as a side effect of other users' searches. Counting it would make the
 *     census irreproducible — the slice grows without anyone changing a scope.
 *   - 'epo-docdb' / 'epo-ep-fulltext' are the BULK EPO import's created rows.
 *     Neither loader writes "filingDate" (src/lib/epo-bdds/loader.ts, both
 *     INSERT column lists), and this census is filing-year based, so its very
 *     first predicate — filingDate IS NOT NULL — excludes every one of them.
 *     An arm and an index for them would match exactly nothing. If filingDate
 *     is ever backfilled for those rows, add the tags here AND build matching
 *     partial FTS indexes; until then this is dead weight on a 46M-row table.
 *
 * European coverage therefore comes from EP/WO publications inside the Google
 * corpus, which are bulk-loaded WITH filing dates. The EPO import's real
 * contribution to this study is claim text NULL-filled onto existing Google and
 * Indian rows — those keep their original tags, so they are already counted
 * here, and the gained claims raise textCoverage.withClaims, which is the
 * number gate G1 reads.
 */
const TEXT_CORPORA = ['google-patents-corpus', 'indian-corpus'] as const

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

export type Tx = Prisma.TransactionClient

/** Transaction-local, so it applies to the following statements and nothing else. */
export async function setStatementTimeout(tx: Tx, ms: number): Promise<void> {
  await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(ms)}, true)`
}

/** True for Postgres 57014 — query_canceled, i.e. the statement timeout fired. */
export function isStatementTimeout(error: unknown): boolean {
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
export async function facet<T>(tx: Tx, label: string, query: Prisma.Sql, gaps: string[]): Promise<T[] | null> {
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
 * each is an AND group. Of the OPTIONAL concepts, at least `minimumOptional`
 * must appear — the ladder between "optional concepts never narrow" (0) and
 * "every concept must appear" (all of them). See ScopeMatching in types.ts for
 * why that ladder exists; the short version is that the required flag alone
 * gave one required concept a sector and two an empty intersection, with no
 * rung in between.
 */
export interface ConceptQueryPlan {
  /** One websearch string per required concept: '"term" OR "term" OR ...'. Every one must match. */
  required: string[]
  /** One websearch string per optional concept. */
  optional: string[]
  /** How many of `optional` must match, 0..optional.length. */
  minimumOptional: number
  /** Concept labels behind each group — required first, then optional — for error messages. */
  groupLabels: string[][]
  /** Exclusion terms as one OR group for the negated arm, or null. */
  exclusions: string | null
}

/**
 * The websearch strings this plan actually searches with, one per AND group.
 * Kept for callers that only need the term lists (the stopword check, tests).
 */
export function conceptQueryGroups(plan: ConceptQueryPlan): string[] {
  return [...plan.required, ...plan.optional]
}

/** Phrase quoting for websearch_to_tsquery. Shared so every text lane quotes identically. */
export const quotePhrase = (value: string) => `"${value.replace(/["\\]/g, ' ').trim()}"`

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

/**
 * The loosest and tightest k the scope's concept list can express. With no
 * required concept the loosest rung is 1 — the union of the concepts — because
 * k = 0 would remove the concept gate entirely and count the whole slice.
 */
export function minimumOptionalBounds(scope: WhitespaceScope): { min: number; max: number } {
  const usable = scope.concepts.filter(concept => conceptTerms(concept).length > 0)
  const required = usable.filter(concept => concept.required).length
  const optional = usable.length - required
  return { min: required > 0 ? 0 : Math.min(1, optional), max: optional }
}

/**
 * The plan for the scope, with `minimumOptional` clamped into the expressible
 * range. Callers pass the k in force (a pinned value, or the fitted one from
 * resolveFieldDefinition); with none given the LOOSEST rung is used, which is
 * exactly the pre-ladder behaviour — required concepts intersect, optional
 * concepts never narrow, and with nothing required the field is the union.
 */
export function buildConceptQuery(scope: WhitespaceScope, minimumOptional?: number): ConceptQueryPlan | null {
  const usable = scope.concepts
    .map(concept => ({ label: concept.label.trim(), required: concept.required, terms: conceptTerms(concept) }))
    .filter(concept => concept.terms.length > 0)
  if (!usable.length) return null

  const required = usable.filter(concept => concept.required)
  const optional = usable.filter(concept => !concept.required)
  const bounds = minimumOptionalBounds(scope)
  const k = Math.min(bounds.max, Math.max(bounds.min, Math.floor(minimumOptional ?? bounds.min)))

  const exclusionTerms = scope.exclusions.map(exclusion => exclusion.term.trim()).filter(Boolean)
  return {
    required: required.map(concept => concept.terms.map(quotePhrase).join(' OR ')),
    optional: optional.map(concept => concept.terms.map(quotePhrase).join(' OR ')),
    minimumOptional: k,
    groupLabels: [...required, ...optional].map(concept => [concept.label]),
    exclusions: exclusionTerms.length ? exclusionTerms.map(quotePhrase).join(' OR ') : null,
  }
}

/** Every k-subset of `items`, in a stable order. */
export function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k <= 0) return [[]]
  if (items.length < k) return []
  const [head, ...rest] = items
  return [...combinations(rest, k - 1).map(combo => [head, ...combo]), ...combinations(rest, k)]
}

const tsquery = (group: string) => Prisma.sql`websearch_to_tsquery('english'::regconfig, ${group})`

/**
 * The tsqueries a plan searches with — ONE PER CONCEPT COMBINATION, not one
 * expression. Each is `required && optionalSubset && !!exclusions`.
 *
 * "At least k of n" could be written as a single tsquery, an OR over every
 * k-subset of AND groups. It must not be. Measured on the corpus: the planner
 * mis-costs a GIN scan for a tsquery that large and falls back to a sequential
 * scan that recomputes to_tsvector over the text of every row — 95 s against
 * 8 s for the same rung expressed as separate small queries OR'd in SQL, and on
 * a 45M-row corpus the sequential plan does not finish at all. Emitting one
 * predicate arm per combination lets Postgres run each as its own bitmap index
 * scan (an AND of ORs, which GIN serves from its smallest posting lists) and OR
 * the bitmaps — one heap pass, no seq scan, no giant tree.
 *
 * k = 0 yields the required conjunction alone (or nothing at all when there is
 * none — the caller then applies no concept gate, which only happens for a
 * scope with no concepts). Combination count is bounded by rungIsCompilable.
 */
export function conceptQueryArms(plan: ConceptQueryPlan): Prisma.Sql[] {
  const requiredParts = plan.required.map(tsquery)
  const optionalParts = plan.optional.map(tsquery)
  const k = Math.min(optionalParts.length, Math.max(0, plan.minimumOptional))
  const subsets = k > 0 ? combinations(optionalParts, k) : [[]]
  const exclusion = plan.exclusions ? Prisma.sql`!!${tsquery(plan.exclusions)}` : null

  const arms: Prisma.Sql[] = []
  for (const subset of subsets) {
    const gate = [...requiredParts, ...subset]
    // A lone exclusion is not a concept gate; it only rides along with one.
    if (!gate.length) continue
    const parts = exclusion ? [...gate, exclusion] : gate
    arms.push(Prisma.sql`(${parts.reduce((acc, part) => Prisma.sql`${acc} && ${part}`)})`)
  }
  return arms
}

/**
 * The text-match predicate: one arm per (concept combination × readable
 * corpus), OR'd — see conceptQueryArms for why the combinations are separate.
 *
 * Each arm repeats the tsvector match AND carries its corpus tag as a LITERAL
 * `@>` test — a bind parameter here would stop the planner proving the partial
 * index predicates (the exact trap FIXED-6 removed from the search providers).
 *
 * Returns null when the plan gates on nothing (no required concept and k = 0),
 * so the caller can leave the concept clause out rather than emit `()`.
 */
export function textMatchPredicate(plan: ConceptQueryPlan): Prisma.Sql | null {
  const queries = conceptQueryArms(plan)
  if (!queries.length) return null
  const arms = queries.flatMap(query =>
    TEXT_CORPORA.map(
      tag =>
        Prisma.sql`(${SEARCH_TSVECTOR} @@ ${query}
        AND lp."corpusSources" @> ${Prisma.raw(`ARRAY['${tag}']::TEXT[]`)})`
    )
  )
  return Prisma.sql`(${Prisma.join(arms, ' OR ')})`
}

/**
 * Membership of the readable corpus slice, with no text condition.
 *
 * The semantic candidate lane needs this: it matches by vector rather than by
 * tsvector, but it must still see EXACTLY the corpora the census counts, or the
 * hybrid field would quietly acquire 'epo-ops' and 'pqai' rows that the lexical
 * arm is documented above as excluding — and the census would stop being
 * reproducible for the reason stated there.
 */
export function corpusMembershipPredicate(): Prisma.Sql {
  const arms = TEXT_CORPORA.map(
    tag => Prisma.sql`lp."corpusSources" @> ${Prisma.raw(`ARRAY['${tag}']::TEXT[]`)}`
  )
  return Prisma.sql`(${Prisma.join(arms, ' OR ')})`
}

/**
 * The scope's exclusions as a standalone negative predicate, or null when there
 * are none.
 *
 * Inside the lexical arm exclusions ride along inside the composed tsquery
 * (`&& !!terms`). A vector-matched candidate never touches that tsquery, so
 * without this the semantic lane would reintroduce precisely the subject matter
 * the user excluded — the one way the hybrid could produce a WORSE field than
 * the lexical one it widens.
 */
export function exclusionPredicate(scope: WhitespaceScope): Prisma.Sql | null {
  const match = exclusionMatchPredicate(scope)
  return match ? Prisma.sql`NOT ${match}` : null
}

/**
 * The POSITIVE form: true for a row that matches an excluded term. For callers
 * that already hold a bounded candidate set — the semantic lane — testing
 * "which of these ids match an exclusion" and subtracting is index-backed and
 * bounded by the candidate count, whereas the negated form above can never use
 * the text index and, joined against the corpus, made the planner filter every
 * row of local_patents through to_tsvector (34 s on the 38k-row dev corpus,
 * 2 s without it) — which is what kept timing the semantic arm out.
 */
export function exclusionMatchPredicate(scope: WhitespaceScope): Prisma.Sql | null {
  const terms = scope.exclusions.map(exclusion => exclusion.term.trim()).filter(Boolean)
  if (!terms.length) return null
  const query = terms.map(quotePhrase).join(' OR ')
  return Prisma.sql`(${SEARCH_TSVECTOR} @@ websearch_to_tsquery('english'::regconfig, ${query}))`
}

/**
 * Verifies every group survives stemming/stopword removal. A group whose every
 * term is stopwords ("the", "of") composes to an EMPTY tsquery, and the tsquery
 * && operator treats empty as identity — the group would silently vanish from
 * the predicate and the census would answer a broader question than the scope
 * states. Refusing loudly is the honest behaviour.
 */
export async function assertConceptQueryUsable(plan: ConceptQueryPlan): Promise<void> {
  const groups = conceptQueryGroups(plan)
  if (!groups.length) return
  const checks = await prisma.$queryRaw<Array<{ idx: number; nodes: number }>>(Prisma.sql`
    SELECT idx::int AS idx, numnode(websearch_to_tsquery('english'::regconfig, q))::int AS nodes
    FROM unnest(${groups}::text[]) WITH ORDINALITY AS t(q, idx)`)
  const dead = checks.filter(check => check.nodes === 0)
  if (dead.length) {
    const labels = dead.flatMap(check => plan.groupLabels[check.idx - 1] ?? [])
    throw new WhitespacePermanentError(
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
    .map(c => normalizeClassificationCode(c.code))
}

function normalizeClassificationCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase()
}

/**
 * The scope predicate.
 *
 * Every branch is index-backed: classifications by the GIN array index, dates by
 * the filingDate btree, and the concept match by the partial FTS index — whose
 * expression this reproduces exactly, including the corpusSources predicate the
 * planner needs in order to choose it.
 */
export function buildScopeFilter(
  scope: WhitespaceScope,
  candidateIds?: readonly number[],
  /** The k in force. Omitted → the loosest rung (pre-ladder behaviour). */
  minimumOptional?: number
): Prisma.Sql {
  const clauses: Prisma.Sql[] = [Prisma.sql`lp."filingDate" IS NOT NULL`]

  const yearFrom = Math.max(CORPUS_FIRST_YEAR, scope.filters.yearFrom)
  clauses.push(Prisma.sql`lp."filingDate" >= ${new Date(Date.UTC(yearFrom, 0, 1))}`)
  clauses.push(Prisma.sql`lp."filingDate" < ${new Date(Date.UTC(scope.filters.yearTo + 1, 0, 1))}`)

  const cpc = acceptedCpc(scope)
  if (cpc.length) {
    // Prefix match: A61B5 must also capture A61B5/1455. Postgres cannot use the
    // GIN array index for a prefix test, so we OR an exact-overlap test (index
    // eligible for rows stored in canonical no-space form) with a normalised
    // prefix test. The corpus contains both "A01G25/16" and "A01G 25/16" forms;
    // comparing prefixes without normalising stored values silently missed the
    // spaced rows.
    const exact = Prisma.sql`lp."classifications" && ${cpc}::text[]`
    const prefixes = cpc.map(
      code => Prisma.sql`EXISTS (
        SELECT 1
        FROM unnest(lp."classifications") c
        WHERE regexp_replace(upper(c), '[[:space:]]+', '', 'g') LIKE ${code + '%'}
      )`
    )
    clauses.push(Prisma.sql`(${Prisma.join([exact, ...prefixes], ' OR ')})`)
  }

  // The concept gate, hybrid: a document qualifies by matching the concept text
  // OR by being one of the semantically nearest documents in the same corpus
  // slice (resolveFieldCandidates, which pre-applies these same structural
  // filters and the exclusions).
  //
  // The lexical arm alone made every concept a LITERAL requirement — with two
  // required concepts a family had to contain both, post-stemming, in title,
  // abstract or ragText. Patent drafters routinely describe the same thing in
  // other words, so scopes that a vector search answers with hundreds of
  // families were returning zero. The OR only ever widens: nothing the lexical
  // arm found is lost, and the structural filters (years, CPC, jurisdiction,
  // assignee) still apply to the ANN ids because they are separate AND clauses.
  const conceptQuery = buildConceptQuery(scope, minimumOptional)
  const lexical = conceptQuery ? textMatchPredicate(conceptQuery) : null
  if (lexical) {
    clauses.push(
      candidateIds?.length
        ? Prisma.sql`(${lexical} OR lp."id" = ANY(${candidateIds as number[]}::int[]))`
        : lexical
    )
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
  /**
   * Semantically-admitted local_patents ids, ORed into the concept gate.
   *
   * Resolved by the CALLER (resolveFieldCandidates in candidates.ts) rather than
   * here, so this module keeps no dependency on the embedding path — candidates.ts
   * imports field-map.ts for the structural predicates, and the reverse import
   * would close a cycle.
   */
  candidateIds?: readonly number[]
  /** How the field was assembled, recorded in the census coverage notes. */
  candidateNote?: string
  /**
   * The resolved match rule (resolveFieldDefinition). Its `minimumOptional` is
   * the k the predicate is built with; the rule itself is stored on the result
   * and stated in the coverage notes. Omitted → the loosest rung, no note.
   */
  fieldRule?: FieldRule | null
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

/**
 * Shared advice for a scope that must be narrowed before it can be counted.
 * With a resolved rule it names the measured rung to pin; see field-rule.ts.
 */
export function narrowingAdvice(scope: WhitespaceScope, rule?: FieldRule | null): string {
  return narrowingAdviceFor(scope, rule)
}

/**
 * Advice for the opposite failure: a scope that matched nothing at all.
 *
 * Distinct from narrowingAdvice because the two need opposite actions, and an
 * empty field used to inherit the "narrow it" wording — which reads as nonsense
 * when the answer is zero. With the hybrid gate an empty field now means the
 * scope missed on BOTH wording and meaning, so the structural filters are the
 * first thing to suspect; when the semantic arm could not run, that is the
 * likeliest cause and is named first.
 */
export function emptyFieldAdvice(scope: WhitespaceScope, semanticNote?: string, rule?: FieldRule | null): string {
  const parts: string[] = ['No publication in the readable corpus matches this scope.']
  // Keyword match over every did-not-run reason the candidate resolver emits:
  // unconfigured key, embed/retrieval failure, no vector, the deliberate kill
  // switch, and the no-ceiling refusal — which now reads "could not be
  // ESTIMATED" (the ceiling is derived per query from a background sample)
  // rather than "not calibrated". Matching only the old word would have quietly
  // stopped naming the lane on exactly the installations that need it named.
  // The "found no additional documents" note must NOT match: there the lane
  // RAN, and blaming it would send the user away from the structural filters.
  if (semanticNote && /not configured|failed|calibrated|estimated|unavailable|disabled|returned no vector/i.test(semanticNote)) {
    parts.push(
      'The semantic lane did not run, so the field was matched on concept wording alone — that is the most likely reason this is empty rather than small.'
    )
  }
  const cpc = acceptedCpc(scope)
  if (cpc.length) {
    parts.push(
      `Check the accepted classifications (${cpc.slice(0, 4).join(', ')}${cpc.length > 4 ? ', …' : ''}) — a CPC code that does not cover this subject matter excludes the whole field on its own.`
    )
  }
  if (scope.filters.jurisdictions.length) {
    parts.push(`Widen the jurisdictions (currently ${scope.filters.jurisdictions.join(', ')}).`)
  }
  if (scope.filters.assignees.length) {
    parts.push('Remove the assignee restriction and re-run to see whether the field exists at all.')
  }
  parts.push(
    `Widen the filing years (currently ${Math.max(CORPUS_FIRST_YEAR, scope.filters.yearFrom)}–${scope.filters.yearTo}).`
  )
  // The match rule, when there is one to loosen: a pinned minimum, or
  // must-appear concepts that intersect to nothing.
  const required = scope.concepts.filter(c => c.required && c.label.trim())
  if (rule && rule.mode === 'pinned' && rule.optionalCount > 0 && rule.minimumOptional > minimumRungFor(rule)) {
    parts.push(
      `The match rule is pinned at ${rungPhrase(rule, rule.minimumOptional)} — lower it or set it to auto.`
    )
  }
  if (required.length) {
    parts.push(
      `${required.length === 1 ? 'The must-appear concept' : `All ${required.length} must-appear concepts`} must be present in every document counted — make ${
        required.length === 1 ? 'it' : 'some of them'
      } optional if the field should be wider than that.`
    )
  }
  return parts.join(' ')
}

/**
 * The message the user sees when the census cannot finish. It has to say what to
 * do about it — "statement timeout" is true and useless.
 */
function tooBroadMessage(scope: WhitespaceScope, timeoutMs: number, rule?: FieldRule | null): string {
  return `This field is too broad to count within ${Math.max(1, Math.round(timeoutMs / 1000))}s.${ladderSummary(rule)} ${narrowingAdvice(scope, rule)}`
}

/** The field is countable but bigger than the exact-census ceiling. */
function overCapMessage(scope: WhitespaceScope, rowCap: number, rule?: FieldRule | null): string {
  return `This field matches more than ${rowCap.toLocaleString()} publications — bigger than the census will count exactly.${ladderSummary(
    rule
  )} ${narrowingAdvice(scope, rule)}`
}

export async function runFieldMap(
  scope: WhitespaceScope,
  options: FieldMapOptions = {}
): Promise<FieldMapResult> {
  const rule = options.fieldRule ?? null
  const conceptQuery = buildConceptQuery(scope, rule?.minimumOptional)
  // Outside the transaction: a scope whose concepts stem away to nothing must
  // fail with the concept named, not count a silently different field.
  if (conceptQuery) await assertConceptQueryUsable(conceptQuery)

  const where = buildScopeFilter(scope, options.candidateIds, rule?.minimumOptional)
  const sampleCap = options.assigneeSampleCap ?? ASSIGNEE_SAMPLE_CAP
  const censusTimeoutMs = options.censusTimeoutMs ?? CENSUS_TIMEOUT_MS
  const rowCap = options.censusRowCap ?? CENSUS_ROW_CAP
  const coverageNotes: string[] = []
  // The rule first: it says what was counted, and everything after it is a
  // property of that count.
  if (rule) coverageNotes.push(fieldRuleNote(rule))
  if (options.candidateNote) coverageNotes.push(options.candidateNote)
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
    if (isStatementTimeout(error)) throw new WhitespacePermanentError(tooBroadMessage(scope, censusTimeoutMs, rule))
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
      throw new WhitespacePermanentError(
        `The field staged but could not be counted within ${Math.round(FACET_TIMEOUT_MS / 1000)}s. ${narrowingAdvice(scope, rule)}`
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
    throw new WhitespacePermanentError(overCapMessage(scope, rowCap, rule))
  }

  // An empty census is not an error — the map renders, with zeros — but shipping
  // it without saying why reads as "this field does not exist", which is a
  // conclusion the census has not earned. Say what to change instead.
  if (publicationCount === 0) {
    coverageNotes.push(emptyFieldAdvice(scope, options.candidateNote, rule))
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
        SELECT split_part(regexp_replace(upper(c), '[[:space:]]+', '', 'g'), '/', 1) AS label,
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
  //
  // GROUPING SETS, not GROUP BY country, because the study-wide totals CANNOT be
  // derived by summing the per-country rows. A family is a family across
  // jurisdictions by definition, so a US/EP/JP family with readable claims is
  // counted once in each of its three country rows — summing them counted it
  // three times, and "claims readable" routinely printed above 100%. The extra
  // grouping set counts DISTINCT families over the whole staged set, once. The
  // 40-country LIMIT compounded it in the other direction, truncating the sum
  // for wide fields; ordering the total row first keeps it out of the cap.
  const coverageRows =
    (await facet<{
      country: string | null
      is_total: number
      families: bigint
      with_claims: bigint
      with_description: bigint
    }>(
      tx,
      'textCoverage',
      Prisma.sql`
        SELECT ws.country                    AS country,
               GROUPING(ws.country)::int     AS is_total,
               COUNT(DISTINCT ws.family_key)::bigint AS families,
               COUNT(DISTINCT ws.family_key) FILTER (
                 WHERE v."claimsAvailability" IN ('FULL_EPO', 'FULL', 'FIRST_CLAIM_ONLY')
               )::bigint AS with_claims,
               COUNT(DISTINCT ws.family_key) FILTER (
                 WHERE v."descriptionAvailability" <> 'NONE'
               )::bigint AS with_description
        FROM ws_census ws
        JOIN "patent_text_availability" v ON v."id" = ws.id
        GROUP BY GROUPING SETS ((ws.country), ())
        ORDER BY is_total DESC, families DESC
        LIMIT 41`,
      gaps
    )) ?? []

  const coverageTotal = coverageRows.find(r => Number(r.is_total) === 1) ?? null
  const textCoverage: TextCoverage = {
    familiesTotal: familyCount,
    withClaims: Number(coverageTotal?.with_claims ?? 0),
    withDescription: Number(coverageTotal?.with_description ?? 0),
    byJurisdiction: coverageRows
      .filter(r => Number(r.is_total) === 0 && r.country)
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
  //
  // The pick is HASH-ORDERED, not family-key ordered. `ORDER BY family_key LIMIT
  // 25000` is not a sample, it is a prefix: family keys carry their office and
  // series ("EP1234567", "US2019..."), so the first 25k of a large field are
  // systematically one jurisdiction and one era — and the resulting "who is
  // filing" ranking described that slice while claiming to describe the field.
  // md5 of the family key is uniform and deterministic, so the same scope always
  // draws the same unbiased sample.
  let assignees: LabelledCount[] = []
  let assigneesSampled = false
  const applicantRows =
    (await facet<{ familyKey: string; applicants: unknown }>(
      tx,
      'assignees',
      Prisma.sql`
        WITH one_per_family AS (
          SELECT DISTINCT ON (family_key) id, family_key
          FROM ws_census
          WHERE has_applicants
          ORDER BY family_key, publication_date DESC NULLS LAST
        ),
        picked AS (
          SELECT id, family_key
          FROM one_per_family
          ORDER BY md5(family_key)
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
      'Concept matching reads the Google Patents and Indian corpora, which include European (EP/WO) publications. Publications added by the EPO bulk import carry no filing date and are not counted in this filing-year census; that import contributes claim text to families already counted, which is reflected in the claims-readable figure.'
    )
    // Without a resolved rule (a caller on the pre-ladder path) the loosest
    // rung was used; say so in the old words. With one, fieldRuleNote above
    // already stated exactly what was counted.
    if (!rule) {
      const optionalCount = scope.concepts.filter(c => !c.required && c.label.trim()).length
      if (scope.concepts.some(c => c.required && c.label.trim()) && optionalCount > 0) {
        coverageNotes.push(
          `${optionalCount} optional concept${optionalCount === 1 ? '' : 's'} did not restrict this count — only must-appear concepts define the field. Optional concepts inform clustering and validation.`
        )
      } else if (!scope.concepts.some(c => c.required && c.label.trim())) {
        coverageNotes.push(
          'No concept is marked must-appear, so this field is the union of every concept.'
        )
      }
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
      // Not measured — see the FieldMapResult.gateCounts note. The staging pass
      // applies filters and concepts together, so only the post-gate figures
      // exist; inventing the earlier two by repeating this one made the funnel
      // assert narrowing that was never counted.
      corpus: null,
      afterFilters: null,
      afterConcepts: publicationCount,
      families: familyCount,
    },
    coverageNotes,
    ...(rule ? { fieldRule: rule } : {}),
    generatedAt: new Date().toISOString(),
  }
    },
    // Must exceed the census plus every facet, or Prisma aborts a transaction the
    // database is still happily working on.
    { timeout: censusTimeoutMs + 7 * FACET_TIMEOUT_MS + 10_000, maxWait: 20_000 }
  )
}
