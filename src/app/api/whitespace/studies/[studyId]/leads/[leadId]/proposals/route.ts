import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { minerApiContext, minerApiError } from '@/lib/whitespace/miner/api'
import { MinerError, proposalSchema, requireMinerEnabled } from '@/lib/whitespace/miner/contracts'
import { currentSnapshot } from '@/lib/whitespace/miner/snapshots'

export async function POST(request: NextRequest, { params }: { params: { studyId: string; leadId: string } }) {
  try {
    requireMinerEnabled()
    const { auth } = await minerApiContext(request, params.studyId)
    const body = await request.json().catch(() => ({}))
    const proposal = proposalSchema.safeParse(body.proposal)
    if (!proposal.success) throw new MinerError(`The proposal is incomplete: ${proposal.error.issues[0]?.message || 'check the mechanism and elements.'}`, 422)
    const expectedRevision = Number(body.expectedRevision)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new MinerError('Supply the proposal revision currently shown on screen.', 409)
    const lead = await prisma.inventionLead.findFirst({ where: { id: params.leadId, studyId: params.studyId } })
    if (!lead) throw new MinerError('Lead not found.', 404)
    if (!lead.snapshotId) throw new MinerError('This legacy lead needs a new evidence-backed harvest before a proposal can be reviewed.', 422)
    await currentSnapshot(params.studyId, lead.snapshotId)
    const latestSnapshot = await prisma.minerFieldSnapshot.findFirst({ where: { studyId: params.studyId }, orderBy: { createdAt: 'desc' }, select: { id: true, approvedAt: true } })
    if (!latestSnapshot?.approvedAt || latestSnapshot.id !== lead.snapshotId) throw new MinerError('This lead is not from the latest approved field. Approve the current preflight and run the lead engines again.', 409)
    const revision = await prisma.$transaction(async tx => {
      const changed = await tx.inventionLead.updateMany({
        where: { id: lead.id, proposalVersion: expectedRevision },
        data: { proposalVersion: { increment: 1 }, currentProposalId: null, currentAssessments: {}, currentBriefs: {}, status: 'CANDIDATE' },
      })
      if (!changed.count) throw new MinerError('The proposal changed in another session. Reload the lead before saving.', 409)
      return tx.minerProposalRevision.create({ data: {
        leadId: lead.id, snapshotId: lead.snapshotId as string, revision: expectedRevision + 1,
        content: proposal.data, evidence: proposal.data.sourceRefs, createdBy: auth.id,
      } })
    })
    return NextResponse.json({ proposal: revision }, { status: 201 })
  } catch (error) { return minerApiError(error) }
}
