/**
 * Razorpay Payment Service
 * 
 * Handles all Razorpay payment operations including:
 * - Order creation (one-time and subscription)
 * - Payment verification
 * - Subscription management
 * - Multi-currency support (USD for international, INR for India)
 * - Admin discount system
 */

import crypto from 'crypto'
import { prisma } from './prisma'
import type { PaymentStatus, SubscriptionStatus } from '@prisma/client'
import { sendPaymentSuccessEmail, sendSubscriptionCancelledEmail, sendPaymentFailedEmail } from './payment-notification-service'

// ============================================================================
// CONFIGURATION
// ============================================================================

const RAZORPAY_KEY_ID = process.env.Razorpay_Live_Key || ''
const RAZORPAY_KEY_SECRET = process.env.Razorpay_Live_Secret_Key || ''
const RAZORPAY_WEBHOOK_SECRET = process.env.Razorpay_Webhook_Secret || RAZORPAY_KEY_SECRET

// Base URL for Razorpay API
const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1'

/**
 * Check if Razorpay is properly configured
 */
function ensureRazorpayConfigured(): void {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay API keys not configured. Set Razorpay_Live_Key and Razorpay_Live_Secret_Key in environment variables.')
  }
}

// ============================================================================
// PLAN PRICING CONFIGURATION
// Plans: BASIC, PRO, ENTERPRISE
// ============================================================================

export const PLAN_PRICING = {
  BASIC: {
    code: 'BASIC',
    name: 'Basic',
    monthly: {
      USD: 5900,      // $59.00 in cents
      INR: 499900,    // ₹4,999.00 in paise
    },
    yearly: {
      USD: 64900,     // $649.00 (11 months - 1 month free)
      INR: 5498900,   // ₹54,989.00 (11 months - 1 month free)
    },
    yearlyDiscountMonths: 1,
  },
  PRO: {
    code: 'PRO',
    name: 'Pro',
    monthly: {
      USD: 19900,     // $199.00 in cents
      INR: 1699900,   // ₹16,999.00 in paise
    },
    yearly: {
      USD: 218900,    // $2,189.00 (11 months - 1 month free)
      INR: 18698900,  // ₹1,86,989.00 (11 months - 1 month free)
    },
    yearlyDiscountMonths: 1,
  },
  ENTERPRISE: {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    monthly: {
      USD: 59900,     // $599.00 in cents
      INR: 4999900,   // ₹49,999.00 in paise
    },
    yearly: {
      USD: 658900,    // $6,589.00 (11 months - 1 month free)
      INR: 54998900,  // ₹5,49,989.00 (11 months - 1 month free)
    },
    yearlyDiscountMonths: 1,
  },
} as const

export type PlanCode = keyof typeof PLAN_PRICING
export type BillingCycle = 'monthly' | 'yearly'
export type Currency = 'USD' | 'INR'

// ============================================================================
// TYPES
// ============================================================================

export interface CreateOrderParams {
  userId: string
  tenantId: string
  planCode: PlanCode
  billingCycle: BillingCycle
  currency: Currency
  customerEmail: string
  customerPhone?: string
  customerCountry?: string
  discountCode?: string          // Optional coupon code
  adminDiscountId?: string       // Admin-applied discount ID
}

export interface CreateOrderResult {
  success: boolean
  orderId?: string
  razorpayOrderId?: string
  amount?: number
  currency?: string
  keyId?: string
  receipt?: string
  discountApplied?: {
    id: string
    name: string
    amount: number
    type: string
  }
  error?: string
}

export interface VerifyPaymentParams {
  razorpayOrderId: string
  razorpayPaymentId: string
  razorpaySignature: string
  userId?: string  // Optional: for ownership verification
}

export interface VerifyPaymentResult {
  success: boolean
  paymentId?: string
  subscriptionActivated?: boolean
  planCode?: string
  error?: string
}

export interface RazorpayOrder {
  id: string
  entity: string
  amount: number
  amount_paid: number
  amount_due: number
  currency: string
  receipt: string
  status: string
  created_at: number
}

export interface RazorpayPayment {
  id: string
  entity: string
  amount: number
  currency: string
  status: string
  order_id: string
  method: string
  description: string
  email: string
  contact: string
  error_code?: string
  error_description?: string
  created_at: number
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Make authenticated request to Razorpay API
 */
async function razorpayRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: Record<string, unknown>
): Promise<T> {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')
  
  const response = await fetch(`${RAZORPAY_API_BASE}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { description: 'Unknown error' } }))
    throw new Error(error.error?.description || `Razorpay API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Generate unique receipt number
 */
function generateReceipt(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `rcpt_${timestamp}_${random}`.toUpperCase()
}

/**
 * Verify Razorpay payment signature
 */
export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const body = orderId + '|' + paymentId
  const expectedSignature = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex')
  return expectedSignature === signature
}

/**
 * Verify Razorpay webhook signature
 */
export function verifyWebhookSignature(body: string, signature: string): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
    .update(body)
    .digest('hex')
  return expectedSignature === signature
}

