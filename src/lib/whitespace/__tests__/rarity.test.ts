import { describe, expect, it } from 'vitest'
import { computeRarePairs, supportFloor } from '../rarity'

/** N families where elements a and b each appear in `share` of them, never together. */
function neverTogether(n: number, share: number): string[][] {
  const sets: string[][] = []
  for (let i = 0; i < n; i++) {
    const elements = ['base element']
    if (i < n * share) elements.push('element a')
    else if (i < n * share * 2) elements.push('element b')
    sets.push(elements)
  }
  return sets
}

describe('supportFloor', () => {
  it('is 20 for large areas, relaxes for small read sets, never below 5%', () => {
    expect(supportFloor(400)).toBe(20)
    expect(supportFloor(60)).toBe(20)
    expect(supportFloor(24)).toBe(12)
    expect(supportFloor(1000)).toBe(50) // 5% > 20
  })
})

describe('computeRarePairs', () => {
  it('flags two well-established elements that never co-occur', () => {
    const sets = neverTogether(100, 0.4) // a in 40, b in 40, together in 0
    const pairs = computeRarePairs(sets, 20)
    const pair = pairs.find(entry => entry.a === 'element a' && entry.b === 'element b')
    expect(pair).toBeDefined()
    expect(pair!.observed).toBe(0)
    expect(pair!.expected).toBeCloseTo(16, 5)
    expect(pair!.z).toBeLessThan(-3.9) // −sqrt(16) = −4
    expect(pair!.rarity).toBe(1) // clamped at z_ref
  })

  it('suppresses pairs below the support floor — the rarest pair must not be the most meaningless', () => {
    // Two obscure elements, each in 3 of 100 families, never together: enormous
    // apparent rarity, zero meaning. The floor must remove them entirely.
    const sets: string[][] = []
    for (let i = 0; i < 100; i++) {
      const elements = ['common one', 'common two']
      if (i < 3) elements.push('obscure x')
      if (i >= 3 && i < 6) elements.push('obscure y')
      sets.push(elements)
    }
    const pairs = computeRarePairs(sets, 20)
    expect(pairs.some(entry => entry.a.includes('obscure') || entry.b.includes('obscure'))).toBe(false)
  })

  it('reports nothing when co-occurrence matches chance', () => {
    // a and b independent: a in even rows, b in every other pair of rows —
    // observed ≈ expected, z ≈ 0, no rarity signal.
    const sets: string[][] = []
    for (let i = 0; i < 200; i++) {
      const elements = ['filler']
      if (i % 2 === 0) elements.push('element a')
      if (i % 4 < 2) elements.push('element b')
      sets.push(elements)
    }
    const pairs = computeRarePairs(sets, 20)
    const pair = pairs.find(entry => entry.a === 'element a' && entry.b === 'element b')
    expect(pair?.rarity ?? 0).toBeLessThan(0.15)
  })

  it('handles empty input', () => {
    expect(computeRarePairs([])).toEqual([])
  })
})
