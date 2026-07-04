import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  PATENT_CORPUS_EMBEDDING_MODEL,
  PATENT_CORPUS_SOURCE_EPO,
  PATENT_CORPUS_SOURCE_INDIAN,
  PATENT_CORPUS_SOURCE_PQAI,
  hasSearchEmbeddingApiKey,
  requestSearchQueryEmbeddings,
} from '@/lib/patent-corpus-service'
import type {
  NormalizedPatentResult,
  PatentProviderSearchRequest,
  PatentRetrievalMatch,
  PatentRetrievalQuery,
  PatentRetrievalQueryType,
  PatentResultScores,
  PatentSearchCapabilities,
  PatentSearchFilters,
  PatentSearchProviderId,
  PatentSearchProvider,
} from '../types'
import {
  clampLimit,
  compactPatentKey,
  asStringArray,
  normalizeClassification,
  normalizeWhitespace,
  uniqueStrings,
  yearFromDate,
} from '../utils'

const MAX_VECTOR_RETRIEVAL_QUERIES = Math.max(
  1,
  Number(process.env.PATENT_SEARCH_MAX_VECTOR_QUERIES || '4') || 4
)
const TEXT_MATCH_CANDIDATE_CAP = Math.max(
  200,
  Number(process.env.PATENT_SEARCH_TEXT_CANDIDATE_CAP || '1600') || 1600
)
const TRIGRAM_MATCH_CANDIDATE_CAP = Math.max(
  100,
  Number(process.env.PATENT_SEARCH_TRIGRAM_CANDIDATE_CAP || '900') || 900
)
const METADATA_MATCH_CANDIDATE_CAP = Math.max(
  100,
  Number(process.env.PATENT_SEARCH_METADATA_CANDIDATE_CAP || '600') || 600
)
const SEARCH_STATEMENT_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.PATENT_SEARCH_STATEMENT_TIMEOUT_MS || '8000') || 8000
)
const TRIGRAM_SIMILARITY_THRESHOLD = String(
  Math.max(0.05, Math.min(0.5, Number(process.env.PATENT_SEARCH_TRIGRAM_THRESHOLD || '0.18') || 0.18))
)
const PATENT_SEARCH_DEBUG = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.PATENT_SEARCH_DEBUG || '').trim().toLowerCase()
)
let missingOpenAiKeyWarningReported = false

type SearchLogLevel = 'info' | 'warn' | 'error'

function searchErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorCode: typeof (error as any).code === 'string' ? (error as any).code : undefined,
    }
  }
  return { errorMessage: String(error) }
}

function isStatementTimeoutError(error: unknown) {
  const details = searchErrorDetails(error)
  const meta = error && typeof error === 'object' ? (error as any).meta : undefined
  return details.errorCode === 'P2010' &&
    (meta?.code === '57014' || String(meta?.message || details.errorMessage || '').includes('statement timeout'))
}

function logEmbeddingSearch(
  level: SearchLogLevel,
  event: string,
  details: Record<string, unknown>,
  force = false
) {
  if (!PATENT_SEARCH_DEBUG && !force) return
  console[level](`[PatentEmbeddingSearch] ${JSON.stringify({ event, ...details })}`)
}

function logOptionalSearchError(
  stage: string,
  error: unknown,
  details: Record<string, unknown> = {}
) {
  const errorDetails = searchErrorDetails(error)
  if (isStatementTimeoutError(error)) {
    logEmbeddingSearch('info', `${stage}_timed_out`, {
      ...details,
      ...errorDetails,
      databaseCode: (error as any)?.meta?.code,
      databaseMessage: (error as any)?.meta?.message,
    })
    return
  }
  logEmbeddingSearch('warn', `${stage}_failed`, {
    ...details,
    ...errorDetails,
  }, true)
}

async function getVectorInventorySnapshot(corpusSource: string) {
  const sourceCondition = corpusSourceCondition(corpusSource)
  const [currentModel, anyCompleted] = await Promise.all([
    queryRawWithStatementTimeout<any>(Prisma.sql`
      SELECT e."model", e."status", e."dimensions", e."embeddedAt"
      FROM "local_patent_embeddings" e
      JOIN "local_patents" p ON p."id" = e."localPatentId"
      ${whereSql([
        sourceCondition,
        Prisma.sql`e."model" = ${PATENT_CORPUS_EMBEDDING_MODEL}`,
        Prisma.sql`e."status" = 'COMPLETED'::"PatentEmbeddingStatus"`,
        Prisma.sql`e."embedding" IS NOT NULL`,
      ])}
      LIMIT 1
    `, 3000),
    queryRawWithStatementTimeout<any>(Prisma.sql`
      SELECT e."model", e."status", e."dimensions", e."embeddedAt"
      FROM "local_patent_embeddings" e
      JOIN "local_patents" p ON p."id" = e."localPatentId"
      ${whereSql([
        sourceCondition,
        Prisma.sql`e."status" = 'COMPLETED'::"PatentEmbeddingStatus"`,
        Prisma.sql`e."embedding" IS NOT NULL`,
      ])}
      ORDER BY e."embeddedAt" DESC NULLS LAST
      LIMIT 1
    `, 3000),
  ])

  return {
    currentModelVectorAvailable: currentModel.length > 0,
    currentModelSample: currentModel[0] || null,
    anyCompletedVectorAvailable: anyCompleted.length > 0,
    latestCompletedVector: anyCompleted[0] || null,
  }
}

