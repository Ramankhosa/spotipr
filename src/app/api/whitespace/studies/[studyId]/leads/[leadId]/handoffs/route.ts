import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { minerApiContext, minerApiError } from '@/lib/whitespace/miner/api'
import { handoffPayloadSchema, MinerError, minerOfficeSchema, requireMinerEnabled } from '@/lib/whitespace/miner/contracts'
import { currentSnapshot } from '@/lib/whitespace/miner/snapshots'

export async function POST(request: NextRequest, { params }: { params: { studyId: string; leadId: string } }) {
  try {
    requireMinerEnabled()
    const { auth } = await minerApiContext(request, params.studyId)
    const body = await request.json().catch(() => ({}))
    const target = body.target === 'novelty' || body.target === 'drafting' ? body.target : null
    const office = minerOfficeSchema.safeParse(body.office)
    if (!target || !office.success) throw new MinerError('Choose novelty or drafting and one assessed office.', 422)
    const lead = await prisma.inventionLead.findFirst({ where: { id: params.leadId, studyId: params.studyId } })
    if (!lead?.currentProposalId) throw new MinerError('Approve a proposal before creating a handoff.', 422)
    const assessments = (lead.currentAssessments ?? {}) as Record<string, any>
    const briefs = (lead.currentBriefs ?? {}) as Record<string, any>
    const assessmentPointer = assessments[office.data]
    const briefPointer = briefs[office.data]
    if (!assessmentPointer || assessmentPointer.proposalRevisionId !== lead.currentProposalId) throw new MinerError(`Run the current ${office.data} assessment first.`, 422)
    if (target === 'drafting' && (!briefPointer || briefPointer.proposalRevisionId !== lead.currentProposalId || briefPointer.assessmentRunId !== assessmentPointer.runId)) throw new MinerError(`Prepare a brief from the current ${office.data} assessment before drafting.`, 422)
    const runId = target === 'drafting' ? briefPointer.runId : assessmentPointer.runId
    const run = await prisma.whitespaceRun.findFirst({ where: { id: runId, studyId: params.studyId, status: 'COMPLETED' } })
    const proposal = await prisma.minerProposalRevision.findUnique({ where: { id: lead.currentProposalId } })
    if (proposal) await currentSnapshot(params.studyId, proposal.snapshotId)
    if (!run?.results || !proposal?.approvedAt) throw new MinerError('The current result is no longer available. Reopen the lead and refresh it.', 409)
    if (assessmentPointer.outcome === 'BLOCKED') throw new MinerError('A verified full prior-art match cannot proceed unchanged.', 422)
    const proposalContent = proposal.content as Record<string, unknown>
    const result = run.results as Record<string, unknown>
    const report = result.brief && typeof result.brief === 'object' ? result.brief as Record<string, unknown> : result
    const payload = handoffPayloadSchema.parse({
      v: 2, target, office: office.data, studyId: params.studyId, leadId: lead.id,
      snapshotId: proposal.snapshotId, proposalRevisionId: proposal.id,
      title: String(proposalContent.title || lead.title),
      description: [proposalContent.problem, proposalContent.mechanism,
        Array.isArray(proposalContent.elements) ? `Elements: ${proposalContent.elements.join('; ')}` : '',
        Array.isArray(proposalContent.relationships) ? `Relationships: ${proposalContent.relationships.join('; ')}` : '',
      ].filter(Boolean).join('\n\n'),
      elements: proposalContent.elements ?? [], relationships: proposalContent.relationships ?? [],
      preliminaryClaims: report.preliminaryClaims ?? [], assessmentRunId: assessmentPointer.runId,
      briefRunId: briefPointer?.runId ?? null, limitations: result.limitations ?? report.coverageLimitations ?? [],
    })
    const handoff = await prisma.minerHandoff.create({ data: {
      leadId: lead.id, userId: auth.id, tenantId: auth.tenantId ?? null, target,
      proposalRevisionId: proposal.id, office: office.data, payload: payload as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    } })
    const destinationUrl = target === 'novelty' ? `/novelty-search?minerHandoff=${encodeURIComponent(handoff.id)}` : `/patents/draft/new?minerHandoff=${encodeURIComponent(handoff.id)}`
    return NextResponse.json({ token: handoff.id, destinationUrl, expiresAt: handoff.expiresAt })
  } catch (error) { return minerApiError(error) }
}
