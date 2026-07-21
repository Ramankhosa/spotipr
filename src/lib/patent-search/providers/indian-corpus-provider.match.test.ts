import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, queryTexts } = vi.hoisted(() => {
  const queryTexts: string[] = []
  const row = (publicationNumber: string, extra: Record<string, unknown>) => ({
    id: publicationNumber,
    publicationNumber,
    title: `Patent ${publicationNumber}`,
    abstract: 'Example disclosure',
    country: 'US',
    applicants: [],
    inventors: [],
    classifications: [],
    ...extra,
  })
  const prismaMock: any = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (query: any) => {
      const sql = Array.isArray(query?.strings) ? query.strings.join('?') : String(query)
      queryTexts.push(sql)
      if (sql.includes('structuredMatchScore')) {
        return [row('US-STRICT-A1', { textScore: 0.9, structuredMatch: true })]
      }
      if (sql.includes('local_patent_embeddings')) {
        return [row('US-SEMANTIC-A1', { vectorScore: 0.84 })]
      }
      return []
    }),
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  }
  return { prismaMock, queryTexts }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/settings/settings-service', () => ({
  getSettings: vi.fn(async () => ({
    'retrieval.maxVectorQueries': 1,
    'retrieval.ivfflatProbes': 24,
    'retrieval.textCandidateCap': 1000,
    'retrieval.trigramCandidateCap': 1000,
    'retrieval.metadataCandidateCap': 1000,
    'retrieval.statementTimeoutMs': 8000,
    'retrieval.trigramThreshold': 0.16,
  })),
}))
vi.mock('@/lib/patent-corpus-service', () => ({
  PATENT_CORPUS_EMBEDDING_COLUMN: 'embeddingHalf',
  PATENT_CORPUS_EMBEDDING_DIMENSIONS: 2,
  PATENT_CORPUS_EMBEDDING_DISTANCE_OP: '<=>',
  PATENT_CORPUS_EMBEDDING_DTYPE: 'float',
  PATENT_CORPUS_EMBEDDING_MODEL: 'voyage-test',
  PATENT_CORPUS_EMBEDDING_SQL_TYPE: 'halfvec(2)',
  PATENT_CORPUS_SOURCE_EPO: 'epo',
  PATENT_CORPUS_SOURCE_GOOGLE: 'google',
  PATENT_CORPUS_SOURCE_INDIAN: 'indian-corpus',
  PATENT_CORPUS_SOURCE_PQAI: 'pqai',
  corpusEmbeddingToLiteral: vi.fn(() => '[0.1,0.2]'),
  hasSearchEmbeddingApiKey: vi.fn(() => true),
  requestSearchQueryEmbeddings: vi.fn(async () => [[0.1, 0.2]]),
}))

import { IndianCorpusProvider } from './indian-corpus-provider'
import type { PatentProviderSearchRequest } from '../types'

describe('IndianCorpusProvider structured MATCH lane', () => {
  beforeEach(() => {
    queryTexts.length = 0
    vi.clearAllMocks()
  })

  it('ANDs MATCH groups in an indexed lane and retains semantic-only candidates', async () => {
    const provider = new IndianCorpusProvider({ metadataSearchEnabled: false })
    const request: PatentProviderSearchRequest = {
      searchMode: 'intelligent',
      query: 'optical sensor feedback controller',
      limit: 10,
      candidateLimit: 20,
      skipTrigramSearch: true,
      queryPlan: {
        originalQuery: 'optical controller',
        normalizedQuery: 'optical sensor feedback controller',
        searchQuery: '"optical sensor" OR photodetector OR "feedback controller"',
        semanticQuery: 'adaptive optical sensing controller',
        inventionFeatures: [],
        technicalKeywords: [],
        synonyms: [],
        mustHaveTerms: [],
        excludedTerms: [],
        cpcCodes: [],
        ipcCodes: [],
        classificationHints: [],
        fieldFilters: {},
        explicitFilters: {},
        searchVariants: [],
        retrievalQueries: [{ id: 'concept', type: 'concept', text: 'adaptive optical sensing controller' }],
        literalMatchGroups: [
          { id: 'sensor', terms: ['optical sensor', 'photodetector'] },
          { id: 'control', terms: ['feedback controller'] },
        ],
        llmExpanded: false,
        confidence: 1,
        warnings: [],
      },
    }

    const results = await provider.search(request)
    expect(results.map(result => result.publicationNumber)).toEqual(
      expect.arrayContaining(['US-STRICT-A1', 'US-SEMANTIC-A1'])
    )
    expect(results.find(result => result.publicationNumber === 'US-STRICT-A1')?.matchedFields)
      .toContain('structuredMatchCandidate')
    expect(results.find(result => result.publicationNumber === 'US-SEMANTIC-A1')?.matchedFields)
      .toContain('semantic')

    const structuredSql = queryTexts.find(sql => sql.includes('structuredMatchScore')) || ''
    expect((structuredSql.match(/@@ websearch_to_tsquery/g) || [])).toHaveLength(2)
    expect(structuredSql).toContain(' AND ')
  })
})
