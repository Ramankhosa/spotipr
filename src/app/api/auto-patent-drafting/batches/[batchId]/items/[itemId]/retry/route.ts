import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { retryAutoPatentDraftBatchItem } from '@/lib/auto-patent-draft-batch-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { batchId: string; itemId: string } }
) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const result = await retryAutoPatentDraftBatchItem(params.batchId, params.itemId, auth.user.id)
    if (result.outcome === 'not_found') return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
    if (result.outcome === 'item_not_found') return NextResponse.json({ error: 'Batch item not found.' }, { status: 404 })
    if (result.outcome === 'not_retryable') return NextResponse.json({ error: `Item is not retryable from ${result.status}.` }, { status: 409 })
    return NextResponse.json({ success: true, batchId: result.batchId, itemId: result.itemId, status: result.status })
  } catch (error) {
    console.error('[AutoPatentDraftBatchItemRetry] Failed to retry item:', error)
    return NextResponse.json({ error: 'Failed to retry batch item.' }, { status: 500 })
  }
}
