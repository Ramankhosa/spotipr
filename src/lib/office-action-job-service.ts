import { prisma } from './prisma'
import { resolveCaseCitations, type ResolverDeps } from './office-action/citation-resolver'
import { notifyPrepareOutcome } from './office-action/oa-notifications'

/**
 * Office Action Studio — background job worker service
 *
 * Drains the OfficeActionJob queue (RESOLVE_CITATIONS enqueued at FER ingest;
 * PREPARE_REPLY enqueued when the attorney clicks "Prepare reply").
 * Same DB-lease pattern as the novelty/drafting workers: atomic claim via a
 * guarded updateMany, a heartbeat that renews the lease, and retry backoff.
 *
 * Jobs run EITHER on the standalone worker (`npm run oa:worker`) OR inline in
 * the web process via kickOfficeActionJobsInline() — the lease claim makes the
 * two safe to run side by side (whoever claims first wins).
 */

const LEASE_MS = Number(process.env.OA_JOB_LEASE_MS) || 5 * 60_000
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000]

function lockExpiry() { return new Date(Date.now() + LEASE_MS) }

class OaJobLeaseLostError extends Error {
  constructor() { super('Office action job lease lost'); this.name = 'OaJobLeaseLostError' }
}

async function heartbeat(jobId: string, workerId: string) {
  const updated = await (prisma as any).officeActionJob.updateMany({
    where: { id: jobId, status: 'PROCESSING', lockedBy: workerId },
    data: { heartbeatAt: new Date(), lockedUntil: lockExpiry() }
  })
  if (updated.count !== 1) throw new OaJobLeaseLostError()
}

async function withHeartbeat<T>(jobId: string, workerId: string, work: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => void heartbeat(jobId, workerId).catch(() => undefined), 60_000)
  try { return await work() } finally { clearInterval(timer) }
}

/** Atomically claim the next runnable job for this worker (guarded updateMany). */
export async function claimNextOfficeActionJob(workerId: string) {
  const now = new Date()
  const candidates = await (prisma as any).officeActionJob.findMany({
    where: {
      status: { in: ['QUEUED', 'PROCESSING'] },
      nextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }]
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: 10
  })
  for (const candidate of candidates) {
    const claimed = await (prisma as any).officeActionJob.updateMany({
      where: { id: candidate.id, status: { in: ['QUEUED', 'PROCESSING'] }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { status: 'PROCESSING', lockedBy: workerId, lockedUntil: lockExpiry(), heartbeatAt: now, startedAt: candidate.startedAt || now, lastError: null }
    })
    if (claimed.count === 1) {
      return (prisma as any).officeActionJob.findUnique({ where: { id: candidate.id } })
    }
  }
  return null
}

export interface ProcessOpts {
  /** Injected resolver fetchers (tests); production uses the default cascade. */
  resolverDeps?: ResolverDeps
}

/** Fresh internal JWT for the job's user — the metering gateway resolves the
 * tenant/plan from it exactly as it would for an interactive request. Nothing
 * sensitive is stored at rest (mirrors the drafting worker's pattern). */
async function buildJobRequestHeaders(userId: string): Promise<Record<string, string>> {
  const user = await (prisma as any).user.findUnique({
    where: { id: userId },
    include: { tenant: { select: { atiId: true } } }
  })
  if (!user) throw new Error(`Job user ${userId} not found`)
  const { generateJWT } = await import('./auth')
  const token = generateJWT({
    sub: user.id,
    email: user.email,
    tenant_id: user.tenantId,
    roles: user.roles,
    ati_id: user.tenant?.atiId || null,
    tenant_ati_id: user.tenant?.atiId || null,
    scope: user.tenant?.atiId === 'PLATFORM' ? 'platform' : 'tenant',
  } as any)
  return { authorization: `Bearer ${token}` }
}

async function setStep(jobId: string, step: string) {
  await (prisma as any).officeActionJob.updateMany({ where: { id: jobId }, data: { currentStep: step } }).catch(() => {})
}

/** Dispatch a single claimed job by type. */
export async function processOfficeActionJob(job: any, workerId: string, opts: ProcessOpts = {}): Promise<any> {
  switch (job.jobType) {
    case 'RESOLVE_CITATIONS': {
      const counts = await withHeartbeat(job.id, workerId, () =>
        resolveCaseCitations(job.caseId, opts.resolverDeps))
      return counts
    }
    case 'PREPARE_REPLY': {
      const payload = (job.payload || {}) as { tenantId?: string | null; objectionIds?: string[] }
      const requestHeaders = await buildJobRequestHeaders(job.userId)
      const { prepareReply } = await import('./office-action/reply-pipeline')
      return withHeartbeat(job.id, workerId, () =>
        prepareReply(job.caseId, {
          tenantId: payload.tenantId || undefined,
          userId: job.userId,
          requestHeaders,
          objectionIds: Array.isArray(payload.objectionIds) && payload.objectionIds.length ? payload.objectionIds : undefined,
          onProgress: (step) => setStep(job.id, step),
          // The attorney's pause is a flag on the row; the pipeline reads it at
          // each objection boundary and stops cleanly.
          shouldStop: async () => {
            const row = await (prisma as any).officeActionJob.findUnique({
              where: { id: job.id }, select: { cancelRequested: true }
            })
            return Boolean(row?.cancelRequested)
          }
        }))
    }
    default:
      throw new Error(`Unknown office action job type: ${job.jobType}`)
  }
}

