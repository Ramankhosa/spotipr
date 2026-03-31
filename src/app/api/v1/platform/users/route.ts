import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformScope } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    const url = new URL(request.url)
    const query = (url.searchParams.get('q') || '').trim().toLowerCase()

    const users = await prisma.user.findMany({
      where: {
        ...(query
          ? {
              OR: [
                { email: { contains: query, mode: 'insensitive' } },
                { name: { contains: query, mode: 'insensitive' } },
                { tenant: { name: { contains: query, mode: 'insensitive' } } }
              ]
            }
          : {}),
        NOT: {
          roles: {
            hasSome: ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER']
          }
        }
      },
      select: {
        id: true,
        email: true,
        name: true,
        roles: true,
        status: true,
        emailVerified: true,
        emailDraftingEnabled: true,
        createdAt: true,
        tenantId: true,
        tenant: {
          select: {
            id: true,
            name: true,
            atiId: true,
            status: true
          }
        }
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 250
    })

    return NextResponse.json({
      users,
      total: users.length
    })
  } catch (error) {
    console.error('Platform users list error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
