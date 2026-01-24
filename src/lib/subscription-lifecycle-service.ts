/**
 * Subscription Lifecycle Service
 * 
 * Handles subscription lifecycle events:
 * - Plan expiry processing
 * - Subscription renewal (subscription.charged webhook)
 * - Expiry warning notifications
 * - Cleanup of abandoned pending-payment tenants
 */

import { prisma } from './prisma'
import { sendEmail, SITE_URL } from './mailer'
import { formatAmount, type Currency } from './razorpay-service'

// ============================================================================
// EXPIRY PROCESSING
// ============================================================================

/**
 * Process expired subscriptions and tenant plans
 * Should be called by a scheduled job (e.g., daily cron)
 */
export async function processExpiredSubscriptions(): Promise<{
  expiredSubscriptions: number
  expiredTenantPlans: number
  deactivatedTenants: number
}> {
  const now = new Date()
  let expiredSubscriptions = 0
  let expiredTenantPlans = 0
  let deactivatedTenants = 0

  try {
    // 1. Find and expire subscriptions past their period end (only ACTIVE or CANCELLED ones)
    const subscriptionsToExpire = await prisma.subscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'CANCELLED'] },
        currentPeriodEnd: { lt: now },
      },
      include: {
        user: { select: { email: true, name: true, firstName: true } },
        plan: { select: { name: true } },
        tenant: { select: { id: true, atiId: true, registrationSource: true } },
      },
    })

    for (const subscription of subscriptionsToExpire) {
      // Update subscription status
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'EXPIRED' },
      })

      // Deactivate the tenant plan
      await prisma.tenantPlan.updateMany({
        where: {
          tenantId: subscription.tenantId,
          status: 'ACTIVE',
        },
        data: { status: 'EXPIRED' },
      })

      expiredSubscriptions++
      expiredTenantPlans++

      // Send expiry notification email
      if (subscription.user?.email) {
        sendSubscriptionExpiredEmail({
          userEmail: subscription.user.email,
          userName: subscription.user.name || subscription.user.firstName || undefined,
          planName: subscription.plan.name,
        }).catch(err => {
          console.error(`[SubscriptionLifecycle] Failed to send expiry email: ${err}`)
        })
      }

      console.log(`[SubscriptionLifecycle] Expired subscription: ${subscription.id} for tenant ${subscription.tenant.atiId}`)
    }

    // 2. Find and expire tenant plans without subscriptions that have expired
    const tenantPlansToExpire = await prisma.tenantPlan.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: now },
        // Don't process ones we just handled via subscriptions
        tenant: {
          subscriptions: {
            none: { status: { in: ['ACTIVE', 'CANCELLED'] } }
          }
        }
      },
    })

    for (const tenantPlan of tenantPlansToExpire) {
      await prisma.tenantPlan.update({
        where: { id: tenantPlan.id },
        data: { status: 'EXPIRED' },
      })
      expiredTenantPlans++
    }

    // 3. Deactivate PAID_SIGNUP tenants that have no active plans
    // (Don't touch MANUAL_ATI tenants as they may have custom arrangements)
    const tenantsToDeactivate = await prisma.tenant.findMany({
      where: {
        registrationSource: 'PAID_SIGNUP',
        status: 'ACTIVE',
        tenantPlans: {
          none: { status: 'ACTIVE' }
        },
        subscriptions: {
          none: { status: 'ACTIVE' }
        }
      }
    })

    for (const tenant of tenantsToDeactivate) {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'SUSPENDED' },
      })
      deactivatedTenants++
      console.log(`[SubscriptionLifecycle] Suspended tenant with no active plan: ${tenant.atiId}`)
    }

    console.log(`[SubscriptionLifecycle] Processed: ${expiredSubscriptions} subscriptions, ${expiredTenantPlans} plans, ${deactivatedTenants} tenants`)

  } catch (error) {
    console.error('[SubscriptionLifecycle] Error processing expired subscriptions:', error)
  }

  return { expiredSubscriptions, expiredTenantPlans, deactivatedTenants }
}

// ============================================================================
// RENEWAL PROCESSING (for subscription.charged webhook)
// ============================================================================

/**
 * Handle subscription renewal from Razorpay subscription.charged webhook
 * Extends the subscription period and creates a payment record
 */
