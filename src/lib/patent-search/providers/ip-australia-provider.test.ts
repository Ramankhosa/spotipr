import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { IpAustraliaProvider, resetIpAustraliaTokenCacheForTests } from './ip-australia-provider'
import type { PatentProviderSearchRequest } from '../types'

function request(overrides: Partial<PatentProviderSearchRequest> = {}): PatentProviderSearchRequest {
  return {
    searchMode: 'intelligent',
    query: 'regenerative braking controller',
    title: '',
    inventionText: '',
    filters: {},
    jurisdictions: ['AU'],
    sourceMode: 'AUSTRALIA_ONLY',
    llmExpansion: false,
    limit: 10,
    queryPlan: {
      originalQuery: 'regenerative braking controller',
      normalizedQuery: 'regenerative braking controller',
      searchQuery: 'regenerative braking controller for electric vehicles',
      semanticQuery: 'regenerative braking controller for electric vehicles',
      inventionFeatures: [],
      technicalKeywords: ['regenerative', 'braking', 'controller', 'electric'],
      synonyms: [],
      mustHaveTerms: [],
      excludedTerms: [],
      cpcCodes: [],
      ipcCodes: [],
      classificationHints: [],
      fieldFilters: {},
      explicitFilters: {},
      searchVariants: ['regenerative braking controller'],
      llmExpanded: false,
      confidence: 0.9,
      warnings: [],
    },
    ...overrides,
  }
}

describe('IpAustraliaProvider', () => {
  beforeEach(() => {
    process.env.IP_AUSTRALIA_CLIENT_ID = 'client-id'
    process.env.IP_AUSTRALIA_CLIENT_SECRET = 'client-secret'
    process.env.IP_AUSTRALIA_API_ENV = 'production'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetIpAustraliaTokenCacheForTests()
    delete process.env.IP_AUSTRALIA_CLIENT_ID
    delete process.env.IP_AUSTRALIA_CLIENT_SECRET
    delete process.env.IP_AUSTRALIA_API_ENV
  })

  test('requests OAuth token and performs quick search', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'access-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        patentBag: [{
          ipRightIdentifier: '2021104213',
          inventionTitle: 'A new control strategy for regenerative braking',
          abstractText: 'A regenerative braking controller for an electrical vehicle.',
          filingDate: '2021-07-01',
          applicantBag: [{ nameLineOneText: 'Example Pty Ltd' }],
          inventorBag: [{ firstName: 'Ada', lastName: 'Lovelace' }],
          ipcClassificationBag: ['B60L 7/10'],
        }],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new IpAustraliaProvider()
    const results = await provider.search(request())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('https://production.api.ipaustralia.gov.au/public/external-token-api/v1/access_token')
    expect(fetchMock.mock.calls[1][0]).toBe('https://production.api.ipaustralia.gov.au/public/australian-patent-search-api/v1/search/quick')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer access-token')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      query: expect.any(String),
      sort: {
        field: 'NUMBER',
        direction: 'DESCENDING',
      },
    })
    expect(results[0]).toMatchObject({
      providerId: 'ip-australia',
      sourceProvider: 'ip-australia',
      jurisdiction: 'AU',
      publicationNumber: '2021104213',
      title: 'A new control strategy for regenerative braking',
      applicants: ['Example Pty Ltd'],
      inventors: ['Ada Lovelace'],
      ipcCodes: ['B60L 7/10'],
    })
  })

  test('uses get by patent number for explicit manual AU numbers', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'access-token',
        expires_in: 3600,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        patentNumber: '2018219977',
        title: 'Known Australian patent',
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new IpAustraliaProvider()
    await provider.search(request({
      searchMode: 'manual',
      query: '',
      queryPlan: {
        ...request().queryPlan,
        fieldFilters: { publicationNumber: 'AU 2018219977' },
        explicitFilters: { publicationNumber: 'AU 2018219977' },
      },
    }))

    expect(fetchMock.mock.calls[1][0]).toBe('https://production.api.ipaustralia.gov.au/public/australian-patent-search-api/v1/patent/AU2018219977')
  })
})
