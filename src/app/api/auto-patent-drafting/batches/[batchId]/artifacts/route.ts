import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { getAutoPatentDraftBatchArtifactsForUser } from '@/lib/auto-patent-draft-batch-service'

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

    const data = await getAutoPatentDraftBatchArtifactsForUser(params.batchId, auth.user.id)
    if (!data) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
    return NextResponse.json(data)
  } catch (error) {
    console.error('[AutoPatentDraftBatchArtifacts] Failed to list artifacts:', error)
    return NextResponse.json({ error: 'Failed to list batch artifacts.' }, { status: 500 })
  }
}
