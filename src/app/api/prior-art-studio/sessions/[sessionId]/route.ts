import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { appendTrail, computeSaturation, getOwnedSession, summarizePlanEdit } from '@/lib/prior-art-studio/service'
import type { StudioPlan } from '@/lib/prior-art-studio/types'
import { renderBooleanPreview } from '@/lib/prior-art-studio/compiler'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }
  const session = await getOwnedSession(params.sessionId, auth.user.id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const [latestRun, docStates, trail, theories] = await Promise.all([
    prisma.priorArtStudioRun.findFirst({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.priorArtStudioDocState.findMany({ where: { sessionId: session.id } }),
    prisma.priorArtStudioTrailEntry.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'desc' },
      take: 80,
      select: { id: true, kind: true, actor: true, summary: true, createdAt: true },
    }),
    prisma.priorArtStudioTheory.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'desc' } }),
  ])

  return NextResponse.json({
    session: {
      id: session.id,
      title: session.title,
      plan: session.plan,
      planVersion: session.planVersion,
      seedText: session.seedText,
      updatedAt: session.updatedAt,
    },
    latestRun,
    docStates,
    trail,
    theories,
    saturation: computeSaturation(docStates.map(s => ({ tag: s.tag, updatedAt: s.updatedAt }))),
    booleanPreview: renderBooleanPreview(session.plan as unknown as StudioPlan),
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }
  const session = await getOwnedSession(params.sessionId, auth.user.id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const data: Prisma.PriorArtStudioSessionUpdateInput = {}
  let planChanged = false

  if (typeof body?.title === 'string' && body.title.trim()) {
    data.title = body.title.trim().slice(0, 160)
  }
  if (typeof body?.seedText === 'string') {
    data.seedText = body.seedText.slice(0, 60000)
  }
  if (body?.plan && typeof body.plan === 'object') {
    data.plan = body.plan as Prisma.InputJsonValue
    data.planVersion = session.planVersion + 1
    planChanged = true
  }
  if (body?.archive === true) {
    data.status = 'ARCHIVED'
  }

  const updated = await prisma.priorArtStudioSession.update({ where: { id: session.id }, data })

  if (planChanged) {
    const summary =
      typeof body?.editSummary === 'string' && body.editSummary.trim()
        ? body.editSummary.trim().slice(0, 300)
        : summarizePlanEdit(session.plan as unknown as StudioPlan, body.plan as StudioPlan)
    await appendTrail(session.id, 'EDIT', `user:${auth.user.id}`, summary)
  }

  return NextResponse.json({
    session: { id: updated.id, title: updated.title, plan: updated.plan, planVersion: updated.planVersion },
    booleanPreview: renderBooleanPreview(updated.plan as unknown as StudioPlan),
  })
}
