import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./model-resolver', () => ({
  resolveModel: vi.fn(),
}))

vi.mock('./providers/provider-router', () => ({
  llmProviderRouter: {
    routeWithModel: vi.fn(),
    routeAndExecute: vi.fn(),
  },
}))

import { LLMGateway } from './gateway'
import { llmProviderRouter } from './providers/provider-router'
import { resolveModel } from './model-resolver'

describe('LLMGateway stage routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('rejects configured stage calls when tenant context has no plan', async () => {
    const releaseReservation = vi.fn(async () => undefined)
    const gateway = new LLMGateway()
    ;(gateway as any).system = {
      policy: {
        evaluateAccess: vi.fn(async () => ({ allowed: true, reservationId: 'reservation-1' })),
      },
      reservation: { releaseReservation },
      metering: { recordUsage: vi.fn() },
    }
    const configuredRouting = vi.spyOn(llmProviderRouter, 'routeWithModel')
    const defaultRouting = vi.spyOn(llmProviderRouter, 'routeAndExecute')

    const result = await gateway.executeLLMOperation(
      {
        tenantContext: {
          tenantId: 'tenant-1',
          userId: 'user-1',
          planId: '',
          tenantStatus: 'ACTIVE',
        },
      },
      {
        taskCode: 'LLM5_NOVELTY_ASSESS',
        stageCode: 'NOVELTY_FEATURE_ANALYSIS',
        prompt: 'test',
      }
    )

    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('No planId available')
    expect(releaseReservation).toHaveBeenCalledWith('reservation-1')
    expect(configuredRouting).not.toHaveBeenCalled()
    expect(defaultRouting).not.toHaveBeenCalled()
  })

  test('ignores a caller model override and routes a stage with the Super Admin model', async () => {
    vi.mocked(resolveModel).mockResolvedValue({
      modelCode: 'gpt-5.4',
      modelId: 'model-configured',
      provider: 'openai',
      displayName: 'GPT-5.4',
      supportsVision: true,
      supportsStreaming: true,
      contextWindow: 1_050_000,
      fallbacks: [],
      source: 'stage',
      costPer1M: { input: 0, output: 0 },
    })
    vi.mocked(llmProviderRouter.routeWithModel).mockResolvedValue({
      output: '{"ok":true}',
      outputTokens: 4,
      modelClass: 'gpt-5.4',
      metadata: { modelUsed: 'gpt-5.4' },
    })

    const recordUsage = vi.fn(async () => undefined)
    const gateway = new LLMGateway()
    ;(gateway as any).system = {
      policy: {
        evaluateAccess: vi.fn(async () => ({ allowed: true, reservationId: 'reservation-2' })),
      },
      reservation: { releaseReservation: vi.fn(async () => undefined) },
      metering: { recordUsage },
    }

    const result = await gateway.executeLLMOperation(
      {
        tenantContext: {
          tenantId: 'tenant-1',
          userId: 'user-1',
          planId: 'plan-1',
          tenantStatus: 'ACTIVE',
        },
      },
      {
        taskCode: 'LLM5_NOVELTY_ASSESS',
        stageCode: 'NOVELTY_COMPARISON',
        modelClass: 'gemini-2.5-flash-lite',
        prompt: 'test',
      }
    )

    expect(result.success).toBe(true)
    expect(resolveModel).toHaveBeenCalledWith(
      'plan-1',
      'LLM5_NOVELTY_ASSESS',
      'NOVELTY_COMPARISON'
    )
    expect(llmProviderRouter.routeWithModel).toHaveBeenCalledWith(
      expect.not.objectContaining({ modelClass: 'gemini-2.5-flash-lite' }),
      expect.any(Object),
      'gpt-5.4',
      []
    )
    expect(llmProviderRouter.routeAndExecute).not.toHaveBeenCalled()
    expect(recordUsage).toHaveBeenCalledWith(
      'reservation-2',
      expect.objectContaining({
        modelClass: 'gpt-5.4',
        metadata: expect.objectContaining({ modelSource: 'stage' }),
      }),
      'user-1'
    )
  })
})
