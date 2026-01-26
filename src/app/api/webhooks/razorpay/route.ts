/**
 * Razorpay Webhook Handler
 * POST /api/webhooks/razorpay
 * 
 * Handles Razorpay webhook events for payment status updates
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyWebhookSignature, PLAN_PRICING, type PlanCode, type Currency } from '@/lib/razorpay-service'
import { handleSubscriptionRenewal } from '@/lib/subscription-lifecycle-service'
import { sendPaymentSuccessEmail } from '@/lib/payment-notification-service'

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
  // This prevents double-processing if verifyPayment already handled it
  if (updated.count > 0) {
    // Increment discount usage if applicable
    // Note: verifyPayment may have already done this, but only if it processed CAPTURED
    // Since we use atomic updates, only one path will activate - we increment on the same path
    if (paymentRecord.discountId) {
      await prisma.adminDiscount.update({
        where: { id: paymentRecord.discountId },
        data: { currentUses: { increment: 1 } },
      })
    }

    await activateSubscription(paymentRecord)
  }
}

/**
 * Handle payment.failed event
 * IMPORTANT: If payment was previously AUTHORIZED (pre-capture), we need to rollback
 * any subscription/plan activation that may have occurred prematurely.
 */
async function handlePaymentFailed(payment: WebhookPayload['payload']['payment']['entity']) {
  console.log(`[Razorpay Webhook] Payment failed: ${payment.id}`)

  const paymentRecord = await prisma.payment.findUnique({
    where: { razorpayOrderId: payment.order_id },
    include: { subscription: true },
  })

  if (paymentRecord) {
    // Check if this payment was previously AUTHORIZED (meaning subscription might have been activated)
    const wasAuthorized = paymentRecord.status === 'AUTHORIZED'
    
    await prisma.payment.update({
      where: { id: paymentRecord.id },
      data: {
        razorpayPaymentId: payment.id,
        status: 'FAILED',
        failureCode: payment.error_code,
        failureReason: payment.error_description,
      },
    })

    // CRITICAL: Rollback subscription/plan activation if payment was previously authorized
    // This handles the case where payment was authorized, subscription was activated,
    // but then capture failed (e.g., insufficient funds at capture time)
    if (wasAuthorized) {
      console.warn(`[Razorpay Webhook] Rolling back subscription for failed payment that was previously authorized: ${payment.id}`)
      
      // Deactivate the subscription - use HALTED (valid enum value for payment failure)
      if (paymentRecord.subscriptionId) {
        await prisma.subscription.update({
          where: { id: paymentRecord.subscriptionId },
          data: {
            status: 'HALTED', // Valid enum: Payment failed, subscription halted
          },
        })
      }

      // Deactivate the tenant plan - use INACTIVE (valid status for TenantPlan)
      await prisma.tenantPlan.updateMany({
        where: {
          tenantId: paymentRecord.tenantId,
          status: 'ACTIVE',
        },
        data: { status: 'INACTIVE' },
      })

      // Suspend the tenant if it was a paid signup (PENDING_PAYMENT -> ACTIVE via authorization)
      // This prevents access until payment is resolved
      const tenant = await prisma.tenant.findUnique({
        where: { id: paymentRecord.tenantId },
        select: { registrationSource: true, status: true },
      })

      if (tenant?.registrationSource === 'PAID_SIGNUP' && tenant.status === 'ACTIVE') {
        await prisma.tenant.update({
          where: { id: paymentRecord.tenantId },
          data: { status: 'SUSPENDED' }, // Valid enum: SUSPENDED for payment failure
        })
        console.warn(`[Razorpay Webhook] Suspended tenant ${paymentRecord.tenantId} due to payment failure`)
      }
    }
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

  const subscriptionRecord = await prisma.subscription.findFirst({
    where: { razorpaySubscriptionId: subscription.id },
    include: { plan: true },
  })

  if (!subscriptionRecord) {
    console.warn(`[Razorpay Webhook] Subscription record not found: ${subscription.id}`)
    return
  }

  const periodEnd = new Date(subscription.current_end * 1000)

  // Update subscription status and period
  await prisma.subscription.update({
    where: { id: subscriptionRecord.id },
    data: {
      status: 'ACTIVE',
      currentPeriodStart: new Date(subscription.current_start * 1000),
      currentPeriodEnd: periodEnd,
      nextBillingDate: periodEnd,
    },
  })

  // Activate tenant plan
  await activateTenantPlan(subscriptionRecord.tenantId, subscriptionRecord.planId, periodEnd)

  // Activate tenant if in PENDING_PAYMENT status
  await prisma.tenant.updateMany({
    where: { 
      id: subscriptionRecord.tenantId,
      status: 'PENDING_PAYMENT'
    },
    data: { status: 'ACTIVE' }
  })

  // Align ATI token expiry with subscription period
  await alignATITokenExpiry(subscriptionRecord.tenantId, periodEnd)

  console.log(`[Razorpay Webhook] Subscription ${subscription.id} activated with period end: ${periodEnd}`)
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

  const subscriptionRecord = await prisma.subscription.findFirst({
    where: { razorpaySubscriptionId: subscription.id },
  })

  if (!subscriptionRecord) {
    console.warn(`[Razorpay Webhook] Subscription record not found: ${subscription.id}`)
    return
  }

  // Update subscription status
  await prisma.subscription.update({
    where: { id: subscriptionRecord.id },
    data: {
      status: 'HALTED',
    },
  })

  // Deactivate tenant plan (subscription payment failed)
  await prisma.tenantPlan.updateMany({
    where: {
      tenantId: subscriptionRecord.tenantId,
      status: 'ACTIVE',
    },
    data: { status: 'INACTIVE' },
  })

  // Check if tenant was created via paid signup - if so, suspend them
  const tenant = await prisma.tenant.findUnique({
    where: { id: subscriptionRecord.tenantId },
    select: { registrationSource: true, status: true },
  })

  if (tenant?.registrationSource === 'PAID_SIGNUP' && tenant.status === 'ACTIVE') {
    await prisma.tenant.update({
      where: { id: subscriptionRecord.tenantId },
      data: { status: 'SUSPENDED' },
    })
    console.warn(`[Razorpay Webhook] Suspended tenant ${subscriptionRecord.tenantId} due to subscription halt`)
  }
}

/**
 * Activate subscription after successful payment
 * This is called from the webhook when payment.captured event is received
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
  receipt?: string | null
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

  // ==========================================================================
  // ATI TOKEN EXPIRY ALIGNMENT
  // ==========================================================================
  // For paid signups (AUTO_GENERATED tokens), align the ATI token expiry with
  // the subscription period. This ensures that:
  // 1. The token expiry reflects the paid access period
  // 2. If subscription lapses, users lose access
  // 3. On renewal, token expiry is extended
  await alignATITokenExpiry(payment.tenantId, periodEnd)

  // ==========================================================================
  // SEND PAYMENT SUCCESS EMAIL
  // ==========================================================================
  // Send notification email to the user. This is important when client-side
  // verification didn't happen (e.g., user closed browser after payment).
  try {
    const user = await prisma.user.findUnique({
      where: { id: payment.userId },
      select: { email: true, name: true, firstName: true }
    })

    const plan = await prisma.plan.findUnique({
      where: { id: payment.planId },
      select: { name: true }
    })

    if (user?.email) {
      const planCode = payment.planCode.replace('_PLAN', '') as PlanCode
      const planInfo = PLAN_PRICING[planCode]
      
      await sendPaymentSuccessEmail({
        userEmail: user.email,
        userName: user.name || user.firstName || undefined,
        planCode,
        planName: planInfo?.name || plan?.name || payment.planCode,
        amount: payment.amount,
        currency: payment.currency as Currency,
        billingCycle: payment.billingCycle as 'monthly' | 'yearly',
        paymentId: payment.receipt || payment.id,
        receiptNumber: payment.receipt || payment.id,
        nextBillingDate: periodEnd,
        discountApplied: payment.discountAmount ? {
          name: 'Discount',
          amount: payment.discountAmount,
        } : undefined,
      })
      console.log(`[Razorpay Webhook] Payment success email sent to ${user.email}`)
    }
  } catch (emailError) {
    // Log but don't fail the webhook for email errors
    console.error('[Razorpay Webhook] Failed to send payment success email:', emailError)
  }

  console.log(`[Razorpay Webhook] Subscription activated for tenant ${payment.tenantId}`)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Activate tenant plan after subscription activation
 */
async function activateTenantPlan(tenantId: string, planId: string, expiresAt: Date): Promise<void> {
  const now = new Date()

  // Deactivate any existing active plans for OTHER plans
  await prisma.tenantPlan.updateMany({
    where: { 
      tenantId, 
      status: 'ACTIVE',
      planId: { not: planId }
    },
    data: { status: 'INACTIVE' },
  })

  // Check if there's already an active plan for this tenant/plan combo
  const existingTenantPlan = await prisma.tenantPlan.findFirst({
    where: {
      tenantId,
      planId,
      status: 'ACTIVE',
    }
  })

  if (existingTenantPlan) {
    // Update existing plan
    await prisma.tenantPlan.update({
      where: { id: existingTenantPlan.id },
      data: {
        effectiveFrom: now,
        expiresAt,
      },
    })
  } else {
    // Create new active tenant plan
    await prisma.tenantPlan.create({
      data: {
        tenantId,
        planId,
        effectiveFrom: now,
        expiresAt,
        status: 'ACTIVE',
      },
    })
  }

  console.log(`[Razorpay Webhook] Tenant plan activated for tenant ${tenantId} until ${expiresAt}`)
}

/**
 * Align ATI token expiry with subscription period
 * This ensures users lose access when subscription expires
 */
async function alignATITokenExpiry(tenantId: string, subscriptionEndDate: Date): Promise<void> {
  try {
    // Update all AUTO_GENERATED tokens for this tenant
    const autoGeneratedResult = await prisma.aTIToken.updateMany({
      where: {
        tenantId,
        tokenType: 'AUTO_GENERATED',
        OR: [
          { expiresAt: null },
          { expiresAt: { lt: subscriptionEndDate } }
        ]
      },
      data: {
        expiresAt: subscriptionEndDate
      }
    })

    if (autoGeneratedResult.count > 0) {
      console.log(`[Razorpay Webhook] Updated expiry for ${autoGeneratedResult.count} AUTO_GENERATED ATI tokens to ${subscriptionEndDate}`)
    }

    // Also cap any MANUAL tokens that exceed the subscription period
    // NOTE: We also cap tokens with NULL expiry (legacy tokens with no expiration set)
    // to prevent them from outliving the subscription period.
    const manualResult = await prisma.aTIToken.updateMany({
      where: {
        tenantId,
        tokenType: 'MANUAL',
        OR: [
          { expiresAt: null }, // Cap legacy tokens with no expiry set
          { expiresAt: { gt: subscriptionEndDate } } // Cap those exceeding subscription
        ]
      },
      data: {
        expiresAt: subscriptionEndDate
      }
    })

    if (manualResult.count > 0) {
      console.log(`[Razorpay Webhook] Capped expiry for ${manualResult.count} MANUAL ATI tokens to subscription end ${subscriptionEndDate}`)
    }
  } catch (error) {
    // Log but don't fail the webhook
    console.error('[Razorpay Webhook] Failed to align ATI token expiry (non-blocking):', error)
  }
}

