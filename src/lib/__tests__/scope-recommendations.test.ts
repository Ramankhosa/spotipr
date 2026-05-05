import { describe, expect, test } from 'vitest'
import {
  buildClaimScopePromptBlock,
  buildFigureScopePromptBlock,
  coerceScopeRecommendations,
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

  test('builds claim and figure scope prompt blocks', () => {
    const scope = coerceScopeRecommendations(rawScope)!

    expect(buildClaimScopePromptBlock(scope)).toContain('USER-APPROVED CLAIM SCOPE')
    expect(buildClaimScopePromptBlock(scope)).toContain('moisture sensor')
    expect(buildClaimScopePromptBlock(scope)).toContain('garden use case')
    expect(buildFigureScopePromptBlock(scope)).toContain('USER-APPROVED FIGURE SCOPE')
    expect(buildFigureScopePromptBlock(scope)).toContain('Do not show in figures')
  })
})
