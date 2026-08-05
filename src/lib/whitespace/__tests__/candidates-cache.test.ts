/**
 * The candidate memo must never pin a TRANSIENT failure: one embed hiccup or
 * ANN timeout used to lock every stage of a study to a lexical-only field for
 * the full cache TTL, silently. Successes are memoised; failures are retried.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WhitespaceScope } from '../types'

function scopeWithConcept(): WhitespaceScope {
  return {
    title: '',
    summary: '',
    concepts: [{ id: 'a', label: 'moisture sensor', synonyms: [], required: true, origin: 'user' }],
    classifications: [],
    exclusions: [],
    assumptions: [],
    filters: { yearFrom: 2000, yearTo: 2026, jurisdictions: [], assignees: [] },
  }
}

/** Queues semanticNeighbors results; the last entry repeats once drained. */
function mockEmbedding(
  results: Array<
    | { available: true; neighbors: Array<{ id: number }>; appliedMaxDistance: number | null }
    | { available: false; reason: string }
  >
) {
  const neighborCalls: number[] = []
  vi.doMock('../embedding', () => ({
    semanticLaneConfigured: () => true,
    corpusVectorRowEstimate: async () => 0,
    backgroundCeiling: () => 0,
    semanticBackground: async () => [],
    semanticNeighbors: async () => {
      neighborCalls.push(1)
      return results[Math.min(neighborCalls.length - 1, results.length - 1)]
    },
  }))
  return neighborCalls
}

beforeEach(() => {
  vi.resetModules()
  process.env.WHITESPACE_SEMANTIC_MAX_DISTANCE = '0.3'
})

afterEach(() => {
  vi.doUnmock('../embedding')
  delete process.env.WHITESPACE_SEMANTIC_MAX_DISTANCE
})

describe('resolveFieldCandidates memo', () => {
  it('retries after a transient failure instead of serving it from the cache', async () => {
    const calls = mockEmbedding([
      { available: false, reason: 'Semantic retrieval failed: connection reset' },
      { available: true, neighbors: [{ id: 7 }], appliedMaxDistance: 0.3 },
    ])
    const { resolveFieldCandidates } = await import('../candidates')

    const first = await resolveFieldCandidates(scopeWithConcept())
    expect(first.available).toBe(false)

    const second = await resolveFieldCandidates(scopeWithConcept())
    expect(second.available).toBe(true)
    expect(second.ids).toEqual([7])
    expect(calls.length).toBe(2)
  })

  it('memoises a successful resolution so consecutive stages pay for one retrieval', async () => {
    const calls = mockEmbedding([{ available: true, neighbors: [{ id: 7 }], appliedMaxDistance: 0.3 }])
    const { resolveFieldCandidates } = await import('../candidates')

    const first = await resolveFieldCandidates(scopeWithConcept())
    const second = await resolveFieldCandidates(scopeWithConcept())

    expect(first.available).toBe(true)
    expect(second.ids).toEqual([7])
    expect(calls.length).toBe(1)
  })
})