/**
 * Get currency based on country code
 * India uses INR, all others use USD
 */
export function getCurrencyForCountry(countryCode?: string): Currency {
  if (!countryCode) return 'USD'
  return countryCode.toUpperCase() === 'IN' ? 'INR' : 'USD'
}

/**
 * Get price for a plan in the specified currency and billing cycle
 */
export function getPlanPrice(
  planCode: PlanCode,
  billingCycle: BillingCycle,
  currency: Currency
): number {
  const plan = PLAN_PRICING[planCode]
  if (!plan) throw new Error(`Invalid plan code: ${planCode}`)
  
  return plan[billingCycle][currency]
}

/**
 * Format amount for display
 */
export function formatAmount(amount: number, currency: Currency): string {
  const divisor = 100 // Both cents and paise use 100 as divisor
  const value = amount / divisor
  
  if (currency === 'INR') {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(value)
  }
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

// ============================================================================
// DISCOUNT FUNCTIONS
// ============================================================================

/**
 * Validate and apply discount
 */
export async function validateDiscount(
  discountCode: string | undefined,
  adminDiscountId: string | undefined,
  userId: string,
  userEmail: string,
  planCode: PlanCode,
  originalAmount: number,
  currency: Currency
): Promise<{
  valid: boolean
  discount?: {
    id: string
    name: string
    type: string
    value: number
    discountAmount: number
    finalAmount: number
  }
  error?: string
}> {
  // If neither code nor admin discount ID provided, no discount
  if (!discountCode && !adminDiscountId) {
    return { valid: true }
  }

  // Find the discount
  const discount = await prisma.adminDiscount.findFirst({
    where: adminDiscountId 
      ? { id: adminDiscountId, isActive: true }
      : { code: discountCode, isActive: true }
  })

  if (!discount) {
    return { valid: false, error: 'Invalid discount code' }
  }

  // Check validity period
  const now = new Date()
  if (discount.validFrom > now) {
    return { valid: false, error: 'Discount not yet valid' }
  }
  if (discount.validUntil && discount.validUntil < now) {
    return { valid: false, error: 'Discount has expired' }
  }

  // Check max uses
  if (discount.maxUses && discount.currentUses >= discount.maxUses) {
    return { valid: false, error: 'Discount has reached maximum uses' }
  }

  // Check applicable plans
  if (discount.applicablePlans.length > 0 && !discount.applicablePlans.includes(planCode)) {
    return { valid: false, error: 'Discount not applicable to this plan' }
  }

  // Check user restrictions
  if (discount.restrictedToUserIds.length > 0 && !discount.restrictedToUserIds.includes(userId)) {
    return { valid: false, error: 'This discount is not available for your account' }
  }
  if (discount.restrictedToEmails.length > 0 && !discount.restrictedToEmails.includes(userEmail)) {
    return { valid: false, error: 'This discount is not available for your email' }
  }

  // Check per-user usage limit
  const userUsageCount = await prisma.payment.count({
    where: {
      userId,
      discountId: discount.id,
      status: { in: ['CAPTURED', 'AUTHORIZED'] }
    }
  })
  if (userUsageCount >= discount.maxUsesPerUser) {
    return { valid: false, error: 'You have already used this discount' }
  }

  // Calculate discount amount
  let discountAmount: number
  if (discount.discountType === 'PERCENTAGE') {
    discountAmount = Math.floor(originalAmount * (discount.discountValue / 100))
  } else {
    // FIXED_AMOUNT - check currency matches
    if (discount.currency && discount.currency !== currency) {
      return { valid: false, error: `Discount only valid for ${discount.currency} payments` }
    }
    discountAmount = discount.discountValue
  }

  // Ensure discount doesn't exceed original amount
  discountAmount = Math.min(discountAmount, originalAmount)
  const finalAmount = originalAmount - discountAmount

  return {
    valid: true,
    discount: {
      id: discount.id,
      name: discount.name,
      type: discount.discountType,
      value: discount.discountValue,
      discountAmount,
      finalAmount,
    }
  }
}

// ============================================================================
// MAIN SERVICE FUNCTIONS
// ============================================================================

/**
 * Create a Razorpay order for payment
 */
export async function createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
  try {
    // Ensure Razorpay is configured
    ensureRazorpayConfigured()

    const {
      userId,
      tenantId,
      planCode,
      billingCycle,
      currency,
      customerEmail,
      customerPhone,
      customerCountry,
      discountCode,
      adminDiscountId,
    } = params

    // Get plan from database
    const plan = await prisma.plan.findFirst({
      where: { 
        code: { in: [`${planCode}_PLAN`, planCode] },
        status: 'ACTIVE'
      }
    })

    if (!plan) {
      return { success: false, error: `Plan ${planCode} not found` }
    }

    // Calculate original amount
    const originalAmount = getPlanPrice(planCode, billingCycle, currency)

    // Validate and apply discount
    const discountResult = await validateDiscount(
      discountCode,
      adminDiscountId,
      userId,
      customerEmail,
      planCode,
      originalAmount,
      currency
    )

    if (!discountResult.valid) {
      return { success: false, error: discountResult.error }
    }

    const finalAmount = discountResult.discount?.finalAmount ?? originalAmount
    const receipt = generateReceipt()

    // Create Razorpay order
    const razorpayOrder = await razorpayRequest<RazorpayOrder>('/orders', 'POST', {
      amount: finalAmount,
      currency,
      receipt,
      notes: {
        userId,
        tenantId,
        planCode,
        billingCycle,
        discountId: discountResult.discount?.id || '',
      },
    })

    // Create payment record in database
    await prisma.payment.create({
      data: {
        userId,
        tenantId,
        razorpayOrderId: razorpayOrder.id,
        amount: finalAmount,
        currency,
        status: 'CREATED',
        planId: plan.id,
        planCode,
        billingCycle,
        receipt,
        description: `${PLAN_PRICING[planCode].name} Plan - ${billingCycle === 'yearly' ? 'Annual' : 'Monthly'}`,
        customerEmail,
        customerPhone,
        customerCountry,
        discountId: discountResult.discount?.id,
        discountAmount: discountResult.discount?.discountAmount,
        metadata: {
          originalAmount,
          discountApplied: discountResult.discount ? {
            id: discountResult.discount.id,
            name: discountResult.discount.name,
            type: discountResult.discount.type,
            value: discountResult.discount.value,
            amount: discountResult.discount.discountAmount,
          } : null,
        },
      },
    })

    console.log(`[RazorpayService] Order created: ${razorpayOrder.id} for ${planCode} ${billingCycle} - ${currency} ${finalAmount}`)

    return {
      success: true,
      orderId: razorpayOrder.id,
      razorpayOrderId: razorpayOrder.id,
      amount: finalAmount,
      currency,
      keyId: RAZORPAY_KEY_ID,
      receipt,
      discountApplied: discountResult.discount ? {
        id: discountResult.discount.id,
        name: discountResult.discount.name,
        amount: discountResult.discount.discountAmount,
        type: discountResult.discount.type,
      } : undefined,
    }
  } catch (error) {
    console.error('[RazorpayService] Create order error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create order',
    }
  }
}

