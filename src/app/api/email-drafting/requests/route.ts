import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const requests = await (prisma as any).emailDraftRequest.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        accessLinks: {
          where: { revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    })

    return NextResponse.json({ requests })
  } catch (error) {
    console.error('[EmailDraftingRequests] Failed to list requests:', error)
    return NextResponse.json({ error: 'Failed to fetch email drafting requests.' }, { status: 500 })
  }
}
