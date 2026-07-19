import { prisma } from './prisma'
import { resolveCaseCitations, type ResolverDeps } from './office-action/citation-resolver'

/**
 * Office Action Studio — background job worker service
 *
 * Drains the OfficeActionJob queue (currently: RESOLVE_CITATIONS, enqueued at
 * FER ingest so cited documents are fetched before the attorney needs them).
 * Same DB-lease pattern as the novelty/drafting workers: atomic claim via a
 * guarded updateMany, a heartbeat that renews the lease, and retry backoff.
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

/** Dispatch a single claimed job by type. */
export async function processOfficeActionJob(job: any, workerId: string, opts: ProcessOpts = {}): Promise<any> {
  switch (job.jobType) {
    case 'RESOLVE_CITATIONS': {
      const counts = await withHeartbeat(job.id, workerId, () =>
        resolveCaseCitations(job.caseId, opts.resolverDeps))
      return counts
    }
    default:
      throw new Error(`Unknown office action job type: ${job.jobType}`)
  }
}

/** Claim + process up to `batch` jobs; returns the ids processed. */
export async function processPendingOfficeActionJobs(workerId: string, batch = 1, opts: ProcessOpts = {}): Promise<string[]> {
  const done: string[] = []
  for (let i = 0; i < batch; i++) {
    const job = await claimNextOfficeActionJob(workerId)
    if (!job) break
    try {
      const result = await processOfficeActionJob(job, workerId, opts)
      await (prisma as any).officeActionJob.updateMany({
        where: { id: job.id, lockedBy: workerId },
        data: { status: 'COMPLETED', result, completedAt: new Date(), lockedBy: null, lockedUntil: null, currentStep: null }
      })
      done.push(job.id)
    } catch (err) {
      if (err instanceof OaJobLeaseLostError) continue  // another worker took it
      const attempt = (job.attemptCount || 0) + 1
      const maxAttempts = job.maxAttempts || 3
      const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]
      await (prisma as any).officeActionJob.updateMany({
        where: { id: job.id, lockedBy: workerId },
        data: attempt >= maxAttempts
          ? { status: 'FAILED', attemptCount: attempt, lastError: String(err instanceof Error ? err.message : err), lockedBy: null, lockedUntil: null }
          : { status: 'QUEUED', attemptCount: attempt, nextAttemptAt: new Date(Date.now() + backoff), lastError: String(err instanceof Error ? err.message : err), lockedBy: null, lockedUntil: null }
      })
    }
  }
  return done
}