/**
 * Verify payment and activate subscription
 */
export async function verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
  try {
    // Ensure Razorpay is configured
    ensureRazorpayConfigured()

    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, userId } = params

    // Verify signature
    if (!verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
      return { success: false, error: 'Invalid payment signature' }
    }

    // Find the payment record
    const payment = await prisma.payment.findUnique({
      where: { razorpayOrderId },
      include: { plan: true, user: true, tenant: true },
    })

    if (!payment) {
      return { success: false, error: 'Payment record not found' }
    }

    // Verify user ownership if userId provided (security check)
    if (userId && payment.userId !== userId) {
      console.warn(`[RazorpayService] User ${userId} attempted to verify payment for user ${payment.userId}`)
      return { success: false, error: 'Payment verification failed' }
    }

    // If already CAPTURED, verify that subscription is actually active FOR THE CORRECT PLAN
    // AND that the subscription period hasn't expired
    // This handles multiple edge cases:
    // - Payment captured but activation failed
    // - Renewal payment where expiry job hasn't run yet (status still ACTIVE but period expired)
    if (payment.status === 'CAPTURED') {
      const now = new Date()
      
      // Check if subscription for THIS SPECIFIC PLAN is active AND not expired
      const subscription = await prisma.subscription.findFirst({
        where: { 
          tenantId: payment.tenantId,
          planId: payment.planId, // Must match the paid plan
          status: 'ACTIVE'
        }
      })
      
      const tenantPlan = await prisma.tenantPlan.findFirst({
        where: {
          tenantId: payment.tenantId,
          planId: payment.planId, // Must match the paid plan
          status: 'ACTIVE'
        }
      })

      // Verify subscription period is still valid (not expired or about to expire)
      // We check for > now (not just >= now) to ensure there's actual remaining time
      const subscriptionPeriodValid = subscription?.currentPeriodEnd && 
        new Date(subscription.currentPeriodEnd) > now
      
      const tenantPlanValid = tenantPlan?.expiresAt && 
        new Date(tenantPlan.expiresAt) > now

      // Only short-circuit if BOTH subscription AND tenant plan are:
      // 1. Active (status = ACTIVE)
      // 2. Not expired (period end / expiry > now)
      if (subscription && tenantPlan && subscriptionPeriodValid && tenantPlanValid) {
        return { 
          success: true, 
          paymentId: payment.id, 
          subscriptionActivated: true,
          planCode: payment.planCode,
        }
      }

      // Log why we're not short-circuiting for debugging
      if (subscription && tenantPlan && (!subscriptionPeriodValid || !tenantPlanValid)) {
        console.warn(`[RazorpayService] Payment ${payment.id} is CAPTURED, subscription/plan exist but period expired. Running recovery to extend.`, {
          subscriptionEnd: subscription?.currentPeriodEnd,
          tenantPlanExpiry: tenantPlan?.expiresAt,
          now: now.toISOString()
        })
      }

      // ==========================================================================
      // CAPTURED RECOVERY PATH
      // Payment was CAPTURED but activation failed - need to retry activation
      // This can happen due to:
      // - Database errors during original activation
      // - Race conditions
      // - Plan upgrade where old plan is still active
      // ==========================================================================
      console.warn(`[RazorpayService] Payment ${payment.id} is CAPTURED but subscription/plan not active for plan ${payment.planCode}, retrying activation`)
      
      // Use payment.paidAt for period calculation (not now) to maintain correct period
      // If paidAt is null (shouldn't happen for CAPTURED), fall back to now
      const periodStart = payment.paidAt || new Date()
      const periodEnd = new Date(periodStart)
      if (payment.billingCycle === 'yearly') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1)
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1)
      }

      // Deactivate any OTHER active plans (handles upgrades)
      await prisma.tenantPlan.updateMany({
        where: { 
          tenantId: payment.tenantId, 
          status: 'ACTIVE',
          planId: { not: payment.planId }
        },
        data: { status: 'INACTIVE' },
      })

      // Activate the correct plan for the tenant
      await activatePlanForTenant(payment.tenantId, payment.planId, periodEnd)
      
      // Activate tenant if needed
      await prisma.tenant.updateMany({
        where: { 
          id: payment.tenantId,
          status: { in: ['PENDING_PAYMENT', 'SUSPENDED'] }
        },
        data: { status: 'ACTIVE' }
      })

      // Extract discount metadata from payment
      const metadata = payment.metadata as any
      const originalAmount = metadata?.originalAmount

      // Create or update subscription with full metadata
      let subscriptionId: string
      const existingSubscription = await prisma.subscription.findFirst({
        where: { tenantId: payment.tenantId, status: 'ACTIVE' }
      })

      if (existingSubscription) {
        // Update existing subscription to the new plan (upgrade scenario)
        await prisma.subscription.update({
          where: { id: existingSubscription.id },
          data: {
            planId: payment.planId,
            planCode: payment.planCode,
            billingCycle: payment.billingCycle,
            currency: payment.currency,
            amount: payment.amount,
            status: 'ACTIVE',
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            nextBillingDate: periodEnd,
            discountId: payment.discountId,
            discountAmount: payment.discountAmount,
            originalAmount: originalAmount,
          },
        })
        subscriptionId = existingSubscription.id
      } else {
        // Create new subscription with full metadata
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
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            nextBillingDate: periodEnd,
            discountId: payment.discountId,
            discountAmount: payment.discountAmount,
            originalAmount: originalAmount,
          },
        })
        subscriptionId = newSubscription.id
      }

      // Link payment to subscription (critical for reporting/renewals)
      await prisma.payment.update({
        where: { id: payment.id },
        data: { subscriptionId },
      })

      // Align ATI token expiry
      await alignAtiTokenExpiry(payment.tenantId, periodEnd)

      // Send payment success email (may have been missed if original activation failed)
      try {
        const user = await prisma.user.findUnique({
          where: { id: payment.userId },
          select: { email: true, name: true, firstName: true }
        })

        if (user?.email) {
          const planCode = payment.planCode.replace('_PLAN', '') as PlanCode
          const planInfo = PLAN_PRICING[planCode]
          
          await sendPaymentSuccessEmail({
            userEmail: user.email,
            userName: user.name || user.firstName || undefined,
            planCode,
            planName: planInfo?.name || payment.planCode,
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
          console.log(`[RazorpayService] Recovery: Sent payment success email to ${user.email}`)
        }
      } catch (emailError) {
        // Log but don't fail recovery for email errors
        console.error('[RazorpayService] Recovery: Failed to send payment success email:', emailError)
      }

      console.log(`[RazorpayService] Successfully recovered activation for payment ${payment.id}`)
      
      return { 
        success: true, 
        paymentId: payment.id, 
        subscriptionActivated: true,
        planCode: payment.planCode,
      }
    }

    // For AUTHORIZED payments, we MUST re-check Razorpay in case it's now CAPTURED
    // This handles the case where webhook was delayed/missed and user retries verification
    // This is the ONLY path to activate subscription if webhook fails

    // Fetch payment details from Razorpay to confirm CURRENT status
    const razorpayPayment = await razorpayRequest<RazorpayPayment>(`/payments/${razorpayPaymentId}`)

    // ==========================================================================
    // PAYMENT STATUS VERIFICATION - ONLY ACCEPT CAPTURED
    // ==========================================================================
    // We ONLY accept 'captured' status for subscription activation because:
    //
    // 1. 'authorized' means funds are reserved but NOT yet transferred
    // 2. Capture can fail even after authorization (insufficient funds at capture time)
    // 3. If we activate on 'authorized' and webhook is delayed/missed, user gets
    //    fraudulent access with no rollback
    //
    // For 'authorized' payments:
    // - We update payment status to AUTHORIZED but DO NOT activate subscription
    // - The webhook (payment.captured) will handle activation when capture completes
    // - The webhook (payment.failed) will handle rollback if capture fails
    //
    // This conservative approach ensures users only get access after funds are
    // actually captured, preventing fraud even if webhooks are delayed/missed.
    // ==========================================================================
    if (razorpayPayment.status === 'authorized') {
      // Payment is authorized but not yet captured - update status but don't activate
      await prisma.payment.updateMany({
        where: { 
          id: payment.id,
          status: 'CREATED'
        },
        data: {
          razorpayPaymentId,
          razorpaySignature,
          status: 'AUTHORIZED',
          method: razorpayPayment.method,
        },
      })

      console.log(`[RazorpayService] Payment authorized but pending capture: ${razorpayPaymentId}`)
      
      return { 
        success: true, 
        paymentId: payment.id,
        subscriptionActivated: false,
        planCode: payment.planCode,
        // Client should show "Payment processing" message and wait for webhook/poll
      }
    }

    if (razorpayPayment.status !== 'captured') {
      return { success: false, error: `Payment not completed. Status: ${razorpayPayment.status}` }
    }

    // CRITICAL: Verify payment amount and currency match the stored order
    // This prevents tampering attacks where user might try to pay less than the order amount
    if (razorpayPayment.amount !== payment.amount) {
      console.error(`[RazorpayService] Payment amount mismatch! Order: ${payment.amount}, Paid: ${razorpayPayment.amount}`)
      return { success: false, error: 'Payment amount does not match order' }
    }

    if (razorpayPayment.currency !== payment.currency) {
      console.error(`[RazorpayService] Payment currency mismatch! Order: ${payment.currency}, Paid: ${razorpayPayment.currency}`)
      return { success: false, error: 'Payment currency does not match order' }
    }

    // Also verify the order_id matches (defense in depth)
    if (razorpayPayment.order_id !== razorpayOrderId) {
      console.error(`[RazorpayService] Order ID mismatch! Expected: ${razorpayOrderId}, Got: ${razorpayPayment.order_id}`)
      return { success: false, error: 'Payment order ID mismatch' }
    }

    // Use atomic update with status check to prevent race conditions
    // At this point, we know status is 'captured' (AUTHORIZED was handled above)
    const updatedPayment = await prisma.payment.updateMany({
      where: { 
        id: payment.id,
        status: { in: ['CREATED', 'AUTHORIZED'] }  // Can be CREATED or AUTHORIZED (from earlier attempt)
      },
      data: {
        razorpayPaymentId,
        razorpaySignature,
        status: 'CAPTURED',
        method: razorpayPayment.method,
        paidAt: new Date(),
      },
    })

    // If no rows updated, another request already processed this payment
    if (updatedPayment.count === 0) {
      // Re-fetch to return current state
      const refreshedPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      })
      return { 
        success: true, 
        paymentId: payment.id, 
        subscriptionActivated: refreshedPayment?.status === 'CAPTURED',
        planCode: payment.planCode,
      }
    }

    // Increment discount usage if applicable (only if we actually updated)
    if (payment.discountId) {
      await prisma.adminDiscount.update({
        where: { id: payment.discountId },
        data: { currentUses: { increment: 1 } },
      })
    }

    // Calculate subscription period
    const now = new Date()
    const periodEnd = new Date(now)
    if (payment.billingCycle === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1)
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1)
    }

    // Create or update subscription
    const existingSubscription = await prisma.subscription.findFirst({
      where: { tenantId: payment.tenantId, status: 'ACTIVE' },
    })

    let subscriptionId: string

    if (existingSubscription) {
      // Update existing subscription
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
          discountId: payment.discountId,
          discountAmount: payment.discountAmount,
        },
      })
      subscriptionId = existingSubscription.id
    } else {
      // Create new subscription
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
          originalAmount: (payment.metadata as any)?.originalAmount,
        },
      })
      subscriptionId = newSubscription.id
    }

    // Link payment to subscription
    await prisma.payment.update({
      where: { id: payment.id },
      data: { subscriptionId },
    })

    // Activate the plan for the tenant
    await activatePlanForTenant(payment.tenantId, payment.planId, periodEnd)

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
    await alignAtiTokenExpiry(payment.tenantId, periodEnd)

    // Send payment success email notification (async, don't block)
    sendPaymentSuccessNotification(payment, periodEnd).catch(err => {
      console.error('[RazorpayService] Failed to send payment notification:', err)
    })

    console.log(`[RazorpayService] Payment verified and subscription activated: ${payment.planCode}`)

    return {
      success: true,
      paymentId: payment.id,
      subscriptionActivated: true,
      planCode: payment.planCode,
    }
  } catch (error) {
    console.error('[RazorpayService] Verify payment error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to verify payment',
    }
  }
}

