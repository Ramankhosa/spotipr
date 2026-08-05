import { describe, expect, test } from 'vitest'
import {
  analyzePreliminaryClaimQuality,
  buildPreliminaryClaimsPrompt,
  resetPreliminaryClaimFields,
  shouldBlockPreliminaryClaimReset,
} from '@/lib/preliminary-claim-generation'
import type { DraftClaim } from '@/lib/draft-claims-parser'

const basePromptParams = {
  jurisdiction: 'US',
  countryName: 'United States',
  officeName: 'USPTO',
  tone: 'technical, neutral, precise',
  voice: 'impersonal third person',
  avoid: 'marketing language',
  baseInstruction: 'Draft preliminary claims. Claim 1 must recite the minimum source-supported inventive combination. Do not pad the set.',
  rulesBlock: 'JURISDICTION RULES (US):\n- Use comprising.',
  constraintsBlock: 'CONSTRAINTS:\n- Maintain antecedent basis.',
  context: {
    title: 'Irrigation Controller',
    rawIdea: 'A controller activates drip irrigation when soil moisture is below 18 percent unless rain is forecast.',
    problem: 'Water waste from irrigation.',
    logic: 'Soil moisture below 18 percent activates drip irrigation unless rain is forecast.',
    components: [
      { name: 'moisture sensor', description: 'detects soil moisture' },
      { name: 'irrigation valve', description: 'controls drip irrigation' },
    ],
    sourceFactLedger: {
      numericValuesAndUnits: ['18 percent'],
      conditionsAndRules: ['Soil moisture below 18 percent activates drip irrigation unless rain is forecast.'],
    },
  },
  patentTypePrimary: 'SYSTEM' as const,
}

