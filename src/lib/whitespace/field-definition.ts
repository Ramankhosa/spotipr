/**
 * Whitespace Studio — the resolved field definition.
 *
 * ONE place turns a scope into the predicate every stage reads: the semantic
 * candidates (candidates.ts), the match rule (field-rule.ts) and the composed
 * WHERE clause (field-map.ts). Stages used to assemble these themselves, and
 * with the rule now FITTED at run time that would let two stages of one study
 * fit different rungs and count different fields — the area map drawn over a
 * narrower field than the census reported, every share wrong.
 *
 * Producers and consumers. FIELD_MAP and DIMENSION_MAP are producers: they fit
 * the rule fresh (the corpus may have grown since the last census) and persist
 * it on their result. Every other stage is a consumer: it reuses the rule the
 * newest completed census of the IDENTICAL scope persisted, so one census means
 * one field for the rest of the study. A consumer with no census to lean on fits
 * for itself — that is still deterministic given the corpus, merely a little
 * slower.
 *
 * The fit measures rungs tightest-first, each as a bounded count (LIMIT ceiling
 * + 1, statement timeout), and stops at the first rung inside the band or the
 * first that crosses the ceiling — every looser rung is a superset, so nothing
 * past it can be inside. A rung that cannot be counted within the budget is
 * treated as over the ceiling: if it cannot be sized in this time it cannot be
 * staged in it either.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  buildConceptQuery,
  buildScopeFilter,
  CENSUS_ROW_CAP,
  isStatementTimeout,
  minimumOptionalBounds,
} from './field-map'
import { candidateCoverageNote, resolveFieldCandidates, type FieldCandidates } from './candidates'
import {
  chooseRung,
  fieldRuleNote,
  ladderRungs,
  trivialFieldRule,
  type FieldBand,
  type RungMeasurement,
} from './field-rule'
import { rungIsCompilable } from './scope-schema'
import { scopeMatching, stableJson, type FieldRule, type FieldRuleRung, type WhitespaceScope } from './types'

/**
 * Half the field-map cap: the dimension census stages a tsvector per row and
 * builds a GIN index over it, and hit extraction reads the staged set once per
 * value. Defined here rather than in dimension-stage.ts because the fit band's
 * ceiling is derived from it (below) and dimension-stage imports this module.
 */
export const DIMENSION_ROW_CAP = Math.max(10_000, Number(process.env.WHITESPACE_DIMENSION_ROW_CAP) || 120_000)

/**
 * The band an auto-fitted field must land in.
 *
 * Floor: WHITESPACE_FIELD_MIN_FAMILIES, falling back to the dimension map's own
 * floor (WHITESPACE_DIMENSION_MIN_FAMILIES) so the two agree by default — a
 * field fitted for the studio must be one its most demanding stage accepts.
 * 500 in production; the 38k-row dev corpus sets it lower in .env.
 *
 * Ceiling: WHITESPACE_FIELD_MAX_PUBLICATIONS, defaulting to the SMALLER of the
 * two census caps. Every stage can then run on a fitted field; a rung between
 * the two caps would census as a landscape and refuse as a dimension map.
 */
export function resolveFieldBand(): FieldBand {
  const dimensionFloor = Number(process.env.WHITESPACE_DIMENSION_MIN_FAMILIES) || 500
  const minFamilies = Math.max(20, Number(process.env.WHITESPACE_FIELD_MIN_FAMILIES) || dimensionFloor)
  const maxPublications = Math.max(
    1_000,
    Number(process.env.WHITESPACE_FIELD_MAX_PUBLICATIONS) || Math.min(DIMENSION_ROW_CAP, CENSUS_ROW_CAP)
  )
  return { minFamilies, maxPublications }
}

/**
 * Per-rung sizing budget. Sizing a rung costs about what staging it costs (same
 * predicate, same rows fetched), so a rung that cannot be sized inside the
 * census budget could not be counted inside it either — hence the default is
 * the census timeout, and a timeout is read as "over the ceiling".
 */
const FIT_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.WHITESPACE_FIT_TIMEOUT_MS) || Number(process.env.WHITESPACE_CENSUS_TIMEOUT_MS) || 90_000
)

/** Memo TTL — consecutive stages of one study reuse the definition. */
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX_ENTRIES = 32

export interface FieldDefinition {
  candidates: FieldCandidates
  rule: FieldRule
  /** The complete WHERE fragment (aliased `lp`), concept gate at the rule's k. */
  where: Prisma.Sql
  /** How the field was assembled — the rule first, then the semantic lane. */
  coverageNotes: string[]
  /**
   * The chosen rung's own measurement, when the fit took one and it was under
   * the ceiling (then it is exact). Null for pinned, trivial and reused rules.
   */
  measured: { publications: number; families: number } | null
}

export interface ResolveFieldOptions {
  /** Study to look up a persisted rule on. */
  studyId?: string
  /**
   * Prefer the rule persisted by the newest completed census of the identical
   * scope (consumer behaviour). Producers leave this false and fit fresh.
   */
  reuse?: boolean
  /** Test seam and offline tools. */
  band?: FieldBand
  timeoutMs?: number
}

const cache = new Map<string, { at: number; value: FieldDefinition }>()

function cacheKey(scope: WhitespaceScope, band: FieldBand): string {
  return stableJson({ scope, band })
}

function remember(key: string, value: FieldDefinition): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    let oldestKey: string | null = null
    let oldestAt = Infinity
    cache.forEach((entry, entryKey) => {
      if (entry.at < oldestAt) {
        oldestAt = entry.at
        oldestKey = entryKey
      }
    })
    if (oldestKey !== null) cache.delete(oldestKey)
  }
  cache.set(key, { at: Date.now(), value })
}

