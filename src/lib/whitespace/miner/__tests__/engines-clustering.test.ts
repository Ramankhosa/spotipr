/**
 * The substrate every engine counts over. If the components are wrong, every
 * number the product prints is a count over the wrong set — and it will look
 * exactly as plausible as a right one.
 */
import { describe, expect, it } from 'vitest'
import {
  BIMODAL_SHARED_FAMILY_SHARE,
  bimodalityNote,
  componentBimodality,
  connectedComponents,
  MIN_CUT_OBSERVATIONS,
  nearestNeighbourCut,
  oneNearestDistances,
  type StatementEdge,
} from '../engines/clustering'
import { componentMedoid } from '../engines-stage'

const edge = (a: string, b: string, distance: number): StatementEdge => ({ a, b, distance })

// ---------------------------------------------------------------------------
// The cut
// ---------------------------------------------------------------------------

describe('nearestNeighbourCut', () => {
  it('takes the cut from the median of the field’s OWN 1-NN distances', () => {
    // 100 distances, 0.01 .. 1.00. floor(100 * 0.5) = index 50 -> 0.51.
    const distances = Array.from({ length: 100 }, (_, index) => (index + 1) / 100)
    const cut = nearestNeighbourCut(distances)
    expect(cut).not.toBeNull()
    expect(cut!.p05).toBeCloseTo(0.06, 10)
    expect(cut!.p50).toBeCloseTo(0.51, 10)
    expect(cut!.cut).toBe(cut!.p50)
    expect(cut!.observations).toBe(100)
  })

  it('is not a global constant — a tight field and a loose field get different cuts', () => {
    const tight = Array.from({ length: 60 }, (_, index) => 0.02 + index * 0.0005)
    const loose = Array.from({ length: 60 }, (_, index) => 0.4 + index * 0.005)
    const tightCut = nearestNeighbourCut(tight)!
    const looseCut = nearestNeighbourCut(loose)!
    expect(tightCut.cut).toBeLessThan(0.1)
    expect(looseCut.cut).toBeGreaterThan(0.4)
  })

  it('refuses to calibrate from too few observations rather than guessing', () => {
    const few = Array.from({ length: MIN_CUT_OBSERVATIONS - 1 }, () => 0.3)
    expect(nearestNeighbourCut(few)).toBeNull()
    expect(nearestNeighbourCut([...few, 0.3])).not.toBeNull()
  })

  it('ignores non-finite and negative distances instead of sorting them into the median', () => {
    const values = [...Array.from({ length: 40 }, () => 0.5), Number.NaN, -1, Number.POSITIVE_INFINITY]
    const cut = nearestNeighbourCut(values)!
    expect(cut.observations).toBe(40)
    expect(cut.cut).toBe(0.5)
  })
})

describe('oneNearestDistances', () => {
  it('takes each node’s SMALLEST edge, in both directions', () => {
    const distances = oneNearestDistances(
      ['a', 'b', 'c'],
      [edge('a', 'b', 0.4), edge('b', 'c', 0.1), edge('a', 'c', 0.9)]
    )
    expect(distances.sort()).toEqual([0.1, 0.1, 0.4])
  })

  it('contributes nothing for a node with no edge — an absence of measurement, not a large distance', () => {
    expect(oneNearestDistances(['a', 'b', 'lonely'], [edge('a', 'b', 0.2)])).toEqual([0.2, 0.2])
  })
})

// ---------------------------------------------------------------------------
// Union-find
// ---------------------------------------------------------------------------

