import { beforeEach, describe, expect, test, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  subscription: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma }))

import { resolveBillingPeriod } from '@/lib/billing-period'

beforeEach(() => {
  vi.clearAllMocks()
  prisma.subscription.findFirst.mockResolvedValue(null)
})

describe('resolveBillingPeriod', () => {
  test('falls back to the calendar month when the tenant has no subscription', async () => {
    const now = new Date('2026-07-23T10:00:00.000Z')
    const period = await resolveBillingPeriod('tenant_1', now)

    expect(period.source).toBe('calendar')
    expect(period.start.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(period.endExclusive.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(period.key).toBe('2026-07-01')
  })

  test('uses the subscription window for a monthly plan, not the calendar month', async () => {
    // Subscribed on the 28th - the quota month must run 28th to 28th.
    prisma.subscription.findFirst.mockResolvedValue({
      billingCycle: 'monthly',
      currentPeriodStart: new Date('2026-06-28T09:15:00.000Z'),
      currentPeriodEnd: new Date('2026-07-28T09:15:00.000Z'),
    })

    const now = new Date('2026-07-02T00:00:00.000Z')
    const period = await resolveBillingPeriod('tenant_1', now)

    expect(period.source).toBe('subscription')
    expect(period.start.toISOString()).toBe('2026-06-28T09:15:00.000Z')
    expect(period.endExclusive.toISOString()).toBe('2026-07-28T09:15:00.000Z')
  })

  test('a late-month subscriber does not get a second quota window on the 1st', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
      billingCycle: 'monthly',
      currentPeriodStart: new Date('2026-06-28T09:15:00.000Z'),
      currentPeriodEnd: new Date('2026-07-28T09:15:00.000Z'),
    })

    // Usage on 29 June and on 2 July must land in the SAME window. Under calendar-month
    // counting these were different months, which handed out two months of quota for one
    // month of payment.
    const before = await resolveBillingPeriod('tenant_1', new Date('2026-06-29T00:00:00.000Z'))
    const after = await resolveBillingPeriod('tenant_1', new Date('2026-07-02T00:00:00.000Z'))

    expect(before.key).toBe(after.key)
    expect(before.start.getTime()).toBe(after.start.getTime())
  })

  test('an annual plan still gets a monthly window anchored on its signup day', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
      billingCycle: 'yearly',
      currentPeriodStart: new Date('2026-01-15T00:00:00.000Z'),
      currentPeriodEnd: new Date('2027-01-15T00:00:00.000Z'),
    })

    const period = await resolveBillingPeriod('tenant_1', new Date('2026-07-20T00:00:00.000Z'))

    expect(period.source).toBe('subscription')
    expect(period.start.toISOString()).toBe('2026-07-15T00:00:00.000Z')
    expect(period.endExclusive.toISOString()).toBe('2026-08-15T00:00:00.000Z')
  })

  test('clamps the day when the anchor day does not exist in the target month', async () => {
    // Anchored on the 31st: February must clamp to the 28th rather than overflow into March.
    prisma.subscription.findFirst.mockResolvedValue({
      billingCycle: 'yearly',
      currentPeriodStart: new Date('2025-12-31T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-12-31T00:00:00.000Z'),
    })

    const period = await resolveBillingPeriod('tenant_1', new Date('2026-02-10T00:00:00.000Z'))

    expect(period.start.toISOString()).toBe('2026-01-31T00:00:00.000Z')
    expect(period.endExclusive.toISOString()).toBe('2026-02-28T00:00:00.000Z')
  })

  test('ignores a subscription window that does not contain the current time', async () => {
    // An expired period must not be used - fall back to the calendar month.
    prisma.subscription.findFirst.mockResolvedValue({
      billingCycle: 'monthly',
      currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
    })

    const period = await resolveBillingPeriod('tenant_1', new Date('2026-07-23T00:00:00.000Z'))

    expect(period.source).toBe('calendar')
    expect(period.start.toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })
})
