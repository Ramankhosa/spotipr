import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = vi.hoisted(() => {
  const original = {
    model: process.env.PATENT_CORPUS_EMBEDDING_MODEL,
    dimensions: process.env.PATENT_CORPUS_EMBEDDING_DIMENSIONS,
    dtype: process.env.PATENT_CORPUS_EMBEDDING_DTYPE,
    key: process.env.VOYAGE_API_KEY,
  }
  process.env.PATENT_CORPUS_EMBEDDING_MODEL = 'voyage-3.5-lite'
  process.env.PATENT_CORPUS_EMBEDDING_DIMENSIONS = '512'
  process.env.PATENT_CORPUS_EMBEDDING_DTYPE = 'binary'
  process.env.VOYAGE_API_KEY = 'voyage-test-key'
  return original
})

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
const recordExternalAiUsage = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/lib/external-ai-usage', () => ({ recordExternalAiUsage }))

import { requestVoyageEmbeddings } from '@/lib/patent-corpus-service'

describe('Voyage patent embeddings', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    recordExternalAiUsage.mockClear()
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ index: 0, embedding: new Array(64).fill(0) }],
    }), { status: 200 })) as any
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  afterAll(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    restore('PATENT_CORPUS_EMBEDDING_MODEL', originalEnv.model)
    restore('PATENT_CORPUS_EMBEDDING_DIMENSIONS', originalEnv.dimensions)
    restore('PATENT_CORPUS_EMBEDDING_DTYPE', originalEnv.dtype)
    restore('VOYAGE_API_KEY', originalEnv.key)
  })

  it('uses asymmetric query embeddings for search', async () => {
    await requestVoyageEmbeddings(['preset torque clutch'], { purpose: 'search-query' })

    const [, init] = (global.fetch as any).mock.calls[0]
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({
      model: 'voyage-3.5-lite',
      input_type: 'query',
      output_dtype: 'ubinary',
      output_dimension: 512,
    })
  })

  it('uses document embeddings for corpus indexing', async () => {
    await requestVoyageEmbeddings(['Patent title and abstract'], { purpose: 'corpus-indexing' })

    const [, init] = (global.fetch as any).mock.calls[0]
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({
      model: 'voyage-3.5-lite',
      input_type: 'document',
      output_dtype: 'ubinary',
      output_dimension: 512,
    })
  })

  it('records completed and failed embedding calls when usage context is supplied', async () => {
    const externalAiUsage = { tenantId: 'tenant-1', userId: 'user-1', operationId: 'run-1' }
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ index: 0, embedding: new Array(64).fill(0) }],
      usage: { total_tokens: 9 },
    }), { status: 200 })) as any
    await requestVoyageEmbeddings(['query'], { purpose: 'search-query', externalAiUsage })
    expect(recordExternalAiUsage).toHaveBeenLastCalledWith(
      externalAiUsage,
      expect.objectContaining({ operation: 'embedding', status: 'COMPLETED', inputCount: 1, totalTokens: 9 })
    )

    recordExternalAiUsage.mockClear()
    global.fetch = vi.fn(async () => new Response('bad request', { status: 400 })) as any
    await expect(requestVoyageEmbeddings(['query'], {
      purpose: 'search-query',
      maxAttempts: 1,
      externalAiUsage,
    })).rejects.toThrow()
    expect(recordExternalAiUsage).toHaveBeenLastCalledWith(
      externalAiUsage,
      expect.objectContaining({ operation: 'embedding', status: 'FAILED', inputCount: 1 })
    )
  })
})
