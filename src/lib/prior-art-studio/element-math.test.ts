import { describe, expect, it } from 'vitest'
import { anticipationOnly, findAnticipationCandidates, findCombinations } from './element-math'
import type { StudioElement, StudioElementCell, StudioElementVerdict } from './types'

const elements: StudioElement[] = [
  { id: 'e1', text: 'a clutch that slips at a preset torque', origin: 'user' },
  { id: 'e2', text: 'an audible click on release', origin: 'user' },
  { id: 'e3', text: 'a one-piece sterilizable housing', origin: 'user' },
]

function cells(...verdicts: StudioElementVerdict[]): Record<string, StudioElementCell> {
  return Object.fromEntries(
    verdicts.map((verdict, index) => [
      elements[index].id,
      { verdict, matchedTerms: [], termCoverage: 0, tier: 'claims' } satisfies StudioElementCell,
    ])
  )
}

describe('findAnticipationCandidates', () => {
  it('does not present an all-PART document as a §102 candidate', () => {
    // Anticipation requires each and every element. A row where nothing scored
    // better than PART used to be returned indistinguishably from a full-STRONG
    // row, highlighted green, and offered for pinning as §102.
    const candidates = findAnticipationCandidates({
      elements,
      rows: [{ familyKey: 'f1', publicationNumber: 'US1111111A1', cells: cells('PART', 'PART', 'PART') }],
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0].tier).toBe('NEAR')
    expect(anticipationOnly(candidates)).toHaveLength(0)
  })

  it('presents a document that teaches every element strongly as a §102 candidate', () => {
    const candidates = findAnticipationCandidates({
      elements,
      rows: [{ familyKey: 'f1', publicationNumber: 'US2222222A1', cells: cells('STRONG', 'STRONG', 'STRONG') }],
    })

    expect(anticipationOnly(candidates).map(c => c.publicationNumber)).toEqual(['US2222222A1'])
    expect(candidates[0].strongCount).toBe(3)
  })

  it('treats a single PART among STRONGs as NEAR, not anticipation', () => {
    const candidates = findAnticipationCandidates({
      elements,
      rows: [{ familyKey: 'f1', publicationNumber: 'US3333333A1', cells: cells('STRONG', 'STRONG', 'PART') }],
    })

    expect(candidates[0].tier).toBe('NEAR')
    expect(anticipationOnly(candidates)).toHaveLength(0)
  })

  it('ignores documents that miss an element entirely', () => {
    const candidates = findAnticipationCandidates({
      elements,
      rows: [{ familyKey: 'f1', publicationNumber: 'US4444444A1', cells: cells('STRONG', 'STRONG', 'NONE') }],
    })

    expect(candidates).toHaveLength(0)
  })

  it('ranks stronger candidates first', () => {
    const candidates = findAnticipationCandidates({
      elements,
      rows: [
        { familyKey: 'weak', publicationNumber: 'US5555555A1', cells: cells('PART', 'PART', 'PART') },
        { familyKey: 'strong', publicationNumber: 'US6666666A1', cells: cells('STRONG', 'STRONG', 'STRONG') },
      ],
    })

    expect(candidates.map(c => c.familyKey)).toEqual(['strong', 'weak'])
  })
})

describe('findCombinations', () => {
  it('pairs complementary documents that jointly reach every element', () => {
    const combos = findCombinations({
      elements,
      rows: [
        { familyKey: 'a', publicationNumber: 'US7777777A1', cells: cells('STRONG', 'STRONG', 'NONE') },
        { familyKey: 'b', publicationNumber: 'US8888888A1', cells: cells('NONE', 'NONE', 'STRONG') },
      ],
    })

    expect(combos).toHaveLength(1)
    expect(combos[0].publicationNumbers).toEqual(['US7777777A1', 'US8888888A1'])
    expect(combos[0].covered).toBe(3)
  })

  it('does not pair a document with one that adds nothing', () => {
    const combos = findCombinations({
      elements,
      rows: [
        { familyKey: 'a', publicationNumber: 'US7777777A1', cells: cells('STRONG', 'STRONG', 'NONE') },
        { familyKey: 'b', publicationNumber: 'US8888888A1', cells: cells('STRONG', 'NONE', 'NONE') },
      ],
    })

    expect(combos).toHaveLength(0)
  })
})
