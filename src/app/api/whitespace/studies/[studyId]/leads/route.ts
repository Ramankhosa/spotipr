import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { minerApiContext, minerApiError } from '@/lib/whitespace/miner/api'

export async function GET(request: NextRequest, { params }: { params: { studyId: string } }) {
  try {
    await minerApiContext(request, params.studyId)
    const page = Math.max(1, Number(request.nextUrl.searchParams.get('page') || 1))
    const pageSize = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('pageSize') || 24)))
    const where = { studyId: params.studyId }
    const [total, leads, snapshots] = await Promise.all([
      prisma.inventionLead.count({ where }),
      prisma.inventionLead.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, title: true, origin: true, problemStatement: true, proposedMechanism: true, elements: true, rationale: true, signals: true, sourceRefs: true, scores: true, status: true, humanReview: true, coverageLimitations: true, snapshotId: true, proposalVersion: true, currentProposalId: true, currentAssessments: true, currentBriefs: true, updatedAt: true } }),
      prisma.minerFieldSnapshot.findMany({ where: { studyId: params.studyId }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, eligible: true, workload: true, coverage: true, limitations: true, approvedAt: true, createdAt: true } }),
    ])
    return NextResponse.json({ leads, snapshots, pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } })
  } catch (error) { return minerApiError(error) }
}
