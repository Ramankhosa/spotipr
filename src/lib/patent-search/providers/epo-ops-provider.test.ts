import { describe, expect, test } from 'vitest'
import { buildEpoOpsCqlForTests } from './epo-ops-provider'
import { EpoOpsCorpusProvider } from './epo-ops-corpus-provider'
import type { PatentProviderSearchRequest } from '../types'

function request(overrides: Partial<PatentProviderSearchRequest> = {}): PatentProviderSearchRequest {
  return {
    searchMode: 'intelligent',
    query: 'smart irrigation',
    title: '',
    inventionText: '',
    filters: {},
    jurisdictions: ['EP'],
    sourceMode: 'EPO_ONLY',
    llmExpansion: false,
    limit: 10,
    queryPlan: {
      originalQuery: 'smart irrigation',
      normalizedQuery: 'smart irrigation',
      searchQuery: 'smart irrigation control system',
      semanticQuery: 'smart irrigation control system',
      inventionFeatures: ['soil moisture valve control'],
      technicalKeywords: ['irrigation', 'control'],
      synonyms: [],
      mustHaveTerms: [],
      excludedTerms: [],
      cpcCodes: [],
      ipcCodes: [],
      classificationHints: [],
      fieldFilters: {},
      explicitFilters: {},
      searchVariants: ['smart irrigation'],
      llmExpanded: false,
      confidence: 0.9,
      warnings: [],
    },
    ...overrides,
  }
}

describe('EpoOpsProvider CQL generation', () => {
  test('uses Stage 0 EPO title and abstract keywords as fielded OPS CQL', () => {
    const cql = buildEpoOpsCqlForTests(request({
      queryPlan: {
        ...request().queryPlan,
        epoTitleKeywords: ['irrigation controller'],
        epoAbstractKeywords: ['soil moisture valve control'],
        epoCombinedKeywords: ['water scheduling'],
      },
    }))

    expect(cql).toContain('ti="irrigation controller"')
    expect(cql).toContain('ab="soil moisture valve control"')
    expect(cql).toContain('(ti="water scheduling" or ab="water scheduling")')
    expect(cql).not.toContain('ta=')
  })

  test('maps manual title, abstract, and any-text fields to title/abstract CQL only', () => {
    const cql = buildEpoOpsCqlForTests(request({
      searchMode: 'manual',
      query: '',
      queryPlan: {
        ...request().queryPlan,
        fieldFilters: {
          titleContains: ['orodispersible film'],
          abstractContains: ['polymer matrix dissolution'],
          anyTextContains: ['drug release'],
        },
        explicitFilters: {},
      },
    }))

    expect(cql).toContain('ti="orodispersible film"')
    expect(cql).toContain('ab="polymer matrix dissolution"')
    expect(cql).toContain('(ti="drug release" or ab="drug release")')
    expect(cql).not.toContain('ta=')
  })

  test('uses publication/application number lookups before keyword CQL', () => {
    const cql = buildEpoOpsCqlForTests(request({
      searchMode: 'manual',
      queryPlan: {
        ...request().queryPlan,
        fieldFilters: { publicationNumber: 'EP 1000000 A1', titleContains: ['ignored'] },
        explicitFilters: {},
      },
    }))

    expect(cql).toBe('pn=EP1000000A1')
  })

  test('stored EPO corpus provider disables semantic vector retrieval', () => {
    const provider = new EpoOpsCorpusProvider()

    expect(provider.capabilities.semantic).toBe(false)
  })
})