function corpusSourceCondition(corpusSource: string) {
  if (corpusSource === PATENT_CORPUS_SOURCE_INDIAN) {
    return Prisma.sql`p."corpusSources" @> ARRAY['indian-corpus']::TEXT[]`
  }
  if (corpusSource === PATENT_CORPUS_SOURCE_PQAI) {
    return Prisma.sql`p."corpusSources" @> ARRAY['pqai']::TEXT[]`
  }
  if (corpusSource === PATENT_CORPUS_SOURCE_EPO) {
    return Prisma.sql`p."corpusSources" @> ARRAY['epo-ops']::TEXT[]`
  }
  return Prisma.sql`p."corpusSources" @> ARRAY[${corpusSource}]::TEXT[]`
}

async function queryRawWithStatementTimeout<T = any>(query: Prisma.Sql, timeoutMs = SEARCH_STATEMENT_TIMEOUT_MS) {
  // Use a sequential transaction instead of an interactive callback transaction.
  // Prisma's interactive transaction default expires after 5 seconds, which is
  // shorter than this provider's PostgreSQL statement timeout (8 seconds).
  // Both operations below still run on the same connection/transaction, so the
  // transaction-local statement_timeout applies to the search query.
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`,
    prisma.$queryRaw<T[]>(query),
  ])
  return rows
}

function validDate(value?: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function validDateText(value?: string) {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = validDate(value)
  if (!date) return null
  return date.toISOString().slice(0, 10)
}

function commonSelectSql(extra: Prisma.Sql = Prisma.empty) {
  return Prisma.sql`
    p."id",
    p."publicationNumber",
    p."applicationNumberRaw",
    p."kind",
    p."country",
    p."filingDate",
    p."publicationDate",
    p."title",
    p."abstract",
    p."applicants",
    p."inventors",
    p."classifications",
    p."numberOfPages",
    p."numberOfClaims",
    p."sourcePdfName",
    p."sourcePageNumber",
    p."extractionConfidence",
    p."corpusSources",
    p."pqaiDetails",
    p."pqaiFetchedAt"
    ${extra}
  `
}

function addDateConditions(conditions: Prisma.Sql[], filters: PatentSearchFilters) {
  const filingFrom = validDateText(filters.filingDateFrom)
  const filingTo = validDateText(filters.filingDateTo)
  const publicationFrom = validDateText(filters.publicationDateFrom)
  const publicationTo = validDateText(filters.publicationDateTo)
  if (filingFrom) conditions.push(Prisma.sql`p."filingDate"::date >= ${filingFrom}::date`)
  if (filingTo) conditions.push(Prisma.sql`p."filingDate"::date <= ${filingTo}::date`)
  if (publicationFrom) conditions.push(Prisma.sql`p."publicationDate"::date >= ${publicationFrom}::date`)
  if (publicationTo) conditions.push(Prisma.sql`p."publicationDate"::date <= ${publicationTo}::date`)
}

function addNumericConditions(conditions: Prisma.Sql[], filters: PatentSearchFilters) {
  if (typeof filters.numberOfPagesMin === 'number') conditions.push(Prisma.sql`p."numberOfPages" >= ${filters.numberOfPagesMin}`)
  if (typeof filters.numberOfPagesMax === 'number') conditions.push(Prisma.sql`p."numberOfPages" <= ${filters.numberOfPagesMax}`)
  if (typeof filters.numberOfClaimsMin === 'number') conditions.push(Prisma.sql`p."numberOfClaims" >= ${filters.numberOfClaimsMin}`)
  if (typeof filters.numberOfClaimsMax === 'number') conditions.push(Prisma.sql`p."numberOfClaims" <= ${filters.numberOfClaimsMax}`)
}

function likePattern(value: string) {
  return `%${normalizeWhitespace(value).replace(/[\\%_]/g, '\\$&')}%`
}

function valuesFor(value: unknown) {
  return asStringArray(value).map(normalizeWhitespace).filter(Boolean)
}

function containsAnyCondition(expression: Prisma.Sql, values: unknown) {
  const terms = valuesFor(values)
  if (!terms.length) return null
  return Prisma.sql`(${Prisma.join(
    terms.map(value => Prisma.sql`${expression} ILIKE ${likePattern(value)} ESCAPE '\\'`),
    ' OR '
  )})`
}

function notContainsAnyCondition(expression: Prisma.Sql, values: unknown) {
  const terms = valuesFor(values)
  if (!terms.length) return null
  return Prisma.sql`(${Prisma.join(
    terms.map(value => Prisma.sql`NOT (${expression} ILIKE ${likePattern(value)} ESCAPE '\\')`),
    ' AND '
  )})`
}

function titleExpression() {
  return Prisma.sql`coalesce(p."title", '')`
}

function abstractExpression() {
  return Prisma.sql`coalesce(p."abstract", '') || ' ' || coalesce(p."abstractOriginal", '')`
}

function searchDocumentExpression() {
  return Prisma.sql`to_tsvector(
    'english'::regconfig,
    coalesce(p."ragText", '') || ' ' ||
    coalesce(p."title", '') || ' ' ||
    coalesce(p."abstract", '') || ' ' ||
    coalesce(p."abstractOriginal", '')
  )`
}

function titleAbstractSearchDocumentExpression() {
  return Prisma.sql`to_tsvector(
    'english'::regconfig,
    coalesce(p."title", '') || ' ' ||
    coalesce(p."abstract", '') || ' ' ||
    coalesce(p."abstractOriginal", '')
  )`
}

function metadataDocumentExpression() {
  return Prisma.sql`to_tsvector(
    'simple'::regconfig,
    "immutable_text_array_to_string"(p."classifications", ' ') || ' ' ||
    "immutable_text_array_to_string"(p."inventors", ' ') || ' ' ||
    coalesce(p."applicants"::text, '')
  )`
}

function patentTextExpression() {
  return Prisma.sql`
    coalesce(p."title", '') || ' ' ||
    coalesce(p."abstract", '') || ' ' ||
    coalesce(p."abstractOriginal", '') || ' ' ||
    coalesce(p."claimsText", '') || ' ' ||
    coalesce(p."descriptionText", '') || ' ' ||
    coalesce(p."ragText", '') || ' ' ||
    coalesce(p."rawText", '') || ' ' ||
    array_to_string(p."classifications", ' ')
  `
}

function anyTextExpression() {
  return Prisma.sql`
    ${patentTextExpression()} || ' ' ||
    array_to_string(p."inventors", ' ') || ' ' ||
    coalesce(p."applicants"::text, '')
  `
}

function buildClassificationCondition(values: string[]) {
  const normalized = uniqueStrings(values.map(normalizeClassification).filter(Boolean))
  if (!normalized.length) return null
  const parts = normalized.map(value => {
    const compact = `%${compactPatentKey(value)}%`
    return Prisma.sql`EXISTS (
      SELECT 1
      FROM unnest(p."classifications") AS cls
      WHERE upper(regexp_replace(cls, '[^A-Za-z0-9]', '', 'g')) LIKE ${compact}
    )`
  })
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`
}

