import fs from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { getAutoPatentDraftBatchForUser } from '@/lib/auto-patent-draft-batch-service'
import { prisma } from '@/lib/prisma'

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
    if (!batch.zipDocumentId) {
      return NextResponse.json({ error: 'Batch ZIP is not ready yet.' }, { status: 409 })
    }

    const document = await prisma.document.findFirst({
      where: {
        id: batch.zipDocumentId,
        userId: auth.user.id,
        type: 'PATENT_DRAFT_EXPORT'
      }
    })

    if (!document?.contentPtr) return NextResponse.json({ error: 'Batch ZIP artifact not found.' }, { status: 404 })

    const buffer = await fs.readFile(document.contentPtr)
    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        'Content-Type': document.mimeType || 'application/zip',
        'Content-Disposition': `attachment; filename="${document.filename}"`,
        'Cache-Control': 'private, no-store'
      }
    })
  } catch (error) {
    console.error('[AutoPatentDraftBatch] Failed to download batch:', error)
    return NextResponse.json({ error: 'Failed to download automated patent drafting batch.' }, { status: 500 })
  }
}
