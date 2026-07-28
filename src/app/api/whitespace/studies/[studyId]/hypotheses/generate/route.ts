import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { appendTrail, getOwnedStudy, readScope } from '@/lib/whitespace/service'
import { generateHypotheses } from '@/lib/whitespace/hypothesize'

export const runtime = 'nodejs'
export const maxDuration = 120

function headersToRecord(request: NextRequest) {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })
  return headers
}

/**
 * Stage 5, interactive: one premium call, the user is waiting on the result.
 * Metered — hypothesis generation is where real model budget is spent.
 */
export async function POST(request: NextRequest, { params }: { params: { studyId: string } }) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json(
        { error: auth.error?.message || 'Unauthorized' },
        { status: auth.error?.status || 401 }
      )
    }

    const study = await getOwnedStudy(params.studyId, auth.user.id)
    if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

    if (auth.user.tenantId) {
      const check = await enforceServiceAccess(auth.user.id, auth.user.tenantId, 'WHITESPACE_ANALYSIS')
      if (!check.allowed) return check.response
    }

    const result = await generateHypotheses({
      studyId: study.id,
      userId: auth.user.id,
      scope: readScope(study.scope),
      requestHeaders: headersToRecord(request),
    })

    await appendTrail(
      study.id,
      'HYPOTHESIS',
      result.modelCode ? `model:${result.modelCode}` : 'system',
      `${result.hypotheses.length} hypotheses proposed for testing`
    )

    return NextResponse.json({ hypotheses: result.hypotheses }, { status: 201 })
  } catch (error) {
    console.error('[Whitespace] Hypothesis generation failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Hypothesis generation failed.' },
      { status: 400 }
    )
  }
}
