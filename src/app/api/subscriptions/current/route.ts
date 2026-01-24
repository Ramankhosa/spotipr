/**
 * Get Current Subscription API
 * GET /api/subscriptions/current
 * 
 * Returns the current active subscription for the user's tenant
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCurrentSubscription, formatAmount, PLAN_PRICING } from '@/lib/razorpay-service'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
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

    // Get user with tenant info
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { 
        tenant: {
          include: {
            tenantPlans: {
              where: { status: 'ACTIVE' },
              include: { plan: true },
              orderBy: { effectiveFrom: 'desc' },
              take: 1,
            },
          },
        },
      },
    })

    if (!user || !user.tenantId) {
      return NextResponse.json(
        { error: 'User or tenant not found' },
        { status: 404 }
      )
    }

    // Check if user is a trial user
    const isTrialUser = user.tenant?.atiId === 'TRIAL'

    // Get current subscription
    const subscription = await getCurrentSubscription(user.tenantId)

    // Get current plan from tenant plans
    const currentTenantPlan = user.tenant?.tenantPlans?.[0]

    if (!subscription && !currentTenantPlan) {
      return NextResponse.json({
        hasSubscription: false,
        isTrialUser,
        message: isTrialUser 
          ? 'You are on a trial plan' 
          : 'No active subscription',
      })
    }

    // Build response
    const response: any = {
      hasSubscription: !!subscription,
      isTrialUser,
    }

    if (subscription) {
      const planInfo = PLAN_PRICING[subscription.planCode as keyof typeof PLAN_PRICING]
      
      response.subscription = {
        id: subscription.id,
        planCode: subscription.planCode,
        planName: planInfo?.name || subscription.plan.name,
        billingCycle: subscription.billingCycle,
        status: subscription.status,
        amount: subscription.amount,
        amountFormatted: formatAmount(subscription.amount, subscription.currency as 'USD' | 'INR'),
        currency: subscription.currency,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        nextBillingDate: subscription.nextBillingDate,
        cancelledAt: subscription.cancelledAt,
        cancelReason: subscription.cancelReason,
        discountApplied: subscription.discountAmount ? {
          amount: subscription.discountAmount,
          amountFormatted: formatAmount(subscription.discountAmount, subscription.currency as 'USD' | 'INR'),
        } : null,
        recentPayments: subscription.payments.map(p => ({
          id: p.id,
          amount: p.amount,
          amountFormatted: formatAmount(p.amount, p.currency as 'USD' | 'INR'),
          status: p.status,
          method: p.method,
          paidAt: p.paidAt,
        })),
      }
    } else if (currentTenantPlan) {
      // User has a plan assigned but no subscription (could be free/trial or admin-assigned)
      response.currentPlan = {
        code: currentTenantPlan.plan.code,
        name: currentTenantPlan.plan.name,
        effectiveFrom: currentTenantPlan.effectiveFrom,
        expiresAt: currentTenantPlan.expiresAt,
        status: currentTenantPlan.status,
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[GetSubscription API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

