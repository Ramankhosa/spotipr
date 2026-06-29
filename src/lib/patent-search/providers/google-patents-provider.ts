import type {
  NormalizedPatentResult,
  PatentProviderSearchRequest,
  PatentSearchCapabilities,
  PatentSearchFilters,
  PatentSearchProvider,
} from '../types'
import { asStringArray, clampLimit, normalizeWhitespace, uniqueStrings, yearFromDate } from '../utils'
import { fetchWithProviderTimeout, providerTimeoutGraceMs, providerTimeoutMs } from '../provider-runtime'

const SERPAPI_ENDPOINT = 'https://serpapi.com/search'
const GOOGLE_PATENTS_PROVIDER_ID = 'google-patents'
let lastSerpApiCallAt = 0

function serpApiKey() {
  return process.env.Serp_API_KEY || process.env.SERP_API_KEY || process.env.SERPAPI_API_KEY || ''
}

export function hasGooglePatentsCredentials() {
  return Boolean(serpApiKey())
}

function rateLimitMs() {
  const seconds = Number(process.env.SERP_RATE || 5)
  return Math.max(0, Number.isFinite(seconds) ? seconds : 5) * 1000
}

async function enforceSerpApiRateLimit() {
  const waitMs = rateLimitMs() - (Date.now() - lastSerpApiCallAt)
  if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs))
  lastSerpApiCallAt = Date.now()
}

