import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  subscription: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  payment: {
    create: vi.fn(),
  },
  tenantPlan: {
    updateMany: vi.fn(),
  },
  tenant: {
    updateMany: vi.fn(),
  },
  aTIToken: {
    updateMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma }))

import { handleSubscriptionRenewal } from '@/lib/subscription-lifecycle-service'

const baseSubscription = {
  id: 'sub_1',
  userId: 'user_1',
  tenantId: 'tenant_1',
  planId: 'plan_1',
  planCode: 'PRO_PLAN',
  billingCycle: 'monthly',
  currency: 'USD',
  amount: 1000,
  currentPeriodEnd: new Date('2023-12-31T00:00:00.000Z'),
  plan: { name: 'Pro' },
  tenant: { id: 'tenant_1' },
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
  vi.clearAllMocks()

  prisma.payment.create.mockResolvedValue({ id: 'payment_1' })
  prisma.subscription.update.mockResolvedValue({})
  prisma.tenantPlan.updateMany.mockResolvedValue({ count: 1 })
  prisma.tenant.updateMany.mockResolvedValue({ count: 1 })
  prisma.aTIToken.updateMany.mockResolvedValue({ count: 1 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('handleSubscriptionRenewal', () => {
  test('extends tokens tied to the old subscription end', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ ...baseSubscription })

    const result = await handleSubscriptionRenewal({
      razorpaySubscriptionId: 'sub_razor_1',
      razorpayPaymentId: 'pay_razor_1',
      amount: 1000,
      currency: 'USD',
    })

    const expectedPeriodEnd = new Date('2024-02-01T00:00:00.000Z')

    expect(result.success).toBe(true)
    expect(prisma.aTIToken.updateMany.mock.calls.map(call => call[0])).toEqual(
      expect.arrayContaining([
        {
          where: {
            tenantId: baseSubscription.tenantId,
            tokenType: 'AUTO_GENERATED',
          },
          data: {
            expiresAt: expectedPeriodEnd,
          },
        },
        {
          where: {
            tenantId: baseSubscription.tenantId,
            tokenType: 'MANUAL',
            status: { in: ['ACTIVE', 'ISSUED', 'USED_UP'] },
            expiresAt: baseSubscription.currentPeriodEnd,
          },
          data: {
            expiresAt: expectedPeriodEnd,
          },
        },
        {
          where: {
            tenantId: baseSubscription.tenantId,
            tokenType: 'MANUAL',
            status: 'EXPIRED',
            expiresAt: baseSubscription.currentPeriodEnd,
          },
          data: {
            expiresAt: expectedPeriodEnd,
            status: 'ISSUED',
          },
        },
        {
          where: {
            tenantId: baseSubscription.tenantId,
            tokenType: 'MANUAL',
            status: { in: ['ACTIVE', 'ISSUED', 'USED_UP'] },
            expiresAt: null,
          },
          data: {
            expiresAt: expectedPeriodEnd,
          },
        },
      ])
    )
  })

  test('skips old-end matching when the subscription end is null', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
      ...baseSubscription,
      currentPeriodEnd: null,
    })

    const result = await handleSubscriptionRenewal({
      razorpaySubscriptionId: 'sub_razor_2',
      razorpayPaymentId: 'pay_razor_2',
      amount: 1000,
      currency: 'USD',
    })

    const expectedPeriodEnd = new Date('2024-02-01T00:00:00.000Z')
    const calls = prisma.aTIToken.updateMany.mock.calls.map(call => call[0])

    expect(result.success).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          where: {
            tenantId: baseSubscription.tenantId,
            tokenType: 'AUTO_GENERATED',
          },
          data: {
            expiresAt: expectedPeriodEnd,
          },
        },
        {
          where: {
            tenantId: baseSubscription.tenantId,
            tokenType: 'MANUAL',
            status: { in: ['ACTIVE', 'ISSUED', 'USED_UP'] },
            expiresAt: null,
          },
          data: {
            expiresAt: expectedPeriodEnd,
          },
        },
      ])
    )
  })
})
