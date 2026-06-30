import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { updateAutoPatentDraftBatchItemReview } from '@/lib/auto-patent-draft-batch-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { batchId: string; itemId: string } }
) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const body = await request.json().catch(() => ({}))
    const result = await updateAutoPatentDraftBatchItemReview(params.batchId, params.itemId, auth.user.id, {
      reviewStatus: body?.reviewStatus,
      attorneyNotes: body?.attorneyNotes,
    })
    if (result.outcome === 'not_found') return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
    if (result.outcome === 'item_not_found') return NextResponse.json({ error: 'Batch item not found.' }, { status: 404 })
    return NextResponse.json({ success: true, item: result.item })
  } catch (error) {
    console.error('[AutoPatentDraftBatchItem] Failed to update review metadata:', error)
    return NextResponse.json({ error: 'Failed to update batch item.' }, { status: 500 })
  }
}
