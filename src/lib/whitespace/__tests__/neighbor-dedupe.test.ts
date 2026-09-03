import { describe, expect, it } from 'vitest'
import { dedupeNeighborsByFamily, type SemanticNeighbor } from '../embedding'

const neighbor = (id: number, familyKey: string, distance: number): SemanticNeighbor => ({
  id,
  publicationNumber: `PUB-${id}`,
  familyKey,
  title: null,
  abstract: null,
  distance,
})

describe('dedupeNeighborsByFamily', () => {
  it('keeps only the first (nearest) row per family, preserving order', () => {
    const rows = [
      neighbor(1, 'fam-a', 0.1),
      neighbor(2, 'fam-b', 0.15),
      neighbor(3, 'fam-a', 0.2),
      neighbor(4, 'fam-c', 0.25),
      neighbor(5, 'fam-b', 0.3),
    ]

    const deduped = dedupeNeighborsByFamily(rows, 10)

    expect(deduped.map(n => n.id)).toEqual([1, 2, 4])
  })

  it('stops at max distinct families', () => {
    const rows = [
      neighbor(1, 'fam-a', 0.1),
      neighbor(2, 'fam-b', 0.2),
      neighbor(3, 'fam-c', 0.3),
      neighbor(4, 'fam-d', 0.4),
    ]

    expect(dedupeNeighborsByFamily(rows, 2).map(n => n.familyKey)).toEqual(['fam-a', 'fam-b'])
  })

  it('handles empty input', () => {
    expect(dedupeNeighborsByFamily([], 5)).toEqual([])
  })
})
