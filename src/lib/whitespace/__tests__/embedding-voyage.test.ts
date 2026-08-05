/**
 * Production-shape guard.
 *
 * Production runs Voyage voyage-3.5-lite: BINARY vectors in "embeddingBinary",
 * Hamming distance (<~>), cast ::bit(512). Dev runs OpenAI text-embedding-3-small:
 * float vectors in "embedding", cosine (<=>), cast ::vector.
 *
 * whitespace/embedding.ts used to hardcode the Voyage triple, which silently
 * disabled every semantic lane on the OpenAI installation. It now derives all
 * three from PATENT_CORPUS_EMBEDDING_*, and these tests pin BOTH resolutions so
 * that fix cannot regress in either direction — most importantly, so the
 * production SQL stays byte-for-byte what it has always been.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Captures the ANN statement without touching a database. */
function mockPrisma() {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  vi.doMock('@/lib/prisma', () => ({
    prisma: {
      $executeRaw: (..._args: unknown[]) => ({ __tag: 'exec' }),
      $queryRaw: (query: { strings: string[]; values: unknown[] }) => {
        calls.push({ sql: query.strings.join('?'), values: query.values })
        return { __tag: 'query' }
      },
      $transaction: async (ops: unknown[]) => ops.map(() => []),
    },
  }))
  return calls
}

function mockCorpusService(overrides: Record<string, unknown>) {
  vi.doMock('@/lib/patent-corpus-service', () => ({
    PATENT_CORPUS_EMBEDDING_COLUMN: 'embeddingBinary',
    PATENT_CORPUS_EMBEDDING_DIMENSIONS: 512,
    PATENT_CORPUS_EMBEDDING_DISTANCE_OP: '<~>',
    PATENT_CORPUS_EMBEDDING_DTYPE: 'binary',
    PATENT_CORPUS_EMBEDDING_MODEL: 'voyage-3.5-lite',
    PATENT_CORPUS_EMBEDDING_SQL_TYPE: 'bit',
    corpusEmbeddingToLiteral: (v: number[]) => v.join(''),
    hasSearchEmbeddingApiKey: () => true,
    requestSearchQueryEmbeddings: async () => [[1, 0, 1]],
    ...overrides,
  }))
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.doUnmock('@/lib/prisma')
  vi.doUnmock('@/lib/patent-corpus-service')
})

describe('production (Voyage, binary) ANN statement', () => {
  it('uses embeddingBinary, Hamming <~> and ::bit(512) — the exact triple production has always run', async () => {
    const calls = mockPrisma()
    mockCorpusService({})
    const { semanticNeighbors } = await import('../embedding')

    await semanticNeighbors({ queryText: 'preset torque clutch', limit: 10 })

    const sql = calls[0]?.sql ?? ''
    expect(sql).toContain('e."embeddingBinary"')
    expect(sql).toContain('<~>')
    expect(sql).toContain('::bit(512)')
    expect(sql).not.toContain('<=>')
  })

  it('restricts to vectors written by the configured model, so migrated-away OpenAI rows cannot be reached', async () => {
    const calls = mockPrisma()
    mockCorpusService({})
    const { semanticNeighbors } = await import('../embedding')

    await semanticNeighbors({ queryText: 'preset torque clutch', limit: 10 })

    expect(calls[0]?.sql).toContain('e."model" =')
    expect(calls[0]?.values).toContain('voyage-3.5-lite')
    expect(calls[0]?.sql).toContain(`'COMPLETED'::"PatentEmbeddingStatus"`)
  })

  it('normalises Hamming by the bit width, matching fieldNeighborPercentiles (nearest / WORDS*32)', async () => {
    mockPrisma()
    mockCorpusService({})
    // 256 differing bits of 512 must read as 0.5 on the shared [0,1] scale that
    // semanticNoveltyScore's percentiles are expressed in.
    const { semanticNoveltyScore } = await import('../embedding')
    expect(semanticNoveltyScore(0.5, 0.4, 0.6)).toBeCloseTo(0.5, 5)
  })

  it('applies the distance ceiling in the raw metric, not the normalised one', async () => {
    const calls = mockPrisma()
    mockCorpusService({})
    const { semanticNeighbors } = await import('../embedding')

    await semanticNeighbors({ queryText: 'x', limit: 10, maxDistance: 0.25 })

    // 0.25 normalised must reach SQL as 128 raw Hamming bits (0.25 * 512).
    expect(calls[0]?.values).toContain(128)
  })

  it('omits the ceiling entirely when the caller passes none', async () => {
    const calls = mockPrisma()
    mockCorpusService({})
    const { semanticNeighbors } = await import('../embedding')

    await semanticNeighbors({ queryText: 'x', limit: 10 })

    expect(calls[0]?.sql).not.toContain('<= ')
  })
})

