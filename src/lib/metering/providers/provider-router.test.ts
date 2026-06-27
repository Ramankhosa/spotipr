import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../cost-calculator', () => ({
  calculateCost: vi.fn(() => 0),
  ensurePricingLoaded: vi.fn(async () => undefined),
  isPricingLoaded: vi.fn(() => true),
  logLLMCost: vi.fn(() => ({
    totalTokens: 0,
    actualCost: 0,
    contingencyCost: 0,
    inputCost: 0,
    outputCost: 0,
    thoughtCost: 0,
  })),
}))

import { LLMProviderRouter } from './provider-router'

describe('LLMProviderRouter configured model routing', () => {
  let router: LLMProviderRouter

  beforeEach(() => {
    vi.clearAllMocks()
    router = new LLMProviderRouter()
  })

  test('does not use hard-coded default routing when no configured fallback exists', async () => {
    vi.spyOn(router, 'getProviderForModel').mockReturnValue(null)
    const defaultRouting = vi.spyOn(router, 'routeAndExecute')

    await expect(router.routeWithModel(
      { taskCode: 'LLM5_NOVELTY_ASSESS', prompt: 'test' } as any,
      {} as any,
      'glm-5',
      []
    )).rejects.toThrow('no fallback models are configured')

    expect(defaultRouting).not.toHaveBeenCalled()
  })
})
