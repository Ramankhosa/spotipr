import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { enqueuePatentDraftingJob, type PatentDraftingAutomationPayload } from '@/lib/patent-drafting-job-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authError(error: { message: string; status: number } | null) {
  return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 })
}

export async function GET(request: NextRequest, { params }: { params: { patentId: string } }) {
  const auth = await authenticateUser(request)
  if (auth.error || !auth.user) return authError(auth.error)

  const patent = await prisma.patent.findFirst({
    where: {
      id: params.patentId,
      OR: [
        { createdBy: auth.user.id },
        { project: { OR: [{ userId: auth.user.id }, { collaborators: { some: { userId: auth.user.id } } }] } },
      ],
    },
    select: { id: true },
  })
  if (!patent) return NextResponse.json({ error: 'Patent not found or access denied' }, { status: 404 })

  const jobs = await (prisma as any).patentDraftingJob.findMany({
    where: { patentId: params.patentId, userId: auth.user.id },
    orderBy: { createdAt: 'desc' },
    take: 25,
  })

  return NextResponse.json({ jobs })
}

export async function POST(request: NextRequest, { params }: { params: { patentId: string } }) {
  const auth = await authenticateUser(request)
  if (auth.error || !auth.user) return authError(auth.error)

  let payload: PatentDraftingAutomationPayload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON body is required' }, { status: 400 })
  }

  try {
    const job = await enqueuePatentDraftingJob({
      patentId: params.patentId,
      userId: auth.user.id,
      payload,
    })

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.status,
      currentStep: job.currentStep,
    }, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to queue automated patent drafting'
    const status = /access|not found/i.test(message) ? 404 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