describe('dev (OpenAI, float) ANN statement', () => {
  it('resolves to the cosine triple instead, which the old hardcoded module never could', async () => {
    const calls = mockPrisma()
    mockCorpusService({
      PATENT_CORPUS_EMBEDDING_COLUMN: 'embedding',
      PATENT_CORPUS_EMBEDDING_DIMENSIONS: 1536,
      PATENT_CORPUS_EMBEDDING_DISTANCE_OP: '<=>',
      PATENT_CORPUS_EMBEDDING_DTYPE: 'float',
      PATENT_CORPUS_EMBEDDING_MODEL: 'text-embedding-3-small',
      PATENT_CORPUS_EMBEDDING_SQL_TYPE: 'vector',
    })
    const { semanticNeighbors } = await import('../embedding')

    await semanticNeighbors({ queryText: 'x', limit: 10, maxDistance: 0.25 })

    const sql = calls[0]?.sql ?? ''
    expect(sql).toContain('e."embedding"')
    expect(sql).toContain('<=>')
    expect(sql).toContain('::vector')
    // Cosine distance spans 0..2, so the [0,1] ceiling doubles into raw scale.
    expect(calls[0]?.values).toContain(0.5)
  })
})

describe('embedQueryTexts batch alignment', () => {
  it('keeps results index-aligned when blank texts are silently dropped by the provider', async () => {
    mockPrisma()
    const sent: string[][] = []
    mockCorpusService({
      requestSearchQueryEmbeddings: async (texts: string[]) => {
        sent.push(texts)
        return texts.map((_, i) => [i + 1])
      },
      corpusEmbeddingToLiteral: (v: number[]) => `lit${v[0]}`,
    })
    const { embedQueryTexts } = await import('../embedding')

    // The middle text is blank; the provider filters blanks BEFORE the request,
    // so naive zip-by-index would shift every literal after it by one.
    const literals = await embedQueryTexts(['first', '   ', 'third'])

    expect(sent[0]).toEqual(['first', 'third'])
    expect(literals).toEqual(['lit1', null, 'lit2'])
  })

  it('returns all null without calling the API when the lane is unconfigured', async () => {
    mockPrisma()
    let called = false
    mockCorpusService({
      hasSearchEmbeddingApiKey: () => false,
      requestSearchQueryEmbeddings: async () => {
        called = true
        return []
      },
    })
    const { embedQueryTexts } = await import('../embedding')

    expect(await embedQueryTexts(['a', 'b'])).toEqual([null, null])
    expect(called).toBe(false)
  })
})

describe('semanticMatchSql', () => {
  it('converts the normalised ceiling to raw Hamming bits on a binary installation', async () => {
    mockPrisma()
    mockCorpusService({})
    const { semanticMatchSql } = await import('../embedding')
    const { Prisma } = await import('@prisma/client')

    const fragment = semanticMatchSql(Prisma.sql`q.lit`, 0.25)

    const sql = fragment.strings.join('?')
    expect(sql).toContain('e."embeddingBinary"')
    expect(sql).toContain('<~>')
    expect(sql).toContain('::bit(512)')
    expect(fragment.values).toContain(128) // 0.25 × 512
  })

  it('doubles the ceiling into cosine-distance scale on a float installation', async () => {
    mockPrisma()
    mockCorpusService({
      PATENT_CORPUS_EMBEDDING_COLUMN: 'embedding',
      PATENT_CORPUS_EMBEDDING_DIMENSIONS: 1536,
      PATENT_CORPUS_EMBEDDING_DISTANCE_OP: '<=>',
      PATENT_CORPUS_EMBEDDING_DTYPE: 'float',
      PATENT_CORPUS_EMBEDDING_SQL_TYPE: 'vector',
    })
    const { semanticMatchSql } = await import('../embedding')
    const { Prisma } = await import('@prisma/client')

    const fragment = semanticMatchSql(Prisma.sql`q.lit`, 0.25)

    expect(fragment.strings.join('?')).toContain('<=>')
    expect(fragment.values).toContain(0.5)
  })
})

