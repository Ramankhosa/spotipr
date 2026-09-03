/**
 * Whitespace Studio — shared contracts.
 *
 * The scope is the study's premise: a transparent, editable statement of what
 * will be searched and what has been assumed. It is deliberately verbose,
 * because scope errors are the dominant source of wrong answers in patent
 * analytics and they are invisible unless written down.
 */

export type WhitespaceRunStage = 'FIELD_MAP' | 'CLUSTER' | 'SIGNALS' | 'DEEP_DIVE' | 'VALIDATE' | 'DIMENSION_MAP'

export type WhitespaceRunStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

/** FIELD = landscape census pipeline; INVENTION = dimension-map pipeline. */
export type WhitespaceStudyKind = 'FIELD' | 'INVENTION'

export type LiveStepState = 'pending' | 'active' | 'done' | 'skipped' | 'failed'

/** One declared unit of a stage's work. `done` is reachable only from `active`. */
export interface LiveStep {
  key: string
  /** Plain attorney English, present tense. */
  label: string
  state: LiveStepState
  /** One human status line; the reason when skipped or failed. */
  detail?: string
  /** Count-don't-guess progress inside the step; never an estimate. */
  n?: number
  total?: number
}

export interface LiveCounter {
  key: string
  label: string
  /** Null until first measured — never a fabricated zero. */
  value: number | null
  total?: number
}

export type LiveEventKind = 'read' | 'count' | 'attack' | 'model' | 'note'

export interface LiveEvent {
  /** Monotonic within one attempt, starting at 1. */
  seq: number
  /** Epoch ms, worker clock. */
  t: number
  kind: LiveEventKind
  /** ≤ 160 chars; narrates what was DONE, never what was found. */
  text: string
}

/**
 * Live narration for a run in flight, written at heartbeat points.
 *
 * `phase` / `detail` / `round` are the v1 contract every reader understands
 * (phase = the active step's key, detail = its detail or label). The v2 fields
 * carry the structured live state the activity panel renders; a row written by
 * a pre-upgrade worker simply lacks them. Everything here must be plain JSON.
 */
export interface WhitespaceRunProgress {
  phase: string
  detail: string
  round?: number
  v?: 2
  stage?: WhitespaceRunStage
  /** The run's attemptCount for this narration; a retry starts a new sequence. */
  attempt?: number
  steps?: LiveStep[]
  counters?: LiveCounter[]
  /** Rolling window (≤ 20) of the newest events, ascending seq. */
  recent?: LiveEvent[]
  /** Last seq assigned, so a reader can detect events that left the window. */
  seq?: number
  /** Attempt start, epoch ms (worker clock). */
  startedAt?: number
  updatedAt?: number
  /** Narration writes that blipped (swallowed DB errors), for the internals line. */
  writeFailures?: number
}

export type TrailKind = 'SCOPE' | 'RUN' | 'EDIT' | 'HYPOTHESIS' | 'CHALLENGE' | 'NOTE' | 'SYSTEM' | 'SEARCH'

/** Where a scope element came from. User-authored entries are never overwritten by a recompile. */
export type ScopeOrigin = 'user' | 'copilot'

export interface ScopeConcept {
  id: string
  /** The concept as the user would say it. */
  label: string
  /**
   * Alternative phrasings actually used in patent text — functional language,
   * scientific terminology, industry jargon, acronyms. This is what the
   * terminology-divergence probe later measures against.
   */
  synonyms: string[]
  /** Required concepts must appear; optional ones broaden recall. */
  required: boolean
  origin: ScopeOrigin
}

export interface ScopeClassification {
  /** CPC code, e.g. "A61B5/1455". Stored uppercase, no spaces. */
  code: string
  /** Plain-language gloss so the user never needs to know CPC to review the scope. */
  definition?: string
  /** Set when the compiler thinks a code may drag in an unrelated field. */
  caution?: string
  origin: ScopeOrigin
  accepted: boolean
}

export interface ScopeExclusion {
  term: string
  /** Why this is excluded — shown to the user so the decision is reviewable. */
  reason?: string
  origin: ScopeOrigin
}

