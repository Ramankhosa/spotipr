import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { requeuePatentDraftingJob } from '@/lib/patent-drafting-job-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { patentId: string; jobId: string } }
) {
  const auth = await authenticateUser(request)
  if (auth.error || !auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }

  const job = await requeuePatentDraftingJob(params.jobId, auth.user.id, params.patentId)
  if (!job) {
    return NextResponse.json({ error: 'Only failed background drafting jobs can be retried.' }, { status: 409 })
  }

  return NextResponse.json({
    success: true,
    jobId: job.id,
    status: job.status,
    currentStep: job.currentStep,
  })
}
