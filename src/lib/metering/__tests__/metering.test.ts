import { beforeEach, describe, expect, test, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  usageMeter: {
    upsert: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('@/lib/metering/cost-calculator', () => ({
  calculateCost: vi.fn(),
  CONTINGENCY_MULTIPLIER: 1.1,
}))

import { createMeteringService } from '@/lib/metering/metering'

beforeEach(() => {
  vi.clearAllMocks()
  prisma.usageMeter.upsert.mockResolvedValue({})
})

describe('metering usage meters', () => {
  test('increments token quota meters by total input and output tokens', async () => {
    const service = createMeteringService({} as any)

    await service.updateUsageMeters(
      {
        tenantId: 'tenant_1',
        featureId: 'feature_1',
        taskCode: 'LLM2_DRAFT',
      },
      {
        inputTokens: 120,
        outputTokens: 30,
        apiCalls: 1,
      } as any
    )

    expect(prisma.usageMeter.upsert).toHaveBeenCalledTimes(2)
    for (const call of prisma.usageMeter.upsert.mock.calls) {
      expect(call[0].update.currentUsage.increment).toBe(150)
      expect(call[0].create.currentUsage).toBe(150)
    }
  })
})
