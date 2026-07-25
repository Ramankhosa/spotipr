import { describe, expect, test } from 'vitest'
import {
  buildClaimScopePromptBlock,
  buildFigureScopePromptBlock,
  coerceScopeRecommendations,
  componentPlannerSeedsFromStage0,
  componentsFromFrozenClaimsAndStage0,
  componentsFromScopeRecommendations,
  filterComponentsByScopeForFigures,
  filterComponentsByScopeForNumbering,
  getEffectiveScopeUse,
  remapScopeSourceRefsForComponents,
} from '@/lib/scope-recommendations'

const rawScope = {
  version: 1,
  generatedAt: '',
  basis: {
    patentTypePrimary: 'SYSTEM',
    inventionType: ['SOFTWARE'],
    fieldOfRelevance: 'Software',
  },
  elements: [
    {
      id: 'sensor',
      label: 'moisture sensor',
      sourceType: 'component',
      recommended: {
        claim: 'claim_1',
        numbering: 'number',
        figures: 'include',
        description: 'include',
      },
      reason: 'Core sensed input for the system.',
      sourceRefs: ['components[0]'],
    },
    {
      id: 'rain_forecast',
      label: 'rain forecast condition',
      sourceType: 'condition',
      recommended: {
        claim: 'dependent_claim',
        numbering: 'do_not_number',
        figures: 'do_not_show',
        description: 'include',
      },
      reason: 'Fallback condition.',
      sourceRefs: ['sourceFactLedger.conditionsAndRules[0]'],
    },
    {
      id: 'garden',
      label: 'garden use case',
      sourceType: 'use_case',
      recommended: {
        claim: 'none',
        numbering: 'do_not_number',
        figures: 'do_not_show',
        description: 'optional',
      },
      reason: 'Use-case context only.',
      sourceRefs: ['sourceFactLedger.examplesAndUseCases[0]'],
    },
  ],
}

