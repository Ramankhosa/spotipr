import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { buildGooglePatentsQueryForTests, GooglePatentsProvider } from './google-patents-provider'
import type { PatentProviderSearchRequest } from '../types'

function request(overrides: Partial<PatentProviderSearchRequest> = {}): PatentProviderSearchRequest {
  return {
    searchMode: 'intelligent',
    query: 'thermal battery controller',
    title: '',
    inventionText: '',
    filters: {},
    jurisdictions: ['US'],
    sourceMode: 'PQAI_ONLY',
    llmExpansion: false,
    limit: 10,
    queryPlan: {
      originalQuery: 'thermal battery controller',
      normalizedQuery: 'thermal battery controller',
      searchQuery: 'thermal battery controller predictive cooling',
      semanticQuery: 'thermal battery controller predictive cooling',
      inventionFeatures: [],
      technicalKeywords: ['thermal', 'battery', 'controller'],
      synonyms: [],
      mustHaveTerms: [],
      excludedTerms: [],
      cpcCodes: [],
      ipcCodes: [],
      classificationHints: [],
      fieldFilters: {},
      explicitFilters: {},
      searchVariants: ['thermal battery controller'],
      llmExpanded: false,
      confidence: 0.9,
      warnings: [],
    },
    ...overrides,
  }
}

describe('GooglePatentsProvider', () => {
  beforeEach(() => {
    process.env.Serp_API_KEY = 'test-serp-key'
    process.env.SERP_RATE = '0'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.Serp_API_KEY
    delete process.env.SERP_API_KEY
    delete process.env.SERPAPI_API_KEY
    delete process.env.SERP_RATE
  })

  test('calls SerpApi google_patents and normalizes basic patent fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      organic_results: [{
        position: 1,
        patent_id: 'patent/US10905426B2/en',
        patent_link: 'https://patents.google.com/patent/US10905426B2/en',
        title: 'Thermal battery controller',
        snippet: 'A controller predicts thermal load and adjusts battery cooling.',
        assignee: 'Example Corp',
        inventor: 'Ada Lovelace',
        filing_date: '2018-01-02',
        publication_date: '2021-02-02',
        pdf: 'https://example.test/patent.pdf',
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new GooglePatentsProvider()
    const results = await provider.search(request())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    const parsedUrl = new URL(url)
    expect(parsedUrl.origin + parsedUrl.pathname).toBe('https://serpapi.com/search')
    expect(parsedUrl.searchParams.get('engine')).toBe('google_patents')
    expect(parsedUrl.searchParams.get('api_key')).toBe('test-serp-key')
    expect(parsedUrl.searchParams.get('patents')).toBe('true')
    expect(parsedUrl.searchParams.get('scholar')).toBe('false')
    expect(options.method).toBe('GET')
    expect(results[0]).toMatchObject({
      providerId: 'google-patents',
      sourceProvider: 'google-patents',
      publicationNumber: 'US10905426B2',
      title: 'Thermal battery controller',
      abstract: 'A controller predicts thermal load and adjusts battery cooling.',
      applicants: 'Example Corp',
      inventors: ['Ada Lovelace'],
      filingDate: '2018-01-02',
      publicationDate: '2021-02-02',
      link: 'https://patents.google.com/patent/US10905426B2/en',
    })
    expect((results[0].raw as any).patentId).toBe('patent/US10905426B2/en')
  })

  test('builds manual search query from fielded filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ organic_results: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new GooglePatentsProvider()
    await provider.search(request({
      searchMode: 'manual',
      query: '',
      queryPlan: {
        ...request().queryPlan,
        fieldFilters: {
          publicationNumber: 'US10905426B2',
          titleContains: ['thermal controller'],
          applicants: ['Example Corp'],
        },
        explicitFilters: {
          publicationNumber: 'US10905426B2',
          titleContains: ['thermal controller'],
          applicants: ['Example Corp'],
        },
      },
    }))

    const parsedUrl = new URL(fetchMock.mock.calls[0][0])
    expect(parsedUrl.searchParams.get('q')).toContain('US10905426B2')
    expect(parsedUrl.searchParams.get('q')).toContain('thermal controller')
    expect(parsedUrl.searchParams.get('q')).toContain('Example Corp')
  })

  test('builds broad query from Google keyword phrases', () => {
    const query = buildGooglePatentsQueryForTests(request({
      queryPlan: {
        ...request().queryPlan,
        googlePatentKeywords: ['thermal battery controller', 'predictive cooling'],
        patentSearchConceptGroups: [{
          id: 'core',
          label: 'Core',
          kind: 'core',
          terms: ['battery thermal control'],
          required: true,
        }],
        searchPrecision: 'broad',
      },
    }))

    expect(query).toContain('"thermal battery controller"')
    expect(query).toContain('OR')
    expect(query).toContain('"battery thermal control"')
  })

  test('builds refined query with AND between required concept groups', () => {
    const query = buildGooglePatentsQueryForTests(request({
      queryPlan: {
        ...request().queryPlan,
        patentSearchConceptGroups: [
          { id: 'core', label: 'Core', kind: 'core', terms: ['thermal battery controller', 'battery cooling controller'], required: true },
          { id: 'mechanism', label: 'Mechanism', kind: 'mechanism', terms: ['predictive thermal load'], required: true },
          { id: 'exclude', label: 'Exclude', kind: 'excluded', terms: ['fuel cell'], excluded: true },
        ],
        searchPrecision: 'refined',
      },
    }))

    expect(query).toContain('("thermal battery controller" OR "battery cooling controller")')
    expect(query).toContain(' AND ')
    expect(query).toContain('"predictive thermal load"')
    expect(query).toContain('-"fuel cell"')
  })

  test('prefers the full abstract over the snippet fragment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      organic_results: [{
        position: 1,
        patent_id: 'patent/US10905426B2/en',
        title: 'Thermal battery controller',
        snippet: 'A controller predicts…',
        abstract: 'A full abstract describing predictive thermal load estimation and coolant flow modulation for battery packs.',
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new GooglePatentsProvider()
    const results = await provider.search(request())
    expect(results[0].abstract).toContain('full abstract describing predictive thermal load')
  })

  test('falls back to the broad query when a refined concept-group query returns zero results', async () => {
    const fetchMock = vi.fn()
      // primary (refined) call → empty
      .mockResolvedValueOnce(new Response(JSON.stringify({ organic_results: [] }), { status: 200 }))
      // broad fallback call → one hit
      .mockResolvedValueOnce(new Response(JSON.stringify({
        organic_results: [{
          position: 1,
          patent_id: 'patent/US20220123456A1/en',
          title: 'Battery cooling arrangement',
          abstract: 'Coolant channels for battery modules.',
        }],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new GooglePatentsProvider()
    const results = await provider.search(request({
      queryPlan: {
        ...request().queryPlan,
        patentSearchConceptGroups: [
          { id: 'core', terms: ['thermal battery controller'], required: true },
          { id: 'mechanism', terms: ['very rare mechanism phrase'], required: true },
        ],
        searchPrecision: 'refined',
      },
    }))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const refinedQuery = new URL(fetchMock.mock.calls[0][0]).searchParams.get('q') || ''
    const broadQuery = new URL(fetchMock.mock.calls[1][0]).searchParams.get('q') || ''
    expect(refinedQuery).toContain(' AND ')
    expect(broadQuery).not.toBe(refinedQuery)
    expect(results).toHaveLength(1)
    expect(results[0].publicationNumber).toBe('US20220123456A1')
  })
})
