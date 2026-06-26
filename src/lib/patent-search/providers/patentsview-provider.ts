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

const PATENTSVIEW_ENDPOINT = 'https://search.patentsview.org/api/v1/patent/'
const PATENTSVIEW_FIELDS = [
  'patent_id',
  'patent_title',
  'patent_abstract',
  'patent_date',
  'patent_type',
  'patent_num_times_cited_by_us_patents',
  'assignees.assignee_organization',
  'inventors.inventor_name_first',
  'inventors.inventor_name_last',
  'cpc_current.cpc_section',
  'cpc_current.cpc_subclass',
]

const STOP_WORDS = new Set([
  'about',
  'above',
  'after',
  'against',
  'between',
  'claim',
  'claims',
  'comprising',
  'configured',
  'having',
  'including',
  'invention',
  'method',
  'patent',
  'system',
  'their',
  'there',
  'these',
  'those',
  'using',
  'wherein',
  'which',
  'with',
])

function patentsViewApiKey() {
  return process.env.PATENTSVIEW_API_KEY || process.env.USPTO_PATENTSVIEW_API_KEY || ''
}

export function hasPatentsViewApiKey() {
  return Boolean(patentsViewApiKey())
}

function compactUsPatentId(value: unknown) {
  const compact = normalizeWhitespace(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!compact) return ''
  const withoutCountry = compact.replace(/^US/, '')
  const withoutKind = withoutCountry.replace(/^([A-Z]*\d+)[A-Z]\d?$/, '$1')
  return withoutKind
}

function patentIdToPublicationNumber(value: unknown) {
  const id = normalizeWhitespace(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!id) return 'USUNKNOWN'
  return id.startsWith('US') ? id : `US${id}`
}

function normalizeSearchText(value: unknown, maxWords = 14) {
  const words = normalizeWhitespace(value)
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .map(word => word.toLowerCase())
    .filter(word => word.length > 2 && !STOP_WORDS.has(word))
  return uniqueStrings(words).slice(0, maxWords).join(' ')
}

function textCriterion(text: string) {
  return {
    _or: [
      { _text_any: { patent_title: text } },
      { _text_any: { patent_abstract: text } },
    ],
  }
}

function cpcSubclass(value: unknown) {
  const code = normalizeClassification(value).replace(/\s+/g, '')
  const match = code.match(/^([A-HY]\d{2}[A-Z])/)
  return match?.[1] || ''
}

function cpcCriteria(values: unknown[]) {
  const subclasses = uniqueStrings(values.map(cpcSubclass).filter(Boolean))
  return subclasses.map(subclass => ({ 'cpc_current.cpc_subclass': subclass }))
}

function dateCriteria(filters: PatentSearchFilters) {
  const criteria: unknown[] = []
  if (filters.publicationDateFrom) criteria.push({ _gte: { patent_date: filters.publicationDateFrom } })
  if (filters.publicationDateTo) criteria.push({ _lte: { patent_date: filters.publicationDateTo } })
  return criteria
}

function partyCriteria(filters: PatentSearchFilters) {
  const criteria: unknown[] = []
  const applicants = asStringArray(filters.applicants).slice(0, 4)
  const inventors = asStringArray(filters.inventors).slice(0, 4)
  if (applicants.length) {
    criteria.push({
      _or: applicants.map(applicant => ({
        _text_any: { 'assignees.assignee_organization': normalizeSearchText(applicant, 8) },
      })),
    })
  }
  if (inventors.length) {
    criteria.push({
      _or: inventors.map(inventor => {
        const parts = normalizeSearchText(inventor, 4).split(/\s+/).filter(Boolean)
        return parts.length
          ? { _or: parts.map(part => ({ _text_any: { 'inventors.inventor_name_last': part } })) }
          : null
      }).filter(Boolean),
    })
  }
  return criteria
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
  ].join(' '))
}

function buildPatentsViewQuery(request: PatentProviderSearchRequest) {
  const filters = request.queryPlan.fieldFilters || {}
  const patentIds = uniqueStrings([
    filters.publicationNumber,
    filters.applicationNumber,
  ].map(compactUsPatentId).filter(Boolean))
  if (patentIds.length) {
    return patentIds.length === 1
      ? { patent_id: patentIds[0] }
      : { patent_id: patentIds }
  }

  const searchText = request.searchMode === 'manual'
    ? buildManualText(request)
    : normalizeSearchText([
      request.queryPlan.searchQuery,
      request.queryPlan.technicalKeywords.join(' '),
      request.queryPlan.mustHaveTerms.join(' '),
    ].join(' '))
  const criteria: unknown[] = []
  if (searchText) criteria.push(textCriterion(searchText))

  const explicitCpc = cpcCriteria([
    ...(filters.cpcCodes || []),
    ...(filters.classifications || []),
  ])
  const hintedCpc = cpcCriteria([
    ...(request.queryPlan.cpcCodes || []),
    ...(request.queryPlan.classificationHints || []),
  ])
  const cpc = explicitCpc.length ? explicitCpc : (!searchText ? hintedCpc : [])
  if (cpc.length) criteria.push({ _or: cpc })
  criteria.push(...dateCriteria(filters), ...partyCriteria(filters))

  if (!criteria.length) {
    const fallback = normalizeSearchText(request.queryPlan.searchQuery || request.query || request.inventionText, 10)
    return fallback ? textCriterion(fallback) : { patent_type: 'utility' }
  }
  return criteria.length === 1 ? criteria[0] : { _and: criteria }
}