/**
 * A written assumption the compiler made. These are the most-skipped and
 * most-consequential part of the scope screen, which is why they are a
 * first-class field rather than prose buried in a summary.
 */
export interface ScopeAssumption {
  id: string
  text: string
  /** Interpretation assumptions are correctable; corpus assumptions are facts about our data. */
  kind: 'interpretation' | 'corpus'
}

/**
 * How the concept list turns into a field.
 *
 * A document is in the field when it matches EVERY required concept AND at least
 * `minimumOptionalConcepts` of the optional ones. This is the knob that was
 * missing: the required flag alone gave a step function — one required concept
 * matched a whole sector, two intersected to a reading list — and nothing in
 * between could be asked for. "At least k of the others" is the ladder between
 * those two extremes, and `'auto'` (the default) climbs it at run time to the
 * tightest rung that still yields a field the study can analyse, then reports
 * every rung it measured so the choice is reviewable rather than hidden.
 *
 * With no required concept, k = 1 is the loosest rung (the union of the
 * concepts) — k = 0 would delete the concept gate altogether.
 */
export interface ScopeMatching {
  minimumOptionalConcepts: number | 'auto'
}

export interface WhitespaceScope {
  title: string
  /** One-paragraph restatement of the field, for the user to confirm or correct. */
  summary: string
  concepts: ScopeConcept[]
  classifications: ScopeClassification[]
  exclusions: ScopeExclusion[]
  assumptions: ScopeAssumption[]
  filters: {
    /** Inclusive year bounds. The corpus starts at 2000; earlier values are clamped. */
    yearFrom: number
    yearTo: number
    /** Two-letter country codes. Empty means all jurisdictions. */
    jurisdictions: string[]
    /** Canonicalised assignee names to restrict to. Empty means all. */
    assignees: string[]
  }
  /** Absent on scopes saved before the rule existed; read as `'auto'`. */
  matching?: ScopeMatching
}

/** The matching rule with its default applied. */
export function scopeMatching(scope: Pick<WhitespaceScope, 'matching'>): ScopeMatching {
  return scope.matching ?? { minimumOptionalConcepts: 'auto' }
}

// ---------------------------------------------------------------------------
// The resolved field rule (what a run actually counted)
// ---------------------------------------------------------------------------

/** One rung of the "at least k of the optional concepts" ladder, as measured. */
export interface FieldRuleRung {
  minimumOptional: number
  /** Exact when `overCap` is false; a floor (the cap) when it is. Null when unmeasured. */
  publications: number | null
  families: number | null
  /** The rung matched more than the band's publication ceiling — never staged in full. */
  overCap: boolean
  /** The rung could not even be sized within the budget; treated as over the cap. */
  timedOut: boolean
  /** Not measured: too many concept combinations to compile, or the fit stopped early. */
  skipped: boolean
}

export type FieldRuleFit =
  /** A rung landed inside the band. */
  | 'in-band'
  /** Even the loosest rung is below the family floor. */
  | 'too-narrow'
  /** Even the tightest rung is above the publication ceiling. */
  | 'too-broad'
  /** Adjacent rungs jump from below the floor to above the ceiling. */
  | 'cliff'
  /** The user pinned k; nothing was fitted. */
  | 'pinned'
  /** Nothing to fit: no optional concepts, or the scope has no concepts at all. */
  | 'none'

export interface FieldRule {
  mode: 'auto' | 'pinned'
  requiredCount: number
  optionalCount: number
  /** The k in force for this run. */
  minimumOptional: number
  fit: FieldRuleFit
  /** The rungs considered, tightest first. */
  ladder: FieldRuleRung[]
  band: { minFamilies: number; maxPublications: number }
}

/** The corpus cannot see behind this year. Stamped on every visual. */
export const CORPUS_FIRST_YEAR = 2000

export function emptyWhitespaceScope(): WhitespaceScope {
  return {
    title: '',
    summary: '',
    concepts: [],
    classifications: [],
    exclusions: [],
    assumptions: [],
    filters: {
      yearFrom: CORPUS_FIRST_YEAR,
      yearTo: new Date().getFullYear(),
      jurisdictions: [],
      assignees: [],
    },
  }
}

