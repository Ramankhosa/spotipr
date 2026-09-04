/**
 * The two engines whose floors are the whole design.
 *
 * The frontier engine returns nothing forever if `supportFloor` is applied to
 * narrowings, and reports "no frontier in this field" when the truth is "this
 * field's claim text is first-claim stubs" if the floor is on claims. The
 * expiry engine says something legally wrong unless two fixed sentences travel
 * with every lead. Both are tested here as contracts, not as behaviour.
 */
import { describe, expect, it } from 'vitest'
import {
  eligibleFamilies,
  FRONTIER_BADGE,
  frontierPairs,
  jaccard,
  MIN_FRONTIER_GROUP_FAMILIES,
  MIN_NARROWINGS_PER_FAMILY,
  narrowingFloor,
  NO_NARROWINGS_SKIP,
  type FrontierFamily,
} from '../engines/frontier'
import {
  DEMAND_WINDOW_YEARS,
  EXPIRY_HORIZON_YEARS,
  EXPIRY_LEGAL_STATUS_SENTENCE,
  EXPIRY_PRIOR_ART_SENTENCE,
  expiryCoverageLines,
  groupByExpiry,
  publishableExpiryGroups,
  type ExpiryFamily,
} from '../engines/expiry'
import { supportFloor } from '../../rarity'
import { rarePairFromCounts } from '../../rarity'

// ---------------------------------------------------------------------------
// The narrowing floor
// ---------------------------------------------------------------------------

describe('narrowingFloor', () => {
  it('is 3 families or 2% of the group, whichever is larger', () => {
    expect(narrowingFloor(10)).toBe(3)
    expect(narrowingFloor(100)).toBe(3)
    expect(narrowingFloor(200)).toBe(4)
    expect(narrowingFloor(1_000)).toBe(20)
  })

  it('is DRASTICALLY looser than supportFloor, which would demand half the group', () => {
    // The bug this exists to prevent: supportFloor(30) = 15, i.e. a "dependent
    // narrowing" would have to be claimed by half the group — which makes it
    // part of the core, not a narrowing. The engine would return nothing, for
    // every field, forever.
    expect(supportFloor(30)).toBe(15)
    expect(narrowingFloor(30)).toBe(3)
    expect(narrowingFloor(30)).toBeLessThan(supportFloor(30))
  })
})

// ---------------------------------------------------------------------------
// The eligibility floor: narrowings, not claims
// ---------------------------------------------------------------------------

describe('eligibleFamilies', () => {
  const withNarrowings = (familyKey: string, narrowings: string[]): FrontierFamily => ({
    familyKey,
    coreElements: ['core element'],
    narrowings,
  })

  it('excludes a US first-claim stub, which HAS claims and no narrowings', () => {
    const stub = withNarrowings('us-stub', [])
    expect(eligibleFamilies([stub])).toEqual([])
  })

  it('needs three DISTINCT narrowings, not three entries', () => {
    expect(eligibleFamilies([withNarrowings('f', ['a', 'a', 'a'])])).toEqual([])
    expect(eligibleFamilies([withNarrowings('f', ['a', 'b', 'c'])])).toHaveLength(1)
    expect(MIN_NARROWINGS_PER_FAMILY).toBe(3)
  })

  it('has a skip reason that names the corpus fault, not the field', () => {
    expect(NO_NARROWINGS_SKIP).toContain('first-claim stubs')
    expect(NO_NARROWINGS_SKIP).toContain('a fact about our corpus')
    expect(NO_NARROWINGS_SKIP).not.toMatch(/this field has no frontier\b/)
  })
})

// ---------------------------------------------------------------------------
// Pairs and their ranking
// ---------------------------------------------------------------------------

/** A group where "a" and "b" are each well established and never combined. */
function group(size: number): FrontierFamily[] {
  return Array.from({ length: size }, (_, index) => {
    const narrowings = ['common']
    // a in the first half, b in the second — never together.
    narrowings.push(index < size / 2 ? 'a' : 'b')
    narrowings.push(`filler ${index % 3}`)
    return { familyKey: `f${index}`, coreElements: ['shared core'], narrowings }
  })
}

