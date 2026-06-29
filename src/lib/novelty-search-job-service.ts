import { NoveltySearchStatus } from '@prisma/client'
import { generateJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkServiceAccess } from '@/lib/org-access-service'
import { getRawStage1SearchResults } from '@/lib/novelty-stage1-results'
import { NoveltySearchService } from '@/lib/novelty-search-service'
import { trackServiceUsage } from '@/lib/service-usage-tracker'
import { getVisibleNoveltyPatentCount, hasNoveltyRelevanceGate, noveltyCheckpointFor } from '@/lib/novelty-search-background-state'

const LOCK_MINUTES = Math.max(5, Number(process.env.NOVELTY_SEARCH_LOCK_MINUTES || 30))
const EMAIL_MAX_ATTEMPTS = 5
const noveltySearchService = new NoveltySearchService()

class NoveltySearchJobLeaseLostError extends Error {
  constructor() {
    super('Novelty search job was cancelled or its worker lease was lost')
    this.name = 'NoveltySearchJobLeaseLostError'
  }
}

function lockExpiry() {
  return new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
}

function retryDelay(attempt: number) {
  const delays = [60_000, 5 * 60_000, 15 * 60_000]
  return delays[Math.min(Math.max(0, attempt - 1), delays.length - 1)]
}

function buildInternalUserJwt(user: any) {
  return generateJWT({
    sub: user.id,
    email: user.email,
    tenant_id: user.tenantId,
    roles: user.roles,
    ati_id: user.tenant?.atiId || null,
    tenant_ati_id: user.tenant?.atiId || null,
    scope: user.tenant?.atiId === 'PLATFORM' ? 'platform' : 'tenant',
  })
}

function requestHeadersFor(user: any) {
  return { authorization: `Bearer ${buildInternalUserJwt(user)}` }
}

function hasDeepAnalysis(run: any) {
  const featureMap = run?.stage35Results?.feature_map
  const remarks = run?.stage4Results?.per_patent_remarks
  return Array.isArray(featureMap) && featureMap.length > 0 && Array.isArray(remarks) && remarks.length > 0
}

async function setStep(jobId: string, workerId: string, currentStep: string) {
  const updated = await (prisma as any).noveltySearchJob.updateMany({
    where: { id: jobId, status: 'PROCESSING', lockedBy: workerId },
    data: { currentStep, heartbeatAt: new Date(), lockedUntil: lockExpiry() },
  })
  if (updated.count !== 1) throw new NoveltySearchJobLeaseLostError()
}

async function heartbeat(jobId: string, workerId: string) {
  await (prisma as any).noveltySearchJob.updateMany({
    where: { id: jobId, status: 'PROCESSING', lockedBy: workerId },
    data: { heartbeatAt: new Date(), lockedUntil: lockExpiry() },
  })
}

async function ensureJobActive(jobId: string, workerId?: string) {
  const job = await (prisma as any).noveltySearchJob.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, lockedBy: true },
  })
  if (!job || job.status === 'CANCELLED') throw new NoveltySearchJobLeaseLostError()
  if (workerId && (job.status !== 'PROCESSING' || job.lockedBy !== workerId)) {
    throw new NoveltySearchJobLeaseLostError()
  }
  return job
}

async function withHeartbeat<T>(jobId: string, workerId: string, work: () => Promise<T>) {
  const timer = setInterval(() => void heartbeat(jobId, workerId).catch(() => undefined), 60_000)
  try {
    await ensureJobActive(jobId, workerId)
    const result = await work()
    await ensureJobActive(jobId, workerId)
    return result
  } finally {
    clearInterval(timer)
  }
}

