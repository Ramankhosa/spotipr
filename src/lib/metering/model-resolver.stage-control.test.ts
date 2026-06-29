import { beforeEach, describe, expect, test, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  planStageModelConfig: { findFirst: vi.fn() },
  planTaskModelConfig: { findFirst: vi.fn() },
  planLLMAccess: { findFirst: vi.fn() },
  plan: { findUnique: vi.fn(), findMany: vi.fn() },
  lLMModel: { findFirst: vi.fn(), findMany: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { clearModelCache, resolveModel } from './model-resolver'

describe('resolveModel stage control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearModelCache()
  })

  test('fails closed when the exact plan/stage is not configured', async () => {
    prismaMock.planStageModelConfig.findFirst.mockResolvedValue(null)
    prismaMock.planTaskModelConfig.findFirst.mockResolvedValue({
      model: { code: 'unconfigured-task-model' },
    })

    await expect(
      resolveModel('plan-1', 'LLM5_NOVELTY_ASSESS' as any, 'NOVELTY_COMPARISON')
    ).rejects.toThrow('No active LLM stage model config found')

    expect(prismaMock.planStageModelConfig.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          planId: 'plan-1',
          stage: { code: 'NOVELTY_COMPARISON' },
          isActive: true,
        }),
      })
    )
    expect(prismaMock.planTaskModelConfig.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.plan.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.planLLMAccess.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.lLMModel.findFirst).not.toHaveBeenCalled()
  })

  test('reads stage configuration on every call so worker processes do not use stale models', async () => {
    const config = (code: string) => ({
      fallbackModelIds: null,
      maxTokensIn: 80_000,
      maxTokensOut: 16_000,
      temperature: 0,
      model: {
        id: `id-${code}`,
        code,
        provider: 'openai',
        displayName: code,
        isActive: true,
        supportsVision: true,
        supportsStreaming: true,
        contextWindow: 1_000_000,
        inputCostPer1M: 0,
        outputCostPer1M: 0,
      },
      stage: { code: 'NOVELTY_COMPARISON' },
    })
    prismaMock.planStageModelConfig.findFirst
      .mockResolvedValueOnce(config('gpt-5.2'))
      .mockResolvedValueOnce(config('gpt-5.4'))

    const first = await resolveModel(
      'plan-1',
      'LLM5_NOVELTY_ASSESS' as any,
      'NOVELTY_COMPARISON'
    )
    const second = await resolveModel(
      'plan-1',
      'LLM5_NOVELTY_ASSESS' as any,
      'NOVELTY_COMPARISON'
    )

    expect(first.modelCode).toBe('gpt-5.2')
    expect(second.modelCode).toBe('gpt-5.4')
    expect(prismaMock.planStageModelConfig.findFirst).toHaveBeenCalledTimes(2)
  })
})
