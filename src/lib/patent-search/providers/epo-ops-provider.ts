import { DOMParser } from '@xmldom/xmldom'
import { persistPatentResultsToCorpus, PATENT_CORPUS_SOURCE_EPO } from '@/lib/patent-corpus-service'
import type {
  NormalizedPatentResult,
  PatentProviderSearchRequest,
  PatentSearchCapabilities,
  PatentSearchFilters,
  PatentSearchProvider,
} from '../types'
import { asStringArray, clampLimit, normalizeClassification, normalizeWhitespace, uniqueStrings, yearFromDate } from '../utils'
import { fetchWithProviderTimeout, providerTimeoutGraceMs, providerTimeoutMs } from '../provider-runtime'

const EPO_AUTH_URL = 'https://ops.epo.org/3.2/auth/accesstoken'
const EPO_BASE_URL = 'https://ops.epo.org/3.2/rest-services'
const EPO_TIMEOUT_MS = providerTimeoutMs('epo-ops', Math.max(1000, Number(process.env.EPO_OPS_TIMEOUT_MS || '20000') || 20_000))

let tokenCache: { token: string; expiresAt: number } | null = null

export function resetEpoOpsTokenCacheForTests() {
  tokenCache = null
}

function epoKey() {
  return normalizeWhitespace(process.env.EPO_OPS_CONSUMER_KEY || process.env.EPO_KEY)
}

function epoSecret() {
  return normalizeWhitespace(process.env.EPO_OPS_CONSUMER_SECRET || process.env.EPO_SECRET)
}

function epoAuthUrl() {
  return normalizeWhitespace(process.env.EPO_OPS_AUTH_URL) || EPO_AUTH_URL
}

function epoBaseUrl() {
  return (normalizeWhitespace(process.env.EPO_OPS_BASE_URL) || EPO_BASE_URL).replace(/\/+$/, '')
}

export function hasEpoOpsCredentials() {
  return Boolean(epoKey() && epoSecret())
}

async function requestEpoAccessToken() {
  const now = Date.now()
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token

  const key = epoKey()
  const secret = epoSecret()
  if (!key || !secret) {
    throw new Error('No EPO OPS credentials configured. Set EPO_KEY/EPO_SECRET or EPO_OPS_CONSUMER_KEY/EPO_OPS_CONSUMER_SECRET.')
  }

  const authEndpoint = epoAuthUrl()
  const authStartedAt = Date.now()
  console.info('[EpoOpsProvider]', JSON.stringify({ event: 'oauth_request', endpoint: authEndpoint, method: 'POST' }))
  const response = await fetchWithProviderTimeout(authEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    cache: 'no-store',
  }, {
    providerId: 'epo-ops',
    operation: 'oauth_token',
    timeoutMs: EPO_TIMEOUT_MS,
    graceMs: providerTimeoutGraceMs('epo-ops'),
  })

  const text = await response.text()
  console.info('[EpoOpsProvider]', JSON.stringify({
    event: 'oauth_response',
    status: response.status,
    durationMs: Date.now() - authStartedAt,
  }))
  const json = text ? JSON.parse(text) : {}
  if (!response.ok) {
    const message = json?.error_description || json?.error || response.statusText
    throw new Error(`EPO OPS token request failed (HTTP ${response.status}${message ? `: ${message}` : ''})`)
  }

  const token = normalizeWhitespace(json?.access_token)
  if (!token) throw new Error('EPO OPS token response did not include access_token.')
  const expiresIn = Number(json?.expires_in || 1199)
  tokenCache = {
    token,
    expiresAt: now + Math.max(300, expiresIn - 60) * 1000,
  }
  return token
}

function cqlValue(value: string) {
  return `"${normalizeWhitespace(value).replace(/["\\]/g, ' ').trim()}"`
}

function cqlTerm(field: string, value: string) {
  const text = normalizeWhitespace(value)
  return text ? `${field}=${cqlValue(text)}` : ''
}

function epoKeywordList(value: unknown, maxItems = 8) {
  return asStringArray(value)
    .filter(value => normalizeWhitespace(value).split(/\s+/).filter(Boolean).length <= 10)
    .map(value => firstText([value], 10))
    .filter(value => value.length >= 3 && value.length <= 120)
    .slice(0, maxItems)
}

function titleOrAbstractTerm(value: string) {
  const title = cqlTerm('ti', value)
  const abstract = cqlTerm('ab', value)
  if (title && abstract) return `(${title} or ${abstract})`
  return title || abstract
}