describe('frontierPairs', () => {
  it('refuses a group below the minimum family count', () => {
    expect(frontierPairs(group(MIN_FRONTIER_GROUP_FAMILIES - 1))).toEqual([])
    expect(frontierPairs(group(MIN_FRONTIER_GROUP_FAMILIES + 1)).length).toBeGreaterThan(0)
  })

  it('returns only pairs no family claims together', () => {
    const pairs = frontierPairs(group(20))
    expect(pairs.every(pair => pair.observed === 0)).toBe(true)
    // "common" is in every family, so it pairs with nothing unclaimed.
    expect(pairs.some(pair => pair.a === 'a' && pair.b === 'b')).toBe(true)
    expect(pairs.some(pair => [pair.a, pair.b].includes('common') && [pair.a, pair.b].includes('a'))).toBe(false)
  })

  it('RANKS BY SURPRISAL, not rarity — rarity saturates at 1.0 and cannot order these', () => {
    const pairs = frontierPairs(group(40))
    expect(pairs.length).toBeGreaterThan(1)
    // Descending surprisal.
    for (let index = 1; index < pairs.length; index++) {
      expect(pairs[index - 1].surprisal).toBeGreaterThanOrEqual(pairs[index].surprisal)
    }
    // And the reason: several of them share an identical, saturated rarity, so
    // ordering on rarity would be ordering on a constant.
    const saturated = pairs.filter(pair => pair.rarity === 1)
    expect(saturated.length).toBeGreaterThan(1)
    expect(new Set(saturated.map(pair => pair.surprisal)).size).toBeGreaterThan(1)
  })

  it('is deterministic — equal surprisal breaks on the labels', () => {
    const once = frontierPairs(group(20))
    const twice = frontierPairs([...group(20)].reverse())
    expect(twice.map(pair => [pair.a, pair.b])).toEqual(once.map(pair => [pair.a, pair.b]))
  })

  it('carries the group size, so a lead can print its denominator', () => {
    expect(frontierPairs(group(12))[0].groupSize).toBe(12)
  })

  it('passes rarePairFromCounts the empty-cell shape it documents', () => {
    // The argument shape is the contract: observed is an honest 0, total is the
    // GROUP size (not the field), and both supports are family counts.
    const pair = rarePairFromCounts({ a: 'a', b: 'b', supportA: 10, supportB: 10, observed: 0, total: 20 })
    expect(pair).not.toBeNull()
    expect(pair!.expected).toBeCloseTo(5, 10)
    expect(pair!.observed).toBe(0)
    expect(pair!.rarity).toBe(1)
    expect(pair!.surprisal).toBeGreaterThan(0)

    const fromEngine = frontierPairs(group(20)).find(entry => entry.a === 'a' && entry.b === 'b')
    expect(fromEngine).toBeDefined()
    expect(fromEngine!.supportA).toBe(10)
    expect(fromEngine!.supportB).toBe(10)
    expect(fromEngine!.observed).toBe(0)
    expect(fromEngine!.expected).toBeCloseTo(5, 10)
  })

  it('badges every frontier lead as a drafting suggestion, not a demonstrated invention', () => {
    expect(FRONTIER_BADGE).toContain('drafting suggestion')
    expect(FRONTIER_BADGE).toContain('not a demonstrated invention')
  })
})

describe('jaccard (tie-break only)', () => {
  it('is 0 for two empty sets — an absence of evidence, not perfect agreement', () => {
    expect(jaccard([], [])).toBe(0)
    expect(jaccard(['a'], [])).toBe(0)
  })

  it('measures overlap the ordinary way otherwise', () => {
    expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1)
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3, 10)
  })
})

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

