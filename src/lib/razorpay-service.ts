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

    // Idempotency check: if already captured or authorized, return success without re-processing
    if (payment.status === 'CAPTURED' || payment.status === 'AUTHORIZED') {
      return { 
        success: true, 
        paymentId: payment.id, 
        subscriptionActivated: payment.status === 'CAPTURED',
        planCode: payment.planCode,
      }
    }

    // Fetch payment details from Razorpay to confirm status
    const razorpayPayment = await razorpayRequest<RazorpayPayment>(`/payments/${razorpayPaymentId}`)

    // Only process if Razorpay confirms payment is captured/authorized
    if (razorpayPayment.status !== 'captured' && razorpayPayment.status !== 'authorized') {
      return { success: false, error: `Payment not completed. Status: ${razorpayPayment.status}` }
    }

    // Use atomic update with status check to prevent race conditions
    const updatedPayment = await prisma.payment.updateMany({
      where: { 
        id: payment.id,
        status: 'CREATED'  // Only update if still in CREATED status
      },
      data: {
        razorpayPaymentId,
        razorpaySignature,
        status: razorpayPayment.status === 'captured' ? 'CAPTURED' : 'AUTHORIZED',
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