function firstText(values: unknown[], maxWords = 18) {
  return normalizeWhitespace(values.join(' '))
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(' ')
}

function explicitPatentNumber(filters: PatentSearchFilters) {
  return normalizeWhitespace(filters.publicationNumber || filters.applicationNumber)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function buildManualCql(filters: PatentSearchFilters, fallbackQuery = '') {
  const patentNumber = explicitPatentNumber(filters)
  if (patentNumber) return filters.applicationNumber ? `ap=${patentNumber}` : `pn=${patentNumber}`

  const clauses = uniqueStrings([
    ...asStringArray(filters.titleContains).map(value => cqlTerm('ti', value)),
    ...asStringArray(filters.abstractContains).map(value => cqlTerm('ab', value)),
    ...asStringArray(filters.anyTextContains).map(titleOrAbstractTerm),
    ...asStringArray(filters.patentTextContains).map(titleOrAbstractTerm),
  ].filter(Boolean))

  if (clauses.length) return clauses.slice(0, 6).join(' or ')
  const fallback = firstText([fallbackQuery], 12)
  return fallback ? titleOrAbstractTerm(fallback) : ''
}

function buildIntelligentCql(request: PatentProviderSearchRequest) {
  const filters = request.queryPlan.fieldFilters || {}
  const patentNumber = explicitPatentNumber(filters)
  if (patentNumber) return filters.applicationNumber ? `ap=${patentNumber}` : `pn=${patentNumber}`

  const titleKeywords = epoKeywordList(request.queryPlan.epoTitleKeywords)
  const abstractKeywords = epoKeywordList(request.queryPlan.epoAbstractKeywords)
  const combinedKeywords = epoKeywordList(request.queryPlan.epoCombinedKeywords)
  const keywordClauses = uniqueStrings([
    ...titleKeywords.map(value => cqlTerm('ti', value)),
    ...abstractKeywords.map(value => cqlTerm('ab', value)),
    ...combinedKeywords.map(titleOrAbstractTerm),
  ].filter(Boolean))
  if (keywordClauses.length) return keywordClauses.slice(0, 8).join(' or ')

  const primary = firstText([
    request.queryPlan.searchQuery,
    request.queryPlan.technicalKeywords.join(' '),
    request.title || '',
  ], 14)
  const featureClauses = (request.queryPlan.inventionFeatures || [])
    .map(feature => titleOrAbstractTerm(firstText([feature], 10)))
    .filter(Boolean)
    .slice(0, 3)
  const primaryClause = titleOrAbstractTerm(primary)
  const cql = uniqueStrings([primaryClause, ...featureClauses].filter(Boolean)).join(' or ')
  return cql || buildManualCql(filters, request.queryPlan.searchQuery || request.query || '')
}

export function buildEpoOpsCqlForTests(request: PatentProviderSearchRequest) {
  return request.searchMode === 'manual'
    ? buildManualCql(request.queryPlan.fieldFilters || {}, request.query || request.queryPlan.searchQuery)
    : buildIntelligentCql(request)
}

function elementsByLocalName(root: Element | Document, localName: string): Element[] {
  const all = Array.from(root.getElementsByTagName('*')) as Element[]
  return all.filter(element => element.localName === localName || element.nodeName.split(':').pop() === localName)
}

function directElementsByLocalName(root: Element, localName: string): Element[] {
  const result: Element[] = []
  for (let index = 0; index < root.childNodes.length; index += 1) {
    const node = root.childNodes.item(index)
    if (node.nodeType !== 1) continue
    const element = node as Element
    if (element.localName === localName || element.nodeName.split(':').pop() === localName) result.push(element)
  }
  return result
}

function textOf(element?: Element | null) {
  return normalizeWhitespace(element?.textContent || '')
}

function attr(element: Element, name: string) {
  return normalizeWhitespace(element.getAttribute(name))
}

function bestLanguageText(elements: Element[]) {
  const english = elements.find(element => attr(element, 'lang').toLowerCase() === 'en')
  return textOf(english || elements[0])
}

function parseOpsDate(value: string) {
  const text = normalizeWhitespace(value)
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  return text || null
}

function docIdValue(reference: Element | null, docIdType: string, field: string) {
  if (!reference) return ''
  const docId = elementsByLocalName(reference, 'document-id').find(element => attr(element, 'document-id-type') === docIdType)
  if (!docId) return ''
  return textOf(elementsByLocalName(docId, field)[0])
}

type EpoPublicationReference = {
  country: string
  docNumber: string
  kind: string
}

function parseEpoSearchReferences(xml: string): EpoPublicationReference[] {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  const searchResult = elementsByLocalName(document, 'search-result')[0]
  if (!searchResult) return []

  return directElementsByLocalName(searchResult, 'publication-reference')
    .map(reference => {
      const docId = elementsByLocalName(reference, 'document-id').find(element => attr(element, 'document-id-type') === 'docdb')
      return {
        country: textOf(docId ? elementsByLocalName(docId, 'country')[0] : null),
        docNumber: textOf(docId ? elementsByLocalName(docId, 'doc-number')[0] : null),
        kind: textOf(docId ? elementsByLocalName(docId, 'kind')[0] : null),
      }
    })
    .filter(reference => reference.country && reference.docNumber)
}

function nestedNames(root: Element, localName: string) {
  return uniqueStrings(elementsByLocalName(root, localName)
    .flatMap(element => elementsByLocalName(element, 'name').map(textOf))
    .filter(Boolean))
}

function classifications(root: Element) {
  const fromText = [
    ...elementsByLocalName(root, 'classification-ipcr').flatMap(element => elementsByLocalName(element, 'text').map(textOf)),
    ...elementsByLocalName(root, 'classification-cpc').flatMap(element => elementsByLocalName(element, 'text').map(textOf)),
  ]
  const fromParts = elementsByLocalName(root, 'classification-cpc').map(element => [
    textOf(elementsByLocalName(element, 'section')[0]),
    textOf(elementsByLocalName(element, 'class')[0]),
    textOf(elementsByLocalName(element, 'subclass')[0]),
    textOf(elementsByLocalName(element, 'main-group')[0]),
    textOf(elementsByLocalName(element, 'subgroup')[0]),
  ].filter(Boolean).join(''))
  return uniqueStrings([...fromText, ...fromParts].map(normalizeClassification).filter(Boolean))
}

function normalizeEpoDocument(document: Element, index: number, cql: string): NormalizedPatentResult | null {
  const country = attr(document, 'country') || 'EP'
  const docNumber = attr(document, 'doc-number')
  const kind = attr(document, 'kind')
  const publicationReference = elementsByLocalName(document, 'publication-reference')[0] || null
  const applicationReference = elementsByLocalName(document, 'application-reference')[0] || null
  const publicationNumber = normalizeWhitespace([
    docIdValue(publicationReference, 'epodoc', 'doc-number') || `${country}${docNumber}`,
    docIdValue(publicationReference, 'epodoc', 'kind') || kind,
  ].filter(Boolean).join(''))
  if (!publicationNumber) return null

  const title = bestLanguageText(elementsByLocalName(document, 'invention-title')) || publicationNumber
  const abstract = bestLanguageText(elementsByLocalName(document, 'abstract'))
  const publicationDate = parseOpsDate(docIdValue(publicationReference, 'epodoc', 'date') || docIdValue(publicationReference, 'docdb', 'date'))
  const filingDate = parseOpsDate(docIdValue(applicationReference, 'epodoc', 'date') || docIdValue(applicationReference, 'docdb', 'date'))
  const classCodes = classifications(document)
  const score = Number(Math.max(0.01, Math.min(0.99, 0.85 - index * 0.01)).toFixed(3))

  return {
    providerId: 'epo-ops',
    sourceProvider: 'epo-ops',
    sourceProviders: ['epo-ops'],
    jurisdiction: country || 'EP',
    publicationNumber,
    publication_number: publicationNumber,
    pn: publicationNumber,
    applicationNumber: docIdValue(applicationReference, 'epodoc', 'doc-number') || null,
    applicationNumberRaw: docIdValue(applicationReference, 'epodoc', 'doc-number') || null,
    title,
    abstract: abstract || null,
    snippet: abstract || null,
    applicants: nestedNames(document, 'applicant'),
    inventors: nestedNames(document, 'inventor'),
    classifications: classCodes,
    cpcCodes: classCodes.filter(code => /^[A-HY]/i.test(code)),
    ipcCodes: classCodes,
    filingDate,
    publicationDate,
    year: yearFromDate(publicationDate || filingDate),
    link: `https://worldwide.espacenet.com/patent/search/family/lookup/publication/${encodeURIComponent(publicationNumber)}`,
    sourceUrl: `${epoBaseUrl()}/published-data/publication/epodoc/${encodeURIComponent(publicationNumber)}/biblio`,
    matchedFields: ['epoOpsSearch'],
    matchReasons: ['Returned by EPO Open Patent Services bibliographic search'],
    relevanceScore: score,
    hybridScore: score,
    scores: {
      provider: score,
      text: score,
      hybrid: score,
    },
    raw: {
      cql,
      country,
      docNumber,
      kind,
    },
  }
}

function parseEpoResults(xml: string, cql: string) {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  const exchangeDocuments = elementsByLocalName(document, 'exchange-document')
  return exchangeDocuments
    .map((element, index) => normalizeEpoDocument(element, index, cql))
    .filter((result): result is NormalizedPatentResult => Boolean(result))
}

async function fetchEpoBiblioXml(reference: EpoPublicationReference, token: string) {
  const kind = reference.kind ? `.${reference.kind}` : ''
  const docdb = `${reference.country}.${reference.docNumber}${kind}`
  const response = await fetchWithProviderTimeout(`${epoBaseUrl()}/published-data/publication/docdb/${encodeURIComponent(docdb)}/biblio`, {
    headers: {
      Accept: 'application/exchange+xml',
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  }, {
    providerId: 'epo-ops',
    operation: 'biblio_lookup',
    timeoutMs: EPO_TIMEOUT_MS,
    graceMs: providerTimeoutGraceMs('epo-ops'),
  })
  const xml = await response.text()
  if (!response.ok) {
    throw new Error(`EPO OPS biblio lookup failed for ${docdb} (HTTP ${response.status})`)
  }
  return xml
}

async function enrichEpoSearchResults(searchXml: string, cql: string, token: string, maxResults: number) {
  const inlineResults = parseEpoResults(searchXml, cql)
  if (inlineResults.length) return inlineResults.slice(0, maxResults)

  const references = parseEpoSearchReferences(searchXml).slice(0, maxResults)
  const results: NormalizedPatentResult[] = []
  for (const reference of references) {
    try {
      const biblioXml = await fetchEpoBiblioXml(reference, token)
      const [result] = parseEpoResults(biblioXml, cql)
      if (result) results.push(result)
    } catch (error) {
      console.warn('[EpoOpsProvider] Biblio enrichment skipped:', error)
    }
  }
  return results
}

export class EpoOpsProvider implements PatentSearchProvider {
  id = 'epo-ops'
  label = 'European Patent Office OPS'
  jurisdictions = ['EP', 'WO', '*']
  enabled = hasEpoOpsCredentials()
  capabilities: PatentSearchCapabilities = {
    semantic: false,
    fullText: true,
    classification: true,
    dateFilters: false,
    numberLookup: true,
    applicantFilter: true,
    inventorFilter: true,
  }

  async search(request: PatentProviderSearchRequest): Promise<NormalizedPatentResult[]> {
    const startedAt = Date.now()
    const maxResults = clampLimit(request.limit, 25, 100)
    const cql = buildEpoOpsCqlForTests(request)
    if (!cql) return []

    console.info('[EpoOpsProvider]', JSON.stringify({
      event: 'search_request',
      endpoint: `${epoBaseUrl()}/published-data/search/biblio`,
      method: 'GET',
      searchMode: request.searchMode || 'intelligent',
      cql,
      maxResults,
    }))

    const token = await requestEpoAccessToken()
    const response = await fetchWithProviderTimeout(`${epoBaseUrl()}/published-data/search/biblio?q=${encodeURIComponent(cql)}`, {
      headers: {
        Accept: 'application/exchange+xml',
        Authorization: `Bearer ${token}`,
        'X-OPS-Range': `1-${Math.min(maxResults, 100)}`,
      },
      cache: 'no-store',
    }, {
      providerId: 'epo-ops',
      operation: 'search_biblio',
      timeoutMs: EPO_TIMEOUT_MS,
      graceMs: providerTimeoutGraceMs('epo-ops'),
    })

    const xml = await response.text()
    if (!response.ok) {
      throw new Error(`EPO OPS search failed (HTTP ${response.status}${xml ? `: ${normalizeWhitespace(xml).slice(0, 200)}` : ''})`)
    }

    const normalizedResults = await enrichEpoSearchResults(xml, cql, token, maxResults)
    console.info('[EpoOpsProvider]', JSON.stringify({
      event: 'search_completed',
      status: response.status,
      resultCount: normalizedResults.length,
      durationMs: Date.now() - startedAt,
    }))
    try {
      await persistPatentResultsToCorpus(normalizedResults, {
        query: cql,
        providerId: 'epo-ops',
        corpusSource: PATENT_CORPUS_SOURCE_EPO,
      })
    } catch (error) {
      console.warn('[EpoOpsProvider] Failed to persist EPO results:', error)
    }

    return normalizedResults
  }
}
