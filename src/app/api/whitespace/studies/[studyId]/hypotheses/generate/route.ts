import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { appendTrail, getOwnedStudy, readScope } from '@/lib/whitespace/service'
import { generateHypotheses } from '@/lib/whitespace/hypothesize'
import { whitespaceErrorResponse } from '@/app/api/whitespace/route-errors'

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

    const study = await getOwnedStudy(params.studyId, auth.user.id, auth.user.tenantId)
    if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

    // Checked unconditionally: guarding on tenantId let any account without a
    // tenant spend the premium generation call with no quota check at all.
    if (!auth.user.tenantId) {
      return NextResponse.json(
        {
          error:
            'Hypothesis generation runs on your organisation’s analysis quota, and your account is not attached to an organisation yet. Ask an admin to add you, or contact support.',
          code: 'NO_TENANT',
        },
        { status: 403 }
      )
    }
    const check = await enforceServiceAccess(auth.user.id, auth.user.tenantId, 'WHITESPACE_ANALYSIS')
    if (!check.allowed) return check.response

    const result = await generateHypotheses({
      studyId: study.id,
      userId: auth.user.id,
      scope: readScope(study.scope),
      llmContext: { headers: headersToRecord(request) },
    })

    await appendTrail(
      study.id,
      'HYPOTHESIS',
      result.modelCode ? `model:${result.modelCode}` : 'system',
      `${result.hypotheses.length} hypotheses proposed for testing`
    )

    return NextResponse.json({ hypotheses: result.hypotheses }, { status: 201 })
  } catch (error) {
    return whitespaceErrorResponse(error, 'Hypothesis generation')
  }
}
