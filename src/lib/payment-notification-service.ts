/**
 * Payment Notification Service
 * 
 * Handles email notifications for payment events:
 * - Payment successful
 * - Subscription activated
 * - Subscription renewal
 * - Subscription cancelled
 * - Payment failed
 */

import { sendEmail, SITE_URL } from './mailer'
import { formatAmount, PLAN_PRICING, type PlanCode, type Currency } from './razorpay-service'

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================

const EMAIL_STYLES = `
  <style>
    .email-container {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8fafc;
    }
    .email-header {
      background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
      color: white;
      padding: 40px 30px;
      border-radius: 12px 12px 0 0;
      text-align: center;
    }
    .email-header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 600;
    }
    .email-header p {
      margin: 10px 0 0;
      opacity: 0.9;
    }
    .email-body {
      background: white;
      padding: 30px;
      border-radius: 0 0 12px 12px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .greeting {
      font-size: 18px;
      color: #1e293b;
      margin-bottom: 20px;
    }
    .details-box {
      background: #f1f5f9;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .details-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e2e8f0;
    }
    .details-row:last-child {
      border-bottom: none;
    }
    .details-label {
      color: #64748b;
      font-size: 14px;
    }
    .details-value {
      color: #1e293b;
      font-weight: 600;
      font-size: 14px;
    }
    .amount-highlight {
      font-size: 32px;
      font-weight: 700;
      color: #0ea5e9;
      text-align: center;
      margin: 20px 0;
    }
    .cta-button {
      display: inline-block;
      background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
      color: white !important;
      padding: 14px 32px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      margin: 20px 0;
    }
    .cta-container {
      text-align: center;
      margin: 30px 0;
    }
    .footer {
      text-align: center;
      color: #94a3b8;
      font-size: 12px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      margin-top: 30px;
    }
    .success-icon {
      width: 64px;
      height: 64px;
      background: #10b981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
    }
    .warning-badge {
      background: #fef3c7;
      color: #92400e;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      display: inline-block;
    }
    .plan-features {
      list-style: none;
      padding: 0;
      margin: 20px 0;
    }
    .plan-features li {
      padding: 8px 0;
      color: #475569;
      font-size: 14px;
    }
    .plan-features li::before {
      content: "✓";
      color: #10b981;
      font-weight: bold;
      margin-right: 10px;
    }
  </style>
`

// ============================================================================
// NOTIFICATION FUNCTIONS
// ============================================================================

export interface PaymentSuccessParams {
  userEmail: string
  userName?: string
  planCode: PlanCode
  planName: string
  amount: number
  currency: Currency
  billingCycle: 'monthly' | 'yearly'
  paymentId: string
  receiptNumber: string
  nextBillingDate: Date
  discountApplied?: {
    name: string
    amount: number
  }
}

/**
 * Send payment success email
 */
