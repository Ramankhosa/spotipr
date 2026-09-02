/**
 * Whitespace Studio — DIMENSION_MAP, the invention-whitespace stage.
 *
 * Discovers the VIEWPOINTS that organise the field around an invention (the JPO
 * F-term sense: axes like actuation principle, sensing modality, lifecycle
 * stage), letting the viewpoint set GROW across rounds as unclassified
 * documents reveal axes the first guess missed. Then counts coverage exactly
 * and surfaces empty cells with healthy margins as candidate gaps.
 *
 * Division of labour, enforced structurally:
 *   - The model proposes taxonomy (labels, descriptions, synonym vocabulary).
 *     It never labels individual patents and never produces a count.
 *   - Postgres counts. Sample-side acceptance and the final census both run the
 *     SAME matching rule — the value's websearch_to_tsquery vocabulary over the
 *     SAME document expression, UNIONed (when the calibrated semantic lane is
 *     on) with stored-vector distance to the value's vocabulary embedding under
 *     the SAME ceiling — so the loop's settle decision and the published
 *     numbers cannot diverge by construction. On an uncalibrated installation
 *     the semantic arm is off on both sides and matching is wording-only,
 *     exactly as it always was.
 *
 * The census is exact or refused, like the field map: value hit-extraction and
 * the pairwise join run bare (their failure fails the stage with advice), and
 * only the optional claims-readability facet degrades to a labelled gap. A
 * value whose vocabulary stems away to nothing is rejected up front — an empty
 * tsquery matches zero rows, which would fabricate a perfect, meaningless gap.
 */

import { Prisma, TaskCode } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  assertConceptQueryUsable,
  buildConceptQuery,
  emptyFieldAdvice,
  facet,
  isStatementTimeout,
  narrowingAdvice,
  quotePhrase,
  setStatementTimeout,
} from './field-map'
import { DIMENSION_ROW_CAP, resolveFieldDefinition } from './field-definition'
import { ladderSummary, minimumRungFor, wideningAdviceFor } from './field-rule'
import { resolveSemanticCeiling, semanticArmUnavailableReason, type SemanticCeiling } from './candidates'
import {
  backgroundCeiling,
  comparableVectorSql,
  describeLaneError,
  embedQueryTexts,
  literalVectorSql,
  semanticBackground,
  semanticLaneConfigured,
  semanticMatchSql,
  vectorParamSql,
} from './embedding'
import { rarePairFromCounts } from './rarity'
import { parseModelJson, runWhitespaceLLM, type WhitespaceLLMContext } from './llm'
import { heartbeatRun, WhitespacePermanentError } from './run-lease'
import { CORPUS_FIRST_YEAR } from './types'
import {
  buildDimensionGrowPrompt,
  buildDimensionSeedPrompt,
  WS_DIMENSION_GROW_STAGE_CODE,
  WS_DIMENSION_SEED_STAGE_CODE,
} from './prompts'
import type {
  Dimension,
  DimensionGap,
  DimensionMapResult,
  DimensionMatrix,
  DimensionMatrixCell,
  DimensionProvenance,
  DimensionRound,
  DimensionSettledReason,
  DimensionValue,
  FieldRule,
  WhitespaceScope,
} from './types'

// ---------------------------------------------------------------------------
// Budgets and thresholds
// ---------------------------------------------------------------------------

// DIMENSION_ROW_CAP (half the field-map cap — this census stages a tsvector per
// row and builds a GIN index over it) lives in field-definition.ts, where the
// fit band's ceiling is derived from it.
const CENSUS_TIMEOUT_MS = Math.max(10_000, Number(process.env.WHITESPACE_DIMENSION_TIMEOUT_MS) || 90_000)
const FACET_TIMEOUT_MS = 25_000
const PRECHECK_TIMEOUT_MS = 45_000

/**
 * Below this the grid is empty by arithmetic rather than absence: with 5
 * viewpoints of 6 values, the average cell would hold under two families
 * whatever the technology looks like, and the gap rule's expected>=5 condition
 * could never fire on honest margins. Env-tunable because the right floor
 * scales with corpus size — a dev corpus of 38k rows cannot produce the fields
 * a 30M-row production corpus does.
 */
const MIN_FIELD_FAMILIES = Math.max(50, Number(process.env.WHITESPACE_DIMENSION_MIN_FAMILIES) || 500)
const SAMPLE_FAMILIES = 2_000
const SEED_SLICE = 150
const GROW_SLICE = 120
const MAX_ROUNDS = 3
const MAX_DIMENSIONS = 8
const MAX_VALUES_PER_DIM = 8
/** The cap that actually bounds the pairwise self-join volume. */
const MAX_TOTAL_VALUES = 48

/** Sample residual share at or under which the registry counts as settled. */
const RESIDUAL_SETTLE_SHARE = 0.15
/**
 * An axis must place at least a quarter of the field to be worth harvesting
 * empty cells from — below that it describes a niche, not the field, and its
 * emptiness is mostly silence.
 *
 * Deliberately coarse. Values are keyword-matched vocabulary, not a partition,
 * so a perfectly good axis routinely places well under half the field while the
 * UNION of axes places nearly all of it (that union is what the settle test
 * reads). The fine discrimination lives at cell level instead:
 * unassignedOnB > marginA/2 flags exactly the case this ceiling was reaching
 * for — the arm in question mostly having no value on the opposing axis.
 */
const RESIDUAL_CEILING = 0.75
/** Sample-side axis overlap above which two dimensions restate each other. */
const REDUNDANCY_CEILING = 0.6
/** Chi-square cell-expectation rule: a zero is only surprising when >=5 were expected. */
const EXPECTED_FLOOR = 5
/** Candidate-value overlap with an incumbent above which it IS the incumbent. */
const VALUE_DUPLICATE_JACCARD = 0.8
const GAP_OUTPUT_CAP = 24

/**
 * The matching document: title + abstract ONLY — deliberately narrower than
 * SEARCH_TSVECTOR (which includes ragText). The model proposes vocabulary from
 * titles and abstracts, so counting against a wider document would make every
 * census count larger than the sample-side view the settle decision ran on.
 */
const DIMENSION_DOC = Prisma.sql`to_tsvector('english'::regconfig,
        coalesce(lp."title", '')     || ' ' ||
        coalesce(lp."abstract", '')  || ' ' ||
        coalesce(lp."abstractOriginal", ''))`

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

interface SampleRow {
  id: number
  familyKey: string
  publicationNumber: string
  title: string | null
  abstract: string
}

/** Working registry entry during the loop; sampleSet keys are family keys. Exported for tests. */
export interface WorkingValue {
  id: string
  label: string
  synonyms: string[]
  query: string
  round: number
  provenance: DimensionProvenance
  sampleSet: Set<string>
}

export interface WorkingDimension {
  id: string
  label: string
  labelKey: string
  description: string
  round: number
  values: WorkingValue[]
}

/** User-edited registry for a re-census run (params.registry). */
export interface SuppliedDimensionRegistry {
  dimensions: Array<{
    label: string
    description?: string
    values: Array<{ label: string; synonyms: string[] }>
  }>
}

