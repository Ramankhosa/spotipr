/**
 * Whitespace Studio — the semantic arm of the field definition.
 *
 * The field used to be defined by lexical match alone: every required concept
 * had to appear, post-stemming, in the document text. That is a vocabulary test,
 * not a subject-matter test, and patent drafters are famously inventive about
 * vocabulary — scopes that an embedding search answers with hundreds of families
 * were returning zero, which is what this module exists to fix.
 *
 * It resolves the N documents nearest the scope's concepts in embedding space,
 * under EXACTLY the structural constraints the census applies (filing years,
 * CPC, jurisdiction, assignee), inside EXACTLY the corpus slice the census
 * counts, and with the scope's exclusions honoured. buildScopeFilter then ORs
 * these ids with the lexical predicate. The result only ever widens the field —
 * anything the lexical arm matched still matches.
 *
 * What this deliberately does NOT do is replace the census. The staged set is
 * still counted exactly and still refuses above the row cap; the hybrid changes
 * how a document QUALIFIES, never how the qualifying set is measured. The one
 * honest caveat is saturation: past `candidateCap` the semantic arm is the N
 * nearest rather than everything similar, and that is reported, not hidden.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  PATENT_CORPUS_EMBEDDING_DTYPE,
  PATENT_CORPUS_EMBEDDING_MODEL,
} from '@/lib/patent-corpus-service'
import type { WhitespaceScope } from './types'
import { buildScopeFilter, corpusMembershipPredicate, exclusionMatchPredicate } from './field-map'
import {
  corpusVectorRowEstimate,
  describeLaneError,
  semanticLaneConfigured,
  semanticNeighbors,
  type SemanticBackground,
} from './embedding'

/**
 * Ceiling on NORMALISED distance for admission. Two gates, not one, because
 * neither works alone:
 *
 *   - A cap alone is not a similarity test. ORDER BY … LIMIT k returns the k
 *     nearest HOWEVER FAR they are, so on the 38k dev slice a bare cap of 5,000
 *     admitted 13% of the entire corpus as "the field".
 *   - A ceiling alone does not bound cost. On the 35M-row production corpus the
 *     same ceiling selects far more rows than it does in dev, which would blow
 *     through the census row cap.
 *
 * AN ABSOLUTE CEILING IS NOT PORTABLE — and not only across embedding models,
 * which is what this comment used to say. Measured on the production corpus with
 * five unrelated probes, it is not portable across QUERIES either:
 *
 *     ceiling 0.275   "moisture sensor, irrigation valve"       49 documents
 *                     "lithium battery electrolyte additive"  >8,000 documents
 *
 * Those two need ceilings ~0.04 apart to select comparable fields, so no single
 * constant serves both: whichever value is chosen, one subject gets a reading
 * list and the other gets a sector. The offset is a property of the query
 * VECTOR (each sits at its own mean distance from the corpus), not of how
 * crowded the subject is — so subtracting each query's own background removes
 * it, which is what `adaptive` mode does. See resolveSemanticCeiling.
 *
 * The old design refused to run at all on a binary installation until an
 * operator supplied a measured constant. No constant could be measured, because
 * none exists; the studio therefore ran lexical-only, and fields that should
 * have held thousands of families held 21.
 *
 * 0.35 survives as the absolute-mode default for float installations already
 * configured around it: measured across three unrelated subjects on
 * text-embedding-3-small, where every distribution sat in the same narrow band
 * with a cliff just past ~0.375.
 */
const CALIBRATED_COSINE_MAX_DISTANCE = 0.35

/**
 * Target field size, in documents, that the adaptive ceiling aims at. A patent
 * FIELD is thousands of documents; below that it is a reading list and above it
 * a technology sector.
 */
const TARGET_FIELD_DOCUMENTS = Math.max(100, Number(process.env.WHITESPACE_SEMANTIC_TARGET_FIELD) || 5_000)

