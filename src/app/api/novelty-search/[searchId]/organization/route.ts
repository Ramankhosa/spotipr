import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(request: NextRequest, { params }: { params: { searchId: string } }) {
  const header = request.headers.get('authorization')
  const userId = header?.startsWith('Bearer ') ? verifyJWT(header.slice(7))?.sub : null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const run = await prisma.noveltySearchRun.findFirst({ where: { id: params.searchId, userId } })
  if (!run) return NextResponse.json({ error: 'Novelty search not found' }, { status: 404 })
  const body = await request.json()
  const groupId = body.groupId || null
  if (groupId) {
    const group = await (prisma as any).noveltySearchGroup.findFirst({ where: { id: groupId, userId, archivedAt: null } })
    if (!group) return NextResponse.json({ error: 'Matter group not found or archived' }, { status: 404 })
  }
  await prisma.noveltySearchRun.update({ where: { id: run.id }, data: { groupId } as any })
  return NextResponse.json({ success: true, groupId })
}