/**
 * JSON serialisation with recursively sorted object keys.
 *
 * Exists for one reason: Postgres jsonb does NOT preserve object key order, so
 * a scope or params object compared against its own database round-trip with
 * plain JSON.stringify almost never matches — which made the run deduper admit
 * duplicate live runs and made the cluster stage re-count a field whose census
 * it already held. Compare jsonb-round-tripped values with THIS, never with
 * JSON.stringify.
 */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(entry => stableJson(entry)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}

// ---------------------------------------------------------------------------
// Field map (stage 1) output
// ---------------------------------------------------------------------------

export interface YearCount {
  year: number
  families: number
}

export interface LabelledCount {
  label: string
  families: number
  /** Optional plain-language gloss, used for CPC codes. */
  definition?: string
}

/**
 * What fraction of the field we can actually read at claim level.
 *
 * No competitor publishes this. It is unglamorous and it is the most honest
 * number in the product — gate G1 reads it, and the claim-element screen
 * refuses to draw conclusions when it is low.
 */
export interface TextCoverage {
  familiesTotal: number
  withClaims: number
  withDescription: number
  /** Claim availability broken out by country, because it is wildly uneven. */
  byJurisdiction: Array<{ country: string; families: number; withClaims: number }>
}

// ---------------------------------------------------------------------------
// Cluster (stage 2) / signals (stage 3) output
// ---------------------------------------------------------------------------

/** One human status per area; raw geometry stays in the advanced disclosure. */
export type ClusterGrade = 'well-defined' | 'usable' | 'diffuse'

export interface ClusterMetrics {
  /** log1p-scaled, P95-normalised family density in [0, ~1]. Null before SIGNALS. */
  density: number | null
  /** 5-year filing CAGR %, trailing publication lag excluded. Null when series too short. */
  velocityPct: number | null
  /** Herfindahl index over canonical assignees, 0..1. */
  hhi: number | null
  /** 0.5·D + 0.3·pct(V) + 0.2·(1−HHI) — see plan 10.3. */
  crowdedness: number | null
  /** Share of families filed in the last 5 complete years. */
  recencyShare: number | null
  jurisdictions: Array<{ country: string; families: number }>
  topAssignees: Array<{ label: string; families: number }>
  cpcMix: Array<{ code: string; families: number }>
  /** Map coordinates in [0,1]² — a selector, never evidence. */
  layout: { x: number; y: number }
}

export interface ClusterSummary {
  id: string
  label: string
  description: string | null
  keywords: string[]
  grade: ClusterGrade
  memberCount: number
  /** Sample-weight extrapolation — always presented as an estimate. */
  fieldEstimate: number
  metrics: ClusterMetrics | null
  cohesion: number | null
  separation: number | null
  silhouette: number | null
}

export interface ClusterStageResult {
  clusterCount: number
  sampledFamilies: number
  fieldFamilies: number
  /** fieldFamilies / sampledFamilies — the extrapolation factor. */
  sampleWeight: number
  k: number
  iterations: number
  coverageNotes: string[]
  generatedAt: string
}

export interface TermDivergence {
  concept: string
  /** Families the concept's wording reaches, capped — a floor at the cap, never a denominator. */
  lexicalCount: number
  /** Families the semantic lane retrieved for this concept. */
  semanticCount: number | null
  /**
   * Share of the RETRIEVED families that the concept's own wording also matches.
   * Directional on purpose: a symmetric set overlap between a ranked top-N and
   * an arbitrary LIMIT-N is near zero whatever the vocabulary looks like. Null
   * when the semantic lane or the agreement test could not run.
   */
  overlapPct: number | null
  /** Titles from semantic-only hits, summarising the vocabulary the scope misses. */
  semanticOnlyVocabulary: string | null
  divergent: boolean
}

