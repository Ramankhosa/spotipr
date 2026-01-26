import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  trialInvite: {
    findFirst: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  patentDraftingUsage: {
    count: vi.fn(),
  },
  noveltySearchRun: {
    count: vi.fn(),
  },
  priorArtRun: {
    count: vi.fn(),
  },
  serviceCompletionUsage: {
    count: vi.fn(),
  },
  diagramGenerationUsage: {
    count: vi.fn(),
  },
  usageLog: {
    aggregate: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma }))

import { checkTrialQuota } from '@/lib/trial-plan-service'

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()

  prisma.user.findUnique.mockResolvedValue({ tenantId: 'tenant_1' })
  prisma.patentDraftingUsage.count.mockResolvedValue(0)
  prisma.noveltySearchRun.count.mockResolvedValue(0)
  prisma.priorArtRun.count.mockResolvedValue(0)
  prisma.serviceCompletionUsage.count.mockResolvedValue(0)
  prisma.diagramGenerationUsage.count.mockResolvedValue(0)
  prisma.usageLog.aggregate.mockResolvedValue({ _sum: { inputTokens: 0, outputTokens: 0 } })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('checkTrialQuota', () => {
  test('blocks usage after the trial duration expires', async () => {
    vi.setSystemTime(new Date('2024-01-10T00:00:00.000Z'))

    prisma.trialInvite.findFirst.mockResolvedValue({
      signedUpAt: new Date('2024-01-01T00:00:00.000Z'),
      campaign: {
        id: 'camp_1',
        name: 'Trial Campaign',
        trialDurationDays: 7,
      },
    })

    const result = await checkTrialQuota('user_1', 'ideation')

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('expired')
    expect(result.remaining).toBe(0)
  })

  test('blocks ideation when the run quota is exhausted', async () => {
    vi.setSystemTime(new Date('2024-01-05T00:00:00.000Z'))

    prisma.trialInvite.findFirst.mockResolvedValue({
      signedUpAt: new Date('2024-01-01T00:00:00.000Z'),
      campaign: {
        id: 'camp_2',
        name: 'Trial Campaign',
        trialDurationDays: 30,
        ideationRunLimit: 2,
      },
    })

    prisma.serviceCompletionUsage.count.mockResolvedValue(2)

    const result = await checkTrialQuota('user_2', 'ideation')

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('ideation runs')
    expect(result.reason).toContain('2')
    expect(result.remaining).toBe(0)
  })
})
