import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtractedPatentRecord } from '@/lib/patent-corpus-extractor'

const mocks = vi.hoisted(() => ({
  prisma: {
    localPatentEmbedding: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import {
  claimNextPatentEmbeddings,
  mergeLocalPatentDataForImport,
} from '@/lib/patent-corpus-service'

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
  beforeEach(() => {
    vi.clearAllMocks()
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
  })
})
