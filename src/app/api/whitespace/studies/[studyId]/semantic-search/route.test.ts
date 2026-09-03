import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { getOwnedStudy, readScope, appendTrail, trailCount, scopeIsRunnable, resolveFieldDefinition, semanticNeighbors } =
  vi.hoisted(() => ({
    getOwnedStudy: vi.fn(),
    readScope: vi.fn(),
    appendTrail: vi.fn(),
    trailCount: vi.fn(),
    scopeIsRunnable: vi.fn(),
    resolveFieldDefinition: vi.fn(),
    semanticNeighbors: vi.fn(),
  }))

vi.mock('@/lib/auth-middleware', () => ({
  authenticateUser: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1', email: 'a@b.test' } })),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { whitespaceTrailEntry: { count: trailCount } } }))
vi.mock('@/lib/whitespace/service', () => ({ getOwnedStudy, readScope, appendTrail }))
vi.mock('@/lib/whitespace/scope-schema', () => ({ scopeIsRunnable }))
vi.mock('@/lib/whitespace/field-definition', () => ({ resolveFieldDefinition }))
vi.mock('@/lib/whitespace/embedding', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/whitespace/embedding')>()
  return { dedupeNeighborsByFamily: original.dedupeNeighborsByFamily, semanticNeighbors }
})

import { POST } from './route'

function post(body: unknown) {
  const request = new NextRequest('http://localhost/api/whitespace/studies/study-1/semantic-search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request, { params: { studyId: 'study-1' } })
}

const neighbor = (n: number, familyKey: string, distance: number) => ({
  id: n,
  publicationNumber: `PUB-${n}`,
  familyKey,
  title: `Title ${n}`,
  abstract: 'a'.repeat(700),
  distance,
})

describe('Whitespace semantic search POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOwnedStudy.mockResolvedValue({ id: 'study-1', scope: {}, scopeVersion: 3 } as never)
    readScope.mockReturnValue({} as never)
    scopeIsRunnable.mockReturnValue({ runnable: true } as never)
    trailCount.mockResolvedValue(0 as never)
    appendTrail.mockResolvedValue(undefined as never)
    resolveFieldDefinition.mockResolvedValue({ where: 'FIELD_WHERE' } as never)
    semanticNeighbors.mockResolvedValue({
      available: true,
      appliedMaxDistance: null,
      effectiveLimit: 30,
      neighbors: [
        neighbor(1, 'fam-a', 0.1),
        neighbor(2, 'fam-a', 0.12), // same family — deduped, nearest kept
        neighbor(3, 'fam-b', 0.2),
        neighbor(4, 'fam-c', 0.3),
      ],
    } as never)
  })

  it('returns deduped, id-stripped, abstract-truncated neighbors', async () => {
    const response = await post({ query: 'a thermal probe', limit: 2 })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.available).toBe(true)
    // fam-a keeps only its nearest row, and limit 2 slices fam-c off.
    expect(payload.neighbors.map((n: { publicationNumber: string }) => n.publicationNumber)).toEqual([
      'PUB-1',
      'PUB-3',
    ])
    expect(payload.neighbors[0].id).toBeUndefined()
    expect(payload.neighbors[0].abstract).toHaveLength(600)
    expect(payload.neighbors[0].distance).toBe(0.1)
    // The retrieval over-fetches so the dedupe can still fill the page.
    expect(semanticNeighbors).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 6, scopeFilter: 'FIELD_WHERE' })
    )
  })

  it('clamps a wild limit into range instead of passing it through', async () => {
    await post({ query: 'probe', limit: 500 })
    expect(semanticNeighbors).toHaveBeenCalledWith(expect.objectContaining({ limit: 60 }))
  })

  it('refuses an empty query with a curated 400', async () => {
    const response = await post({ query: '   ' })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe('Type what to look for first.')
    expect(semanticNeighbors).not.toHaveBeenCalled()
    expect(appendTrail).not.toHaveBeenCalled()
  })

  it('refuses when the scope is not runnable', async () => {
    scopeIsRunnable.mockReturnValue({ runnable: false, reason: 'State at least one concept.' } as never)
    const response = await post({ query: 'probe' })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.code).toBe('SCOPE_NOT_RUNNABLE')
    expect(semanticNeighbors).not.toHaveBeenCalled()
  })

  it('rate-limits at 10 recent searches with Retry-After, before spending the embed call', async () => {
    trailCount.mockResolvedValue(10 as never)
    const response = await post({ query: 'probe' })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(appendTrail).not.toHaveBeenCalled()
    expect(semanticNeighbors).not.toHaveBeenCalled()
  })

  it('records the search on the trail before retrieval runs', async () => {
    const order: string[] = []
    appendTrail.mockImplementation(async () => {
      order.push('trail')
    })
    semanticNeighbors.mockImplementation(async () => {
      order.push('retrieve')
      return { available: true, appliedMaxDistance: null, effectiveLimit: 30, neighbors: [] }
    })

    await post({ query: 'probe' })

    expect(order).toEqual(['trail', 'retrieve'])
    expect(appendTrail).toHaveBeenCalledWith('study-1', 'SEARCH', 'user:user-1', expect.stringContaining('probe'))
  })

  it('answers "still preparing" when the field resolve outlives its budget, instead of hanging', async () => {
    vi.useFakeTimers()
    try {
      // A resolve that never settles within the request — the cold-study case.
      resolveFieldDefinition.mockImplementation(() => new Promise(() => {}))
      const pending = post({ query: 'probe' })
      await vi.advanceTimersByTimeAsync(21_000)
      const response = await pending
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.available).toBe(false)
      expect(payload.reason).toContain('still being prepared')
      expect(semanticNeighbors).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes an unavailable lane through as 200 data, not an error', async () => {
    semanticNeighbors.mockResolvedValue({
      available: false,
      reason: 'Semantic search is not configured (no embedding key), so the field is lexical-only.',
    } as never)
    const response = await post({ query: 'probe' })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.available).toBe(false)
    expect(payload.reason).toContain('not configured')
  })

  it('answers an unexpected failure with a generic 500 instead of leaking the internal message', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    resolveFieldDefinition.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.7:5432') as never)
    const response = await post({ query: 'probe' })
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.error).not.toContain('ECONNREFUSED')
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
