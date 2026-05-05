import { describe, expect, test } from 'vitest'
import {
  analyzePreliminaryClaimQuality,
  buildPreliminaryClaimsPrompt,
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
    expect(prompt).toContain('Do not pad the set')
    expect(prompt).toContain('Expected Claim 1 category: system or apparatus')
    expect(prompt).toContain('"category": "system"')
    expect(prompt).not.toContain('PRELIMINARY CLAIM DRAFTING RULES')
    expect(prompt).toContain('supportMatrix')
    expect(prompt).toContain('qualityWarnings')
    expect(prompt).toContain('SF-numericValuesAndUnits-1')
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
})
