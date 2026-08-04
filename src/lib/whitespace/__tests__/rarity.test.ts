import { describe, expect, it } from 'vitest'
import { computeRarePairs, rarePairFromCounts, supportFloor } from '../rarity'

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

  it('does not merge distinct multi-word pairs whose labels join to the same string', () => {
    // Sorted pair ("x", "y z") and sorted pair ("x y", "z") both space-join to
    // "x y z". With a space-delimited key their observed counts merged; the
    // NUL-delimited key must keep them apart. Here ("x", "y z") co-occur often
    // while ("x y", "z") never co-occur — only the latter should look rare.
    const sets: string[][] = []
    for (let i = 0; i < 100; i++) {
      const elements: string[] = []
      if (i < 40) elements.push('x', 'y z') // together in 40
      if (i >= 40 && i < 70) elements.push('x y') // in 30, never with "z"
      if (i >= 70) elements.push('z') // in 30, never with "x y"
      sets.push(elements)
    }
    const pairs = computeRarePairs(sets, 20)
    const together = pairs.find(entry => entry.a === 'x' && entry.b === 'y z')
    const apart = pairs.find(entry => entry.a === 'x y' && entry.b === 'z')
    // "x" + "y z" co-occur far above chance — no rarity signal at all.
    expect(together).toBeUndefined()
    // "x y" + "z" are both established and never co-occur — full rarity.
    expect(apart).toBeDefined()
    expect(apart!.observed).toBe(0)
    expect(apart!.rarity).toBeGreaterThan(0.7)
  })
})

describe('rarePairFromCounts', () => {
  it('agrees with computeRarePairs on the never-together fixture', () => {
    const pairs = computeRarePairs(neverTogether(100, 0.4), 20)
    const fromSets = pairs.find(entry => entry.a === 'element a' && entry.b === 'element b')!
    const fromCounts = rarePairFromCounts({
      a: 'element a',
      b: 'element b',
      supportA: 40,
      supportB: 40,
      observed: 0,
      total: 100,
    })!
    expect(fromCounts.expected).toBeCloseTo(fromSets.expected, 10)
    expect(fromCounts.z).toBeCloseTo(fromSets.z, 10)
    expect(fromCounts.rarity).toBe(fromSets.rarity)
  })

  it('returns null when a margin is zero', () => {
    expect(rarePairFromCounts({ a: 'a', b: 'b', supportA: 0, supportB: 40, observed: 0, total: 100 })).toBeNull()
  })
})
