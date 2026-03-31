import fs from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { hashToken } from '@/lib/token-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string; documentId: string } }
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
      include: { document: true }
    })

    if (!accessLink) {
      return NextResponse.json({ error: 'Artifact not found.' }, { status: 404 })
    }

    const document = accessLink.requestId
      ? await prisma.document.findFirst({
          where: {
            id: params.documentId,
            userId: auth.user.id,
            type: 'PATENT_DRAFT_EXPORT',
            contentPtr: { contains: accessLink.requestId }
          }
        })
      : accessLink.documentId === params.documentId
        ? accessLink.document
        : null

    if (!document?.contentPtr) {
      return NextResponse.json({ error: 'Artifact not found.' }, { status: 404 })
    }

    const fileBuffer = await fs.readFile(document.contentPtr)
    await (prisma as any).documentAccessLink.update({
      where: { id: accessLink.id },
      data: { lastAccessedAt: new Date() }
    })

    return new NextResponse(fileBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': document.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${document.filename}"`,
        'Cache-Control': 'private, no-store'
      }
    })
  } catch (error) {
    console.error('[EmailDraftingDownloadArtifact] Failed to stream artifact:', error)
    return NextResponse.json({ error: 'Failed to download artifact.' }, { status: 500 })
  }
}