/**
 * Activate a plan for a tenant
 */
async function activatePlanForTenant(tenantId: string, planId: string, expiresAt: Date): Promise<void> {
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

  console.log(`[RazorpayService] Plan activated for tenant ${tenantId} until ${expiresAt}`)
}

/**
 * Align ATI token expiry with subscription period
 * 
 * For paid signups (AUTO_GENERATED tokens), the ATI token expiry should match
 * the subscription period end. This ensures:
 * 1. Users who signed up via paid signup lose access when subscription expires
 * 2. On renewal, their access is extended automatically
 * 
 * For admin-issued member ATIs, this also ensures they don't exceed the parent
 * tenant's subscription period.
 */
async function alignAtiTokenExpiry(tenantId: string, subscriptionEndDate: Date): Promise<void> {
  try {
    // Update all AUTO_GENERATED tokens for this tenant
    // These are the paid signup tokens that should expire with the subscription
    const autoGeneratedResult = await prisma.aTIToken.updateMany({
      where: {
        tenantId,
        tokenType: 'AUTO_GENERATED',
        // Only update if expiry is null or earlier than new date
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
      console.log(`[RazorpayService] Updated expiry for ${autoGeneratedResult.count} AUTO_GENERATED ATI tokens to ${subscriptionEndDate}`)
    }

    // Also cap any MANUAL tokens that exceed the subscription period
    // This ensures admin-issued member ATIs don't outlive the tenant's subscription
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
      console.log(`[RazorpayService] Capped expiry for ${manualResult.count} MANUAL ATI tokens to subscription end ${subscriptionEndDate}`)
    }
  } catch (error) {
    // Log but don't fail the subscription activation
    console.error('[RazorpayService] Failed to align ATI token expiry (non-blocking):', error)
  }
}

/**
 * Send payment success notification email
 */
async function sendPaymentSuccessNotification(
  payment: {
    userId: string
    planCode: string
    amount: number
    currency: string
    billingCycle: string
    receipt: string | null
    discountAmount: number | null
    metadata: any
    user: { email: string; name: string | null; firstName: string | null }
    plan: { name: string }
  },
  nextBillingDate: Date
): Promise<void> {
  const planCode = payment.planCode.replace('_PLAN', '') as PlanCode
  const planInfo = PLAN_PRICING[planCode]
  
  await sendPaymentSuccessEmail({
    userEmail: payment.user.email,
    userName: payment.user.name || payment.user.firstName || undefined,
    planCode,
    planName: planInfo?.name || payment.plan.name,
    amount: payment.amount,
    currency: payment.currency as Currency,
    billingCycle: payment.billingCycle as 'monthly' | 'yearly',
    paymentId: payment.receipt || 'N/A',
    receiptNumber: payment.receipt || 'N/A',
    nextBillingDate,
    discountApplied: payment.discountAmount ? {
      name: 'Discount',
      amount: payment.discountAmount,
    } : undefined,
  })
}

/**
 * Cancel a subscription
 */
export async function cancelSubscription(
  subscriptionId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { user: true, plan: true },
    })

    if (!subscription) {
      return { success: false, error: 'Subscription not found' }
    }

    // Update subscription status
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason,
      },
    })

    // Note: We don't immediately deactivate the plan - it should remain active until currentPeriodEnd
    // A background job should handle plan deactivation at expiry

    // Send cancellation email (async, don't block)
    if (subscription.user && subscription.currentPeriodEnd) {
      const planCode = subscription.planCode.replace('_PLAN', '') as PlanCode
      const planInfo = PLAN_PRICING[planCode]
      
      sendSubscriptionCancelledEmail({
        userEmail: subscription.user.email,
        userName: subscription.user.name || subscription.user.firstName || undefined,
        planName: planInfo?.name || subscription.plan.name,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelReason: reason,
      }).catch(err => {
        console.error('[RazorpayService] Failed to send cancellation email:', err)
      })
    }

    console.log(`[RazorpayService] Subscription cancelled: ${subscriptionId}`)

    return { success: true }
  } catch (error) {
    console.error('[RazorpayService] Cancel subscription error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel subscription',
    }
  }
}