describe('groupByExpiry', () => {
  const YEAR = 2026
  const families = (entries: Array<[string, string, number | null]>): ExpiryFamily[] =>
    entries.map(([familyKey, componentId, filingYear]) => ({ familyKey, componentId, filingYear }))

  it('splits a component into families past the horizon and families still filing', () => {
    const groups = groupByExpiry(
      families([
        ['old1', 'c1', 2004],
        ['old2', 'c1', 2008],
        ['old3', 'c1', YEAR - EXPIRY_HORIZON_YEARS],
        ['new1', 'c1', 2024],
        ['new2', 'c1', YEAR - DEMAND_WINDOW_YEARS],
      ]),
      YEAR
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].expiring).toEqual(['old1', 'old2', 'old3'])
    expect(groups[0].demand).toEqual(['new1', 'new2'])
  })

  it('puts an UNDATED family on neither side — EPO bulk rows carry no filing date', () => {
    const groups = groupByExpiry(families([['epo', 'c1', null], ['old', 'c1', 2001]]), YEAR)
    expect(groups[0].undated).toEqual(['epo'])
    expect(groups[0].expiring).toEqual(['old'])
    expect(groups[0].demand).toEqual([])
  })

  it('keeps components separate and orders them by the pairing the engine looks for', () => {
    const groups = groupByExpiry(
      families([
        ['a1', 'weak', 2000],
        ['a2', 'weak', 2024],
        ['b1', 'strong', 2000],
        ['b2', 'strong', 2001],
        ['b3', 'strong', 2002],
        ['b4', 'strong', 2024],
        ['b5', 'strong', 2025],
      ]),
      YEAR
    )
    expect(groups.map(entry => entry.componentId)).toEqual(['strong', 'weak'])
  })

  it('is deterministic in its member ordering and its tie-breaks', () => {
    const input = families([['z', 'c', 2000], ['a', 'c', 2000]])
    expect(groupByExpiry(input, YEAR)[0].expiring).toEqual(['a', 'z'])
    expect(groupByExpiry([...input].reverse(), YEAR)[0].expiring).toEqual(['a', 'z'])
  })

  it('publishes only groups with enough of BOTH halves', () => {
    const thin = groupByExpiry(families([['o1', 'c', 2000], ['n1', 'c', 2025]]), YEAR)
    expect(publishableExpiryGroups(thin)).toEqual([])
    const full = groupByExpiry(
      families([
        ['o1', 'c', 2000],
        ['o2', 'c', 2001],
        ['o3', 'c', 2002],
        ['n1', 'c', 2025],
        ['n2', 'c', 2024],
      ]),
      YEAR
    )
    expect(publishableExpiryGroups(full)).toHaveLength(1)
  })
})

describe('expiryCoverageLines', () => {
  const lines = expiryCoverageLines({ expiring: 6, demand: 4, undated: 2, referenceYear: 2026 })

  it('leads with the two non-negotiable sentences, in order', () => {
    expect(lines[0]).toBe(EXPIRY_LEGAL_STATUS_SENTENCE)
    expect(lines[1]).toBe(EXPIRY_PRIOR_ART_SENTENCE)
  })

  it('says we hold no legal status and that the patent may never have been granted here', () => {
    expect(lines[0]).toContain('no legal-status or renewal data')
    expect(lines[0]).toContain('never have been granted in India')
  })

  it('makes the correction that matters: expiry changes FTO, not patentability', () => {
    expect(lines[1]).toContain('remains prior art against your improvement forever')
    expect(lines[1]).toContain('freedom to operate, not patentability')
  })

  it('states what was counted, including the undated families', () => {
    expect(lines[2]).toContain('6 families')
    expect(lines[2]).toContain('in or before 2009')
    expect(lines[3]).toContain('2 further families')
  })

  it('omits the undated line when there are none, rather than printing a zero', () => {
    const clean = expiryCoverageLines({ expiring: 3, demand: 2, undated: 0, referenceYear: 2026 })
    expect(clean).toHaveLength(3)
  })
})
