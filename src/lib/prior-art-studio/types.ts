// Prior-Art Studio shared contract: the StudioPlan is the single source of
// truth for a search. The canvas edits it, the compiler executes it, the trail
// records it. Every ranking influence must be visible somewhere in this object.

export type StudioBlockMode = 'MATCH' | 'EXPAND' | 'BOTH'

export type StudioTermOrigin = 'user' | 'copilot'

export interface StudioTerm {
  text: string
  origin: StudioTermOrigin
  /** Copilot proposals start unaccepted ("ghost chips") and are inert until accepted. */
  accepted: boolean
}

export interface StudioBlock {
  id: string
  label: string
  /** MATCH = hard keyword gate (narrows). EXPAND = semantic cast (widens). BOTH = both lanes. */
  mode: StudioBlockMode
  terms: StudioTerm[]
}

export interface StudioElement {
  id: string
  text: string
  origin: StudioTermOrigin
}

/** Categorical evidence for one (document × element) pair. Never a bare score. */
export type StudioElementVerdict = 'STRONG' | 'PART' | 'WEAK' | 'NONE'

export interface StudioElementCell {
  verdict: StudioElementVerdict
  /** Element words literally present in the document's text — the checkable part. */
  matchedTerms: string[]
  termCoverage: number
  /** Raw embedding similarity, kept for the evidence popover only. */
  similarity?: number
  /** Which text tier this verdict was read from. Abstract-tier is NOT a claim mapping. */
  tier: 'abstract' | 'claims'
}

/** Documents the attorney marked relevant, fed back as a visible ranking influence. */
export interface StudioSteer {
  enabled: boolean
  publicationNumbers: string[]
  weight: number
}

export interface StudioCpcSuggestion {
  code: string
  definition?: string
  origin: StudioTermOrigin
  accepted: boolean
}

export interface StudioFilters {
  jurisdictions: string[]
  publicationDateFrom?: string
  publicationDateTo?: string
  applicants?: string[]
  inventors?: string[]
}

export interface StudioPlan {
  title: string
  blocks: StudioBlock[]
  /** Excluded vocabulary (NOT block). */
  notTerms: StudioTerm[]
  /** Claim-element decomposition; drives per-element evidence and the Element Grid. */
  elements: StudioElement[]
  cpc: StudioCpcSuggestion[]
  filters: StudioFilters
  /** Natural-language summary used for the concept vector. */
  conceptSummary?: string
  /**
   * Ranking influence from marked documents. Lives ON the plan by design: no
   * hidden signal may ever affect ranking, so steering is visible on the canvas
   * and removable in one click.
   */
  steer?: StudioSteer
}

export type StudioDocTag = 'RELEVANT' | 'MAYBE' | 'NOT_RELEVANT'

export interface StudioFamilyMember {
  publicationNumber: string
  title?: string
  publicationDate?: string | null
  jurisdiction?: string
}

export interface StudioResultFamily {
  familyKey: string
  publicationNumber: string
  title: string
  abstract?: string | null
  snippet?: string | null
  applicants?: string
  publicationDate?: string | null
  jurisdiction?: string
  classifications?: string[]
  link?: string | null
  members: StudioFamilyMember[]
  /** Which recall lanes surfaced this family: exact keyword, semantic vector, or both. */
  lane: 'match' | 'cast' | 'both' | 'other'
  rerankScore?: number
  hybridScore?: number
  matchedFields?: string[]
  matchReasons?: string[]
  isNew?: boolean
  /**
   * Does this document literally satisfy every MATCH block? NOTHING is removed
   * on this basis — it is a classification the attorney filters by, because a
   * document that misses your exact words may still be the closest art.
   */
  meetsMatch?: boolean
  /** Contains one of the attorney's NOT terms. Flagged and hidden by default, never deleted. */
  hitsNotTerm?: boolean
  /** Per-element evidence, keyed by element id. Present when the plan has elements. */
  elementCells?: Record<string, StudioElementCell>
}

/** One constraint's contribution to narrowing — what the Filters gate removed. */
export interface StudioGateConstraint {
  label: string
  remaining: number | null
  removed: number | null
  isEstimate: boolean
}

export interface StudioGateDetail {
  constraints: StudioGateConstraint[]
  /** "What one change would do" — the sensitivity read. */
  sensitivity: Array<{ label: string; value: string }>
  /** Coverage gaps that apply to every query in this corpus. */
  disclosures: string[]
}

/** The stopping rule: are new relevant documents still appearing? */
export interface StudioSaturation {
  reviewed: number
  buckets: Array<{ reviewed: number; newRelevant: number }>
  recentRelevant: number
  suggestion: string
}

export interface StudioTheoryPayload {
  id: string
  kind: 'ANTICIPATION' | 'COMBINATION'
  publicationNumbers: string[]
  motivation: string
  createdAt: string
}

export interface StudioGateCounts {
  corpus: number | null
  corpusIsEstimate: boolean
  filters: number | null
  filtersIsEstimate: boolean
  recall: number
  /** Documents that do NOT satisfy every MATCH block (still shown, filterable). */
  matchRemoved?: number
  /** Documents that satisfy every MATCH block. */
  matchSatisfied?: number
  /** Documents containing a NOT term (flagged, hidden by default, never deleted). */
  notHits?: number
  /** Whether MATCH ran as an index-backed recall lane or as a filter over retrieved candidates. */
  matchMode?: 'filter' | 'lane' | 'none'
  families: number
  shown: number
  lanes: { matchOnly: number; castOnly: number; both: number }
  /** Share of meaning-only hits sharing no query term — the vocabulary-gap signal. */
  vocabularyGap?: number
  /** False when the embedding lane was skipped — lane counts are then meaningless. */
  semanticLaneRan?: boolean
  /** Which budget this run used: deep (30-60s, full probes) or fast scan. */
  depth?: 'deep' | 'fast'
  steered?: boolean
}

export interface StudioRunPayload {
  runId: string
  planVersion: number
  planHash: string
  createdAt: string
  gateCounts: StudioGateCounts
  gateDetail?: StudioGateDetail
  families: StudioResultFamily[]
  warnings: string[]
  newFamilyCount: number
  durationMs: number
  booleanPreview: string
  /** Terms harvested from meaning-only hits — one-click vocabulary repair. */
  suggestedTerms?: string[]
}

export interface StudioTrailEntryPayload {
  id: string
  kind: string
  actor: string
  summary: string
  createdAt: string
}

export function emptyStudioPlan(): StudioPlan {
  return {
    title: '',
    blocks: [],
    notTerms: [],
    elements: [],
    cpc: [],
    filters: { jurisdictions: ['*'] },
    conceptSummary: '',
  }
}

/** Terms that actually execute: user terms plus accepted Copilot proposals. */
export function activeTerms(terms: StudioTerm[]): string[] {
  return terms.filter(t => t.accepted).map(t => t.text.trim()).filter(Boolean)
}

export function activeCpcCodes(plan: StudioPlan): string[] {
  return plan.cpc.filter(c => c.accepted).map(c => c.code.trim()).filter(Boolean)
}