describe('preliminary claim generation helper', () => {
  test('builds a source-grounded prompt with support matrix requirements', () => {
    const prompt = buildPreliminaryClaimsPrompt(basePromptParams)

    expect(prompt).toContain('minimum source-supported inventive combination')
    expect(prompt).toContain('Generate no more than 10 total claims')
    expect(prompt).toContain('Do not pad the set')
    expect(prompt).toContain('Expected Claim 1 category: system or apparatus')
    expect(prompt).toContain('"category": "system"')
    expect(prompt).not.toContain('PRELIMINARY CLAIM DRAFTING RULES')
    expect(prompt).toContain('SF-numericValuesAndUnits-1')
    expect(prompt).toContain('CLAIM SCOPE STYLE STRATEGY')
    expect(prompt).toContain('Selected style: Default Style')
  })

  test('allows an explicit higher claim count to override the default cap', () => {
    const prompt = buildPreliminaryClaimsPrompt({
      ...basePromptParams,
      maxClaims: 15,
    })

    expect(prompt).toContain('Generate no more than 15 total claims')
  })

  test('injects broad claim scope strategy without changing the output contract', () => {
    const prompt = buildPreliminaryClaimsPrompt({
      ...basePromptParams,
      claimScopeStyle: 'broad',
    })

    expect(prompt).toContain('Selected style: Broad Style')
    expect(prompt).toContain('minimum source-supported inventive combination')
    expect(prompt).toContain('Put concrete embodiments, numeric values, materials, examples, alternatives, and fallback limitations into dependent claims')
    expect(prompt).toContain('Broad does not mean generic')
    expect(prompt).toContain('Return ONLY one JSON object')
  })

  test('asks for claims only, never for a support matrix or quality warnings', () => {
    // The support matrix and quality warnings are derived locally after generation. Asking
    // the model for them costs output tokens (and wall-clock) for data nothing reads, so the
    // contract must request claims alone and override any base prompt that says otherwise.
    const prompt = buildPreliminaryClaimsPrompt(basePromptParams)

    expect(prompt).toContain('exactly one top-level key, "claims"')
    expect(prompt).toContain('Do NOT emit a support matrix, quality warnings')
    expect(prompt).not.toContain('"supportMatrix"')
    expect(prompt).not.toContain('"qualityWarnings"')
    expect(prompt).not.toContain('"supportRefs"')
    expect(prompt).not.toContain('"supportSummary"')
    expect(prompt).not.toContain('Cite specific SDS-IDs')
  })

  test('still parses and analyzes a claims-only payload with no LLM metadata', () => {
    // Guards the runtime consequence of the trimmed contract: the analyzer must produce a
    // full support matrix from source context alone when the model returns claims only.
    const quality = analyzePreliminaryClaimQuality({
      claims: [
        {
          number: 1,
          type: 'independent',
          category: 'system',
          text: 'A system comprising a moisture sensor and an irrigation valve, wherein the irrigation valve activates drip irrigation when soil moisture detected by the moisture sensor is below 18 percent unless rain is forecast.',
        },
      ],
      patentTypePrimary: 'SYSTEM',
      context: basePromptParams.context,
      llmSupportMatrix: [],
      llmQualityWarnings: [],
    })

    expect(quality.source).toBe('static')
    expect(quality.supportMatrix).toHaveLength(1)
    expect(quality.supportMatrix[0].supportRefs.length).toBeGreaterThanOrEqual(2)
    expect(quality.supportMatrix[0].supportSummary).toContain('Supported by')
  })

  test('injects narrow claim scope strategy without relaxing source support', () => {
    const prompt = buildPreliminaryClaimsPrompt({
      ...basePromptParams,
      claimScopeStyle: 'narrow',
    })

    expect(prompt).toContain('Selected style: Narrow Claims')
    expect(prompt).toContain('more concrete source-supported differentiators')
    expect(prompt).toContain('Every narrowing limitation must map to SDS-ID, SF-ID, or normalized source context')
    expect(prompt).toContain('Every claim element MUST map to at least one source fact')
  })

  test('uses patent-type-specific output examples', () => {
    const compositionPrompt = buildPreliminaryClaimsPrompt({
      ...basePromptParams,
      patentTypePrimary: 'COMPOSITION',
    })

    expect(compositionPrompt).toContain('Expected Claim 1 category: composition or formulation')
    expect(compositionPrompt).toContain('"category": "composition"')
    expect(compositionPrompt).toContain('A composition comprising source-supported constituents')
  })

  test('injects user-approved claim scope when scope recommendations exist', () => {
    const prompt = buildPreliminaryClaimsPrompt({
      ...basePromptParams,
      context: {
        ...basePromptParams.context,
        scopeRecommendations: {
          version: 1,
          generatedAt: '2026-05-05T00:00:00.000Z',
          basis: { patentTypePrimary: 'SYSTEM', inventionType: ['SOFTWARE'] },
          elements: [
            {
              id: 'sensor',
              label: 'moisture sensor',
              sourceType: 'component',
              recommended: { claim: 'claim_1', numbering: 'number', figures: 'include', description: 'include' },
              reason: 'Core component.',
              sourceRefs: ['components[0]'],
            },
            {
              id: 'garden',
              label: 'garden use case',
              sourceType: 'use_case',
              recommended: { claim: 'none', numbering: 'do_not_number', figures: 'do_not_show', description: 'optional' },
              reason: 'Use case only.',
              sourceRefs: ['sourceFactLedger.examplesAndUseCases[0]'],
            },
          ],
        },
      },
    })

    expect(prompt).toContain('USER-APPROVED CLAIM SCOPE')
    expect(prompt).toContain('CLAIM 1 SCOPE')
    expect(prompt).toContain('moisture sensor')
    expect(prompt).toContain('DO NOT PROMOTE INTO CLAIMS')
    expect(prompt).toContain('garden use case')
  })

  test('warns for generic broad Claim 1', () => {
    const claims: DraftClaim[] = [
      {
        number: 1,
        type: 'independent',
        category: 'system',
        text: 'A system comprising one or more processors and a memory configured to perform operations and generate an output.',
      },
    ]

    const quality = analyzePreliminaryClaimQuality({
      claims,
      patentTypePrimary: 'SYSTEM',
      context: basePromptParams.context,
    })

    expect(quality.status).toBe('needs_review')
    expect(quality.warnings.some(warning => warning.code === 'GENERIC_CLAIM_1')).toBe(true)
  })

  test('passes a source-specific Claim 1 without warnings', () => {
    const claims: DraftClaim[] = [
      {
        number: 1,
        type: 'independent',
        category: 'system',
        text: 'A system comprising a moisture sensor and an irrigation valve, wherein the irrigation valve activates drip irrigation when soil moisture detected by the moisture sensor is below 18 percent unless rain is forecast.',
      },
    ]

    const quality = analyzePreliminaryClaimQuality({
      claims,
      patentTypePrimary: 'SYSTEM',
      context: basePromptParams.context,
    })

    expect(quality.status).toBe('source_supported')
    expect(quality.warnings).toHaveLength(0)
    expect(quality.supportMatrix[0].supportRefs.length).toBeGreaterThanOrEqual(2)
  })

  test('warns for unsupported numeric and material limitations', () => {
    const claims: DraftClaim[] = [
      {
        number: 1,
        type: 'independent',
        category: 'product',
        text: 'A device comprising a titanium housing configured to open at 75 percent humidity.',
      },
    ]

    const quality = analyzePreliminaryClaimQuality({
      claims,
      patentTypePrimary: 'PRODUCT',
      context: {
        title: 'Humidity Device',
        rawIdea: 'A device opens a vent when humidity rises.',
        components: [{ name: 'vent', description: 'opens when humidity rises' }],
      },
    })

    expect(quality.warnings.some(warning => warning.code === 'UNSUPPORTED_NUMERIC_VALUE')).toBe(true)
    expect(quality.warnings.some(warning => warning.code === 'UNSUPPORTED_MATERIAL')).toBe(true)
  })

  test('marks very thin source disclosure for user review without blocking claims', () => {
    const quality = analyzePreliminaryClaimQuality({
      claims: [
        {
          number: 1,
          type: 'independent',
          category: 'product',
          text: 'A device comprising a cable clip.',
        },
      ],
      patentTypePrimary: 'PRODUCT',
      context: {
        title: 'Cable Clip',
        rawIdea: 'A smart clip for cables.',
      },
    })

    expect(quality.status).toBe('thin_disclosure')
    expect(quality.warnings.some(warning => warning.code === 'THIN_DISCLOSURE')).toBe(true)
  })

  test('resets claim fields while preserving normalized idea data and user preferences', () => {
    const reset = resetPreliminaryClaimFields({
      title: 'Irrigation Controller',
      problem: 'Water waste from irrigation.',
      userClaimRemarks: 'Keep claim 1 broad.',
      claimScopeStyle: 'broad',
      patentTypePrimary: 'SYSTEM',
      claims: '<p>1. A system...</p>',
      claimsStructured: [{ number: 1, text: 'A system...' }],
      claimsProvisional: '<p>1. A system...</p>',
      claimsStructuredProvisional: [{ number: 1, text: 'A system...' }],
      claimsFinal: '<p>1. A system...</p>',
      claimsStructuredFinal: [{ number: 1, text: 'A system...' }],
      claimsApprovedAt: '2026-05-06T00:00:00.000Z',
      claimsApprovedBy: 'user-1',
      claimsGeneratedAt: '2026-05-06T00:00:00.000Z',
      claimsLastSavedAt: '2026-05-06T00:00:00.000Z',
      claimsJurisdiction: 'US',
      claimGenerationQuality: { status: 'source_supported' },
      claimsRefinementPreview: { refinedClaims: [] },
      claimsRefinementApplied: true,
      claimsRefinementNotes: 'Claim 1 refined.',
      claimsRefinementSource: { mode: 'AUTO' },
    })

    expect(reset).toMatchObject({
      title: 'Irrigation Controller',
      problem: 'Water waste from irrigation.',
      userClaimRemarks: 'Keep claim 1 broad.',
      claimScopeStyle: 'broad',
      patentTypePrimary: 'SYSTEM',
    })
    expect(reset).not.toHaveProperty('claims')
    expect(reset).not.toHaveProperty('claimsStructured')
    expect(reset).not.toHaveProperty('claimsProvisional')
    expect(reset).not.toHaveProperty('claimsStructuredProvisional')
    expect(reset).not.toHaveProperty('claimsFinal')
    expect(reset).not.toHaveProperty('claimsStructuredFinal')
    expect(reset).not.toHaveProperty('claimsApprovedAt')
    expect(reset).not.toHaveProperty('claimsApprovedBy')
    expect(reset).not.toHaveProperty('claimsGeneratedAt')
    expect(reset).not.toHaveProperty('claimsLastSavedAt')
    expect(reset).not.toHaveProperty('claimsJurisdiction')
    expect(reset).not.toHaveProperty('claimGenerationQuality')
    expect(reset).not.toHaveProperty('claimsRefinementPreview')
    expect(reset).not.toHaveProperty('claimsRefinementApplied')
    expect(reset).not.toHaveProperty('claimsRefinementNotes')
    expect(reset).not.toHaveProperty('claimsRefinementSource')
  })

  test('allows claim reset until a downstream artifact exists', () => {
    expect(shouldBlockPreliminaryClaimReset({
      normalizedData: { claims: '<p>1. A system...</p>' },
    })).toBe(false)

    const artifacts = [
      'relatedArtRunCount',
      'relatedArtSelectionCount',
      'referenceMapCount',
      'figurePlanCount',
      'annexureDraftCount',
    ] as const

    artifacts.forEach((key) => {
      expect(shouldBlockPreliminaryClaimReset({
        normalizedData: { claims: '<p>1. A system...</p>' },
        [key]: 1,
      })).toBe(true)
    })

    expect(shouldBlockPreliminaryClaimReset({
      normalizedData: {
        claims: '<p>1. A system...</p>',
        claimsRefinementPreview: { refinedClaims: [] },
      },
    })).toBe(true)
  })

  test('reset is judged by artifacts, not by where the user has navigated', () => {
    // A user may move forward and back through the pipeline freely. Sitting on a later stage
    // that has produced nothing is not downstream work, and previously blocked the reset with
    // a message claiming work existed when it did not.
    expect(shouldBlockPreliminaryClaimReset({
      normalizedData: { claims: '<p>1. A system...</p>' },
      relatedArtRunCount: 0,
      relatedArtSelectionCount: 0,
      referenceMapCount: 0,
      figurePlanCount: 0,
      annexureDraftCount: 0,
    })).toBe(false)
  })

  test('skipping prior art or refinement does not block a reset', () => {
    // Both skip paths stamp claimsRefinementSource and freeze the claims as final without
    // deriving anything from them, so a reset must still be allowed.
    const skipped = ['SKIPPED', 'SKIPPED_REFINEMENT']
    skipped.forEach((mode) => {
      expect(shouldBlockPreliminaryClaimReset({
        normalizedData: {
          claims: '<p>1. A system...</p>',
          claimsRefinementSource: { mode, skipPriorArt: true, appliedAt: '2026-05-06T00:00:00.000Z' },
        },
      })).toBe(false)
    })

    // Falsy leftovers are not evidence of refinement either.
    expect(shouldBlockPreliminaryClaimReset({
      normalizedData: {
        claims: '<p>1. A system...</p>',
        claimsRefinementApplied: false,
        claimsRefinementNotes: '',
      },
    })).toBe(false)

    // Applied refinement still blocks, in every mode that rewrites the claims.
    ;['AUTO', 'MANUAL', 'HYBRID'].forEach((mode) => {
      expect(shouldBlockPreliminaryClaimReset({
        normalizedData: {
          claims: '<p>1. A system...</p>',
          claimsRefinementSource: { mode, appliedAt: '2026-05-06T00:00:00.000Z' },
        },
      })).toBe(true)
    })

    expect(shouldBlockPreliminaryClaimReset({
      normalizedData: {
        claims: '<p>1. A system...</p>',
        claimsRefinementNotes: 'Claim 1: narrowed to the source-supported combination.',
      },
    })).toBe(true)
  })
})