export async function claimNextNoveltySearchJob(workerId: string) {
  const now = new Date()
  const candidates = await (prisma as any).noveltySearchJob.findMany({
    where: {
      status: { in: ['QUEUED', 'PROCESSING'] },
      nextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: 10,
  })

  for (const candidate of candidates) {
    const claimed = await (prisma as any).noveltySearchJob.updateMany({
      where: {
        id: candidate.id,
        status: { in: ['QUEUED', 'PROCESSING'] },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: {
        status: 'PROCESSING',
        lockedBy: workerId,
        lockedUntil: lockExpiry(),
        heartbeatAt: now,
        startedAt: candidate.startedAt || now,
        lastError: null,
      },
    })
    if (claimed.count === 1) {
      return (prisma as any).noveltySearchJob.findUnique({ where: { id: candidate.id }, include: { search: true } })
    }
  }
  return null
}

async function runPipeline(job: any, workerId: string) {
  const user = await prisma.user.findUnique({ where: { id: job.search.userId }, include: { tenant: true } })
  if (!user || !user.tenantId) throw new Error('Search owner or tenant is unavailable')

  const access = await checkServiceAccess(user.id, user.tenantId, 'NOVELTY_SEARCH')
  if (!access.allowed) throw new Error(access.reason || 'Novelty search access is no longer available')

  let run: any = await prisma.noveltySearchRun.findUnique({ where: { id: job.searchId } })
  if (!run) throw new Error('Novelty search not found')
  if (run.status === NoveltySearchStatus.COMPLETED) return run

  if (!run.stage0Results) {
    await setStep(job.id, workerId, 'STAGE_0')
    const result = await withHeartbeat(job.id, workerId, () => noveltySearchService.executeStage0(run.id, user.id, requestHeadersFor(user)))
    if (!result.success) throw new Error(result.error || 'Idea normalization failed')
    run = await prisma.noveltySearchRun.findUnique({ where: { id: run.id } })
  }

  if (!run.stage1Results) {
    await setStep(job.id, workerId, 'STAGE_1')
    const result = await withHeartbeat(job.id, workerId, () => noveltySearchService.executeStage1(run.id, user.id, requestHeadersFor(user)))
    if (!result.success) throw new Error(result.error || 'Patent retrieval failed')
    run = await prisma.noveltySearchRun.findUnique({ where: { id: run.id } })
  }

  if (getRawStage1SearchResults(run.stage1Results).length === 0) {
    await setStep(job.id, workerId, 'NO_MATCH_REPORT')
    const result = await noveltySearchService.completeNoMatchNoveltySearch(run.id, user.id)
    await ensureJobActive(job.id, workerId)
    if (!result.success) throw new Error(result.error || 'No-match report generation failed')
    return prisma.noveltySearchRun.findUnique({ where: { id: run.id } })
  }

  if (!hasNoveltyRelevanceGate(run.stage1Results)) {
    await setStep(job.id, workerId, 'STAGE_1_5')
    const result = await withHeartbeat(job.id, workerId, () => noveltySearchService.executeStage15(run.id, user.id, requestHeadersFor(user)))
    if (!result.success) throw new Error(result.error || 'Relevance screening failed')
    run = await prisma.noveltySearchRun.findUnique({ where: { id: run.id } })
  }

  if (getVisibleNoveltyPatentCount(run.stage1Results) === 0) {
    await setStep(job.id, workerId, 'NO_MATCH_REPORT')
    const result = await noveltySearchService.completeNoMatchNoveltySearch(run.id, user.id)
    await ensureJobActive(job.id, workerId)
    if (!result.success) throw new Error(result.error || 'No-match report generation failed')
    return prisma.noveltySearchRun.findUnique({ where: { id: run.id } })
  }

  if (!hasDeepAnalysis(run)) {
    await setStep(job.id, workerId, 'STAGE_3')
    const result = await withHeartbeat(job.id, workerId, () => noveltySearchService.executeStage3(run.id, user.id, requestHeadersFor(user)))
    if (!result.success) throw new Error(result.error || 'Deep feature analysis failed')
    run = await prisma.noveltySearchRun.findUnique({ where: { id: run.id } })
  }

  if (run.status !== NoveltySearchStatus.COMPLETED) {
    await setStep(job.id, workerId, 'STAGE_4')
    const result = await withHeartbeat(job.id, workerId, () => noveltySearchService.executeStage4(run.id, user.id, requestHeadersFor(user)))
    if (!result.success) throw new Error(result.error || 'Final report generation failed')
  }

  return prisma.noveltySearchRun.findUnique({ where: { id: run.id } })
}

async function recordCompletion(job: any, run: any) {
  const user = await prisma.user.findUnique({ where: { id: run.userId }, select: { tenantId: true } })
  if (!user?.tenantId) return

  if (!job.usageRecordedAt) {
    await trackServiceUsage({
      tenantId: user.tenantId,
      userId: run.userId,
      serviceType: 'NOVELTY_SEARCH',
      operationId: run.id,
      operationType: 'novelty_search_complete',
      isCompleted: true,
      metadata: { patentId: run.patentId, projectId: run.projectId, background: true },
    })

    await prisma.$transaction(async tx => {
      const updated = await (tx as any).noveltySearchJob.updateMany({
        where: { id: job.id, usageRecordedAt: null },
        data: { usageRecordedAt: new Date() },
      })
      if (updated.count === 1) {
        await tx.user.update({ where: { id: run.userId }, data: { noveltySearchesCompleted: { increment: 1 } } })
      }
    })
  }
}

async function deliverCompletionEmail(jobId: string) {
  const emailLock = `novelty-email-${process.pid}-${Math.random().toString(36).slice(2)}`
  const now = new Date()
  const claimed = await (prisma as any).noveltySearchJob.updateMany({
    where: {
      id: jobId,
      status: 'COMPLETED',
      completionEmailSentAt: null,
      emailAttemptCount: { lt: EMAIL_MAX_ATTEMPTS },
      emailNextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: { lockedBy: emailLock, lockedUntil: lockExpiry(), heartbeatAt: now },
  })
  if (claimed.count !== 1) return
  const job = await (prisma as any).noveltySearchJob.findUnique({ where: { id: jobId }, include: { search: true } })
  if (!job) return

  const result = await noveltySearchService.sendNoveltyCompletionEmail(job.search, job.search.userId)
  if (result) {
    const stage4 = (job.search.stage4Results || {}) as any
    await prisma.$transaction([
      (prisma as any).noveltySearchJob.update({
        where: { id: job.id },
        data: { completionEmailSentAt: new Date(result.sentAt), lockedBy: null, lockedUntil: null },
      }),
      prisma.noveltySearchRun.update({
        where: { id: job.searchId },
        data: {
          stage4Results: {
            ...stage4,
            notification: {
              ...(stage4.notification || {}),
              completionEmailSentAt: result.sentAt,
              completionEmailReportUrl: result.reportUrl,
            },
          } as any,
        },
      }),
    ])
    return
  }

  const attempt = job.emailAttemptCount + 1
  await (prisma as any).noveltySearchJob.update({
    where: { id: job.id },
    data: {
      emailAttemptCount: attempt,
      emailNextAttemptAt: new Date(Date.now() + retryDelay(attempt)),
      lockedBy: null,
      lockedUntil: null,
    },
  })
}

export async function processNoveltySearchJob(job: any, workerId: string) {
  try {
    const run = await runPipeline(job, workerId)
    if (!run || run.status !== NoveltySearchStatus.COMPLETED) throw new Error('Pipeline ended without a completed report')

    const completed = await (prisma as any).noveltySearchJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', lockedBy: workerId },
      data: {
        status: 'COMPLETED',
        currentStep: 'COMPLETED',
        completedAt: new Date(),
        lockedBy: null,
        lockedUntil: null,
        heartbeatAt: new Date(),
        lastError: null,
      },
    })
    if (completed.count !== 1) return null
    const completedJob = await (prisma as any).noveltySearchJob.findUnique({ where: { id: job.id } })
    if (!completedJob) return null
    await recordCompletion(completedJob, run)
    await deliverCompletionEmail(completedJob.id)
    return completedJob
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Novelty search processing failed'
    const freshJob = await (prisma as any).noveltySearchJob.findUnique({ where: { id: job.id }, include: { search: true } })
    if (!freshJob) throw error
    if (freshJob.status === 'CANCELLED') return null
    if (freshJob.status !== 'PROCESSING' || freshJob.lockedBy !== workerId) return null
    const attempt = freshJob.attemptCount + 1
    const exhausted = attempt >= freshJob.maxAttempts
    const run = await prisma.noveltySearchRun.findUnique({ where: { id: freshJob.searchId } })

    if (run && !exhausted) {
      const checkpoint = noveltyCheckpointFor(run)
      await prisma.noveltySearchRun.update({ where: { id: run.id }, data: checkpoint as any })
    } else if (run) {
      await prisma.noveltySearchRun.update({ where: { id: run.id }, data: { status: NoveltySearchStatus.FAILED } })
    }

    await (prisma as any).noveltySearchJob.updateMany({
      where: { id: freshJob.id, status: 'PROCESSING', lockedBy: workerId },
      data: {
        status: exhausted ? 'FAILED' : 'QUEUED',
        attemptCount: attempt,
        nextAttemptAt: exhausted ? freshJob.nextAttemptAt : new Date(Date.now() + retryDelay(attempt)),
        lastError: message.slice(0, 2000),
        lockedBy: null,
        lockedUntil: null,
      },
    })
    return null
  }
}

export async function processPendingNoveltySearchJobs(workerId = `novelty-worker-${process.pid}`, limit = 1) {
  const processed: any[] = []
  for (let index = 0; index < Math.max(1, limit); index += 1) {
    const job = await claimNextNoveltySearchJob(workerId)
    if (!job) break
    processed.push(await processNoveltySearchJob(job, workerId))
  }
  return processed
}

export async function processPendingNoveltySearchEmails(limit = 2) {
  const jobs = await (prisma as any).noveltySearchJob.findMany({
    where: {
      status: 'COMPLETED',
      completionEmailSentAt: null,
      emailAttemptCount: { lt: EMAIL_MAX_ATTEMPTS },
      emailNextAttemptAt: { lte: new Date() },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
    },
    orderBy: { completedAt: 'asc' },
    take: Math.max(1, limit),
  })
  for (const job of jobs) await deliverCompletionEmail(job.id)
  return jobs.length
}

export async function requeueNoveltySearch(searchId: string, userId: string) {
  const job = await (prisma as any).noveltySearchJob.findFirst({ where: { searchId, search: { userId } }, include: { search: true } })
  if (!job || job.status !== 'FAILED') return null
  const checkpoint = noveltyCheckpointFor(job.search)
  await prisma.$transaction([
    prisma.noveltySearchRun.update({ where: { id: searchId }, data: checkpoint as any }),
    (prisma as any).noveltySearchJob.update({
      where: { id: job.id },
      data: {
        status: 'QUEUED', attemptCount: 0, nextAttemptAt: new Date(), lastError: null,
        lockedBy: null, lockedUntil: null, completedAt: null,
      },
    }),
  ])
  return { searchId, status: 'QUEUED' }
}

export async function cancelNoveltySearch(searchId: string, userId: string) {
  const job = await (prisma as any).noveltySearchJob.findFirst({
    where: { searchId, search: { userId } },
    include: { search: true },
  })
  if (!job) return { outcome: 'not_found' as const }
  if (job.status === 'CANCELLED') return { outcome: 'cancelled' as const, searchId, status: 'CANCELLED' as const }
  if (!['QUEUED', 'PROCESSING'].includes(job.status)) {
    return { outcome: 'not_cancellable' as const, status: job.status }
  }

  const cancelledAt = new Date()
  const existingStage4 = (job.search?.stage4Results || {}) as any
  const cancellationMetadata = {
    ...(existingStage4 && typeof existingStage4 === 'object' && !Array.isArray(existingStage4) ? existingStage4 : {}),
    cancellation: {
      cancelledAt: cancelledAt.toISOString(),
      cancelledById: userId,
      reason: 'USER_CANCELLED',
    },
  }
  const updated = await prisma.$transaction(async tx => {
    const jobUpdate = await (tx as any).noveltySearchJob.updateMany({
      where: { id: job.id, status: { in: ['QUEUED', 'PROCESSING'] } },
      data: {
        status: 'CANCELLED',
        currentStep: 'CANCELLED',
        cancelledAt,
        cancelledById: userId,
        lockedBy: null,
        lockedUntil: null,
        lastError: null,
      },
    })
    if (jobUpdate.count === 1) {
      await tx.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          status: NoveltySearchStatus.FAILED,
          reportUrl: null,
          stage4Results: cancellationMetadata as any,
        },
      })
    }
    return jobUpdate
  })
  if (updated.count === 1) return { outcome: 'cancelled' as const, searchId, status: 'CANCELLED' as const }

  const current = await (prisma as any).noveltySearchJob.findUnique({ where: { id: job.id }, select: { status: true } })
  return current?.status === 'CANCELLED'
    ? { outcome: 'cancelled' as const, searchId, status: 'CANCELLED' as const }
    : { outcome: 'not_cancellable' as const, status: current?.status || 'UNKNOWN' }
}
