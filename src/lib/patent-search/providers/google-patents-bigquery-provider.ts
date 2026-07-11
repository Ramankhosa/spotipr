import { BigQuery } from '@google-cloud/bigquery'
import type {
  NormalizedPatentResult,
  PatentProviderSearchRequest,
  PatentSearchCapabilities,
  PatentSearchProvider,
} from '../types'
import {
  asStringArray,
  clampLimit,
  compactPatentKey,
  normalizeClassification,
  normalizeWhitespace,
  uniqueStrings,
  yearFromDate,
} from '../utils'

const GOOGLE_PATENTS_BIGQUERY_PROVIDER_ID = 'google-patents-bigquery'
const BIGQUERY_LOCATION = 'US'
const DEFAULT_MAX_BYTES_BILLED = 400_000_000_000
const EMPTY_ARRAY_SENTINEL = '__empty__'

type BigQueryClientLike = {
  createQueryJob(options: Record<string, unknown>): Promise<[{
    metadata?: {
      statistics?: {
        totalBytesProcessed?: string | number
        query?: {
          totalBytesProcessed?: string | number
        }
      }
    }
  }]>
  query(options: Record<string, unknown>): Promise<[any[]]>
}

type QueryBuild = {
  query: string
  params: Record<string, unknown>
}

type QueryInputs = {
  terms: string[]
  excludedTerms: string[]
  classifications: string[]
  publicationNumbers: string[]
  applicationNumbers: string[]
}

let testClientFactory: (() => BigQueryClientLike) | null = null

export function setGooglePatentsBigQueryClientFactoryForTests(factory: (() => BigQueryClientLike) | null) {
  testClientFactory = factory
}

function googleCloudProjectId() {
  return normalizeWhitespace(
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCP_PROJECT_ID ||
    process.env.BIGQUERY_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.BIGQUERY_BILLING_PROJECT ||
    ''
  )
}

function parseBytes(value: unknown, fallback = DEFAULT_MAX_BYTES_BILLED) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.floor(parsed)
}

function maxBytesBilled() {
  return parseBytes(
    process.env.GOOGLE_PATENTS_BQ_MAX_BYTES_BILLED ||
    process.env.GOOGLE_PATENTS_BIGQUERY_MAX_BYTES_BILLED ||
    process.env.GOOGLE_BIGQUERY_MAX_BYTES_BILLED ||
    process.env.BIGQUERY_MAX_BYTES_BILLED
  )
}

function dryRunEnabled() {
  return !/^(false|0|no)$/i.test(normalizeWhitespace(process.env.GOOGLE_PATENTS_BQ_DRY_RUN || 'true'))
}

export function hasGooglePatentsBigQueryCredentials() {
  return Boolean(googleCloudProjectId()) && maxBytesBilled() > 0
}

function createBigQueryClient(): BigQueryClientLike {
  if (testClientFactory) return testClientFactory()
  const projectId = googleCloudProjectId()
  if (!projectId) throw new Error('Google Patents BigQuery project ID is not configured.')
  return new BigQuery({ projectId, location: BIGQUERY_LOCATION }) as unknown as BigQueryClientLike
}

