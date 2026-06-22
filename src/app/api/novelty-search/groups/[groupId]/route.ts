import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(request: NextRequest, { params }: { params: { groupId: string } }) {
  try {
    const header = request.headers.get('authorization')
    const userId = header?.startsWith('Bearer ') ? verifyJWT(header.slice(7))?.sub : null
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const existing = await (prisma as any).noveltySearchGroup.findFirst({ where: { id: params.groupId, userId } })
    if (!existing) return NextResponse.json({ error: 'Matter group not found' }, { status: 404 })
    const body = await request.json()
    const data: any = {}
    if (body.name !== undefined) {
      const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 160)
      if (!name) return NextResponse.json({ error: 'Matter group name is required.' }, { status: 400 })
      data.name = name
      data.normalizedName = name.toLocaleLowerCase()
    }
    if (body.referenceCode !== undefined) data.referenceCode = String(body.referenceCode || '').trim().slice(0, 80) || null
    if (body.description !== undefined) data.description = String(body.description || '').trim().slice(0, 1000) || null
    if (body.archived !== undefined) data.archivedAt = body.archived ? new Date() : null
    const group = await (prisma as any).noveltySearchGroup.update({ where: { id: existing.id }, data, include: { client: true } })
    return NextResponse.json({ group })
  } catch (error: any) {
    if (error?.code === 'P2002') return NextResponse.json({ error: 'This client already has a matter group with that name.' }, { status: 409 })
    return NextResponse.json({ error: 'Failed to update matter group.' }, { status: 500 })
  }
}
