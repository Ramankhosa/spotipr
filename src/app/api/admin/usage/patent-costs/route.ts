import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { computePatentCosts } from '@/lib/admin-usage-service'
import { normalizeUsageDateRange, parseUsageDateRangeParams } from '@/lib/usage-periods'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  tenantId: z.string(),
  userId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional()
})

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)

    // Verify token via whoami
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

    const userRoles: string[] = Array.isArray(userData.roles) ? userData.roles : []
    const isSuperAdmin = userRoles.some((r: string) => r === 'SUPER_ADMIN' || r === 'SUPER_ADMIN_VIEWER')
    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const getParam = (key: string) => {
      const value = searchParams.get(key)
      return value === null ? undefined : value
    }

    const parsed = QuerySchema.parse({
      tenantId: getParam('tenantId'),
      userId: getParam('userId'),
      startDate: getParam('startDate'),
      endDate: getParam('endDate')
    })

    if (!parsed.tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
    }

    const parsedDates = parseUsageDateRangeParams(parsed.startDate, parsed.endDate)
    if ('error' in parsedDates) {
      return NextResponse.json({ error: parsedDates.error }, { status: 400 })
    }

    const normalizedRange = normalizeUsageDateRange(parsedDates.startDate, parsedDates.endDate)

    const runCosts = await computePatentCosts(
      parsed.tenantId,
      normalizedRange.start,
      normalizedRange.endInclusive,
      parsed.userId
    )

    return NextResponse.json({
      startDate: normalizedRange.start,
      endDate: normalizedRange.endInclusive,
      tenantId: parsed.tenantId,
      userId: parsed.userId,
      totals: runCosts.totals,
      patents: runCosts.patents,
      unattributed: runCosts.unattributed,
      pricingWarnings: runCosts.pricingWarnings
    })
  } catch (error) {
    console.error('Patent costs API error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query parameters', details: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

