/**
 * Whitespace Studio — combination-rarity math (plan §10.3), pure.
 *
 * For claim elements a, b across N families, with pₐ = support(a)/N:
 *   E(a,b) = support(a)·support(b) / N               expected under independence
 *   V(a,b) = E · (1 − pₐ) · (1 − p_b)                variance, margins fixed
 *   z(a,b) = (observed − E) / sqrt(V)                standardised residual
 *   R(a,b) = clamp(−z / z_ref, 0, 1)                 rarity, z_ref = 3.0
 *
 * The variance is the correction plan §10.3 omitted. §10.3 divides by sqrt(E) —
 * the Pearson residual, which assumes a Poisson cell and is only right when the
 * margins are a small share of N. Here they are the opposite by construction:
 * the support floor admits only elements appearing in at least 5% of families,
 * and the dimension census routinely reads margins at 40–70% of the field. At
 * pₐ = p_b = 0.5 the true standard deviation is half what sqrt(E) claims, so
 * every residual was understated by about a factor of two and genuinely empty
 * combinations looked half as surprising as they are.
 *
 * `E · (1 − pₐ)(1 − p_b)` is the standard adjusted residual for a contingency
 * table with both margins fixed (Haberman 1973) — the situation we are actually
 * in, since support(a) and support(b) are observed, not sampled. For small
 * margins the correction tends to 1 and this reduces to the Poisson form, so
 * nothing that was right before has moved.
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
 * Deficit surprisal in decibans: −log10 P(X <= observed) under Poisson(expected).
 *
 * Exists because `rarity` SATURATES and therefore cannot rank. rarity clamps
 * −z/3 into [0,1], and for an empty cell z is −sqrt(expected), so every cell
 * with expected >= 9 scores exactly 1.0. In a real census the gap detector's
 * own floors (margin >= 2% of the field, expected >= 5) put almost every
 * published gap well past that, so the primary ranking factor was a constant
 * and gaps were effectively ordered by margin size alone.
 *
 * Surprisal does not saturate: an empty cell where 500 families were expected
 * (217 dB) is genuinely more surprising than one where 6 were (2.6 dB), and the
 * number says how much. Poisson rather than binomial because the cells that
 * reach the gap list have p = expected/total well under 0.1, where the two
 * agree to within a few percent, and Poisson has no `total` to get wrong.
 */
export function deficitSurprisal(observed: number, expected: number): number {
  if (!(expected > 0)) return 0
  const k = Math.max(0, Math.floor(observed))
  if (k >= expected) return 0
  // log P(X <= k) = −λ + log Σ λ^i/i!, summed in log space so λ in the hundreds
  // does not overflow the term before the −λ cancels it.
  let logTermSum = 0 // log of Σ, running; starts at the i = 0 term (λ^0/0! = 1)
  let logTerm = 0
  for (let i = 1; i <= k; i++) {
    logTerm += Math.log(expected) - Math.log(i)
    // log(a + b) = log a + log1p(exp(log b − log a)), stable for log b <= log a
    const high = Math.max(logTermSum, logTerm)
    const low = Math.min(logTermSum, logTerm)
    logTermSum = high + Math.log1p(Math.exp(low - high))
  }
  const logProbability = -expected + logTermSum
  return Math.max(0, -logProbability / Math.LN10)
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

  // Both margins are observed, so the cell's variance carries their finite-
  // population corrections. See the module note: sqrt(E) alone understates the
  // residual by about 2x at the margin sizes this module actually sees.
  const shareA = Math.min(1, input.supportA / input.total)
  const shareB = Math.min(1, input.supportB / input.total)
  const variance = expected * (1 - shareA) * (1 - shareB)
  // A margin covering the entire set leaves no variance and no surprise to
  // measure — every family holds the element, so the cell count is forced.
  const z = variance > 0 ? (input.observed - expected) / Math.sqrt(variance) : 0
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
    surprisal: deficitSurprisal(input.observed, expected),
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