describe('scope recommendations helpers', () => {
  test('coerces LLM-provided recommendations without generating new recommendations', () => {
    const scope = coerceScopeRecommendations(rawScope, { patentTypePrimary: 'SYSTEM', inventionType: ['SOFTWARE'] })

    expect(scope?.elements.map(element => element.label)).toEqual([
      'moisture sensor',
      'rain forecast condition',
      'garden use case',
    ])
    expect(scope?.basis.patentTypePrimary).toBe('SYSTEM')
    expect(scope?.elements[0].recommended.claim).toBe('claim_1')
  })

  test('user selections override LLM recommendations', () => {
    const scope = coerceScopeRecommendations({
      ...rawScope,
      elements: [
        {
          ...rawScope.elements[0],
          user: { claim: 'none', figures: 'do_not_show' },
        },
      ],
    })

    expect(scope).toBeTruthy()
    expect(getEffectiveScopeUse(scope!.elements[0]).claim).toBe('none')
    expect(getEffectiveScopeUse(scope!.elements[0]).figures).toBe('do_not_show')
    expect(getEffectiveScopeUse(scope!.elements[0]).numbering).toBe('number')
  })

  test('preserves not-stated gap elements when they carry reason or source references', () => {
    const scope = coerceScopeRecommendations({
      ...rawScope,
      elements: [
        {
          id: 'missing_enablement',
          label: 'Not stated by source',
          sourceType: 'other',
          recommended: {
            claim: 'claim_1',
            numbering: 'number',
            figures: 'include',
            description: 'include',
          },
          reason: 'Source does not state controller placement.',
          sourceRefs: ['sourceFactLedger.notStated[0]'],
        },
      ],
    })

    expect(scope?.elements).toHaveLength(1)
    expect(scope?.elements[0].label).toBe('Not stated by source')
    expect(scope?.elements[0].recommended).toEqual({
      claim: 'none',
      numbering: 'do_not_number',
      figures: 'do_not_show',
      description: 'exclude',
    })
  })

  test('filters numbering and figure components using effective selections', () => {
    const scope = coerceScopeRecommendations(rawScope)!
    const components = [
      { name: 'moisture sensor', referenceLabel: '100' },
      { name: 'rain forecast condition', referenceLabel: '200' },
      { name: 'garden use case', referenceLabel: '300' },
    ]

    expect(filterComponentsByScopeForNumbering(components, scope).map(c => c.name)).toEqual(['moisture sensor'])
    expect(filterComponentsByScopeForFigures(components, scope).components.map(c => c.name)).toEqual(['moisture sensor'])
    expect(filterComponentsByScopeForFigures(components, scope).excludedLabels).toContain('garden use case')
  })

  test('builds component planner seeds from number-selected recommendations only', () => {
    const scope = coerceScopeRecommendations(rawScope)!

    expect(componentsFromScopeRecommendations(scope, [{ name: 'moisture sensor' }])
      .map(component => component.name)).toEqual(['moisture sensor'])
  })

  test('never seeds a component that is absent from the Stage 0 component list', () => {
    const scope = coerceScopeRecommendations(rawScope)!

    // No Stage 0 components to enrich: scope alone must not mint any.
    expect(componentsFromScopeRecommendations(scope, [])).toEqual([])
  })

  test('ignores number-selected scope elements sourced outside the component list', () => {
    const scope = coerceScopeRecommendations({
      ...rawScope,
      elements: [
        {
          ...rawScope.elements[0],
          id: 'claimable_feature',
          label: 'Irrigation scheduled from a rolling moisture average',
          sourceType: 'other',
          sourceRefs: ['claimableFeatures[0]'],
        },
      ],
    })!

    expect(componentsFromScopeRecommendations(scope, [{ name: 'moisture sensor' }])).toEqual([])
  })

  test('builds component planner seeds from frozen claims using Stage 0 components only', () => {
    const scope = coerceScopeRecommendations(rawScope)!
    const components = [
      { name: 'moisture sensor', description: 'Sensor that detects soil moisture.' },
      { name: 'valve driver', description: 'Drives an irrigation valve.' },
    ]

    const seeds = componentsFromFrozenClaimsAndStage0({
      normalizedComponents: components,
      scopeRecommendations: scope,
      claims: [
        {
          number: 1,
          type: 'independent',
          text: 'A system comprising a moisture sensor configured to detect soil moisture and a controller.',
        },
      ],
    })

    expect(seeds.map(component => component.name)).toEqual(['moisture sensor'])
    expect(seeds[0].claimSupport).toMatchObject({
      source: 'frozen_claims',
      matchedClaims: [1],
      claimRole: 'claim_1',
    })
  })

  test('component planner seeding preserves Stage 0 components beyond frozen-claim matches', () => {
    const scope = coerceScopeRecommendations({
      ...rawScope,
      elements: [
        rawScope.elements[0],
        {
          id: 'valve_driver',
          label: 'valve driver',
          sourceType: 'component',
          recommended: {
            claim: 'dependent_claim',
            numbering: 'number',
            figures: 'include',
            description: 'include',
          },
          reason: 'Actuation component useful for figures.',
          sourceRefs: ['components[1]'],
        },
      ],
    })!
    const components = [
      { name: 'moisture sensor', description: 'Sensor that detects soil moisture.' },
      { name: 'valve driver', description: 'Drives an irrigation valve.' },
      { name: 'battery pack', description: 'Supplies operating power.' },
    ]

    const seeds = componentPlannerSeedsFromStage0({
      normalizedComponents: components,
      scopeRecommendations: scope,
      claims: [
        {
          number: 1,
          type: 'independent',
          text: 'A system comprising a moisture sensor configured to detect soil moisture.',
        },
      ],
    })

    expect(seeds.map(component => component.name)).toEqual([
      'moisture sensor',
      'valve driver',
      'battery pack',
    ])
    expect(seeds[0].claimSupport).toMatchObject({
      source: 'frozen_claims',
      matchedClaims: [1],
    })
  })

  test('does not create planner components from claim text absent from Stage 0', () => {
    const seeds = componentsFromFrozenClaimsAndStage0({
      normalizedComponents: [{ name: 'moisture sensor' }],
      scopeRecommendations: coerceScopeRecommendations(rawScope),
      claimsText: '1. A system comprising a moisture sensor and a controller.',
    })

    expect(seeds.map(component => component.name)).toEqual(['moisture sensor'])
  })

  test('uses source component titles when scope labels are claim-like descriptions', () => {
    const scope = coerceScopeRecommendations({
      ...rawScope,
      elements: [
        {
          ...rawScope.elements[0],
          id: 'sensor_scope',
          label: 'Moisture sensor configured to detect soil moisture and trigger irrigation control',
          reason: 'Core claim element and figure anchor.',
          sourceRefs: ['components[0]'],
        },
      ],
    })!

    const seeds = componentsFromScopeRecommendations(scope, [
      {
        name: 'Moisture sensor',
        description: 'Sensor that detects soil moisture.',
      },
    ])

    expect(seeds[0].name).toBe('Moisture sensor')
    expect(seeds[0].description).toBe('Sensor that detects soil moisture.')
    expect(seeds[0].scopeLabel).toBe('Moisture sensor configured to detect soil moisture and trigger irrigation control')
  })

  test('does not invent a composite component for labels citing multiple subparts', () => {
    const scope = coerceScopeRecommendations({
      ...rawScope,
      elements: [
        {
          ...rawScope.elements[0],
          id: 'two_layer_coating',
          label: 'Pellets having an inner barrier layer and an outer enteric layer',
          reason: 'Composite coating feature.',
          sourceRefs: ['components[0]', 'components[1]'],
        },
      ],
    })!
    const components = [
      { name: 'Inner barrier layer', description: 'Inner coating.' },
      { name: 'Outer enteric layer', description: 'Outer coating.' },
    ]

    // A composite label spanning two Stage 0 components is ambiguous, so it must
    // not become a third component named after the scope element. The planner
    // shows the two real subparts and nothing else.
    expect(componentsFromScopeRecommendations(scope, components)).toEqual([])
    expect(componentPlannerSeedsFromStage0({
      normalizedComponents: components,
      scopeRecommendations: scope,
    }).map(component => component.name)).toEqual([
      'Inner barrier layer',
      'Outer enteric layer',
    ])
  })

  test('remaps positional component source refs when Stage 0 components are reordered', () => {
    const scope = coerceScopeRecommendations(rawScope)!
    const previous = [{ name: 'moisture sensor' }, { name: 'valve driver' }]
    const next = [{ name: 'valve driver' }, { name: 'moisture sensor' }]

    const remapped = remapScopeSourceRefsForComponents(scope, previous, next)!

    expect(remapped.elements[0].sourceRefs).toEqual(['components[1]'])
    // Non-component refs are left untouched.
    expect(remapped.elements[1].sourceRefs).toEqual(['sourceFactLedger.conditionsAndRules[0]'])

    // The planner still resolves the element to the same real component.
    expect(componentsFromScopeRecommendations(remapped, next).map(c => c.name)).toEqual(['moisture sensor'])
  })

  test('drops component source refs whose component was deleted', () => {
    const scope = coerceScopeRecommendations(rawScope)!
    const remapped = remapScopeSourceRefsForComponents(
      scope,
      [{ name: 'moisture sensor' }],
      [{ name: 'valve driver' }]
    )!

    expect(remapped.elements[0].sourceRefs).toEqual([])
    // A dangling element must not resurface as an invented component.
    expect(componentsFromScopeRecommendations(remapped, [{ name: 'valve driver' }])).toEqual([])
  })

  test('builds claim and figure scope prompt blocks', () => {
    const scope = coerceScopeRecommendations(rawScope)!

    expect(buildClaimScopePromptBlock(scope)).toContain('USER-APPROVED CLAIM SCOPE')
    expect(buildClaimScopePromptBlock(scope)).toContain('moisture sensor')
    expect(buildClaimScopePromptBlock(scope)).toContain('garden use case')
    expect(buildFigureScopePromptBlock(scope)).toContain('USER-APPROVED FIGURE SCOPE')
    expect(buildFigureScopePromptBlock(scope)).toContain('Do not show in figures')
  })
})