describe('uncalibrated installations', () => {
  it('refuses to run the semantic arm on binary vectors with no measured ceiling', async () => {
    mockPrisma()
    mockCorpusService({})
    delete process.env.WHITESPACE_SEMANTIC_MAX_DISTANCE
    const { resolveMaxDistance, UNCALIBRATED_REASON } = await import('../candidates')

    expect(resolveMaxDistance()).toBeNull()
    expect(UNCALIBRATED_REASON).toContain('whitespace-semantic-calibrate')
  })

  it('honours an operator-set ceiling once the corpus has been measured', async () => {
    mockPrisma()
    mockCorpusService({})
    process.env.WHITESPACE_SEMANTIC_MAX_DISTANCE = '0.28'
    const { resolveMaxDistance } = await import('../candidates')

    expect(resolveMaxDistance()).toBe(0.28)
    delete process.env.WHITESPACE_SEMANTIC_MAX_DISTANCE
  })

  it('keeps the measured cosine default for float installations', async () => {
    mockPrisma()
    mockCorpusService({
      PATENT_CORPUS_EMBEDDING_DTYPE: 'float',
      PATENT_CORPUS_EMBEDDING_MODEL: 'text-embedding-3-small',
    })
    delete process.env.WHITESPACE_SEMANTIC_MAX_DISTANCE
    const { resolveMaxDistance } = await import('../candidates')

    expect(resolveMaxDistance()).toBe(0.35)
  })

  it('honours the operator kill switch even on a float installation', async () => {
    mockPrisma()
    mockCorpusService({
      PATENT_CORPUS_EMBEDDING_DTYPE: 'float',
      PATENT_CORPUS_EMBEDDING_MODEL: 'text-embedding-3-small',
    })
    process.env.WHITESPACE_SEMANTIC_MAX_DISTANCE = 'off'
    const { resolveMaxDistance, semanticArmUnavailableReason, DISABLED_REASON } = await import('../candidates')

    expect(resolveMaxDistance()).toBeNull()
    // "Go calibrate" would be wrong advice for a deliberate off — the reasons
    // must never be conflated.
    expect(semanticArmUnavailableReason()).toBe(DISABLED_REASON)
    delete process.env.WHITESPACE_SEMANTIC_MAX_DISTANCE
  })

  it('reads any non-positive number as the kill switch, never as "use the default"', async () => {
    mockPrisma()
    mockCorpusService({
      PATENT_CORPUS_EMBEDDING_DTYPE: 'float',
      PATENT_CORPUS_EMBEDDING_MODEL: 'text-embedding-3-small',
    })
    const { resolveMaxDistance, semanticArmUnavailableReason, DISABLED_REASON } = await import('../candidates')

    // '0.0' and '-1' used to slip past the literal-'0' string test and fall
    // through to the measured cosine default — turning the arm back ON for an
    // operator who had just asked for it off.
    for (const raw of ['0', '0.0', '-1', '-0.5']) {
      process.env.WHITESPACE_SEMANTIC_MAX_DISTANCE = raw
      expect(resolveMaxDistance(), `raw=${raw}`).toBeNull()
      expect(semanticArmUnavailableReason(), `raw=${raw}`).toBe(DISABLED_REASON)
    }
    delete process.env.WHITESPACE_SEMANTIC_MAX_DISTANCE
  })
})
