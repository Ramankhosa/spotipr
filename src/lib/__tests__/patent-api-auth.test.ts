import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  requestLogCreate: vi.fn(),
  bucketFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    patentApiKey: { findUnique: mocks.findUnique, update: mocks.update },
    patentApiRequestLog: { create: mocks.requestLogCreate },
    patentApiUsageBucket: { findMany: mocks.bucketFindMany },
    $transaction: mocks.transaction,
    $queryRaw: mocks.queryRaw,
  },
}))

import {
  authenticatePatentApiRequest,
  createPatentApiKeySecret,
  hashPatentApiKey,
  PatentApiAuthContext,
  PatentApiError,
  patentApiRateHeaders,
  reserveAnalysisQuota,
} from '@/lib/patent-api-auth'

function request(secret: string) {
  return new NextRequest('http://local/api/v1/patents/search', { headers: { Authorization: `Bearer ${secret}` } })
}

function activeKey(secret: string) {
  return {
    id: 'key-1', name: 'Production', keyHash: hashPatentApiKey(secret), keyPrefix: secret.slice(0, 16), status: 'ACTIVE', expiresAt: null,
    client: { id: 'client-1', name: 'Client', slug: 'client', status: 'ACTIVE', rateLimitPerMinute: 30, dailyRequestLimit: 2000, monthlyRequestLimit: 50000, dailyAnalysisLimit: 200 },
  }
}

function authContext(dailyAnalysisLimit: number): PatentApiAuthContext {
  const resetAt = new Date(Date.now() + 60_000)
  return {
    client: { id: 'client-1', name: 'Client', slug: 'client', status: 'ACTIVE', rateLimitPerMinute: 30, dailyRequestLimit: 2000, monthlyRequestLimit: 50000, dailyAnalysisLimit },
    apiKey: { id: 'key-1', name: 'Production', keyPrefix: 'pn_live_abcd1234' },
    quota: {
      minute: { limit: 30, remaining: 29, resetAt },
      day: { limit: 2000, remaining: 1999, resetAt },
      month: { limit: 50000, remaining: 49999, resetAt },
    },
  }
}

describe('patent API authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.update.mockResolvedValue({})
    mocks.queryRaw.mockResolvedValue([{ requestCount: 1 }])
    mocks.bucketFindMany.mockResolvedValue([])
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

  it('writes bucket period starts as naive UTC so admin reads match the write path', async () => {
    const generated = createPatentApiKeySecret()
    mocks.findUnique.mockResolvedValue(activeKey(generated.secret))

    await authenticatePatentApiRequest(request(generated.secret))

    // periodStart lands in a `timestamp without time zone` column. Handing the
    // driver a JS Date would store the server's local wall-clock time, which
    // would never match the UTC value Prisma's typed admin queries look for.
    const periodStarts = mocks.queryRaw.mock.calls.map(([query]: any) => query.values[3])
    expect(periodStarts).toHaveLength(3)
    for (const value of periodStarts) {
      expect(typeof value).toBe('string')
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/)
    }
    const [, day, month] = periodStarts
    expect(day).toMatch(/T00:00:00\.000$/)
    expect(month).toMatch(/-01T00:00:00\.000$/)
  })

  it('reports the untripped buckets truthfully on a rate-limit rejection', async () => {
    const generated = createPatentApiKeySecret()
    mocks.findUnique.mockResolvedValue(activeKey(generated.secret))
    mocks.queryRaw.mockResolvedValueOnce([])
    mocks.bucketFindMany.mockResolvedValue([
      { periodType: 'MINUTE', requestCount: 30 },
      { periodType: 'DAY', requestCount: 41 },
      { periodType: 'MONTH', requestCount: 41 },
    ])

    const error = await authenticatePatentApiRequest(request(generated.secret)).catch(caught => caught)

    // The minute bucket is what tripped; the day/month budgets are untouched
    // and must not be reported as exhausted.
    expect(error.auth.quota.minute.remaining).toBe(0)
    expect(error.auth.quota.day.remaining).toBe(1959)
    expect(error.auth.quota.month.remaining).toBe(49959)
  })
})

describe('analysis quota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryRaw.mockResolvedValue([{ requestCount: 3 }])
  })

  it('refuses analysis for a client whose analysis limit is zero, without touching a bucket', async () => {
    await expect(reserveAnalysisQuota(authContext(0))).rejects.toMatchObject({ code: 'ANALYSIS_NOT_ENABLED', status: 403 })
    expect(mocks.queryRaw).not.toHaveBeenCalled()
  })

  it('reserves from a dedicated analysis bucket and exposes the remainder in headers', async () => {
    const auth = authContext(200)
    await reserveAnalysisQuota(auth)

    expect(auth.quota.analysis).toMatchObject({ limit: 200, remaining: 197 })
    const headers = patentApiRateHeaders(auth)
    expect(headers.get('X-RateLimit-Analysis-Limit')).toBe('200')
    expect(headers.get('X-RateLimit-Analysis-Remaining')).toBe('197')
    // The generic request budget is untouched by an analysis reservation.
    expect(headers.get('X-RateLimit-Daily-Remaining')).toBe('1999')
  })

  it('returns a retryable 429 once the daily analysis budget is spent', async () => {
    mocks.queryRaw.mockResolvedValueOnce([])
    await expect(reserveAnalysisQuota(authContext(200))).rejects.toSatisfy((error: unknown) => (
      error instanceof PatentApiError && error.code === 'ANALYSIS_QUOTA_EXCEEDED' && error.status === 429 && Number(error.retryAfter) > 0
    ))
  })
})
