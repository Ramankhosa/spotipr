/**
 * Pins the non-saturating gap-ranking signal.
 *
 * `rarity` clamps −z/3 into [0,1], and for an empty cell z is −sqrt(expected),
 * so every cell with expected >= 9 scores exactly 1.0. The dimension census's
 * own floors put nearly every published gap far past that, which made the
 * primary ranking factor a constant. Surprisal is what replaced it in the rank
 * formula, so these tests exist to keep it monotone and finite.
 */

import { describe, expect, it } from 'vitest'
import { deficitSurprisal, rarePairFromCounts } from '../rarity'

describe('deficitSurprisal', () => {
  it('is −log10 P(X = 0) = λ/ln10 for an empty cell', () => {
    expect(deficitSurprisal(0, 5)).toBeCloseTo(5 / Math.LN10, 9)
    expect(deficitSurprisal(0, 500)).toBeCloseTo(500 / Math.LN10, 6)
  })

  it('keeps separating cells long after rarity has saturated', () => {
    const modest = rarePairFromCounts({ a: 'a', b: 'b', supportA: 30, supportB: 30, observed: 0, total: 100 })!
    const emphatic = rarePairFromCounts({ a: 'a', b: 'b', supportA: 700, supportB: 700, observed: 0, total: 1000 })!

    // Both are pinned at the ceiling of the old signal…
    expect(modest.rarity).toBe(1)
    expect(emphatic.rarity).toBe(1)
    // …and the new one still tells them apart, by two orders of magnitude.
    expect(emphatic.surprisal).toBeGreaterThan(modest.surprisal * 50)
  })

  it('falls as the cell fills, and reaches zero at chance', () => {
    const series = [0, 1, 2, 5, 10].map(observed => deficitSurprisal(observed, 20))
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeLessThan(series[i - 1])
    expect(deficitSurprisal(20, 20)).toBe(0)
    expect(deficitSurprisal(40, 20)).toBe(0)
  })

  it('stays finite for the large expectations a production census produces', () => {
    // 5,000 expected with 3 observed would overflow a naive Σ λ^i/i! before the
    // e^−λ cancelled it; the log-space sum must not produce NaN or Infinity.
    const value = deficitSurprisal(3, 5_000)
    expect(Number.isFinite(value)).toBe(true)
    expect(value).toBeGreaterThan(1_000)
  })

  it('is zero for a degenerate expectation rather than NaN', () => {
    expect(deficitSurprisal(0, 0)).toBe(0)
    expect(deficitSurprisal(0, -1)).toBe(0)
  })
})
