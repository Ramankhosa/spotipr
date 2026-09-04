/**
 * Invention Miner — engine (iii): the dependent-claim frontier.
 *
 * The question: within one family of closely-related claim cores, which two
 * dependent narrowings are each independently well established and yet never
 * claimed together? That pair is a combination the field's own drafters have
 * each reached for separately and nobody has combined.
 *
 * FOUR DECISIONS HERE ARE THE DIFFERENCE BETWEEN A WORKING ENGINE AND ONE THAT
 * RETURNS NOTHING FOREVER OR RETURNS RUBBISH.
 *
 *  1. GROUPS COME FROM THE CLAIM_CORE VECTOR, NOT FROM JACCARD. Jaccard over
 *     `normalizeElement`d LLM phrases groups almost nothing: two drafters write
 *     "perforated tray" and "apertured support plate" for the same part, and
 *     their element sets are disjoint. What Jaccard DOES group is one drafter's
 *     continuations of one application — a portfolio, not a technology — and a
 *     "frontier" measured inside a single family's continuations is a statement
 *     about that applicant's claim strategy. So grouping is the same k-NN
 *     component construction as the problem graph, at the same cut, over
 *     CLAIM_CORE statements; Jaccard survives only as a TIE-BREAK when two
 *     groups are equally close.
 *
 *  2. THE FLOOR IS ON NARROWINGS, NOT ON CLAIMS. `withClaims` looks like the
 *     right gate and is not: a US publication carries its first claim and
 *     nothing else, so `claimsText` is populated, `claimedScope` is populated,
 *     and `dependentNarrowings` is EMPTY. A field of US first-claim stubs would
 *     therefore pass a `withClaims` floor, run the whole engine, find no pair,
 *     and report "no frontier in this field" — when the truth is "this field's
 *     claim text is first-claim stubs and the question was never asked". The
 *     floor is families carrying at least three dependent narrowings, and the
 *     skip reason says exactly that.
 *
 *  3. `supportFloor` APPLIES TO THE CORE, NOT TO THE NARROWINGS. supportFloor
 *     is `max(min(20, ⌈N/2⌉), ⌈N/20⌉)`, designed for elements of an independent
 *     claim, which most families in a group share. On a 30-family group it
 *     demands 15 families claim a narrowing before the narrowing counts. A
 *     DEPENDENT narrowing claimed by half a group is not a narrowing, it is
 *     part of the core — so that floor asks for exactly the opposite of what
 *     the engine is looking for and the engine would return nothing forever.
 *     Narrowings use an explicit floor: at least 3 families AND at least 2% of
 *     the group.
 *
 *  4. RANK BY `surprisal`, NOT `rarity`. rarity is `clamp(−z/3, 0, 1)`, and for
 *     an empty cell z = −sqrt(expected·(1−pₐ)(1−p_b)), so every pair with an
 *     expectation past ~9 scores exactly 1.0 and the ranking is a constant.
 *     Surprisal does not saturate — see rarity.ts.
 *
 * Pure. The vectors, the claim text and the persistence live in the stage.
 */

import { rarePairFromCounts } from '../../rarity'
import type { RarePair } from '../../types'

/** A group is a technology only above this many families. Below it, a pair is anecdote. */
export const MIN_FRONTIER_GROUP_FAMILIES = 5

/**
 * Families with fewer dependent narrowings than this do not enter the engine.
 *
 * THREE, not one: a single narrowing tells you nothing about which narrowings
 * co-occur, and two makes every family a complete pair, so the "no family
 * claims them together" test would be measuring the drafting convention of
 * writing two dependent claims rather than a frontier.
 */
export const MIN_NARROWINGS_PER_FAMILY = 3

/** Absolute part of the narrowing floor. */
export const MIN_NARROWING_FAMILIES = 3
/** Proportional part of the narrowing floor. */
export const MIN_NARROWING_SHARE = 0.02

/**
 * The narrowing support floor for a group of this size. Explicitly NOT
 * `supportFloor` — see decision 3 in the module header.
 */
export function narrowingFloor(groupSize: number): number {
  const size = Math.max(0, Math.trunc(groupSize))
  return Math.max(MIN_NARROWING_FAMILIES, Math.ceil(size * MIN_NARROWING_SHARE))
}

/** The exact skip copy. Fixed here so the stage, the result and the UI agree. */
export const NO_NARROWINGS_SKIP =
  'This field’s claim text is first-claim stubs, not full claim sets: no family we read carries ' +
  `${MIN_NARROWINGS_PER_FAMILY} or more dependent narrowings, so the dependent-claim frontier was never asked. ` +
  'That is a fact about our corpus’s claim coverage here, not a finding that the field has no frontier.'

