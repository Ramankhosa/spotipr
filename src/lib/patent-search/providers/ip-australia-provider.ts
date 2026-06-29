import type {
  NormalizedPatentResult,
  PatentProviderSearchRequest,
  PatentSearchCapabilities,
  PatentSearchFilters,
  PatentSearchProvider,
} from '../types'
import {
  asStringArray,
  clampLimit,
  normalizeClassification,
  normalizeWhitespace,
  uniqueStrings,
  yearFromDate,
} from '../utils'
import { fetchWithProviderTimeout, providerTimeoutGraceMs, providerTimeoutMs } from '../provider-runtime'

const IP_AUSTRALIA_PRODUCTION_BASE = 'https://production.api.ipaustralia.gov.au/public/australian-patent-search-api/v1'
const IP_AUSTRALIA_TEST_BASE = 'https://test.api.ipaustralia.gov.au/public/australian-patent-search-api/v1'
const IP_AUSTRALIA_PRODUCTION_TOKEN = 'https://production.api.ipaustralia.gov.au/public/external-token-api/v1/access_token'
const IP_AUSTRALIA_TEST_TOKEN = 'https://test.api.ipaustralia.gov.au/public/external-token-api/v1/access_token'

let tokenCache: { token: string; expiresAt: number } | null = null

export function resetIpAustraliaTokenCacheForTests() {
  tokenCache = null
}

function ipAustraliaApiEnv() {
  return String(process.env.IP_AUSTRALIA_API_ENV || 'production').trim().toLowerCase()
}

function ipAustraliaBaseUrl() {
  const override = process.env.IP_AUSTRALIA_API_BASE_URL
  if (override) return override.replace(/\/+$/, '')
  return ipAustraliaApiEnv() === 'test' ? IP_AUSTRALIA_TEST_BASE : IP_AUSTRALIA_PRODUCTION_BASE
}

function ipAustraliaTokenUrl() {
  const override = process.env.IP_AUSTRALIA_TOKEN_URL
  if (override) return override
  return ipAustraliaApiEnv() === 'test' ? IP_AUSTRALIA_TEST_TOKEN : IP_AUSTRALIA_PRODUCTION_TOKEN
}

function ipAustraliaBearerToken() {
  return normalizeWhitespace(process.env.IP_AUSTRALIA_ACCESS_TOKEN)
}

function ipAustraliaClientId() {
  return normalizeWhitespace(process.env.IP_AUSTRALIA_CLIENT_ID)
}

function ipAustraliaClientSecret() {
  return normalizeWhitespace(process.env.IP_AUSTRALIA_CLIENT_SECRET)
}

export function hasIpAustraliaCredentials() {
  return Boolean(ipAustraliaBearerToken() || (ipAustraliaClientId() && ipAustraliaClientSecret()))
}

async function requestIpAustraliaAccessToken() {
  const directToken = ipAustraliaBearerToken()
  if (directToken) return directToken

  const clientId = ipAustraliaClientId()
  const clientSecret = ipAustraliaClientSecret()
  if (!clientId || !clientSecret) {
    throw new Error('No IP Australia OAuth credentials configured. Set IP_AUSTRALIA_CLIENT_ID and IP_AUSTRALIA_CLIENT_SECRET from the Anypoint application page.')
  }

  const now = Date.now()
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token

  const response = await fetchWithProviderTimeout(ipAustraliaTokenUrl(), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
    cache: 'no-store',
  }, {
    providerId: 'ip-australia',
    operation: 'oauth_token',
    timeoutMs: providerTimeoutMs('ip-australia', 15_000),
    graceMs: providerTimeoutGraceMs('ip-australia'),
  })

  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = json?.error_description || json?.error || response.statusText
    throw new Error(`IP Australia token request failed (HTTP ${response.status}${message ? `: ${message}` : ''})`)
  }

  const token = normalizeWhitespace(json?.access_token)
  if (!token) throw new Error('IP Australia token response did not include access_token.')
  const expiresIn = Number(json?.expires_in || 3600)
  tokenCache = {
    token,
    expiresAt: now + Math.max(300, expiresIn - 60) * 1000,
  }
  return token
}

