import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

function userIdFrom(request: NextRequest) {
  const header = request.headers.get('authorization')
  return header?.startsWith('Bearer ') ? verifyJWT(header.slice(7))?.sub || null : null
}

function cleanName(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export async function GET(request: NextRequest) {
  const userId = userIdFrom(request)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const clients = await (prisma as any).noveltySearchClient.findMany({
    where: { userId },
    include: { groups: { where: { archivedAt: null }, orderBy: { name: 'asc' }, include: { _count: { select: { searchRuns: true } } } } },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ clients })
}

export async function POST(request: NextRequest) {
  try {
    const userId = userIdFrom(request)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json()
    const name = cleanName(body.name)
    if (!name || name.length > 160) return NextResponse.json({ error: 'Client name is required and must be 160 characters or fewer.' }, { status: 400 })
    const client = await (prisma as any).noveltySearchClient.create({ data: { userId, name, normalizedName: name.toLocaleLowerCase() } })
    return NextResponse.json({ client }, { status: 201 })
  } catch (error: any) {
    if (error?.code === 'P2002') return NextResponse.json({ error: 'A client with this name already exists.' }, { status: 409 })
    return NextResponse.json({ error: 'Failed to create client.' }, { status: 500 })
  }
}
