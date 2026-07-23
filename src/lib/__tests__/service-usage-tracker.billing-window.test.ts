import { beforeEach, describe, expect, test, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  subscription: { findFirst: vi.fn() },
  serviceCompletionUsage: {
    count: vi.fn(),
    aggregate: vi.fn(),
    findUnique: vi.fn(),
  },
  tenantPlan: { findFirst: vi.fn() },
  tenantFeatureOverride: { findUnique: vi.fn(), findFirst: vi.fn() },
  feature: { findUnique: vi.fn() },
  lLMModelPrice: { findFirst: vi.fn(), findMany: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma }))

import { getServiceUsage, checkServiceQuota } from '@/lib/service-usage-tracker'

beforeEach(() => {
  vi.clearAllMocks()
  prisma.subscription.findFirst.mockResolvedValue(null)
  prisma.serviceCompletionUsage.count.mockResolvedValue(0)
  prisma.serviceCompletionUsage.aggregate.mockResolvedValue({
    _sum: { totalTokensUsed: 0, estimatedCostUsd: 0 },
  })
  prisma.tenantFeatureOverride.findUnique.mockResolvedValue(null)
  prisma.tenantFeatureOverride.findFirst.mockResolvedValue(null)
  prisma.feature.findUnique.mockResolvedValue({ id: 'feature_1', code: 'NOVELTY_SEARCH' })
  prisma.tenantPlan.findFirst.mockResolvedValue({
    plan: {
      planFeatures: [
        {
          dailyQuota: 4,
          monthlyQuota: 10,
          dailyTokenLimit: null,
          monthlyTokenLimit: null,
          feature: { code: 'NOVELTY_SEARCH' },
        },
      ],
    },
  })
})

describe('service usage counts on the billing window', () => {
  test('monthly completions are counted by completedAt within the subscription period', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
      billingCycle: 'monthly',
      currentPeriodStart: new Date('2026-06-28T09:15:00.000Z'),
      currentPeriodEnd: new Date('2026-07-28T09:15:00.000Z'),
    })

    await getServiceUsage('tenant_1', 'NOVELTY_SEARCH')

    const monthlyCall = prisma.serviceCompletionUsage.count.mock.calls.find(
      (call: any) => call[0]?.where?.completedAt
    )

    expect(monthlyCall).toBeDefined()
    // The old implementation filtered on `completionMonth: 'YYYY-MM'`, a calendar month.
    expect(monthlyCall![0].where.completionMonth).toBeUndefined()
    expect(monthlyCall![0].where.completedAt.gte.toISOString()).toBe('2026-06-28T09:15:00.000Z')
    expect(monthlyCall![0].where.isCompleted).toBe(true)
  })

  test('daily completions still use the UTC day key', async () => {
    await getServiceUsage('tenant_1', 'NOVELTY_SEARCH')

    const dailyCall = prisma.serviceCompletionUsage.count.mock.calls.find(
      (call: any) => call[0]?.where?.completionDate
    )

    expect(dailyCall).toBeDefined()
    expect(typeof dailyCall![0].where.completionDate).toBe('string')
  })

  test('blocks once monthly completions reach the plan limit', async () => {
    // 10 monthly completions against a monthly quota of 10.
    prisma.serviceCompletionUsage.count.mockImplementation(async (args: any) =>
      args?.where?.completedAt ? 10 : 0
    )

    const result = await checkServiceQuota('tenant_1', 'NOVELTY_SEARCH')

    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/monthly quota exceeded/i)
  })

  test('blocks once daily completions reach the plan limit', async () => {
    prisma.serviceCompletionUsage.count.mockImplementation(async (args: any) =>
      args?.where?.completionDate ? 4 : 0
    )

    const result = await checkServiceQuota('tenant_1', 'NOVELTY_SEARCH')

    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/daily quota exceeded/i)
  })

  test('denies a service the plan does not include at all', async () => {
    // No PlanFeature row for the service => no limits => not sold on this plan.
    prisma.tenantPlan.findFirst.mockResolvedValue({ plan: { planFeatures: [] } })

    const result = await checkServiceQuota('tenant_1', 'NOVELTY_SEARCH')

    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/not available for your plan/i)
  })
})
