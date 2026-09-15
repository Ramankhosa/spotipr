import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { minerApiContext, minerApiError } from '@/lib/whitespace/miner/api'
import { MinerError } from '@/lib/whitespace/miner/contracts'

export async function POST(request: NextRequest, { params }: { params: { studyId: string; runId: string } }) {
  try {
    await minerApiContext(request, params.studyId)
    const run = await prisma.whitespaceRun.findFirst({ where: { id: params.runId, studyId: params.studyId } })
    if (!run) throw new MinerError('Run not found.', 404)
    if (run.status === 'COMPLETED' || run.status === 'FAILED') return NextResponse.json({ runId: run.id, status: run.status })
    if (run.status === 'PROCESSING') {
      // Changing status breaks the worker's next heartbeat and completion
      // fence. In-flight cache writes are intentionally retained.
      await prisma.whitespaceRun.updateMany({ where: { id: run.id, status: 'PROCESSING' }, data: { status: 'FAILED', lastError: 'Cancelled by the user.', completedAt: new Date(), lockedBy: null, lockedUntil: null } })
    } else {
      await prisma.whitespaceRun.updateMany({ where: { id: run.id, status: 'QUEUED' }, data: { status: 'FAILED', lastError: 'Cancelled by the user.', completedAt: new Date() } })
    }
    await prisma.minerOperation.updateMany({ where: { runId: run.id, state: 'RESERVED' }, data: { state: 'RELEASED', completedAt: new Date() } })
    return NextResponse.json({ runId: run.id, status: 'FAILED', cancelled: true })
  } catch (error) { return minerApiError(error) }
}