export interface SignalsStageResult {
  clustersScored: number
  divergence: TermDivergence[]
  coverageNotes: string[]
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Deep dive (stage 4) output
// ---------------------------------------------------------------------------

export interface ClaimElementFamily {
  familyKey: string
  publicationNumber: string
  title: string
  elements: string[]
  problem: string | null
  solution: string | null
  constraint: string | null
  claimsAvailability: string
}

export interface RarePair {
  a: string
  b: string
  supportA: number
  supportB: number
  observed: number
  expected: number
  /**
   * Adjusted standardised residual; negative means rarer than chance. Divides by
   * sqrt(E·(1−pₐ)(1−p_b)), the margins-fixed variance — not sqrt(E), which is
   * only the right denominator when both margins are a small share of the set.
   */
  z: number
  /** clamp(−z / 3, 0, 1) — valid only above the support floor. SATURATES at 1; never rank on it. */
  rarity: number
  /**
   * −log10 P(observed or fewer) under Poisson(expected), in decibans. Unlike
   * `rarity` this does not saturate, so it is what ranking must use: an empty
   * cell expecting 500 families scores 217, one expecting 6 scores 2.6, and
   * both would score exactly 1.0 on `rarity`.
   */
  surprisal: number
}

export interface DeepDiveResult {
  clusterId: string
  clusterLabel: string
  familiesConsidered: number
  familiesWithClaims: number
  familiesExtracted: number
  /** Support per normalised element string. */
  elementSupport: Array<{ element: string; families: number }>
  rarePairs: RarePair[]
  supportFloor: number
  problemSolution: Array<{ problem: string; solutions: string[]; families: number }>
  coverageNotes: string[]
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Dimension map (invention whitespace) output
// ---------------------------------------------------------------------------

export type DimensionProvenance = 'seed' | 'grow' | 'user'

/**
 * One position along a viewpoint. Values are vocabulary, not a partition — a
 * family may occupy several values of one dimension (F-terms allow this too),
 * so value counts must never be drawn as shares of a whole.
 */
export interface DimensionValue {
  id: string
  label: string
  /** The phrasings this value matches. This vocabulary IS the measurement. */
  synonyms: string[]
  /** The websearch string the value compiled to, so every count is reproducible. */
  query: string
  /** Exact families in scope matching this value — SQL over the full field. */
  families: number
  /** families / familyCount. */
  share: number
  /** Sample-side count from the discovery loop, labelled as such wherever shown. */
  sampleFamilies: number
  round: number
  provenance: DimensionProvenance
}

/** A viewpoint that organises the field — the JPO F-term sense of the word. */
export interface Dimension {
  id: string
  label: string
  /** What question this axis asks of a document. */
  description: string
  values: DimensionValue[]
  introducedInRound: number
  /** Families occupying at least one value. NOT the sum of value counts. */
  assignedFamilies: number
  residualFamilies: number
  residualShare: number
  /** sum(value.families) / assignedFamilies; above 1 means values overlap. */
  multiAssignmentRatio: number
  sampleAssignedFamilies: number
  sampleResidualShare: number
}

export type DimensionRejectionReason =
  | 'BELOW_SAMPLE_FLOOR'
  | 'DUPLICATE_OF_EXISTING'
  | 'DIMENSION_RESTATES_EXISTING'
  | 'EXPLAINS_TOO_LITTLE_RESIDUAL'
  | 'QUERY_STEMS_TO_NOTHING'
  | 'REGISTRY_FULL'

/**
 * One discovery round. Every rejection is kept with its measured reason —
 * "what we tried and dropped" is a large part of why the registry is trustable.
 */
export interface DimensionRound {
  round: number
  slice: { families: number; basis: 'sample' | 'residual' }
  proposedDimensions: string[]
  proposedValues: Array<{ dimension: string; value: string }>
  acceptedDimensions: string[]
  acceptedValues: Array<{ dimension: string; value: string }>
  rejected: Array<{ kind: 'dimension' | 'value'; label: string; reason: DimensionRejectionReason; detail: string }>
  /** Sample-side share of families no dimension places, after this round. */
  residualShareAfter: number
  modelCode: string | null
}

/** Only cells with observed > 0 are listed; absence means zero. */
export interface DimensionMatrixCell {
  aValueId: string
  bValueId: string
  observed: number
}

export interface DimensionMatrix {
  aDimensionId: string
  bDimensionId: string
  /**
   * Sample-side overlap between the two axes in [0,1]; high means they place
   * the same documents in the same groups. Null when not measurable.
   */
  redundancy: number | null
  /** Whether gaps were harvested from this pair. */
  harvested: boolean
  skipReason: string | null
  cells: DimensionMatrixCell[]
}

export interface DimensionGapNearMiss {
  valueId: string
  valueLabel: string
  families: number
}

/**
 * An empty (or near-empty) cell with healthy margins. observed === 0 with
 * expected >= 5 is what makes the zero surprising rather than arithmetic.
 */
export interface DimensionGap {
  id: string
  aDimensionId: string
  aDimensionLabel: string
  aValueId: string
  aValueLabel: string
  bDimensionId: string
  bDimensionLabel: string
  bValueId: string
  bValueLabel: string

