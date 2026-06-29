import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getRawStage1SearchResults } from '@/lib/novelty-stage1-results'
import { getNoveltyPublicStatus } from '@/lib/novelty-search-background-state'

export const dynamic = 'force-dynamic'

function userIdFrom(request: NextRequest) {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  return verifyJWT(header.slice(7))?.sub || null
}

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback
}

function statusWhere(status: string) {
  switch (status.toUpperCase()) {
    case 'QUEUED': return { backgroundJob: { is: { status: 'QUEUED' } } }
    case 'PROCESSING': return { OR: [{ backgroundJob: { is: { status: 'PROCESSING' } } }, { backgroundJob: { is: null }, status: { in: ['STAGE_0_COMPLETED', 'STAGE_1_COMPLETED', 'STAGE_3_5_COMPLETED'] } }] }
    case 'COMPLETE': return { OR: [{ backgroundJob: { is: { status: 'COMPLETED' } } }, { backgroundJob: { is: null }, status: 'COMPLETED' }] }
    case 'FAILED': return { OR: [{ backgroundJob: { is: { status: 'FAILED' } } }, { backgroundJob: { is: null }, status: 'FAILED' }] }
    case 'CANCELLED': return { backgroundJob: { is: { status: 'CANCELLED' } } }
    default: return {}
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = userIdFrom(request)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const params = request.nextUrl.searchParams
    const page = positiveInt(params.get('page'), 1, 100000)
    const pageSize = positiveInt(params.get('pageSize'), 10, 100)
    const q = String(params.get('q') || '').trim()
    const dateFrom = params.get('dateFrom')
    const dateTo = params.get('dateTo')
    const createdAt: any = {}
    if (dateFrom) {
      const value = new Date(dateFrom)
      if (!Number.isNaN(value.getTime())) createdAt.gte = value
    }
    if (dateTo) {
      const value = new Date(dateTo)
      if (!Number.isNaN(value.getTime())) {
        value.setUTCDate(value.getUTCDate() + 1)
        createdAt.lt = value
      }
    }

    const where: any = {
      userId,
      ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
      ...(params.get('projectId') ? { projectId: params.get('projectId') } : {}),
      ...(params.get('groupId') ? { groupId: params.get('groupId') } : {}),
      ...(params.get('clientId') ? { group: { clientId: params.get('clientId') } } : {}),
      ...statusWhere(params.get('status') || ''),
    }

    const [total, searches, user] = await Promise.all([
      prisma.noveltySearchRun.count({ where }),
      prisma.noveltySearchRun.findMany({
        where,
        include: {
          project: { select: { id: true, name: true } },
          patent: { select: { id: true, title: true } },
          group: { include: { client: { select: { id: true, name: true } } } },
          backgroundJob: true,
        } as any,
        orderBy: { createdAt: params.get('sort') === 'oldest' ? 'asc' : 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { noveltySearchesCompleted: true } }),
    ])

    const history = searches.map((search: any) => {
      const status = getNoveltyPublicStatus(search)
      return {
        id: search.id,
        title: search.title,
        inventionDescription: `${search.inventionDescription.slice(0, 200)}${search.inventionDescription.length > 200 ? '...' : ''}`,
        status,
        createdAt: search.createdAt,
        completedAt: status === 'COMPLETE' ? search.stage4CompletedAt : null,
        project: search.project,
        patent: search.patent,
        group: search.group ? {
          id: search.group.id,
          name: search.group.name,
          referenceCode: search.group.referenceCode,
          client: search.group.client,
        } : null,
        jurisdiction: search.jurisdiction,
        hasReport: status === 'COMPLETE',
        reportUrl: status === 'COMPLETE' ? `/novelty-search/${search.id}/pdf` : null,
        patentCount: getRawStage1SearchResults(search.stage1Results).length,
        error: status === 'FAILED' ? (search.backgroundJob?.lastError || 'Processing failed. You can retry this search.') : null,
      }
    })

    return NextResponse.json({
      success: true,
      history,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      userStats: { totalSearches: user?.noveltySearchesCompleted || 0 },
    })
  } catch (error) {
    console.error('Novelty search history API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
