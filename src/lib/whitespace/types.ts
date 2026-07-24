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
