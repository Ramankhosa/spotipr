import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { appendTrail, computeSaturation, getOwnedSession, resolveStaleRun, summarizePlanEdit } from '@/lib/prior-art-studio/service'
import type { StudioPlan, StudioResultFamily } from '@/lib/prior-art-studio/types'
import { renderBooleanPreview } from '@/lib/prior-art-studio/compiler'
import { validateStudioPlan } from '@/lib/prior-art-studio/plan-schema'
import { mergeCanonicalFamilyStates, studioFamilyAliasMap } from '@/lib/prior-art-studio/family-key'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }
  const session = await getOwnedSession(params.sessionId, auth.user.id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const [latestRun, runningRow, docStates, trail, theories] = await Promise.all([
    prisma.priorArtStudioRun.findFirst({
      where: { sessionId: session.id, status: 'COMPLETE' },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.priorArtStudioRun.findFirst({
      where: { sessionId: session.id, status: 'RUNNING' },
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

  // A RUNNING row lets a refreshed client resume polling instead of losing the
  // in-flight search; stale orphans are failed here rather than lingering.
  const activeRow = runningRow ? await resolveStaleRun(runningRow) : null
  const activeRun =
    activeRow && activeRow.status === 'RUNNING'
      ? { id: activeRow.id, depth: activeRow.depth === 'fast' ? ('fast' as const) : ('deep' as const), createdAt: activeRow.createdAt.toISOString() }
      : null

  const currentPlan = validateStudioPlan(session.plan)
  const snapshotPlan = !currentPlan.success && latestRun ? validateStudioPlan(latestRun.planSnapshot) : null
  const readablePlan = currentPlan.success
    ? currentPlan.plan
    : snapshotPlan?.success
      ? snapshotPlan.plan
      : null
  if (!readablePlan) {
    return NextResponse.json(
      {
        error: 'This session contains an invalid legacy search plan and no valid run snapshot is available.',
        code: 'INVALID_STUDIO_PLAN',
        fields: currentPlan.success ? [] : currentPlan.fields,
      },
      { status: 422 }
    )
  }
  const latestFamilies = Array.isArray(latestRun?.results)
    ? latestRun.results as unknown as StudioResultFamily[]
    : []
  const canonicalDocStates = mergeCanonicalFamilyStates(docStates, studioFamilyAliasMap(latestFamilies))

  return NextResponse.json({
    activeRun,
    session: {
      id: session.id,
      title: session.title,
      plan: readablePlan,
      planVersion: session.planVersion,
      seedText: session.seedText,
      updatedAt: session.updatedAt,
    },
    latestRun,
    docStates: canonicalDocStates,
    trail,
    theories,
    saturation: computeSaturation(canonicalDocStates.map(s => ({ tag: s.tag, updatedAt: s.updatedAt }))),
    planRecoveryWarning: currentPlan.success
      ? undefined
      : 'The saved plan was invalid, so this session was opened from its latest valid run snapshot. Save a valid edit to repair it.',
    booleanPreview: renderBooleanPreview(readablePlan),
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
  let validatedPlan: StudioPlan | null = null
  if (body?.plan !== undefined) {
    const validation = validateStudioPlan(body.plan)
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error, code: 'INVALID_STUDIO_PLAN', fields: validation.fields },
        { status: 400 }
      )
    }
    validatedPlan = validation.plan
    data.plan = validatedPlan as unknown as Prisma.InputJsonValue
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
        : (() => {
            const previousPlan = validateStudioPlan(session.plan)
            return previousPlan.success
              ? summarizePlanEdit(previousPlan.plan, validatedPlan!)
              : 'Repaired invalid legacy search plan with a validated plan.'
          })()
    await appendTrail(session.id, 'EDIT', `user:${auth.user.id}`, summary)
  }

  return NextResponse.json({
    session: { id: updated.id, title: updated.title, plan: updated.plan, planVersion: updated.planVersion },
    booleanPreview: renderBooleanPreview(validatedPlan || (updated.plan as unknown as StudioPlan)),
  })
}