function buildWhereConditions(filters: PatentSearchFilters) {
  const conditions: Prisma.Sql[] = []
  if (filters.publicationNumber) {
    const parts = valuesFor(filters.publicationNumber)
      .map(value => compactPatentKey(value))
      .filter(Boolean)
      .map(value => Prisma.sql`upper(p."publicationNumber") LIKE ${`%${value}%`}`)
    if (parts.length) conditions.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`)
  }
  if (filters.applicationNumber) {
    const parts = valuesFor(filters.applicationNumber)
      .map(value => compactPatentKey(value))
      .filter(Boolean)
      .map(value => Prisma.sql`upper(regexp_replace(coalesce(p."applicationNumberRaw", ''), '[^A-Za-z0-9]', '', 'g')) LIKE ${`%${value}%`}`)
    if (parts.length) conditions.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`)
  }
  const anyTextCondition = containsAnyCondition(anyTextExpression(), filters.anyTextContains)
  if (anyTextCondition) conditions.push(anyTextCondition)
  const titleCondition = containsAnyCondition(titleExpression(), filters.titleContains)
  if (titleCondition) conditions.push(titleCondition)
  const abstractCondition = containsAnyCondition(abstractExpression(), filters.abstractContains)
  if (abstractCondition) conditions.push(abstractCondition)
  const patentTextCondition = containsAnyCondition(patentTextExpression(), filters.patentTextContains)
  if (patentTextCondition) conditions.push(patentTextCondition)
  const excludeCondition = notContainsAnyCondition(anyTextExpression(), filters.excludeTerms)
  if (excludeCondition) conditions.push(excludeCondition)
  if (filters.sourcePdfName) {
    const sourceCondition = containsAnyCondition(Prisma.sql`coalesce(p."sourcePdfName", '')`, filters.sourcePdfName)
    if (sourceCondition) conditions.push(sourceCondition)
  }
  if (filters.applicants?.length) {
    const parts = filters.applicants.map(value => Prisma.sql`p."applicants"::text ILIKE ${`%${normalizeWhitespace(value)}%`}`)
    conditions.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`)
  }
  if (filters.inventors?.length) {
    const parts = filters.inventors.map(value => Prisma.sql`array_to_string(p."inventors", ' ') ILIKE ${`%${normalizeWhitespace(value)}%`}`)
    conditions.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`)
  }
  const classificationCondition = buildClassificationCondition([
    ...(filters.classifications || []),
    ...(filters.cpcCodes || []),
    ...(filters.ipcCodes || []),
  ])
  if (classificationCondition) conditions.push(classificationCondition)
  addDateConditions(conditions, filters)
  addNumericConditions(conditions, filters)
  return conditions
}

function whereSql(conditions: Prisma.Sql[]) {
  return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty
}

type LocalRetrievalQuery = PatentRetrievalQuery & {
  type: PatentRetrievalQueryType
  text: string
  weight: number
}

interface IndianRankAccumulator {
  rrfScore: number
  vectorRank?: number
  textRank?: number
  titleRank?: number
  fieldRank?: number
  conceptVectorScore?: number
  bestFeatureVectorScore?: number
  bestVectorScore?: number
  textScore?: number
  titleScore?: number
  fieldScore?: number
  classificationScore?: number
  matchedFeatures: Set<string>
  retrievalMatches: PatentRetrievalMatch[]
}

function clampScore(value: unknown) {
  const score = Number(value)
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(1, score))
}

function trimRetrievalText(value: unknown, maxWords = 36) {
  return normalizeWhitespace(value).split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ')
}