function compactAuPatentNumber(value: unknown) {
  return normalizeWhitespace(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function normalizeSearchText(value: unknown, maxWords = 16) {
  return uniqueStrings(
    normalizeWhitespace(value)
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .map(word => word.toLowerCase())
      .filter(word => word.length > 2)
  ).slice(0, maxWords).join(' ')
}

function buildManualText(request: PatentProviderSearchRequest) {
  const filters = request.queryPlan.fieldFilters || {}
  return normalizeSearchText([
    request.query || '',
    ...(filters.anyTextContains || []),
    ...(filters.titleContains || []),
    ...(filters.abstractContains || []),
    ...(filters.patentTextContains || []),
    ...(filters.classifications || []),
    ...(filters.cpcCodes || []),
    ...(filters.ipcCodes || []),
    ...asStringArray(filters.applicants),
    ...asStringArray(filters.inventors),
  ].join(' '))
}

function buildQuickSearchText(request: PatentProviderSearchRequest) {
  if (request.searchMode === 'manual') return buildManualText(request)
  return normalizeSearchText([
    request.queryPlan.searchQuery,
    request.queryPlan.technicalKeywords.join(' '),
    request.queryPlan.mustHaveTerms.join(' '),
  ].join(' '))
}

function explicitPatentNumber(filters: PatentSearchFilters) {
  return compactAuPatentNumber(filters.publicationNumber || filters.applicationNumber)
}

function buildQuickSearchBody(request: PatentProviderSearchRequest, limit: number) {
  const query = buildQuickSearchText(request)
  return {
    query,
    sort: {
      field: 'NUMBER',
      direction: 'DESCENDING',
    },
    filters: {},
    page: {
      size: limit,
    },
  }
}

function arrayFrom(value: unknown) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function firstValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && normalizeWhitespace(value)) return value
  }
  return ''
}

function nestedNames(value: unknown) {
  return uniqueStrings(arrayFrom(value).map(item => {
    if (typeof item === 'string') return item
    if (!item || typeof item !== 'object') return ''
    const record = item as Record<string, unknown>
    return normalizeWhitespace([
      firstValue(record, ['name', 'nameText', 'fullName', 'nameLineOneText', 'organisationName', 'organizationName']),
      firstValue(record, ['firstName', 'givenName']),
      firstValue(record, ['lastName', 'familyName']),
    ].filter(Boolean).join(' '))
  }))
}

function resultArray(json: any) {
  if (Array.isArray(json)) return json
  for (const key of ['patents', 'patentBag', 'results', 'items', 'data', 'ipRights', 'ipRightBag', 'searchResults']) {
    if (Array.isArray(json?.[key])) return json[key]
  }
  if (json && typeof json === 'object') return [json]
  return []
}

