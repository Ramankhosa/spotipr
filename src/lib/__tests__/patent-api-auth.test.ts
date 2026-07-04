import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  requestLogCreate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    patentApiKey: { findUnique: mocks.findUnique, update: mocks.update },
    patentApiRequestLog: { create: mocks.requestLogCreate },
    $transaction: mocks.transaction,
  },
}))

import {
  authenticatePatentApiRequest,
  createPatentApiKeySecret,
  hashPatentApiKey,
  PatentApiError,
} from '@/lib/patent-api-auth'

function request(secret: string) {
  return new NextRequest('http://local/api/v1/patents/search', { headers: { Authorization: `Bearer ${secret}` } })
}

function activeKey(secret: string) {
  return {
    id: 'key-1', name: 'Production', keyHash: hashPatentApiKey(secret), keyPrefix: secret.slice(0, 16), status: 'ACTIVE', expiresAt: null,
    client: { id: 'client-1', name: 'Client', slug: 'client', status: 'ACTIVE', rateLimitPerMinute: 30, dailyRequestLimit: 2000, monthlyRequestLimit: 50000 },
  }
}

describe('patent API authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.update.mockResolvedValue({})
    mocks.queryRaw.mockResolvedValue([{ requestCount: 1 }])
    mocks.transaction.mockImplementation(async (callback: any) => callback({ $queryRaw: mocks.queryRaw }))
  })

  it('generates a pn_live key and stores a deterministic hash instead of plaintext', () => {
    const generated = createPatentApiKeySecret()
    expect(generated.secret).toMatch(/^pn_live_[A-Za-z0-9_-]+$/)
    expect(generated.keyHash).toBe(hashPatentApiKey(generated.secret))
    expect(generated.keyHash).not.toContain(generated.secret)
    expect(generated.keyLastFour).toBe(generated.secret.slice(-4))
  })

  it('authenticates an active key and reserves all three client quota buckets', async () => {
    const generated = createPatentApiKeySecret()
    mocks.findUnique.mockResolvedValue(activeKey(generated.secret))

    const auth = await authenticatePatentApiRequest(request(generated.secret))

    expect(auth.client.id).toBe('client-1')
    expect(auth.quota.minute.remaining).toBe(29)
    expect(auth.quota.day.remaining).toBe(1999)
    expect(auth.quota.month.remaining).toBe(49999)
    expect(mocks.queryRaw).toHaveBeenCalledTimes(3)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'key-1' } }))
  })

  it('rejects revoked keys before reserving quota', async () => {
    const generated = createPatentApiKeySecret()
    mocks.findUnique.mockResolvedValue({ ...activeKey(generated.secret), status: 'REVOKED' })
    await expect(authenticatePatentApiRequest(request(generated.secret))).rejects.toMatchObject({ code: 'INVALID_API_KEY', status: 401 })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('rejects suspended clients', async () => {
    const generated = createPatentApiKeySecret()
    mocks.findUnique.mockResolvedValue({ ...activeKey(generated.secret), client: { ...activeKey(generated.secret).client, status: 'SUSPENDED' } })
    await expect(authenticatePatentApiRequest(request(generated.secret))).rejects.toMatchObject({ code: 'CLIENT_SUSPENDED', status: 403 })
  })

  it('returns a retryable 429 when an atomic bucket cannot increment', async () => {
    const generated = createPatentApiKeySecret()
    mocks.findUnique.mockResolvedValue(activeKey(generated.secret))
    mocks.queryRaw.mockResolvedValueOnce([])
    await expect(authenticatePatentApiRequest(request(generated.secret))).rejects.toSatisfy((error: unknown) => (
      error instanceof PatentApiError && error.code === 'RATE_LIMIT_EXCEEDED' && error.status === 429 && Number(error.retryAfter) > 0
    ))
  })
})
