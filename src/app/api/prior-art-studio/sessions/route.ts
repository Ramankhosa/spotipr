import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { emptyStudioPlan } from '@/lib/prior-art-studio/types'
import { appendTrail } from '@/lib/prior-art-studio/service'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }
  const sessions = await prisma.priorArtStudioSession.findMany({
    where: { userId: auth.user.id, status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      planVersion: true,
      updatedAt: true,
      createdAt: true,
      _count: { select: { runs: true, docStates: true } },
    },
  })
  return NextResponse.json({ sessions })
}

export async function POST(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }
  const body = await request.json().catch(() => ({}))
  const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 160) : 'Untitled search'
  const seedText = typeof body?.seedText === 'string' ? body.seedText.slice(0, 60000) : null

  const plan = emptyStudioPlan()
  plan.title = title === 'Untitled search' ? '' : title

  const session = await prisma.priorArtStudioSession.create({
    data: {
      userId: auth.user.id,
      tenantId: auth.user.tenantId || null,
      title,
      seedText,
      plan: plan as unknown as Prisma.InputJsonValue,
    },
  })
  await appendTrail(session.id, 'SYSTEM', `user:${auth.user.id}`, 'Session created')
  return NextResponse.json({ session })
}