/**
 * Inline fallback: process pending jobs in THIS web process, detached from the
 * calling request. On a pm2/VM deploy this makes the queue drain even when the
 * standalone worker is not running; when it IS running, the lease claim ensures
 * each job executes exactly once. Never throws.
 *
 * Only the web runtime drains inline. Standalone scripts (the worker itself,
 * tests that inject stub fetchers) must own their queue explicitly — otherwise a
 * detached drain with production deps races them. Force with OA_INLINE_JOBS.
 */
function inlineDrainEnabled(): boolean {
  if (process.env.OA_INLINE_JOBS === 'false') return false
  if (process.env.OA_INLINE_JOBS === 'true') return true
  return Boolean(process.env.NEXT_RUNTIME)   // set by Next.js in server bundles
}

let inlineDrainActive = false
export function kickOfficeActionJobsInline(reason = 'inline'): void {
  if (!inlineDrainEnabled()) return
  if (inlineDrainActive) return   // one detached drain loop at a time per process
  inlineDrainActive = true
  const workerId = `inline-${process.pid}-${reason}`
  void (async () => {
    try {
      // Keep draining until the queue is empty so chained jobs also run.
      for (let round = 0; round < 20; round++) {
        const processed = await processPendingOfficeActionJobs(workerId, 3)
        if (!processed.length) break
      }
    } catch (e) {
      console.warn('[OA jobs] inline drain failed:', e instanceof Error ? e.message : e)
    } finally {
      inlineDrainActive = false
    }
  })()
}

/** Claim + process up to `batch` jobs; returns the ids processed. */
export async function processPendingOfficeActionJobs(workerId: string, batch = 1, opts: ProcessOpts = {}): Promise<string[]> {
  const done: string[] = []
  for (let i = 0; i < batch; i++) {
    const job = await claimNextOfficeActionJob(workerId)
    if (!job) break
    try {
      const result = await processOfficeActionJob(job, workerId, opts)
      // A run the attorney paused is not a completed run: record it as
      // CANCELLED and clear the request, so pressing Resume starts cleanly.
      const paused = Boolean(result?.stopped)
      const written = await (prisma as any).officeActionJob.updateMany({
        where: { id: job.id, lockedBy: workerId },
        data: paused
          ? { status: 'CANCELLED', result, cancelledAt: new Date(), cancelRequested: false, lockedBy: null, lockedUntil: null, currentStep: null }
          : { status: 'COMPLETED', result, completedAt: new Date(), lockedBy: null, lockedUntil: null, currentStep: null }
      })
      done.push(job.id)
      // Only the worker that actually recorded the result mails it, so a lease
      // handover cannot send the attorney two notifications for one run.
      // A pause is deliberate — no mail for it.
      if (written.count === 1 && !paused && job.jobType === 'PREPARE_REPLY') {
        await notifyPrepareOutcome(job, {
          status: 'COMPLETED',
          objectionsDrafted: result?.objectionsDrafted,
          draftErrors: result?.draftErrors,
          judgmentFlags: Array.isArray(result?.judgmentFlags) ? result.judgmentFlags.length : 0
        })
      }
    } catch (err) {
      if (err instanceof OaJobLeaseLostError) continue  // another worker took it
      const attempt = (job.attemptCount || 0) + 1
      const maxAttempts = job.maxAttempts || 3
      const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]
      const message = String(err instanceof Error ? err.message : err)
      const givingUp = attempt >= maxAttempts
      const written = await (prisma as any).officeActionJob.updateMany({
        where: { id: job.id, lockedBy: workerId },
        data: givingUp
          ? { status: 'FAILED', attemptCount: attempt, lastError: message, lockedBy: null, lockedUntil: null }
          : { status: 'QUEUED', attemptCount: attempt, nextAttemptAt: new Date(Date.now() + backoff), lastError: message, lockedBy: null, lockedUntil: null }
      })
      // Mail only when the run is really over — a retry that will run again in a
      // minute is not something to wake the attorney for.
      if (written.count === 1 && givingUp && job.jobType === 'PREPARE_REPLY') {
        await notifyPrepareOutcome(job, { status: 'FAILED', error: message })
      }
    }
  }
  return done
}
