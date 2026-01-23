/**
 * Tenant Feature Override API
 * 
 * Super Admin can set custom quotas per tenant (for Enterprise customers with negotiated limits)
 * These overrides take precedence over the standard plan quotas.
 * 
 * GET  - List all tenant overrides (or for a specific tenant)
 * POST - Create/update a tenant override
 * DELETE - Remove a tenant override
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, authenticateRequest } from '@/lib/middleware'

export const dynamic = 'force-dynamic'

const FEATURE_CODES = ['PRIOR_ART_SEARCH', 'NOVELTY_SEARCH', 'PATENT_DRAFTING', 'IDEA_BANK', 'DIAGRAM_GENERATION', 'PERSONA_SYNC', 'PATENT_REVIEW', 'IDEATION'] as const
type FeatureCode = (typeof FEATURE_CODES)[number]

/**
 * GET /api/v1/admin/tenant-overrides
 * Query params:
 *   - tenantId: Optional - filter by specific tenant
 * 
 * Returns all tenant feature overrides with tenant and feature details
 */
export async function GET(request: NextRequest) {
  // Allow both SUPER_ADMIN and SUPER_ADMIN_VIEWER to view overrides
  const roleCheck = await requireRole(['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER'])(request)
  if (roleCheck) return roleCheck

  try {
    const { searchParams } = new URL(request.url)
    const tenantId = searchParams.get('tenantId')

    const overrides = await prisma.tenantFeatureOverride.findMany({
      where: tenantId ? { tenantId } : undefined,
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            atiId: true,
            tenantPlans: {
              where: { status: 'ACTIVE' },
              include: { plan: { select: { code: true, name: true } } },
              take: 1
            }
          }
        },
        feature: {
          select: {
            id: true,
            code: true,
            name: true
          }
        }
      },
      orderBy: [
        { tenant: { name: 'asc' } },
        { feature: { code: 'asc' } }
      ]
    })

    // Also get all Enterprise tenants that COULD have overrides
    const enterpriseTenants = await prisma.tenant.findMany({
      where: {
        tenantPlans: {
          some: {
            status: 'ACTIVE',
            plan: { code: 'ENTERPRISE_PLAN' }
          }
        }
      },
      select: {
        id: true,
        name: true,
        atiId: true
      },
      orderBy: { name: 'asc' }
    })

    return NextResponse.json({
      overrides: overrides.map(o => ({
        id: o.id,
        tenantId: o.tenantId,
        tenantName: o.tenant.name,
        tenantAtiId: o.tenant.atiId,
        currentPlan: o.tenant.tenantPlans[0]?.plan?.code || 'NONE',
        featureId: o.featureId,
        featureCode: o.feature.code,
        featureName: o.feature.name,
        monthlyQuota: o.monthlyQuota,
        dailyQuota: o.dailyQuota,
        monthlyTokenLimit: o.monthlyTokenLimit,
        dailyTokenLimit: o.dailyTokenLimit,
        reason: o.reason,
        createdBy: o.createdBy,
        createdAt: o.createdAt,
        expiresAt: o.expiresAt
      })),
      enterpriseTenants: enterpriseTenants.map(t => ({
        id: t.id,
        name: t.name,
        atiId: t.atiId
      })),
      featureCodes: FEATURE_CODES
    })
  } catch (error) {
    console.error('[tenant-overrides] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load tenant overrides' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/v1/admin/tenant-overrides
 * Body:
 *   - tenantId: string (required)
 *   - featureCode: FeatureCode (required)
 *   - monthlyQuota: number | null (optional - use plan default if null)
 *   - dailyQuota: number | null (optional - use plan default if null)
 *   - monthlyTokenLimit: number | null (optional)
 *   - dailyTokenLimit: number | null (optional)
 *   - reason: string (optional - business reason for override)
 *   - expiresAt: string (optional - ISO date for time-limited overrides)
 * 
 * Creates or updates a tenant feature override
 */
export async function POST(request: NextRequest) {
  // Only full SUPER_ADMIN can create/modify overrides
  const roleCheck = await requireRole(['SUPER_ADMIN'])(request)
  if (roleCheck) return roleCheck

  try {
    // Get the admin user who is creating the override
    const authResult = await authenticateRequest(request)
    const adminUserId = authResult.user?.sub

    const body = await request.json().catch(() => null)

    if (!body || !body.tenantId || !body.featureCode) {
      return NextResponse.json(
        { error: 'Missing required fields: tenantId and featureCode' },
        { status: 400 }
      )
    }

    if (!FEATURE_CODES.includes(body.featureCode)) {
      return NextResponse.json(
        { error: `Invalid featureCode. Must be one of: ${FEATURE_CODES.join(', ')}` },
        { status: 400 }
      )
    }

    // Verify tenant exists
    const tenant = await prisma.tenant.findUnique({
      where: { id: body.tenantId }
    })

    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 404 }
      )
    }

    // Get feature ID
    const feature = await prisma.feature.findUnique({
      where: { code: body.featureCode }
    })

    if (!feature) {
      return NextResponse.json(
        { error: 'Feature not found' },
        { status: 404 }
      )
    }

    // Validate quota values (must be non-negative if provided)
    const monthlyQuota = body.monthlyQuota !== undefined && body.monthlyQuota !== null
      ? Math.max(0, Math.floor(body.monthlyQuota))
      : null
    const dailyQuota = body.dailyQuota !== undefined && body.dailyQuota !== null
      ? Math.max(0, Math.floor(body.dailyQuota))
      : null
    const monthlyTokenLimit = body.monthlyTokenLimit !== undefined && body.monthlyTokenLimit !== null
      ? Math.max(0, Math.floor(body.monthlyTokenLimit))
      : null
    const dailyTokenLimit = body.dailyTokenLimit !== undefined && body.dailyTokenLimit !== null
      ? Math.max(0, Math.floor(body.dailyTokenLimit))
      : null

    // Parse expiresAt if provided
    let expiresAt: Date | null = null
    if (body.expiresAt) {
      expiresAt = new Date(body.expiresAt)
      if (isNaN(expiresAt.getTime())) {
        return NextResponse.json(
          { error: 'Invalid expiresAt date format' },
          { status: 400 }
        )
      }
    }

    // Check if override already exists (to preserve createdBy on update)
    const existingOverride = await prisma.tenantFeatureOverride.findUnique({
      where: {
        tenantId_featureId: {
          tenantId: body.tenantId,
          featureId: feature.id
        }
      }
    })

    // Upsert the override (preserving createdBy on update)
    const override = await prisma.tenantFeatureOverride.upsert({
      where: {
        tenantId_featureId: {
          tenantId: body.tenantId,
          featureId: feature.id
        }
      },
      update: {
        monthlyQuota,
        dailyQuota,
        monthlyTokenLimit,
        dailyTokenLimit,
        reason: body.reason || null,
        expiresAt,
        updatedAt: new Date()
        // Note: createdBy is preserved from original record
      },
      create: {
        tenantId: body.tenantId,
        featureId: feature.id,
        monthlyQuota,
        dailyQuota,
        monthlyTokenLimit,
        dailyTokenLimit,
        reason: body.reason || null,
        createdBy: adminUserId || null,
        expiresAt
      },
      include: {
        tenant: { select: { name: true } },
        feature: { select: { code: true, name: true } }
      }
    })

    const action = existingOverride ? 'Updated' : 'Created'

    console.log(`[tenant-overrides] ${action} override for tenant ${tenant.name} feature ${feature.code}:`, {
      monthlyQuota,
      dailyQuota,
      reason: body.reason,
      adminUserId
    })

    return NextResponse.json({
      success: true,
      override: {
        id: override.id,
        tenantId: override.tenantId,
        tenantName: override.tenant.name,
        featureCode: override.feature.code,
        featureName: override.feature.name,
        monthlyQuota: override.monthlyQuota,
        dailyQuota: override.dailyQuota,
        monthlyTokenLimit: override.monthlyTokenLimit,
        dailyTokenLimit: override.dailyTokenLimit,
        reason: override.reason,
        expiresAt: override.expiresAt
      }
    })
  } catch (error) {
    console.error('[tenant-overrides] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to create/update tenant override' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/v1/admin/tenant-overrides
 * Query params:
 *   - id: Override ID to delete
 * OR Body:
 *   - tenantId: string
 *   - featureCode: string
 * 
 * Removes a tenant feature override (reverts to plan defaults)
 */
export async function DELETE(request: NextRequest) {
  // Only full SUPER_ADMIN can delete overrides
  const roleCheck = await requireRole(['SUPER_ADMIN'])(request)
  if (roleCheck) return roleCheck

  try {
    const { searchParams } = new URL(request.url)
    const overrideId = searchParams.get('id')

    if (overrideId) {
      // Delete by ID
      const deleted = await prisma.tenantFeatureOverride.delete({
        where: { id: overrideId },
        include: {
          tenant: { select: { name: true } },
          feature: { select: { code: true } }
        }
      })

      console.log(`[tenant-overrides] Deleted override ${overrideId} for tenant ${deleted.tenant.name} feature ${deleted.feature.code}`)

      return NextResponse.json({
        success: true,
        deleted: {
          id: deleted.id,
          tenantName: deleted.tenant.name,
          featureCode: deleted.feature.code
        }
      })
    }

    // Try to get tenantId and featureCode from body
    const body = await request.json().catch(() => null)

    if (!body || !body.tenantId || !body.featureCode) {
      return NextResponse.json(
        { error: 'Missing required: either id query param or tenantId+featureCode in body' },
        { status: 400 }
      )
    }

    // Get feature ID
    const feature = await prisma.feature.findUnique({
      where: { code: body.featureCode }
    })

    if (!feature) {
      return NextResponse.json(
        { error: 'Feature not found' },
        { status: 404 }
      )
    }

    const deleted = await prisma.tenantFeatureOverride.delete({
      where: {
        tenantId_featureId: {
          tenantId: body.tenantId,
          featureId: feature.id
        }
      },
      include: {
        tenant: { select: { name: true } },
        feature: { select: { code: true } }
      }
    })

    console.log(`[tenant-overrides] Deleted override for tenant ${deleted.tenant.name} feature ${deleted.feature.code}`)

    return NextResponse.json({
      success: true,
      deleted: {
        id: deleted.id,
        tenantName: deleted.tenant.name,
        featureCode: deleted.feature.code
      }
    })
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return NextResponse.json(
        { error: 'Override not found' },
        { status: 404 }
      )
    }
    console.error('[tenant-overrides] DELETE error:', error)
    return NextResponse.json(
      { error: 'Failed to delete tenant override' },
      { status: 500 }
    )
  }
}

