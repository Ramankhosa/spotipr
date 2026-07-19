import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { getOwnedSession, runStudioPlan } from '@/lib/prior-art-studio/service'
import type { StudioPlan } from '@/lib/prior-art-studio/types'

export const runtime = 'nodejs'
export const maxDuration = 300

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

    const body = await request.json().catch(() => ({}))
    const run = await runStudioPlan({
      sessionId: session.id,
      userId: auth.user.id,
      plan: session.plan as unknown as StudioPlan,
      planVersion: session.planVersion,
      requestHeaders: headersToRecord(request),
      depth: body?.depth === 'fast' ? 'fast' : 'deep',
    })
    return NextResponse.json({ run })
  } catch (error) {
    console.error('[PriorArtStudio] Run failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search run failed.' },
      { status: 500 }
    )
  }
}