export async function handleSubscriptionRenewal(params: {
  razorpaySubscriptionId: string
  razorpayPaymentId: string
  amount: number
  currency: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { razorpaySubscriptionId, razorpayPaymentId, amount, currency } = params

    // Find the subscription by Razorpay ID
    const subscription = await prisma.subscription.findFirst({
      where: { razorpaySubscriptionId },
      include: { plan: true, tenant: true },
    })

    if (!subscription) {
      console.warn(`[SubscriptionLifecycle] Subscription not found for Razorpay ID: ${razorpaySubscriptionId}`)
      return { success: false, error: 'Subscription not found' }
    }

    // Calculate new period
    const now = new Date()
    const periodEnd = new Date(now)
    if (subscription.billingCycle === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1)
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1)
    }

    // Create payment record for renewal
    const payment = await prisma.payment.create({
      data: {
        userId: subscription.userId,
        tenantId: subscription.tenantId,
        subscriptionId: subscription.id,
        razorpayPaymentId,
        amount,
        currency,
        status: 'CAPTURED',
        planId: subscription.planId,
        planCode: subscription.planCode,
        billingCycle: subscription.billingCycle,
        description: `Renewal: ${subscription.plan.name} Plan - ${subscription.billingCycle === 'yearly' ? 'Annual' : 'Monthly'}`,
        paidAt: now,
      },
    })

    // Update subscription period
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextBillingDate: periodEnd,
      },
    })

    // Extend tenant plan
    await prisma.tenantPlan.updateMany({
      where: {
        tenantId: subscription.tenantId,
        planId: subscription.planId,
        status: 'ACTIVE',
      },
      data: {
        expiresAt: periodEnd,
      },
    })

    // If tenant was suspended due to expired plan, reactivate
    await prisma.tenant.updateMany({
      where: {
        id: subscription.tenantId,
        status: 'SUSPENDED',
      },
      data: { status: 'ACTIVE' },
    })

    console.log(`[SubscriptionLifecycle] Renewal processed: ${subscription.id}, new period ends ${periodEnd}`)

    return { success: true }
  } catch (error) {
    console.error('[SubscriptionLifecycle] Renewal processing error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Renewal processing failed',
    }
  }
}

// ============================================================================
// EXPIRY WARNING NOTIFICATIONS
// ============================================================================

/**
 * Send expiry warning emails to users whose subscriptions are about to expire
 * Should be called by a scheduled job (e.g., daily)
 */
export async function sendExpiryWarningNotifications(daysBeforeExpiry = 7): Promise<number> {
  const now = new Date()
  const warningDate = new Date(now)
  warningDate.setDate(warningDate.getDate() + daysBeforeExpiry)

  let notificationsSent = 0

  try {
    // Find subscriptions expiring within the warning period
    const expiringSubscriptions = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        currentPeriodEnd: {
          gt: now,
          lte: warningDate,
        },
        // Don't notify for auto-renewal subscriptions (they have razorpaySubscriptionId)
        razorpaySubscriptionId: null,
      },
      include: {
        user: { select: { email: true, name: true, firstName: true } },
        plan: { select: { name: true } },
      },
    })

    for (const subscription of expiringSubscriptions) {
      if (!subscription.user?.email || !subscription.currentPeriodEnd) continue

      const daysRemaining = Math.ceil(
        (subscription.currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      )

      // Check if we already sent a warning recently (avoid spam)
      const recentNotification = await prisma.auditLog.findFirst({
        where: {
          action: 'EXPIRY_WARNING_SENT',
          resource: `subscription:${subscription.id}`,
          createdAt: { gt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) }, // Last 3 days
        },
      })

      if (recentNotification) continue

      // Send warning email
      await sendExpiryWarningEmail({
        userEmail: subscription.user.email,
        userName: subscription.user.name || subscription.user.firstName || undefined,
        planName: subscription.plan.name,
        expiryDate: subscription.currentPeriodEnd,
        daysRemaining,
        amount: subscription.amount,
        currency: subscription.currency as Currency,
        billingCycle: subscription.billingCycle as 'monthly' | 'yearly',
      })

      // Log that we sent the notification
      await prisma.auditLog.create({
        data: {
          action: 'EXPIRY_WARNING_SENT',
          resource: `subscription:${subscription.id}`,
          meta: { daysRemaining, expiryDate: subscription.currentPeriodEnd },
        },
      })

      notificationsSent++
    }

    console.log(`[SubscriptionLifecycle] Sent ${notificationsSent} expiry warning notifications`)
  } catch (error) {
    console.error('[SubscriptionLifecycle] Error sending expiry warnings:', error)
  }

  return notificationsSent
}

