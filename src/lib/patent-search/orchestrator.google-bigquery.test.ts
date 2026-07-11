import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { NormalizedPatentResult, PatentSearchProvider, PatentSearchProviderId } from './types'

const mocks = vi.hoisted(() => {
  const providers: Record<string, PatentSearchProvider> = {}
  return {
    providers,
    createPatentSearchQueryPlan: vi.fn(),
    resolveProviderIds: vi.fn(),
    listPatentSearchProviders: vi.fn(),
    getPatentSearchProvider: vi.fn((id: PatentSearchProviderId) => providers[id]),
  }
})

vi.mock('./query-planner', () => ({
  createPatentSearchQueryPlan: mocks.createPatentSearchQueryPlan,
}))

vi.mock('./provider-registry', () => ({
  resolveProviderIds: mocks.resolveProviderIds,
  listPatentSearchProviders: mocks.listPatentSearchProviders,
  getPatentSearchProvider: mocks.getPatentSearchProvider,
}))

import { PatentSearchOrchestrator } from './orchestrator'

function provider(id: PatentSearchProviderId, results: NormalizedPatentResult[]): PatentSearchProvider {
  return {
    id,
    label: String(id),
    jurisdictions: ['*'],
    enabled: true,
    capabilities: {
      semantic: false,
      fullText: true,
      classification: true,
      dateFilters: false,
      numberLookup: true,
      applicantFilter: false,
      inventorFilter: false,
    },
    search: vi.fn().mockResolvedValue(results),
  }
}

function patentResult(overrides: Partial<NormalizedPatentResult>): NormalizedPatentResult {
  return {
    providerId: 'pqai',
    sourceProvider: 'pqai',
    publicationNumber: 'US7650331B1',
    title: 'Thermal battery controller',
    abstract: 'A thermal controller for a battery.',
    relevanceScore: 0.2,
    ...overrides,
  }
}

describe('PatentSearchOrchestrator with Google Patents BigQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(mocks.providers)) delete mocks.providers[key]
    mocks.createPatentSearchQueryPlan.mockResolvedValue({
      originalQuery: 'thermal battery controller',
      normalizedQuery: 'thermal battery controller',
      searchQuery: 'thermal battery controller',
      semanticQuery: 'thermal battery controller',
      inventionFeatures: ['predictive cooling'],
      technicalKeywords: ['thermal', 'battery'],
      synonyms: [],
      mustHaveTerms: [],
      excludedTerms: [],
      cpcCodes: [],
      ipcCodes: [],
      classificationHints: [],
      fieldFilters: {},
      explicitFilters: {},
      searchVariants: [],
      llmExpanded: false,
      confidence: 0.9,
      warnings: [],
    })
    mocks.resolveProviderIds.mockReturnValue(['pqai', 'google-patents-bigquery'])
  })

  test('merges BigQuery candidates through the existing provider aggregation path', async () => {
    mocks.providers.pqai = provider('pqai', [
      patentResult({
        providerId: 'pqai',
        sourceProvider: 'pqai',
        publicationNumber: 'US7650331B1',
        relevanceScore: 0.2,
      }),
    ])
    mocks.providers['google-patents-bigquery'] = provider('google-patents-bigquery', [
      patentResult({
        providerId: 'google-patents-bigquery',
        sourceProvider: 'google-patents-bigquery',
        sourceProviders: ['google-patents-bigquery'],
        publicationNumber: 'US7650331B1',
        abstract: 'A controller predicts thermal load and adjusts cooling.',
        applicants: ['Example Corp'],
        relevanceScore: 0.9,
      }),
    ])

    const response = await new PatentSearchOrchestrator().search({
      query: 'thermal battery controller',
      providerIds: ['pqai', 'google-patents-bigquery'],
      limit: 10,
    })

    expect(mocks.providers.pqai.search).toHaveBeenCalledTimes(1)
    expect(mocks.providers['google-patents-bigquery'].search).toHaveBeenCalledTimes(1)
    expect(response.candidateResults).toHaveLength(1)
    expect(response.candidateResults?.[0]).toMatchObject({
      publicationNumber: 'US7650331B1',
      abstract: 'A controller predicts thermal load and adjusts cooling.',
      applicants: ['Example Corp'],
    })
    expect(response.candidateResults?.[0].sourceProviders).toEqual(expect.arrayContaining(['pqai', 'google-patents-bigquery']))
    expect(response.diagnostics?.providerContributionCounts).toMatchObject({
      pqai: 1,
      'google-patents-bigquery': 1,
    })
  })
})
