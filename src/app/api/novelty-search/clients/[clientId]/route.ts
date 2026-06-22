import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(request: NextRequest, { params }: { params: { clientId: string } }) {
  const header = request.headers.get('authorization')
  const userId = header?.startsWith('Bearer ') ? verifyJWT(header.slice(7))?.sub : null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const client = await (prisma as any).noveltySearchClient.findFirst({ where: { id: params.clientId, userId }, include: { groups: { where: { archivedAt: null }, select: { id: true } } } })
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  if (client.groups.length > 0) return NextResponse.json({ error: 'Archive the active client groups before deleting this client.' }, { status: 409 })
  await (prisma as any).noveltySearchClient.delete({ where: { id: client.id } })
  return NextResponse.json({ success: true })
}
