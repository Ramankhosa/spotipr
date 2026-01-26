/**
 * Create Razorpay Subscription API
 * POST /api/payments/create-subscription
 * 
 * Creates a Razorpay subscription for auto-renewal
 * 
 * IMPORTANT: This endpoint is for tenants WITHOUT active discounts.
 * Discounted tenants should use one-time orders (/api/payments/create-order)
 * because Razorpay subscriptions have fixed prices.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  createRazorpaySubscription,
  getCurrencyForCountry,
  PLAN_PRICING,
  type PlanCode,
  type BillingCycle,
  type Currency,
} from '@/lib/razorpay-service'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

interface CreateSubscriptionRequest {
  planCode: PlanCode
  billingCycle: BillingCycle
  countryCode?: string
}

export async function POST(request: NextRequest) {
  try {
    // Extract and verify JWT token
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization token required' },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7)
    const payload = verifyJWT(token)
    if (!payload) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    // Get request body
    const body: CreateSubscriptionRequest = await request.json()
    const { planCode, billingCycle, countryCode } = body

    // Validate plan code
    if (!planCode || !['BASIC', 'PRO', 'ENTERPRISE'].includes(planCode)) {
      return NextResponse.json(
        { error: 'Invalid plan code. Must be BASIC, PRO, or ENTERPRISE' },
        { status: 400 }
      )
    }

    // Validate billing cycle
    if (!billingCycle || !['monthly', 'yearly'].includes(billingCycle)) {
      return NextResponse.json(
        { error: 'Invalid billing cycle. Must be monthly or yearly' },
        { status: 400 }
      )
    }

    // Get user with tenant info
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { tenant: true },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Ensure user has a tenant
    if (!user.tenantId || !user.tenant) {
      return NextResponse.json(
        { error: 'User must belong to a tenant to subscribe' },
        { status: 400 }
      )
    }

    // Check if tenant has an active discount - if so, they should use one-time orders
    // NOTE: We use AND to combine the two OR conditions because duplicate keys
    // in a JavaScript object would cause the second OR to overwrite the first.
    const activeDiscount = await prisma.adminDiscount.findFirst({
      where: {
        isActive: true,
        validFrom: { lte: new Date() },
        AND: [
          // User restriction check: discount must be for this user
          {
            OR: [
              { restrictedToUserIds: { has: user.id } },
              { restrictedToEmails: { has: user.email } },
            ]
          },
          // Validity period check: either no expiry or not yet expired
          {
            OR: [
              { validUntil: null },
              { validUntil: { gte: new Date() } },
            ]
          }
        ]
      },
    })

    if (activeDiscount) {
      return NextResponse.json({
        success: false,
        useOneTimeOrder: true,
        message: 'You have an active discount. Please use one-time payment to apply your discount.',
        discountInfo: {
          name: activeDiscount.name,
          type: activeDiscount.discountType,
          value: activeDiscount.discountValue,
        },
      }, { status: 200 })
    }

    // Determine currency based on country
    const currency: Currency = getCurrencyForCountry(countryCode)

    // Create Razorpay subscription
    const result = await createRazorpaySubscription({
      tenantId: user.tenantId,
      userId: user.id,
      planCode,
      billingCycle,
      currency,
      customerEmail: user.email,
      customerName: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    })

    if (!result.success) {
      // If subscription creation failed due to missing plan, suggest one-time order
      if (result.error?.includes('not available')) {
        return NextResponse.json({
          success: false,
          useOneTimeOrder: true,
          message: result.error,
        }, { status: 200 })
      }
      
      return NextResponse.json(
        { error: result.error || 'Failed to create subscription' },
        { status: 400 }
      )
    }

    // Return subscription details
    return NextResponse.json({
      success: true,
      subscription: {
        id: result.subscriptionId,
        razorpaySubscriptionId: result.razorpaySubscriptionId,
      },
      paymentLink: result.shortUrl, // Razorpay payment link for subscription
      message: 'Subscription created. Complete payment to activate.',
    })
  } catch (error) {
    console.error('[CreateSubscription API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

