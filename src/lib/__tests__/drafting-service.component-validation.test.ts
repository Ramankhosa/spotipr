import { describe, expect, it } from 'vitest'
import { DraftingService } from '../drafting-service'

const baseComponents = [
  { id: 'system', name: 'System' },
  { id: 'controller', name: 'Controller', parentId: 'system' }
]

describe('DraftingService.validateComponentMap component validation hardening', () => {
  it('rejects invalid numbering style overrides', () => {
    const result = DraftingService.validateComponentMap(
      baseComponents,
      'SYSTEM',
      'BAD_STYLE' as any
    )

    expect(result.valid).toBe(false)
    expect(result.errors?.join(' ')).toContain('Invalid numbering style')
  })

  it('rejects self-parent references', () => {
    const result = DraftingService.validateComponentMap([
      { id: 'controller', name: 'Controller', parentId: 'controller' }
    ], 'SYSTEM')

    expect(result.valid).toBe(false)
    expect(result.errors?.join(' ')).toContain('cannot be its own parent')
  })

  it('rejects rootless cycles', () => {
    const result = DraftingService.validateComponentMap([
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' }
    ], 'SYSTEM')

    expect(result.valid).toBe(false)
    expect(result.errors?.join(' ')).toContain('Circular reference')
  })

  it('keeps valid numeric, step, and constituent numbering behavior', () => {
    const numeric = DraftingService.validateComponentMap(baseComponents, 'SYSTEM', 'NUMERIC_BUCKET')
    const step = DraftingService.validateComponentMap(baseComponents, 'PROCESS', 'STEP_LABEL')
    const constituent = DraftingService.validateComponentMap(baseComponents, 'COMPOSITION', 'CONSTITUENT_LABEL')

    expect(numeric.valid).toBe(true)
    expect(numeric.components?.map(c => c.referenceLabel)).toEqual(['100', '101'])
    expect(step.valid).toBe(true)
    expect(step.components?.map(c => c.referenceLabel)).toEqual(['S100', 'S200'])
    expect(constituent.valid).toBe(true)
    expect(constituent.components?.map(c => c.referenceLabel)).toEqual(['(a)', '(b)'])
  })

  it('does not emit undefined missing numerals for incomplete reference-map entries', () => {
    const result = DraftingService.validateDraftConsistencyPublic(
      { fullText: 'The system includes a controller (101).' },
      {
        referenceMap: {
          components: [
            { id: 'bad', name: 'Incomplete component' },
            { id: 'controller', name: 'Controller', numeral: 101 }
          ]
        },
        figurePlans: []
      }
    )

    expect(result.valid).toBe(true)
    expect(result.report.missingNumerals).toEqual([])
    expect(result.report.missingNumerals).not.toContain(undefined)
  })
})
