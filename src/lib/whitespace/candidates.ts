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
import {
  PATENT_CORPUS_EMBEDDING_DTYPE,
  PATENT_CORPUS_EMBEDDING_MODEL,
} from '@/lib/patent-corpus-service'
import type { WhitespaceScope } from './types'
import { buildScopeFilter, corpusMembershipPredicate, exclusionPredicate } from './field-map'
import { semanticLaneConfigured, semanticNeighbors } from './embedding'

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
 * THE CEILING IS NOT PORTABLE ACROSS EMBEDDING MODELS. It is a cut through one
 * model's distance distribution, and the two deployments do not share one:
 *
 *   - dev / OpenAI text-embedding-3-small: float vectors, COSINE distance.
 *     Measured across three unrelated subjects (irrigation, wearable heart-rate,
 *     battery electrolytes); every distribution sat in the same narrow band with
 *     a cliff just past ~0.375 where ranking flattens and results stop being
 *     about the subject. 0.35 sits below that cliff on all three.
 *   - production / Voyage voyage-3.5-lite: BINARY vectors, HAMMING distance.
 *     A completely different distribution. The cosine figure above is not
 *     evidence about it and must not be reused as one.
 *
 * So there is no binary default. Rather than guess a threshold for the 35M-row
 * production corpus — where too loose silently admits an enormous unrelated
 * field and too tight silently admits nothing — an unmeasured binary
 * installation leaves the semantic arm OFF and the field exactly as it behaves
 * today. Measure with `npx tsx scripts/whitespace-semantic-calibrate.ts`, then
 * set WHITESPACE_SEMANTIC_MAX_DISTANCE to what it reports.
 */
const CALIBRATED_COSINE_MAX_DISTANCE = 0.35

export const UNCALIBRATED_REASON =
  `No semantic distance ceiling is calibrated for ${PATENT_CORPUS_EMBEDDING_MODEL} ` +
  `(${PATENT_CORPUS_EMBEDDING_DTYPE} vectors), so the field was matched on concept wording alone. ` +
  `Measure the corpus with "npx tsx scripts/whitespace-semantic-calibrate.ts" and set ` +
  `WHITESPACE_SEMANTIC_MAX_DISTANCE to enable semantic matching.`

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
 * Why the semantic arm may not run right now, or null when it may. The two
 * reasons demand opposite actions — "go calibrate" is wrong advice for an
 * operator who deliberately switched the arm off — so they are never conflated.
 */
export function semanticArmUnavailableReason(): string | null {
  if (killSwitchEngaged()) return DISABLED_REASON
  if (resolveMaxDistance() === null) return UNCALIBRATED_REASON
  return null
}

/**
 * The configured ceiling, or null when this installation has none — in which
 * case the semantic arm must not run at all. Never falls back to a default for
 * a distance metric it was not measured on.
 *
 * `WHITESPACE_SEMANTIC_MAX_DISTANCE=off` (or any number <= 0) is the operator
 * kill switch: without it a float installation could never turn the semantic
 * arm off, since an unset value falls through to the measured cosine default.
 */
export function resolveMaxDistance(): number | null {
  if (killSwitchEngaged()) return null
  const raw = (process.env.WHITESPACE_SEMANTIC_MAX_DISTANCE || '').trim().toLowerCase()
  const configured = Number(raw)
  if (raw && Number.isFinite(configured) && configured > 0) return Math.min(1, configured)
  if (PATENT_CORPUS_EMBEDDING_DTYPE === 'binary') return null
  return CALIBRATED_COSINE_MAX_DISTANCE
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
  /** The normalised distance ceiling actually applied. */
  maxDistance: number
}

const UNAVAILABLE = (reason: string): FieldCandidates => ({
  ids: [],
  available: false,
  reason,
  saturated: false,
  cap: CANDIDATE_CAP,
  maxDistance: resolveMaxDistance() ?? 0,
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
function cacheKey(scope: WhitespaceScope, cap: number, maxDistance: number): string {
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
    maxDistance,
  })
}

const cache = new Map<string, { at: number; value: FieldCandidates }>()

/**
 * The structural half of the scope: everything except the concept text.
 *
 * Built by asking buildScopeFilter for a concept-free scope, so the year, CPC,
 * jurisdiction and assignee semantics stay defined in exactly one place. The
 * corpus-membership and exclusion predicates are then added explicitly, because
 * both normally ride inside the concept text predicate this variant omits.
 */
function structuralFilter(scope: WhitespaceScope): Prisma.Sql {
  const conceptFree: WhitespaceScope = { ...scope, concepts: [], exclusions: [] }
  const clauses = [buildScopeFilter(conceptFree), corpusMembershipPredicate()]
  const exclusions = exclusionPredicate(scope)
  if (exclusions) clauses.push(exclusions)
  return Prisma.join(clauses, ' AND ')
}

export async function resolveFieldCandidates(
  scope: WhitespaceScope,
  options: { cap?: number; maxDistance?: number; timeoutMs?: number } = {}
): Promise<FieldCandidates> {
  const cap = options.cap ?? CANDIDATE_CAP
  const maxDistance = options.maxDistance ?? resolveMaxDistance()
  const queryText = candidateQueryText(scope)
  // No concepts means no lexical concept gate either, so the field is already
  // the whole structural slice — there is nothing for the semantic arm to widen.
  if (!queryText) return UNAVAILABLE('The scope states no concepts, so no semantic candidates are needed.')
  if (!semanticLaneConfigured()) {
    return UNAVAILABLE('Semantic search is not configured (no embedding key), so the field is lexical-only.')
  }
  // Refuse rather than guess: admitting documents by an unmeasured similarity
  // threshold would change what every study means, silently.
  if (maxDistance === null) return UNAVAILABLE(semanticArmUnavailableReason() ?? UNCALIBRATED_REASON)

  const key = cacheKey(scope, cap, maxDistance)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  const result = await semanticNeighbors({
    queryText,
    limit: cap,
    maxDistance,
    scopeFilter: structuralFilter(scope),
    timeoutMs: options.timeoutMs ?? CANDIDATE_TIMEOUT_MS,
  })

  const value: FieldCandidates = result.available
    ? {
        ids: result.neighbors.map(neighbor => neighbor.id),
        available: true,
        saturated: result.neighbors.length >= cap,
        cap,
        maxDistance,
      }
    : UNAVAILABLE(result.reason)

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
  const base = `Field matched on concept text OR semantic similarity: ${candidates.ids.length.toLocaleString()} documents were admitted by meaning rather than wording (within a ${candidates.maxDistance} embedding-distance ceiling).`
  return candidates.saturated
    ? `${base} That is the ${candidates.cap.toLocaleString()}-document ceiling, so the semantic arm is the nearest ${candidates.cap.toLocaleString()} rather than every document inside the ceiling — narrow the scope for an unclipped semantic arm.`
    : base
}

/** Test seam: the memo is process-wide and would otherwise leak across cases. */
export function __clearCandidateCache(): void {
  cache.clear()
}
