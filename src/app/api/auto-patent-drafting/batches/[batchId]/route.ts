import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { getAutoPatentDraftBatchForUser } from '@/lib/auto-patent-draft-batch-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { batchId: string } }
) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const batch = await getAutoPatentDraftBatchForUser(params.batchId, auth.user.id)
    if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })

    return NextResponse.json({
      batch: {
        ...batch,
        downloadUrl: batch.zipDocumentId ? `/api/auto-patent-drafting/batches/${batch.id}/download` : null
      }
    })
  } catch (error) {
    console.error('[AutoPatentDraftBatch] Failed to fetch batch:', error)
    return NextResponse.json({ error: 'Failed to fetch automated patent drafting batch.' }, { status: 500 })
  }
}
