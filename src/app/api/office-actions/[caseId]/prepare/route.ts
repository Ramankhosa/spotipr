import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceOfficeActionAccess } from '@/lib/office-action/route-guards'
import { prisma } from '@/lib/prisma'
import { kickOfficeActionJobsInline } from '@/lib/office-action-job-service'

export const maxDuration = 60

/**
 * POST /api/office-actions/:caseId/prepare
 * Enqueues the reply pipeline as a background OfficeActionJob and returns
 * immediately — a real FER runs ~3 LLM calls per objection, far beyond any
 * request timeout. The client polls GET for progress. If a prepare job is
 * already running for this case, it is returned instead of starting a second
 * (double-clicks must not double the LLM spend).
 * Body (optional): { objectionIds?: string[] } to prepare a subset.
 */
export async function POST(request: NextRequest, { params }: { params: { caseId: string } }) {
  const auth = await authenticateUser(request)
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })

  const owner = await prisma.officeActionCase.findUnique({
    where: { id: params.caseId }, select: { userId: true }
  })
  if (!owner) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  if (owner.userId !== auth.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const access = await enforceOfficeActionAccess(auth.user)
  if (!access.allowed) return access.response

  let body: any = {}
  try { body = await request.json() } catch { /* optional */ }

  const ACTIVE = {
    caseId: params.caseId,
    jobType: 'PREPARE_REPLY' as const,
    status: { in: ['QUEUED' as const, 'PROCESSING' as const] }
  }

  /**
   * Pause: flag the running job. The worker checks the flag between objections
   * and stops there, leaving the draft resumable — this is what lets the
   * attorney break off to upload a cited prior-art document and continue with
   * that document in play for the objections not yet drafted.
   */
  if (body.action === 'pause') {
    const active = await prisma.officeActionJob.findFirst({ where: ACTIVE, orderBy: { createdAt: 'desc' } })
    if (!active) return NextResponse.json({ error: 'Nothing is running to pause.' }, { status: 409 })
    await prisma.officeActionJob.update({
      where: { id: active.id },
      data: { cancelRequested: true, currentStep: 'Pausing after the current objection…' }
    })
    return NextResponse.json({ jobId: active.id, status: active.status, pausing: true }, { status: 202 })
  }

  /**
   * Claim-or-create, atomically.
   *
   * The check and the create have to happen under one lock. As a plain findFirst
   * followed by a create, two simultaneous POSTs (a double-click) both saw no
   * active job and both enqueued. The worker's lease serialized them, but the
   * second run then found the first's finished draft, opened a new version and
   * re-bought every LLM call — precisely the "double-clicks must not double the
   * LLM spend" this route documents. A transaction-scoped advisory lock on the
   * case serializes the pair without a new DB constraint, and Postgres releases
   * it when the transaction ends, however it ends.
   */
  const { job, alreadyRunning } = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `oa-prepare:${params.caseId}`)

    const existing = await tx.officeActionJob.findFirst({ where: ACTIVE, orderBy: { createdAt: 'desc' } })
    if (existing) return { job: existing, alreadyRunning: true }

    const created = await tx.officeActionJob.create({
      data: {
        caseId: params.caseId,
        userId: auth.user.id,
        jobType: 'PREPARE_REPLY',
        status: 'QUEUED',
        payload: {
          tenantId: auth.user.tenantId || null,
          objectionIds: Array.isArray(body.objectionIds)
            ? body.objectionIds.map(String).slice(0, 500)
            : undefined,
          // 'resume' continues the latest draft and redrafts only its gaps;
          // anything else opens a fresh version.
          resume: body.action === 'resume'
        } as any
      }
    })
    return { job: created, alreadyRunning: false }
  })

  if (alreadyRunning) {
    return NextResponse.json({ jobId: job.id, status: job.status, alreadyRunning: true }, { status: 202 })
  }

  // Drain inline (detached) so the job runs even without the standalone worker.
  kickOfficeActionJobsInline('prepare')

  return NextResponse.json({ jobId: job.id, status: 'QUEUED' }, { status: 202 })
}

/**
 * GET /api/office-actions/:caseId/prepare — status of the latest prepare job.
 * The workspace polls this while the pipeline runs.
 */
export async function GET(request: NextRequest, { params }: { params: { caseId: string } }) {
  const auth = await authenticateUser(request)
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })

  const owner = await prisma.officeActionCase.findUnique({
    where: { id: params.caseId }, select: { userId: true }
  })
  if (!owner) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  if (owner.userId !== auth.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const job = await prisma.officeActionJob.findFirst({
    where: { caseId: params.caseId, jobType: 'PREPARE_REPLY' },
    orderBy: { createdAt: 'desc' }
  })
  if (!job) return NextResponse.json({ job: null })

  // A QUEUED job with no live drain (e.g. process restarted) gets re-kicked.
  if (job.status === 'QUEUED' || (job.status === 'PROCESSING' && job.lockedUntil && job.lockedUntil < new Date())) {
    kickOfficeActionJobsInline('prepare-poll')
  }

  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      currentStep: job.currentStep,
      lastError: job.lastError,
      result: job.result,
      createdAt: job.createdAt,
      completedAt: job.completedAt
    }
  })
}
