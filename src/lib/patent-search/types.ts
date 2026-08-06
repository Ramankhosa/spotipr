import type { ExternalAiUsageContext } from '@/lib/external-ai-usage'

export type PatentSearchProviderId =
  | 'indian-corpus'
  | 'pqai-corpus'
  | 'pqai'
  | 'google-patents'
  | 'google-patents-bigquery'
  | 'epo-ops'
  | 'uspto'
  | 'ip-australia'
  | 'wipo'
  | string

export type PatentSearchSourceMode =
  // Current default: search the stored corpus, scoped by the user's country selection.
  | 'LOCAL_CORPUS'
  | 'INDIAN_ONLY'
  | 'AUSTRALIA_ONLY'
  | 'EPO_ONLY'
  // Legacy modes retained so saved search configs keep resolving. PQAI is disabled, so
  // the PQAI_* modes now resolve to the local corpus lane (see resolveProviderIds).
  | 'PQAI_ONLY'
  | 'PQAI_PLUS_INDIAN'
  | 'PQAI_PLUS_AUSTRALIA'
  | 'PQAI_PLUS_EPO'
  | 'PQAI_PLUS_INDIAN_EPO'

export type PatentSearchMode = 'intelligent' | 'manual'

export type PatentSearchSort = 'relevance' | 'publicationDateDesc' | 'filingDateDesc'

export type PatentRetrievalQueryType = 'concept' | 'feature' | 'feature_pair' | 'semantic'

export interface PatentRetrievalQuery {
  id: string
  type: PatentRetrievalQueryType
  text: string
  weight?: number
  featureIndex?: number
  featureIndexes?: number[]
  label?: string
}

export interface PatentRetrievalMatch {
  queryId: string
  queryType: PatentRetrievalQueryType
  queryText: string
  rank: number
  score?: number
  featureIndexes?: number[]
  featureLabels?: string[]
}

export interface PatentSearchCapabilities {
  semantic: boolean
  fullText: boolean
  classification: boolean
  dateFilters: boolean
  numberLookup: boolean
  applicantFilter: boolean
  inventorFilter: boolean
}

export interface PatentSearchFilters {
  anyTextContains?: string[]
  titleContains?: string[]
  abstractContains?: string[]
  patentTextContains?: string[]
  publicationNumber?: string
  applicationNumber?: string
  classifications?: string[]
  cpcCodes?: string[]
  ipcCodes?: string[]
  applicants?: string[]
  inventors?: string[]
  /**
   * Two-letter authority codes (US, EP, WO, IN, ...) restricting the local corpus to
   * those patent offices. Empty/omitted searches every country. Legacy spellings are
   * reconciled by expandCountrySelection() in ./patent-countries.
   */
  countries?: string[]
  filingDateFrom?: string
  filingDateTo?: string
  publicationDateFrom?: string
  publicationDateTo?: string
  numberOfPagesMin?: number
  numberOfPagesMax?: number
  numberOfClaimsMin?: number
  numberOfClaimsMax?: number
  sourcePdfName?: string
  excludeTerms?: string[]
}

export interface PatentSearchQueryPlan {
  originalQuery: string
  normalizedQuery: string
  searchQuery: string
  semanticQuery: string
  inventionFeatures: string[]
  technicalKeywords: string[]
  synonyms: string[]
  mustHaveTerms: string[]
  excludedTerms: string[]
  cpcCodes: string[]
  ipcCodes: string[]
  classificationHints: string[]
  googlePatentKeywords?: string[]
  epoTitleKeywords?: string[]
  epoAbstractKeywords?: string[]
  epoCombinedKeywords?: string[]
  patentSearchConceptGroups?: PatentSearchConceptGroup[]
  searchPrecision?: PatentSearchPrecision
  fieldFilters: PatentSearchFilters
  explicitFilters: PatentSearchFilters
  searchVariants: string[]
  retrievalQueries?: PatentRetrievalQuery[]
  /** Literal alternatives within a group are OR-ed; every group must match. */
  literalMatchGroups?: PatentSearchLiteralMatchGroup[]
  llmExpanded: boolean
  confidence: number
  warnings: string[]
}

export type PatentSearchPrecision = 'broad' | 'refined'

export interface PatentSearchConceptGroup {
  id?: string
  label?: string
  kind?: 'core' | 'mechanism' | 'component' | 'narrowing' | 'excluded' | string
  terms: string[]
  required?: boolean
  excluded?: boolean
}

