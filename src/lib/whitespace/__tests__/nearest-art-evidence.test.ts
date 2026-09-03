import { describe, expect, it } from 'vitest'
import { nearestArtEvidenceRows } from '../hypothesize'
import type { SemanticNeighbor } from '../embedding'

const neighbor = (id: number, familyKey: string, distance: number, abstract: string | null = 'An abstract.'): SemanticNeighbor => ({
  id,
  publicationNumber: `PUB-${id}`,
  familyKey,
  title: `Title ${id}`,
  abstract,
  distance,
})

describe('nearestArtEvidenceRows', () => {
  it('emits CONTEXT patent passages tagged NEAREST_ART with ascending rank and distance as score', () => {
    const rows = nearestArtEvidenceRows(
      [neighbor(1, 'fam-a', 0.1), neighbor(2, 'fam-b', 0.2)],
      'The statement'
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      kind: 'PATENT_PASSAGE',
      stance: 'CONTEXT',
      refId: 'PUB-1',
      queryText: 'The statement',
      score: 0.1,
      data: { role: 'NEAREST_ART', familyKey: 'fam-a', rank: 1 },
    })
    expect(rows[1].data.rank).toBe(2)
  })

  it('dedupes by family and caps at eight', () => {
    const rows = nearestArtEvidenceRows(
      [
        neighbor(1, 'fam-a', 0.1),
        neighbor(2, 'fam-a', 0.11),
        ...Array.from({ length: 12 }, (_, i) => neighbor(10 + i, `fam-${i}`, 0.2 + i / 100)),
      ],
      'The statement'
    )

    expect(rows).toHaveLength(8)
    expect(rows[0].refId).toBe('PUB-1')
    expect(new Set(rows.map(r => r.data.familyKey)).size).toBe(8)
  })

  it('truncates the passage and preserves a null abstract as null', () => {
    const rows = nearestArtEvidenceRows(
      [neighbor(1, 'fam-a', 0.1, 'x'.repeat(2000)), neighbor(2, 'fam-b', 0.2, null)],
      'S'
    )

    expect(rows[0].passage).toHaveLength(1000)
    expect(rows[1].passage).toBeNull()
  })
})