describe('connectedComponents', () => {
  it('links only edges at or inside the cut', () => {
    const components = connectedComponents(
      ['a', 'b', 'c', 'd'],
      [edge('a', 'b', 0.2), edge('c', 'd', 0.9)],
      0.5
    )
    expect(components.map(component => component.members)).toEqual([['a', 'b'], ['c'], ['d']])
  })

  it('includes an edge exactly AT the cut — the threshold is inclusive', () => {
    const components = connectedComponents(['a', 'b'], [edge('a', 'b', 0.5)], 0.5)
    expect(components).toHaveLength(1)
  })

  it('is deterministic under edge reordering — the same input always gives the same forest', () => {
    const nodes = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']
    const edges = [
      edge('n1', 'n2', 0.1),
      edge('n2', 'n3', 0.2),
      edge('n4', 'n5', 0.1),
      edge('n5', 'n6', 0.15),
      edge('n3', 'n1', 0.3),
    ]
    const forward = connectedComponents(nodes, edges, 0.5)
    const reversed = connectedComponents(nodes, [...edges].reverse(), 0.5)
    const shuffled = connectedComponents(nodes, [edges[2], edges[4], edges[0], edges[3], edges[1]], 0.5)
    expect(reversed).toEqual(forward)
    expect(shuffled).toEqual(forward)
  })

  it('is deterministic under node reordering', () => {
    const edges = [edge('b', 'a', 0.1), edge('c', 'd', 0.1)]
    const one = connectedComponents(['a', 'b', 'c', 'd'], edges, 0.5)
    const two = connectedComponents(['d', 'c', 'b', 'a'], edges, 0.5)
    expect(two).toEqual(one)
  })

  it('sorts members ascending and components largest-first', () => {
    const components = connectedComponents(
      ['z', 'y', 'x', 'solo'],
      [edge('z', 'y', 0.1), edge('y', 'x', 0.1)],
      0.5
    )
    expect(components[0].members).toEqual(['x', 'y', 'z'])
    expect(components[1].members).toEqual(['solo'])
    expect(components.map(component => component.index)).toEqual([0, 1])
  })

  it('handles a long chain without recursion — path compression is iterative', () => {
    const nodes = Array.from({ length: 5_000 }, (_, index) => `n${String(index).padStart(5, '0')}`)
    const edges = nodes.slice(1).map((node, index) => edge(nodes[index], node, 0.1))
    const components = connectedComponents(nodes, edges, 0.5)
    expect(components).toHaveLength(1)
    expect(components[0].members).toHaveLength(5_000)
  })

  it('ignores edges naming a node that is not in the set', () => {
    const components = connectedComponents(['a', 'b'], [edge('a', 'ghost', 0.1)], 0.5)
    expect(components.map(component => component.members)).toEqual([['a'], ['b']])
  })
})

// ---------------------------------------------------------------------------
// The bimodality guard
// ---------------------------------------------------------------------------

