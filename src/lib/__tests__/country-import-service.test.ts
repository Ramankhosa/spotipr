import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  buildSupersetIndexFromSections,
  deriveCountryMappings,
  SupersetSectionInput
} from '../country-import-service'

const COUNTRIES_DIR = path.join(process.cwd(), 'Countries')

function loadJson(file: string): any {
  return JSON.parse(fs.readFileSync(path.join(COUNTRIES_DIR, file), 'utf-8'))
}

function loadSupersetFixture(): SupersetSectionInput[] {
  const rows = loadJson('db-superset-sections.json')
  return rows.map((r: any) => ({
    sectionKey: r.sectionKey,
    aliases: r.aliases || [],
    label: r.label,
    displayOrder: r.displayOrder,
    instruction: r.instruction || ''
  }))
}

describe('deriveCountryMappings (JP.json against the seeded superset catalog)', () => {
  const index = buildSupersetIndexFromSections(loadSupersetFixture())
  const jp = loadJson('JP.json')
  const { mappings, issues } = deriveCountryMappings(jp, index)
  const byKey = new Map(mappings.map(m => [m.sectionKey, m]))

  it('resolves snake_case canonical keys to camelCase superset keys', () => {
    expect(byKey.get('background')?.structureId).toBe('background_art')
    expect(byKey.get('detailedDescription')?.structureId).toBe('description_of_embodiments')
    expect(byKey.get('fieldOfInvention')?.structureId).toBe('technical_field')
    expect(byKey.get('crossReference')?.structureId).toBe('cross_reference')
  })

  it('warns for sections with no superset counterpart and skips them', () => {
    const unresolved = issues.filter(i => i.code === 'UNRESOLVED_SECTION')
    const unresolvedIds = unresolved.map(i => i.sectionId)
    expect(unresolvedIds).toContain('citation_list')
    expect(unresolvedIds).toContain('reference_signs_list')
    expect(byKey.has('citation_list')).toBe(false)
    for (const issue of unresolved) {
      expect(issue.severity).toBe('warning')
    }
  })

  it('derives supersetCode with per-country zero-padded order and the superset label', () => {
    // JP background_art has order 4; superset label is "Background of the Invention"
    const background = byKey.get('background')!
    expect(background.supersetCode).toBe(`04. ${index.byKey.get('background')!.label}`)
    expect(background.displayOrder).toBe(4)
  })

  it('uses the structure label (cleaned of "(optional)") as the heading', () => {
    expect(byKey.get('fieldOfInvention')?.heading).toBe('Technical Field')
    // "Industrial Applicability (optional)" → qualifier stripped
    expect(byKey.get('industrialApplicability')?.heading).toBe('Industrial Applicability')
    expect(byKey.get('crossReference')?.heading).toBe('Cross-Reference to Related Applications')
  })

  it('carries required flags and enables every derived mapping', () => {
    expect(byKey.get('title')?.isRequired).toBe(true)
    expect(byKey.get('crossReference')?.isRequired).toBe(false)
    expect(mappings.every(m => m.isEnabled)).toBe(true)
  })

  it('derives mappings for every resolvable JP section (10 of 12)', () => {
    // 12 structure sections minus citation_list and reference_signs_list
    expect(mappings).toHaveLength(10)
    expect(byKey.has('title')).toBe(true)
    expect(byKey.has('claims')).toBe(true)
    expect(byKey.has('abstract')).toBe(true)
  })

  it('emits no error-severity issues for a well-formed profile', () => {
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })
})

describe('deriveCountryMappings edge cases', () => {
  const index = buildSupersetIndexFromSections(loadSupersetFixture())

  function minimalProfile(sections: any[]): any {
    return {
      meta: { code: 'XX' },
      structure: { defaultVariant: 'standard', variants: [{ id: 'standard', sections }] }
    }
  }

  it('errors when two sections resolve to the same superset key', () => {
    const { mappings, issues } = deriveCountryMappings(
      minimalProfile([
        { id: 'summary_of_invention', label: 'Summary', order: 1, canonicalKeys: ['summary_of_invention'], required: true },
        { id: 'disclosure_of_invention', label: 'Disclosure', order: 2, canonicalKeys: ['disclosure_of_invention'], required: true }
      ]),
      index
    )
    expect(mappings).toHaveLength(1)
    expect(issues.some(i => i.code === 'DUPLICATE_CANONICAL_KEY')).toBe(true)
  })

  it('errors when the structure has no resolvable sections', () => {
    const { issues } = deriveCountryMappings(
      minimalProfile([
        { id: 'mystery_section', label: 'Mystery', order: 1, canonicalKeys: ['mystery_section'], required: true }
      ]),
      index
    )
    expect(issues.some(i => i.code === 'NO_MAPPINGS_DERIVED' && i.severity === 'error')).toBe(true)
  })

  it('errors when structure.variants is missing', () => {
    const { issues } = deriveCountryMappings({ meta: { code: 'XX' }, structure: {} }, index)
    expect(issues.some(i => i.code === 'NO_VARIANTS' && i.severity === 'error')).toBe(true)
  })

  it('suggests the nearest superset key for near-miss identifiers', () => {
    const { issues } = deriveCountryMappings(
      minimalProfile([
        { id: 'backgrund_art', label: 'Background', order: 1, canonicalKeys: ['backgrund_art'], required: true }
      ]),
      index
    )
    const unresolved = issues.find(i => i.code === 'UNRESOLVED_SECTION')
    expect(unresolved?.suggestion).toBe('background')
  })
})
