import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PatentsViewProvider } from './patentsview-provider'
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
      searchQuery: 'thermal battery controller for predictive cooling',
      semanticQuery: 'thermal battery controller for predictive cooling',
      inventionFeatures: [],
      technicalKeywords: ['thermal', 'battery', 'controller', 'cooling'],
      synonyms: [],
      mustHaveTerms: [],
      excludedTerms: [],
      cpcCodes: ['H01M 10/613'],
      ipcCodes: [],
      classificationHints: ['H01M'],
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

describe('PatentsViewProvider', () => {
  beforeEach(() => {
    process.env.PATENTSVIEW_API_KEY = 'test-key'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.PATENTSVIEW_API_KEY
    delete process.env.USPTO_PATENTSVIEW_API_KEY
  })

  test('sends authenticated PatentsView POST search and normalizes US patents', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: false,
      count: 1,
      total_hits: 1,
      patents: [{
        patent_id: '10905426',
        patent_title: 'Thermal battery controller',
        patent_abstract: 'A controller predicts thermal load and adjusts battery cooling.',
        patent_date: '2021-02-02',
        patent_num_times_cited_by_us_patents: 4,
        assignees: [{ assignee_organization: 'Example Corp' }],
        inventors: [{ inventor_name_first: 'Ada', inventor_name_last: 'Lovelace' }],
        cpc_current: [{ cpc_section: 'H', cpc_subclass: 'H01M' }],
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new PatentsViewProvider()
    const results = await provider.search(request())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://search.patentsview.org/api/v1/patent/')
    expect(options.headers['X-Api-Key']).toBe('test-key')
    expect(JSON.parse(options.body)).toMatchObject({
      q: expect.any(Object),
      o: { size: 10 },
    })
    expect(results[0]).toMatchObject({
      providerId: 'uspto',
      sourceProvider: 'uspto',
      jurisdiction: 'US',
      publicationNumber: 'US10905426',
      title: 'Thermal battery controller',
      publicationDate: '2021-02-02',
      applicants: ['Example Corp'],
      inventors: ['Ada Lovelace'],
      cpcCodes: expect.arrayContaining(['H01M']),
    })
    expect(results[0].relevanceScore).toBeGreaterThan(0.2)
  })

  test('uses patent_id lookup for explicit US publication numbers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: false,
      count: 0,
      total_hits: 0,
      patents: [],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new PatentsViewProvider()
    await provider.search(request({
      searchMode: 'manual',
      query: '',
      queryPlan: {
        ...request().queryPlan,
        fieldFilters: { publicationNumber: 'US10905426B2' },
        explicitFilters: { publicationNumber: 'US10905426B2' },
      },
    }))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.q).toEqual({ patent_id: '10905426' })
  })
})
