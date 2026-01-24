/**
 * Cancel Subscription API
 * POST /api/subscriptions/cancel
 * 
 * Cancels the user's active subscription
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { cancelSubscription, getCurrentSubscription } from '@/lib/razorpay-service'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

interface CancelRequest {
  reason?: string
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
    const body: CancelRequest = await request.json().catch(() => ({}))

    // Get user with tenant info
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { tenant: true },
    })

    if (!user || !user.tenantId) {
      return NextResponse.json(
        { error: 'User or tenant not found' },
        { status: 404 }
      )
    }

    // Get current subscription
    const subscription = await getCurrentSubscription(user.tenantId)

    if (!subscription) {
      return NextResponse.json(
        { error: 'No active subscription found' },
        { status: 404 }
      )
    }

    // Cancel subscription
    const result = await cancelSubscription(subscription.id, body.reason)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to cancel subscription' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Subscription cancelled successfully',
      note: 'Your plan will remain active until the end of your current billing period',
      currentPeriodEnd: subscription.currentPeriodEnd,
    })
  } catch (error) {
    console.error('[CancelSubscription API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

