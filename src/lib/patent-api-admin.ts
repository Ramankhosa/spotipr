import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { createPatentApiKeySecret } from '@/lib/patent-api-auth'
import { getPatentApiReadiness } from '@/lib/patent-public-api'

const DEFAULT_LIMITS = {
  rateLimitPerMinute: 30,
  dailyRequestLimit: 2000,
  monthlyRequestLimit: 50000,
  dailyAnalysisLimit: 200,
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function positiveInteger(value: unknown, fallback: number, max: number) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new Error(`Limit must be an integer between 1 and ${max}.`)
  return parsed
}

/** Analysis limits accept 0, which switches AI analysis off for the client. */
function nonNegativeInteger(value: unknown, fallback: number, max: number) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) throw new Error(`Limit must be an integer between 0 and ${max}.`)
  return parsed
}

function baseSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'api-client'
}

async function availableSlug(name: string) {
  const base = baseSlug(name)
  let slug = base
  let suffix = 2
  while (await prisma.patentApiClient.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${base.slice(0, 55)}-${suffix}`
    suffix += 1
  }
  return slug
}

function utcStarts(now = new Date()) {
  const minute = new Date(now); minute.setUTCSeconds(0, 0)
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return { minute, day, month }
}

async function audit(
  actorUserId: string,
  action: string,
  resource: string,
  meta: Prisma.InputJsonObject,
  db: Pick<Prisma.TransactionClient, 'auditLog'> = prisma
) {
  await db.auditLog.create({ data: { actorUserId, action, resource, meta } })
}

export async function listPatentApiClients() {
  const clients = await prisma.patentApiClient.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      keys: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, keyPrefix: true, keyLastFour: true, status: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true },
      },
      requestLogs: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
    },
  })
  const starts = utcStarts()
  const buckets = clients.length ? await prisma.patentApiUsageBucket.findMany({
    where: {
      clientId: { in: clients.map(client => client.id) },
      OR: [
        { periodType: 'MINUTE', periodStart: starts.minute },
        { periodType: 'DAY', periodStart: starts.day },
        { periodType: 'MONTH', periodStart: starts.month },
        { periodType: 'ANALYSIS_DAY', periodStart: starts.day },
      ],
    },
  }) : []
  return clients.map(client => ({
    ...client,
    lastRequestAt: client.requestLogs[0]?.createdAt || null,
    requestLogs: undefined,
    usage: {
      minute: buckets.find(row => row.clientId === client.id && row.periodType === 'MINUTE')?.requestCount || 0,
      day: buckets.find(row => row.clientId === client.id && row.periodType === 'DAY')?.requestCount || 0,
      month: buckets.find(row => row.clientId === client.id && row.periodType === 'MONTH')?.requestCount || 0,
      analysisDay: buckets.find(row => row.clientId === client.id && row.periodType === 'ANALYSIS_DAY')?.requestCount || 0,
    },
  }))
}

export async function getPatentApiClient(id: string) {
  const client = await prisma.patentApiClient.findUnique({
    where: { id },
    include: {
      keys: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, keyPrefix: true, keyLastFour: true, status: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true },
      },
      requestLogs: {
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, requestId: true, endpoint: true, method: true, statusCode: true, durationMs: true, resultCount: true, errorCode: true, createdAt: true, apiKey: { select: { keyPrefix: true, keyLastFour: true } } },
      },
    },
  })
  if (!client) return null
  const starts = utcStarts()
  const buckets = await prisma.patentApiUsageBucket.findMany({ where: { clientId: id, periodStart: { gte: starts.month } } })
  return {
    ...client,
    usage: {
      minute: buckets.find(row => row.periodType === 'MINUTE' && row.periodStart.getTime() === starts.minute.getTime())?.requestCount || 0,
      day: buckets.find(row => row.periodType === 'DAY' && row.periodStart.getTime() === starts.day.getTime())?.requestCount || 0,
      month: buckets.find(row => row.periodType === 'MONTH' && row.periodStart.getTime() === starts.month.getTime())?.requestCount || 0,
      analysisDay: buckets.find(row => row.periodType === 'ANALYSIS_DAY' && row.periodStart.getTime() === starts.day.getTime())?.requestCount || 0,
    },
  }
}

export async function createPatentApiClient(body: any, actorUserId: string) {
  const name = cleanText(body?.name, 120)
  if (name.length < 2) throw new Error('Client name must contain at least two characters.')
  const slug = await availableSlug(name)
  const client = await prisma.$transaction(async tx => {
    const created = await tx.patentApiClient.create({
      data: {
        name,
        slug,
        description: cleanText(body?.description, 1000) || null,
        rateLimitPerMinute: positiveInteger(body?.rateLimitPerMinute, DEFAULT_LIMITS.rateLimitPerMinute, 10_000),
        dailyRequestLimit: positiveInteger(body?.dailyRequestLimit, DEFAULT_LIMITS.dailyRequestLimit, 10_000_000),
        monthlyRequestLimit: positiveInteger(body?.monthlyRequestLimit, DEFAULT_LIMITS.monthlyRequestLimit, 100_000_000),
        dailyAnalysisLimit: nonNegativeInteger(body?.dailyAnalysisLimit, DEFAULT_LIMITS.dailyAnalysisLimit, 1_000_000),
        createdByUserId: actorUserId,
      },
    })
    await audit(actorUserId, 'PATENT_API_CLIENT_CREATED', 'PatentApiClient', { clientId: created.id, name: created.name }, tx)
    return created
  })
  return client
}

export async function updatePatentApiClient(id: string, body: any, actorUserId: string) {
  const existing = await prisma.patentApiClient.findUnique({ where: { id } })
  if (!existing) return null
  const name = body?.name === undefined ? existing.name : cleanText(body.name, 120)
  if (name.length < 2) throw new Error('Client name must contain at least two characters.')
  const status = body?.status === undefined ? existing.status : String(body.status).toUpperCase()
  if (!['ACTIVE', 'SUSPENDED'].includes(status)) throw new Error('status must be ACTIVE or SUSPENDED.')
  const client = await prisma.$transaction(async tx => {
    const updated = await tx.patentApiClient.update({
      where: { id },
      data: {
        name,
        description: body?.description === undefined ? existing.description : (cleanText(body.description, 1000) || null),
        status: status as 'ACTIVE' | 'SUSPENDED',
        rateLimitPerMinute: positiveInteger(body?.rateLimitPerMinute, existing.rateLimitPerMinute, 10_000),
        dailyRequestLimit: positiveInteger(body?.dailyRequestLimit, existing.dailyRequestLimit, 10_000_000),
        monthlyRequestLimit: positiveInteger(body?.monthlyRequestLimit, existing.monthlyRequestLimit, 100_000_000),
        dailyAnalysisLimit: nonNegativeInteger(body?.dailyAnalysisLimit, existing.dailyAnalysisLimit, 1_000_000),
      },
    })
    await audit(actorUserId, 'PATENT_API_CLIENT_UPDATED', 'PatentApiClient', {
      clientId: id,
      status: updated.status,
      rateLimitPerMinute: updated.rateLimitPerMinute,
      dailyRequestLimit: updated.dailyRequestLimit,
      monthlyRequestLimit: updated.monthlyRequestLimit,
      dailyAnalysisLimit: updated.dailyAnalysisLimit,
    }, tx)
    return updated
  })
  return client
}

export async function issuePatentApiKey(clientId: string, body: any, actorUserId: string) {
  const client = await prisma.patentApiClient.findUnique({ where: { id: clientId }, select: { id: true } })
  if (!client) return null
  const name = cleanText(body?.name, 100)
  if (name.length < 2) throw new Error('Key name must contain at least two characters.')
  let expiresAt: Date | null = null
  if (body?.expiresAt) {
    expiresAt = new Date(body.expiresAt)
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new Error('expiresAt must be a future ISO date.')
  }
  const generated = createPatentApiKeySecret()
  const key = await prisma.$transaction(async tx => {
    const created = await tx.patentApiKey.create({
      data: {
        clientId,
        name,
        keyHash: generated.keyHash,
        keyPrefix: generated.keyPrefix,
        keyLastFour: generated.keyLastFour,
        expiresAt,
        createdByUserId: actorUserId,
      },
      select: { id: true, name: true, keyPrefix: true, keyLastFour: true, status: true, expiresAt: true, createdAt: true },
    })
    await audit(actorUserId, 'PATENT_API_KEY_ISSUED', 'PatentApiKey', { clientId, apiKeyId: created.id, keyPrefix: created.keyPrefix }, tx)
    return created
  })
  return { key, secret: generated.secret }
}

export async function revokePatentApiKey(clientId: string, keyId: string, actorUserId: string) {
  const key = await prisma.patentApiKey.findFirst({ where: { id: keyId, clientId } })
  if (!key) return null
  const updated = await prisma.$transaction(async tx => {
    const revoked = key.status === 'REVOKED' ? key : await tx.patentApiKey.update({
      where: { id: keyId },
      data: { status: 'REVOKED', revokedAt: new Date() },
    })
    await audit(actorUserId, 'PATENT_API_KEY_REVOKED', 'PatentApiKey', { clientId, apiKeyId: keyId, keyPrefix: key.keyPrefix }, tx)
    return revoked
  })
  return { id: updated.id, status: updated.status, revokedAt: updated.revokedAt }
}

export { getPatentApiReadiness }