function retrievalQueryLimit(query: LocalRetrievalQuery, safeLimit: number) {
  if (query.type === 'concept' || query.type === 'semantic') return Math.max(60, Math.min(140, safeLimit))
  if (query.type === 'feature_pair') return 0
  return Math.max(12, Math.min(24, Math.ceil(safeLimit / 8)))
}

function buildFallbackRetrievalQueries(
  queryPlan: PatentProviderSearchRequest['queryPlan'],
  title?: string,
  maxWords = 36
): LocalRetrievalQuery[] {
  const supplied = (queryPlan.retrievalQueries || [])
    .map((query, index): LocalRetrievalQuery | null => {
      const text = trimRetrievalText(query.text, maxWords)
      if (!text) return null
      if (query.type === 'feature_pair') return null
      return {
        ...query,
        id: query.id || `retrieval-${index + 1}`,
        type: query.type || 'semantic',
        text,
        weight: typeof query.weight === 'number' ? query.weight : 1,
      }
    })
    .filter((query): query is LocalRetrievalQuery => Boolean(query))

  if (supplied.length) return supplied.slice(0, 12)

  const searchQuery = trimRetrievalText(queryPlan.searchQuery || queryPlan.normalizedQuery || title, maxWords)
  const semanticQuery = trimRetrievalText(queryPlan.semanticQuery || searchQuery, maxWords)
  const features = (queryPlan.inventionFeatures || []).map(feature => trimRetrievalText(feature, 18)).filter(Boolean).slice(0, 8)
  const queries: LocalRetrievalQuery[] = []
  const seen = new Set<string>()
  const add = (query: LocalRetrievalQuery) => {
    const text = trimRetrievalText(query.text, maxWords)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) return
    seen.add(key)
    queries.push({ ...query, text })
  }

  if (searchQuery) {
    add({ id: 'concept', type: 'concept', text: searchQuery, weight: 1.25, label: 'Core concept' })
  }
  features.forEach((feature, index) => {
    add({
      id: `feature-${index + 1}`,
      type: 'feature',
      text: feature,
      weight: 1.1,
      featureIndex: index,
      featureIndexes: [index],
      label: feature,
    })
  })
  if (!queries.length && semanticQuery) {
    add({ id: 'semantic', type: 'semantic', text: semanticQuery, weight: 1, label: 'Semantic query' })
  }
  return queries
}

function classificationMatches(result: NormalizedPatentResult, queryPlan: PatentProviderSearchRequest['queryPlan']) {
  const hints = uniqueStrings([
    ...(queryPlan.classificationHints || []),
    ...(queryPlan.cpcCodes || []),
    ...(queryPlan.ipcCodes || []),
  ]).map(compactPatentKey).filter(Boolean)
  if (!hints.length) return []
  return uniqueStrings((result.classifications || []).filter(classification => {
    const compact = compactPatentKey(classification)
    return compact && hints.some(hint => compact.includes(hint) || hint.includes(compact))
  }))
}

function withExcludedTerms(filters: PatentSearchFilters, excludedTerms: string[]) {
  const terms = uniqueStrings([...(filters.excludeTerms || []), ...excludedTerms])
  return terms.length ? { ...filters, excludeTerms: terms } : filters
}

function hasPositiveFieldFilters(filters: PatentSearchFilters) {
  return Object.entries(filters).some(([key, value]) => {
    if (key === 'excludeTerms') return false
    if (Array.isArray(value)) return value.length > 0
    return value !== undefined && value !== null && value !== ''
  })
}

function rowToResult(row: any, providerId: PatentSearchProviderId = 'indian-corpus', defaultJurisdiction = 'IN'): NormalizedPatentResult {
  const publicationNumber = String(row.publicationNumber || '')
  const publicationDate = row.publicationDate || null
  const pqaiDetails = row.pqaiDetails && typeof row.pqaiDetails === 'object' ? row.pqaiDetails : {}
  const link = pqaiDetails.link || pqaiDetails.sourceUrl || (publicationNumber ? `https://patents.google.com/patent/${publicationNumber}` : null)
  const scores: PatentResultScores = {
    semantic: typeof row.vectorScore === 'number' ? Number(row.vectorScore) : undefined,
    text: typeof row.textScore === 'number' ? Number(row.textScore) : undefined,
    title: typeof row.titleScore === 'number' ? Number(row.titleScore) : undefined,
    field: typeof row.fieldScore === 'number' ? Number(row.fieldScore) : undefined,
    classification: typeof row.classificationScore === 'number' ? Number(row.classificationScore) : undefined,
  }
  const matchedFields = uniqueStrings([
    row.vectorScore !== undefined ? 'semantic' : '',
    row.textScore !== undefined ? 'fullText' : '',
    row.titleScore !== undefined ? 'titleOrAbstract' : '',
    row.fieldScore !== undefined ? 'fieldFilter' : '',
    row.classificationScore !== undefined ? 'classification' : '',
  ])

  return {
    providerId,
    sourceProvider: providerId,
    sourceProviders: [providerId],
    jurisdiction: row.country || defaultJurisdiction,
    publicationNumber,
    publication_number: publicationNumber,
    pn: publicationNumber,
    applicationNumber: row.applicationNumberRaw || null,
    applicationNumberRaw: row.applicationNumberRaw || null,
    title: row.title || publicationNumber || 'Untitled Patent',
    abstract: row.abstract || null,
    snippet: row.abstract || null,
    applicants: row.applicants || null,
    inventors: Array.isArray(row.inventors) ? row.inventors : [],
    classifications: Array.isArray(row.classifications) ? row.classifications : [],
    filingDate: row.filingDate || null,
    publicationDate,
    year: yearFromDate(publicationDate),
    link,
    sourceUrl: pqaiDetails.sourceUrl || pqaiDetails.link || null,
    sourcePdfName: row.sourcePdfName || null,
    sourcePageNumber: row.sourcePageNumber || null,
    numberOfPages: row.numberOfPages ?? null,
    numberOfClaims: row.numberOfClaims ?? null,
    extractionConfidence: row.extractionConfidence ?? null,
    scores,
    matchedFields,
    matchReasons: matchedFields.map(field => `Matched by ${field}`),
    raw: row,
  }
}

