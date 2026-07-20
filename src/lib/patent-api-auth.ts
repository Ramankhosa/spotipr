import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const API_KEY_PREFIX = 'pn_live_'

export type PatentApiQuotaSnapshot = {
  minute: { limit: number; remaining: number; resetAt: Date }
  day: { limit: number; remaining: number; resetAt: Date }
  month: { limit: number; remaining: number; resetAt: Date }
  analysis?: { limit: number; remaining: number; resetAt: Date }
}

export type PatentApiAuthContext = {
  client: {
    id: string
    name: string
    slug: string
    status: string
    rateLimitPerMinute: number
    dailyRequestLimit: number
    monthlyRequestLimit: number
    dailyAnalysisLimit: number
  }
  apiKey: {
    id: string
    name: string
    keyPrefix: string
  }
  quota: PatentApiQuotaSnapshot
}

export class PatentApiError extends Error {
  code: string
  status: number
  retryAfter?: number
  auth?: PatentApiAuthContext

  constructor(code: string, message: string, status: number, options: { retryAfter?: number; auth?: PatentApiAuthContext } = {}) {
    super(message)
    this.name = 'PatentApiError'
    this.code = code
    this.status = status
    this.retryAfter = options.retryAfter
    this.auth = options.auth
  }
}

export function hashPatentApiKey(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function createPatentApiKeySecret() {
  const secret = `${API_KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
  return {
    secret,
    keyHash: hashPatentApiKey(secret),
    keyPrefix: secret.slice(0, API_KEY_PREFIX.length + 8),
    keyLastFour: secret.slice(-4),
  }
}

export function patentApiRequestId(request: NextRequest) {
  const supplied = request.headers.get('x-request-id')?.trim()
  if (supplied && /^[A-Za-z0-9._:-]{1,100}$/.test(supplied)) return supplied
  return crypto.randomUUID()
}

export function patentApiQueryHash(query: string) {
  return crypto.createHash('sha256').update(query.trim()).digest('hex')
}

function bearerToken(request: NextRequest) {
  const header = request.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

function utcStarts(now: Date) {
  const minute = new Date(now)
  minute.setUTCSeconds(0, 0)
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const nextMinute = new Date(minute.getTime() + 60_000)
  const nextDay = new Date(day.getTime() + 86_400_000)
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { minute, day, month, nextMinute, nextDay, nextMonth }
}

/**
 * `periodStart` is a `timestamp without time zone` holding naive UTC, which is
 * the convention Prisma's typed API reads and writes. Handing the driver a JS
 * Date here would instead serialize it in the server's local zone and Postgres
 * would store that wall-clock time, so the bucket a request increments would
 * never match the one an admin query reads. Passing an explicit naive-UTC
 * literal keeps both paths on the same instant regardless of server timezone.
 */
function naiveUtcLiteral(value: Date) {
  return value.toISOString().replace('Z', '')
}

async function incrementBucket(
  tx: Prisma.TransactionClient,
  clientId: string,
  periodType: 'MINUTE' | 'DAY' | 'MONTH' | 'ANALYSIS_DAY',
  periodStart: Date,
  limit: number
) {
  if (limit <= 0) return null
  const rows = await tx.$queryRaw<Array<{ requestCount: number }>>(Prisma.sql`
    INSERT INTO "patent_api_usage_buckets"
      ("id", "clientId", "periodType", "periodStart", "requestCount", "createdAt", "updatedAt")
    VALUES
      (${crypto.randomUUID()}, ${clientId}, ${periodType}::"PatentApiUsagePeriod", ${naiveUtcLiteral(periodStart)}::timestamp(3), 1, timezone('UTC', now()), timezone('UTC', now()))
    ON CONFLICT ("clientId", "periodType", "periodStart")
    DO UPDATE SET
      "requestCount" = "patent_api_usage_buckets"."requestCount" + 1,
      "updatedAt" = timezone('UTC', now())
    WHERE "patent_api_usage_buckets"."requestCount" < ${limit}
    RETURNING "requestCount"
  `)
  return rows[0]?.requestCount ?? null
}

/**
 * Best-effort read of the client's current bucket counts without incrementing,
 * so quota-rejection responses can report truthful remaining values for the
 * buckets that did NOT trip.
 */
async function currentQuotaSnapshot(client: PatentApiAuthContext['client'], now = new Date()): Promise<PatentApiQuotaSnapshot> {
  const starts = utcStarts(now)
  let counts = { minute: 0, day: 0, month: 0 }
  try {
    const buckets = await prisma.patentApiUsageBucket.findMany({
      where: {
        clientId: client.id,
        OR: [
          { periodType: 'MINUTE', periodStart: starts.minute },
          { periodType: 'DAY', periodStart: starts.day },
          { periodType: 'MONTH', periodStart: starts.month },
        ],
      },
      select: { periodType: true, requestCount: true },
    })
    counts = {
      minute: buckets.find(row => row.periodType === 'MINUTE')?.requestCount || 0,
      day: buckets.find(row => row.periodType === 'DAY')?.requestCount || 0,
      month: buckets.find(row => row.periodType === 'MONTH')?.requestCount || 0,
    }
  } catch (error) {
    console.warn('[PatentPublicAPI] Could not read current quota buckets:', error)
  }
  return {
    minute: { limit: client.rateLimitPerMinute, remaining: Math.max(0, client.rateLimitPerMinute - counts.minute), resetAt: starts.nextMinute },
    day: { limit: client.dailyRequestLimit, remaining: Math.max(0, client.dailyRequestLimit - counts.day), resetAt: starts.nextDay },
    month: { limit: client.monthlyRequestLimit, remaining: Math.max(0, client.monthlyRequestLimit - counts.month), resetAt: starts.nextMonth },
  }
}

async function reserveQuota(client: PatentApiAuthContext['client']) {
  const now = new Date()
  const starts = utcStarts(now)
  try {
    const counts = await prisma.$transaction(async tx => {
      const minute = await incrementBucket(tx, client.id, 'MINUTE', starts.minute, client.rateLimitPerMinute)
      if (minute === null) throw new PatentApiError('RATE_LIMIT_EXCEEDED', 'Per-minute request limit exceeded.', 429)
      const day = await incrementBucket(tx, client.id, 'DAY', starts.day, client.dailyRequestLimit)
      if (day === null) throw new PatentApiError('DAILY_QUOTA_EXCEEDED', 'Daily request quota exceeded.', 429)
      const month = await incrementBucket(tx, client.id, 'MONTH', starts.month, client.monthlyRequestLimit)
      if (month === null) throw new PatentApiError('MONTHLY_QUOTA_EXCEEDED', 'Monthly request quota exceeded.', 429)
      return { minute, day, month }
    })
    return {
      minute: { limit: client.rateLimitPerMinute, remaining: Math.max(0, client.rateLimitPerMinute - counts.minute), resetAt: starts.nextMinute },
      day: { limit: client.dailyRequestLimit, remaining: Math.max(0, client.dailyRequestLimit - counts.day), resetAt: starts.nextDay },
      month: { limit: client.monthlyRequestLimit, remaining: Math.max(0, client.monthlyRequestLimit - counts.month), resetAt: starts.nextMonth },
    } satisfies PatentApiQuotaSnapshot
  } catch (error) {
    if (error instanceof PatentApiError) {
      const resetAt = error.code === 'RATE_LIMIT_EXCEEDED'
        ? starts.nextMinute
        : error.code === 'DAILY_QUOTA_EXCEEDED'
          ? starts.nextDay
          : starts.nextMonth
      error.retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000))
    }
    throw error
  }
}

function maskedToken(token: string) {
  return token ? `${token.slice(0, API_KEY_PREFIX.length + 4)}…${token.slice(-2)}` : '(empty)'
}

function requestIp(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.headers.get('x-real-ip') || 'unknown'
}

export async function authenticatePatentApiRequest(request: NextRequest): Promise<PatentApiAuthContext> {
  const token = bearerToken(request)
  if (!token || !token.startsWith(API_KEY_PREFIX)) {
    console.warn(`[PatentPublicAPI] Rejected request without a usable API key (ip=${requestIp(request)})`)
    throw new PatentApiError('INVALID_API_KEY', 'A valid API key is required.', 401)
  }

  const key = await prisma.patentApiKey.findUnique({
    where: { keyHash: hashPatentApiKey(token) },
    include: { client: true },
  })
  if (!key || key.status !== 'ACTIVE') {
    console.warn(`[PatentPublicAPI] Rejected ${key ? 'revoked' : 'unknown'} API key ${maskedToken(token)} (ip=${requestIp(request)})`)
    throw new PatentApiError('INVALID_API_KEY', 'The API key is invalid or revoked.', 401)
  }
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    console.warn(`[PatentPublicAPI] Rejected expired API key ${key.keyPrefix}… (ip=${requestIp(request)})`)
    throw new PatentApiError('API_KEY_EXPIRED', 'The API key has expired.', 401)
  }
  if (key.client.status !== 'ACTIVE') {
    throw new PatentApiError('CLIENT_SUSPENDED', 'The API client is suspended.', 403)
  }

  const client = {
    id: key.client.id,
    name: key.client.name,
    slug: key.client.slug,
    status: key.client.status,
    rateLimitPerMinute: key.client.rateLimitPerMinute,
    dailyRequestLimit: key.client.dailyRequestLimit,
    monthlyRequestLimit: key.client.monthlyRequestLimit,
    dailyAnalysisLimit: key.client.dailyAnalysisLimit,
  }
  let quota: PatentApiQuotaSnapshot
  try {
    quota = await reserveQuota(client)
  } catch (error) {
    if (error instanceof PatentApiError) {
      error.auth = {
        client,
        apiKey: { id: key.id, name: key.name, keyPrefix: key.keyPrefix },
        quota: await currentQuotaSnapshot(client),
      }
    }
    throw error
  }

  await prisma.patentApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(error => console.warn('[PatentPublicAPI] Could not update key last-used timestamp:', error))
  return {
    client,
    apiKey: { id: key.id, name: key.name, keyPrefix: key.keyPrefix },
    quota,
  }
}

/**
 * LLM-backed analysis endpoints reserve from a dedicated per-client daily
 * bucket on top of the generic request quota: analysis calls carry real model
 * cost, so a client's cheap search traffic must not be able to spend them, and
 * a limit of 0 turns analysis off for that client entirely.
 */
export async function reserveAnalysisQuota(auth: PatentApiAuthContext): Promise<void> {
  const limit = auth.client.dailyAnalysisLimit
  if (limit <= 0) {
    throw new PatentApiError('ANALYSIS_NOT_ENABLED', 'AI analysis endpoints are not enabled for this API client.', 403, { auth })
  }
  const now = new Date()
  const starts = utcStarts(now)
  const count = await incrementBucket(prisma, auth.client.id, 'ANALYSIS_DAY', starts.day, limit)
  if (count === null) {
    const retryAfter = Math.max(1, Math.ceil((starts.nextDay.getTime() - now.getTime()) / 1000))
    auth.quota.analysis = { limit, remaining: 0, resetAt: starts.nextDay }
    throw new PatentApiError('ANALYSIS_QUOTA_EXCEEDED', 'Daily AI analysis quota exceeded.', 429, { retryAfter, auth })
  }
  auth.quota.analysis = { limit, remaining: Math.max(0, limit - count), resetAt: starts.nextDay }
}

export function patentApiRateHeaders(auth?: PatentApiAuthContext) {
  const headers = new Headers()
  if (!auth) return headers
  headers.set('RateLimit-Limit', String(auth.quota.minute.limit))
  headers.set('RateLimit-Remaining', String(auth.quota.minute.remaining))
  headers.set('RateLimit-Reset', String(Math.ceil(auth.quota.minute.resetAt.getTime() / 1000)))
  headers.set('X-RateLimit-Daily-Remaining', String(auth.quota.day.remaining))
  headers.set('X-RateLimit-Monthly-Remaining', String(auth.quota.month.remaining))
  if (auth.quota.analysis) {
    headers.set('X-RateLimit-Analysis-Limit', String(auth.quota.analysis.limit))
    headers.set('X-RateLimit-Analysis-Remaining', String(auth.quota.analysis.remaining))
  }
  return headers
}

export async function recordPatentApiRequest(input: {
  auth: PatentApiAuthContext
  request: NextRequest
  requestId: string
  endpoint: string
  statusCode: number
  durationMs: number
  resultCount?: number
  queryHash?: string
  errorCode?: string
}) {
  const forwarded = input.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ipAddress = forwarded || input.request.headers.get('x-real-ip') || null
  await prisma.patentApiRequestLog.create({
    data: {
      clientId: input.auth.client.id,
      apiKeyId: input.auth.apiKey.id,
      requestId: input.requestId,
      endpoint: input.endpoint,
      method: input.request.method,
      statusCode: input.statusCode,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      resultCount: input.resultCount,
      queryHash: input.queryHash,
      ipAddress,
      errorCode: input.errorCode,
    },
  })
}
