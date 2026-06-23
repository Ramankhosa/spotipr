import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { cancelPatentDraftingJob } from '@/lib/patent-drafting-job-service'

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

  const result = await cancelPatentDraftingJob(params.jobId, auth.user.id, params.patentId)
  if (result.outcome === 'not_found') {
    return NextResponse.json({ error: 'Patent drafting job not found.' }, { status: 404 })
  }
  if (result.outcome === 'not_cancellable') {
    return NextResponse.json(
      { error: `A ${String(result.status).toLowerCase()} drafting job cannot be cancelled.` },
      { status: 409 }
    )
  }
  return NextResponse.json({ success: true, jobId: result.jobId, status: result.status })
}
