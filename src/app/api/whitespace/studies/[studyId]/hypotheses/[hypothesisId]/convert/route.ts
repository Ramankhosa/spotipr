import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { appendTrail, getOwnedStudy } from '@/lib/whitespace/service'
import { convertHypothesis } from '@/lib/whitespace/convert'
import { whitespaceErrorResponse } from '@/app/api/whitespace/route-errors'

export const runtime = 'nodejs'

/** Stage 7: promote a surviving hypothesis to a handoff-ready concept. Instant. */
export async function POST(
  request: NextRequest,
  { params }: { params: { studyId: string; hypothesisId: string } }
) {
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

    const result = await convertHypothesis({
      studyId: study.id,
      hypothesisId: params.hypothesisId,
      userId: auth.user.id,
    })

    // A re-click returns the concept that already exists; it is not a second
    // promotion, so it neither trails again nor claims 201.
    if (!result.existing) {
      await appendTrail(study.id, 'HYPOTHESIS', `user:${auth.user.id}`, `Promoted to concept: ${result.title}`)
    }

    return NextResponse.json({ concept: result }, { status: result.existing ? 200 : 201 })
  } catch (error) {
    return whitespaceErrorResponse(error, 'Convert')
  }
}
