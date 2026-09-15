import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type WhitespaceWorkerMode = 'inline' | 'standalone' | 'hybrid'

export function whitespaceWorkerMode(): WhitespaceWorkerMode {
  const configured = String(process.env.WHITESPACE_WORKER_MODE || '').trim().toLowerCase()
  if (configured === 'inline' || configured === 'standalone' || configured === 'hybrid') return configured
  // Long production Miner work must not be tied to a replaceable web process.
  return process.env.NODE_ENV === 'production' ? 'standalone' : 'inline'
}

export async function recordWhitespaceWorkerHeartbeat(workerId: string, status: 'ACTIVE' | 'STOPPED', details?: Record<string, unknown>) {
  await prisma.whitespaceWorkerHealth.upsert({
    where: { id: workerId },
    create: { id: workerId, status, details: details as Prisma.InputJsonValue | undefined },
    update: { status, heartbeatAt: new Date(), details: details as Prisma.InputJsonValue | undefined },
  })
}

export async function readWhitespaceWorkerHealth() {
  const [latest, queued, processing, failed] = await Promise.all([
    prisma.whitespaceWorkerHealth.findFirst({ where: { status: 'ACTIVE' }, orderBy: { heartbeatAt: 'desc' } }),
    prisma.whitespaceRun.count({ where: { status: 'QUEUED' } }),
    prisma.whitespaceRun.count({ where: { status: 'PROCESSING' } }),
    prisma.whitespaceRun.count({ where: { status: 'FAILED', completedAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } } }),
  ])
  const ageMs = latest ? Date.now() - latest.heartbeatAt.getTime() : null
  const mode = whitespaceWorkerMode()
  return {
    mode,
    healthy: mode === 'inline' || (ageMs !== null && ageMs < 60_000),
    lastHeartbeatAt: latest?.heartbeatAt ?? null,
    heartbeatAgeMs: ageMs,
    queue: { queued, processing, failedLast24Hours: failed },
  }
}