export async function sendPaymentSuccessEmail(params: PaymentSuccessParams): Promise<void> {
  const {
    userEmail,
    userName,
    planCode,
    planName,
    amount,
    currency,
    billingCycle,
    paymentId,
    receiptNumber,
    nextBillingDate,
    discountApplied,
  } = params

  const planFeatures = getPlanFeatures(planCode)
  const formattedAmount = formatAmount(amount, currency)
  const formattedNextBilling = nextBillingDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      ${EMAIL_STYLES}
    </head>
    <body>
      <div class="email-container">
        <div class="email-header">
          <div style="font-size: 48px; margin-bottom: 10px;">✓</div>
          <h1>Payment Successful!</h1>
          <p>Welcome to PatentNest ${planName}</p>
        </div>
        
        <div class="email-body">
          <p class="greeting">Hi ${userName || 'there'},</p>
          
          <p style="color: #475569; line-height: 1.6;">
            Thank you for your purchase! Your payment has been processed successfully and your 
            <strong>${planName} plan</strong> is now active.
          </p>
          
          <div class="amount-highlight">
            ${formattedAmount}
            <span style="font-size: 14px; font-weight: normal; color: #64748b;">
              / ${billingCycle === 'yearly' ? 'year' : 'month'}
            </span>
          </div>
          
          ${discountApplied ? `
            <div style="text-align: center; margin-bottom: 20px;">
              <span class="warning-badge">
                🎉 ${discountApplied.name}: -${formatAmount(discountApplied.amount, currency)}
              </span>
            </div>
          ` : ''}
          
          <div class="details-box">
            <div class="details-row">
              <span class="details-label">Plan</span>
              <span class="details-value">${planName}</span>
            </div>
            <div class="details-row">
              <span class="details-label">Billing Cycle</span>
              <span class="details-value">${billingCycle === 'yearly' ? 'Annual' : 'Monthly'}</span>
            </div>
            <div class="details-row">
              <span class="details-label">Receipt Number</span>
              <span class="details-value">${receiptNumber}</span>
            </div>
            <div class="details-row">
              <span class="details-label">Payment ID</span>
              <span class="details-value">${paymentId}</span>
            </div>
            <div class="details-row">
              <span class="details-label">Next Billing Date</span>
              <span class="details-value">${formattedNextBilling}</span>
            </div>
          </div>
          
          <h3 style="color: #1e293b; margin-top: 30px;">Your plan includes:</h3>
          <ul class="plan-features">
            ${planFeatures.map(f => `<li>${f}</li>`).join('')}
          </ul>
          
          <div class="cta-container">
            <a href="${SITE_URL}/dashboard" class="cta-button">
              Go to Dashboard →
            </a>
          </div>
          
          <div class="footer">
            <p>
              This email confirms your subscription to PatentNest ${planName} plan.<br>
              If you have any questions, please contact us at support@patentnest.ai
            </p>
            <p style="margin-top: 15px;">
              © ${new Date().getFullYear()} PatentNest. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `

  const text = `
Payment Successful!

Hi ${userName || 'there'},

Thank you for your purchase! Your payment of ${formattedAmount} has been processed successfully.

Plan: ${planName}
Billing Cycle: ${billingCycle === 'yearly' ? 'Annual' : 'Monthly'}
Receipt: ${receiptNumber}
Payment ID: ${paymentId}
Next Billing: ${formattedNextBilling}

Your plan includes:
${planFeatures.map(f => `- ${f}`).join('\n')}

Visit your dashboard: ${SITE_URL}/dashboard

If you have any questions, please contact support@patentnest.ai

© ${new Date().getFullYear()} PatentNest
  `.trim()

  try {
    await sendEmail({
      to: userEmail,
      toName: userName,
      subject: `✓ Payment Confirmed - ${planName} Plan Activated`,
      html,
      text,
    })
    console.log(`[PaymentNotification] Payment success email sent to ${userEmail}`)
  } catch (error) {
    console.error(`[PaymentNotification] Failed to send payment success email to ${userEmail}:`, error)
  }
}

export interface SubscriptionCancelledParams {
  userEmail: string
  userName?: string
  planName: string
  currentPeriodEnd: Date
  cancelReason?: string
}

/**
 * Send subscription cancelled email
 */
export async function sendSubscriptionCancelledEmail(params: SubscriptionCancelledParams): Promise<void> {
  const { userEmail, userName, planName, currentPeriodEnd, cancelReason } = params

  const formattedEndDate = currentPeriodEnd.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      ${EMAIL_STYLES}
    </head>
    <body>
      <div class="email-container">
        <div class="email-header" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);">
          <h1>Subscription Cancelled</h1>
          <p>We're sorry to see you go</p>
        </div>
        
        <div class="email-body">
          <p class="greeting">Hi ${userName || 'there'},</p>
          
          <p style="color: #475569; line-height: 1.6;">
            Your <strong>${planName}</strong> subscription has been cancelled. 
            You'll continue to have access to all features until your current billing period ends.
          </p>
          
          <div class="details-box">
            <div class="details-row">
              <span class="details-label">Plan</span>
              <span class="details-value">${planName}</span>
            </div>
            <div class="details-row">
              <span class="details-label">Access Until</span>
              <span class="details-value" style="color: #f59e0b;">${formattedEndDate}</span>
            </div>
            ${cancelReason ? `
              <div class="details-row">
                <span class="details-label">Reason</span>
                <span class="details-value">${cancelReason}</span>
              </div>
            ` : ''}
          </div>
          
          <p style="color: #475569; line-height: 1.6;">
            Changed your mind? You can resubscribe anytime to continue using PatentNest's 
            premium features.
          </p>
          
          <div class="cta-container">
            <a href="${SITE_URL}/pricing" class="cta-button" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
              Resubscribe →
            </a>
          </div>
          
          <div class="footer">
            <p>
              We'd love to hear your feedback. Reply to this email to let us know how we can improve.
            </p>
            <p style="margin-top: 15px;">
              © ${new Date().getFullYear()} PatentNest. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `

  const text = `
Subscription Cancelled

Hi ${userName || 'there'},

Your ${planName} subscription has been cancelled. You'll continue to have access until ${formattedEndDate}.

Changed your mind? Resubscribe at: ${SITE_URL}/pricing

© ${new Date().getFullYear()} PatentNest
  `.trim()

  try {
    await sendEmail({
      to: userEmail,
      toName: userName,
      subject: `Your ${planName} subscription has been cancelled`,
      html,
      text,
    })
    console.log(`[PaymentNotification] Cancellation email sent to ${userEmail}`)
  } catch (error) {
    console.error(`[PaymentNotification] Failed to send cancellation email to ${userEmail}:`, error)
  }
}