/**
 * Get current subscription for a tenant
 */
export async function getCurrentSubscription(tenantId: string) {
  return prisma.subscription.findFirst({
    where: { 
      tenantId,
      status: { in: ['ACTIVE', 'PENDING'] },
    },
    include: {
      plan: true,
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Get payment history for a user
 */
export async function getPaymentHistory(userId: string, limit = 10) {
  return prisma.payment.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      plan: {
        select: { code: true, name: true },
      },
    },
  })
}

// ============================================================================
// ADMIN FUNCTIONS (BACKDOOR PRICING)
// ============================================================================

/**
 * Create an admin discount (for special pricing)
 */
export async function createAdminDiscount(params: {
  createdByUserId: string
  name: string
  description?: string
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT'
  discountValue: number
  currency?: string
  code?: string
  applicablePlans?: PlanCode[]
  maxUses?: number
  maxUsesPerUser?: number
  validUntil?: Date
  restrictedToUserIds?: string[]
  restrictedToEmails?: string[]
}): Promise<{ success: boolean; discountId?: string; error?: string }> {
  try {
    const discount = await prisma.adminDiscount.create({
      data: {
        createdByUserId: params.createdByUserId,
        name: params.name,
        description: params.description,
        discountType: params.discountType,
        discountValue: params.discountValue,
        currency: params.currency,
        code: params.code,
        applicablePlans: params.applicablePlans || [],
        maxUses: params.maxUses,
        maxUsesPerUser: params.maxUsesPerUser || 1,
        validUntil: params.validUntil,
        restrictedToUserIds: params.restrictedToUserIds || [],
        restrictedToEmails: params.restrictedToEmails || [],
        isActive: true,
      },
    })

    console.log(`[RazorpayService] Admin discount created: ${discount.id} - ${params.name}`)

    return { success: true, discountId: discount.id }
  } catch (error) {
    console.error('[RazorpayService] Create admin discount error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create discount',
    }
  }
}

/**
 * Get all admin discounts
 */
export async function getAdminDiscounts(includeInactive = false) {
  return prisma.adminDiscount.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: {
        select: { id: true, email: true, name: true },
      },
      _count: {
        select: { payments: true },
      },
    },
  })
}

