import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Options = { purpose?: string } | undefined

/**
 * Mocks the provider entry point WITH ITS REAL BLANK-FILTERING BEHAVIOUR:
 * requestCorpusEmbeddings (and both helpers under it) do
 * `texts.map(...).filter(Boolean)` before the request, so the response can be
 * shorter than the request. That is the whole bug class embedStatements exists
 * to close, so the mock must reproduce it rather than echo the input length.
 */
function mockCorpusService(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ texts: string[]; options: Options }> = []
  vi.doMock('@/lib/patent-corpus-service', () => ({
    hasCorpusEmbeddingApiKey: () => true,
    corpusEmbeddingToLiteral: (vector: number[]) => `lit${vector[0]}`,
    requestCorpusEmbeddings: async (texts: string[], options: Options) => {
      calls.push({ texts, options })
      const kept = texts.filter(text => String(text || '').trim())
      return kept.map((_, index) => [index + 1])
    },
    ...overrides,
  }))
  return calls
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.doUnmock('@/lib/patent-corpus-service')
  vi.restoreAllMocks()
})

describe('embedStatements alignment', () => {
  it('keeps literals index-aligned when the provider silently drops blanks', async () => {
    const calls = mockCorpusService()
    const { embedStatements } = await import('../embed')

    // Naive zip-by-index would attach the third text's vector to the blank and
    // shift every literal after it — no error, just statements wearing each
    // other's meanings.
    const literals = await embedStatements(['first statement', '   ', 'third statement'])

    expect(calls[0].texts).toEqual(['first statement', 'third statement'])
    expect(literals).toEqual(['lit1', null, 'lit2'])
  })

  it('embeds DOCUMENT-side, because statements are stored documents and not queries', async () => {
    const calls = mockCorpusService()
    const { embedStatements } = await import('../embed')

    await embedStatements(['a stored problem statement'])

    // Voyage is asymmetric: a statement embedded as a query has a non-zero
    // distance to itself, which breaks duplicate detection.
    expect(calls[0].options?.purpose).toBe('corpus-indexing')
  })

  it('uses the same document-side path for a probe against the statement index', async () => {
    const calls = mockCorpusService()
    const { embedStatementProbe } = await import('../embed')

    expect(await embedStatementProbe('is this problem already known?')).toBe('lit1')
    expect(calls[0].options?.purpose).toBe('corpus-indexing')
  })

  it('batches at 64 and keeps alignment across batch boundaries', async () => {
    const calls = mockCorpusService()
    const { embedStatements } = await import('../embed')

    const texts = Array.from({ length: 70 }, (_, i) => (i === 5 ? '  ' : `statement ${i}`))
    const literals = await embedStatements(texts)

    expect(calls).toHaveLength(2)
    expect(calls[0].texts).toHaveLength(64)
    expect(calls[1].texts).toHaveLength(5) // 70 texts minus one blank, minus the first batch
    expect(literals[5]).toBeNull()
    expect(literals.filter(Boolean)).toHaveLength(69)
    // Each batch is numbered from 1 by the mock provider, so the 65th non-blank
    // text must carry the second batch's first literal, not the first batch's.
    expect(literals[0]).toBe('lit1')
    expect(literals[65]).toBe('lit1')
  })
})

describe('embedStatements failure handling', () => {
  it('returns all nulls without throwing when the provider fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCorpusService({
      requestCorpusEmbeddings: async () => {
        throw new Error('Voyage embedding request failed: 429')
      },
    })
    const { embedStatements } = await import('../embed')

    // A coverage hole, not an exception: one bad batch must not abort a run.
    await expect(embedStatements(['a', 'b', 'c'])).resolves.toEqual([null, null, null])
    expect(errors).toHaveBeenCalled()
  })

  it('drops a batch rather than misaligning it when the response length disagrees', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCorpusService({
      requestCorpusEmbeddings: async () => [[1]], // one vector for two texts
    })
    const { embedStatements } = await import('../embed')

    // A wrong vector is worse than a missing one: nothing downstream can detect it.
    expect(await embedStatements(['first', 'second'])).toEqual([null, null])
  })

  it('returns all nulls without calling the provider when no key is configured', async () => {
    let called = false
    mockCorpusService({
      hasCorpusEmbeddingApiKey: () => false,
      requestCorpusEmbeddings: async () => {
        called = true
        return []
      },
    })
    const { embedStatements } = await import('../embed')

    expect(await embedStatements(['a', 'b'])).toEqual([null, null])
    expect(called).toBe(false)
  })

  it('handles an empty input and an all-blank input without calling the provider', async () => {
    const calls = mockCorpusService()
    const { embedStatements } = await import('../embed')

    expect(await embedStatements([])).toEqual([])
    expect(await embedStatements(['', '   '])).toEqual([null, null])
    expect(calls).toHaveLength(0)
  })
})