export class IndianCorpusProvider implements PatentSearchProvider {
  id: PatentSearchProviderId
  label: string
  jurisdictions: string[]
  enabled = true
  protected corpusSource: string
  protected defaultJurisdiction: string
  protected semanticSearchEnabled: boolean
  protected metadataSearchEnabled: boolean
  protected titleAbstractOnlySearch: boolean
  capabilities: PatentSearchCapabilities = {
    semantic: true,
    fullText: true,
    classification: true,
    dateFilters: true,
    numberLookup: true,
    applicantFilter: true,
    inventorFilter: true,
  }

  constructor(options: {
    id?: PatentSearchProviderId
    label?: string
    jurisdictions?: string[]
    corpusSource?: string
    defaultJurisdiction?: string
    semanticSearchEnabled?: boolean
    metadataSearchEnabled?: boolean
    titleAbstractOnlySearch?: boolean
  } = {}) {
    this.id = options.id || 'indian-corpus'
    this.label = options.label || 'Indian Patent Corpus'
    this.jurisdictions = options.jurisdictions || ['IN']
    this.corpusSource = options.corpusSource || PATENT_CORPUS_SOURCE_INDIAN
    this.defaultJurisdiction = options.defaultJurisdiction || 'IN'
    this.semanticSearchEnabled = options.semanticSearchEnabled !== false
    this.metadataSearchEnabled = options.metadataSearchEnabled !== false
    this.titleAbstractOnlySearch = options.titleAbstractOnlySearch === true
    this.capabilities = {
      ...this.capabilities,
      semantic: this.semanticSearchEnabled,
    }
  }

