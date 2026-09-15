import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { minerApiContext, minerApiError } from '@/lib/whitespace/miner/api'
import { MinerError, reviewSchema, requireMinerEnabled } from '@/lib/whitespace/miner/contracts'
import { currentSnapshot } from '@/lib/whitespace/miner/snapshots'

export async function POST(request: NextRequest, { params }: { params: { studyId: string; leadId: string } }) {
  try {
    requireMinerEnabled()
    const { auth } = await minerApiContext(request, params.studyId)
    const body = await request.json().catch(() => ({}))
    const parsed = reviewSchema.safeParse(body)
    if (!parsed.success) throw new MinerError(parsed.error.issues[0]?.message || 'Review decision is invalid.', 422)
    const revision = await prisma.minerProposalRevision.findFirst({ where: { id: parsed.data.proposalRevisionId, leadId: params.leadId } })
    const lead = await prisma.inventionLead.findFirst({ where: { id: params.leadId, studyId: params.studyId } })
    if (!revision || !lead) throw new MinerError('Proposal revision not found.', 404)
    if (parsed.data.verdict === 'NEEDS_INVESTIGATION' && !parsed.data.assessmentRunId) throw new MinerError('Select the exact assessment whose unresolved risks were reviewed.', 422)
    if (parsed.data.assessmentRunId) {
      const assessmentRun = await prisma.whitespaceRun.findFirst({ where: { id: parsed.data.assessmentRunId, studyId: params.studyId, stage: 'MINER_GATE', status: 'COMPLETED' }, select: { results: true } })
      const assessment = assessmentRun?.results && typeof assessmentRun.results === 'object' ? assessmentRun.results as Record<string, unknown> : null
      if (!assessment || assessment.proposalRevisionId !== revision.id || assessment.snapshotId !== revision.snapshotId) {
        throw new MinerError('That assessment does not belong to this proposal revision and field snapshot.', 422)
      }
    }
    const review = { ...parsed.data, reviewerId: auth.id, reviewedAt: new Date().toISOString() }
    const reviews = Array.isArray(revision.reviews) ? [...revision.reviews, review] : [review]
    const endorsed = parsed.data.verdict === 'APPROVED' || parsed.data.verdict === 'ENDORSED'
    if (endorsed) {
      await currentSnapshot(params.studyId, revision.snapshotId)
      const latestSnapshot = await prisma.minerFieldSnapshot.findFirst({ where: { studyId: params.studyId }, orderBy: { createdAt: 'desc' }, select: { id: true, approvedAt: true } })
      if (!latestSnapshot?.approvedAt || latestSnapshot.id !== revision.snapshotId) throw new MinerError('This proposal belongs to an older field snapshot. Re-run the lead engines and review a proposal against the latest approved field.', 409)
    }
    await prisma.$transaction([
      prisma.minerProposalRevision.update({ where: { id: revision.id }, data: {
        reviews: reviews as Prisma.InputJsonValue,
        ...(endorsed && !revision.approvedAt ? { approvedAt: new Date(), approvedBy: auth.id } : {}),
      } }),
      prisma.inventionLead.update({ where: { id: lead.id }, data: endorsed
        ? { currentProposalId: revision.id, snapshotId: revision.snapshotId, currentAssessments: {}, currentBriefs: {}, status: 'CANDIDATE', humanReview: review as Prisma.InputJsonValue }
        : parsed.data.verdict === 'REJECTED'
          ? { status: 'BLOCKED', currentProposalId: null, currentAssessments: {}, currentBriefs: {}, humanReview: review as Prisma.InputJsonValue }
          : { status: lead.status, humanReview: review as Prisma.InputJsonValue } }),
    ])
    return NextResponse.json({ reviewed: true, verdict: parsed.data.verdict, proposalRevisionId: revision.id })
  } catch (error) { return minerApiError(error) }
}
