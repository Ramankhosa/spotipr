/**
 * Create Razorpay Order API
 * POST /api/payments/create-order
 * 
 * Creates a Razorpay order for payment checkout
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  createOrder,
  getCurrencyForCountry,
  PLAN_PRICING,
  type PlanCode,
  type BillingCycle,
  type Currency,
} from '@/lib/razorpay-service'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

interface CreateOrderRequest {
  planCode: PlanCode
  billingCycle: BillingCycle
  countryCode?: string        // To determine currency (IN = INR, others = USD)
  discountCode?: string       // Optional coupon code
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
    const body: CreateOrderRequest = await request.json()
    const { planCode, billingCycle, countryCode, discountCode } = body

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

    // Check if user is a trial user - trial users don't need to pay
    if (user.tenant.atiId === 'TRIAL') {
      return NextResponse.json(
        { error: 'Trial users cannot purchase subscriptions. Please contact support.' },
        { status: 400 }
      )
    }

    // Determine currency based on country
    const currency: Currency = getCurrencyForCountry(countryCode)

    // Create order
    const result = await createOrder({
      userId: user.id,
      tenantId: user.tenantId,
      planCode,
      billingCycle,
      currency,
      customerEmail: user.email,
      customerCountry: countryCode,
      discountCode,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to create order' },
        { status: 400 }
      )
    }

    // Return order details for Razorpay checkout
    return NextResponse.json({
      success: true,
      order: {
        id: result.razorpayOrderId,
        amount: result.amount,
        currency: result.currency,
        receipt: result.receipt,
      },
      razorpay: {
        keyId: result.keyId,
        orderId: result.razorpayOrderId,
        amount: result.amount,
        currency: result.currency,
        name: 'PatentNest',
        description: `${PLAN_PRICING[planCode].name} Plan - ${billingCycle === 'yearly' ? 'Annual' : 'Monthly'}`,
        prefill: {
          email: user.email,
          name: user.name || user.firstName || '',
        },
      },
      discount: result.discountApplied,
    })
  } catch (error) {
    console.error('[CreateOrder API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

