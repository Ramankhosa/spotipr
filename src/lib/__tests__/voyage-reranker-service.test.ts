import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const recordExternalAiUsage = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/lib/external-ai-usage', () => ({ recordExternalAiUsage }))
import { rerankItems } from '@/lib/voyage-reranker-service'

const originalFetch = global.fetch
const originalKey = process.env.VOYAGE_API_KEY

beforeEach(() => {
  process.env.VOYAGE_API_KEY = 'test-key'
  recordExternalAiUsage.mockClear()
})
afterEach(() => {
  global.fetch = originalFetch
  process.env.VOYAGE_API_KEY = originalKey
  vi.restoreAllMocks()
})

function mockRerankResponse(scoresByIndex: Record<number, number>) {
  const data = Object.entries(scoresByIndex).map(([index, score]) => ({ index: Number(index), relevance_score: score }))
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200 })) as any
}

describe('rerankItems', () => {
  it('reorders items by descending Voyage relevance score and preserves the mapped item', async () => {
    mockRerankResponse({ 0: 0.2, 1: 0.9, 2: 0.5 })
    const result = await rerankItems('battery self-healing', [
      { item: { pn: 'A' }, text: 'first doc' },
      { item: { pn: 'B' }, text: 'second doc' },
      { item: { pn: 'C' }, text: 'third doc' },
    ])
    expect(result.map(r => (r.item as any).pn)).toEqual(['B', 'C', 'A'])
    expect(result[0].relevanceScore).toBe(0.9)
    expect(result[0].originalIndex).toBe(1)
  })

  it('preserves empty-text items as zero-scored fallbacks without calling the API', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as any
    const result = await rerankItems('query', [{ item: { pn: 'A' }, text: '   ' }])
    expect(result).toEqual([{ item: { pn: 'A' }, relevanceScore: 0, originalIndex: 0 }])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps an unrankable candidate after the scored candidates instead of deleting it', async () => {
    mockRerankResponse({ 0: 0.7 })
    const result = await rerankItems('query', [
      { item: { pn: 'A' }, text: '' },
      { item: { pn: 'B' }, text: 'rankable document' },
    ])
    expect(result.map(row => (row.item as any).pn)).toEqual(['B', 'A'])
    expect(result[1]).toMatchObject({ relevanceScore: 0, originalIndex: 0 })
  })

  it('uses the runtime chunk size supplied by retrieval tuning', async () => {
    global.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'))
      return new Response(JSON.stringify({
        data: body.documents.map((_document: string, index: number) => ({ index, relevance_score: 0.5 })),
      }), { status: 200 })
    }) as any
    await rerankItems('query', [
      { item: 'A', text: 'one' },
      { item: 'B', text: 'two' },
      { item: 'C', text: 'three' },
    ], { maxDocumentsPerCall: 2 })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects an incomplete API mapping so the caller can keep its original ordering', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ index: 0, relevance_score: 0.9 }],
    }), { status: 200 })) as any
    await expect(rerankItems('query', [
      { item: 'A', text: 'one' },
      { item: 'B', text: 'two' },
    ])).rejects.toThrow(/returned 1 scores for 2 documents/)
  })

  it('returns zero-scored passthrough when the query is empty (no API call)', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as any
    const result = await rerankItems('  ', [{ item: { pn: 'A' }, text: 'doc' }])
    expect(result).toHaveLength(1)
    expect(result[0].relevanceScore).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('throws on a non-retryable API error so callers can fall back to their own ordering', async () => {
    global.fetch = vi.fn(async () => new Response('bad request', { status: 400 })) as any
    await expect(rerankItems('query', [{ item: { pn: 'A' }, text: 'doc' }])).rejects.toThrow(/Voyage rerank failed: 400/)
  })

  it('records completed and failed rerank calls when usage context is supplied', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ index: 0, relevance_score: 0.8 }],
      usage: { total_tokens: 17 },
    }), { status: 200 })) as any
    const externalAiUsage = { tenantId: 'tenant-1', userId: 'user-1', operationId: 'run-1' }
    await rerankItems('query', [{ item: 'A', text: 'document' }], { externalAiUsage })
    expect(recordExternalAiUsage).toHaveBeenLastCalledWith(
      externalAiUsage,
      expect.objectContaining({ operation: 'rerank', status: 'COMPLETED', inputCount: 1, totalTokens: 17 })
    )

    recordExternalAiUsage.mockClear()
    global.fetch = vi.fn(async () => new Response('bad request', { status: 400 })) as any
    await expect(rerankItems('query', [{ item: 'A', text: 'document' }], { externalAiUsage })).rejects.toThrow()
    expect(recordExternalAiUsage).toHaveBeenLastCalledWith(
      externalAiUsage,
      expect.objectContaining({ operation: 'rerank', status: 'FAILED', inputCount: 1 })
    )
  })
})
