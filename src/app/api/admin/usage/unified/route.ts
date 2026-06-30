import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { computeUnifiedAdminUsage } from '@/lib/admin-usage-service'
import { parseUsageDateRangeParams } from '@/lib/usage-periods'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  tenantId: z.string().optional()
})

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const whoamiResponse = await fetch(
      `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/v1/auth/whoami`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!whoamiResponse.ok) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const userData = await whoamiResponse.json()
    const roles: string[] = Array.isArray(userData.roles) ? userData.roles : []
    const isSuperAdmin = roles.some(role => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')
    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const parsed = QuerySchema.parse({
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      tenantId: searchParams.get('tenantId') || undefined
    })

    const parsedDates = parseUsageDateRangeParams(parsed.startDate, parsed.endDate)
    if ('error' in parsedDates) {
      return NextResponse.json({ error: parsedDates.error }, { status: 400 })
    }

    const usage = await computeUnifiedAdminUsage(parsedDates.startDate, parsedDates.endDate, parsed.tenantId)
    return NextResponse.json(usage)
  } catch (error) {
    console.error('Unified admin usage API error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query parameters', details: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
