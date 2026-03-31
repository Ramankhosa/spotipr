import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const existing = await (prisma as any).emailDraftRequest.findFirst({
      where: { id: params.id, userId: auth.user.id }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    if (['DELIVERED', 'DELIVERED_WITH_WARNINGS', 'FAILED', 'REJECTED', 'CANCELED'].includes(existing.status)) {
      return NextResponse.json({ error: 'Request can no longer be canceled.' }, { status: 400 })
    }

    await (prisma as any).emailDraftRequest.update({
      where: { id: params.id },
      data: {
        status: 'CANCELED',
        currentStage: 'CANCELED',
        errorCode: 'USER_CANCELED',
        errorMessage: 'Canceled by user.',
        completedAt: new Date(),
        lockedBy: null,
        lockedUntil: null
      }
    })

    await (prisma as any).documentAccessLink.updateMany({
      where: { requestId: params.id, revokedAt: null },
      data: { revokedAt: new Date() }
    })

    await (prisma as any).emailDraftEvent.create({
      data: {
        requestId: params.id,
        stage: 'CANCELED',
        state: 'completed',
        message: 'Canceled by user.'
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[EmailDraftingCancel] Failed to cancel request:', error)
    return NextResponse.json({ error: 'Failed to cancel request.' }, { status: 500 })
  }
}