function arrayFrom(value: unknown) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function nestedStrings(value: unknown, keys: string[]) {
  return uniqueStrings(arrayFrom(value).flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    return keys.map(key => record[key]).filter(Boolean)
  }))
}

function normalizeInventors(value: unknown) {
  return uniqueStrings(arrayFrom(value).map(item => {
    if (!item || typeof item !== 'object') return ''
    const record = item as Record<string, unknown>
    return normalizeWhitespace([
      record.inventor_name_first,
      record.inventor_name_last,
    ].filter(Boolean).join(' '))
  }))
}

function scoreResult(result: NormalizedPatentResult, queryTerms: string[]) {
  const haystack = normalizeWhitespace([
    result.title,
    result.abstract,
    result.classifications?.join(' '),
  ].join(' ')).toLowerCase()
  const title = normalizeWhitespace(result.title).toLowerCase()
  let score = 0.2
  for (const term of queryTerms) {
    if (title.includes(term)) score += 0.08
    else if (haystack.includes(term)) score += 0.04
  }
  const citationCount = Number((result.raw as any)?.patent_num_times_cited_by_us_patents || 0)
  if (Number.isFinite(citationCount) && citationCount > 0) {
    score += Math.min(0.12, Math.log10(citationCount + 1) / 20)
  }
  return Math.max(0.01, Math.min(0.99, Number(score.toFixed(3))))
}

function normalizePatentsViewResult(result: any, queryTerms: string[]): NormalizedPatentResult {
  const patentId = result.patent_id || result.patent_number || result.id || 'Unknown'
  const publicationNumber = patentIdToPublicationNumber(patentId)
  const abstract = result.patent_abstract || result.abstract || ''
  const cpcCodes = uniqueStrings(arrayFrom(result.cpc_current).flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    return [
      record.cpc_subclass,
      [record.cpc_section, record.cpc_class, record.cpc_subclass].filter(Boolean).join(''),
    ]
  }).map(normalizeClassification).filter(Boolean))
  const applicants = nestedStrings(result.assignees, ['assignee_organization'])
  const normalized: NormalizedPatentResult = {
    providerId: 'uspto',
    sourceProvider: 'uspto',
    jurisdiction: 'US',
    publicationNumber,
    publication_number: publicationNumber,
    pn: publicationNumber,
    applicationNumber: null,
    applicationNumberRaw: null,
    title: result.patent_title || 'Untitled US patent',
    abstract,
    snippet: abstract,
    applicants,
    inventors: normalizeInventors(result.inventors),
    classifications: cpcCodes,
    cpcCodes,
    ipcCodes: [],
    filingDate: null,
    publicationDate: result.patent_date || null,
    year: yearFromDate(result.patent_date),
    link: `https://patents.google.com/patent/${publicationNumber}`,
    sourceUrl: `https://patents.google.com/patent/${publicationNumber}`,
    matchedFields: ['patentsViewSearch'],
    matchReasons: ['Returned by USPTO PatentsView PatentSearch API'],
    raw: result,
  }
  const relevanceScore = scoreResult(normalized, queryTerms)
  return {
    ...normalized,
    relevanceScore,
    scores: {
      provider: relevanceScore,
      text: relevanceScore,
      hybrid: relevanceScore,
    },
  }
}

export class PatentsViewProvider implements PatentSearchProvider {
  id = 'uspto'
  label = 'USPTO PatentsView'
  jurisdictions = ['US']
  enabled = hasPatentsViewApiKey()
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
    const apiKey = patentsViewApiKey()
    if (!apiKey) throw new Error('No PatentsView API key configured.')

    const maxResults = clampLimit(request.limit, 50, 100)
    const query = buildPatentsViewQuery(request)
    const body = {
      q: query,
      f: PATENTSVIEW_FIELDS,
      s: [{ patent_date: 'desc' }, { patent_id: 'asc' }],
      o: { size: maxResults },
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    let response: Response
    try {
      response = await fetch(PATENTSVIEW_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      if (response.status === 403) throw new Error('PatentsView authentication failed - check PATENTSVIEW_API_KEY.')
      if (response.status === 429) throw new Error('PatentsView rate limit exceeded - retry after the provider cooldown.')
      const reason = response.headers.get('X-Status-Reason') || response.statusText
      throw new Error(`PatentsView request failed (HTTP ${response.status}${reason ? `: ${reason}` : ''})`)
    }

    const json = await response.json().catch(() => ({}))
    const results = Array.isArray(json?.patents) ? json.patents : []
    const queryTerms = normalizeSearchText([
      request.queryPlan.searchQuery,
      request.queryPlan.technicalKeywords.join(' '),
      request.queryPlan.mustHaveTerms.join(' '),
    ].join(' '), 16).split(/\s+/).filter(Boolean)

    return results
      .map((result: any) => normalizePatentsViewResult(result, queryTerms))
      .sort((a: NormalizedPatentResult, b: NormalizedPatentResult) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
      .slice(0, maxResults)
  }
}
