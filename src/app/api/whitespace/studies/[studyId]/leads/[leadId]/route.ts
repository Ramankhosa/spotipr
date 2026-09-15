import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { minerApiContext, minerApiError } from '@/lib/whitespace/miner/api'
import { MinerError } from '@/lib/whitespace/miner/contracts'

export async function GET(request: NextRequest, { params }: { params: { studyId: string; leadId: string } }) {
  try {
    await minerApiContext(request, params.studyId)
    const lead = await prisma.inventionLead.findFirst({ where: { id: params.leadId, studyId: params.studyId }, include: { evidence: { orderBy: { createdAt: 'desc' } } } })
    if (!lead) throw new MinerError('Lead not found.', 404)
    const [proposals, runs] = await Promise.all([
      prisma.minerProposalRevision.findMany({ where: { leadId: lead.id }, orderBy: { revision: 'desc' } }),
      prisma.whitespaceRun.findMany({ where: { studyId: params.studyId, stage: { in: ['MINER_PROPOSE', 'MINER_GATE', 'MINER_BRIEF'] }, params: { path: ['leadId'], equals: lead.id } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ])
    return NextResponse.json({ lead, proposals, runs })
  } catch (error) { return minerApiError(error) }
}