function safeArrayParam(values: string[]) {
  return values.length ? values : [EMPTY_ARRAY_SENTINEL]
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let next = value
  let unitIndex = 0
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024
    unitIndex += 1
  }
  return `${next.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function normalizeSearchTerm(value: unknown, maxWords = 8) {
  const text = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s/.-]/g, ' ')
    .replace(/[-/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text || text === EMPTY_ARRAY_SENTINEL) return ''
  const words = text.split(/\s+/).filter(Boolean)
  return words.slice(0, maxWords).join(' ').slice(0, 120).trim()
}

function searchTerms(value: unknown, maxItems = 12) {
  return asStringArray(value)
    .map(item => normalizeSearchTerm(item))
    .filter(item => item.length >= 3)
    .slice(0, maxItems)
}

function compactClassification(value: unknown) {
  return normalizeClassification(value).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function classificationTerms(value: unknown, maxItems = 16) {
  return asStringArray(value)
    .map(compactClassification)
    .filter(item => item.length >= 3)
    .slice(0, maxItems)
}

function compactPatentNumber(value: unknown) {
  const compact = compactPatentKey(value)
  return /^[A-Z]{2}[A-Z0-9]{4,}/.test(compact) ? compact : ''
}

function patentNumberTerms(value: unknown, maxItems = 12) {
  return asStringArray(value)
    .flatMap(item => item.split(/\s+/))
    .map(compactPatentNumber)
    .filter(Boolean)
    .slice(0, maxItems)
}

function rawFeatureDetailTerms(queryPlan: PatentProviderSearchRequest['queryPlan']) {
  const details = (queryPlan as any)?.featureDetails
  if (!Array.isArray(details)) return []
  return details.flatMap(detail => {
    if (!detail || typeof detail !== 'object') return []
    return [
      (detail as any).embeddingSearchText,
      (detail as any).searchText,
      (detail as any).feature,
    ]
  })
}

function rawConceptTerms(queryPlan: PatentProviderSearchRequest['queryPlan']) {
  return (queryPlan.patentSearchConceptGroups || [])
    .filter(group => !group.excluded)
    .flatMap(group => group.terms || [])
}

function rawExcludedTerms(request: PatentProviderSearchRequest) {
  return [
    ...asStringArray(request.queryPlan.excludedTerms),
    ...asStringArray((request.queryPlan as any)?.searchExclusions),
    ...asStringArray(request.queryPlan.fieldFilters?.excludeTerms),
    ...asStringArray(request.filters?.excludeTerms),
    ...(request.queryPlan.patentSearchConceptGroups || [])
      .filter(group => group.excluded)
      .flatMap(group => group.terms || []),
  ]
}

function buildQueryInputs(request: PatentProviderSearchRequest): QueryInputs {
  const filters = request.queryPlan.fieldFilters || {}
  const explicitFilters = request.queryPlan.explicitFilters || {}
  const terms = uniqueStrings([
    ...searchTerms(request.queryPlan.googlePatentKeywords, 12),
    ...searchTerms(request.queryPlan.searchQuery, 8),
    ...searchTerms(request.queryPlan.inventionFeatures, 10),
    ...searchTerms(rawFeatureDetailTerms(request.queryPlan), 10),
    ...searchTerms(request.queryPlan.technicalKeywords, 12),
    ...searchTerms(request.queryPlan.mustHaveTerms, 10),
    ...searchTerms(request.queryPlan.retrievalQueries?.map(query => query.text), 10),
    ...searchTerms(rawConceptTerms(request.queryPlan), 12),
    ...searchTerms(filters.anyTextContains, 8),
    ...searchTerms(filters.titleContains, 8),
    ...searchTerms(filters.abstractContains, 8),
    ...searchTerms(filters.patentTextContains, 8),
  ]).slice(0, 24)

  const excludedTerms = uniqueStrings(searchTerms(rawExcludedTerms(request), 10)).slice(0, 12)
  const classifications = uniqueStrings([
    ...classificationTerms(request.queryPlan.cpcCodes),
    ...classificationTerms(request.queryPlan.ipcCodes),
    ...classificationTerms(request.queryPlan.classificationHints),
    ...classificationTerms(filters.classifications),
    ...classificationTerms(filters.cpcCodes),
    ...classificationTerms(filters.ipcCodes),
    ...classificationTerms(explicitFilters.classifications),
    ...classificationTerms(explicitFilters.cpcCodes),
    ...classificationTerms(explicitFilters.ipcCodes),
  ]).slice(0, 20)
  const publicationNumbers = uniqueStrings([
    ...patentNumberTerms(filters.publicationNumber),
    ...patentNumberTerms(explicitFilters.publicationNumber),
    ...patentNumberTerms(request.query),
  ]).slice(0, 12)
  const applicationNumbers = uniqueStrings([
    ...patentNumberTerms(filters.applicationNumber),
    ...patentNumberTerms(explicitFilters.applicationNumber),
  ]).slice(0, 12)

  return {
    terms,
    excludedTerms,
    classifications,
    publicationNumbers,
    applicationNumbers,
  }
}

function buildSearchQuery(request: PatentProviderSearchRequest, limit: number, publicationNumbersFromApplications: string[] = []): QueryBuild {
  const inputs = buildQueryInputs(request)
  const publicationNumbers = uniqueStrings([
    ...inputs.publicationNumbers,
    ...publicationNumbersFromApplications,
  ]).slice(0, 24)

  const params = {
    terms: safeArrayParam(inputs.terms),
    excludedTerms: safeArrayParam(inputs.excludedTerms),
    classifications: safeArrayParam(inputs.classifications),
    publicationNumbers: safeArrayParam(publicationNumbers),
    hasTerms: inputs.terms.length > 0,
    hasExcludedTerms: inputs.excludedTerms.length > 0,
    hasClassifications: inputs.classifications.length > 0,
    hasPublicationNumbers: publicationNumbers.length > 0,
    limit,
  }

  const query = `
