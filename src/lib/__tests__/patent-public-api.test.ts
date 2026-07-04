import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  coverage: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  queryRaw: vi.fn(),
  search: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    localPatent: { findMany: mocks.findMany, findFirst: mocks.findFirst },
    $queryRaw: mocks.queryRaw,
  },
}))

vi.mock('@/lib/patent-corpus-service', () => ({
  getPatentCorpusCoverageStats: mocks.coverage,
  hasSearchEmbeddingApiKey: () => true,
  PATENT_CORPUS_EMBEDDING_MODEL: 'text-embedding-3-small',
  PATENT_CORPUS_SOURCE_INDIAN: 'indian-corpus',
}))

vi.mock('@/lib/patent-search', () => ({ patentSearchOrchestrator: { search: mocks.search } }))

import { getPublicIndianPatent, searchPublicIndianPatents } from '@/lib/patent-public-api'

const row = {
  publicationNumber: 'IN20282005A', applicationNumberRaw: '2028/CHENP/2005 A', kind: 'A', country: 'INDIA',
  filingDate: new Date('2005-08-25'), publicationDate: new Date('2007-06-08'), title: 'Patent title', abstract: 'Patent abstract',
  applicants: [{ raw: '1) ACME', name: 'ACME', address: 'India', sequence: 1 }], inventors: ['Inventor'], classifications: ['H04L 29/06'],
  numberOfPages: 12, numberOfClaims: null, sourcePdfName: 'journal.pdf', sourcePageNumber: 7, extractionConfidence: 0.95,
  rawText: 'must not leak', embeddingText: 'must not leak',
}

describe('public patent API service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PATENT_PUBLIC_API_ENABLED = 'true'
    mocks.coverage.mockResolvedValue({ sourceCoverage: { 'indian-corpus': { totalPatents: 100, patentsWithCompletedEmbedding: 100, patentsWithoutCompletedEmbedding: 0, coveragePercent: 100 } } })
    mocks.queryRaw.mockResolvedValue([{ available: true }])
  })

  it('runs strict Indian-only hybrid search and returns a sanitized full record', async () => {
    mocks.search.mockResolvedValue({
      providerStats: [{ providerId: 'indian-corpus', enabled: true, requested: true, resultCount: 1 }],
      results: [{ sourceProvider: 'indian-corpus', publicationNumber: row.publicationNumber, relevanceScore: 0.92, scores: { semantic: 0.88, text: 0.4 }, matchedFields: ['semantic'] }],
    })
    mocks.findMany.mockResolvedValue([row])

    const results = await searchPublicIndianPatents('thermal battery management', 10)

    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ providerIds: ['indian-corpus'], strictSemantic: true, llmExpansion: false, limit: 10 }))
    expect(results[0]).toMatchObject({ publicationNumber: row.publicationNumber, country: 'IN', title: row.title, relevance: { score: 0.92 } })
    expect(results[0]).not.toHaveProperty('rawText')
    expect(results[0]).not.toHaveProperty('embeddingText')
  })

  it('normalizes publication numbers before exact Indian-corpus lookup', async () => {
    mocks.findFirst.mockResolvedValue(row)
    const patent = await getPublicIndianPatent('in-2028 2005-a')
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ publicationNumberKey: 'IN20282005A', corpusSources: { has: 'indian-corpus' } }) }))
    expect(patent).toMatchObject({ publicationNumber: 'IN20282005A', applicants: [{ name: 'ACME', address: 'India', sequence: 1 }] })
  })
})