function normalizeIpAustraliaResult(result: any, queryTerms: string[]): NormalizedPatentResult {
  const record: Record<string, unknown> = typeof result === 'object' && result ? result as Record<string, unknown> : { ipRightIdentifier: result }
  const publicationNumber = normalizeWhitespace(firstValue(record, [
    'ipRightIdentifier',
    'patentNumber',
    'patentNumberText',
    'applicationNumber',
    'applicationNumberText',
    'number',
    'id',
  ])) || 'Unknown'
  const title = normalizeWhitespace(firstValue(record, ['title', 'inventionTitle', 'inventionTitleText', 'name'])) || 'Untitled Australian patent'
  const abstract = normalizeWhitespace(firstValue(record, ['abstract', 'abstractText', 'description', 'summary']))
  const filingDate = normalizeWhitespace(firstValue(record, ['filingDate', 'filingDateText', 'lodgementDate']))
  const publicationDate = normalizeWhitespace(firstValue(record, ['publicationDate', 'publishedDate', 'acceptanceDate', 'grantDate']))
  const cpcCodes = uniqueStrings([
    ...arrayFrom(record.cpcClassificationBag),
    ...arrayFrom(record.cpcClassifications),
    ...arrayFrom(record.cpcCodes),
  ].map(normalizeClassification).filter(Boolean))
  const ipcCodes = uniqueStrings([
    ...arrayFrom(record.ipcClassificationBag),
    ...arrayFrom(record.ipcClassifications),
    ...arrayFrom(record.ipcCodes),
  ].map(normalizeClassification).filter(Boolean))
  const haystack = `${title} ${abstract} ${cpcCodes.join(' ')} ${ipcCodes.join(' ')}`.toLowerCase()
  let relevanceScore = 0.2
  queryTerms.forEach(term => {
    if (haystack.includes(term)) relevanceScore += title.toLowerCase().includes(term) ? 0.08 : 0.04
  })
  relevanceScore = Math.max(0.01, Math.min(0.99, Number(relevanceScore.toFixed(3))))

  return {
    providerId: 'ip-australia',
    sourceProvider: 'ip-australia',
    sourceProviders: ['ip-australia'],
    jurisdiction: 'AU',
    publicationNumber,
    publication_number: publicationNumber,
    pn: publicationNumber,
    applicationNumber: normalizeWhitespace(firstValue(record, ['applicationNumber', 'applicationNumberText'])) || null,
    applicationNumberRaw: normalizeWhitespace(firstValue(record, ['applicationNumber', 'applicationNumberText'])) || null,
    title,
    abstract,
    snippet: abstract,
    applicants: nestedNames(record.applicantBag || record.applicants || record.owners),
    inventors: nestedNames(record.inventorBag || record.inventors),
    classifications: uniqueStrings([...cpcCodes, ...ipcCodes]),
    cpcCodes,
    ipcCodes,
    filingDate: filingDate || null,
    publicationDate: publicationDate || null,
    year: yearFromDate(publicationDate || filingDate),
    link: `https://ipsearch.ipaustralia.gov.au/patents/${publicationNumber}`,
    sourceUrl: `https://ipsearch.ipaustralia.gov.au/patents/${publicationNumber}`,
    matchedFields: ['ipAustraliaSearch'],
    matchReasons: ['Returned by IP Australia Patent Search API'],
    relevanceScore,
    scores: {
      provider: relevanceScore,
      text: relevanceScore,
      hybrid: relevanceScore,
    },
    raw: result,
  }
}

export class IpAustraliaProvider implements PatentSearchProvider {
  id = 'ip-australia'
  label = 'IP Australia Patent Search'
  jurisdictions = ['AU']
  enabled = hasIpAustraliaCredentials()
  capabilities: PatentSearchCapabilities = {
    semantic: false,
    fullText: true,
    classification: false,
    dateFilters: false,
    numberLookup: true,
    applicantFilter: false,
    inventorFilter: false,
  }

  async search(request: PatentProviderSearchRequest): Promise<NormalizedPatentResult[]> {
    const maxResults = clampLimit(request.limit, 20, 100)
    const token = await requestIpAustraliaAccessToken()
    const baseUrl = ipAustraliaBaseUrl()
    const filters = request.queryPlan.fieldFilters || {}
    const patentNumber = explicitPatentNumber(filters)
    let json: any
    if (patentNumber) {
      const response = await fetchWithProviderTimeout(`${baseUrl}/patent/${encodeURIComponent(patentNumber)}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      }, {
        providerId: 'ip-australia',
        operation: 'patent_lookup',
        timeoutMs: providerTimeoutMs('ip-australia', 15_000),
        graceMs: providerTimeoutGraceMs('ip-australia'),
      })
      if (!response.ok) throw new Error(`IP Australia patent lookup failed (HTTP ${response.status})`)
      json = await response.json().catch(() => ({}))
    } else {
      const body = buildQuickSearchBody(request, maxResults)
      if (!body.query) return []
      const response = await fetchWithProviderTimeout(`${baseUrl}/search/quick`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      }, {
        providerId: 'ip-australia',
        operation: 'quick_search',
        timeoutMs: providerTimeoutMs('ip-australia', 15_000),
        graceMs: providerTimeoutGraceMs('ip-australia'),
      })
      if (!response.ok) throw new Error(`IP Australia quick search failed (HTTP ${response.status})`)
      json = await response.json().catch(() => ({}))
    }

    const queryTerms = normalizeSearchText(buildQuickSearchText(request), 16).split(/\s+/).filter(Boolean)
    return resultArray(json)
      .map(result => normalizeIpAustraliaResult(result, queryTerms))
      .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
      .slice(0, maxResults)
  }
}
