import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { hashToken } from '@/lib/token-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const tokenHash = hashToken(params.token)
    const accessLink = await (prisma as any).documentAccessLink.findFirst({
      where: {
        tokenHash,
        userId: auth.user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      include: {
        document: true,
        request: {
          include: {
            events: { orderBy: { createdAt: 'asc' } }
          }
        }
      }
    })

    if (!accessLink) {
      return NextResponse.json({ error: 'Download link is invalid or expired.' }, { status: 404 })
    }

    const documents = accessLink.requestId
      ? await prisma.document.findMany({
          where: {
            userId: auth.user.id,
            type: 'PATENT_DRAFT_EXPORT',
            contentPtr: { contains: accessLink.requestId }
          },
          orderBy: { createdAt: 'asc' }
        })
      : accessLink.document
        ? [accessLink.document]
        : []

    return NextResponse.json({
      request: accessLink.request,
      documents: documents.map((document: any) => ({
        id: document.id,
        filename: document.filename,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        downloadUrl: `/api/email-drafting/download/${params.token}/artifact/${document.id}`
      }))
    })
  } catch (error) {
    console.error('[EmailDraftingDownload] Failed to fetch download metadata:', error)
    return NextResponse.json({ error: 'Failed to fetch download metadata.' }, { status: 500 })
  }
}