/**
 * Hard cap on the share of the corpus the semantic arm may admit — applied to a
 * configured WHITESPACE_SEMANTIC_SELECTIVITY as well as to the derived one. A
 * 38k-row corpus does not contain 5,000 documents about one subject, and without
 * this the target would demand 13% of it — the exact failure the old bare
 * candidate cap produced. Above 1% the candidate cap binds first anyway, so a
 * looser setting buys nothing but a saturated arm.
 */
const MAX_CORPUS_SHARE = 0.01

export const UNCALIBRATED_REASON =
  `No semantic distance ceiling could be estimated for ${PATENT_CORPUS_EMBEDDING_MODEL} ` +
  `(${PATENT_CORPUS_EMBEDDING_DTYPE} vectors), so the field was matched on concept wording alone. ` +
  `Check embedding coverage, or measure the corpus with "npx tsx scripts/whitespace-semantic-calibrate.ts".`

export const DISABLED_REASON =
  'Semantic matching is disabled by configuration (WHITESPACE_SEMANTIC_MAX_DISTANCE=off), so matching ran on wording alone.'

/**
 * True when WHITESPACE_SEMANTIC_MAX_DISTANCE reads as a deliberate off switch.
 *
 * Any non-positive NUMBER counts, not just the literal string '0': an operator
 * writing `0.0` or `-1` means "off", and the earlier string-equality test sent
 * exactly those values down the fallthrough path — which on a float
 * installation resolved to the measured default and silently turned the arm
 * back ON, the precise opposite of what was asked.
 */
function killSwitchEngaged(): boolean {
  const raw = (process.env.WHITESPACE_SEMANTIC_MAX_DISTANCE || '').trim().toLowerCase()
  if (raw === 'off') return true
  if (!raw) return false
  const configured = Number(raw)
  return Number.isFinite(configured) && configured <= 0
}

/**
 * Why the semantic arm may not run right now, or null when it may. Only the
 * kill switch can rule it out ahead of time now: the adaptive ceiling is
 * resolved per query, so "no ceiling" is a runtime outcome, not a configuration
 * state.
 */
export function semanticArmUnavailableReason(): string | null {
  return killSwitchEngaged() ? DISABLED_REASON : null
}

/**
 * How the ceiling for a query is decided.
 *
 * `absolute` is the operator override and the legacy path. `adaptive` is the
 * default and the fix: it carries a z-score, and each query's ceiling becomes
 * `mean - z * sd` of that query's OWN background distance distribution. One z
 * therefore means the same selectivity for every query, which no single
 * distance ever could — five unrelated probes on the production corpus needed
 * ceilings 0.04 apart to select comparable numbers of documents.
 */
export type SemanticCeiling =
  | { mode: 'absolute'; maxDistance: number }
  | { mode: 'adaptive'; z: number; selectivity: number }

/**
 * Φ⁻¹ — Acklam's rational approximation, |error| < 1.15e-9 on (0,1). Needed to
 * turn a target share of the corpus into the z the background rule applies.
 */
function inverseNormalCdf(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const pLow = 0.02425
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5
    const r = q * q
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  }
  const q = Math.sqrt(-2 * Math.log(1 - p))
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
}

/** The share of the corpus the adaptive ceiling aims to admit, and its z. */
export async function resolveSelectivity(): Promise<{ selectivity: number; z: number }> {
  const configured = Number((process.env.WHITESPACE_SEMANTIC_SELECTIVITY || '').trim())
  let share: number
  if (Number.isFinite(configured) && configured > 0 && configured < 1) {
    share = configured
  } else {
    // Self-scaling: a fixed share means 4 documents on the 38k dev slice and
    // 4,500 on the 45M production corpus. Deriving it from a target COUNT keeps
    // "a field" the same size on both, and the clamp keeps a small corpus from
    // being asked for more subject than it contains.
    const rows = await corpusVectorRowEstimate()
    share = rows > 0 ? Math.min(MAX_CORPUS_SHARE, TARGET_FIELD_DOCUMENTS / rows) : MAX_CORPUS_SHARE
  }
  const selectivity = Math.min(MAX_CORPUS_SHARE, Math.max(1e-9, share))
  return { selectivity, z: -inverseNormalCdf(selectivity) }
}

