import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { authenticateUser, findMany, create, appendTrail } = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  appendTrail: vi.fn(),
}))

vi.mock('@/lib/auth-middleware', () => ({ authenticateUser }))
vi.mock('@/lib/prisma', () => ({ prisma: { whitespaceStudy: { findMany, create } } }))
vi.mock('@/lib/whitespace/service', () => ({ appendTrail }))

import { GET, POST } from './route'

function get() {
  return GET(new NextRequest('http://localhost/api/whitespace/studies'))
}

function post(body: unknown) {
  const request = new NextRequest('http://localhost/api/whitespace/studies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

describe('Whitespace studies list GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateUser.mockResolvedValue({ user: { id: 'user-1', tenantId: 'tenant-1', email: 'a@b.test' } } as never)
    findMany.mockResolvedValue([] as never)
  })

  it('lists only personal studies and studies of the viewer’s own tenant', async () => {
    await get()

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          status: 'ACTIVE',
          OR: [{ tenantId: null }, { tenantId: 'tenant-1' }],
        },
      })
    )
  })

  it('applies no tenant filter for a viewer with no tenant, matching getOwnedStudy', async () => {
    authenticateUser.mockResolvedValue({ user: { id: 'user-1', tenantId: null, email: 'a@b.test' } } as never)
    await get()

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', status: 'ACTIVE' } })
    )
  })
})

describe('Whitespace study creation POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateUser.mockResolvedValue({ user: { id: 'user-1', tenantId: 'tenant-1', email: 'a@b.test' } } as never)
    create.mockResolvedValue({ id: 'study-1' } as never)
  })

  it('refuses an invention brief that is not an object', async () => {
    const response = await post({ kind: 'INVENTION', invention: 'a sensor that recalibrates itself' })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toMatch(/problem, approach or constraints/)
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses an invention brief with nothing filled in', async () => {
    const response = await post({ kind: 'INVENTION', invention: { problem: '   ', approach: '', headline: 'x' } })

    expect(response.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('accepts an invention brief carrying at least one field of text', async () => {
    const response = await post({ kind: 'INVENTION', invention: { problem: 'Sensors drift after two weeks.' } })

    expect(response.status).toBe(201)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'INVENTION',
          inventionJson: expect.objectContaining({ problem: 'Sensors drift after two weeks.' }),
        }),
      })
    )
  })
})