WITH
  terms AS (
    SELECT term
    FROM UNNEST(@terms) AS term
    WHERE @hasTerms AND term != '${EMPTY_ARRAY_SENTINEL}'
  ),
  excluded_terms AS (
    SELECT term
    FROM UNNEST(@excludedTerms) AS term
    WHERE @hasExcludedTerms AND term != '${EMPTY_ARRAY_SENTINEL}'
  ),
  classification_hints AS (
    SELECT term
    FROM UNNEST(@classifications) AS term
    WHERE @hasClassifications AND term != '${EMPTY_ARRAY_SENTINEL}'
  ),
  base AS (
    SELECT
      publication_number,
      title,
      abstract,
      url,
      country,
      ARRAY(
        SELECT DISTINCT c.code
        FROM UNNEST(cpc) AS c
        WHERE c.code IS NOT NULL
        LIMIT 30
      ) AS cpc_codes,
      ARRAY(
        SELECT DISTINCT LOWER(REGEXP_REPLACE(code, r'[^A-Za-z0-9]', ''))
        FROM UNNEST(cpc_low) AS code
        WHERE code IS NOT NULL
        LIMIT 60
      ) AS cpc_low_codes,
      LOWER(CONCAT(
        COALESCE(title, ''),
        ' ',
        COALESCE(abstract, ''),
        ' ',
        COALESCE(ARRAY_TO_STRING(top_terms, ' '), '')
      )) AS text_blob,
      LOWER(COALESCE(ARRAY_TO_STRING(top_terms, ' '), '')) AS top_terms_blob,
      REGEXP_REPLACE(UPPER(publication_number), r'[^A-Z0-9]', '') AS compact_publication_number
    FROM \`patents-public-data.google_patents_research.publications\`
    WHERE publication_number IS NOT NULL
  ),
  scored AS (
    SELECT
      *,
      IF(@hasTerms, (
        SELECT COALESCE(SUM(
          IF(LOWER(COALESCE(title, '')) LIKE CONCAT('%', term, '%'), 10, 0) +
          IF(LOWER(COALESCE(abstract, '')) LIKE CONCAT('%', term, '%'), 6, 0) +
          IF(top_terms_blob LIKE CONCAT('%', term, '%'), 8, 0)
        ), 0)
        FROM terms
      ), 0) +
      IF(@hasClassifications, (
        SELECT 6 * COUNT(1)
        FROM UNNEST(cpc_low_codes) AS code
        JOIN classification_hints AS hint
          ON STARTS_WITH(code, hint.term) OR STARTS_WITH(hint.term, code)
      ), 0) +
      IF(@hasPublicationNumbers AND EXISTS (
        SELECT 1
        FROM UNNEST(@publicationNumbers) AS publication_number_hint
        WHERE compact_publication_number = publication_number_hint
           OR compact_publication_number LIKE CONCAT('%', publication_number_hint, '%')
      ), 25, 0) AS score
    FROM base
    WHERE (
      (@hasTerms AND EXISTS (
        SELECT 1
        FROM terms
        WHERE text_blob LIKE CONCAT('%', term, '%')
      ))
      OR (@hasClassifications AND EXISTS (
        SELECT 1
        FROM UNNEST(cpc_low_codes) AS code
        JOIN classification_hints AS hint
          ON STARTS_WITH(code, hint.term) OR STARTS_WITH(hint.term, code)
      ))
      OR (@hasPublicationNumbers AND EXISTS (
        SELECT 1
        FROM UNNEST(@publicationNumbers) AS publication_number_hint
        WHERE compact_publication_number = publication_number_hint
           OR compact_publication_number LIKE CONCAT('%', publication_number_hint, '%')
      ))
    )
    AND (
      NOT @hasExcludedTerms
      OR NOT EXISTS (
        SELECT 1
        FROM excluded_terms
        WHERE text_blob LIKE CONCAT('%', term, '%')
      )
    )
  )
SELECT
  publication_number,
  title,
  abstract,
  url,
  country,
  cpc_codes,
  score
FROM scored
WHERE score > 0
QUALIFY ROW_NUMBER() OVER (PARTITION BY publication_number ORDER BY score DESC) = 1
ORDER BY score DESC
LIMIT @limit`

  return { query, params }
}

function buildApplicationLookupQuery(applicationNumbers: string[], limit: number): QueryBuild {
  return {
    query: `
SELECT DISTINCT
  publication_number
FROM \`patents-public-data.patents.publications\`
WHERE REGEXP_REPLACE(UPPER(application_number), r'[^A-Z0-9]', '') IN UNNEST(@applicationNumbers)
LIMIT @limit`,
    params: {
      applicationNumbers: safeArrayParam(applicationNumbers),
      limit,
    },
  }
}

