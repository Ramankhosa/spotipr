import { describe, expect, test } from 'vitest'
import {
  buildClaimScopePromptBlock,
  buildFigureScopePromptBlock,
  coerceScopeRecommendations,
  componentsFromFrozenClaimsAndStage0,
  componentsFromScopeRecommendations,
  filterComponentsByScopeForFigures,
  filterComponentsByScopeForNumbering,
  getEffectiveScopeUse,
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

    expect(componentsFromScopeRecommendations(scope).map(component => component.name)).toEqual(['moisture sensor'])
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

  test('uses concise scope titles for composite labels that cite multiple subparts', () => {
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

    const seeds = componentsFromScopeRecommendations(scope, [
      { name: 'Inner barrier layer', description: 'Inner coating.' },
      { name: 'Outer enteric layer', description: 'Outer coating.' },
    ])

    expect(seeds[0].name).toBe('Two layer coating')
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
