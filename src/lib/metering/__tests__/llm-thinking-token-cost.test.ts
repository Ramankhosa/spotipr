import { describe, expect, it } from 'vitest'
import { calculateCost } from '../cost-calculator'
import {
  getBillableOutputTokens,
  getMetaSeparatelyBilledThoughtTokens,
  getMetaThoughtTokens
} from '../../usage-log-cost'

describe('LLM thinking token accounting', () => {
  it('adds separate thinking tokens to billable output usage', () => {
    const meta = { thoughtTokens: 300, thoughtTokensIncludedInOutput: false }

    expect(getMetaThoughtTokens(meta)).toBe(300)
    expect(getMetaSeparatelyBilledThoughtTokens(meta)).toBe(300)
    expect(getBillableOutputTokens(700, meta)).toBe(1000)
  })

  it('does not double count provider output that already includes thinking tokens', () => {
    const meta = { thoughtTokens: 300, thoughtTokensIncludedInOutput: true }

    expect(getMetaThoughtTokens(meta)).toBe(300)
    expect(getMetaSeparatelyBilledThoughtTokens(meta)).toBe(0)
    expect(getBillableOutputTokens(1000, meta)).toBe(1000)
  })

  it('charges separate thinking tokens at the output rate by default', () => {
    const withoutThinking = calculateCost('unknown-test-model', 1000, 2000)
    const withSeparateThinking = calculateCost('unknown-test-model', 1000, 2000, 3000)
    const withIncludedThinking = calculateCost('unknown-test-model', 1000, 2000, 3000, {
      thoughtTokensIncludedInOutput: true
    })

    expect(withSeparateThinking.actualCost).toBeGreaterThan(withoutThinking.actualCost)
    expect(withSeparateThinking.outputCost + (withSeparateThinking.thoughtCost || 0))
      .toBeCloseTo(withoutThinking.outputCost + (3000 * withSeparateThinking.outputPricePerMillion / 1_000_000))
    expect(withIncludedThinking.actualCost).toBeCloseTo(withoutThinking.actualCost)
    expect(withIncludedThinking.totalTokens).toBe(3000)
  })
})
