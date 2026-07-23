/**
 * Billing period resolution - shared by every quota counter.
 *
 * A "month" of quota must mean the subscriber's billing month, not the calendar month.
 * Counting on calendar months lets someone who subscribes on the 28th consume a full
 * month of quota, then have it reset three days later on the 1st - two months of quota
 * for one month of payment.
 *
 * Patent drafting already resolved periods this way; this module lifts that logic out so
 * `service-usage-tracker` (novelty searches, diagrams, reviews, office actions, idea
 * reservations) counts on exactly the same window. Previously the two disagreed, so a
 * single tenant had two different month boundaries depending on which service they used.
 *
 * Falls back to the calendar month when a tenant has no active subscription (trials,
 * ATI-provisioned tenants, manually granted plans).
 */

import { prisma } from './prisma'
import { getUtcMonthWindow } from './usage-periods'

export interface BillingPeriod {
  start: Date
  /** Exclusive upper bound. */
  endExclusive: Date
  /** Inclusive upper bound, for `lte` range queries. */
  endInclusive: Date
  /** Stable key for the period - the ISO date the period started (YYYY-MM-DD). */
  key: string
  source: 'subscription' | 'calendar'
}

/** Add months to a UTC date, clamping the day so 31 Jan + 1 month = 28/29 Feb. */
function addMonthsClampedUtc(base: Date, months: number): Date {
  const year = base.getUTCFullYear()
  const month = base.getUTCMonth() + months
  const day = base.getUTCDate()
  const hours = base.getUTCHours()
  const minutes = base.getUTCMinutes()
  const seconds = base.getUTCSeconds()
  const ms = base.getUTCMilliseconds()

  const firstOfTarget = new Date(Date.UTC(year, month, 1, hours, minutes, seconds, ms))
  const daysInTarget = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)
  ).getUTCDate()
  const clampedDay = Math.min(day, daysInTarget)
  return new Date(
    Date.UTC(
      firstOfTarget.getUTCFullYear(),
      firstOfTarget.getUTCMonth(),
      clampedDay,
      hours,
      minutes,
      seconds,
      ms
    )
  )
}

/**
 * For an annual subscription, find which monthly slice of the year we are in. Annual
 * subscribers still get a *monthly* quota allowance, anchored on their signup day.
 */
function resolveAnchoredMonthlyWindow(
  now: Date,
  anchorStart: Date
): { start: Date; endExclusive: Date } {
  const monthsDiff =
    (now.getUTCFullYear() - anchorStart.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - anchorStart.getUTCMonth())

  let monthsFromAnchor = monthsDiff
  let start = addMonthsClampedUtc(anchorStart, monthsFromAnchor)
  if (start > now) {
    monthsFromAnchor -= 1
    start = addMonthsClampedUtc(anchorStart, monthsFromAnchor)
  }
  const endExclusive = addMonthsClampedUtc(anchorStart, monthsFromAnchor + 1)
  return { start, endExclusive }
}

/**
 * Resolve the monthly quota window for a tenant.
 *
 * `client` accepts a transaction handle so callers can resolve the period inside the same
 * transaction that reads the counts, keeping the check consistent.
 */
export async function resolveBillingPeriod(
  tenantId: string,
  now: Date = new Date(),
  client: typeof prisma | any = prisma
): Promise<BillingPeriod> {
  const subscription = await client.subscription.findFirst({
    where: {
      tenantId,
      status: { in: ['ACTIVE', 'PENDING', 'AUTHENTICATED'] },
      currentPeriodStart: { not: null },
      currentPeriodEnd: { not: null },
    },
    orderBy: { currentPeriodStart: 'desc' },
    select: { billingCycle: true, currentPeriodStart: true, currentPeriodEnd: true },
  })

  if (subscription?.currentPeriodStart && subscription?.currentPeriodEnd) {
    const start: Date = subscription.currentPeriodStart
    const end: Date = subscription.currentPeriodEnd
    const cycle = (subscription.billingCycle || '').toLowerCase()

    if (cycle === 'monthly' && now >= start && now < end) {
      return {
        start,
        endExclusive: end,
        endInclusive: new Date(end.getTime() - 1),
        key: start.toISOString().substring(0, 10),
        source: 'subscription',
      }
    }

    if (cycle === 'yearly' && now >= start && now < end) {
      const window = resolveAnchoredMonthlyWindow(now, start)
      return {
        start: window.start,
        endExclusive: window.endExclusive,
        endInclusive: new Date(window.endExclusive.getTime() - 1),
        key: window.start.toISOString().substring(0, 10),
        source: 'subscription',
      }
    }
  }

  const calendar = getUtcMonthWindow(now)
  return {
    start: calendar.start,
    endExclusive: calendar.endExclusive,
    endInclusive: calendar.endInclusive,
    key: calendar.start.toISOString().substring(0, 10),
    source: 'calendar',
  }
}
