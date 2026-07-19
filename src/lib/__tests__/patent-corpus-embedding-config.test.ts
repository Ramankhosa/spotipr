import { describe, expect, it, vi } from 'vitest'

// Imported with no PATENT_CORPUS_EMBEDDING_* overrides so this file asserts the
// out-of-the-box configuration. The ~45M-row Google Patents corpus is embedded with
// voyage-3.5-lite @ 512 dims / binary (scripts/google-patents-import/RUNBOOK.md); if
// the app's defaults drift from that, every vector query silently matches zero rows
// because the model name is part of the embedding lookup.
vi.hoisted(() => {
  delete process.env.PATENT_CORPUS_EMBEDDING_MODEL
  delete process.env.PATENT_CORPUS_EMBEDDING_DIMENSIONS
  delete process.env.PATENT_CORPUS_EMBEDDING_DTYPE
})

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  PATENT_CORPUS_EMBEDDING_COLUMN,
  PATENT_CORPUS_EMBEDDING_DIMENSIONS,
  PATENT_CORPUS_EMBEDDING_DISTANCE_OP,
  PATENT_CORPUS_EMBEDDING_DTYPE,
  PATENT_CORPUS_EMBEDDING_MODEL,
  PATENT_CORPUS_EMBEDDING_PROVIDER,
  PATENT_CORPUS_EMBEDDING_SQL_TYPE,
} from '@/lib/patent-corpus-service'

describe('patent corpus embedding defaults', () => {
  it('defaults to the Voyage model the production corpus was embedded with', () => {
    expect(PATENT_CORPUS_EMBEDDING_MODEL).toBe('voyage-3.5-lite')
    expect(PATENT_CORPUS_EMBEDDING_PROVIDER).toBe('voyage')
  })

  it('defaults to 512-dimension binary vectors', () => {
    expect(PATENT_CORPUS_EMBEDDING_DIMENSIONS).toBe(512)
    expect(PATENT_CORPUS_EMBEDDING_DTYPE).toBe('binary')
  })

  it('maps binary vectors to the bit column and Hamming distance', () => {
    expect(PATENT_CORPUS_EMBEDDING_COLUMN).toBe('embeddingBinary')
    expect(PATENT_CORPUS_EMBEDDING_SQL_TYPE).toBe('bit')
    expect(PATENT_CORPUS_EMBEDDING_DISTANCE_OP).toBe('<~>')
  })
})