function normalizeGooglePatentsQuery(value: unknown, maxWords = 32) {
  const text = normalizeWhitespace(value)
    .replace(/[^\w\s"/().:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = text.split(/\s+/).filter(Boolean)
  return words.length > maxWords ? words.slice(0, maxWords).join(' ') : text
}

function googleKeywordList(value: unknown, maxItems = 10) {
  return asStringArray(value)
    .map(value => normalizeGooglePatentsQuery(value, 10))
    .filter(value => value.length >= 3 && value.length <= 120)
    .filter(value => !/[()*?]/.test(value))
    .slice(0, maxItems)
}

function googlePhrase(value: string) {
  const text = normalizeGooglePatentsQuery(value, 10).replace(/"/g, ' ').trim()
  if (!text) return ''
  return text.includes(' ') ? `"${text}"` : text
}

function googleOrGroup(terms: string[]) {
  const phrases = uniqueStrings(terms.map(googlePhrase).filter(Boolean)).slice(0, 5)
  if (phrases.length === 0) return ''
  if (phrases.length === 1) return phrases[0]
  return `(${phrases.join(' OR ')})`
}

function googleExcludedTerms(groups: PatentProviderSearchRequest['queryPlan']['patentSearchConceptGroups']) {
  return (groups || [])
    .filter(group => group?.excluded)
    .flatMap(group => googleKeywordList(group.terms, 4))
    .map(term => `-${googlePhrase(term)}`)
    .filter(Boolean)
    .slice(0, 4)
}

export function buildGooglePatentsQueryForTests(request: PatentProviderSearchRequest) {
  const filters = request.queryPlan.fieldFilters || {}
  if (request.searchMode === 'manual') return buildManualQuery(filters, request.query)

  const groups = request.queryPlan.patentSearchConceptGroups || []
  const excluded = googleExcludedTerms(groups)
  if (request.queryPlan.searchPrecision === 'refined') {
    const requiredGroups = groups
      .filter(group => !group?.excluded && group?.required !== false)
      .map(group => googleOrGroup(googleKeywordList(group.terms, 5)))
      .filter(Boolean)
      .slice(0, 4)
    if (requiredGroups.length) {
      return normalizeGooglePatentsQuery([requiredGroups.join(' AND '), ...excluded].filter(Boolean).join(' '), 80)
    }
  }

  const keywordTerms = uniqueStrings([
    ...googleKeywordList(request.queryPlan.googlePatentKeywords, 10),
    ...groups.filter(group => !group?.excluded).flatMap(group => googleKeywordList(group.terms, 4)),
  ]).slice(0, 10)
  if (keywordTerms.length) {
    const broad = googleOrGroup(keywordTerms)
    return normalizeGooglePatentsQuery([broad, ...excluded].filter(Boolean).join(' '), 80)
  }

  return normalizeGooglePatentsQuery([
    request.queryPlan.searchQuery,
    request.queryPlan.technicalKeywords.join(' '),
  ].filter(Boolean).join(' '))
}

function buildManualQuery(filters: PatentSearchFilters, fallback = '') {
  const terms = [
    fallback,
    filters.publicationNumber || '',
    filters.applicationNumber || '',
    ...(filters.anyTextContains || []),
    ...(filters.titleContains || []),
    ...(filters.abstractContains || []),
    ...(filters.patentTextContains || []),
    ...asStringArray(filters.applicants),
    ...asStringArray(filters.inventors),
    ...asStringArray(filters.classifications),
    ...asStringArray(filters.cpcCodes),
    ...asStringArray(filters.ipcCodes),
  ]
  return normalizeGooglePatentsQuery(terms.join(' '))
}

function normalizePatentId(value: unknown) {
  const text = normalizeWhitespace(value)
  if (!text) return ''
  if (text.startsWith('patent/')) {
    const parts = text.split('/')
    return parts[1] || ''
  }
  return text.replace(/^https?:\/\/patents\.google\.com\/patent\//i, '').split('/')[0]
}

function publicationNumberFromResult(result: any) {
  return normalizeWhitespace(
    result.publication_number ||
    result.publicationNumber ||
    normalizePatentId(result.patent_id || result.patentId) ||
    result.id ||
    ''
  ).replace(/\s+/g, '')
}

function arrayFromText(value: unknown) {
  if (Array.isArray(value)) return uniqueStrings(value)
  if (typeof value === 'string' && value.trim()) return uniqueStrings(value.split(/[,;\n]/))
  return []
}

function scoreResult(result: any, index: number) {
  const rankScore = 1 / Math.max(1, Number(result.rank ?? result.position ?? index + 1))
  return Number(Math.max(0.01, Math.min(0.99, rankScore)).toFixed(3))
}

function normalizeGooglePatentsResult(result: any, index: number): NormalizedPatentResult | null {
  const publicationNumber = publicationNumberFromResult(result)
  if (!publicationNumber) return null

  const abstract = normalizeWhitespace(
    result.snippet ||
    result.abstract ||
    result.description ||
    result.summary ||
    ''
  )
  const patentId = result.patent_id || result.patentId || `patent/${publicationNumber}/en`
  const link = result.patent_link ||
    result.link ||
    result.google_patents_link ||
    `https://patents.google.com/patent/${publicationNumber}`
  const relevanceScore = scoreResult(result, index)

  return {
    providerId: GOOGLE_PATENTS_PROVIDER_ID,
    sourceProvider: GOOGLE_PATENTS_PROVIDER_ID,
    jurisdiction: result.country || result.country_code || publicationNumber.slice(0, 2).replace(/[^A-Z]/g, '') || undefined,
    publicationNumber,
    publication_number: publicationNumber,
    pn: publicationNumber,
    applicationNumber: result.application_number || result.applicationNumber || null,
    applicationNumberRaw: result.application_number || result.applicationNumber || null,
    title: normalizeWhitespace(result.title) || 'Untitled Patent',
    abstract,
    snippet: abstract,
    applicants: result.assignee || result.assignees || null,
    inventors: arrayFromText(result.inventor || result.inventors),
    classifications: [
      ...arrayFromText(result.cpc),
      ...arrayFromText(result.cpcs),
      ...arrayFromText(result.ipc),
      ...arrayFromText(result.ipcs),
      ...arrayFromText(result.classifications),
    ],
    cpcCodes: arrayFromText(result.cpc || result.cpcs),
    ipcCodes: arrayFromText(result.ipc || result.ipcs),
    filingDate: result.filing_date || result.filingDate || null,
    publicationDate: result.publication_date || result.publicationDate || null,
    year: result.year || yearFromDate(result.publication_date || result.filing_date),
    link,
    sourceUrl: link,
    raw: {
      ...result,
      patentId,
      serpapiLink: result.serpapi_link || result.serpapiLink,
      pdf: result.pdf || result.pdf_link,
    },
    matchedFields: ['googlePatentsSearch'],
    matchReasons: ['Returned by Google Patents via SerpApi'],
    scores: {
      provider: relevanceScore,
      hybrid: relevanceScore,
    },
    relevanceScore,
  }
}

function sortParam(sort: unknown) {
  if (sort === 'publicationDateDesc' || sort === 'filingDateDesc') return 'new'
  return undefined
}

function dateParam(value: unknown, type: 'publication' | 'filing') {
  const text = normalizeWhitespace(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ''
  return `${type}:${text.replace(/-/g, '')}`
}

export class GooglePatentsProvider implements PatentSearchProvider {
  id = GOOGLE_PATENTS_PROVIDER_ID
  label = 'Google Patents'
  jurisdictions = ['*']
  enabled = hasGooglePatentsCredentials()
  capabilities: PatentSearchCapabilities = {
    semantic: false,
    fullText: true,
    classification: true,
    dateFilters: true,
    numberLookup: true,
    applicantFilter: true,
    inventorFilter: true,
  }

  async search(request: PatentProviderSearchRequest): Promise<NormalizedPatentResult[]> {
    const startedAt = Date.now()
    const apiKey = serpApiKey()
    if (!apiKey) throw new Error('No SerpApi key configured for Google Patents.')

    const filters = request.queryPlan.fieldFilters || {}
    const maxResults = clampLimit(request.limit, 50, 100)
    const query = buildGooglePatentsQueryForTests(request)
    if (!query) return []

    const params = new URLSearchParams({
      engine: 'google_patents',
      q: query,
      api_key: apiKey,
      hl: 'en',
      no_cache: 'false',
      patents: 'true',
      scholar: 'false',
      num: String(Math.min(Math.max(10, maxResults), 100)),
      dups: 'language',
    })
    const after = dateParam(filters.publicationDateFrom || filters.filingDateFrom, filters.publicationDateFrom ? 'publication' : 'filing')
    const before = dateParam(filters.publicationDateTo || filters.filingDateTo, filters.publicationDateTo ? 'publication' : 'filing')
    const sort = sortParam(request.sort)
    if (after) params.set('after', after)
    if (before) params.set('before', before)
    if (sort) params.set('sort', sort)

    console.info('[GooglePatentsProvider]', JSON.stringify({
      event: 'serpapi_request',
      endpoint: SERPAPI_ENDPOINT,
      engine: 'google_patents',
      query,
      maxResults,
      after: after || undefined,
      before: before || undefined,
      sort,
    }))

    await enforceSerpApiRateLimit()
    const response = await fetchWithProviderTimeout(`${SERPAPI_ENDPOINT}?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    }, {
      providerId: GOOGLE_PATENTS_PROVIDER_ID,
      operation: 'serpapi_search',
      timeoutMs: providerTimeoutMs(GOOGLE_PATENTS_PROVIDER_ID, 20_000),
      graceMs: providerTimeoutGraceMs(GOOGLE_PATENTS_PROVIDER_ID),
    })

    const json = await response.json().catch(() => ({}))
    if (!response.ok || json?.error) {
      if (response.status === 401 || response.status === 403) throw new Error('Google Patents authentication failed - check SerpApi key.')
      if (response.status === 429) throw new Error('Google Patents SerpApi rate limit exceeded.')
      throw new Error(json?.error || `Google Patents request failed (HTTP ${response.status})`)
    }

    const results = Array.isArray(json?.organic_results) ? json.organic_results : []
    const normalizedResults = results
      .map((result: any, index: number) => normalizeGooglePatentsResult(result, index))
      .filter((result: NormalizedPatentResult | null): result is NormalizedPatentResult => Boolean(result))
      .slice(0, maxResults)
    console.info('[GooglePatentsProvider]', JSON.stringify({
      event: 'serpapi_response',
      status: response.status,
      rawResultCount: results.length,
      resultCount: normalizedResults.length,
      durationMs: Date.now() - startedAt,
      samplePublicationNumbers: normalizedResults.slice(0, 5).map((result: NormalizedPatentResult) => result.publicationNumber),
    }))
    return normalizedResults
  }
}
