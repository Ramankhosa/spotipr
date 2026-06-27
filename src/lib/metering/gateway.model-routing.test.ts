import { describe, expect, test, vi } from 'vitest'

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

describe('LLMGateway stage routing', () => {
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
})
