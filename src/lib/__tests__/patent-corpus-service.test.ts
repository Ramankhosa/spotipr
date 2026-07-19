import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtractedPatentRecord } from '@/lib/patent-corpus-extractor'

// patent-corpus-service resolves its embedding provider from env at import time, and
// the default is now Voyage. The OpenAI key-routing tests below are specifically about
// the legacy OpenAI path, so pin that model before the module is imported.
// The Voyage defaults are asserted separately in patent-corpus-embedding-config.test.ts.
vi.hoisted(() => {
  process.env.PATENT_CORPUS_EMBEDDING_MODEL = 'text-embedding-3-small'
})

const mocks = vi.hoisted(() => ({
  prisma: {
    $queryRaw: vi.fn(),
    localPatent: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    localPatentEmbedding: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import {
  bytesToBitString,
  claimNextPatentEmbeddings,
  mergeLocalPatentDataForImport,
  PATENT_CORPUS_SOURCE_EPO,
  PATENT_CORPUS_SOURCE_INDIAN,
  PATENT_CORPUS_SOURCE_PQAI,
  persistPatentResultsToCorpus,
  persistPqaiPatentResults,
  requestOpenAIEmbeddings,
  requestSearchQueryEmbedding,
} from '@/lib/patent-corpus-service'

describe('bytesToBitString (Voyage ubinary -> pgvector bit)', () => {
  it('unpacks each uint8 byte MSB-first into 8 bits', () => {
    expect(bytesToBitString([0])).toBe('00000000')
    expect(bytesToBitString([255])).toBe('11111111')
    expect(bytesToBitString([1])).toBe('00000001')
    expect(bytesToBitString([128])).toBe('10000000')
    expect(bytesToBitString([170])).toBe('10101010') // 0xAA
    // 512-dim binary = 64 bytes -> 512-char bit string, matching bit(512).
    expect(bytesToBitString(new Array(64).fill(0)).length).toBe(512)
  })

  it('masks values to a single byte so the bit string length is deterministic', () => {
    expect(bytesToBitString([256 + 1]).length).toBe(8)
    expect(bytesToBitString([256 + 1])).toBe('00000001')
  })
})

function patentRecord(overrides: Partial<ExtractedPatentRecord> = {}): ExtractedPatentRecord {
  return {
    publicationNumber: 'IN202411077405A',
    applicationNumberRaw: '202411077405 A',
    kind: 'A',
    country: 'IN',
    filingDate: null,
    publicationDate: null,
    title: 'Journal title',
    abstract: 'Journal abstract',
    abstractOriginal: 'Journal abstract',
    applicants: [],
    inventors: [],
    classifications: ['A01G 25/16'],
    rawApplicantBlock: null,
    rawInventorBlock: null,
    rawClassificationBlock: null,
    rawText: 'raw text',
    numberOfPages: null,
    numberOfClaims: null,
    sourcePageNumber: 1,
    ragText: 'journal rag',
    embeddingText: 'journal embedding',
    extractionVersion: 'test',
    extractionConfidence: 0.9,
    extractionWarnings: [],
    ...overrides,
  }
}

describe('patent corpus service', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.$queryRaw.mockResolvedValue([])
    mocks.prisma.localPatentEmbedding.deleteMany.mockResolvedValue({ count: 0 })
  })

  it('claims due failed embeddings under the max attempt cap', async () => {
    mocks.prisma.localPatentEmbedding.findMany
      .mockResolvedValueOnce([{ id: 'embedding-1' }])
      .mockResolvedValueOnce([{ id: 'embedding-1', patent: { title: 'Patent title' } }])
    mocks.prisma.localPatentEmbedding.updateMany.mockResolvedValue({ count: 1 })

    const claimed = await claimNextPatentEmbeddings('worker-1', 4)

    expect(claimed).toHaveLength(1)
    expect(mocks.prisma.localPatentEmbedding.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['QUEUED', 'FAILED'] },
        attemptCount: { lt: expect.any(Number) },
      }),
    }))
    expect(mocks.prisma.localPatentEmbedding.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'embedding-1',
        status: { in: ['QUEUED', 'FAILED'] },
        attemptCount: { lt: expect.any(Number) },
      }),
      data: expect.objectContaining({
        status: 'PROCESSING',
        lockedBy: 'worker-1',
        attemptCount: { increment: 1 },
      }),
    }))
  })

  it('sends search-query embeddings immediately with the dedicated search key', async () => {
    const previousSearchKey = process.env.OPENAI_SEARCH_API_KEY
    const previousFallbackKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_SEARCH_API_KEY = 'search-test-key'
    process.env.OPENAI_API_KEY = 'fallback-test-key'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ index: 0, embedding: new Array(1536).fill(0.01) }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const vector = await requestSearchQueryEmbedding('independent search phrase')

      expect(vector).toHaveLength(1536)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer search-test-key' }),
          body: expect.stringContaining('independent search phrase'),
        })
      )
    } finally {
      if (previousSearchKey === undefined) delete process.env.OPENAI_SEARCH_API_KEY
      else process.env.OPENAI_SEARCH_API_KEY = previousSearchKey
      if (previousFallbackKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = previousFallbackKey
    }
  })

  it('keeps corpus indexing on the dedicated corpus key', async () => {
    const previousCorpusKey = process.env.OPENAI_CORPUS_API_KEY
    const previousFallbackKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_CORPUS_API_KEY = 'corpus-test-key'
    process.env.OPENAI_API_KEY = 'fallback-test-key'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ index: 0, embedding: new Array(1536).fill(0.02) }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const vectors = await requestOpenAIEmbeddings(['newly extracted patent'])

      expect(vectors).toHaveLength(1)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer corpus-test-key' }),
          body: expect.stringContaining('newly extracted patent'),
        })
      )
    } finally {
      if (previousCorpusKey === undefined) delete process.env.OPENAI_CORPUS_API_KEY
      else process.env.OPENAI_CORPUS_API_KEY = previousCorpusKey
      if (previousFallbackKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = previousFallbackKey
    }
  })

  it('preserves IP India enriched fields during journal import merge', () => {
    const capturedAt = new Date('2026-01-01T00:00:00.000Z')
    const merged = mergeLocalPatentDataForImport(
      patentRecord(),
      { id: 'file-1', originalName: 'journal.pdf', fileHash: 'hash-1' },
      {
        ipIndiaCapturedAt: capturedAt,
        claimsText: '1. A captured claim.',
        descriptionText: 'Captured description.',
        ipIndiaDetails: { source: 'IP India' },
        ragText: 'enriched rag',
        embeddingText: 'enriched embedding',
      }
    )

    expect(merged.claimsText).toBe('1. A captured claim.')
    expect(merged.descriptionText).toBe('Captured description.')
    expect(merged.ipIndiaDetails).toEqual({ source: 'IP India' })
    expect(merged.ipIndiaCapturedAt).toBe(capturedAt)
    expect(merged.ragText).toBe('enriched rag')
    expect(merged.embeddingText).toBe('enriched embedding')
    expect(merged.corpusSources).toEqual([PATENT_CORPUS_SOURCE_INDIAN])
  })

  it('persists PQAI results as PQAI corpus records and queues embeddings', async () => {
    mocks.prisma.localPatent.findUnique.mockResolvedValue(null)
    mocks.prisma.localPatent.create.mockImplementation(async ({ data }: any) => ({ id: 101, ...data }))
    mocks.prisma.localPatentEmbedding.findUnique.mockResolvedValue(null)
    mocks.prisma.localPatentEmbedding.create.mockResolvedValue({ id: 'embedding-1' })

    const stats = await persistPqaiPatentResults([
      {
        providerId: 'pqai',
        sourceProvider: 'pqai',
        publicationNumber: 'US2026000001A1',
        title: 'Stored international patent',
        abstract: 'A technical international patent abstract.',
        inventors: ['Inventor One'],
        classifications: ['G06F 16/00'],
        relevanceScore: 0.82,
        raw: { result_id: 'pqai-1' },
      },
    ] as any, { query: 'international patent query', fetchedAt: new Date('2026-06-19T00:00:00.000Z') }, mocks.prisma)

    expect(stats).toMatchObject({ created: 1, updated: 0, queuedEmbeddings: 1, skipped: 0 })
    expect(mocks.prisma.localPatent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        publicationNumber: 'US2026000001A1',
        corpusSources: [PATENT_CORPUS_SOURCE_PQAI],
        pqaiDetails: expect.objectContaining({
          provider: 'pqai',
          query: 'international patent query',
        }),
        embeddingText: expect.stringContaining('Stored international patent'),
      }),
    }))
    expect(mocks.prisma.localPatentEmbedding.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        localPatentId: 101,
        status: 'QUEUED',
      }),
    }))
  })

  it('adds PQAI source to existing Indian records without replacing enriched fields', async () => {
    const capturedAt = new Date('2026-01-01T00:00:00.000Z')
    mocks.prisma.localPatent.findUnique.mockResolvedValue({
      id: 7,
      publicationNumber: 'IN202411077405A',
      title: 'Indian title',
      abstract: 'Indian abstract',
      claimsText: '1. Captured claim.',
      descriptionText: 'Captured description.',
      ipIndiaDetails: { source: 'IP India' },
      ipIndiaCapturedAt: capturedAt,
      ragText: 'enriched rag',
      embeddingText: 'enriched embedding',
      corpusSources: [PATENT_CORPUS_SOURCE_INDIAN],
      inventors: [],
      classifications: ['A01G 25/16'],
    })
    mocks.prisma.localPatent.update.mockImplementation(async ({ data }: any) => ({ id: 7, ...data }))
    mocks.prisma.localPatentEmbedding.findUnique.mockResolvedValue(null)
    mocks.prisma.localPatentEmbedding.create.mockResolvedValue({ id: 'embedding-2' })

    await persistPqaiPatentResults([
      {
        providerId: 'pqai',
        sourceProvider: 'pqai',
        publicationNumber: 'IN202411077405A',
        title: 'PQAI title',
        abstract: 'PQAI abstract',
      },
    ] as any, {}, mocks.prisma)

    expect(mocks.prisma.localPatent.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7 },
      data: expect.objectContaining({
        title: 'Indian title',
        abstract: 'Indian abstract',
        claimsText: '1. Captured claim.',
        descriptionText: 'Captured description.',
        ipIndiaDetails: { source: 'IP India' },
        ipIndiaCapturedAt: capturedAt,
        ragText: 'enriched rag',
        embeddingText: 'enriched embedding',
        corpusSources: [PATENT_CORPUS_SOURCE_INDIAN, PATENT_CORPUS_SOURCE_PQAI],
      }),
    }))
  })

  it('persists EPO OPS results as European corpus records and queues title/abstract embeddings', async () => {
    mocks.prisma.localPatent.findUnique.mockResolvedValue(null)
    mocks.prisma.localPatent.create.mockImplementation(async ({ data }: any) => ({ id: 202, ...data }))
    mocks.prisma.localPatentEmbedding.findUnique.mockResolvedValue(null)
    mocks.prisma.localPatentEmbedding.create.mockResolvedValue({ id: 'embedding-epo-1' })

    const stats = await persistPatentResultsToCorpus([
      {
        providerId: 'epo-ops',
        sourceProvider: 'epo-ops',
        publicationNumber: 'EP1000000A1',
        jurisdiction: 'EP',
        title: 'European patent title',
        abstract: 'European patent abstract for embedding.',
        classifications: ['A01G 25/16'],
        relevanceScore: 0.7,
      },
    ] as any, {
      providerId: 'epo-ops',
      corpusSource: PATENT_CORPUS_SOURCE_EPO,
      query: 'ta="irrigation"',
      fetchedAt: new Date('2026-06-26T00:00:00.000Z'),
    }, mocks.prisma)

    expect(stats).toMatchObject({ created: 1, updated: 0, queuedEmbeddings: 1, skipped: 0 })
    expect(mocks.prisma.localPatent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        publicationNumber: 'EP1000000A1',
        country: 'EP',
        corpusSources: [PATENT_CORPUS_SOURCE_EPO],
        pqaiDetails: expect.objectContaining({
          provider: 'epo-ops',
          query: 'ta="irrigation"',
        }),
        embeddingText: expect.stringContaining('European patent title'),
      }),
    }))
    expect(mocks.prisma.localPatentEmbedding.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        localPatentId: 202,
        status: 'QUEUED',
      }),
    }))
  })
})
