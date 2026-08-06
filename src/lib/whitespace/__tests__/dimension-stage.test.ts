import { describe, expect, it } from 'vitest'
import {
  compileValueQuery,
  detectGaps,
  dimensionRedundancy,
  valueEmbeddingText,
  type WorkingDimension,
  type WorkingValue,
} from '../dimension-stage'

function value(id: string, label: string, families: string[]): WorkingValue {
  return {
    id,
    label,
    synonyms: [],
    query: `"${label}"`,
    round: 1,
    provenance: 'seed',
    sampleSet: new Set(families),
  }
}

function dimension(id: string, label: string, values: WorkingValue[]): WorkingDimension {
  return { id, label, labelKey: label.toLowerCase(), description: '', round: 1, values }
}

function families(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`)
}

describe('compileValueQuery', () => {
  it('quotes phrases and dedupes label/synonym overlap case-insensitively', () => {
    const query = compileValueQuery('piezo actuator', ['Piezo Actuator', 'piezoelectric stack', 'piezo actuator '])
    expect(query.split(' OR ')).toHaveLength(2)
    expect(query).toContain('"piezo actuator"')
    expect(query).toContain('"piezoelectric stack"')
  })

  it('strips quote characters that would break websearch syntax', () => {
    const query = compileValueQuery('4" pipe', [])
    expect(query).not.toContain('"4""')
    expect(query.startsWith('"')).toBe(true)
    expect(query.endsWith('"')).toBe(true)
  })
})

describe('valueEmbeddingText', () => {
  it('joins the deduped vocabulary as one subject line, mirroring compileValueQuery term-for-term', () => {
    const label = 'piezo actuator'
    const synonyms = ['Piezo Actuator', 'piezoelectric stack', 'piezo actuator ']

    // Same dedupe as the lexical query: the two arms must describe the same
    // vocabulary or they would measure different values.
    expect(valueEmbeddingText(label, synonyms)).toBe('piezo actuator, piezoelectric stack')
    expect(compileValueQuery(label, synonyms).split(' OR ')).toHaveLength(2)
  })

  it('is empty only when the vocabulary is', () => {
    expect(valueEmbeddingText('  ', ['', '  '])).toBe('')
  })
})

describe('dimensionRedundancy', () => {
  it('is ~0 for axes placing disjoint families and ~1 for identical axes', () => {
    const a = dimension('d1', 'axis a', [value('d1v1', 'A', families('a', 20)), value('d1v2', 'B', families('b', 20))])
    const b = dimension('d2', 'axis b', [value('d2v1', 'X', families('x', 20)), value('d2v2', 'Y', families('y', 20))])
    expect(dimensionRedundancy(a, b)).toBe(0)

    const clone = dimension('d3', 'axis c', [
      value('d3v1', 'A2', families('a', 20)),
      value('d3v2', 'B2', families('b', 20)),
    ])
    expect(dimensionRedundancy(a, clone)).toBe(1)
  })
})

describe('detectGaps', () => {
  /**
   * Synthetic field: 1000 families, two independent axes.
   *   d1: A (400), B (300)      d2: X (350), Y (200)
   * Co-occupancy: A-X 300, A-Y 0 (the gap), B-X 40, B-Y 100.
   * marginFloor 30, so every margin qualifies; expected(A,Y) = 80 >= 5.
   */
  function fixture(overrides?: {
    pairCounts?: Map<string, number>
    dimensionAssigned?: number[]
    registryB?: WorkingDimension
  }) {
    const d1 = dimension('d1', 'actuation', [value('d1v1', 'A', families('a', 20)), value('d1v2', 'B', families('b', 20))])
    const d2 =
      overrides?.registryB ??
      dimension('d2', 'sensing', [value('d2v1', 'X', families('x', 20)), value('d2v2', 'Y', families('y', 20))])
    const registry = [d1, d2]
    const flatValues = [...d1.values, ...d2.values]
    const flatDimIdx = [0, 0, 1, 1]
    const pairCounts =
      overrides?.pairCounts ??
      new Map<string, number>([
        ['0:2', 300], // A-X
        ['1:2', 40], // B-X
        ['1:3', 100], // B-Y
      ])
    return detectGaps({
      registry,
      flatValues,
      flatDimIdx,
      familyCount: 1000,
      valueFamilies: [400, 300, 350, 200],
      dimensionAssigned: overrides?.dimensionAssigned ?? [900, 800],
      pairCounts,
      marginFloor: 30,
    })
  }

  it('finds the empty cell with healthy margins and attaches its evidence', () => {
    const { matrices, gaps } = fixture()
    expect(matrices).toHaveLength(1)
    expect(matrices[0].harvested).toBe(true)

    expect(gaps).toHaveLength(1)
    const gap = gaps[0]
    expect(gap.aValueLabel).toBe('A')
    expect(gap.bValueLabel).toBe('Y')
    expect(gap.observed).toBe(0)
    expect(gap.expected).toBeCloseTo(80, 5)
    // Adjusted residual, not the Pearson one: both margins are observed, so the
    // variance carries their finite-population corrections —
    // 80·(1 − 400/1000)·(1 − 200/1000) = 38.4, not 80. Dividing by sqrt(80), as
    // this pinned before, understates the residual by ~1.4x here and by ~2x at
    // the 40–70% margins a real dimension census produces.
    expect(gap.z).toBeCloseTo(-80 / Math.sqrt(80 * 0.6 * 0.8), 5)
    expect(gap.rarity).toBe(1)
    // Which is also why rarity cannot rank: it is pinned at 1 for this gap and
    // for one twenty times less surprising. Surprisal is the ordering signal.
    expect(gap.surprisal).toBeCloseTo(80 / Math.LN10, 5)
    // Near-miss: A's families solve the sensing axis with X instead.
    expect(gap.nearMissB?.valueLabel).toBe('X')
    expect(gap.nearMissB?.families).toBe(300)
    expect(gap.nearMissA?.valueLabel).toBe('B')
    expect(gap.nearMissA?.families).toBe(100)
    // Negative control: 100 A-families take no sensing value at all.
    expect(gap.unassignedOnB).toBe(100)
    expect(gap.coverageSuspect).toBe(false)
    expect(gap.rank).toBeGreaterThan(0)
  })

  it('suppresses cells whose expected count is below the chi-square floor', () => {
    // Shrink Y's margin so expected(A,Y) = 400*10/1000 = 4 < 5: an empty cell
    // there is arithmetic, not absence.
    const { gaps } = (() => {
      const d1 = dimension('d1', 'actuation', [value('d1v1', 'A', families('a', 20))])
      const d2 = dimension('d2', 'sensing', [value('d2v1', 'Y', families('y', 20))])
      return detectGaps({
        registry: [d1, d2],
        flatValues: [...d1.values, ...d2.values],
        flatDimIdx: [0, 1],
        familyCount: 1000,
        valueFamilies: [400, 10],
        dimensionAssigned: [900, 800],
        pairCounts: new Map(),
        marginFloor: 5,
      })
    })()
    expect(gaps).toHaveLength(0)
  })

  it('keeps near-empty cells but ranks them below true zeros', () => {
    // A-Y observed 1 (near-empty: 1 <= max(1, floor(0.02*80))), B-Y observed 0
    // with expected 300*200/1000 = 60 — a true zero.
    const { gaps } = fixture({
      pairCounts: new Map<string, number>([
        ['0:2', 300],
        ['0:3', 1], // A-Y near-empty
        ['1:2', 40],
      ]),
    })
    expect(gaps).toHaveLength(2)
    expect(gaps[0].observed).toBe(0) // B-Y first
    expect(gaps[0].aValueLabel).toBe('B')
    expect(gaps[1].observed).toBe(1) // A-Y after every true zero
  })

  it('harvests from an axis that places only half the field — sparse is normal for keyword vocabulary', () => {
    const { matrices, gaps } = fixture({ dimensionAssigned: [900, 500] }) // d2 residual 50%
    expect(matrices[0].harvested).toBe(true)
    expect(gaps).toHaveLength(1)
  })

  it('refuses to harvest from an axis too narrow to read emptiness against', () => {
    const { matrices, gaps } = fixture({ dimensionAssigned: [900, 150] }) // d2 places 15%
    expect(matrices[0].harvested).toBe(false)
    expect(matrices[0].skipReason).toContain('places only')
    expect(gaps).toHaveLength(0)
  })

  it('refuses to harvest from axes that restate each other', () => {
    // d2 places the same families as d1 -> redundancy 1.
    const clone = dimension('d2', 'drive mechanism', [
      value('d2v1', 'A2', families('a', 20)),
      value('d2v2', 'B2', families('b', 20)),
    ])
    const { matrices, gaps } = fixture({ registryB: clone })
    expect(matrices[0].harvested).toBe(false)
    expect(matrices[0].skipReason).toContain('overlap')
    expect(gaps).toHaveLength(0)
  })

  it('flags a vocabulary hole when most of one arm takes no value on the other axis', () => {
    // A-X drops to 60: 340 of A's 400 families take no sensing value, so the
    // empty A-Y cell is suspect — and rank halves.
    const { gaps } = fixture({
      pairCounts: new Map<string, number>([
        ['0:2', 60],
        ['1:2', 40],
        ['1:3', 100],
      ]),
    })
    const gap = gaps.find(entry => entry.aValueLabel === 'A' && entry.bValueLabel === 'Y')
    expect(gap).toBeDefined()
    expect(gap!.unassignedOnB).toBe(340)
    expect(gap!.coverageSuspect).toBe(true)
    expect(gap!.suspectReason).toContain('vocabulary hole')
  })
})
