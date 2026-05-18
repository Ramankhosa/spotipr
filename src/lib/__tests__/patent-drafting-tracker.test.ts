import { beforeEach, describe, expect, test, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  $transaction: vi.fn(async (fn: any) => fn(prisma)),
  subscription: {
    findFirst: vi.fn(),
  },
  tenantPlan: {
    findFirst: vi.fn(),
  },
  patentDraftingUsage: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma }))

import { canTrackSectionDrafts, trackSectionDrafted } from '@/lib/patent-drafting-tracker'

beforeEach(() => {
  vi.clearAllMocks()
  prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma))
  prisma.subscription.findFirst.mockResolvedValue(null)
  prisma.tenantPlan.findFirst.mockResolvedValue({
    plan: {
      planFeatures: [
        {
          dailyQuota: 10,
          monthlyQuota: 10,
          feature: { code: 'PATENT_DRAFTING' },
        },
      ],
    },
  })
  prisma.patentDraftingUsage.count.mockResolvedValue(0)
})

describe('patent drafting tracker', () => {
  test('counts once per tenant and patent even when a later session completes the draft', async () => {
    prisma.patentDraftingUsage.findFirst.mockResolvedValue({
      id: 'usage_1',
      tenantId: 'tenant_1',
      patentId: 'patent_1',
      sessionId: 'session_old',
      userId: 'user_old',
      hasDescription: true,
      hasClaims: false,
      isCounted: false,
      countedMonth: null,
      countedAt: null,
    })
    prisma.patentDraftingUsage.update.mockResolvedValue({})

    const result = await trackSectionDrafted(
      'tenant_1',
      'session_new',
      'patent_1',
      'user_new',
      'claims'
    )

    expect(result).toEqual({ counted: true, quotaExceeded: false })
    expect(prisma.patentDraftingUsage.create).not.toHaveBeenCalled()
    expect(prisma.patentDraftingUsage.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'usage_1' },
      data: expect.objectContaining({
        sessionId: 'session_new',
        userId: 'user_new',
        hasDescription: true,
        hasClaims: true,
        isCounted: true,
      }),
    }))
  })

  test('preflight blocks a section save that would complete a patent over quota', async () => {
    prisma.tenantPlan.findFirst.mockResolvedValue({
      plan: {
        planFeatures: [
          {
            dailyQuota: 1,
            monthlyQuota: 1,
            feature: { code: 'PATENT_DRAFTING' },
          },
        ],
      },
    })
    prisma.patentDraftingUsage.count.mockResolvedValue(1)
    prisma.patentDraftingUsage.findFirst.mockResolvedValue({
      id: 'usage_1',
      tenantId: 'tenant_1',
      patentId: 'patent_1',
      sessionId: 'session_1',
      userId: 'user_1',
      hasDescription: true,
      hasClaims: false,
      isCounted: false,
    })

    const result = await canTrackSectionDrafts(
      'tenant_1',
      'session_1',
      'patent_1',
      ['claims']
    )

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('daily quota exceeded')
  })
})
