/**
 * Admin Discount Management API
 * GET /api/admin/discounts - List all discounts
 * POST /api/admin/discounts - Create new discount (backdoor pricing)
 * 
 * Only accessible by SUPER_ADMIN users
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  createAdminDiscount,
  getAdminDiscounts,
  deactivateDiscount,
  generateSpecialPricingForUser,
  type PlanCode,
} from '@/lib/razorpay-service'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

/**
 * GET - List all admin discounts
 */
export async function GET(request: NextRequest) {
  try {
    // Verify admin access
    const authResult = await verifyAdminAccess(request)
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    // Get query params
    const { searchParams } = new URL(request.url)
    const includeInactive = searchParams.get('includeInactive') === 'true'

    const discounts = await getAdminDiscounts(includeInactive)

    return NextResponse.json({
      success: true,
      discounts: discounts.map(d => ({
        id: d.id,
        code: d.code,
        name: d.name,
        description: d.description,
        discountType: d.discountType,
        discountValue: d.discountValue,
        currency: d.currency,
        applicablePlans: d.applicablePlans,
        maxUses: d.maxUses,
        maxUsesPerUser: d.maxUsesPerUser,
        currentUses: d.currentUses,
        validFrom: d.validFrom,
        validUntil: d.validUntil,
        restrictedToUserIds: d.restrictedToUserIds,
        restrictedToEmails: d.restrictedToEmails,
        isActive: d.isActive,
        createdAt: d.createdAt,
        createdBy: d.createdBy,
        usageCount: d._count.payments,
      })),
    })
  } catch (error) {
    console.error('[AdminDiscounts GET] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST - Create new discount
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin access
    const authResult = await verifyAdminAccess(request)
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const body = await request.json()
    const {
      action,
      // Common fields
      name,
      description,
      discountType,
      discountValue,
      currency,
      code,
      applicablePlans,
      maxUses,
      maxUsesPerUser,
      validUntil,
      restrictedToUserIds,
      restrictedToEmails,
      // Special pricing fields
      targetEmail,
      planCode,
      discountPercentage,
      validDays,
      // Deactivate
      discountId,
    } = body

    // Handle different actions
    if (action === 'deactivate') {
      if (!discountId) {
        return NextResponse.json(
          { error: 'discountId is required for deactivation' },
          { status: 400 }
        )
      }

      const result = await deactivateDiscount(discountId)
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }

      return NextResponse.json({ success: true, message: 'Discount deactivated' })
    }

    if (action === 'special_pricing') {
      // Generate special pricing for a specific user
      if (!targetEmail || !planCode || !discountPercentage) {
        return NextResponse.json(
          { error: 'targetEmail, planCode, and discountPercentage are required' },
          { status: 400 }
        )
      }

      const result = await generateSpecialPricingForUser({
        adminUserId: authResult.userId!,
        targetEmail,
        planCode: planCode as PlanCode,
        discountPercentage,
        validDays: validDays || 30,
      })

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }

      return NextResponse.json({
        success: true,
        discountCode: result.discountCode,
        message: `Special pricing created for ${targetEmail}`,
        instructions: `Share this code with the user: ${result.discountCode}`,
      })
    }

    // Default: Create a new discount
    if (!name || !discountType || discountValue === undefined) {
      return NextResponse.json(
        { error: 'name, discountType, and discountValue are required' },
        { status: 400 }
      )
    }

    if (!['PERCENTAGE', 'FIXED_AMOUNT'].includes(discountType)) {
      return NextResponse.json(
        { error: 'discountType must be PERCENTAGE or FIXED_AMOUNT' },
        { status: 400 }
      )
    }

    if (discountType === 'FIXED_AMOUNT' && !currency) {
      return NextResponse.json(
        { error: 'currency is required for FIXED_AMOUNT discounts' },
        { status: 400 }
      )
    }

    const result = await createAdminDiscount({
      createdByUserId: authResult.userId!,
      name,
      description,
      discountType,
      discountValue,
      currency,
      code,
      applicablePlans: applicablePlans || [],
      maxUses,
      maxUsesPerUser: maxUsesPerUser || 1,
      validUntil: validUntil ? new Date(validUntil) : undefined,
      restrictedToUserIds: restrictedToUserIds || [],
      restrictedToEmails: restrictedToEmails || [],
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      discountId: result.discountId,
      message: 'Discount created successfully',
    })
  } catch (error) {
    console.error('[AdminDiscounts POST] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Verify admin access helper
 */
async function verifyAdminAccess(request: NextRequest): Promise<{
  success: boolean
  error?: string
  status?: number
  userId?: string
}> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { success: false, error: 'Authorization token required', status: 401 }
  }

  const token = authHeader.substring(7)
  const payload = verifyJWT(token)
  if (!payload) {
    return { success: false, error: 'Invalid or expired token', status: 401 }
  }

  // Get user and check admin role
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
  })

  if (!user) {
    return { success: false, error: 'User not found', status: 404 }
  }

  // Check if user is SUPER_ADMIN
  if (!user.roles.includes('SUPER_ADMIN')) {
    return { success: false, error: 'Admin access required', status: 403 }
  }

  return { success: true, userId: user.id }
}

