import fs from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { getAutoPatentDraftBatchArtifactForUser } from '@/lib/auto-patent-draft-batch-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { batchId: string; documentId: string } }
) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const document = await getAutoPatentDraftBatchArtifactForUser(params.batchId, params.documentId, auth.user.id)
    if (!document?.contentPtr) return NextResponse.json({ error: 'Artifact not found.' }, { status: 404 })

    const buffer = await fs.readFile(document.contentPtr)
    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        'Content-Type': document.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${document.filename}"`,
        'Cache-Control': 'private, no-store',
      }
    })
  } catch (error) {
    console.error('[AutoPatentDraftBatchArtifact] Failed to download artifact:', error)
    return NextResponse.json({ error: 'Failed to download batch artifact.' }, { status: 500 })
  }
}
