/**
 * Razorpay Webhook Handler
 * POST /api/webhooks/razorpay
 * 
 * Handles Razorpay webhook events for payment status updates
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyWebhookSignature } from '@/lib/razorpay-service'
import { handleSubscriptionRenewal } from '@/lib/subscription-lifecycle-service'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

// Razorpay webhook event types
type RazorpayEvent = 
  | 'payment.captured'
  | 'payment.failed'
  | 'payment.authorized'
  | 'subscription.activated'
  | 'subscription.charged'
  | 'subscription.cancelled'
  | 'subscription.halted'
  | 'subscription.pending'
  | 'subscription.completed'

interface WebhookPayload {
  event: RazorpayEvent
  payload: {
    payment?: {
      entity: {
        id: string
        order_id: string
        amount: number
        currency: string
        status: string
        method: string
        error_code?: string
        error_description?: string
        email?: string
        contact?: string
      }
    }
    subscription?: {
      entity: {
        id: string
        plan_id: string
        status: string
        current_start: number
        current_end: number
      }
    }
  }
  created_at: number
}

export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const rawBody = await request.text()
    const signature = request.headers.get('x-razorpay-signature')

    // Signature verification is REQUIRED for security
    // If no webhook secret is configured, we fall back to Razorpay key secret
    if (!signature) {
      console.error('[Razorpay Webhook] Missing signature header')
      return NextResponse.json(
        { error: 'Missing webhook signature' },
        { status: 400 }
      )
    }

    if (!verifyWebhookSignature(rawBody, signature)) {
      console.error('[Razorpay Webhook] Invalid signature')
      return NextResponse.json(
        { error: 'Invalid webhook signature' },
        { status: 400 }
      )
    }

    // Parse webhook payload
    const event: WebhookPayload = JSON.parse(rawBody)
    console.log(`[Razorpay Webhook] Received event: ${event.event}`)

    // Handle different event types
    switch (event.event) {
      case 'payment.captured':
        await handlePaymentCaptured(event.payload.payment!.entity)
        break

      case 'payment.failed':
        await handlePaymentFailed(event.payload.payment!.entity)
        break

      case 'payment.authorized':
        await handlePaymentAuthorized(event.payload.payment!.entity)
        break

      case 'subscription.activated':
        await handleSubscriptionActivated(event.payload.subscription!.entity)
        break

      case 'subscription.cancelled':
        await handleSubscriptionCancelled(event.payload.subscription!.entity)
        break

      case 'subscription.halted':
        await handleSubscriptionHalted(event.payload.subscription!.entity)
        break

      case 'subscription.charged':
        // Subscription renewal payment captured - extend the subscription
        if (event.payload.subscription && event.payload.payment) {
          await handleSubscriptionRenewal({
            razorpaySubscriptionId: event.payload.subscription.entity.id,
            razorpayPaymentId: event.payload.payment.entity.id,
            amount: event.payload.payment.entity.amount,
            currency: event.payload.payment.entity.currency,
          })
        }
        break

      default:
        console.log(`[Razorpay Webhook] Unhandled event type: ${event.event}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[Razorpay Webhook] Error:', error)
    // Return 200 to prevent Razorpay from retrying
    return NextResponse.json({ received: true, error: 'Processing error' })
  }
}

/**
 * Handle payment.captured event
 */
async function handlePaymentCaptured(payment: WebhookPayload['payload']['payment']['entity']) {
  console.log(`[Razorpay Webhook] Payment captured: ${payment.id}`)

  // Find and update payment record
  const paymentRecord = await prisma.payment.findUnique({
    where: { razorpayOrderId: payment.order_id },
  })

  if (!paymentRecord) {
    console.warn(`[Razorpay Webhook] Payment record not found for order: ${payment.order_id}`)
    return
  }

  // Use atomic update with status check to prevent race conditions
  // Note: Discount increment is handled by verifyPayment, not here, to avoid double-counting
  const updated = await prisma.payment.updateMany({
    where: { 
      id: paymentRecord.id,
      status: { in: ['CREATED', 'AUTHORIZED'] }  // Only update if not already captured
    },
    data: {
      razorpayPaymentId: payment.id,
      status: 'CAPTURED',
      method: payment.method,
      paidAt: new Date(),
    },
  })

  // Only activate subscription if we actually updated the record
  if (updated.count > 0) {
    await activateSubscription(paymentRecord)
  }
}

/**
 * Handle payment.failed event
 */
async function handlePaymentFailed(payment: WebhookPayload['payload']['payment']['entity']) {
  console.log(`[Razorpay Webhook] Payment failed: ${payment.id}`)

  const paymentRecord = await prisma.payment.findUnique({
    where: { razorpayOrderId: payment.order_id },
  })

  if (paymentRecord) {
    await prisma.payment.update({
      where: { id: paymentRecord.id },
      data: {
        razorpayPaymentId: payment.id,
        status: 'FAILED',
        failureCode: payment.error_code,
        failureReason: payment.error_description,
      },
    })
  }
}

/**
 * Handle payment.authorized event
 */
