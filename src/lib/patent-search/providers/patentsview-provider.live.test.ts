import { describe, expect, test } from 'vitest'
import { PatentsViewProvider } from './patentsview-provider'
import type { PatentProviderSearchRequest } from '../types'

const hasLiveKey = Boolean(process.env.PATENTSVIEW_API_KEY || process.env.USPTO_PATENTSVIEW_API_KEY)
const describeLive = hasLiveKey ? describe : describe.skip

function liveRequest(): PatentProviderSearchRequest {
  return {
    searchMode: 'manual',
    query: '',
    title: '',
    inventionText: '',
    filters: {},
    jurisdictions: ['US'],
    sourceMode: 'PQAI_ONLY',
    llmExpansion: false,
    limit: 3,
    queryPlan: {
      originalQuery: '',
      normalizedQuery: 'US10905426B2',
      searchQuery: 'US10905426B2',
      semanticQuery: 'US10905426B2',
      inventionFeatures: [],
      technicalKeywords: ['thermal', 'battery', 'controller'],
      synonyms: [],
      mustHaveTerms: [],
      excludedTerms: [],
      cpcCodes: [],
      ipcCodes: [],
      classificationHints: [],
      fieldFilters: { publicationNumber: 'US10905426B2' },
      explicitFilters: { publicationNumber: 'US10905426B2' },
      searchVariants: ['US10905426B2'],
      llmExpanded: false,
      confidence: 1,
      warnings: [],
    },
  }
}

describeLive('PatentsViewProvider live API', () => {
  test('looks up a known US patent by publication number', async () => {
    const provider = new PatentsViewProvider()
    const results = await provider.search(liveRequest())

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toMatchObject({
      providerId: 'uspto',
      sourceProvider: 'uspto',
      jurisdiction: 'US',
      publicationNumber: 'US10905426',
    })
    expect(results[0].title).toEqual(expect.any(String))
  }, 30000)
})