/**
 * Deactivate an admin discount
 */
export async function deactivateDiscount(discountId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.adminDiscount.update({
      where: { id: discountId },
      data: { isActive: false },
    })
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to deactivate discount',
    }
  }
}

/**
 * Generate a special pricing link for a user
 * Admin can use this to give custom pricing to specific users
 */
export async function generateSpecialPricingForUser(params: {
  adminUserId: string
  targetEmail: string
  planCode: PlanCode
  discountPercentage: number
  validDays?: number
}): Promise<{ success: boolean; discountCode?: string; error?: string }> {
  const { adminUserId, targetEmail, planCode, discountPercentage, validDays = 30 } = params

  // Generate unique code
  const code = `SPECIAL_${targetEmail.split('@')[0].toUpperCase()}_${Date.now().toString(36)}`.substring(0, 20)

  const validUntil = new Date()
  validUntil.setDate(validUntil.getDate() + validDays)

  const result = await createAdminDiscount({
    createdByUserId: adminUserId,
    name: `Special pricing for ${targetEmail}`,
    description: `${discountPercentage}% discount on ${planCode} plan`,
    discountType: 'PERCENTAGE',
    discountValue: discountPercentage,
    code,
    applicablePlans: [planCode],
    maxUses: 1,
    maxUsesPerUser: 1,
    validUntil,
    restrictedToEmails: [targetEmail],
  })

  if (result.success) {
    return { success: true, discountCode: code }
  }

  return result
}

