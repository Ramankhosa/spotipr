import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { pauseAutoPatentDraftBatch } from '@/lib/auto-patent-draft-batch-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { batchId: string } }
) {
  const auth = await authenticateUser(request)
  if (auth.error || !auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }

  const result = await pauseAutoPatentDraftBatch(params.batchId, auth.user.id)
  if (result.outcome === 'not_found') return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
  if (result.outcome === 'not_pausable') {
    return NextResponse.json({ error: `A ${String(result.status).toLowerCase()} batch cannot be paused.` }, { status: 409 })
  }
  return NextResponse.json({ success: true, batchId: result.batchId, status: result.status })
}
