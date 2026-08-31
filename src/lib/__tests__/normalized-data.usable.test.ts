import { describe, expect, it } from 'vitest'
import { isNormalizedDataUsable } from '@/lib/normalized-data'

describe('isNormalizedDataUsable', () => {
  it('rejects the empty blob a failed Stage 0 leaves behind', () => {
    expect(isNormalizedDataUsable({})).toBe(false)
    expect(isNormalizedDataUsable(null)).toBe(false)
    expect(isNormalizedDataUsable(undefined)).toBe(false)
  })

  it('accepts a record with extracted components', () => {
    expect(isNormalizedDataUsable({ components: [{ name: 'Controller' }] })).toBe(true)
  })

  it('accepts a component-less record with a real core concept or problem', () => {
    expect(isNormalizedDataUsable({ coreInventiveConcept: 'A latch that self-tightens.' })).toBe(true)
    expect(isNormalizedDataUsable({ problem: 'Lids fall off.' })).toBe(true)
  })

  it('treats "Not stated by source" placeholders as absent', () => {
    expect(isNormalizedDataUsable({
      components: [],
      coreInventiveConcept: 'Not stated by source',
      problem: '  ',
    })).toBe(false)
  })

  it('rejects records flagged as extraction failures even with content', () => {
    expect(isNormalizedDataUsable({
      components: [{ name: 'Controller' }],
      extractionFailed: true,
    })).toBe(false)
  })
})
