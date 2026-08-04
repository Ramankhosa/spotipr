/**
 * Billing mode.
 *
 * The payment gateway is not connected yet, so no public surface may open a
 * checkout. Plans are still published with their prices — buyers just arrange
 * payment with the admin office instead of paying online.
 *
 * The Razorpay code paths (useRazorpay, /api/payments, the webhook) are all
 * still here and untouched; they are only gated. Flip this one flag to true
 * once the gateway is live and both the homepage pricing section and /pricing
 * go back to their checkout buttons.
 */
export const SELF_SERVE_CHECKOUT_ENABLED = false

/** CTA copy used everywhere a checkout button would otherwise sit. */
export const CONTACT_FOR_PAYMENT = {
  label: 'Contact the admin office',
  href: '/contact',
  note: 'Online checkout is not open yet — the admin office arranges payment and activates your plan.',
} as const