async function handlePaymentAuthorized(payment: WebhookPayload['payload']['payment']['entity']) {
  console.log(`[Razorpay Webhook] Payment authorized: ${payment.id}`)

  const paymentRecord = await prisma.payment.findUnique({
    where: { razorpayOrderId: payment.order_id },
  })

  if (paymentRecord && paymentRecord.status === 'CREATED') {
    await prisma.payment.update({
      where: { id: paymentRecord.id },
      data: {
        razorpayPaymentId: payment.id,
        status: 'AUTHORIZED',
        method: payment.method,
      },
    })
  }
}

/**
 * Handle subscription.activated event
 */
async function handleSubscriptionActivated(subscription: WebhookPayload['payload']['subscription']['entity']) {
  console.log(`[Razorpay Webhook] Subscription activated: ${subscription.id}`)

  const subscriptionRecord = await prisma.subscription.findUnique({
    where: { razorpaySubscriptionId: subscription.id },
  })

  if (subscriptionRecord) {
    await prisma.subscription.update({
      where: { id: subscriptionRecord.id },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: new Date(subscription.current_start * 1000),
        currentPeriodEnd: new Date(subscription.current_end * 1000),
      },
    })
  }
}

/**
 * Handle subscription.cancelled event
 */
async function handleSubscriptionCancelled(subscription: WebhookPayload['payload']['subscription']['entity']) {
  console.log(`[Razorpay Webhook] Subscription cancelled: ${subscription.id}`)

  const subscriptionRecord = await prisma.subscription.findUnique({
    where: { razorpaySubscriptionId: subscription.id },
  })

  if (subscriptionRecord) {
    await prisma.subscription.update({
      where: { id: subscriptionRecord.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    })
  }
}

/**
 * Handle subscription.halted event
 */
async function handleSubscriptionHalted(subscription: WebhookPayload['payload']['subscription']['entity']) {
  console.log(`[Razorpay Webhook] Subscription halted: ${subscription.id}`)

  const subscriptionRecord = await prisma.subscription.findUnique({
    where: { razorpaySubscriptionId: subscription.id },
  })

  if (subscriptionRecord) {
    await prisma.subscription.update({
      where: { id: subscriptionRecord.id },
      data: {
        status: 'HALTED',
      },
    })
  }
}

/**
 * Activate subscription after successful payment
 */
async function activateSubscription(payment: {
  id: string
  userId: string
  tenantId: string
  planId: string
  planCode: string
  billingCycle: string
  amount: number
  currency: string
  discountId: string | null
  discountAmount: number | null
}) {
  const now = new Date()
  const periodEnd = new Date(now)
  
  if (payment.billingCycle === 'yearly') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1)
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1)
  }

  // Check for existing active subscription
  const existingSubscription = await prisma.subscription.findFirst({
    where: { tenantId: payment.tenantId, status: 'ACTIVE' },
  })

  let subscriptionId: string

  if (existingSubscription) {
    await prisma.subscription.update({
      where: { id: existingSubscription.id },
      data: {
        status: 'ACTIVE',
        planId: payment.planId,
        planCode: payment.planCode,
        billingCycle: payment.billingCycle,
        currency: payment.currency,
        amount: payment.amount,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextBillingDate: periodEnd,
      },
    })
    subscriptionId = existingSubscription.id
  } else {
    const newSubscription = await prisma.subscription.create({
      data: {
        tenantId: payment.tenantId,
        userId: payment.userId,
        planId: payment.planId,
        planCode: payment.planCode,
        billingCycle: payment.billingCycle,
        currency: payment.currency,
        amount: payment.amount,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextBillingDate: periodEnd,
        discountId: payment.discountId,
        discountAmount: payment.discountAmount,
      },
    })
    subscriptionId = newSubscription.id
  }

  // Link payment to subscription
  await prisma.payment.update({
    where: { id: payment.id },
    data: { subscriptionId },
  })

  // Deactivate existing tenant plans (except the one we're about to create/update)
  await prisma.tenantPlan.updateMany({
    where: { 
      tenantId: payment.tenantId, 
      status: 'ACTIVE',
      planId: { not: payment.planId }
    },
    data: { status: 'INACTIVE' },
  })

  // Upsert tenant plan to avoid unique constraint violations on concurrent requests
  // First try to find existing active plan for this tenant/plan combo
  const existingTenantPlan = await prisma.tenantPlan.findFirst({
    where: {
      tenantId: payment.tenantId,
      planId: payment.planId,
      status: 'ACTIVE',
    }
  })

  if (existingTenantPlan) {
    // Update existing plan
    await prisma.tenantPlan.update({
      where: { id: existingTenantPlan.id },
      data: {
        effectiveFrom: now,
        expiresAt: periodEnd,
      },
    })
  } else {
    // Create new active tenant plan
    await prisma.tenantPlan.create({
      data: {
        tenantId: payment.tenantId,
        planId: payment.planId,
        effectiveFrom: now,
        expiresAt: periodEnd,
        status: 'ACTIVE',
      },
    })
  }

  // Activate tenant if it was in PENDING_PAYMENT status (self-service signup)
  await prisma.tenant.updateMany({
    where: { 
      id: payment.tenantId,
      status: 'PENDING_PAYMENT'
    },
    data: { status: 'ACTIVE' }
  })

  console.log(`[Razorpay Webhook] Subscription activated for tenant ${payment.tenantId}`)
}

