import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

function userIdFrom(request: NextRequest) {
  const header = request.headers.get('authorization')
  return header?.startsWith('Bearer ') ? verifyJWT(header.slice(7))?.sub || null : null
}

const clean = (value: unknown, max = 500) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)

export async function GET(request: NextRequest) {
  const userId = userIdFrom(request)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true'
  const groups = await (prisma as any).noveltySearchGroup.findMany({
    where: { userId, ...(includeArchived ? {} : { archivedAt: null }) },
    include: { client: { select: { id: true, name: true } }, _count: { select: { searchRuns: true } } },
    orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
  })
  return NextResponse.json({ groups })
}

export async function POST(request: NextRequest) {
  try {
    const userId = userIdFrom(request)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json()
    const name = clean(body.name, 160)
    if (!name) return NextResponse.json({ error: 'Matter group name is required.' }, { status: 400 })
    const client = await (prisma as any).noveltySearchClient.findFirst({ where: { id: body.clientId, userId } })
    if (!client) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
    const group = await (prisma as any).noveltySearchGroup.create({
      data: {
        userId, clientId: client.id, name, normalizedName: name.toLocaleLowerCase(),
        referenceCode: clean(body.referenceCode, 80) || null,
        description: clean(body.description, 1000) || null,
      },
      include: { client: { select: { id: true, name: true } } },
    })
    return NextResponse.json({ group }, { status: 201 })
  } catch (error: any) {
    if (error?.code === 'P2002') return NextResponse.json({ error: 'This client already has a matter group with that name.' }, { status: 409 })
    return NextResponse.json({ error: 'Failed to create matter group.' }, { status: 500 })
  }
}
