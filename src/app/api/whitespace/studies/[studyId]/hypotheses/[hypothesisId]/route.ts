import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { appendTrail, getOwnedStudy } from '@/lib/whitespace/service'
import {
  HUMAN_REVIEW_VERDICTS,
  MIN_REVIEW_NOTE,
  type HumanReviewVerdict,
} from '@/lib/whitespace/types'

export const runtime = 'nodejs'

const MAX_NOTE = 2000

/**
 * Record (or clear) the attorney's verdict on a hypothesis.
 *
 * This is the only writer of `humanReview`, and the review it writes outranks
 * everything the pipeline computed: the report renders it as the operative
 * judgment. Because of that, a REJECTED verdict must carry a written reason —
 * the system can measure that a hypothesis failed an attack, but it cannot
 * supply the reason a human decided not to pursue it, and a bare rejection in a
 * client deliverable is worse than no review at all.
 *
 * A verdict of null clears the review entirely, returning the hypothesis to
 * "unreviewed" rather than leaving a hollow record behind.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { studyId: string; hypothesisId: string } }
) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error?.message || 'Unauthorized' },
      { status: auth.error?.status || 401 }
    )
  }

  const study = await getOwnedStudy(params.studyId, auth.user.id, auth.user.tenantId)
  if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

  // The hypothesis id is never trusted to belong to this study.
  const hypothesis = await prisma.whitespaceHypothesis.findFirst({
    where: { id: params.hypothesisId, studyId: study.id },
    select: { id: true, statement: true },
  })
  if (!hypothesis) return NextResponse.json({ error: 'Hypothesis not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))

  const clearing = body?.verdict === null
  const verdict = HUMAN_REVIEW_VERDICTS.includes(body?.verdict as HumanReviewVerdict)
    ? (body.verdict as HumanReviewVerdict)
    : null

  if (!clearing && !verdict) {
    return NextResponse.json(
      { error: `verdict must be one of ${HUMAN_REVIEW_VERDICTS.join(', ')}, or null to clear the review.` },
      { status: 400 }
    )
  }

  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, MAX_NOTE) : ''

  if (verdict === 'REJECTED' && note.length < MIN_REVIEW_NOTE) {
    return NextResponse.json(
      {
        error:
          'Write why you are setting this aside — the system computed the scores and ran the attacks, but the reason a direction is not worth pursuing has to be yours.',
      },
      { status: 400 }
    )
  }

  const review = verdict
    ? {
        verdict,
        note: note || null,
        reviewedById: auth.user.id,
        reviewedAt: new Date().toISOString(),
      }
    : null

  const updated = await prisma.whitespaceHypothesis.update({
    where: { id: hypothesis.id },
    data: {
      // DbNull, not JsonNull: a JSON `null` would still be a present value, and
      // every "has this been reviewed?" check reads the column for absence.
      humanReview: review ? (review as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  })

  const excerpt = hypothesis.statement.slice(0, 80)
  await appendTrail(
    study.id,
    'NOTE',
    `user:${auth.user.id}`,
    review
      ? `Attorney review — ${review.verdict}: "${excerpt}"`
      : `Attorney review cleared: "${excerpt}"`,
    { hypothesisId: hypothesis.id, verdict, note: note || null } as unknown as Prisma.InputJsonValue
  )

  return NextResponse.json({ hypothesis: updated })
}
