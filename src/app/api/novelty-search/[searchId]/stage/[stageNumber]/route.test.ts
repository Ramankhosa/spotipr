import { beforeEach, describe, expect, it, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  noveltySearchJob: { findUnique: vi.fn() },
}))

const executeStage1 = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('@/lib/auth', () => ({ verifyJWT: vi.fn(() => ({ sub: 'user-1' })) }))
vi.mock('@/lib/novelty-search-service', () => ({
  NoveltySearchService: class NoveltySearchService {
    executeStage1 = executeStage1
    executeStage2 = vi.fn()
    executeStage15 = vi.fn()
    executeStage3 = vi.fn()
    executeStage35 = vi.fn()
    executeStage35a = vi.fn()
    executeStage35b = vi.fn()
    executeStage35c = vi.fn()
    executeStage4 = vi.fn()
  },
}))

function request() {
  return new Request('http://localhost/api/novelty-search/search-1/stage/1', {
    method: 'POST',
    headers: { authorization: 'Bearer token' },
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  prisma.noveltySearchJob.findUnique.mockResolvedValue(null)
  executeStage1.mockResolvedValue({
    success: true,
    status: 'STAGE_1_COMPLETED',
    currentStage: 'STAGE_1',
    results: { ok: true },
  })
})

describe('legacy novelty stage execution route', () => {
  it('blocks normal authenticated users', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      roles: ['ANALYST'],
      tenantId: 'tenant-1',
    })

    const { POST } = await import('./route')
    const response = await POST(request(), { params: { searchId: 'search-1', stageNumber: '1' } })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('restricted')
    expect(executeStage1).not.toHaveBeenCalled()
  })

  it('allows super admins to execute preserved legacy stages', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      roles: ['SUPER_ADMIN'],
      tenantId: 'tenant-1',
    })

    const { POST } = await import('./route')
    const response = await POST(request(), { params: { searchId: 'search-1', stageNumber: '1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(executeStage1).toHaveBeenCalledWith('search-1', 'user-1', expect.any(Object))
  })

  it('does not advertise hidden legacy stage numbers in invalid-stage errors', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      roles: ['SUPER_ADMIN'],
      tenantId: 'tenant-1',
    })

    const { POST } = await import('./route')
    const response = await POST(request(), { params: { searchId: 'search-1', stageNumber: 'bad' } })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid stage number.')
  })
})
