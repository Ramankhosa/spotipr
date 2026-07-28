/**
 * Whitespace Studio — shared contracts.
 *
 * The scope is the study's premise: a transparent, editable statement of what
 * will be searched and what has been assumed. It is deliberately verbose,
 * because scope errors are the dominant source of wrong answers in patent
 * analytics and they are invisible unless written down.
 */

export type WhitespaceRunStage = 'FIELD_MAP' | 'CLUSTER' | 'SIGNALS' | 'DEEP_DIVE' | 'VALIDATE'

export type WhitespaceRunStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export type TrailKind = 'SCOPE' | 'RUN' | 'EDIT' | 'HYPOTHESIS' | 'CHALLENGE' | 'NOTE' | 'SYSTEM'

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
  lexicalCount: number
  semanticCount: number | null
  /** Jaccard overlap % of top-N family sets; null when the semantic lane was unavailable. */
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
  /** Standardised residual z; negative means rarer than chance. */
  z: number
  /** clamp(−z / 3, 0, 1) — valid only above the support floor. */
  rarity: number
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
}

export interface ValidationRecord {
  attacks: AttackRecord[]
  gates: GateOutcome[]
  attacksPlanned: number
  attacksRun: number
  redTeamNotes: string | null
  validatedAt: string
}

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
  /** Corpus -> filters -> concepts -> families. Studio-style funnel transparency. */
  gateCounts: {
    corpus: number
    afterFilters: number
    afterConcepts: number
    families: number
  }
  /** Data-quality caveats computed at run time and carried into every hypothesis. */
  coverageNotes: string[]
  generatedAt: string
}