  async search(request: PatentProviderSearchRequest): Promise<NormalizedPatentResult[]> {
    const searchStartedAt = Date.now()
    const traceId = request.requestHeaders?.['x-request-id'] ||
      `patent-search-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const safeLimit = clampLimit(request.limit, 20, 300)
    const candidateLimit = Math.max(safeLimit * 4, 40)
    const queryPlan = request.queryPlan
    const filters = withExcludedTerms(queryPlan.fieldFilters || {}, queryPlan.excludedTerms || [])
    const filterConditions = [
      corpusSourceCondition(this.corpusSource),
      ...buildWhereConditions(filters),
    ]
    const manualMode = request.searchMode === 'manual'
    const rows = new Map<string, NormalizedPatentResult>()
    const ranks = new Map<string, IndianRankAccumulator>()
    let vectorRowsTotal = 0
    let vectorQueriesCompleted = 0

    const merge = (
      row: any,
      kind: 'vectorRank' | 'textRank' | 'fieldRank' | 'titleRank',
      rank: number,
      weight: number,
      retrievalQuery?: LocalRetrievalQuery
    ) => {
      const result = rowToResult(row, this.id, this.defaultJurisdiction)
      const key = result.publicationNumber
      const existing = rows.get(key)
      const extraMatchedFields = retrievalQuery
        ? [retrievalQuery.type === 'concept' || retrievalQuery.type === 'semantic' ? 'semantic' : '']
        : []
      const extraMatchReasons = retrievalQuery
        ? (retrievalQuery.type === 'concept' || retrievalQuery.type === 'semantic'
          ? [`Abstract embedding matched ${retrievalQuery.type.replace('_', ' ')} query: ${retrievalQuery.label || retrievalQuery.text}`]
          : [])
        : []
      rows.set(key, {
        ...(existing || {}),
        ...result,
        scores: {
          ...(existing?.scores || {}),
          ...(result.scores || {}),
        },
        matchedFields: uniqueStrings([
          ...(existing?.matchedFields || []),
          ...(result.matchedFields || []),
          ...extraMatchedFields,
        ]),
        matchedFeatures: uniqueStrings([
          ...(existing?.matchedFeatures || []),
        ]),
        matchReasons: uniqueStrings([
          ...(existing?.matchReasons || []),
          ...(result.matchReasons || []),
          ...extraMatchReasons,
        ]),
      })
      const current = ranks.get(key) || {
        rrfScore: 0,
        matchedFeatures: new Set<string>(),
        retrievalMatches: [],
      }
      current.rrfScore += weight / (60 + rank)
      if (kind === 'vectorRank') current.vectorRank = typeof current.vectorRank === 'number' ? Math.min(current.vectorRank, rank) : rank
      if (kind === 'textRank') current.textRank = typeof current.textRank === 'number' ? Math.min(current.textRank, rank) : rank
      if (kind === 'titleRank') current.titleRank = typeof current.titleRank === 'number' ? Math.min(current.titleRank, rank) : rank
      if (kind === 'fieldRank') current.fieldRank = typeof current.fieldRank === 'number' ? Math.min(current.fieldRank, rank) : rank
      if (kind === 'textRank') current.textScore = Math.max(current.textScore || 0, clampScore(row.textScore))
      if (kind === 'titleRank') current.titleScore = Math.max(current.titleScore || 0, clampScore(row.titleScore))
      if (kind === 'fieldRank') current.fieldScore = Math.max(current.fieldScore || 0, clampScore(row.fieldScore))
      if (kind === 'vectorRank') {
        const vectorScore = clampScore(row.vectorScore)
        current.bestVectorScore = Math.max(current.bestVectorScore || 0, vectorScore)
        if (retrievalQuery?.type === 'concept' || retrievalQuery?.type === 'semantic') {
          current.conceptVectorScore = Math.max(current.conceptVectorScore || 0, vectorScore)
        }
        if (retrievalQuery?.type === 'feature' || retrievalQuery?.type === 'feature_pair') {
          current.bestFeatureVectorScore = Math.max(current.bestFeatureVectorScore || 0, vectorScore)
        }
        if (retrievalQuery && !current.retrievalMatches.some(match => match.queryId === retrievalQuery.id)) {
          current.retrievalMatches.push({
            queryId: retrievalQuery.id,
            queryType: retrievalQuery.type,
            queryText: retrievalQuery.text,
            rank,
            score: vectorScore,
          })
        }
      }
      ranks.set(key, current)
    }

    const textQuery = normalizeWhitespace(queryPlan.searchQuery || queryPlan.normalizedQuery)
    if (textQuery && !manualMode) {
      try {
        const searchDocument = this.titleAbstractOnlySearch
          ? titleAbstractSearchDocumentExpression()
          : searchDocumentExpression()
        const textCandidatePoolLimit = Math.min(Math.max(candidateLimit * 8, 300), TEXT_MATCH_CANDIDATE_CAP)
        const conditions = [
          Prisma.sql`numnode(q.query) > 0`,
          Prisma.sql`${searchDocument} @@ q.query`,
          ...filterConditions,
        ]
        const textRows = await queryRawWithStatementTimeout<any>(Prisma.sql`
          WITH q AS (
            SELECT websearch_to_tsquery('english'::regconfig, ${textQuery}) AS query
          ),
          hits AS MATERIALIZED (
            SELECT p."id"
            FROM "local_patents" p, q
            ${whereSql(conditions)}
            LIMIT ${textCandidatePoolLimit}
          )
          SELECT ${commonSelectSql(Prisma.sql`,
            ts_rank_cd(${searchDocument}, q.query) AS "textScore"`)}
          FROM hits
          JOIN "local_patents" p ON p."id" = hits."id"
          CROSS JOIN q
          ORDER BY "textScore" DESC
          LIMIT ${candidateLimit}
        `)
        textRows.forEach((row, index) => merge(row, 'textRank', index + 1, 1))
      } catch (error) {
        logOptionalSearchError('full_text_search', error, { traceId, providerId: this.id })
      }

      if (this.metadataSearchEnabled) {
        try {
          const metadataDocument = metadataDocumentExpression()
          const metadataCandidatePoolLimit = Math.min(Math.max(candidateLimit * 3, 120), METADATA_MATCH_CANDIDATE_CAP)
          const metadataConditions = [
            Prisma.sql`numnode(mq.query) > 0`,
            Prisma.sql`${metadataDocument} @@ mq.query`,
            ...filterConditions,
          ]
          const metadataRows = await queryRawWithStatementTimeout<any>(Prisma.sql`
            WITH mq AS (
              SELECT websearch_to_tsquery('simple'::regconfig, ${textQuery}) AS query
            ),
            hits AS MATERIALIZED (
              SELECT p."id"
              FROM "local_patents" p, mq
              ${whereSql(metadataConditions)}
              LIMIT ${metadataCandidatePoolLimit}
            )
            SELECT ${commonSelectSql(Prisma.sql`,
              ts_rank_cd(${metadataDocumentExpression()}, mq.query) AS "textScore"`)}
            FROM hits
            JOIN "local_patents" p ON p."id" = hits."id"
            CROSS JOIN mq
            ORDER BY "textScore" DESC
            LIMIT ${Math.min(candidateLimit, metadataCandidatePoolLimit)}
          `)
          metadataRows.forEach((row, index) => merge(row, 'textRank', index + 1, 0.45))
        } catch (error) {
          logOptionalSearchError('metadata_text_search', error, { traceId, providerId: this.id })
        }
      }
    }

    const retrievalQueries = buildFallbackRetrievalQueries(
      queryPlan,
      request.title,
      Math.max(36, Math.min(256, request.maxSemanticQueryWords || 36))
    )
    const vectorRetrievalQueries = retrievalQueries.slice(0, MAX_VECTOR_RETRIEVAL_QUERIES)
    logEmbeddingSearch('info', 'search_start', {
      traceId,
      providerId: this.id,
      corpusSource: this.corpusSource,
      searchMode: request.searchMode || 'intelligent',
      embeddingModel: PATENT_CORPUS_EMBEDDING_MODEL,
      hasOpenAIKey: hasSearchEmbeddingApiKey(),
      hasDedicatedSearchOpenAIKey: Boolean(process.env.OPENAI_SEARCH_API_KEY),
      textQueryLength: textQuery.length,
      retrievalQueryCount: retrievalQueries.length,
      vectorRetrievalQueryCount: vectorRetrievalQueries.length,
      safeLimit,
      candidateLimit,
    })

    if (this.semanticSearchEnabled && vectorRetrievalQueries.length > 0 && hasSearchEmbeddingApiKey() && !manualMode) {
      let vectorStage = 'openai_embedding_request'
      try {
        const embeddingStartedAt = Date.now()
        const vectors = await requestSearchQueryEmbeddings(
          vectorRetrievalQueries.map(query => query.text),
          { traceId }
        )
        logEmbeddingSearch('info', 'query_embeddings_created', {
          traceId,
          vectorCount: vectors.length,
          vectorDimensions: vectors[0]?.length || 0,
          durationMs: Date.now() - embeddingStartedAt,
        })
        vectorStage = 'postgres_vector_query'
        for (let queryIndex = 0; queryIndex < vectorRetrievalQueries.length; queryIndex += 1) {
          const retrievalQuery = vectorRetrievalQueries[queryIndex]
          const vector = vectors[queryIndex]
          if (!vector) {
            logEmbeddingSearch('warn', 'query_vector_missing', { traceId, queryIndex, queryType: retrievalQuery.type })
            continue
          }
          const limit = retrievalQueryLimit(retrievalQuery, safeLimit)
          if (limit <= 0) continue
          const vectorLiteral = `[${vector.map(value => Number(value).toFixed(8)).join(',')}]`
          const queryStartedAt = Date.now()
          const vectorRows = await queryRawWithStatementTimeout<any>(Prisma.sql`
            SELECT ${commonSelectSql(Prisma.sql`,
              1 - (e."embedding" <=> ${vectorLiteral}::vector) AS "vectorScore"`)}
            FROM "local_patents" p
            JOIN "local_patent_embeddings" e ON e."localPatentId" = p."id"
            ${whereSql([
              Prisma.sql`e."status" = 'COMPLETED'::"PatentEmbeddingStatus"`,
              Prisma.sql`e."model" = ${PATENT_CORPUS_EMBEDDING_MODEL}`,
              Prisma.sql`e."embedding" IS NOT NULL`,
              ...filterConditions,
            ])}
            ORDER BY e."embedding" <=> ${vectorLiteral}::vector
            LIMIT ${limit}
          `)
          vectorQueriesCompleted += 1
          vectorRowsTotal += vectorRows.length
          logEmbeddingSearch('info', 'vector_query_completed', {
            traceId,
            queryIndex,
            queryType: retrievalQuery.type,
            requestedLimit: limit,
            resultCount: vectorRows.length,
            durationMs: Date.now() - queryStartedAt,
          })
          vectorRows.forEach((row, index) => merge(row, 'vectorRank', index + 1, retrievalQuery.weight, retrievalQuery))
        }

        if (vectorRowsTotal === 0) {
          let inventory: Record<string, unknown> = {}
          try {
            inventory = await getVectorInventorySnapshot(this.corpusSource)
          } catch (inventoryError) {
            inventory = { inventoryError: searchErrorDetails(inventoryError) }
          }
          logEmbeddingSearch('warn', 'vector_search_returned_no_rows', {
            traceId,
            embeddingModel: PATENT_CORPUS_EMBEDDING_MODEL,
            vectorQueriesCompleted,
            ...inventory,
          })
        }
      } catch (error) {
        logEmbeddingSearch('error', 'vector_search_failed', {
          traceId,
          stage: vectorStage,
          embeddingModel: PATENT_CORPUS_EMBEDDING_MODEL,
          ...searchErrorDetails(error),
        }, true)
        if (request.strictSemantic) throw error
      }
    } else {
      const skipReason = !this.semanticSearchEnabled
        ? 'semantic_disabled'
        : manualMode
        ? 'manual_mode'
        : !hasSearchEmbeddingApiKey()
          ? 'missing_openai_api_key'
          : 'no_retrieval_queries'
      const forceWarning = skipReason === 'missing_openai_api_key' && !missingOpenAiKeyWarningReported
      if (forceWarning) missingOpenAiKeyWarningReported = true
      logEmbeddingSearch(forceWarning ? 'warn' : 'info', 'vector_search_skipped', {
        traceId,
        reason: skipReason,
        searchMode: request.searchMode || 'intelligent',
        retrievalQueryCount: vectorRetrievalQueries.length,
        hasOpenAIKey: hasSearchEmbeddingApiKey(),
      }, forceWarning)
      if (request.strictSemantic) {
        throw new Error(`Semantic patent search is unavailable: ${skipReason}.`)
      }
    }

    const hasEnoughCandidatesForRequestedLimit = rows.size >= safeLimit
    if (textQuery.length >= 3 && !manualMode && !request.skipTrigramSearch && !hasEnoughCandidatesForRequestedLimit) {
      try {
        const trigramCandidatePoolLimit = Math.min(Math.max(candidateLimit * 6, 180), TRIGRAM_MATCH_CANDIDATE_CAP)
        const titleRows = await queryRawWithStatementTimeout<any>(Prisma.sql`
          WITH settings AS (
            SELECT set_config('pg_trgm.similarity_threshold', ${TRIGRAM_SIMILARITY_THRESHOLD}, true)
          ),
          hits AS MATERIALIZED (
            SELECT p."id"
            FROM "local_patents" p, settings
            ${whereSql([
              Prisma.sql`(
                p."title" % ${textQuery}
                OR (p."abstract" IS NOT NULL AND p."abstract" % ${textQuery})
              )`,
              ...filterConditions,
            ])}
            LIMIT ${trigramCandidatePoolLimit}
          )
          SELECT ${commonSelectSql(Prisma.sql`,
            GREATEST(
              similarity(coalesce(p."title", ''), ${textQuery}),
              similarity(coalesce(p."abstract", ''), ${textQuery}) * 0.75
            ) AS "titleScore"`)}
          FROM hits
          JOIN "local_patents" p ON p."id" = hits."id"
          ORDER BY "titleScore" DESC
          LIMIT ${candidateLimit}
        `)
        titleRows.forEach((row, index) => merge(row, 'titleRank', index + 1, 0.85))
      } catch (error) {
        logOptionalSearchError('trigram_search', error, { traceId, providerId: this.id })
      }
    } else if (hasEnoughCandidatesForRequestedLimit && !request.skipTrigramSearch) {
      logEmbeddingSearch('info', 'trigram_search_skipped', {
        traceId,
        reason: 'candidate_pool_already_satisfied',
        searchMode: request.searchMode || 'intelligent',
        currentCandidateCount: rows.size,
        safeLimit,
      })
    } else if (request.skipTrigramSearch) {
      logEmbeddingSearch('info', 'trigram_search_skipped', {
        traceId,
        reason: 'request_skip_trigram_search',
        searchMode: request.searchMode || 'intelligent',
      })
    }

    if (hasPositiveFieldFilters(filters)) {
      try {
        const fieldRows = await queryRawWithStatementTimeout<any>(Prisma.sql`
          SELECT ${commonSelectSql(Prisma.sql`, 1.0 AS "fieldScore"`)}
          FROM "local_patents" p
          ${whereSql(filterConditions)}
          ORDER BY p."publicationDate" DESC NULLS LAST, p."id" DESC
          LIMIT ${candidateLimit}
        `)
        fieldRows.forEach((row, index) => merge(row, 'fieldRank', index + 1, 1.1))
      } catch (error) {
        logOptionalSearchError('field_search', error, { traceId, providerId: this.id })
      }
    }

    const sorted = Array.from(rows.values())
      .map(result => {
        const rank = ranks.get(result.publicationNumber) || {
          rrfScore: 0,
          matchedFeatures: new Set<string>(),
          retrievalMatches: [],
        }
        const classMatches = classificationMatches(result, queryPlan)
        const matchedFeatures = uniqueStrings([
          ...(result.matchedFeatures || []),
          ...Array.from(rank.matchedFeatures),
        ])
        const featureCoverage = 0
        const conceptSignal = rank.conceptVectorScore || 0
        const featureSignal = rank.bestFeatureVectorScore || 0
        const classificationSignal = classMatches.length ? 1 : 0
        const retrievalScore =
          (0.45 * conceptSignal) +
          (0.18 * (rank.textScore || 0)) +
          (0.12 * (rank.titleScore || 0)) +
          (0.05 * classificationSignal) +
          Math.min(0.08, rank.rrfScore)
        const retrievalMatches = rank.retrievalMatches
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 8)
        return {
          ...result,
          hybridScore: Number(retrievalScore.toFixed(6)),
          retrievalScore: Number(retrievalScore.toFixed(6)),
          rawRetrievalScore: Number(retrievalScore.toFixed(6)),
          vectorRank: rank.vectorRank,
          textRank: rank.textRank,
          matchedFields: uniqueStrings([
            ...(result.matchedFields || []),
            classMatches.length ? 'classification' : '',
          ]),
          matchedFeatures,
          retrievalMatches,
          matchReasons: uniqueStrings([
            ...(result.matchReasons || []),
            classMatches.length ? `Classification matched ${classMatches.join(', ')}` : '',
          ]),
          scores: {
            ...(result.scores || {}),
            semantic: rank.bestVectorScore || result.scores?.semantic,
            conceptVector: conceptSignal || undefined,
            bestFeatureVector: featureSignal || undefined,
            featureCoverage,
            text: rank.textScore || result.scores?.text,
            title: rank.titleScore || result.scores?.title,
            field: rank.fieldScore || result.scores?.field,
            classification: classificationSignal || result.scores?.classification,
            retrieval: retrievalScore,
            hybrid: retrievalScore,
          },
        }
      })
      .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0))

    const maxScore = sorted[0]?.hybridScore || 1
    const finalResults = sorted.slice(0, safeLimit).map(result => {
      const normalizedScore = Math.max(0.01, Math.min(0.99, (result.hybridScore || 0) / maxScore))
      return {
        ...result,
        relevanceScore: Number(normalizedScore.toFixed(3)),
        scores: {
          ...(result.scores || {}),
          hybrid: normalizedScore,
        },
      }
    })
    logEmbeddingSearch('info', 'search_completed', {
      traceId,
      providerId: this.id,
      resultCount: finalResults.length,
      resultsWithVectorRank: finalResults.filter(result => typeof result.vectorRank === 'number').length,
      resultsWithTextRank: finalResults.filter(result => typeof result.textRank === 'number').length,
      vectorQueriesCompleted,
      vectorRowsTotal,
      durationMs: Date.now() - searchStartedAt,
    })
    return finalResults
  }
}