export const NO_GROUP_SKIP =
  `No group of ${MIN_FRONTIER_GROUP_FAMILIES} or more families shares a claim core closely enough to compare ` +
  'their dependent narrowings, so there is no population a frontier could be measured against.'

/** One family's claim reading, as the engine needs it. */
export interface FrontierFamily {
  familyKey: string
  /** `claimedScope.independentElements`, normalised. Used for the Jaccard tie-break only. */
  coreElements: readonly string[]
  /** `claimedScope.dependentNarrowings`, normalised. */
  narrowings: readonly string[]
}

/** Families that carry enough dependent narrowings to be asked the question. */
export function eligibleFamilies(families: readonly FrontierFamily[]): FrontierFamily[] {
  return families.filter(family => new Set(family.narrowings).size >= MIN_NARROWINGS_PER_FAMILY)
}

/**
 * Jaccard over two element sets. The TIE-BREAK, never the grouping — see
 * decision 1. Returns 0 for two empty sets rather than the mathematically
 * conventional 1: "neither family recorded any core element" is an absence of
 * evidence, and treating it as perfect agreement would group every family whose
 * claims we could not read into one enormous fake group.
 */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a.filter(Boolean))
  const setB = new Set(b.filter(Boolean))
  if (!setA.size || !setB.size) return 0
  let intersection = 0
  for (const value of Array.from(setA)) if (setB.has(value)) intersection += 1
  const union = setA.size + setB.size - intersection
  return union > 0 ? intersection / union : 0
}

export interface FrontierPair extends RarePair {
  /** Families claiming a, families claiming b, and the group they were counted in. */
  groupSize: number
}

/**
 * Unclaimed pairs within one group, ranked by surprisal descending.
 *
 * Only pairs with `observed === 0` are candidates — the engine's whole question
 * is "which two established narrowings has NOBODY combined". A pair claimed
 * once is claimed, and `rarePairFromCounts` is handed the honest zero rather
 * than a threshold.
 */
export function frontierPairs(group: readonly FrontierFamily[]): FrontierPair[] {
  const groupSize = group.length
  if (groupSize < MIN_FRONTIER_GROUP_FAMILIES) return []
  const floor = narrowingFloor(groupSize)

  const support = new Map<string, number>()
  const perFamily = group.map(family => Array.from(new Set(family.narrowings.filter(Boolean))).sort())
  for (const narrowings of perFamily) {
    for (const narrowing of narrowings) support.set(narrowing, (support.get(narrowing) ?? 0) + 1)
  }

  const established = Array.from(support.entries())
    .filter(([, count]) => count >= floor)
    .map(([narrowing]) => narrowing)
    .sort()
  if (established.length < 2) return []

  const establishedSet = new Set(established)
  // NUL-delimited: narrowings are free text and often multi-word, so a space
  // join would merge ("a", "b c") with ("a b", "c") — the same trap rarity.ts
  // documents for its own pair keys.
  const observed = new Map<string, number>()
  for (const narrowings of perFamily) {
    const present = narrowings.filter(narrowing => establishedSet.has(narrowing))
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const key = `${present[i]}\u0000${present[j]}`
        observed.set(key, (observed.get(key) ?? 0) + 1)
      }
    }
  }

  const pairs: FrontierPair[] = []
  for (let i = 0; i < established.length; i++) {
    for (let j = i + 1; j < established.length; j++) {
      const a = established[i]
      const b = established[j]
      if ((observed.get(`${a}\u0000${b}`) ?? 0) > 0) continue
      const pair = rarePairFromCounts({
        a,
        b,
        supportA: support.get(a) as number,
        supportB: support.get(b) as number,
        observed: 0,
        total: groupSize,
      })
      if (pair) pairs.push({ ...pair, groupSize })
    }
  }

  // Surprisal, not rarity. See decision 4. Ties broken on the labels so a
  // re-run orders identical pairs identically and their fingerprints are stable.
  return pairs.sort(
    (x, y) => y.surprisal - x.surprisal || (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0)
  )
}

/**
 * The badge every frontier lead carries.
 *
 * A frontier lead is a DRAFTING SUGGESTION: two narrowings the field has
 * established and never combined. Nothing here demonstrates that combining them
 * does anything — no document says the combination solves a problem, because no
 * document contains the combination. Calling that a demonstrated invention is
 * the theatre this product exists not to perform.
 */
export const FRONTIER_BADGE =
  'A drafting suggestion, not a demonstrated invention: two narrowings this field has each established ' +
  'independently and no family we read claims together. Nothing we measured says the combination has an effect.'
