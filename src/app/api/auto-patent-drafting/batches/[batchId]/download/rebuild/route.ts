import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { rebuildAutoPatentDraftBatchZip } from '@/lib/auto-patent-draft-batch-service'

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

    const result = await rebuildAutoPatentDraftBatchZip(params.batchId, auth.user.id)
    if (result.outcome === 'not_found') return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
    if (result.outcome === 'no_artifacts') return NextResponse.json({ error: 'No completed artifacts are available to rebuild.' }, { status: 409 })
    return NextResponse.json({
      success: true,
      batchId: result.batchId,
      documentId: result.documentId,
      downloadUrl: `/api/auto-patent-drafting/batches/${params.batchId}/download`,
    })
  } catch (error) {
    console.error('[AutoPatentDraftBatchRebuild] Failed to rebuild ZIP:', error)
    return NextResponse.json({ error: 'Failed to rebuild batch ZIP.' }, { status: 500 })
  }
}