// ============================================================================
// RAZORPAY SUBSCRIPTION SUPPORT (for auto-renewal)
// ============================================================================

/**
 * Create a Razorpay Subscription for recurring billing
 * This enables auto-renewal without user intervention
 * 
 * Prerequisites:
 * 1. Create Razorpay Plans in the Razorpay Dashboard (or via API) for each plan/cycle combo
 * 2. Store plan IDs in environment variables or database
 */
export interface CreateSubscriptionParams {
  tenantId: string
  userId: string
  planCode: PlanCode
  billingCycle: BillingCycle
  currency: Currency
  customerEmail: string
  customerName?: string
  customerPhone?: string
}

export interface CreateSubscriptionResult {
  success: boolean
  subscriptionId?: string
  razorpaySubscriptionId?: string
  shortUrl?: string // Payment link for customer
  error?: string
}

/**
 * Get Razorpay Plan ID for a given plan/cycle/currency combination
 * Checks in order: environment variable, database PlanPricing table
 */
async function getRazorpayPlanId(planCode: PlanCode, billingCycle: BillingCycle, currency: Currency): Promise<string | null> {
  // First check environment variable (fastest)
  const envKey = `RAZORPAY_PLAN_${planCode}_${billingCycle.toUpperCase()}_${currency}`
  const envPlanId = process.env[envKey]
  if (envPlanId) {
    console.log(`[RazorpayService] Using Razorpay Plan ID from env: ${envKey}`)
    return envPlanId
  }
  
  // Check database PlanPricing table
  try {
    const planPricing = await prisma.planPricing.findFirst({
      where: {
        planCode,
        billingCycle: billingCycle.toUpperCase(), // DB stores as MONTHLY/YEARLY
        isActive: true,
      },
      select: {
        razorpayPlanIdUSD: true,
        razorpayPlanIdINR: true,
      }
    })
    
    if (planPricing) {
      const razorpayPlanId = currency === 'INR' 
        ? planPricing.razorpayPlanIdINR 
        : planPricing.razorpayPlanIdUSD
      
      if (razorpayPlanId) {
        console.log(`[RazorpayService] Using Razorpay Plan ID from database: ${razorpayPlanId}`)
        return razorpayPlanId
      }
    }
  } catch (error) {
    console.error('[RazorpayService] Error fetching Razorpay Plan ID from database:', error)
  }
  
  return null
}

