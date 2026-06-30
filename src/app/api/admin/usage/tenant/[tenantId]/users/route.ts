import { NextRequest, NextResponse } from 'next/server'
import { computeUnifiedAdminUsage } from '@/lib/admin-usage-service'
import { normalizeUsageDateRange, parseUsageDateRangeParams } from '@/lib/usage-periods'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
  sortBy: z
    .enum(['userName', 'inputTokens', 'outputTokens', 'cost', 'patentDrafts', 'sessions', 'inProgress', 'noveltySearches', 'ideasReserved'])
    .optional(),
  sortDir: z.enum(['asc', 'desc']).optional()
})

export async function GET(
  request: NextRequest,
  { params }: { params: { tenantId: string } }
) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)

    const whoamiResponse = await fetch(
      `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/v1/auth/whoami`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    )

    if (!whoamiResponse.ok) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const userData = await whoamiResponse.json()
    const roles: string[] = Array.isArray(userData.roles) ? userData.roles : []
    const isSuperAdmin = roles.some(r => r === 'SUPER_ADMIN' || r === 'SUPER_ADMIN_VIEWER')
    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const getParam = (key: string) => {
      const value = searchParams.get(key)
      return value === null ? undefined : value
    }

    const parsed = QuerySchema.parse({
      startDate: getParam('startDate'),
      endDate: getParam('endDate'),
      page: getParam('page'),
      pageSize: getParam('pageSize'),
      sortBy: getParam('sortBy'),
      sortDir: getParam('sortDir')
    })

    const parsedDates = parseUsageDateRangeParams(parsed.startDate, parsed.endDate)
    if ('error' in parsedDates) {
      return NextResponse.json({ error: parsedDates.error }, { status: 400 })
    }

    const normalizedRange = normalizeUsageDateRange(parsedDates.startDate, parsedDates.endDate)
    const startDate = normalizedRange.start
    const endDate = normalizedRange.endInclusive
    const usage = await computeUnifiedAdminUsage(startDate, endDate, params.tenantId)
    const usersCombined = usage.users.map(user => ({
      userId: user.userId,
      userName: user.userName,
      userEmail: user.userEmail,
      tenantId: user.tenantId,
      tenantName: user.tenantName,
      tenantAtiId: user.tenantAtiId,
      tenantType: user.tenantType,
      registrationSource: user.registrationSource,
      signupAtiTokenId: user.signupAtiTokenId,
      signupAtiFingerprint: user.signupAtiFingerprint,
      totalInputTokens: user.totalInputTokens,
      totalOutputTokens: user.totalOutputTokens,
      totalApiCalls: user.totalApiCalls,
      totalCost: user.totalCost,
      patentDrafts: user.patentsDrafted,
      draftingSessionsStarted: user.draftingSessionsStarted,
      patentDraftsInProgress: user.patentDraftsInProgress,
      noveltySearches: user.noveltySearches,
      ideasReserved: user.ideasReserved,
      lastActivity: user.lastActivity
    }))

    const sortBy = parsed.sortBy || 'inputTokens'
    const sortDir = parsed.sortDir === 'asc' ? 1 : -1

    const sortedUsers = usersCombined.sort((a, b) => {
      const key = sortBy
      const getVal = (u: any) => {
        switch (key) {
          case 'userName':
            return u.userName || ''
          case 'outputTokens':
            return u.totalOutputTokens
          case 'cost':
            return u.totalCost
          case 'patentDrafts':
            return u.patentDrafts
          case 'sessions':
            return u.draftingSessionsStarted
          case 'inProgress':
            return u.patentDraftsInProgress
          case 'noveltySearches':
            return u.noveltySearches
          case 'ideasReserved':
            return u.ideasReserved
          case 'inputTokens':
          default:
            return u.totalInputTokens
        }
      }

      if (key === 'userName') {
        const cmp = (getVal(a) as string).localeCompare(getVal(b) as string)
        return cmp * sortDir
      }

      const diff = (getVal(a) as number) - (getVal(b) as number)
      if (diff !== 0) return diff * sortDir
      return (a.userName || '').localeCompare(b.userName || '')
    })

    const page = parsed.page ? Math.max(1, parseInt(parsed.page, 10) || 1) : 1
    const pageSize = parsed.pageSize ? Math.max(1, parseInt(parsed.pageSize, 10) || 25) : 25
    const totalUsers = sortedUsers.length
    const startIndex = (page - 1) * pageSize
    const pageUsers = sortedUsers.slice(startIndex, startIndex + pageSize)

    return NextResponse.json({
      startDate,
      endDate,
      tenantId: params.tenantId,
      users: pageUsers,
      pagination: {
        page,
        pageSize,
        totalUsers
      }
    })
  } catch (error) {
    console.error('Admin tenant users usage API error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query parameters', details: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
