import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { minerApiContext, minerApiError } from '@/lib/whitespace/miner/api'
import { currentSnapshot } from '@/lib/whitespace/miner/snapshots'
import { MinerError, requireMinerEnabled } from '@/lib/whitespace/miner/contracts'

export async function POST(request: NextRequest, { params }: { params: { studyId: string; snapshotId: string } }) {
  try {
    requireMinerEnabled()
    const { auth } = await minerApiContext(request, params.studyId)
    const snapshot = await currentSnapshot(params.studyId, params.snapshotId)
    if (!snapshot.eligible) throw new MinerError('This field is not eligible for harvesting. Apply one of the preflight corrections and run it again.', 422)
    const updated = await prisma.minerFieldSnapshot.updateMany({
      where: { id: snapshot.id, approvedAt: null }, data: { approvedAt: new Date(), approvedBy: auth.id },
    })
    if (!updated.count && !snapshot.approvedAt) throw new MinerError('The field approval changed. Reload the study.', 409)
    return NextResponse.json({ snapshotId: snapshot.id, approved: true })
  } catch (error) { return minerApiError(error) }
}