/**
 * Create a Razorpay Subscription for recurring billing
 * 
 * Note: This requires Razorpay Plans to be created first in the Razorpay Dashboard.
 * Plans define the recurring billing cycle and amount.
 */
export async function createRazorpaySubscription(
  params: CreateSubscriptionParams
): Promise<CreateSubscriptionResult> {
  try {
    ensureRazorpayConfigured()
    
    const { tenantId, userId, planCode, billingCycle, currency, customerEmail, customerName, customerPhone } = params
    
    // Get the Razorpay Plan ID for this plan/cycle/currency
    const razorpayPlanId = await getRazorpayPlanId(planCode, billingCycle, currency)
    
    if (!razorpayPlanId) {
      console.warn(`[RazorpayService] No Razorpay Plan ID configured for ${planCode}/${billingCycle}/${currency}`)
      return { 
        success: false, 
        error: `Auto-renewal not available for ${planCode} ${billingCycle} plan. Please use one-time payment.` 
      }
    }
    
    // Create or get Razorpay customer
    let customerId: string
    
    // Check if we already have a customer for this user
    const existingSubscription = await prisma.subscription.findFirst({
      where: { userId, razorpayCustomerId: { not: null } },
      select: { razorpayCustomerId: true }
    })
    
    if (existingSubscription?.razorpayCustomerId) {
      customerId = existingSubscription.razorpayCustomerId
    } else {
      // Create new Razorpay customer
      const customer = await razorpayRequest<{ id: string }>('/customers', 'POST', {
        name: customerName || customerEmail.split('@')[0],
        email: customerEmail,
        contact: customerPhone || undefined,
        notes: { tenantId, userId }
      })
      customerId = customer.id
    }
    
    // Create Razorpay Subscription
    const subscription = await razorpayRequest<{
      id: string
      plan_id: string
      customer_id: string
      status: string
      short_url: string
    }>('/subscriptions', 'POST', {
      plan_id: razorpayPlanId,
      customer_id: customerId,
      total_count: billingCycle === 'yearly' ? 12 : 120, // 1 year or 10 years of monthly
      quantity: 1,
      customer_notify: 1,
      notes: { tenantId, userId, planCode, billingCycle }
    })
    
    // Create internal subscription record
    const plan = await prisma.plan.findFirst({
      where: { code: { in: [`${planCode}_PLAN`, planCode] }, status: 'ACTIVE' }
    })
    
    const internalSubscription = await prisma.subscription.create({
      data: {
        tenantId,
        userId,
        planId: plan?.id || '',
        planCode,
        billingCycle,
        currency,
        amount: getPlanPrice(planCode, billingCycle, currency),
        status: 'CREATED',
        razorpaySubscriptionId: subscription.id,
        razorpayPlanId: razorpayPlanId,
        razorpayCustomerId: customerId,
      }
    })
    
    console.log(`[RazorpayService] Created Razorpay subscription: ${subscription.id} for ${planCode} ${billingCycle}`)
    
    return {
      success: true,
      subscriptionId: internalSubscription.id,
      razorpaySubscriptionId: subscription.id,
      shortUrl: subscription.short_url, // Payment link for customer
    }
  } catch (error) {
    console.error('[RazorpayService] Create subscription error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create subscription'
    }
  }
}

/**
 * Cancel a Razorpay Subscription
 */
export async function cancelRazorpaySubscription(
  razorpaySubscriptionId: string,
  cancelAtCycleEnd: boolean = true
): Promise<{ success: boolean; error?: string }> {
  try {
    ensureRazorpayConfigured()
    
    await razorpayRequest(`/subscriptions/${razorpaySubscriptionId}/cancel`, 'POST', {
      cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0
    })
    
    console.log(`[RazorpayService] Cancelled Razorpay subscription: ${razorpaySubscriptionId}`)
    
    return { success: true }
  } catch (error) {
    console.error('[RazorpayService] Cancel subscription error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel subscription'
    }
  }
}