/**
 * The ceiling policy for this installation, or null when the arm is switched off.
 *
 * `WHITESPACE_SEMANTIC_MAX_DISTANCE=off` (or any number <= 0) is the operator
 * kill switch; a positive value pins an absolute ceiling (the legacy behaviour,
 * kept because an operator who has measured their corpus is entitled to say so);
 * unset means adaptive.
 *
 * There is no longer a "binary installations get nothing" branch. That branch
 * existed because an absolute ceiling is not portable across embedding models —
 * true, and it is not portable across QUERIES either, which is why the ceiling
 * is no longer absolute. The measured cosine constant survives only as the
 * absolute-mode default, for installations already configured around it.
 */
export async function resolveSemanticCeiling(): Promise<SemanticCeiling | null> {
  if (killSwitchEngaged()) return null
  const raw = (process.env.WHITESPACE_SEMANTIC_MAX_DISTANCE || '').trim().toLowerCase()
  const configured = Number(raw)
  if (raw && Number.isFinite(configured) && configured > 0) {
    return { mode: 'absolute', maxDistance: Math.min(1, configured) }
  }
  if (raw === 'absolute' && PATENT_CORPUS_EMBEDDING_DTYPE !== 'binary') {
    return { mode: 'absolute', maxDistance: CALIBRATED_COSINE_MAX_DISTANCE }
  }
  const { selectivity, z } = await resolveSelectivity()
  return { mode: 'adaptive', z, selectivity }
}

/**
 * Ceiling on semantically-admitted documents — the cost bound, and the reason a
 * production-scale field degrades to "the nearest N" rather than timing out.
 * Raise with WHITESPACE_SEMANTIC_CANDIDATE_CAP where the ANN index can serve it.
 */
const CANDIDATE_CAP = Math.max(
  500,
  Number(process.env.WHITESPACE_SEMANTIC_CANDIDATE_CAP) || 20_000
)

const CANDIDATE_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.WHITESPACE_SEMANTIC_CANDIDATE_TIMEOUT_MS) || 25_000
)

/** Memo TTL. A run touches this once; consecutive stages of one study reuse it. */
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX_ENTRIES = 32

export interface FieldCandidates {
  /** local_patents.id values (Int) admitted by vector similarity. */
  ids: number[]
  /** False when the lane could not run; `reason` then says why, for the trail. */
  available: boolean
  reason?: string
  /** True when the cap was hit — the arm is the N nearest, not everything near. */
  saturated: boolean
  cap: number
  /**
   * The normalised distance ceiling actually applied to THIS scope's query. Under
   * `adaptive` it differs from study to study by design; 0 when nothing ran.
   */
  maxDistance: number
  /** How the ceiling was decided, for the coverage note. */
  mode?: SemanticCeiling['mode']
  /** The query's background distribution, when the ceiling was derived from it. */
  background?: SemanticBackground
}

const UNAVAILABLE = (reason: string): FieldCandidates => ({
  ids: [],
  available: false,
  reason,
  saturated: false,
  cap: CANDIDATE_CAP,
  maxDistance: 0,
})

/**
 * The text put to the encoder.
 *
 * Required concepts lead, because they are what the user said the field must be
 * about; optional concepts follow as context. Synonyms are included rather than
 * dropped — they cost nothing here (the encoder reads the whole string as one
 * subject) and they carry the user's own sense of the field's vocabulary.
 */
export function candidateQueryText(scope: WhitespaceScope): string | null {
  const phrase = (concept: { label: string; synonyms: string[] }) =>
    [concept.label, ...concept.synonyms]
      .map(term => term.trim())
      .filter(Boolean)
      .join(', ')

  const usable = scope.concepts.filter(concept => concept.label.trim() || concept.synonyms.some(s => s.trim()))
  if (!usable.length) return null

  const required = usable.filter(concept => concept.required)
  const ordered = required.length ? [...required, ...usable.filter(concept => !concept.required)] : usable
  const text = ordered.map(phrase).filter(Boolean).join('; ')
  return text.trim() || null
}