function buildBibliographicQuery(publicationNumbers: string[]): QueryBuild {
  return {
    query: `
SELECT
  publication_number,
  application_number,
  country_code,
  kind_code,
  publication_date,
  filing_date,
  assignee AS assignees,
  inventor AS inventors,
  ARRAY(
    SELECT DISTINCT code
    FROM UNNEST(ipc) AS item
    WHERE item.code IS NOT NULL
    LIMIT 30
  ) AS ipc_codes,
  ARRAY(
    SELECT DISTINCT code
    FROM UNNEST(cpc) AS item
    WHERE item.code IS NOT NULL
    LIMIT 30
  ) AS cpc_codes
FROM \`patents-public-data.patents.publications\`
WHERE publication_number IN UNNEST(@publicationNumbers)`,
    params: {
      publicationNumbers: safeArrayParam(publicationNumbers),
    },
  }
}

export function buildGooglePatentsBigQueryForTests(request: PatentProviderSearchRequest, limit = 50) {
  return buildSearchQuery(request, clampLimit(limit, 50, 100))
}

async function runQuery(
  client: BigQueryClientLike,
  queryBuild: QueryBuild,
  costCap: number,
  label: string
) {
  const options = {
    query: queryBuild.query,
    params: queryBuild.params,
    location: BIGQUERY_LOCATION,
    maximumBytesBilled: String(costCap),
    useLegacySql: false,
  }

  if (dryRunEnabled()) {
    const [job] = await client.createQueryJob({
      ...options,
      dryRun: true,
    })
    const estimated = Number(
      job?.metadata?.statistics?.totalBytesProcessed ??
      job?.metadata?.statistics?.query?.totalBytesProcessed ??
      0
    )
    if (costCap > 0 && estimated > costCap) {
      throw new Error(`${label} dry run estimated ${formatBytes(estimated)}, exceeding the configured BigQuery cap of ${formatBytes(costCap)}.`)
    }
  }

  const [rows] = await client.query(options)
  return Array.isArray(rows) ? rows : []
}

function rowArray(value: unknown) {
  if (Array.isArray(value)) return uniqueStrings(value.map(item => {
    if (item && typeof item === 'object' && 'value' in item) return String((item as any).value || '').trim()
    if (item && typeof item === 'object' && 'code' in item) return String((item as any).code || '').trim()
    return String(item || '').trim()
  }))
  if (typeof value === 'string' && value.trim()) return uniqueStrings(value.split(/[,;\n]/))
  return []
}

function dateFromBigQuery(value: unknown) {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const apiValue = (value as any)?.value
  if (apiValue) return dateFromBigQuery(apiValue)
  const text = String(value).trim()
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  return null
}

function scoreResult(rawScore: unknown, maxScore: number) {
  const score = Number(rawScore)
  if (!Number.isFinite(score) || score <= 0) return 0.01
  return Number(Math.max(0.01, Math.min(0.99, score / Math.max(maxScore, 1))).toFixed(3))
}

function bibliographicMap(rows: any[]) {
  const map = new Map<string, any>()
  for (const row of rows) {
    const key = normalizeWhitespace(row?.publication_number)
    if (key) map.set(key, row)
  }
  return map
}

