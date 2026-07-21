import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { getOwnedSession, resolveStaleRun, startStudioRun } from '@/lib/prior-art-studio/service'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { validateStudioPlan } from '@/lib/prior-art-studio/plan-schema'

export const runtime = 'nodejs'

function headersToRecord(request: NextRequest) {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })
  return headers
}

// Starts the search as a background run and answers immediately — deep searches
// outlive reverse-proxy read timeouts, so the client polls /runs/{runId} instead
// of holding this request open.
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

    // One live run per session. A second tab (or a lost response) adopts the
    // existing run instead of piling a duplicate search onto the corpus.
    const existing = await prisma.priorArtStudioRun.findFirst({
      where: { sessionId: session.id, status: 'RUNNING' },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) {
      const resolved = await resolveStaleRun(existing)
      if (resolved.status === 'RUNNING') {
        return NextResponse.json(
          { error: 'A search is already running for this session.', runId: resolved.id },
          { status: 409 }
        )
      }
    }

    const recentStarts = await prisma.priorArtStudioRun.count({
      where: {
        createdAt: { gte: new Date(Date.now() - 60_000) },
        session: { userId: auth.user.id },
      },
    })
    if (recentStarts >= 3) {
      return NextResponse.json(
        { error: 'Too many search starts. Wait a minute before starting another run.', code: 'STUDIO_RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const body = await request.json().catch(() => ({}))
    const planValidation = validateStudioPlan(session.plan)
    if (!planValidation.success) {
      return NextResponse.json(
        { error: planValidation.error, code: 'INVALID_STUDIO_PLAN', fields: planValidation.fields },
        { status: 400 }
      )
    }
    const { runId, existing: adoptedExisting } = await startStudioRun({
      sessionId: session.id,
      userId: auth.user.id,
      tenantId: auth.user.tenantId || undefined,
      plan: planValidation.plan,
      planVersion: session.planVersion,
      requestHeaders: headersToRecord(request),
      depth: body?.depth === 'fast' ? 'fast' : 'deep',
    })
    return NextResponse.json(
      adoptedExisting
        ? { error: 'A search is already running for this session.', runId, status: 'RUNNING' }
        : { runId, status: 'RUNNING' },
      { status: adoptedExisting ? 409 : 202 }
    )
  } catch (error) {
    console.error('[PriorArtStudio] Run start failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search run failed.' },
      { status: 400 }
    )
  }
}