interface DimensionProposalRaw {
  dimensions?: Array<{
    label?: unknown
    description?: unknown
    values?: Array<{ label?: unknown; synonyms?: unknown }>
  }>
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

async function withTimeout<T>(query: Prisma.Sql, ms: number): Promise<T[]> {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(ms)}, true)`,
    prisma.$queryRaw<T[]>(query),
  ])
  return rows
}

/**
 * Heartbeat + live narration in one write. Runs on its own pooled connection,
 * so it is safe to call while the census transaction is open elsewhere.
 *
 * Delegates to the shared heartbeat so the run's LEASE is extended as well as
 * its timestamp. This stage is by far the longest in the studio — the census
 * alone can hold a transaction for ten minutes — so a heartbeat that only
 * touched `heartbeatAt` would let the lease lapse mid-run and invite a second
 * worker to start the same dimension map over.
 */
async function progress(runId: string, workerId: string, phase: string, detail: string, round?: number): Promise<void> {
  await heartbeatRun(runId, workerId, { phase, detail, ...(round !== undefined ? { round } : {}) })
}

function normaliseLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function labelKeyOf(value: string): string {
  return normaliseLabel(value).toLowerCase()
}

/** Dedupe label + synonyms into the phrase list a value matches. */
function valueTerms(label: string, synonyms: string[]): string[] {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of [label, ...synonyms]) {
    const term = normaliseLabel(raw)
    if (!term) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push(term)
  }
  return terms
}

export function compileValueQuery(label: string, synonyms: string[]): string {
  return valueTerms(label, synonyms).map(quotePhrase).join(' OR ')
}

/** The text a value puts to the encoder: its deduped vocabulary as one subject. */
export function valueEmbeddingText(label: string, synonyms: string[]): string {
  return valueTerms(label, synonyms).join(', ')
}

// ---------------------------------------------------------------------------
// The semantic arm of VALUE matching
// ---------------------------------------------------------------------------

/**
 * Per-run state for matching families to values by MEANING as well as wording.
 *
 * Values are keyword vocabularies, and the same vocabulary trap that emptied
 * lexical-only fields empties cells: a family admitted to the field by
 * embedding similarity — which by definition uses different words — matches no
 * value's phrases, lands in the residual, and inflates exactly the empty cells
 * the gap detector reads. The semantic arm admits a family to a value when its
 * stored vector sits within the calibrated ceiling of the value's vocabulary.
 *
 * Same discipline as the field arm: gated on the SAME calibrated ceiling
 * (uncalibrated binary installations run wording-only, exactly as before), and
 * the SAME rule on both sides of the invariant — sample-side acceptance and the
 * final census — so the settle decision and the published numbers cannot
 * diverge. If embedding fails mid-run the lane switches off for everything
 * AFTER that point; `degraded` records it so the stage can say so rather than
 * publish the mismatch silently.
 *
 * The literal cache is why the arm is affordable: discovery rounds, the refresh
 * pass and the census all ask for the same value texts, and each text costs one
 * embedding exactly once.
 */
/**
 * One value's query vector and the ceiling that applies TO IT.
 *
 * The ceiling is per-vector, not per-lane: value texts are short phrases
 * ("aqueous electrolyte", "capacitive sensing") and each sits at its own mean
 * distance from the corpus, exactly like the scope-level probes do. A single
 * lane-wide constant matched far too much for some values and nothing for
 * others, which is invisible in the output — every value still reports a count.
 */
interface LaneVector {
  literal: string
  /** Normalised [0,1] ceiling for this vector. */
  ceiling: number
}

interface ValueSemanticLane {
  enabled: boolean
  /** Why the lane is off (never set while enabled). */
  reason: string | null
  /** How ceilings are decided for this lane's vectors. */
  policy: SemanticCeiling
  /** True when the lane failed AFTER matching had already used it. */
  degraded: boolean
  cache: Map<string, LaneVector | null>
}

async function createValueLane(): Promise<ValueSemanticLane> {
  const off = (reason: string): ValueSemanticLane => ({
    enabled: false,
    reason,
    policy: { mode: 'absolute', maxDistance: 0 },
    degraded: false,
    cache: new Map(),
  })
  if (!semanticLaneConfigured()) return off('Semantic search is not configured (no embedding key).')
  const policy = await resolveSemanticCeiling()
  if (!policy) return off(semanticArmUnavailableReason() ?? 'The semantic arm is switched off by configuration.')
  return { enabled: true, reason: null, policy, degraded: false, cache: new Map() }
}

/**
 * Vectors for the given texts, index-aligned, from the cache plus at most one
 * batched embedding call and one batched background query for the misses. An
 * embedding failure disables the lane (degraded, with the reason recorded) and
 * returns all-null — matching carries on wording-only rather than failing the
 * stage.
 */
async function laneLiterals(lane: ValueSemanticLane, texts: string[]): Promise<Array<LaneVector | null>> {
  if (!lane.enabled) return texts.map(() => null)
  const misses = Array.from(new Set(texts.filter(text => !lane.cache.has(text))))
  if (misses.length) {
    try {
      const embedded = await embedQueryTexts(misses)
      const policy = lane.policy
      let ceilings: Array<number | null>
      if (policy.mode === 'absolute') {
        ceilings = embedded.map(literal => (literal ? policy.maxDistance : null))
      } else {
        // One query for every miss: the background sample is materialised once
        // and cross-joined against all the literals, so adding the per-value
        // ceiling costs a single round trip per discovery round, not one per value.
        const background = await semanticBackground({ literals: embedded })
        ceilings = background.map(stats => (stats ? backgroundCeiling(stats, policy.z) : null))
      }
      misses.forEach((text, index) => {
        const literal = embedded[index]
        const ceiling = ceilings[index]
        // A value with no estimable ceiling stays wording-only rather than
        // borrowing another value's cut.
        lane.cache.set(text, literal && ceiling !== null ? { literal, ceiling } : null)
      })
    } catch (error) {
      lane.enabled = false
      lane.degraded = true
      console.error('[Whitespace] Value semantic lane disabled:', error instanceof Error ? error.message : error)
      lane.reason = `Embedding the value vocabularies failed mid-run: ${describeLaneError(error)}.`
      return texts.map(() => null)
    }
  }
  return texts.map(text => lane.cache.get(text) ?? null)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let intersection = 0
  a.forEach(key => {
    if (b.has(key)) intersection++
  })
  return intersection / (a.size + b.size - intersection)
}

/**
 * Sample-side overlap between two axes in [0,1]: the size-weighted mean, over
 * one axis's values, of the best Jaccard match among the other axis's values.
 * Symmetrised by taking the larger direction — "restates" is a directional
 * accusation and either direction convicts.
 */
export function dimensionRedundancy(a: WorkingDimension, b: WorkingDimension): number {
  const directed = (from: WorkingDimension, to: WorkingDimension): number => {
    let weight = 0
    let total = 0
    for (const value of from.values) {
      if (!value.sampleSet.size) continue
      let best = 0
      for (const other of to.values) {
        const overlap = jaccard(value.sampleSet, other.sampleSet)
        if (overlap > best) best = overlap
      }
      weight += value.sampleSet.size
      total += best * value.sampleSet.size
    }
    return weight ? total / weight : 0
  }
  return Math.max(directed(a, b), directed(b, a))
}

/** numnode() per query; 0 nodes = stems to nothing = would fabricate a gap. */
async function queryNodeCounts(queries: string[]): Promise<number[]> {
  if (!queries.length) return []
  const rows = await prisma.$queryRaw<Array<{ idx: number; nodes: number }>>(Prisma.sql`
    SELECT idx::int AS idx, numnode(websearch_to_tsquery('english'::regconfig, q))::int AS nodes
    FROM unnest(${queries}::text[]) WITH ORDINALITY AS t(q, idx)`)
  const nodes = new Array<number>(queries.length).fill(0)
  for (const row of rows) nodes[row.idx - 1] = Number(row.nodes)
  return nodes
}

/**
 * Assigns the sample to values — in SQL, over the UNTRUNCATED document, with
 * the exact expressions the census uses. The prompt's 400-char abstracts are a
 * display slice; the measurement never reads them.
 *
 * Two arms, unioned per value, mirroring the census by construction:
 *   - lexical: the value's phrase vocabulary against the tsvector document;
 *   - semantic (when the lane is on): the family's stored vector within the
 *     calibrated ceiling of the value's vocabulary embedding.
 */
async function assignSample(
  sampleIds: number[],
  idToFamily: Map<number, string>,
  queries: string[],
  semantic?: { lane: ValueSemanticLane; texts: string[] }
): Promise<Array<Set<string>>> {
  const sets: Array<Set<string>> = queries.map(() => new Set<string>())
  if (!queries.length || !sampleIds.length) return sets
  const rows = await withTimeout<{ id: number; value_idx: number }>(
    Prisma.sql`
      WITH q AS (
        SELECT t.idx::int AS value_idx, websearch_to_tsquery('english'::regconfig, t.q) AS tsq
        FROM unnest(${queries}::text[]) WITH ORDINALITY AS t(q, idx)
      )
      SELECT lp."id" AS id, q.value_idx AS value_idx
      FROM "local_patents" lp
      CROSS JOIN q
      WHERE lp."id" = ANY(${sampleIds}::int[])
        AND ${DIMENSION_DOC} @@ q.tsq`,
    PRECHECK_TIMEOUT_MS
  )
  for (const row of rows) {
    const family = idToFamily.get(Number(row.id))
    const set = sets[Number(row.value_idx) - 1]
    if (family && set) set.add(family)
  }

  if (semantic?.lane.enabled) {
    const vectors = await laneLiterals(semantic.lane, semantic.texts)
    if (vectors.some(Boolean)) {
      // Nulls travel as '' so ordinality keeps every literal aligned with its
      // value index; the WHERE filters them after the index is assigned. The
      // ceiling rides alongside because it now varies per value, not per lane.
      const padded = vectors.map(vector => vector?.literal ?? '')
      const ceilings = vectors.map(vector => vector?.ceiling ?? 0)
      try {
        // The literals are parsed into vectors once, in the CTE (q.v), not once
        // per (sample row × value) inside the distance test — see
        // semanticBackground for the measurement behind this.
        const semanticRows = await withTimeout<{ id: number; value_idx: number }>(
          Prisma.sql`
            WITH q AS MATERIALIZED (
              SELECT t.idx::int AS value_idx, ${literalVectorSql(Prisma.sql`t.lit`)} AS v, t.cutoff AS cutoff
              FROM unnest(${padded}::text[], ${ceilings}::float8[]) WITH ORDINALITY AS t(lit, cutoff, idx)
              WHERE t.lit <> ''
            )
            SELECT e."localPatentId" AS id, q.value_idx AS value_idx
            FROM "local_patent_embeddings" e
            CROSS JOIN q
            WHERE e."localPatentId" = ANY(${sampleIds}::int[])
              AND ${comparableVectorSql()}
              AND ${semanticMatchSql(Prisma.sql`q.v`, Prisma.sql`q.cutoff`)}`,
          PRECHECK_TIMEOUT_MS
        )
        for (const row of semanticRows) {
          const family = idToFamily.get(Number(row.id))
          const set = sets[Number(row.value_idx) - 1]
          if (family && set) set.add(family)
        }
      } catch (error) {
        // Same degradation contract as a failed embedding: wording-only from
        // here on, and the stage says so instead of publishing the mismatch.
        semantic.lane.enabled = false
        semantic.lane.degraded = true
        console.error('[Whitespace] Value semantic lane disabled:', error instanceof Error ? error.message : error)
        semantic.lane.reason = `Semantic value matching failed mid-run: ${describeLaneError(error, PRECHECK_TIMEOUT_MS)}.`
      }
    }
  }
  return sets
}

function assignedUnion(registry: WorkingDimension[]): Set<string> {
  const union = new Set<string>()
  for (const dimension of registry) {
    for (const value of dimension.values) {
      value.sampleSet.forEach(family => union.add(family))
    }
  }
  return union
}

function totalValues(registry: WorkingDimension[]): number {
  return registry.reduce((sum, dimension) => sum + dimension.values.length, 0)
}

function tooNarrowMessage(
  familyCount: number,
  scope: WhitespaceScope,
  semanticNote?: string,
  rule?: FieldRule | null
): string {
  const required = scope.concepts.filter(concept => concept.required && concept.label.trim())

  // Nothing at all is a different diagnosis from "a few": the scope missed on
  // both wording and meaning, so the structural filters are the first suspect
  // and the intersecting-concepts advice below would be a guess.
  if (familyCount === 0) return emptyFieldAdvice(scope, semanticNote, rule)

  const head =
    `This field has ${familyCount.toLocaleString()} families — too few to grid by viewpoint. ` +
    `Below ~${MIN_FIELD_FAMILIES} families the average cell holds fewer than two families whatever the technology looks like, ` +
    `so empty cells would be arithmetic rather than absence.${ladderSummary(rule)} `

  // A pinned rule above the loosest rung is the first thing to name: the study
  // was told not to look wider.
  if (rule && rule.mode === 'pinned' && rule.optionalCount > 0 && rule.minimumOptional > minimumRungFor(rule)) {
    // wideningAdviceFor names the pinned rung and what to do about it.
    return head + wideningAdviceFor(scope, rule)
  }

  // Intersecting must-appear concepts is by far the most common cause, and the
  // generic "widen the scope" advice sends people to the wrong dial. When two
  // or more are marked, name them and say what to do.
  if (required.length >= 2) {
    return (
      head +
      `${required.length} concepts are marked as must-appear (${required
        .map(concept => `"${concept.label}"`)
        .join(', ')}), and must-appear concepts INTERSECT: a document has to contain every one of them to be counted. ` +
      `Documents in the field around your invention solve the same problem in other ways and rarely contain all of its elements at once, ` +
      `which is what empties the field. Make all but one optional — the match rule then decides how many of the others a document needs, and auto picks the tightest number that still yields a field — then run this again.`
    )
  }

  return (
    head +
    `${wideningAdviceFor(scope, rule)} ` +
    `Or read the field directly with the landscape pipeline: at this size it fits inside one deep dive.`
  )
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

export async function runDimensionMapStage(input: {
  runId: string
  workerId: string
  studyId: string
  scope: WhitespaceScope
  llmContext: WhitespaceLLMContext
  suppliedRegistry?: SuppliedDimensionRegistry | null
}): Promise<DimensionMapResult> {
  const { runId, workerId, studyId, scope } = input
  // Outside any transaction: a scope whose concepts stem away must fail with
  // the concept named, not census a silently different field. Checked on the
  // loosest plan — every rung searches the same groups.
  const conceptQuery = buildConceptQuery(scope)
  if (conceptQuery) await assertConceptQueryUsable(conceptQuery)

  // The field: semantic candidates + the match rule. A discovery run is a
  // PRODUCER and fits the rule fresh; a re-census over a user-edited registry
  // reuses the rule the discovery run persisted, so the user's edit recounts
  // the same field rather than a re-fitted one.
  await progress(runId, workerId, 'precheck', 'Sizing the field')
  const field = await resolveFieldDefinition(scope, { studyId, reuse: Boolean(input.suppliedRegistry) })
  const { candidates, rule } = field
  const where = field.where
  const coverageNotes: string[] = [...field.coverageNotes]
  // One lane for the whole run: discovery, refresh and census share its literal
  // cache, which is what keeps the semantic arm to one embedding per value text.
  const valueLane = await createValueLane()

  // --- Pre-check: size the field, refuse too broad AND too narrow -----------
  // The fit already measured the chosen rung exactly when it was under the
  // ceiling; only a pinned or reused rule needs sizing here — and then as a
  // BOUNDED count (LIMIT cap + 1), so a broad field answers "more than the cap"
  // in seconds instead of running an unbounded COUNT into the timeout.
  let familyCount = 0
  let publicationCount = 0
  if (field.measured) {
    familyCount = field.measured.families
    publicationCount = field.measured.publications
  } else {
    try {
      const totals = await withTimeout<{ families: bigint; publications: bigint }>(
        Prisma.sql`
          SELECT COUNT(DISTINCT t.family_key)::bigint AS families,
                 COUNT(*)::bigint                    AS publications
          FROM (
            SELECT COALESCE(lp."familyId", lp."publicationNumber") AS family_key
            FROM "local_patents" lp
            WHERE ${where}
            LIMIT ${DIMENSION_ROW_CAP + 1}
          ) t`,
        PRECHECK_TIMEOUT_MS
      )
      familyCount = Number(totals[0]?.families ?? 0)
      publicationCount = Number(totals[0]?.publications ?? 0)
    } catch (error) {
      if (isStatementTimeout(error)) {
        throw new WhitespacePermanentError(
          `This field is too broad to size within ${Math.round(PRECHECK_TIMEOUT_MS / 1000)}s. ${narrowingAdvice(scope, rule)}`
        )
      }
      throw error
    }
  }
  if (publicationCount > DIMENSION_ROW_CAP) {
    throw new WhitespacePermanentError(
      `This field matches more than ${DIMENSION_ROW_CAP.toLocaleString()} publications — more than the dimension census will read exactly. ` +
        `A dimension map matches every viewpoint value against every document, so it ` +
        `reads a smaller field than the landscape census does. ${narrowingAdvice(scope, rule)}`
    )
  }
  if (familyCount < MIN_FIELD_FAMILIES) {
    throw new WhitespacePermanentError(tooNarrowMessage(familyCount, scope, candidates.reason, rule))
  }

  // --- Deterministic sample --------------------------------------------------
  // Hash the FAMILY key (stable business key, unlike the autoincrement id) with
  // a full DISTINCT ON tiebreak, so the same scope always draws the same sample.
  await progress(
    runId,
    workerId,
    'sample',
    `Drawing a ${SAMPLE_FAMILIES.toLocaleString()}-family sample of ${familyCount.toLocaleString()} families`
  )
  const sampleRows = await withTimeout<SampleRow>(
    Prisma.sql`
      SELECT t.*
      FROM (
        SELECT DISTINCT ON (COALESCE(lp."familyId", lp."publicationNumber"))
               lp."id"                                         AS id,
               COALESCE(lp."familyId", lp."publicationNumber") AS "familyKey",
               lp."publicationNumber"                          AS "publicationNumber",
               lp."title"                                      AS title,
               left(coalesce(lp."abstract", lp."abstractOriginal", ''), 400) AS abstract
        FROM "local_patents" lp
        WHERE ${where}
        ORDER BY COALESCE(lp."familyId", lp."publicationNumber"),
                 lp."publicationDate" DESC NULLS LAST,
                 lp."publicationNumber"
      ) t
      ORDER BY md5(t."familyKey")
      LIMIT ${SAMPLE_FAMILIES}`,
    PRECHECK_TIMEOUT_MS
  )
  const sampleN = sampleRows.length
  const sampleIds = sampleRows.map(row => Number(row.id))
  const idToFamily = new Map<number, string>(sampleRows.map(row => [Number(row.id), row.familyKey]))

  // --- Registry: supplied (re-census) or discovered (the round loop) ---------
  const rounds: DimensionRound[] = []
  let registry: WorkingDimension[]
  let settledReason: DimensionSettledReason

  if (input.suppliedRegistry) {
    registry = await compileSuppliedRegistry(input.suppliedRegistry, sampleIds, idToFamily, valueLane, coverageNotes)
    settledReason = 'REGISTRY_SUPPLIED'
    coverageNotes.push('Viewpoints were supplied by the user (registry edit); discovery did not re-run.')
  } else {
    const discovered = await discoverRegistry({
      runId,
      workerId,
      studyId,
      scope,
      llmContext: input.llmContext,
      sampleRows,
      sampleIds,
      idToFamily,
      rounds,
      valueLane,
    })
    registry = discovered.registry
    settledReason = discovered.settledReason
  }

  if (!registry.length || totalValues(registry) < 4) {
    // Two different audiences: discovery failed on its own proposals, but a
    // supplied registry failed on the USER'S edit — telling that user to
    // "sharpen the invention description" points at a dial they did not touch.
    throw new WhitespacePermanentError(
      input.suppliedRegistry
        ? 'The edited registry compiles to fewer than four measurable values — each viewpoint needs at least two values ' +
            'whose vocabulary survives common-word removal. Add or reword values in the registry editor, then re-count.'
        : 'The field sample did not organise into measurable viewpoints — too few proposals survived counting. ' +
            'Sharpen the invention description (what problem, what mechanism) and re-run, or use the landscape pipeline for this field.'
    )
  }

  // Flat value index across the registry: the census counts by this index.
  const flatValues: WorkingValue[] = []
  const flatDimIdx: number[] = []
  registry.forEach((dimension, dimIdx) => {
    for (const value of dimension.values) {
      flatValues.push(value)
      flatDimIdx.push(dimIdx)
    }
  })

  // --- The exact census + gap detection (one transaction) ---------------------
  await progress(runId, workerId, 'census', `Counting ${flatValues.length} values across ${familyCount.toLocaleString()} families`)
  // Outside the transaction, deliberately: the discovery rounds already cached
  // these literals, so this is normally a pure cache read — but a cold miss is
  // an embedding API call, and an API call must never hold the census
  // transaction (and its temp tables' connection) open.
  const censusLiterals = await laneLiterals(
    valueLane,
    flatValues.map(value => valueEmbeddingText(value.label, value.synonyms))
  )
  // The semantic arm turns each value probe from a GIN index probe into an
  // additional join-scan of the staged set; budget accordingly.
  const censusTxTimeout =
    2 * CENSUS_TIMEOUT_MS + MAX_TOTAL_VALUES * (valueLane.enabled ? 5_000 : 2_000) + 8 * FACET_TIMEOUT_MS + 20_000
  const facetGaps: string[] = []

  const census = await prisma.$transaction(
    async tx => {
      // The single pass over the corpus.
      await setStatementTimeout(tx, CENSUS_TIMEOUT_MS)
      try {
        await tx.$executeRaw(Prisma.sql`
          CREATE TEMP TABLE ws_dim_census ON COMMIT DROP AS
          SELECT lp."id"                                         AS id,
                 COALESCE(lp."familyId", lp."publicationNumber") AS family_key,
                 ${DIMENSION_DOC}                                AS doc
          FROM "local_patents" lp
          WHERE ${where}
          LIMIT ${DIMENSION_ROW_CAP + 1}`)
      } catch (error) {
        if (isStatementTimeout(error)) {
          throw new WhitespacePermanentError(
            `This field is too broad to stage within ${Math.round(CENSUS_TIMEOUT_MS / 1000)}s. ${narrowingAdvice(scope, rule)}`
          )
        }
        throw error
      }

      // Size — not savepoint-tolerant: every share is a proportion of this.
      await setStatementTimeout(tx, FACET_TIMEOUT_MS)
      const totals = await tx.$queryRaw<Array<{ families: bigint; publications: bigint }>>(Prisma.sql`
        SELECT COUNT(DISTINCT family_key)::bigint AS families, COUNT(*)::bigint AS publications
        FROM ws_dim_census`)
      const censusFamilies = Number(totals[0]?.families ?? 0)
      const censusPublications = Number(totals[0]?.publications ?? 0)
      if (censusPublications > DIMENSION_ROW_CAP) {
        throw new WhitespacePermanentError(
          `This field matches more than ${DIMENSION_ROW_CAP.toLocaleString()} publications — bigger than the dimension census will count exactly. ${narrowingAdvice(scope, rule)}`
        )
      }

      // 2% of the CENSUS denominator, not the pre-check familyCount: gaps are
      // measured against censusFamilies, and a floor computed off a different
      // (estimated or stale) total silently loosens or tightens every margin.
      const marginFloor = Math.max(30, Math.ceil(0.02 * censusFamilies))

      // How much of the field the semantic arm can actually see. Families with
      // no comparable vector are matchable by wording only, and if that share
      // is large the reader must know it before trusting cell emptiness.
      let embeddedFamilies: number | null = null
      if (valueLane.enabled) {
        const embeddedRows = await facet<{ families: bigint }>(
          tx,
          'semanticCoverage',
          Prisma.sql`
            SELECT COUNT(DISTINCT c.family_key)::bigint AS families
            FROM ws_dim_census c
            JOIN "local_patent_embeddings" e ON e."localPatentId" = c.id
            WHERE ${comparableVectorSql()}`,
          facetGaps
        )
        if (embeddedRows) embeddedFamilies = Number(embeddedRows[0]?.families ?? 0)
      }

      // The GIN index is what turns M value probes from M sequential scans into
      // M index probes; ANALYZE is what convinces the planner to use it.
      await setStatementTimeout(tx, CENSUS_TIMEOUT_MS)
      await tx.$executeRaw(Prisma.sql`CREATE INDEX ws_dim_census_doc_idx ON ws_dim_census USING gin(doc)`)
      await tx.$executeRawUnsafe(`ANALYZE ws_dim_census`)
      await progress(runId, workerId, 'census', `Matching ${flatValues.length} value vocabularies`)

      // Hit extraction: one bounded probe per value. Bare — a value that cannot
      // be counted fails the census; counting it as zero would fabricate a gap.
      //
      // Each probe is the SAME two-arm rule assignSample applied to the sample:
      // wording (tsquery over the staged doc) UNION meaning (stored vector
      // within the ceiling of the value's vocabulary embedding). UNION rather
      // than OR so the lexical arm keeps its GIN plan, and the DISTINCT the
      // margins depend on is preserved by construction.
      await tx.$executeRaw(Prisma.sql`
        CREATE TEMP TABLE ws_dim_hits (family_key TEXT NOT NULL, value_idx INT NOT NULL) ON COMMIT DROP`)
      await setStatementTimeout(tx, FACET_TIMEOUT_MS)
      try {
        for (let m = 0; m < flatValues.length; m++) {
          const vector = valueLane.enabled ? censusLiterals[m] : null
          if (vector) {
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO ws_dim_hits
              SELECT DISTINCT u.family_key, ${m}::int
              FROM (
                SELECT c.family_key
                FROM ws_dim_census c
                WHERE c.doc @@ websearch_to_tsquery('english'::regconfig, ${flatValues[m].query})
                UNION
                SELECT c.family_key
                FROM ws_dim_census c
                JOIN "local_patent_embeddings" e ON e."localPatentId" = c.id
                WHERE ${comparableVectorSql()}
                  AND ${semanticMatchSql(vectorParamSql(vector.literal), vector.ceiling)}
              ) u`)
          } else {
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO ws_dim_hits
              SELECT DISTINCT family_key, ${m}::int
              FROM ws_dim_census
              WHERE doc @@ websearch_to_tsquery('english'::regconfig, ${flatValues[m].query})`)
          }
          if (m % 8 === 7) await progress(runId, workerId, 'census', `Matched ${m + 1} of ${flatValues.length} values`)
        }
      } catch (error) {
        if (isStatementTimeout(error)) {
          throw new Error(
            `Counting the viewpoint vocabularies timed out. A value's synonym list may be matching most of the corpus — ` +
              `trim overly generic synonyms and re-run.`
          )
        }
        throw error
      }
      await tx.$executeRaw(Prisma.sql`CREATE INDEX ws_dim_hits_family_idx ON ws_dim_hits (family_key)`)
      await tx.$executeRawUnsafe(`ANALYZE ws_dim_hits`)

      // Per-value margins.
      const valueRows = await tx.$queryRaw<Array<{ value_idx: number; families: bigint }>>(Prisma.sql`
        SELECT value_idx, COUNT(*)::bigint AS families FROM ws_dim_hits GROUP BY 1`)
      const valueFamilies = new Array<number>(flatValues.length).fill(0)
      for (const row of valueRows) valueFamilies[Number(row.value_idx)] = Number(row.families)

      // Every cell of every matrix, one self-join. Volume is sum(k^2) over
      // families, which MAX_TOTAL_VALUES bounds — this is the second long pole.
      await setStatementTimeout(tx, CENSUS_TIMEOUT_MS)
      await progress(runId, workerId, 'census', 'Computing pairwise co-occupancy')
      const pairRows = await tx.$queryRaw<Array<{ a_idx: number; b_idx: number; families: bigint }>>(Prisma.sql`
        SELECT a.value_idx AS a_idx, b.value_idx AS b_idx, COUNT(*)::bigint AS families
        FROM ws_dim_hits a
        JOIN ws_dim_hits b USING (family_key)
        WHERE a.value_idx < b.value_idx
        GROUP BY 1, 2`)
      const pairCounts = new Map<string, number>()
      for (const row of pairRows) pairCounts.set(`${Number(row.a_idx)}:${Number(row.b_idx)}`, Number(row.families))

      // Families each dimension places, and families any dimension places.
      await setStatementTimeout(tx, FACET_TIMEOUT_MS)
      const dimRows = await tx.$queryRaw<Array<{ dim_idx: number; families: bigint }>>(Prisma.sql`
        SELECT d.dim_idx AS dim_idx, COUNT(DISTINCT h.family_key)::bigint AS families
        FROM ws_dim_hits h
        JOIN unnest(${flatValues.map((_, index) => index)}::int[], ${flatDimIdx}::int[]) AS d(value_idx, dim_idx)
          ON d.value_idx = h.value_idx
        GROUP BY 1`)
      const dimensionAssigned = new Array<number>(registry.length).fill(0)
      for (const row of dimRows) dimensionAssigned[Number(row.dim_idx)] = Number(row.families)
      const anyRows = await tx.$queryRaw<Array<{ families: bigint }>>(Prisma.sql`
        SELECT COUNT(DISTINCT family_key)::bigint AS families FROM ws_dim_hits`)
      const assignedAnyFamilies = Number(anyRows[0]?.families ?? 0)

      // Gap detection is pure arithmetic; running it here lets the arm-claims
      // facet read the temp tables before they drop with the commit.
      const { matrices, gaps } = detectGaps({
        registry,
        flatValues,
        flatDimIdx,
        familyCount: censusFamilies,
        valueFamilies,
        dimensionAssigned,
        pairCounts,
        marginFloor,
      })

      // Claims readability of each gap's surrounding families (both arms,
      // unioned per gap). Savepoint-tolerant: gap cards show "not measured"
      // rather than the stage failing over an optional signal.
      let armClaimsAvailable = false
      if (gaps.length) {
        const gapIdxs: number[] = []
        const gapValueIdxs: number[] = []
        gaps.forEach((gap, gapIdx) => {
          const aIdx = flatValues.findIndex(value => value.id === gap.aValueId)
          const bIdx = flatValues.findIndex(value => value.id === gap.bValueId)
          gapIdxs.push(gapIdx, gapIdx)
          gapValueIdxs.push(aIdx, bIdx)
        })
        const armRows = await facet<{ gap_idx: number; families: bigint; with_claims: bigint }>(
          tx,
          'armClaims',
          Prisma.sql`
            SELECT g.gap_idx AS gap_idx,
                   COUNT(DISTINCT c.family_key)::bigint AS families,
                   COUNT(DISTINCT c.family_key) FILTER (
                     WHERE v."claimsAvailability" IN ('FULL_EPO', 'FULL', 'FIRST_CLAIM_ONLY')
                   )::bigint AS with_claims
            FROM unnest(${gapIdxs}::int[], ${gapValueIdxs}::int[]) AS g(gap_idx, value_idx)
            JOIN ws_dim_hits h ON h.value_idx = g.value_idx
            JOIN ws_dim_census c ON c.family_key = h.family_key
            JOIN "patent_text_availability" v ON v."id" = c.id
            GROUP BY 1`,
          facetGaps
        )
        if (armRows) {
          armClaimsAvailable = true
          for (const row of armRows) {
            const gap = gaps[Number(row.gap_idx)]
            if (!gap) continue
            gap.armFamilies = Number(row.families)
            gap.armClaimsReadable = Number(row.with_claims)
          }
        }
      }
      finaliseGaps(gaps, marginFloor)

      return {
        familyCount: censusFamilies,
        publicationCount: censusPublications,
        valueFamilies,
        dimensionAssigned,
        assignedAnyFamilies,
        matrices,
        gaps,
        armClaimsAvailable,
        embeddedFamilies,
        marginFloor,
      }
    },
    { timeout: censusTxTimeout, maxWait: 20_000 }
  )

  // --- Assemble the result (pure arithmetic from here) ------------------------
  await progress(runId, workerId, 'assemble', 'Assembling the registry and gap list')

  let flatCursor = 0
  const resultRegistry: Dimension[] = registry.map((dimension, dimIdx) => {
    const values: DimensionValue[] = dimension.values.map(value => {
      const families = census.valueFamilies[flatCursor] ?? 0
      flatCursor++
      return {
        id: value.id,
        label: value.label,
        synonyms: value.synonyms,
        query: value.query,
        families,
        share: census.familyCount ? families / census.familyCount : 0,
        sampleFamilies: value.sampleSet.size,
        round: value.round,
        provenance: value.provenance,
      }
    })
    const assigned = census.dimensionAssigned[dimIdx] ?? 0
    const sumValueFamilies = values.reduce((sum, value) => sum + value.families, 0)
    const sampleAssigned = new Set<string>()
    for (const value of dimension.values) value.sampleSet.forEach(family => sampleAssigned.add(family))
    return {
      id: dimension.id,
      label: dimension.label,
      description: dimension.description,
      values,
      introducedInRound: dimension.round,
      assignedFamilies: assigned,
      residualFamilies: census.familyCount - assigned,
      residualShare: census.familyCount ? (census.familyCount - assigned) / census.familyCount : 1,
      multiAssignmentRatio: assigned ? sumValueFamilies / assigned : 0,
      sampleAssignedFamilies: sampleAssigned.size,
      sampleResidualShare: sampleN ? (sampleN - sampleAssigned.size) / sampleN : 1,
    }
  })

  // Representative-vs-family divergence, measured not hidden: the census reads
  // every publication of a family, the sample read one representative each.
  for (const dimension of resultRegistry) {
    if (Math.abs(dimension.sampleResidualShare - dimension.residualShare) > 0.1) {
      coverageNotes.push(
        `Viewpoint "${dimension.label}" left ${Math.round(dimension.sampleResidualShare * 100)}% of the discovery sample unplaced but ` +
          `${Math.round(dimension.residualShare * 100)}% of the full field. The census reads every publication in a family; the sample ` +
          `read one representative each. The census number is the one to trust.`
      )
    }
  }

  if (!census.armClaimsAvailable) {
    coverageNotes.push('Claims readability for gap arms could not be computed — gap cards show it as unmeasured.')
  }
  if (facetGaps.length) {
    coverageNotes.push(
      `These parts of the map could not be computed and are missing rather than empty: ${facetGaps.join(', ')}.`
    )
  }
  coverageNotes.push(
    `Viewpoint discovery read a ${sampleN.toLocaleString()}-family sample (${Math.round(
      (sampleN / Math.max(1, census.familyCount)) * 100
    )}% of the field); every published count is an exact SQL census of the full field.`
  )
  // How families were matched to values — the reader is entitled to know which
  // rule produced the counts before drawing a conclusion from cell emptiness.
  if (valueLane.enabled) {
    const embeddedPct =
      census.embeddedFamilies !== null && census.familyCount
        ? Math.round((census.embeddedFamilies / census.familyCount) * 100)
        : null
    // Under `adaptive` there is no single ceiling to quote — each value gets its
    // own — so the note states the RULE. Quoting one value's number as though it
    // governed the whole grid would be the same false precision the lane-wide
    // constant used to imply.
    const rule =
      valueLane.policy.mode === 'adaptive'
        ? `each value's embedding-distance ceiling set ${valueLane.policy.z.toFixed(1)} standard deviations below its own mean distance to the corpus`
        : `embedding-distance ceiling ${valueLane.policy.maxDistance}`
    coverageNotes.push(
      `Families were matched to values by wording OR meaning (${rule})` +
        (embeddedPct !== null ? `; ${embeddedPct}% of the field carries a comparable vector.` : '.')
    )
    if (embeddedPct !== null && embeddedPct < 70) {
      coverageNotes.push(
        'A substantial share of this field carries no embedding vector and could only be matched by wording — its cell placements may undercount.'
      )
    }
  } else if (valueLane.degraded) {
    coverageNotes.push(
      `Semantic value matching switched off partway through this run — ${valueLane.reason} Counts after that point are wording-only, so cell placements may sit below what viewpoint discovery saw.`
    )
  } else if (valueLane.reason) {
    coverageNotes.push(`Families were matched to values by wording alone — ${valueLane.reason}`)
  }
  coverageNotes.push(
    'Value matching reads titles and abstracts. A family whose distinguishing vocabulary appears only in claims or description is not placed.'
  )

  const limitations = [
    'Emptiness is measured against this corpus at title-and-abstract level — an empty cell is a strong lead, not a freedom-to-operate conclusion.',
    'A family can occupy several values of one viewpoint, so value counts are vocabulary matches, never shares of a whole.',
    'No citation data, legal status or commercial evidence is available to this analysis.',
    `No art before ${Math.max(scope.filters.yearFrom, CORPUS_FIRST_YEAR)} was searched — outside the scope's filing window.`,
  ]

  const unclassifiedFamilies = census.familyCount - census.assignedAnyFamilies
  await progress(runId, workerId, 'done', `${resultRegistry.length} viewpoints, ${census.gaps.length} candidate gaps`)

  return {
    familyCount: census.familyCount,
    publicationCount: census.publicationCount,
    sample: {
      families: sampleN,
      weight: sampleN ? census.familyCount / sampleN : 0,
      method: 'md5-family-key',
    },
    registry: resultRegistry,
    rounds,
    settled: settledReason !== 'MAX_ROUNDS',
    settledReason,
    matrices: census.matrices,
    gaps: census.gaps,
    thresholds: {
      marginFloor: census.marginFloor,
      expectedFloor: EXPECTED_FLOOR,
      residualCeiling: RESIDUAL_CEILING,
      redundancyCeiling: REDUNDANCY_CEILING,
    },
    unclassifiedFamilies,
    unclassifiedShare: census.familyCount ? unclassifiedFamilies / census.familyCount : 1,
    coverageNotes,
    limitations,
    fieldRule: rule,
    generatedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Discovery: the round loop
// ---------------------------------------------------------------------------

async function discoverRegistry(input: {
  runId: string
  workerId: string
  studyId: string
  scope: WhitespaceScope
  llmContext: WhitespaceLLMContext
  sampleRows: SampleRow[]
  sampleIds: number[]
  idToFamily: Map<number, string>
  rounds: DimensionRound[]
  valueLane: ValueSemanticLane
}): Promise<{ registry: WorkingDimension[]; settledReason: DimensionSettledReason }> {
  const { runId, workerId, sampleRows, sampleIds, idToFamily, rounds, valueLane } = input
  const sampleN = sampleRows.length
  /**
   * A position on an axis has to cover a meaningful slice of the field. At 1%
   * the accepted values were vocabulary noise: each placed a handful of
   * documents, so every axis built from them was blind to 95% of the field and
   * no pair could honestly be read for emptiness. 5% mirrors the same instinct
   * as rarity.ts's support floor — only distinctions the field has independently
   * established are worth measuring emptiness between.
   */
  const valueFloor = Math.max(8, Math.ceil(0.05 * sampleN))

  // The invention brief is context for WHICH axes matter, not a document to
  // classify. Falls back to the seed text, then the scope summary.
  const study = await prisma.whitespaceStudy.findUnique({
    where: { id: input.studyId },
    select: { inventionJson: true, seedText: true },
  })
  const invention = (study?.inventionJson ?? null) as { problem?: string; approach?: string; constraints?: string } | null
  const inventionBrief =
    [
      invention?.problem ? `PROBLEM: ${invention.problem}` : null,
      invention?.approach ? `APPROACH: ${invention.approach}` : null,
      invention?.constraints ? `CONSTRAINTS: ${invention.constraints}` : null,
    ]
      .filter(Boolean)
      .join('\n') ||
    study?.seedText ||
    input.scope.summary ||
    input.scope.title

  const registry: WorkingDimension[] = []
  const rejectedForPrompt: Array<{ label: string; detail: string }> = []
  let settledReason: DimensionSettledReason = 'MAX_ROUNDS'

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const union = assignedUnion(registry)
    const residualRows = sampleRows.filter(row => !union.has(row.familyKey))

    const slice = round === 1 ? sampleRows.slice(0, SEED_SLICE) : residualRows.slice(0, GROW_SLICE)
    const sliceDocs = slice.map(row => ({
      publicationNumber: row.publicationNumber,
      title: row.title || row.publicationNumber,
      abstract: row.abstract,
    }))

    await progress(
      runId,
      workerId,
      'discover',
      round === 1
        ? `Round 1: proposing viewpoints from ${slice.length} sampled families`
        : `Round ${round}: reading ${slice.length} of ${residualRows.length} unplaced families`,
      round
    )

    const record: DimensionRound = {
      round,
      slice: { families: slice.length, basis: round === 1 ? 'sample' : 'residual' },
      proposedDimensions: [],
      proposedValues: [],
      acceptedDimensions: [],
      acceptedValues: [],
      rejected: [],
      residualShareAfter: sampleN ? residualRows.length / sampleN : 1,
      modelCode: null,
    }

    const prompt =
      round === 1
        ? buildDimensionSeedPrompt({
            inventionBrief,
            fieldTitle: input.scope.title,
            scopeSummary: input.scope.summary,
            sample: sliceDocs,
            maxDimensions: MAX_DIMENSIONS,
            maxValuesPerDimension: MAX_VALUES_PER_DIM,
          })
        : buildDimensionGrowPrompt({
            inventionBrief,
            fieldTitle: input.scope.title,
            registry: registry.map(dimension => ({
              label: dimension.label,
              values: dimension.values.map(value => value.label),
            })),
            residualSample: sliceDocs,
            residualCount: residualRows.length,
            sampleCount: sampleN,
            rejectedEarlier: rejectedForPrompt.slice(-10),
            maxDimensions: MAX_DIMENSIONS,
            maxValuesPerDimension: MAX_VALUES_PER_DIM,
          })

    const response = await runWhitespaceLLM({
      taskCode: TaskCode.WS_DIMENSIONS,
      stageCode: round === 1 ? WS_DIMENSION_SEED_STAGE_CODE : WS_DIMENSION_GROW_STAGE_CODE,
      prompt,
      context: input.llmContext,
    })
    record.modelCode = response.modelCode ?? null
    const parsed = parseModelJson<DimensionProposalRaw>(response.output, 'Viewpoint discovery')

    // --- normalise the proposal ---------------------------------------------
    interface CandidateValue {
      label: string
      synonyms: string[]
      query: string
    }
    interface CandidateDimension {
      label: string
      labelKey: string
      description: string
      existing: WorkingDimension | null
      values: CandidateValue[]
    }
    const candidates: CandidateDimension[] = []
    for (const rawDimension of (parsed.dimensions ?? []).slice(0, MAX_DIMENSIONS)) {
      const label = typeof rawDimension.label === 'string' ? normaliseLabel(rawDimension.label).slice(0, 80) : ''
      if (!label) continue
      const labelKey = labelKeyOf(label)
      const existing = registry.find(dimension => dimension.labelKey === labelKey) ?? null
      const description =
        typeof rawDimension.description === 'string' ? rawDimension.description.trim().slice(0, 300) : ''
      const values: CandidateValue[] = []
      for (const rawValue of (Array.isArray(rawDimension.values) ? rawDimension.values : []).slice(
        0,
        MAX_VALUES_PER_DIM
      )) {
        const valueLabel = typeof rawValue.label === 'string' ? normaliseLabel(rawValue.label).slice(0, 80) : ''
        if (!valueLabel) continue
        const synonyms = (Array.isArray(rawValue.synonyms) ? rawValue.synonyms : [])
          .filter((synonym): synonym is string => typeof synonym === 'string')
          .map(synonym => normaliseLabel(synonym).slice(0, 80))
          .filter(Boolean)
          .slice(0, 10)
        const query = compileValueQuery(valueLabel, synonyms)
        if (!query) continue
        values.push({ label: valueLabel, synonyms, query })
      }
      if (!values.length) continue
      candidates.push({ label, labelKey, description, existing, values })
      record.proposedDimensions.push(label)
      for (const value of values) record.proposedValues.push({ dimension: label, value: value.label })
    }

    // --- measure everything at once -----------------------------------------
    const allCandidateValues = candidates.flatMap(candidate => candidate.values)
    const nodeCounts = await queryNodeCounts(allCandidateValues.map(value => value.query))
    const sampleSets = await assignSample(sampleIds, idToFamily, allCandidateValues.map(value => value.query), {
      lane: valueLane,
      texts: allCandidateValues.map(value => valueEmbeddingText(value.label, value.synonyms)),
    })

    // Grown as values are ACCEPTED within the round, not snapshotted up front:
    // a snapshot let two restatements of the same value in one proposal both
    // pass the Jaccard dedup, and let a value added to an existing axis land
    // unseen by every later candidate in the same round.
    const existingValues = registry.flatMap(dimension => dimension.values.map(value => ({ dimension, value })))
    const residualSet = new Set(residualRows.map(row => row.familyKey))
    let acceptedThisRound = 0

    let flatIdx = 0
    for (const candidate of candidates) {
      // Value-level ladder first; dimension-level checks only see survivors.
      const survivors: Array<CandidateValue & { sampleSet: Set<string> }> = []
      for (const value of candidate.values) {
        const nodes = nodeCounts[flatIdx]
        const sampleSet = sampleSets[flatIdx]
        flatIdx++

        if (!nodes) {
          record.rejected.push({
            kind: 'value',
            label: `${candidate.label} / ${value.label}`,
            reason: 'QUERY_STEMS_TO_NOTHING',
            detail:
              'Every term stems away to nothing under common-word removal; the value could never match a document and its emptiness would be fabricated.',
          })
          // Fed back to the prompt like every other rejection: without it the
          // model re-proposed the same dead vocabulary round after round.
          rejectedForPrompt.push({
            label: value.label,
            detail: 'every term stems away to nothing under common-word removal — different wording is needed',
          })
          continue
        }
        if (sampleSet.size < valueFloor) {
          record.rejected.push({
            kind: 'value',
            label: `${candidate.label} / ${value.label}`,
            reason: 'BELOW_SAMPLE_FLOOR',
            detail: `Matched ${sampleSet.size} of ${sampleN} sampled families — below the floor of ${valueFloor}.`,
          })
          rejectedForPrompt.push({
            label: value.label,
            detail: `matched ${sampleSet.size} of ${sampleN} sampled families, below the floor`,
          })
          continue
        }
        const duplicate = existingValues.find(
          entry => jaccard(entry.value.sampleSet, sampleSet) >= VALUE_DUPLICATE_JACCARD
        )
        if (duplicate) {
          // The proposal is the incumbent under new words: keep the vocabulary,
          // drop the duplicate row.
          const merged = valueTerms(duplicate.value.label, [
            ...duplicate.value.synonyms,
            value.label,
            ...value.synonyms,
          ])
          // Capped at the same 10 the creation paths apply — an incumbent
          // absorbing every restatement grew its vocabulary unbounded across
          // rounds, and with it the census cost and match breadth.
          duplicate.value.synonyms = merged
            .filter(term => labelKeyOf(term) !== labelKeyOf(duplicate.value.label))
            .slice(0, 10)
          duplicate.value.query = compileValueQuery(duplicate.value.label, duplicate.value.synonyms)
          record.rejected.push({
            kind: 'value',
            label: `${candidate.label} / ${value.label}`,
            reason: 'DUPLICATE_OF_EXISTING',
            detail: `Places the same sampled families as "${duplicate.dimension.label} / ${duplicate.value.label}" — synonyms merged into it.`,
          })
          continue
        }
        survivors.push({ ...value, sampleSet })
      }

      if (!survivors.length) continue

      if (candidate.existing) {
        // Growth of an existing axis: value-level checks only, plus the cap.
        for (const value of survivors) {
          if (candidate.existing.values.length >= MAX_VALUES_PER_DIM || totalValues(registry) >= MAX_TOTAL_VALUES) {
            record.rejected.push({
              kind: 'value',
              label: `${candidate.label} / ${value.label}`,
              reason: 'REGISTRY_FULL',
              detail: `The axis holds ${candidate.existing.values.length} values (cap ${MAX_VALUES_PER_DIM}); an axis needing more is two axes.`,
            })
            continue
          }
          const grown: WorkingValue = {
            id: `${candidate.existing.id}v${candidate.existing.values.length + 1}`,
            label: value.label,
            synonyms: value.synonyms,
            query: value.query,
            round,
            provenance: 'grow',
            sampleSet: value.sampleSet,
          }
          candidate.existing.values.push(grown)
          existingValues.push({ dimension: candidate.existing, value: grown })
          record.acceptedValues.push({ dimension: candidate.existing.label, value: value.label })
          acceptedThisRound++
        }
        continue
      }

      // A NEW axis. It must be measurable (2+ values), explain the residual
      // (growth rounds only — the seed round has no residual to explain), and
      // not restate an axis already in the registry.
      if (survivors.length < 2) {
        record.rejected.push({
          kind: 'dimension',
          label: candidate.label,
          reason: 'EXPLAINS_TOO_LITTLE_RESIDUAL',
          detail: 'Only one value survived measurement; an axis needs at least two positions to be an axis.',
        })
        rejectedForPrompt.push({ label: candidate.label, detail: 'only one of its values survived measurement' })
        continue
      }
      if (registry.length >= MAX_DIMENSIONS || totalValues(registry) + survivors.length > MAX_TOTAL_VALUES) {
        record.rejected.push({
          kind: 'dimension',
          label: candidate.label,
          reason: 'REGISTRY_FULL',
          detail: `The registry holds ${registry.length} axes and ${totalValues(registry)} values (caps ${MAX_DIMENSIONS}/${MAX_TOTAL_VALUES}).`,
        })
        continue
      }

      const candidateUnion = new Set<string>()
      for (const value of survivors) value.sampleSet.forEach(family => candidateUnion.add(family))

      if (round > 1) {
        let residualExplained = 0
        candidateUnion.forEach(family => {
          if (residualSet.has(family)) residualExplained++
        })
        const residualShareExplained = residualSet.size ? residualExplained / residualSet.size : 0
        if (residualShareExplained < 0.2 || candidateUnion.size < Math.ceil(0.03 * sampleN)) {
          record.rejected.push({
            kind: 'dimension',
            label: candidate.label,
            reason: 'EXPLAINS_TOO_LITTLE_RESIDUAL',
            detail: `Places ${residualExplained} of ${residualSet.size} unplaced families (${Math.round(
              residualShareExplained * 100
            )}%; floor 20%) and ${candidateUnion.size} of ${sampleN} sampled (floor 3%).`,
          })
          rejectedForPrompt.push({
            label: candidate.label,
            detail: `placed only ${residualExplained} of ${residualSet.size} unplaced families`,
          })
          continue
        }
      }

      const working: WorkingDimension = {
        id: `d${registry.length + 1}`,
        label: candidate.label,
        labelKey: candidate.labelKey,
        description: candidate.description || `Where a document sits on the "${candidate.label}" axis.`,
        round,
        values: [],
      }
      working.values = survivors.map((value, index) => ({
        id: `${working.id}v${index + 1}`,
        label: value.label,
        synonyms: value.synonyms,
        query: value.query,
        round,
        provenance: (round === 1 ? 'seed' : 'grow') as DimensionProvenance,
        sampleSet: value.sampleSet,
      }))

      const restated = registry.find(existing => dimensionRedundancy(working, existing) >= REDUNDANCY_CEILING)
      if (restated) {
        record.rejected.push({
          kind: 'dimension',
          label: candidate.label,
          reason: 'DIMENSION_RESTATES_EXISTING',
          detail: `Its values place the same sampled families as "${restated.label}" already does — one axis said twice.`,
        })
        rejectedForPrompt.push({ label: candidate.label, detail: `places the same families as "${restated.label}"` })
        continue
      }

      registry.push(working)
      for (const value of working.values) existingValues.push({ dimension: working, value })
      record.acceptedDimensions.push(working.label)
      for (const value of working.values) record.acceptedValues.push({ dimension: working.label, value: value.label })
      acceptedThisRound += working.values.length
    }

    // Merged-into incumbents changed vocabulary; refresh every sample set so
    // the residual the next round reasons from matches the queries on record.
    const refreshTargets = registry.flatMap(dimension => dimension.values)
    if (refreshTargets.length) {
      const refreshedSets = await assignSample(sampleIds, idToFamily, refreshTargets.map(value => value.query), {
        lane: valueLane,
        texts: refreshTargets.map(value => valueEmbeddingText(value.label, value.synonyms)),
      })
      refreshTargets.forEach((value, index) => {
        value.sampleSet = refreshedSets[index]
      })
    }

    const unionAfter = assignedUnion(registry)
    record.residualShareAfter = sampleN ? (sampleN - unionAfter.size) / sampleN : 1
    rounds.push(record)

    if (!acceptedThisRound) {
      settledReason = 'NO_ACCEPTED_ADDITIONS'
      break
    }
    if (record.residualShareAfter <= RESIDUAL_SETTLE_SHARE) {
      settledReason = 'RESIDUAL_UNDER_FLOOR'
      break
    }
    // Either cap alone ends the loop. Requiring BOTH burned a full LLM round
    // when only the total-values cap was saturated — a round whose every
    // acceptance path was already guaranteed to reject. At the dimensions cap
    // the only move left is growing incumbent axes, which the next map's editor
    // serves better than another discovery round does.
    if (registry.length >= MAX_DIMENSIONS || totalValues(registry) >= MAX_TOTAL_VALUES) {
      settledReason = 'REGISTRY_FULL'
      break
    }
  }

  if (!registry.length) {
    throw new WhitespacePermanentError(
      'No proposed viewpoint survived measurement against the sample. The field may be too heterogeneous for its size — ' +
        'sharpen the invention description or narrow the scope, then re-run.'
    )
  }

  return { registry, settledReason }
}