/** Stable identity for the memo: everything that changes the candidate set. */
function cacheKey(scope: WhitespaceScope, cap: number, ceiling: SemanticCeiling): string {
  return JSON.stringify({
    concepts: scope.concepts.map(c => [c.label, c.required, [...c.synonyms].sort()]),
    exclusions: scope.exclusions.map(e => e.term).sort(),
    classifications: scope.classifications.filter(c => c.accepted).map(c => c.code).sort(),
    filters: {
      ...scope.filters,
      jurisdictions: [...scope.filters.jurisdictions].sort(),
      assignees: [...scope.filters.assignees].sort(),
    },
    cap,
    // The POLICY, not the resolved distance: under `adaptive` the distance is an
    // output of the query, so keying on it would make every entry a miss.
    ceiling,
  })
}

const cache = new Map<string, { at: number; value: FieldCandidates }>()

/**
 * The structural half of the scope: everything except the concept text and the
 * exclusions.
 *
 * Built by asking buildScopeFilter for a concept-free scope, so the year, CPC,
 * jurisdiction and assignee semantics stay defined in exactly one place. The
 * corpus-membership predicate is added explicitly, because it normally rides
 * inside the concept text predicate this variant omits.
 *
 * Exclusions are deliberately NOT here. They are applied to the retrieved
 * candidates afterwards (withoutExcluded): a `NOT (tsvector @@ q)` clause can
 * never use the text index, and inside the ANN statement it made the planner
 * filter the whole of local_patents through to_tsvector before joining —
 * 34 s against 2 s on the dev corpus — which timed the lane out and silently
 * demoted every field to lexical-only.
 */
function structuralFilter(scope: WhitespaceScope): Prisma.Sql {
  const conceptFree: WhitespaceScope = { ...scope, concepts: [], exclusions: [] }
  return Prisma.join([buildScopeFilter(conceptFree), corpusMembershipPredicate()], ' AND ')
}

/**
 * The candidate ids minus those matching an excluded term. Index-backed and
 * bounded by the candidate count — the id list narrows the heap to the
 * candidates, and the exclusion tsquery is a positive match the GIN index can
 * serve — so it costs milliseconds where the negated in-statement form cost the
 * whole corpus.
 */
async function withoutExcluded(scope: WhitespaceScope, ids: number[], timeoutMs: number): Promise<number[]> {
  const match = exclusionMatchPredicate(scope)
  if (!match || !ids.length) return ids
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`,
    prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT lp."id" AS id
      FROM "local_patents" lp
      WHERE lp."id" = ANY(${ids}::int[])
        AND ${match}`),
  ])
  const excluded = new Set(rows.map(row => Number(row.id)))
  return excluded.size ? ids.filter(id => !excluded.has(id)) : ids
}