/** Test seam: the memo is process-wide and would otherwise leak across cases. */
export function __clearFieldDefinitionCache(): void {
  cache.clear()
}

/**
 * The rule the newest completed census of this exact scope ran with, or null.
 * Compared with stableJson: the snapshot round-tripped through jsonb, which
 * reorders keys, so a plain stringify comparison never matches.
 */
export async function persistedFieldRule(studyId: string, scope: WhitespaceScope): Promise<FieldRule | null> {
  const runs = await prisma.whitespaceRun.findMany({
    where: { studyId, stage: { in: ['FIELD_MAP', 'DIMENSION_MAP'] }, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: { results: true, scopeSnapshot: true },
  })
  const wanted = stableJson(scope)
  for (const run of runs) {
    if (stableJson(run.scopeSnapshot ?? null) !== wanted) continue
    const rule = (run.results as { fieldRule?: unknown } | null)?.fieldRule
    if (rule && typeof rule === 'object' && typeof (rule as FieldRule).minimumOptional === 'number') {
      return rule as FieldRule
    }
  }
  return null
}

/** Bounded count of one rung: at most `ceiling + 1` rows are ever read. */
async function measureRung(
  scope: WhitespaceScope,
  candidateIds: readonly number[],
  minimumOptional: number,
  band: FieldBand,
  timeoutMs: number
): Promise<RungMeasurement> {
  const where = buildScopeFilter(scope, candidateIds, minimumOptional)
  try {
    const [, rows] = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`,
      prisma.$queryRaw<Array<{ publications: bigint; families: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint                    AS publications,
               COUNT(DISTINCT t.family_key)::bigint AS families
        FROM (
          SELECT COALESCE(lp."familyId", lp."publicationNumber") AS family_key
          FROM "local_patents" lp
          WHERE ${where}
          LIMIT ${band.maxPublications + 1}
        ) t`),
    ])
    const publications = Number(rows[0]?.publications ?? 0)
    const families = Number(rows[0]?.families ?? 0)
    return { minimumOptional, publications, families, overCap: publications > band.maxPublications, timedOut: false }
  } catch (error) {
    if (isStatementTimeout(error)) {
      return { minimumOptional, publications: 0, families: 0, overCap: true, timedOut: true }
    }
    throw error
  }
}

export async function resolveFieldDefinition(
  scope: WhitespaceScope,
  options: ResolveFieldOptions = {}
): Promise<FieldDefinition> {
  const band = options.band ?? resolveFieldBand()
  const key = cacheKey(scope, band)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  const plan = buildConceptQuery(scope)
  const counts = { requiredCount: plan?.required.length ?? 0, optionalCount: plan?.optional.length ?? 0 }
  const bounds = minimumOptionalBounds(scope)

  const finish = (rule: FieldRule, candidates: FieldCandidates, measured: FieldDefinition['measured']): FieldDefinition => {
    const value: FieldDefinition = {
      candidates,
      rule,
      where: buildScopeFilter(scope, candidates.ids, rule.minimumOptional),
      coverageNotes: [fieldRuleNote(rule), candidateCoverageNote(candidates)],
      measured,
    }
    remember(key, value)
    return value
  }

  // 1. Nothing to fit: pinned, or a concept list with only one expressible rung.
  const trivial = trivialFieldRule(scope, counts, band)
  const candidates = await resolveFieldCandidates(scope)
  if (trivial) return finish(trivial, candidates, null)

  // 2. Consumers reuse the producer's rule for the identical scope.
  if (options.reuse && options.studyId) {
    const persisted = await persistedFieldRule(options.studyId, scope)
    if (
      persisted &&
      persisted.minimumOptional >= bounds.min &&
      persisted.minimumOptional <= bounds.max &&
      rungIsCompilable(counts.optionalCount, persisted.minimumOptional)
    ) {
      return finish(persisted, candidates, null)
    }
  }

  // 3. The fit. Tightest first; stop at the first in-band rung or the first
  //    over the ceiling.
  const rungs = ladderRungs(bounds.min, bounds.max, k => rungIsCompilable(counts.optionalCount, k))
  const measured: RungMeasurement[] = []
  const timeoutMs = options.timeoutMs ?? FIT_TIMEOUT_MS
  for (const k of rungs) {
    const rung = await measureRung(scope, candidates.ids, k, band, timeoutMs)
    measured.push(rung)
    if (rung.overCap || rung.timedOut) break
    if (rung.families >= band.minFamilies) break
  }
  const decision = chooseRung(measured, band)

  const measuredByK = new Map(measured.map(rung => [rung.minimumOptional, rung]))
  const ladder: FieldRuleRung[] = []
  for (let k = bounds.max; k >= bounds.min; k--) {
    const rung = measuredByK.get(k)
    ladder.push(
      rung
        ? {
            minimumOptional: k,
            publications: rung.timedOut ? null : rung.publications,
            families: rung.timedOut ? null : rung.families,
            overCap: rung.overCap,
            timedOut: rung.timedOut,
            skipped: false,
          }
        : { minimumOptional: k, publications: null, families: null, overCap: false, timedOut: false, skipped: true }
    )
  }
  const chosen = measuredByK.get(decision.minimumOptional)
  const rule: FieldRule = {
    mode: 'auto',
    ...counts,
    minimumOptional: decision.minimumOptional,
    fit: decision.fit,
    ladder,
    band,
  }
  return finish(
    rule,
    candidates,
    chosen && !chosen.overCap && !chosen.timedOut
      ? { publications: chosen.publications, families: chosen.families }
      : null
  )
}

/** True when the scope asks the fit to run (as opposed to pinning k). */
export function fieldRuleIsAuto(scope: WhitespaceScope): boolean {
  return scopeMatching(scope).minimumOptionalConcepts === 'auto'
}
