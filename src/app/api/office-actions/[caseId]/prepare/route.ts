import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
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

  if (auth.user.tenantId) {
    const access = await enforceServiceAccess(auth.user.id, auth.user.tenantId, 'OFFICE_ACTION_RESPONSE')
    if (!access.allowed) return access.response
  }

  let body: any = {}
  try { body = await request.json() } catch { /* optional */ }

  // Concurrency guard: one prepare per case at a time.
  const active = await prisma.officeActionJob.findFirst({
    where: { caseId: params.caseId, jobType: 'PREPARE_REPLY', status: { in: ['QUEUED', 'PROCESSING'] } },
    orderBy: { createdAt: 'desc' }
  })

  /**
   * Pause: flag the running job. The worker checks the flag between objections
   * and stops there, leaving the draft resumable — this is what lets the
   * attorney break off to upload a cited prior-art document and continue with
   * that document in play for the objections not yet drafted.
   */
  if (body.action === 'pause') {
    if (!active) return NextResponse.json({ error: 'Nothing is running to pause.' }, { status: 409 })
    await prisma.officeActionJob.update({
      where: { id: active.id },
      data: { cancelRequested: true, currentStep: 'Pausing after the current objection…' }
    })
    return NextResponse.json({ jobId: active.id, status: active.status, pausing: true }, { status: 202 })
  }

  if (active) {
    return NextResponse.json({ jobId: active.id, status: active.status, alreadyRunning: true }, { status: 202 })
  }

  const job = await prisma.officeActionJob.create({
    data: {
      caseId: params.caseId,
      userId: auth.user.id,
      jobType: 'PREPARE_REPLY',
      status: 'QUEUED',
      payload: {
        tenantId: auth.user.tenantId || null,
        objectionIds: Array.isArray(body.objectionIds) ? body.objectionIds : undefined,
        // 'resume' continues the latest draft and redrafts only its gaps;
        // anything else opens a fresh version.
        resume: body.action === 'resume'
      } as any
    }
  })

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