function normalizeResult(row: any, index: number, maxScore: number, biblio: Map<string, any>): NormalizedPatentResult | null {
  const bigQueryPublicationNumber = normalizeWhitespace(row?.publication_number)
  const publicationNumber = compactPatentKey(bigQueryPublicationNumber)
  if (!publicationNumber) return null
  const metadata = biblio.get(bigQueryPublicationNumber) || {}
  const title = normalizeWhitespace(row?.title) || 'Untitled Patent'
  const abstract = normalizeWhitespace(row?.abstract)
  const cpcCodes = uniqueStrings([
    ...rowArray(row?.cpc_codes),
    ...rowArray(metadata?.cpc_codes),
  ])
  const ipcCodes = rowArray(metadata?.ipc_codes)
  const publicationDate = dateFromBigQuery(metadata?.publication_date)
  const filingDate = dateFromBigQuery(metadata?.filing_date)
  const link = normalizeWhitespace(row?.url) || `https://patents.google.com/patent/${publicationNumber}`
  const relevanceScore = scoreResult(row?.score, maxScore || 1)
  const jurisdiction = normalizeWhitespace(metadata?.country_code) ||
    publicationNumber.slice(0, 2).replace(/[^A-Z]/g, '') ||
    undefined

  return {
    providerId: GOOGLE_PATENTS_BIGQUERY_PROVIDER_ID,
    sourceProvider: GOOGLE_PATENTS_BIGQUERY_PROVIDER_ID,
    sourceProviders: [GOOGLE_PATENTS_BIGQUERY_PROVIDER_ID],
    jurisdiction,
    publicationNumber,
    publication_number: publicationNumber,
    pn: publicationNumber,
    applicationNumber: normalizeWhitespace(metadata?.application_number) || null,
    applicationNumberRaw: normalizeWhitespace(metadata?.application_number) || null,
    title,
    abstract,
    snippet: abstract,
    applicants: rowArray(metadata?.assignees),
    inventors: rowArray(metadata?.inventors),
    classifications: uniqueStrings([...cpcCodes, ...ipcCodes]),
    cpcCodes,
    ipcCodes,
    filingDate,
    publicationDate,
    year: yearFromDate(publicationDate || filingDate),
    link,
    sourceUrl: link,
    matchedFields: ['googlePatentsBigQuery'],
    matchReasons: ['Returned by Google Patents Public Data on BigQuery'],
    scores: {
      provider: relevanceScore,
      text: relevanceScore,
      classification: cpcCodes.length ? relevanceScore : undefined,
      hybrid: relevanceScore,
    },
    relevanceScore,
    raw: {
      ...row,
      bigQueryPublicationNumber,
      rank: index + 1,
      bibliographic: metadata,
    },
  }
}

function dedupeResults(results: NormalizedPatentResult[]) {
  const byPublication = new Map<string, NormalizedPatentResult>()
  for (const result of results) {
    const key = compactPatentKey(result.publicationNumber)
    if (!key || byPublication.has(key)) continue
    byPublication.set(key, result)
  }
  return Array.from(byPublication.values())
}

export class GooglePatentsBigQueryProvider implements PatentSearchProvider {
  id = GOOGLE_PATENTS_BIGQUERY_PROVIDER_ID
  label = 'Google Patents BigQuery'
  jurisdictions = ['*']
  enabled = hasGooglePatentsBigQueryCredentials()
  capabilities: PatentSearchCapabilities = {
    semantic: false,
    fullText: true,
    classification: true,
    dateFilters: false,
    numberLookup: true,
    applicantFilter: false,
    inventorFilter: false,
  }

  async search(request: PatentProviderSearchRequest): Promise<NormalizedPatentResult[]> {
    const costCap = maxBytesBilled()
    if (!googleCloudProjectId()) throw new Error('Google Cloud project ID is not configured for Google Patents BigQuery.')
    if (costCap <= 0) throw new Error('Google Patents BigQuery maximum bytes billed must be configured above zero.')

    const maxResults = clampLimit(request.limit, 50, 100)
    const inputs = buildQueryInputs(request)
    if (!inputs.terms.length && !inputs.classifications.length && !inputs.publicationNumbers.length && !inputs.applicationNumbers.length) {
      return []
    }

    const client = createBigQueryClient()
    const publicationNumbersFromApplications = inputs.applicationNumbers.length
      ? (await runQuery(
        client,
        buildApplicationLookupQuery(inputs.applicationNumbers, Math.min(maxResults * 2, 100)),
        costCap,
        'Google Patents BigQuery application-number lookup'
      )).map(row => compactPatentNumber(row?.publication_number)).filter(Boolean)
      : []

    const searchRows = await runQuery(
      client,
      buildSearchQuery(request, maxResults, publicationNumbersFromApplications),
      costCap,
      'Google Patents BigQuery search'
    )
    if (!searchRows.length) return []

    const publicationNumbers = uniqueStrings(searchRows.map(row => normalizeWhitespace(row?.publication_number)).filter(Boolean)).slice(0, maxResults)
    let biblioRows: any[] = []
    try {
      biblioRows = await runQuery(
        client,
        buildBibliographicQuery(publicationNumbers),
        costCap,
        'Google Patents BigQuery bibliographic enrichment'
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn('[GooglePatentsBigQueryProvider]', JSON.stringify({
        event: 'bibliographic_enrichment_failed',
        message,
      }))
    }

    const maxScore = Math.max(...searchRows.map(row => Number(row?.score) || 0), 1)
    const metadata = bibliographicMap(biblioRows)
    return dedupeResults(
      searchRows
        .map((row, index) => normalizeResult(row, index, maxScore, metadata))
        .filter((result): result is NormalizedPatentResult => Boolean(result))
    ).slice(0, maxResults)
  }
}
