export type PatentSearchProviderId =
  | 'indian-corpus'
  | 'pqai-corpus'
  | 'pqai'
  | 'google-patents'
  | 'epo-ops'
  | 'uspto'
  | 'ip-australia'
  | 'wipo'
  | string

export type PatentSearchSourceMode =
  | 'INDIAN_ONLY'
  | 'AUSTRALIA_ONLY'
  | 'EPO_ONLY'
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
  epoTitleKeywords?: string[]
  epoAbstractKeywords?: string[]
  epoCombinedKeywords?: string[]
  fieldFilters: PatentSearchFilters
  explicitFilters: PatentSearchFilters
  searchVariants: string[]
  retrievalQueries?: PatentRetrievalQuery[]
  llmExpanded: boolean
  confidence: number
  warnings: string[]
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
}

export interface PatentResultScores {
  semantic?: number
  text?: number
  title?: number
  classification?: number
  field?: number
  provider?: number
  hybrid?: number
  retrieval?: number
  conceptVector?: number
  bestFeatureVector?: number
  featureCoverage?: number
  rerank?: number
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
}

export interface PatentSearchResponse {
  queryPlan: PatentSearchQueryPlan
  providerStats: PatentSearchProviderStats[]
  warnings: string[]
  results: NormalizedPatentResult[]
  candidateResults?: NormalizedPatentResult[]
  diagnostics?: PatentSearchDiagnostics
}
