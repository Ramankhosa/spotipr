import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, requireTenantRole } from '@/lib/middleware'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tenant-admin/stats
 * Get aggregate statistics for the tenant admin dashboard
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error

    const user = authResult.user!
    
    // Require OWNER or ADMIN role
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck

    if (!user.tenant_id) {
      return NextResponse.json({ error: 'No tenant association' }, { status: 400 })
    }

    // Get all users in tenant
    const users = await prisma.user.findMany({
      where: { tenantId: user.tenant_id },
      select: { id: true, status: true }
    })

    const userIds = users.map(u => u.id)
    const userCount = users.length
    const activeUserCount = users.filter(u => u.status === 'ACTIVE').length

    // Handle edge case: no users in tenant
    let patentCount = 0
    let noveltySearchCount = 0
    let ideationSessionCount = 0

    if (userIds.length > 0) {
      // Get patent count for all tenant users
      patentCount = await prisma.patent.count({
        where: { createdBy: { in: userIds } }
      })

      // Get completed novelty search count for all tenant users
      noveltySearchCount = await prisma.noveltySearchRun.count({
        where: {
          userId: { in: userIds },
          status: 'COMPLETED'
        }
      })

      // Get ideation session count for all tenant users
      ideationSessionCount = await prisma.ideationSession.count({
        where: { tenantId: user.tenant_id }
      })
    }

    // Get token usage for the tenant
    const tokenUsage = await prisma.usageLog.aggregate({
      where: {
        tenantId: user.tenant_id,
        status: 'COMPLETED'
      },
      _sum: {
        inputTokens: true,
        outputTokens: true
      }
    })

    // Get plan tier from tenant's ATI token or user's signup token
    let planTier: string | null = null
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenant_id },
      select: { 
        atiTokens: {
          where: { status: { in: ['ACTIVE', 'ISSUED'] } },
          select: { planTier: true },
          take: 1,
          orderBy: { createdAt: 'desc' }
        }
      }
    })
    
    if (tenant?.atiTokens?.[0]?.planTier) {
      planTier = tenant.atiTokens[0].planTier
    }

    return NextResponse.json({
      userCount,
      activeUserCount,
      patentsDrafted: patentCount,
      noveltySearches: noveltySearchCount,
      ideationSessions: ideationSessionCount,
      totalInputTokens: tokenUsage._sum.inputTokens || 0,
      totalOutputTokens: tokenUsage._sum.outputTokens || 0,
      planTier
    })

  } catch (error) {
    console.error('[TenantAdmin] Stats error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tenant statistics' },
      { status: 500 }
    )
  }
}

