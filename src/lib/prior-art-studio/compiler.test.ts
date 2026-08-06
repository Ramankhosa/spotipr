import { describe, expect, it } from 'vitest'
import { compileStudioPlan } from './compiler'
import { emptyStudioPlan } from './types'

describe('compileStudioPlan MATCH groups', () => {
  it('keeps broad recall terms while carrying MATCH blocks as structured AND groups', () => {
    const plan = emptyStudioPlan()
    plan.title = 'Optical controller'
    plan.blocks = [
      {
        id: 'sensor',
        label: 'Sensor',
        mode: 'MATCH',
        terms: [
          { text: 'optical sensor', origin: 'user', accepted: true },
          { text: 'photodetector', origin: 'user', accepted: true },
        ],
      },
      {
        id: 'control',
        label: 'Control',
        mode: 'MATCH',
        terms: [{ text: 'feedback controller', origin: 'user', accepted: true }],
      },
      {
        id: 'expansion',
        label: 'Meaning',
        mode: 'EXPAND',
        terms: [{ text: 'adaptive calibration', origin: 'user', accepted: true }],
      },
    ]

    const compiled = compileStudioPlan(plan)
    expect(compiled.queryPlan.searchQuery).toContain('"optical sensor" OR photodetector')
    expect(compiled.queryPlan.literalMatchGroups).toEqual([
      { id: 'sensor', label: 'Sensor', terms: ['optical sensor', 'photodetector'] },
      { id: 'control', label: 'Control', terms: ['feedback controller'] },
    ])
    expect(compiled.queryPlan.retrievalQueries?.some(query => query.text.includes('adaptive calibration'))).toBe(true)
  })
})

describe('compileStudioPlan filters', () => {
  it('never forwards NOT terms to the provider', () => {
    // The provider re-merges queryPlan.excludedTerms into fieldFilters, which
    // compiles to an unindexable ILIKE over fully-detoasted claims and
    // description text on EVERY lane. Exclusions are applied post-retrieval in
    // service.ts instead; leaving them off fieldFilters is not enough on its own.
    const plan = emptyStudioPlan()
    plan.title = 'Torque limiter'
    plan.blocks = [
      { id: 'a', label: 'Drive', mode: 'BOTH', terms: [{ text: 'torque', origin: 'user', accepted: true }] },
    ]
    plan.notTerms = [
      { text: 'dental', origin: 'user', accepted: true },
      { text: 'veterinary', origin: 'user', accepted: true },
    ]

    const compiled = compileStudioPlan(plan)
    expect(compiled.queryPlan.excludedTerms).toEqual([])
    expect(compiled.queryPlan.fieldFilters?.excludeTerms).toBeUndefined()
    // The attorney still sees them — they are enforced, just not in SQL.
    expect(compiled.booleanPreview).toContain('NOT (dental OR veterinary)')
  })

  it('turns the jurisdiction selection into a country filter the search can apply', () => {
    // `jurisdictions` on the search request only routes providers, and Studio
    // pins its provider list, so without this the Filters gate counted a
    // narrowing that the search never performed.
    const plan = emptyStudioPlan()
    plan.title = 'Bone screw'
    plan.blocks = [
      { id: 'a', label: 'Screw', mode: 'BOTH', terms: [{ text: 'bone screw', origin: 'user', accepted: true }] },
    ]
    plan.filters.jurisdictions = ['US', 'EP']

    const compiled = compileStudioPlan(plan)
    expect(compiled.queryPlan.fieldFilters?.countries).toEqual(['US', 'EP'])
    expect(compiled.jurisdictions).toEqual(['US', 'EP'])
  })

  it('treats the worldwide selection as no country filter at all', () => {
    const plan = emptyStudioPlan()
    plan.title = 'Bone screw'
    plan.blocks = [
      { id: 'a', label: 'Screw', mode: 'BOTH', terms: [{ text: 'bone screw', origin: 'user', accepted: true }] },
    ]
    plan.filters.jurisdictions = ['*']

    const compiled = compileStudioPlan(plan)
    expect(compiled.queryPlan.fieldFilters?.countries).toBeUndefined()
    expect(compiled.jurisdictions).toEqual(['*'])
  })
})