export interface PatentSearchRequest {
  searchMode?: PatentSearchMode
  query?: string
  title?: string
  inventionText?: string
  filters?: PatentSearchFilters
  providerIds?: PatentSearchProviderId[]
  jurisdictions?: string[]
  sourceMode?: PatentSearchSourceMode
  llmExpansion?: boolean
  limit?: number
  candidateLimit?: number
  offset?: number
  sort?: PatentSearchSort
  queryPlan?: Partial<PatentSearchQueryPlan>
  requestHeaders?: Record<string, string>
  skipTrigramSearch?: boolean
  disableLinkedProviderExpansion?: boolean
  /** Suppress the live-API fallback that runs when the local corpus returns nothing. */
  disableProviderFallback?: boolean
  strictSemantic?: boolean
  /**
   * Opt-in depth-over-speed budget (Prior-Art Studio). Raises the orchestrator
   * result/candidate ceilings, per-probe vector limits and the per-lane
   * statement timeout. Default off: the novelty pipeline and public API keep
   * today's fast-path behaviour unchanged.
   */
  deepSearch?: boolean
  maxSemanticQueryWords?: number
  suppressSensitiveLogging?: boolean
  /**
   * Optional sink for per-lane failures. Providers swallow lane errors by design
   * (a dead lane degrades the search rather than killing it), which means a run
   * where every lane timed out is indistinguishable from a run that genuinely
   * found nothing. Pass an array here and the provider records what died, so the
   * caller can say so instead of reporting an empty result as a finding.
   */
  laneDiagnostics?: SearchLaneDiagnostic[]
  /** Optional billing/observability identity for external embedding/rerank calls. */
  externalAiUsage?: ExternalAiUsageContext
}

export interface PatentSearchLiteralMatchGroup {
  id?: string
  label?: string
  terms: string[]
}

/** One lane (vector probe / full-text / field / metadata) that failed or timed out. */
export interface SearchLaneDiagnostic {
  providerId: string
  lane: string
  reason: 'timeout' | 'error'
  detail?: string
}

export interface PatentResultScores {
  semantic?: number
  text?: number
  title?: number
  /** Lexical hit inside claims or description, as opposed to title + abstract. */
  specification?: number
  classification?: number
  field?: number
  provider?: number
  hybrid?: number
  retrieval?: number
  conceptVector?: number
  bestFeatureVector?: number
  featureCoverage?: number
  rerank?: number
  /**
   * The fused retrieval score before reranking, normalised against the best hit in
   * its own result set. Kept for diagnostics and calibration only — it is relative,
   * so it is not comparable across searches and must not be thresholded on.
   */
  preRerankRelevance?: number
  aiRelevance?: number
}

export interface NormalizedPatentResult {
  providerId: PatentSearchProviderId
  sourceProvider: PatentSearchProviderId
  sourceProviders?: PatentSearchProviderId[]
  jurisdiction?: string
  publicationNumber: string
  publication_number?: string
  pn?: string
  applicationNumber?: string | null
  applicationNumberRaw?: string | null
  title: string
  abstract?: string | null
  snippet?: string | null
  applicants?: unknown
  inventors?: string[]
  classifications?: string[]
  cpcCodes?: string[]
  ipcCodes?: string[]
  filingDate?: string | Date | null
  publicationDate?: string | Date | null
  year?: string | number | null
  link?: string | null
  sourceUrl?: string | null
  sourcePdfName?: string | null
  sourcePageNumber?: number | null
  numberOfPages?: number | null
  numberOfClaims?: number | null
  extractionConfidence?: number | null
  matchedFields?: string[]
  matchedFeatures?: string[]
  matchReasons?: string[]
  retrievalMatches?: PatentRetrievalMatch[]
  retrievalScore?: number
  rawRetrievalScore?: number
  rerankDecision?: 'accept' | 'borderline' | 'reject' | string
  rerankScore?: number
  matched_features?: string[]
  missing_features?: string[]
  evidence_quality?: string
  rerankReason?: string
  scores?: PatentResultScores
  relevanceScore?: number | null
  hybridScore?: number
  vectorRank?: number
  textRank?: number
  raw?: unknown
}

export interface PatentProviderSearchRequest extends PatentSearchRequest {
  queryPlan: PatentSearchQueryPlan
}

export interface PatentSearchProvider {
  id: PatentSearchProviderId
  label: string
  jurisdictions: string[]
  enabled: boolean
  capabilities: PatentSearchCapabilities
  search(request: PatentProviderSearchRequest): Promise<NormalizedPatentResult[]>
}

export interface PatentSearchProviderStats {
  providerId: PatentSearchProviderId
  label: string
  enabled: boolean
  requested: boolean
  resultCount: number
  error?: string
}

export interface PatentSearchDiagnostics {
  displayLimit: number
  candidateLimit: number
  resultCount: number
  candidateResultCount: number
  providerCandidateCount: number
  providerContributionCounts: Partial<Record<PatentSearchProviderId, number>>
  /** Corpus providers dispatched first. */
  primaryProviderIds?: PatentSearchProviderId[]
  /** Live provider APIs dispatched only because the corpus returned nothing. */
  fallbackProviderIds?: PatentSearchProviderId[]
  usedFallbackProviders?: boolean
  /** Whether Voyage reranking reordered the candidate pool. */
  rerankApplied?: boolean
  /** Absolute rerank score floor in effect (0 = disabled). */
  minRerankScore?: number
  /** Candidates discarded for scoring below that floor. */
  droppedBelowFloor?: number
}

export interface PatentSearchResponse {
  queryPlan: PatentSearchQueryPlan
  providerStats: PatentSearchProviderStats[]
  warnings: string[]
  results: NormalizedPatentResult[]
  candidateResults?: NormalizedPatentResult[]
  diagnostics?: PatentSearchDiagnostics
}
