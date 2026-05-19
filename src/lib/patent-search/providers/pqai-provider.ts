import type {
  NormalizedPatentResult,
  PatentProviderSearchRequest,
  PatentSearchCapabilities,
  PatentSearchProvider,
} from '../types'
import { asStringArray, clampLimit, normalizeWhitespace, yearFromDate } from '../utils'

function normalizePqaiQuery(query: string) {
  const safe = normalizeWhitespace(query)
    .replace(/[^\w\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = safe.split(/\s+/).filter(Boolean)
  return words.length > 20 ? words.slice(0, 20).join(' ') : safe
}

function buildPqaiManualQuery(request: PatentProviderSearchRequest) {
  const filters = request.queryPlan.fieldFilters || {}
  const terms = [
    request.query || '',
    ...(filters.anyTextContains || []),
    ...(filters.titleContains || []),
    ...(filters.abstractContains || []),
    ...(filters.patentTextContains || []),
    filters.publicationNumber || '',
    filters.applicationNumber || '',
    ...asStringArray(filters.applicants),
    ...asStringArray(filters.inventors),
    ...asStringArray(filters.classifications),
    ...asStringArray(filters.cpcCodes),
    ...asStringArray(filters.ipcCodes),
  ]
  return normalizePqaiQuery(terms.join(' '))
}

function normalizePqaiResult(result: any): NormalizedPatentResult {
  const publicationNumber = result.publication_number ||
    result.patent_number ||
    result.pn ||
    result.publication_id ||
    result.publicationId ||
    result.patentId ||
    result.patent_id ||
    result.id ||
    'Unknown'
  const abstract = result.snippet ||
    result.abstract ||
    result.description ||
    result.abstract_text ||
    result.abstractText ||
    result.abstract_en ||
    result.abstractEnglish ||
    ''
  const relevanceScore = typeof result.score === 'number'
    ? result.score
    : (typeof result.relevance === 'number' ? result.relevance : null)
  const publicationDate = result.publication_date || result.publicationDate || null
  const filingDate = result.filing_date || result.filingDate || null
  const link = result.link ||
    result.url ||
    result.patent_url ||
    result.google_patent_url ||
    `https://patents.google.com/patent/${publicationNumber}`

  return {
    providerId: 'pqai',
    sourceProvider: 'pqai',
    jurisdiction: result.jurisdiction || result.country || undefined,
    publicationNumber: String(publicationNumber),
    publication_number: String(publicationNumber),
    pn: String(publicationNumber),
    applicationNumber: result.application_number || result.applicationNumber || null,
    applicationNumberRaw: result.application_number || result.applicationNumber || null,
    title: result.title || String(abstract).split('.')[0] || 'Untitled Patent',
    abstract,
    snippet: abstract,
    applicants: result.applicants || result.assignees || null,
    inventors: Array.isArray(result.inventors) ? result.inventors : (result.inventors ? [String(result.inventors)] : []),
    classifications: [
      ...(Array.isArray(result.cpc_codes) ? result.cpc_codes : []),
      ...(Array.isArray(result.ipc_codes) ? result.ipc_codes : []),
    ],
    cpcCodes: Array.isArray(result.cpc_codes) ? result.cpc_codes : [],
    ipcCodes: Array.isArray(result.ipc_codes) ? result.ipc_codes : [],
    filingDate,
    publicationDate,
    year: result.year || yearFromDate(publicationDate || filingDate),
    link,
    sourceUrl: link,
    matchedFields: ['providerSearch'],
    matchReasons: ['Returned by PQAI search'],
    scores: {
      provider: relevanceScore ?? undefined,
      hybrid: relevanceScore ?? undefined,
    },
    relevanceScore,
    raw: result,
  }
}

export class PqaiProvider implements PatentSearchProvider {
  id = 'pqai'
  label = 'PQAI Global Patent Search'
  jurisdictions = ['*']
  enabled = true
  capabilities: PatentSearchCapabilities = {
    semantic: true,
    fullText: true,
    classification: false,
    dateFilters: false,
    numberLookup: false,
    applicantFilter: false,
    inventorFilter: false,
  }

  async search(request: PatentProviderSearchRequest): Promise<NormalizedPatentResult[]> {
    const token = process.env.PQAI_API_TOKEN || process.env.PQAI_TOKEN || '90b423ac4fd243c790c068e3a9309cd7'
    if (!token) throw new Error('No PQAI API token configured. Set PQAI_API_TOKEN.')

    const maxResults = clampLimit(request.limit, 50, 50)
    const query = request.searchMode === 'manual'
      ? buildPqaiManualQuery(request)
      : normalizePqaiQuery(request.queryPlan.searchQuery || request.query || '')
    if (!query) return []

    const params = new URLSearchParams({
      q: query,
      n: String(Math.min(Math.max(10, maxResults), 50)),
      type: 'patent',
      token,
    })
    const url = `https://api.projectpq.ai/search/102?${params.toString()}`

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    let response: Response
    try {
      const fetchOptions: any = {
        method: 'GET',
        headers,
        signal: controller.signal,
        cache: 'no-store',
      }
      if (typeof window === 'undefined') {
        const https = require('https')
        fetchOptions.agent = new https.Agent({ rejectUnauthorized: false })
      }
      response = await fetch(url, fetchOptions)
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      let message = `PQAI API request failed (HTTP ${response.status})`
      if (response.status === 500) message = 'PQAI API server error - the service may be temporarily unavailable'
      if (response.status === 401 || response.status === 403) message = 'PQAI API authentication failed - please check your API token'
      if (response.status === 429) message = 'PQAI API rate limit exceeded - please try again later'
      throw new Error(message)
    }

    const json = await response.json().catch(() => ({}))
    const results = Array.isArray(json?.results)
      ? json.results
      : Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
          ? json
          : []

    return results
      .map(normalizePqaiResult)
      .sort((a: NormalizedPatentResult, b: NormalizedPatentResult) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
      .slice(0, maxResults)
  }
}
