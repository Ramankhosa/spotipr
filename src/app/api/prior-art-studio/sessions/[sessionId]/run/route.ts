import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { getOwnedSession, resolveStaleRun, startStudioRun } from '@/lib/prior-art-studio/service'
import type { StudioPlan } from '@/lib/prior-art-studio/types'

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

    const body = await request.json().catch(() => ({}))
    const { runId } = await startStudioRun({
      sessionId: session.id,
      userId: auth.user.id,
      plan: session.plan as unknown as StudioPlan,
      planVersion: session.planVersion,
      requestHeaders: headersToRecord(request),
      depth: body?.depth === 'fast' ? 'fast' : 'deep',
    })
    return NextResponse.json({ runId, status: 'RUNNING' }, { status: 202 })
  } catch (error) {
    console.error('[PriorArtStudio] Run start failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search run failed.' },
      { status: 400 }
    )
  }
}