describe('componentBimodality', () => {
  it('splits a "stent" component whose vascular and textile families barely overlap', () => {
    const families = new Map<string, string[]>([
      ['f1', ['A61F']],
      ['f2', ['A61F']],
      ['f3', ['A61F']],
      ['f4', ['A61F']],
      ['f5', ['D04B']],
      ['f6', ['D04B']],
      ['f7', ['D04B']],
      ['f8', ['B29C']],
    ])
    const verdict = componentBimodality(families)
    expect(verdict.bimodal).toBe(true)
    if (!verdict.bimodal) throw new Error('unreachable')
    expect(verdict.groupA).toBe('A61F')
    expect(verdict.groupB).toBe('D04B')
    expect(verdict.sharedShare).toBe(0)
    expect(verdict.partA).toEqual(['f1', 'f2', 'f3', 'f4'])
    expect(verdict.partB).toEqual(['f5', 'f6', 'f7'])
    // Families in neither sense are dropped and counted, never assigned.
    expect(verdict.unassigned).toEqual(['f8'])
  })

  it('leaves an ordinary component alone when its two biggest groups share families', () => {
    // A device patent normally carries both its apparatus and its use class.
    const families = new Map<string, string[]>([
      ['f1', ['A61K', 'A61P']],
      ['f2', ['A61K', 'A61P']],
      ['f3', ['A61K', 'A61P']],
      ['f4', ['A61K']],
      ['f5', ['A61P']],
    ])
    const verdict = componentBimodality(families)
    expect(verdict.bimodal).toBe(false)
    if (verdict.bimodal) throw new Error('unreachable')
    expect(verdict.reason).toBe('groups-overlap')
    expect(verdict.sharedShare).toBeGreaterThan(BIMODAL_SHARED_FAMILY_SHARE)
  })

  it('does not call a handful of stray families a second sense', () => {
    const families = new Map<string, string[]>([
      ['f1', ['G06F']],
      ['f2', ['G06F']],
      ['f3', ['G06F']],
      ['f4', ['G06F']],
      ['f5', ['H04L']],
      ['f6', ['H04L']],
    ])
    // Two families is below the minimum group size, so this is noise, not a sense.
    const verdict = componentBimodality(families)
    expect(verdict.bimodal).toBe(false)
    if (verdict.bimodal) throw new Error('unreachable')
    expect(verdict.reason).toBe('too-small')
  })

  it('is not bimodal when only one classification is present at all', () => {
    const families = new Map<string, string[]>([['f1', ['A01G']], ['f2', ['A01G']], ['f3', []]])
    const verdict = componentBimodality(families)
    if (verdict.bimodal) throw new Error('unreachable')
    expect(verdict.reason).toBe('single-group')
  })

  it('assigns a family carrying BOTH groups to the larger one, so the partition is total', () => {
    const families = new Map<string, string[]>([
      ['f01', ['A61F']],
      ['f02', ['A61F']],
      ['f03', ['A61F']],
      ['f04', ['A61F']],
      ['f05', ['A61F']],
      ['f06', ['A61F', 'D04B']],
      ['f07', ['D04B']],
      ['f08', ['D04B']],
      ['f09', ['D04B']],
      ['f10', ['D04B']],
      ['f11', ['D04B']],
    ])
    const verdict = componentBimodality(families)
    // 1 family of 11 in common — a Jaccard of 0.09, under the 10% floor.
    expect(verdict.bimodal).toBe(true)
    if (!verdict.bimodal) throw new Error('unreachable')
    expect(verdict.partA).toContain('f06')
    expect(verdict.partB).not.toContain('f06')
    expect([...verdict.partA, ...verdict.partB, ...verdict.unassigned].sort()).toEqual(
      Array.from(families.keys()).sort()
    )
  })

  it('names both groups in the coverage note, in the fixed wording', () => {
    expect(bimodalityNote('A61F', 'D04B')).toBe(
      'This scope contains two technically unrelated groups (A61F and D04B). ' +
        'Leads mixing them are not comparable — split the scope.'
    )
  })
})

// ---------------------------------------------------------------------------
// The medoid (the component's stable identity)
// ---------------------------------------------------------------------------

describe('componentMedoid', () => {
  it('picks the densest node — the one most other statements link to', () => {
    const members = ['hub', 'a', 'b', 'c']
    const edges = [edge('hub', 'a', 0.1), edge('hub', 'b', 0.1), edge('hub', 'c', 0.1), edge('a', 'b', 0.2)]
    expect(componentMedoid(members, edges, 0.5)).toBe('hub')
  })

  it('breaks a degree tie on the smaller mean distance, then on id', () => {
    const members = ['x', 'y', 'p', 'q']
    const edges = [edge('x', 'p', 0.1), edge('y', 'q', 0.4)]
    expect(componentMedoid(members, edges, 0.5)).toBe('p')
  })

  it('is stable when a peripheral statement joins — which is what keeps a lead’s fingerprint stable', () => {
    const before = componentMedoid(
      ['hub', 'a', 'b'],
      [edge('hub', 'a', 0.1), edge('hub', 'b', 0.1)],
      0.5
    )
    const after = componentMedoid(
      ['hub', 'a', 'b', 'newcomer'],
      [edge('hub', 'a', 0.1), edge('hub', 'b', 0.1), edge('b', 'newcomer', 0.3)],
      0.5
    )
    expect(after).toBe(before)
  })

  it('returns the only member of a singleton and null for an empty component', () => {
    expect(componentMedoid(['solo'], [], 0.5)).toBe('solo')
    expect(componentMedoid([], [], 0.5)).toBeNull()
  })
})