/**
 * Compiles a user-edited registry for a re-census; discovery is skipped.
 * Everything the caps or the two-values rule drop is NAMED in coverageNotes —
 * a user who edited a registry is owed an account of which edits were not
 * counted, not a silently smaller grid.
 */
async function compileSuppliedRegistry(
  supplied: SuppliedDimensionRegistry,
  sampleIds: number[],
  idToFamily: Map<number, string>,
  valueLane: ValueSemanticLane,
  coverageNotes: string[]
): Promise<WorkingDimension[]> {
  const registry: WorkingDimension[] = []
  const suppliedDimensions = Array.isArray(supplied.dimensions) ? supplied.dimensions : []
  if (suppliedDimensions.length > MAX_DIMENSIONS) {
    coverageNotes.push(
      `The supplied registry named ${suppliedDimensions.length} viewpoints; only the first ${MAX_DIMENSIONS} were counted (the viewpoint cap).`
    )
  }
  for (const rawDimension of suppliedDimensions.slice(0, MAX_DIMENSIONS)) {
    const label = normaliseLabel(String(rawDimension.label ?? '')).slice(0, 80)
    if (!label) {
      coverageNotes.push('One supplied viewpoint had no label and was dropped.')
      continue
    }
    const working: WorkingDimension = {
      id: `d${registry.length + 1}`,
      label,
      labelKey: labelKeyOf(label),
      description:
        normaliseLabel(String(rawDimension.description ?? '')).slice(0, 300) ||
        `Where a document sits on the "${label}" axis.`,
      round: 0,
      values: [],
    }
    const rawValues = Array.isArray(rawDimension.values) ? rawDimension.values : []
    if (rawValues.length > MAX_VALUES_PER_DIM) {
      coverageNotes.push(
        `Viewpoint "${label}" supplied ${rawValues.length} values; only the first ${MAX_VALUES_PER_DIM} were counted (the per-viewpoint cap).`
      )
    }
    for (const rawValue of rawValues.slice(0, MAX_VALUES_PER_DIM)) {
      const valueLabel = normaliseLabel(String(rawValue.label ?? '')).slice(0, 80)
      if (!valueLabel) continue
      // Array.isArray, not `?? []`: a registry edit arrives as JSON, and a
      // non-array synonyms field (a string, an object) threw here mid-stage.
      const synonyms = (Array.isArray(rawValue.synonyms) ? rawValue.synonyms : [])
        .filter((synonym): synonym is string => typeof synonym === 'string')
        .map(synonym => normaliseLabel(synonym).slice(0, 80))
        .filter(Boolean)
        .slice(0, 10)
      const query = compileValueQuery(valueLabel, synonyms)
      if (!query) continue
      working.values.push({
        id: `${working.id}v${working.values.length + 1}`,
        label: valueLabel,
        synonyms,
        query,
        round: 0,
        provenance: 'user',
        sampleSet: new Set(),
      })
    }
    if (working.values.length < 2) {
      coverageNotes.push(
        `Viewpoint "${label}" was dropped — a viewpoint needs at least two measurable values and ${
          working.values.length === 1 ? 'only one' : 'none'
        } of its values survived compilation.`
      )
      continue
    }
    // Checked BEFORE the push: checking after let the registry exceed the cap
    // by up to MAX_VALUES_PER_DIM - 1 values.
    if (totalValues(registry) + working.values.length > MAX_TOTAL_VALUES) {
      coverageNotes.push(
        `Viewpoint "${label}" was dropped — counting its ${working.values.length} values would exceed the registry cap of ${MAX_TOTAL_VALUES} total values.`
      )
      continue
    }
    registry.push(working)
  }

  const allValues = registry.flatMap(dimension => dimension.values)
  if (!allValues.length) {
    throw new Error('The supplied registry has no measurable values — every viewpoint needs at least two.')
  }
  const nodes = await queryNodeCounts(allValues.map(value => value.query))
  const dead = allValues.filter((_, index) => !nodes[index])
  if (dead.length) {
    throw new Error(
      `The value${dead.length === 1 ? '' : 's'} ${dead.map(value => `"${value.label}"`).join(', ')} contain${
        dead.length === 1 ? 's' : ''
      } no searchable words after common-word removal. Reword or remove ${dead.length === 1 ? 'it' : 'them'} before re-counting.`
    )
  }
  const sets = await assignSample(sampleIds, idToFamily, allValues.map(value => value.query), {
    lane: valueLane,
    texts: allValues.map(value => valueEmbeddingText(value.label, value.synonyms)),
  })
  allValues.forEach((value, index) => {
    value.sampleSet = sets[index]
  })
  return registry
}

