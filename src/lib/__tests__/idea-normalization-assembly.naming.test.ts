import { describe, expect, it } from 'vitest'
import { normalizeCoreComponents } from '@/lib/idea-normalization-assembly'

const INVENTOR_PHRASE = 'a plurality of soil moisture sensors placed in the root zone'

describe('normalizeCoreComponents naming modes', () => {
  it('STRUCTURE_ONLY keeps the historical short display name as the canonical name', () => {
    const [component] = normalizeCoreComponents(
      [{ name: INVENTOR_PHRASE, type: 'SENSOR' }],
      { mode: 'STRUCTURE_ONLY' }
    )
    expect(component.name).not.toBe(INVENTOR_PHRASE)
    expect(component.name.split(/\s+/).length).toBeLessThanOrEqual(7)
    expect(component.originalName).toBe(INVENTOR_PHRASE)
    expect(component.displayLabel).toBe(component.name)
  })

  it('defaults to STRUCTURE_ONLY when no mode is given', () => {
    const [component] = normalizeCoreComponents([{ name: INVENTOR_PHRASE, type: 'SENSOR' }])
    expect(component.name).not.toBe(INVENTOR_PHRASE)
    expect(component.originalName).toBe(INVENTOR_PHRASE)
  })

  it('PRESERVE keeps the inventor phrase verbatim as the canonical name', () => {
    const [component] = normalizeCoreComponents(
      [{ name: INVENTOR_PHRASE, type: 'SENSOR' }],
      { mode: 'PRESERVE' }
    )
    expect(component.name).toBe(INVENTOR_PHRASE)
    expect(component.originalName).toBe(INVENTOR_PHRASE)
    // Short label still available for figure/sketch surfaces.
    expect(component.displayLabel).toBeTruthy()
    expect(component.displayLabel).not.toBe(INVENTOR_PHRASE)
  })

  it('PRESERVE resolves parent references against the verbatim names', () => {
    const components = normalizeCoreComponents(
      [
        { name: 'a clip for the lid handle', type: 'OTHER' },
        { name: 'spring latch', type: 'OTHER', parent: 'a clip for the lid handle' },
      ],
      { mode: 'PRESERVE' }
    )
    expect(components[1].parent).toBe('a clip for the lid handle')
  })

  it('collapses internal whitespace in originalName but preserves wording', () => {
    const [component] = normalizeCoreComponents(
      [{ name: '  a   clip\nfor the lid handle ', type: 'OTHER' }],
      { mode: 'PRESERVE' }
    )
    expect(component.name).toBe('a clip for the lid handle')
    expect(component.originalName).toBe('a clip for the lid handle')
  })
})