// ============================================================================
// CLEANUP FUNCTIONS
// ============================================================================

/**
 * Clean up abandoned pending-payment tenants
 * Deletes tenants that signed up but never completed payment
 */
export async function cleanupAbandonedSignups(gracePeriodDays = 7): Promise<number> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - gracePeriodDays)

  try {
    // First, delete users belonging to these tenants
    const tenantsToDelete = await prisma.tenant.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        registrationSource: 'PAID_SIGNUP',
        createdAt: { lt: cutoffDate },
      },
      select: { id: true },
    })

    if (tenantsToDelete.length === 0) return 0

    const tenantIds = tenantsToDelete.map(t => t.id)

    // Delete related records in order (respecting foreign keys)
    await prisma.project.deleteMany({ where: { user: { tenantId: { in: tenantIds } } } })
    await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await prisma.aTIToken.deleteMany({ where: { tenantId: { in: tenantIds } } })
    
    // Finally delete tenants
    const result = await prisma.tenant.deleteMany({
      where: { id: { in: tenantIds } },
    })

    console.log(`[SubscriptionLifecycle] Cleaned up ${result.count} abandoned signup tenants`)
    return result.count
  } catch (error) {
    console.error('[SubscriptionLifecycle] Error cleaning up abandoned signups:', error)
    return 0
  }
}

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================

async function sendExpiryWarningEmail(params: {
  userEmail: string
  userName?: string
  planName: string
  expiryDate: Date
  daysRemaining: number
  amount: number
  currency: Currency
  billingCycle: 'monthly' | 'yearly'
}): Promise<void> {
  const { userEmail, userName, planName, expiryDate, daysRemaining, amount, currency, billingCycle } = params

  const formattedDate = expiryDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const formattedAmount = formatAmount(amount, currency)

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        .container { font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
        .body { background: #1e293b; padding: 30px; border-radius: 0 0 12px 12px; color: #e2e8f0; }
        .cta { display: inline-block; background: #0ea5e9; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 20px; }
        .warning { background: #fef3c7; color: #92400e; padding: 15px; border-radius: 8px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>⚠️ Subscription Expiring Soon</h1>
        </div>
        <div class="body">
          <p>Hi ${userName || 'there'},</p>
          
          <div class="warning">
            <strong>Your ${planName} subscription expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}</strong>
            <br/>Expiry Date: ${formattedDate}
          </div>
          
          <p>To continue using PatentNest without interruption, please renew your subscription.</p>
          
          <p>Renewal amount: <strong>${formattedAmount}/${billingCycle === 'yearly' ? 'year' : 'month'}</strong></p>
          
          <a href="${SITE_URL}/pricing" class="cta">Renew Now →</a>
          
          <p style="margin-top: 30px; font-size: 14px; color: #94a3b8;">
            If you have any questions, please contact support@patentnest.ai
          </p>
        </div>
      </div>
    </body>
    </html>
  `

  await sendEmail({
    to: userEmail,
    toName: userName,
    subject: `⚠️ Your ${planName} subscription expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`,
    html,
    text: `Your ${planName} subscription expires on ${formattedDate}. Renew at ${SITE_URL}/pricing`,
  })
}

async function sendSubscriptionExpiredEmail(params: {
  userEmail: string
  userName?: string
  planName: string
}): Promise<void> {
  const { userEmail, userName, planName } = params

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        .container { font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
        .body { background: #1e293b; padding: 30px; border-radius: 0 0 12px 12px; color: #e2e8f0; }
        .cta { display: inline-block; background: #10b981; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Subscription Expired</h1>
        </div>
        <div class="body">
          <p>Hi ${userName || 'there'},</p>
          
          <p>Your <strong>${planName}</strong> subscription has expired. You no longer have access to premium features.</p>
          
          <p>Don't worry - your data is safe! Resubscribe anytime to continue where you left off.</p>
          
          <a href="${SITE_URL}/pricing" class="cta">Resubscribe Now →</a>
          
          <p style="margin-top: 30px; font-size: 14px; color: #94a3b8;">
            Need help? Contact support@patentnest.ai
          </p>
        </div>
      </div>
    </body>
    </html>
  `

  await sendEmail({
    to: userEmail,
    toName: userName,
    subject: `Your ${planName} subscription has expired`,
    html,
    text: `Your ${planName} subscription has expired. Resubscribe at ${SITE_URL}/pricing`,
  })
}