// ---------------------------------------------------------------------------
// Gap detection (pure arithmetic over census numbers)
// ---------------------------------------------------------------------------

export function detectGaps(input: {
  registry: WorkingDimension[]
  flatValues: WorkingValue[]
  flatDimIdx: number[]
  familyCount: number
  valueFamilies: number[]
  dimensionAssigned: number[]
  pairCounts: Map<string, number>
  marginFloor: number
}): { matrices: DimensionMatrix[]; gaps: DimensionGap[] } {
  const { registry, flatValues, flatDimIdx, familyCount, valueFamilies, dimensionAssigned, pairCounts, marginFloor } =
    input
  const pairObserved = (a: number, b: number): number => pairCounts.get(a < b ? `${a}:${b}` : `${b}:${a}`) ?? 0

  const dimValueIdxs: number[][] = registry.map(() => [])
  flatDimIdx.forEach((dimIdx, valueIdx) => dimValueIdxs[dimIdx].push(valueIdx))
  const residualShareOf = (dimIdx: number): number =>
    familyCount ? (familyCount - (dimensionAssigned[dimIdx] ?? 0)) / familyCount : 1

  const matrices: DimensionMatrix[] = []
  const gaps: DimensionGap[] = []

  for (let i = 0; i < registry.length; i++) {
    for (let j = i + 1; j < registry.length; j++) {
      const redundancy = dimensionRedundancy(registry[i], registry[j])
      const residualI = residualShareOf(i)
      const residualJ = residualShareOf(j)

      let skipReason: string | null = null
      if (redundancy >= REDUNDANCY_CEILING) {
        skipReason = `The axes overlap heavily (${Math.round(
          redundancy * 100
        )}% of placements agree) — an empty cell between near-synonym axes is vocabulary, not absence.`
      } else if (residualI > RESIDUAL_CEILING || residualJ > RESIDUAL_CEILING) {
        const worst = residualI > residualJ ? registry[i] : registry[j]
        const share = Math.max(residualI, residualJ)
        skipReason = `"${worst.label}" places only ${Math.round(
          (1 - share) * 100
        )}% of the field — too narrow an axis to read emptiness against.`
      }

      const cells: DimensionMatrixCell[] = []
      for (const aIdx of dimValueIdxs[i]) {
        for (const bIdx of dimValueIdxs[j]) {
          const observed = pairObserved(aIdx, bIdx)
          if (observed > 0) {
            cells.push({ aValueId: flatValues[aIdx].id, bValueId: flatValues[bIdx].id, observed })
          }
        }
      }
      matrices.push({
        aDimensionId: registry[i].id,
        bDimensionId: registry[j].id,
        redundancy,
        harvested: !skipReason,
        skipReason,
        cells,
      })
      if (skipReason) continue

      for (const aIdx of dimValueIdxs[i]) {
        const marginA = valueFamilies[aIdx] ?? 0
        if (marginA < marginFloor) continue
        for (const bIdx of dimValueIdxs[j]) {
          const marginB = valueFamilies[bIdx] ?? 0
          if (marginB < marginFloor) continue
          const observed = pairObserved(aIdx, bIdx)
          const pair = rarePairFromCounts({
            a: flatValues[aIdx].id,
            b: flatValues[bIdx].id,
            supportA: marginA,
            supportB: marginB,
            observed,
            total: familyCount,
          })
          if (!pair || pair.expected < EXPECTED_FLOOR) continue
          const nearEmptyCeiling = Math.max(1, Math.floor(0.02 * pair.expected))
          if (observed !== 0 && observed > nearEmptyCeiling) continue

          // Near-misses: the strongest co-occupancy of each arm with the OTHER
          // values of the opposing axis — proof the cell was reachable.
          const nearMissOf = (fromIdx: number, acrossIdxs: number[], excludeIdx: number) => {
            let best: { idx: number; families: number } | null = null
            for (const idx of acrossIdxs) {
              if (idx === excludeIdx) continue
              const families = pairObserved(fromIdx, idx)
              if (families > 0 && (!best || families > best.families)) best = { idx, families }
            }
            return best
              ? { valueId: flatValues[best.idx].id, valueLabel: flatValues[best.idx].label, families: best.families }
              : null
          }
          const nearMissB = nearMissOf(aIdx, dimValueIdxs[j], bIdx)
          const nearMissA = nearMissOf(bIdx, dimValueIdxs[i], aIdx)

          const coAcrossB = dimValueIdxs[j].reduce((sum, idx) => sum + pairObserved(aIdx, idx), 0)
          const coAcrossA = dimValueIdxs[i].reduce((sum, idx) => sum + pairObserved(bIdx, idx), 0)

          gaps.push({
            id: `g-${flatValues[aIdx].id}-${flatValues[bIdx].id}`,
            aDimensionId: registry[i].id,
            aDimensionLabel: registry[i].label,
            aValueId: flatValues[aIdx].id,
            aValueLabel: flatValues[aIdx].label,
            bDimensionId: registry[j].id,
            bDimensionLabel: registry[j].label,
            bValueId: flatValues[bIdx].id,
            bValueLabel: flatValues[bIdx].label,
            observed,
            marginA,
            marginB,
            expected: pair.expected,
            z: pair.z,
            rarity: pair.rarity,
            surprisal: pair.surprisal,
            nearMissB,
            nearMissA,
            unassignedOnB: Math.max(0, marginA - coAcrossB),
            unassignedOnA: Math.max(0, marginB - coAcrossA),
            armFamilies: null,
            armClaimsReadable: null,
            coverageSuspect: false,
            suspectReason: null,
            rank: 0,
            hypothesisId: null,
          })
        }
      }
    }
  }

  // Pre-rank before the arm-claims facet caps the list: the facet joins per
  // gap, so it should only ever see the gaps that can be published.
  finaliseGaps(gaps, marginFloor)
  gaps.sort(byGapOrder)
  return { matrices, gaps: gaps.slice(0, GAP_OUTPUT_CAP) }
}

