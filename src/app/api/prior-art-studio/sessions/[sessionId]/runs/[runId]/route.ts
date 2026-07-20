import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { getOwnedSession, resolveStaleRun, studioRunPayloadFromRow } from '@/lib/prior-art-studio/service'

export const runtime = 'nodejs'

// Polling endpoint for background runs: RUNNING → keep polling, FAILED → the
// stored error, COMPLETE → the same payload the old synchronous route returned.
export async function GET(request: NextRequest, { params }: { params: { sessionId: string; runId: string } }) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }
  const session = await getOwnedSession(params.sessionId, auth.user.id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const row = await prisma.priorArtStudioRun.findFirst({ where: { id: params.runId, sessionId: session.id } })
  if (!row) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const resolved = await resolveStaleRun(row)
  if (resolved.status === 'RUNNING') {
    return NextResponse.json({ status: 'RUNNING', depth: resolved.depth, startedAt: resolved.createdAt.toISOString() })
  }
  if (resolved.status === 'FAILED') {
    return NextResponse.json({ status: 'FAILED', error: resolved.error || 'Search run failed.' })
  }
  return NextResponse.json({ status: 'COMPLETE', run: studioRunPayloadFromRow(resolved) })
}
