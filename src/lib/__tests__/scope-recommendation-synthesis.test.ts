import { describe, expect, it } from 'vitest'

import { synthesizeScopeRecommendations } from '@/lib/scope-recommendation-synthesis'

describe('synthesizeScopeRecommendations', () => {
  it('returns undefined scopeRecommendations when there is nothing to project', () => {
    const result = synthesizeScopeRecommendations({})
    expect(result.scopeRecommendations).toBeUndefined()
    expect(result.claimableFeatureTexts).toEqual([])
  })

  it('projects components with inline scope enums and components[i] sourceRefs', () => {
    const result = synthesizeScopeRecommendations({
      patentTypePrimary: 'SYSTEM',
      inventionType: ['MECHANICAL', 'SOFTWARE'],
      fieldOfRelevance: 'Logistics',
      subfield: 'Cold chain',
      components: [
        { name: 'Temperature Sensor Array', scope: { claim: 'claim_1', numbering: 'number', figures: 'include', description: 'include' } },
        { name: 'Telemetry Module' },
      ],
    })

    const scope = result.scopeRecommendations
    expect(scope).toBeDefined()
    expect(scope!.version).toBe(1)
    expect(scope!.basis).toMatchObject({
      patentTypePrimary: 'SYSTEM',
      inventionType: ['MECHANICAL', 'SOFTWARE'],
      fieldOfRelevance: 'Logistics',
      subfield: 'Cold chain',
    })

    const [first, second] = scope!.elements
    expect(first).toMatchObject({
      label: 'Temperature Sensor Array',
      sourceType: 'component',
      recommended: { claim: 'claim_1', numbering: 'number', figures: 'include', description: 'include' },
      sourceRefs: ['components[0]'],
    })
    expect(first.reason).toBe('Cooperating subsystem needed for the independent system claim.')

    // Missing scope -> permissive defaults, never exclusion
    expect(second).toMatchObject({
      label: 'Telemetry Module',
      recommended: { claim: 'dependent_claim', numbering: 'number', figures: 'include', description: 'include' },
      sourceRefs: ['components[1]'],
    })
  })

  it('falls back per-field for invalid enum values', () => {
    const result = synthesizeScopeRecommendations({
      patentTypePrimary: 'PRODUCT',
      components: [
        { name: 'Housing', scope: { claim: 'primary', numbering: 'do_not_number', figures: 'banana', description: 'exclude' } },
      ],
    })
    expect(result.scopeRecommendations!.elements[0].recommended).toEqual({
      claim: 'dependent_claim', // invalid 'primary' -> default
      numbering: 'do_not_number', // valid value kept
      figures: 'include', // invalid 'banana' -> default
      description: 'exclude', // valid value kept
    })
  })

  it('maps sourceType from hierarchy and patent type', () => {
    const process = synthesizeScopeRecommendations({
      patentTypePrimary: 'PROCESS',
      components: [
        { name: 'Mixing Step' },
        { name: 'Sub Step', level: 1 },
        { name: 'Child Of Parent', parent: 'Mixing Step' },
      ],
    })
    const types = process.scopeRecommendations!.elements.map((e: any) => e.sourceType)
    expect(types).toEqual(['process_step', 'subcomponent', 'subcomponent'])

    const composition = synthesizeScopeRecommendations({
      patentTypePrimary: 'COMPOSITION',
      components: [{ name: 'Excipient Blend' }],
    })
    expect(composition.scopeRecommendations!.elements[0].sourceType).toBe('constituent')
  })

  it('passes through the why text as the reason when supplied', () => {
    const result = synthesizeScopeRecommendations({
      patentTypePrimary: 'PRODUCT',
      components: [
        { name: 'Decorative Cover', scope: { figures: 'do_not_show', why: 'Purely aesthetic; not part of the invention.' } },
      ],
    })
    expect(result.scopeRecommendations!.elements[0].reason).toBe('Purely aesthetic; not part of the invention.')
  })

  it('handles claimableFeatures as objects and as plain strings', () => {
    const result = synthesizeScopeRecommendations({
      patentTypePrimary: 'SYSTEM',
      components: [{ name: 'Controller' }],
      claimableFeatures: [
        { feature: 'Threshold-based shutdown', scope: { claim: 'dependent_claim' } },
        'Battery fallback mode',
      ],
    })

    expect(result.claimableFeatureTexts).toEqual(['Threshold-based shutdown', 'Battery fallback mode'])

    const featureElements = result.scopeRecommendations!.elements.filter(
      (e: any) => e.sourceRefs[0].startsWith('claimableFeatures[')
    )
    expect(featureElements).toHaveLength(2)
    expect(featureElements[0]).toMatchObject({
      label: 'Threshold-based shutdown',
      sourceType: 'other',
      recommended: { claim: 'dependent_claim', numbering: 'do_not_number', figures: 'optional', description: 'include' },
      sourceRefs: ['claimableFeatures[0]'],
    })
  })

  it('projects fallbackLimitations and doNotClaim entries with restrictive defaults', () => {
    const result = synthesizeScopeRecommendations({
      patentTypePrimary: 'PRODUCT',
      components: [{ name: 'Valve' }],
      fallbackLimitations: ['Shut off above 90 degrees C'],
      doNotClaim: ['Cloud analytics dashboard'],
    })

    const byRef = (prefix: string) =>
      result.scopeRecommendations!.elements.find((e: any) => e.sourceRefs[0].startsWith(prefix))

    expect(byRef('fallbackLimitations[')).toMatchObject({
      label: 'Shut off above 90 degrees C',
      sourceType: 'condition',
      recommended: { claim: 'dependent_claim', numbering: 'do_not_number', figures: 'do_not_show', description: 'include' },
    })
    expect(byRef('doNotClaim[')).toMatchObject({
      label: 'Cloud analytics dashboard',
      recommended: { claim: 'none', numbering: 'do_not_number', figures: 'do_not_show', description: 'optional' },
    })
  })

  it('skips placeholder and empty entries', () => {
    const result = synthesizeScopeRecommendations({
      components: [{ name: '' }, { name: '   ' }],
      claimableFeatures: ['Not stated by source'],
      fallbackLimitations: ['not stated by source'],
    })
    expect(result.scopeRecommendations).toBeUndefined()
  })
})