/** Suspect flags + the deterministic rank; safe to run again after claims fill. */
function finaliseGaps(gaps: DimensionGap[], marginFloor: number): void {
  const marginHealth = (gap: DimensionGap) =>
    Math.min(1, Math.log1p(Math.min(gap.marginA, gap.marginB)) / Math.log1p(marginFloor * 10))

  /**
   * Surprisal on [0,1], log-scaled. `rarity` cannot do this job: it clamps at 1
   * for expected >= 9, and the gap detector's own floors (expected >= 5, margins
   * >= 2% of the field) put nearly every published gap far past that — so rarity
   * was a constant 1.0 across the whole list and contributed nothing to the
   * order. 100 dB is the reference point: an empty cell that expected ~230
   * families scores a full 1.
   */
  const surprise = (gap: DimensionGap) =>
    Math.min(1, Math.log10(1 + Math.max(0, gap.surprisal)) / Math.log10(101))

  for (const gap of gaps) {
    gap.coverageSuspect = false
    gap.suspectReason = null
    if (gap.unassignedOnB > gap.marginA * 0.5) {
      gap.coverageSuspect = true
      gap.suspectReason = `Most "${gap.aValueLabel}" families take NO value on the "${gap.bDimensionLabel}" axis — the cell is more likely a vocabulary hole than a technology hole.`
    } else if (gap.unassignedOnA > gap.marginB * 0.5) {
      gap.coverageSuspect = true
      gap.suspectReason = `Most "${gap.bValueLabel}" families take NO value on the "${gap.aDimensionLabel}" axis — the cell is more likely a vocabulary hole than a technology hole.`
    } else if (
      gap.armFamilies !== null &&
      gap.armClaimsReadable !== null &&
      gap.armFamilies > 0 &&
      gap.armClaimsReadable / gap.armFamilies < 0.4
    ) {
      gap.coverageSuspect = true
      gap.suspectReason = `Claims are readable for only ${Math.round(
        (gap.armClaimsReadable / gap.armFamilies) * 100
      )}% of the surrounding families — below the 40% floor the validation gate applies.`
    }
    gap.rank =
      surprise(gap) *
      marginHealth(gap) *
      (gap.nearMissA || gap.nearMissB ? 1 : 0.6) *
      (gap.coverageSuspect ? 0.5 : 1) *
      (gap.observed === 0 ? 1 : 0.7)
  }
  gaps.sort(byGapOrder)
}

/** True zeros before near-empty cells, then rank. */
function byGapOrder(a: DimensionGap, b: DimensionGap): number {
  const aEmpty = a.observed === 0 ? 0 : 1
  const bEmpty = b.observed === 0 ? 0 : 1
  if (aEmpty !== bEmpty) return aEmpty - bEmpty
  return b.rank - a.rank
}