export async function resolveFieldCandidates(
  scope: WhitespaceScope,
  options: { cap?: number; maxDistance?: number; timeoutMs?: number } = {}
): Promise<FieldCandidates> {
  const cap = options.cap ?? CANDIDATE_CAP
  const queryText = candidateQueryText(scope)
  // No concepts means no lexical concept gate either, so the field is already
  // the whole structural slice — there is nothing for the semantic arm to widen.
  if (!queryText) return UNAVAILABLE('The scope states no concepts, so no semantic candidates are needed.')
  if (!semanticLaneConfigured()) {
    return UNAVAILABLE('Semantic search is not configured (no embedding key), so the field is lexical-only.')
  }
  const ceiling: SemanticCeiling | null =
    options.maxDistance !== undefined
      ? { mode: 'absolute', maxDistance: options.maxDistance }
      : await resolveSemanticCeiling()
  // Only the deliberate kill switch stops the arm before it runs.
  if (ceiling === null) return UNAVAILABLE(semanticArmUnavailableReason() ?? DISABLED_REASON)

  const key = cacheKey(scope, cap, ceiling)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  const timeoutMs = options.timeoutMs ?? CANDIDATE_TIMEOUT_MS
  const result = await semanticNeighbors({
    queryText,
    limit: cap,
    maxDistance: ceiling.mode === 'absolute' ? ceiling.maxDistance : undefined,
    adaptive: ceiling.mode === 'adaptive' ? { z: ceiling.z } : undefined,
    scopeFilter: structuralFilter(scope),
    timeoutMs,
  })

  // An adaptive run whose background could not be estimated comes back with no
  // ceiling at all — that is a bare top-K, which is a RANKING and not a field
  // definition. Admitting it would silently reinstate the "5,000 nearest however
  // far" behaviour the ceiling exists to prevent, so it degrades to lexical-only.
  let value: FieldCandidates
  if (result.available && result.appliedMaxDistance === null) {
    value = UNAVAILABLE(UNCALIBRATED_REASON)
  } else if (result.available) {
    let ids = result.neighbors.map(neighbor => neighbor.id)
    try {
      ids = await withoutExcluded(scope, ids, timeoutMs)
    } catch (error) {
      // The exclusions could not be applied, so the arm cannot be trusted to
      // honour the scope — better lexical-only than a field that readmits what
      // the user excluded.
      console.error('[Whitespace] Applying exclusions to semantic candidates failed:', error instanceof Error ? error.message : error)
      return UNAVAILABLE(`The scope's exclusions could not be applied to the semantic candidates: ${describeLaneError(error, timeoutMs)}.`)
    }
    value = {
      ids,
      available: true,
      // Saturation is a property of the retrieval, before exclusions are subtracted.
      saturated: result.neighbors.length >= cap,
      cap,
      maxDistance: result.appliedMaxDistance ?? 0,
      mode: ceiling.mode,
      background: result.background,
    }
  } else {
    value = UNAVAILABLE(result.reason)
  }

  // Only successful resolutions are memoised. An unavailable result here is a
  // TRANSIENT failure (embed API hiccup, ANN timeout) — the configuration
  // refusals all returned above — and caching it pinned every stage of the
  // study to a lexical-only field for the full TTL after one bad request.
  if (value.available) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      // Evict the oldest. forEach rather than spreading the iterator: the build
      // targets a lib below es2015 downlevelIteration.
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
  return value
}

/**
 * What the study should tell the reader about how its field was assembled.
 *
 * Stated in every case, including the good one: a field built partly by semantic
 * similarity is a different object from a field built by keyword match, and the
 * reader is entitled to know which one they are looking at before they draw a
 * conclusion from its proportions.
 */
export function candidateCoverageNote(candidates: FieldCandidates): string {
  if (!candidates.available) {
    // A scope with no concepts has no concept text to match ON — saying it was
    // "matched on concept text alone" would be flatly wrong for a CPC-only field.
    if (candidates.reason && /states no concepts/i.test(candidates.reason)) {
      return `Field defined by structural filters alone — ${candidates.reason}`
    }
    return `Field matched on concept text alone — ${candidates.reason}`
  }
  if (!candidates.ids.length) {
    return 'Field matched on concept text alone — the semantic lane found no additional documents in this slice.'
  }
  // The ceiling is stated because it is the whole substance of "similar enough",
  // and under `adaptive` it is stated as what it is — a cut through THIS query's
  // own background, not a house constant — so two studies quoting different
  // numbers do not read as inconsistency.
  const ceiling =
    candidates.mode === 'adaptive' && candidates.background
      ? `an embedding-distance ceiling of ${candidates.maxDistance.toFixed(3)}, set ${(
          (candidates.background.mean - candidates.maxDistance) / candidates.background.sd
        ).toFixed(1)} standard deviations below this query's mean distance to the corpus`
      : `a ${candidates.maxDistance.toFixed(3)} embedding-distance ceiling`
  const base = `Field matched on concept text OR semantic similarity: ${candidates.ids.length.toLocaleString()} documents were admitted by meaning rather than wording (within ${ceiling}).`
  return candidates.saturated
    ? `${base} That is the ${candidates.cap.toLocaleString()}-document ceiling, so the semantic arm is the nearest ${candidates.cap.toLocaleString()} rather than every document inside the ceiling — narrow the scope for an unclipped semantic arm.`
    : base
}

/** Test seam: the memo is process-wide and would otherwise leak across cases. */
export function __clearCandidateCache(): void {
  cache.clear()
}