  observed: number
  marginA: number
  marginB: number
  expected: number
  z: number
  /** Saturates at 1 for expected >= 9 — kept for display, never for ranking. */
  rarity: number
  /** −log10 P(observed or fewer) in decibans. The non-saturating ranking signal. */
  surprisal: number

  /** Largest co-occupancy of A with any OTHER value of B — proof the cell was reachable. */
  nearMissB: DimensionGapNearMiss | null
  nearMissA: DimensionGapNearMiss | null
  /** Families on A occupying NO value of B. Large = vocabulary hole, not technology hole. */
  unassignedOnB: number
  unassignedOnA: number

  /** Claim readability of the A-arm slice; null when the facet could not run. */
  armFamilies: number | null
  armClaimsReadable: number | null

  coverageSuspect: boolean
  suspectReason: string | null
  /** Deterministic rank in [0,1]; every factor is inspectable in the row. */
  rank: number
  /** Set when the user promotes this gap to a hypothesis. */
  hypothesisId: string | null
}

export type DimensionSettledReason =
  | 'RESIDUAL_UNDER_FLOOR'
  | 'NO_ACCEPTED_ADDITIONS'
  | 'REGISTRY_FULL'
  | 'MAX_ROUNDS'
  | 'REGISTRY_SUPPLIED'

export interface DimensionMapResult {
  familyCount: number
  publicationCount: number
  sample: {
    families: number
    /** familyCount / sample size. A label, never an extrapolation factor. */
    weight: number
    method: 'md5-family-key'
  }
  registry: Dimension[]
  rounds: DimensionRound[]
  settled: boolean
  settledReason: DimensionSettledReason
  matrices: DimensionMatrix[]
  gaps: DimensionGap[]
  /** The thresholds actually applied, so the ranking is reproducible. */
  thresholds: {
    marginFloor: number
    expectedFloor: number
    residualCeiling: number
    redundancyCeiling: number
  }
  /** Families matching no value of any dimension, census-side. */
  unclassifiedFamilies: number
  unclassifiedShare: number
  coverageNotes: string[]
  /** Harder than notes: what this result cannot answer at all. */
  limitations: string[]
  /** How the concept list was turned into this field. Absent on runs before the rule existed. */
  fieldRule?: FieldRule
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Hypotheses (stages 5-6)
// ---------------------------------------------------------------------------

export type WhitespaceType =
  | 'UNDETERMINED'
  | 'DATA_WHITESPACE'
  | 'TERMINOLOGY_WHITESPACE'
  | 'PATENT_WHITESPACE'
  | 'CLAIM_WHITESPACE'
  | 'SCIENTIFIC_WHITESPACE'
  | 'PRODUCT_WHITESPACE'
  | 'TECHNICAL_FEASIBILITY_WHITESPACE'
  | 'COMMERCIAL_WHITESPACE'
  | 'REGULATORY_WHITESPACE'
  | 'GENUINE'

export interface HypothesisScores {
  density: number | null
  rarity: number | null
  semanticNovelty: number | null
  evidenceQuality: number | null
  confidence: number | null
  crowdedness: number | null
  /** Multiplicative rank score — any collapsed pillar collapses it. */
  strength: number | null
}

export interface AttackRecord {
  strategy: 'SYNONYM_SHIFTED' | 'SEMANTIC_PARAPHRASE' | 'CPC_ADJACENT' | 'ASSIGNEE_PIVOT' | 'RED_TEAM' | 'LITERATURE'
  query: string
  hits: number
  /** CLEAN (nothing close), WEAKENING (partial matches), REFUTING (full combination present). */
  outcome: 'CLEAN' | 'WEAKENING' | 'REFUTING' | 'NOT_RUN'
  /** Why the attack could not run, when outcome is NOT_RUN. */
  reason?: string
}

export interface GateOutcome {
  gate: 'G1_DATA' | 'G2_TERMINOLOGY' | 'G3_ADJACENT_CLAIMS' | 'G4_FEASIBILITY' | 'G5_COMMERCIAL' | 'G6_REGULATORY'
  outcome: 'PASSED' | 'PASSED_WITH_WEAKENING' | 'FAILED' | 'ADVISORY' | 'UNASSESSED'
  basis: string
  /**
   * The number the gate decided on, when it decided on one (G1: claims-readable
   * share in [0,1]). Carried structurally because scoring needs it: it used to
   * be recovered by regex-scraping a percentage back out of `basis`, so any
   * rewording of that human sentence silently swapped the measured coverage for
   * a hardcoded 0.5 and moved every confidence score with it.
   */
  measured?: number | null
}

export interface ValidationRecord {
  attacks: AttackRecord[]
  gates: GateOutcome[]
  attacksPlanned: number
  attacksRun: number
  redTeamNotes: string | null
  validatedAt: string
}

/**
 * The attorney's verdict. Deliberately NOT the same words as the machine's
 * `status`: the system reports whether a hypothesis survived its attacks, the
 * attorney reports whether it is worth pursuing, and a report that blurred the
 * two would let a surviving-but-worthless direction read as endorsed.
 */
export type HumanReviewVerdict = 'ENDORSED' | 'REJECTED' | 'NEEDS_INVESTIGATION'

export const HUMAN_REVIEW_VERDICTS: readonly HumanReviewVerdict[] = [
  'ENDORSED',
  'REJECTED',
  'NEEDS_INVESTIGATION',
]

/** Stored in WhitespaceHypothesis.humanReview. Null there means unreviewed. */
export interface HumanReview {
  verdict: HumanReviewVerdict
  /**
   * Required when the verdict is REJECTED — the machine can say a hypothesis
   * died, but the reason a human kills one has to be written by that human.
   */
  note: string | null
  reviewedById: string
  /** ISO timestamp. */
  reviewedAt: string
}

/** Minimum characters of reasoning before a REJECTED verdict is accepted. */
export const MIN_REVIEW_NOTE = 20

export interface FieldMapResult {
  familyCount: number
  publicationCount: number
  /** Filing year series. Never truncated — the lag boundary is marked instead. */
  filingsByYear: YearCount[]
  /**
   * Filing counts within this many months of the data edge are structurally
   * undercounted by the ~18-month publication delay. Marked, not removed.
   */
  publicationLagMonths: number
  jurisdictions: LabelledCount[]
  classifications: LabelledCount[]
  assignees: LabelledCount[]
  /** Kind-code + age heuristic. Labelled a proxy in the UI, never "legal status". */
  statusProxy: { granted: number; pending: number; unknown: number }
  textCoverage: TextCoverage
  /**
   * Corpus -> filters -> concepts -> families, Studio-style funnel transparency.
   *
   * `corpus` and `afterFilters` are NULL because this census does not measure
   * them: it evaluates the whole scope predicate in one pass, so the population
   * before the filters and before the concept gate is never counted. They were
   * previously filled with the post-concept publication count, which made the
   * funnel read 66 -> 66 -> 66 and claimed the scope had narrowed twice when it
   * had only ever been measured once. A funnel step that was not measured is
   * null, and the UI renders only measured steps.
   */
  gateCounts: {
    corpus: number | null
    afterFilters: number | null
    afterConcepts: number
    families: number
  }
  /** Data-quality caveats computed at run time and carried into every hypothesis. */
  coverageNotes: string[]
  /** How the concept list was turned into this field. Absent on runs before the rule existed. */
  fieldRule?: FieldRule
  generatedAt: string
}
