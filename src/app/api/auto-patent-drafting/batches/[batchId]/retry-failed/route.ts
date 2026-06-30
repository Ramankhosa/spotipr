import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { retryFailedAutoPatentDraftBatchItems } from '@/lib/auto-patent-draft-batch-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { batchId: string } }
) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const result = await retryFailedAutoPatentDraftBatchItems(params.batchId, auth.user.id)
    if (result.outcome === 'not_found') return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
    if (result.outcome === 'none_retryable') return NextResponse.json({ error: 'No failed or cancelled items are retryable.' }, { status: 409 })
    return NextResponse.json({ success: true, batchId: result.batchId, retried: result.retried, status: result.status })
  } catch (error) {
    console.error('[AutoPatentDraftBatchRetryFailed] Failed to retry failed items:', error)
    return NextResponse.json({ error: 'Failed to retry failed batch items.' }, { status: 500 })
  }
}
