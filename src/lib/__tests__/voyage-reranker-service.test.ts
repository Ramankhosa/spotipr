import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rerankItems } from '@/lib/voyage-reranker-service'

const originalFetch = global.fetch
const originalKey = process.env.VOYAGE_API_KEY

beforeEach(() => {
  process.env.VOYAGE_API_KEY = 'test-key'
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

  it('drops empty-text items before calling the API and returns [] when nothing is rankable', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as any
    const result = await rerankItems('query', [{ item: { pn: 'A' }, text: '   ' }])
    expect(result).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
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
})
