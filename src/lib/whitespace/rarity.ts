/**
 * Whitespace Studio — combination-rarity math (plan §10.3), pure.
 *
 * For claim elements a, b across N families:
 *   E(a,b) = support(a)·support(b) / N          expected under independence
 *   z(a,b) = (observed − E) / sqrt(E)           standardised residual
 *   R(a,b) = clamp(−z / z_ref, 0, 1)            rarity, z_ref = 3.0
 *
 * Valid only above the support floor: without it, the rarest combinations are
 * always the most meaningless ones — two obscure elements that co-occur nowhere
 * because neither matters. With it, rarity only counts between elements the
 * field has independently established as useful, which is exactly the condition
 * under which an unexplored combination is interesting.
 */

import type { RarePair } from './types'

export const Z_REF = 3.0

/**
 * The spec floor is max(20, 5% of area); for read sets smaller than 40 families
 * a literal 20 would demand >50% support, so the fixed part relaxes to half the
 * set — still "independently well-established", still strict.
 */
export function supportFloor(familyCount: number): number {
  return Math.max(Math.min(20, Math.ceil(familyCount * 0.5)), Math.ceil(familyCount * 0.05))
}

/**
 * The rarity formula applied to counts measured elsewhere (e.g. an exact SQL
 * census). Kept here so Z_REF and the arithmetic exist in exactly one place —
 * computeRarePairs delegates to it for its in-memory counts.
 */
export function rarePairFromCounts(input: {
  a: string
  b: string
  supportA: number
  supportB: number
  observed: number
  total: number
}): RarePair | null {
  const expected = (input.supportA * input.supportB) / input.total
  if (expected <= 0) return null
  const z = (input.observed - expected) / Math.sqrt(expected)
  const rarity = Math.min(1, Math.max(0, -z / Z_REF))
  return {
    a: input.a,
    b: input.b,
    supportA: input.supportA,
    supportB: input.supportB,
    observed: input.observed,
    expected,
    z,
    rarity,
  }
}

/**
 * Pair keys are NUL-delimited: labels are free text and often multi-word, so a
 * space join would merge ("a", "b c") with ("a b", "c") and corrupt both counts.
 */
const pairKey = (a: string, b: string) => `${a}\u0000${b}`

export function computeRarePairs(elementSets: string[][], floor = supportFloor(elementSets.length)): RarePair[] {
  const N = elementSets.length
  if (!N) return []

  const support = new Map<string, number>()
  for (const elements of elementSets) {
    for (const element of Array.from(new Set(elements))) support.set(element, (support.get(element) ?? 0) + 1)
  }

  const established = Array.from(support.entries())
    .filter(([, count]) => count >= floor)
    .map(([element]) => element)
    .sort()

  const pairCounts = new Map<string, number>()
  for (const elements of elementSets) {
    const present = Array.from(new Set(elements))
      .filter(element => support.get(element)! >= floor)
      .sort()
    for (let a = 0; a < present.length; a++) {
      for (let b = a + 1; b < present.length; b++) {
        const key = pairKey(present[a], present[b])
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
      }
    }
  }

  const pairs: RarePair[] = []
  for (let a = 0; a < established.length; a++) {
    for (let b = a + 1; b < established.length; b++) {
      const pair = rarePairFromCounts({
        a: established[a],
        b: established[b],
        supportA: support.get(established[a])!,
        supportB: support.get(established[b])!,
        observed: pairCounts.get(pairKey(established[a], established[b])) ?? 0,
        total: N,
      })
      if (pair && pair.rarity > 0) pairs.push(pair)
    }
  }
  return pairs.sort((a, b) => b.rarity - a.rarity)
}
