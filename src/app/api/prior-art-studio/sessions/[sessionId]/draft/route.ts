import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { appendTrail, draftStudioPlan, getOwnedSession } from '@/lib/prior-art-studio/service'
import { renderBooleanPreview } from '@/lib/prior-art-studio/compiler'
import { validateStudioPlan } from '@/lib/prior-art-studio/plan-schema'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'
export const maxDuration = 120

function headersToRecord(request: NextRequest) {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })
  return headers
}

export async function POST(request: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }
    const session = await getOwnedSession(params.sessionId, auth.user.id)
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    if (auth.user.tenantId) {
      const serviceCheck = await enforceServiceAccess(auth.user.id, auth.user.tenantId, 'NOVELTY_SEARCH')
      if (!serviceCheck.allowed) return serviceCheck.response
    }

    const body = await request.json().catch(() => ({}))
    const disclosure = typeof body?.disclosure === 'string' ? body.disclosure.trim() : ''
    if (disclosure.length < 40) {
      return NextResponse.json(
        { error: 'Describe the invention in at least a few sentences so the generator has something to work with.' },
        { status: 400 }
      )
    }

    const draft = await draftStudioPlan({
      disclosure,
      existingTitle: session.title !== 'Untitled search' ? session.title : undefined,
      requestHeaders: headersToRecord(request),
    })
    const validation = validateStudioPlan(draft.plan)
    if (!validation.success) {
      console.error('[PriorArtStudio] Query generator returned an invalid plan:', validation.fields)
      return NextResponse.json(
        { error: 'The query generator returned an invalid search plan. Nothing was saved.', code: 'INVALID_GENERATED_PLAN' },
        { status: 502 }
      )
    }
    const plan = validation.plan

    const updated = await prisma.priorArtStudioSession.update({
      where: { id: session.id },
      data: {
        plan: plan as unknown as Prisma.InputJsonValue,
        planVersion: session.planVersion + 1,
        seedText: disclosure.slice(0, 60000),
        ...(plan.title ? { title: plan.title } : {}),
      },
    })

    await appendTrail(
      session.id,
      'COPILOT',
      `model:${draft.modelCode || 'unknown'}`,
      `Drafted ${plan.blocks.length} blocks, ${plan.elements.length} elements, ${plan.cpc.length} CPC suggestions from disclosure${draft.usedFallbackTask ? ' (task-fallback routing)' : ''}`,
      { previousPlanVersion: session.planVersion } as unknown as Prisma.InputJsonValue
    )

    return NextResponse.json({
      plan: updated.plan,
      planVersion: updated.planVersion,
      title: updated.title,
      booleanPreview: renderBooleanPreview(plan),
      modelCode: draft.modelCode,
    })
  } catch (error) {
    console.error('[PriorArtStudio] Draft failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Query generator failed.' },
      { status: 500 }
    )
  }
}
