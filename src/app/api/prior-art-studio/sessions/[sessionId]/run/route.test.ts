import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { runFindFirst, runCount, startStudioRun, enforceServiceAccess } = vi.hoisted(() => ({
  runFindFirst: vi.fn(async () => null),
  runCount: vi.fn(async () => 0),
  startStudioRun: vi.fn(),
  enforceServiceAccess: vi.fn(),
}))

vi.mock('@/lib/auth-middleware', () => ({
  authenticateUser: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1' } })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { priorArtStudioRun: { findFirst: runFindFirst, count: runCount } },
}))
vi.mock('@/lib/prior-art-studio/service', () => ({
  getOwnedSession: vi.fn(async () => ({
    id: 'session-1',
    plan: { title: '', blocks: [], notTerms: [], elements: [], cpc: [], filters: { jurisdictions: ['*'] } },
    planVersion: 1,
  })),
  resolveStaleRun: vi.fn(),
  startStudioRun,
}))
vi.mock('@/lib/service-access-middleware', () => ({ enforceServiceAccess }))

import { POST } from './route'

const request = () => new NextRequest('http://localhost/api/prior-art-studio/sessions/session-1/run', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
})

describe('Prior-Art Studio run access controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runFindFirst.mockResolvedValue(null)
    runCount.mockResolvedValue(0)
  })

  it('does not start a run without NOVELTY_SEARCH access', async () => {
    enforceServiceAccess.mockResolvedValue({
      allowed: false,
      response: NextResponse.json({ error: 'Feature not available' }, { status: 403 }),
    })

    const response = await POST(request(), { params: { sessionId: 'session-1' } })
    expect(response.status).toBe(403)
    expect(enforceServiceAccess).toHaveBeenCalledWith('user-1', 'tenant-1', 'NOVELTY_SEARCH')
    expect(startStudioRun).not.toHaveBeenCalled()
  })

  it('limits a user to three run starts per minute', async () => {
    enforceServiceAccess.mockResolvedValue({ allowed: true })
    runCount.mockResolvedValue(3)

    const response = await POST(request(), { params: { sessionId: 'session-1' } })
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(startStudioRun).not.toHaveBeenCalled()
  })
})
