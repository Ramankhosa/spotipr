import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { update, getOwnedSession } = vi.hoisted(() => ({
  update: vi.fn(),
  getOwnedSession: vi.fn(async () => ({
    id: 'session-1',
    title: 'Search',
    plan: {},
    planVersion: 2,
  })),
}))

vi.mock('@/lib/auth-middleware', () => ({
  authenticateUser: vi.fn(async () => ({ user: { id: 'user-1' } })),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { priorArtStudioSession: { update } } }))
vi.mock('@/lib/prior-art-studio/service', () => ({
  appendTrail: vi.fn(),
  computeSaturation: vi.fn(),
  getOwnedSession,
  resolveStaleRun: vi.fn(),
  summarizePlanEdit: vi.fn(),
}))

import { PATCH } from './route'

describe('Prior-Art Studio session plan PATCH', () => {
  it('returns field errors and performs no write for an invalid plan', async () => {
    const request = new NextRequest('http://localhost/api/prior-art-studio/sessions/session-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: { title: 'incomplete' } }),
    })
    const response = await PATCH(request, { params: { sessionId: 'session-1' } })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toMatchObject({ code: 'INVALID_STUDIO_PLAN', fields: expect.any(Array) })
    expect(update).not.toHaveBeenCalled()
  })
})