export interface PaymentFailedParams {
  userEmail: string
  userName?: string
  planName: string
  amount: number
  currency: Currency
  failureReason?: string
}

/**
 * Send payment failed email
 */
export async function sendPaymentFailedEmail(params: PaymentFailedParams): Promise<void> {
  const { userEmail, userName, planName, amount, currency, failureReason } = params

  const formattedAmount = formatAmount(amount, currency)

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      ${EMAIL_STYLES}
    </head>
    <body>
      <div class="email-container">
        <div class="email-header" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);">
          <h1>Payment Failed</h1>
          <p>We couldn't process your payment</p>
        </div>
        
        <div class="email-body">
          <p class="greeting">Hi ${userName || 'there'},</p>
          
          <p style="color: #475569; line-height: 1.6;">
            We were unable to process your payment of <strong>${formattedAmount}</strong> 
            for the <strong>${planName}</strong> plan.
          </p>
          
          ${failureReason ? `
            <div class="details-box" style="background: #fef2f2; border-left: 4px solid #ef4444;">
              <p style="margin: 0; color: #991b1b;">
                <strong>Reason:</strong> ${failureReason}
              </p>
            </div>
          ` : ''}
          
          <p style="color: #475569; line-height: 1.6;">
            Please try again with a different payment method or contact your bank for assistance.
          </p>
          
          <div class="cta-container">
            <a href="${SITE_URL}/pricing" class="cta-button">
              Try Again →
            </a>
          </div>
          
          <div class="footer">
            <p>
              Need help? Contact us at support@patentnest.ai
            </p>
            <p style="margin-top: 15px;">
              © ${new Date().getFullYear()} PatentNest. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `

  const text = `
Payment Failed

Hi ${userName || 'there'},

We were unable to process your payment of ${formattedAmount} for the ${planName} plan.
${failureReason ? `\nReason: ${failureReason}` : ''}

Please try again: ${SITE_URL}/pricing

Need help? Contact support@patentnest.ai

© ${new Date().getFullYear()} PatentNest
  `.trim()

  try {
    await sendEmail({
      to: userEmail,
      toName: userName,
      subject: `⚠️ Payment failed for ${planName} plan`,
      html,
      text,
    })
    console.log(`[PaymentNotification] Payment failed email sent to ${userEmail}`)
  } catch (error) {
    console.error(`[PaymentNotification] Failed to send payment failed email to ${userEmail}:`, error)
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getPlanFeatures(planCode: PlanCode): string[] {
  switch (planCode) {
    case 'BASIC':
      return [
        '1 Patent Draft per month',
        'Single-jurisdiction filing (1 country)',
        '3 Novelty Searches',
        '1 Ideation Refinement Run',
        '5 Diagrams & Sketches',
        'Export-ready documents',
      ]
    case 'PRO':
      return [
        '4 Patent Drafts per month',
        'Multi-jurisdiction filing (up to 2 countries)',
        '20 Novelty Searches',
        '10 Ideation Refinement Runs',
        '30 Diagrams & Sketches',
        'Priority generation',
      ]
    case 'ENTERPRISE':
      return [
        '15 Patent Drafts per month',
        'Full jurisdiction access (all countries)',
        'Team workspace (5 seats included)',
        'Parallel multi-jurisdiction drafts (6 countries)',
        '100 Novelty Searches',
        '30 Ideation Refinement Runs',
        '150 Diagrams & Sketches',
        'Admin controls & usage reporting',
      ]
    default:
      return []
  }
}

