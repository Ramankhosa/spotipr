import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calculateCostForLog } from '@/lib/admin-usage-service'
import { getBillableOutputTokens } from '@/lib/usage-log-cost'
import { ensurePricingLoaded } from '@/lib/metering/cost-calculator'
import { normalizeUsageDateRange, parseUsageDateRangeParams, toInclusiveDateRange } from '@/lib/usage-periods'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
  sortBy: z.enum(['startedAt', 'inputTokens', 'outputTokens', 'apiCalls']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  taskCode: z.string().optional(),
  modelClass: z.string().optional(),
  apiCode: z.string().optional()
})

function mapTaskToAction(taskCode?: string | null): string {
  switch (taskCode) {
    case 'LLM2_DRAFT':
      return 'Patent draft generation'
    case 'LLM3_DIAGRAM':
      return 'Diagram generation'
    case 'LLM4_NOVELTY_SCREEN':
    case 'LLM5_NOVELTY_ASSESS':
      return 'Novelty search'
    case 'LLM6_REPORT_GENERATION':
      return 'Report generation'
    case 'IDEA_BANK_RESERVE':
      return 'Idea reservation'
    default:
      return taskCode || 'LLM operation'
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { tenantId: string; userId: string } }
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
      sortDir: getParam('sortDir'),
      taskCode: getParam('taskCode'),
      modelClass: getParam('modelClass'),
      apiCode: getParam('apiCode')
    })

    const parsedDates = parseUsageDateRangeParams(parsed.startDate, parsed.endDate)
    if ('error' in parsedDates) {
      return NextResponse.json({ error: parsedDates.error }, { status: 400 })
    }

    const normalizedRange = normalizeUsageDateRange(parsedDates.startDate, parsedDates.endDate)
    const startDate = normalizedRange.start
    const endDate = normalizedRange.endInclusive

    const where: any = {
      tenantId: params.tenantId,
      userId: params.userId,
      startedAt: toInclusiveDateRange(normalizedRange),
      status: 'COMPLETED'
    }

    if (parsed.taskCode) {
      where.taskCode = parsed.taskCode
    }
    if (parsed.modelClass) {
      where.modelClass = parsed.modelClass
    }
    if (parsed.apiCode) {
      where.apiCode = parsed.apiCode
    }

    const page = parsed.page ? Math.max(1, parseInt(parsed.page, 10) || 1) : 1
    const pageSize = parsed.pageSize ? Math.max(1, parseInt(parsed.pageSize, 10) || 25) : 25
    const skip = (page - 1) * pageSize

    const sortBy = parsed.sortBy || 'startedAt'
    const sortDir = parsed.sortDir === 'asc' ? 'asc' : 'desc'

    const orderBy: any = {}
    orderBy[sortBy] = sortDir

    await ensurePricingLoaded()

    const [totalCount, logs] = await Promise.all([
      prisma.usageLog.count({ where }),
      prisma.usageLog.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          startedAt: true,
          taskCode: true,
          modelClass: true,
          apiCode: true,
          inputTokens: true,
          outputTokens: true,
          apiCalls: true,
          meta: true
        }
      })
    ])

    const detailLogs = logs.map(log => {
      let meta: any
      try {
        meta = log.meta as any
      } catch {
        meta = {}
      }

      return {
        id: log.id,
        timestamp: log.startedAt,
        taskCode: log.taskCode,
        action: mapTaskToAction(log.taskCode),
        modelClass: log.modelClass,
        apiCode: log.apiCode,
        inputTokens: log.inputTokens ?? 0,
        outputTokens: getBillableOutputTokens(log.outputTokens, log.meta),
        apiCalls: log.apiCalls ?? 0,
        cost: calculateCostForLog(log),
        meta: {
          patentId: meta?.patentId || null,
          projectId: meta?.projectId || null,
          documentId: meta?.documentId || null
        }
      }
    })

    return NextResponse.json({
      startDate,
      endDate,
      tenantId: params.tenantId,
      userId: params.userId,
      page,
      pageSize,
      total: totalCount,
      logs: detailLogs
    })
  } catch (error) {
    console.error('Admin user usage details API error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query parameters', details: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
