import { describe, expect, test } from 'vitest'
import {
  buildAntiHallucinationGuards,
  buildDetailedDescriptionSourceLockBlock,
  buildDetailedDescriptionScopeContext,
  buildIndependentClaimsBlock,
  buildNormalizedDataBlock,
  buildUniversalDraftingBundle,
  extractIndependentClaims,
  filterDetailedDescriptionConstraints
} from '@/lib/section-injection-config'

describe('normalized data section injection', () => {
  test('passes source fact ledger and component metadata into section context', () => {
    const block = buildNormalizedDataBlock(
      {
        title: 'Irrigation Controller',
        logic: 'Soil moisture below 18 percent activates drip irrigation unless rain is forecast.',
        bestMethod: 'Not stated by source',
        components: [
          {
            name: 'Moisture sensor',
            description: 'detects soil moisture',
            inputs: 'soil moisture',
            outputs: 'moisture signal',
            parent: 'controller assembly',
            level: 1,
            conditions: 'below 18 percent',
            alternatives: 'rain forecast fallback',
          },
        ],
        sourceFactLedger: {
          numericValuesAndUnits: ['18 percent'],
          conditionsAndRules: ['activate drip irrigation unless rain is forecast'],
          safetyFallbackOrExpiryRules: ['rain forecast fallback'],
        },
      },
      null
    )

    expect(block).toContain('Moisture sensor')
    expect(block).toContain('inputs=soil moisture')
    expect(block).toContain('outputs=moisture signal')
    expect(block).toContain('parent=controller assembly')
    expect(block).toContain('conditions=below 18 percent')
    expect(block).toContain('alternatives=rain forecast fallback')
    expect(block).toContain('SOURCE FACT LEDGER')
    expect(block).toContain('18 percent')
    expect(block).toContain('unless rain is forecast')
  })

  test('uses normalized data before denormalized idea fields in section context', () => {
    const block = buildNormalizedDataBlock(
      {
        problem: 'Fresh normalized problem',
        components: [{ name: 'Fresh Component', description: 'from normalized data' }],
      },
      {
        problem: 'Stale idea problem',
        components: [{ name: 'Stale Component', description: 'from idea record' }],
        normalizedData: {
          problem: 'Nested problem',
        },
      }
    )

    expect(block).toContain('Fresh normalized problem')
    expect(block).toContain('Fresh Component')
    expect(block).not.toContain('Stale idea problem')
    expect(block).not.toContain('Stale Component')
  })

  test('gates best mode sections until frozen Claim 1 is available', () => {
    const result = buildUniversalDraftingBundle('bestMethod', { problem: 'x' }, null)

    expect(result.gated).toBe(true)
    expect(result.gateReason).toContain('Claim 1')
  })

  test('injects only LLM-classified independent claims with count-based heading', () => {
    const normalizedData = {
      claimsApprovedAt: '2026-05-05T00:00:00.000Z',
      claimsStructuredFinal: [
        { number: 1, type: 'independent', category: 'system', text: 'A system comprising a controller.' },
        { number: 2, type: 'dependent', text: 'The system of claim 1, wherein the controller filters signals.' },
        { number: 8, type: 'independent', category: 'method', text: 'A method comprising operating the controller.' },
      ],
    }

    const block = buildIndependentClaimsBlock(normalizedData, 'bindingAnchor')

    expect(extractIndependentClaims(normalizedData)).toContain('Claim 8 (method):')
    expect(block).toContain('INDEPENDENT CLAIMS')
    expect(block).toContain('A system comprising a controller')
    expect(block).toContain('A method comprising operating the controller')
    expect(block).not.toContain('filters signals')
  })

  test('suppresses UDB independent-claims injection when template already supplies it', () => {
    const normalizedData = {
      claimsApprovedAt: '2026-05-05T00:00:00.000Z',
      claimsStructuredFinal: [
        { number: 1, type: 'independent', text: 'A system comprising a controller.' },
      ],
    }

    const result = buildUniversalDraftingBundle('summary', normalizedData, null, undefined, {
      suppressClaimInjection: true,
    })

    expect(result.gated).toBe(false)
    expect(result.block).not.toContain('FROZEN - LEGAL AUTHORITY')
  })

  test('gates legacy extraction-failed normalized data', () => {
    const result = buildUniversalDraftingBundle(
      'background',
      { problem: 'Extraction failed - review source text' },
      null
    )

    expect(result.gated).toBe(true)
    expect(result.gateReason).toContain('Stage 0 normalization failed')
  })

  test('limits detailed description figure and numeral context to the invention scope', () => {
    const normalizedData = {
      claimsApprovedAt: '2026-05-05T00:00:00.000Z',
      claimsStructuredFinal: [
        {
          number: 1,
          type: 'independent',
          category: 'system',
          text: 'A system comprising a moisture sensor and an irrigation valve configured to activate drip irrigation when soil moisture is below 18 percent.'
        }
      ],
      components: [
        { name: 'moisture sensor', description: 'detects soil moisture' },
        { name: 'irrigation valve', description: 'controls drip irrigation' }
      ],
      logic: 'The irrigation valve activates drip irrigation based on the moisture sensor output.'
    }

    const context = buildDetailedDescriptionScopeContext(
      normalizedData,
      null,
      [
        { name: 'moisture sensor', referenceLabel: '100' },
        { name: 'irrigation valve', referenceLabel: '200' },
        { name: 'weather satellite gateway', referenceLabel: '900' }
      ],
      [
        { figureNo: 1, title: 'System architecture' },
        { figureNo: 2, title: 'Weather satellite gateway integration' }
      ]
    )

    expect(context.allowedReferenceLabels).toEqual(['100', '200'])
    expect(context.allowedFigureNumbers).toEqual([1])
    expect(context.guard).toContain('Allowed component/reference context')
    expect(context.guard.includes('No figure references')).toBe(false)
  })

  test('always supplies a detailed description source-lock guard', () => {
    const guard = buildDetailedDescriptionSourceLockBlock('detailedDescription')

    expect(guard).toContain('DETAILED DESCRIPTION SOURCE LOCK')
    expect(guard).toContain('Frozen Claim 1 and the Normalized Data')
    expect(guard).toContain('injected DD user data are auxiliary context only')
    expect(guard).toContain('omit the detail')
    expect(buildDetailedDescriptionSourceLockBlock('summary')).toBe('')
  })

  test('filters detailed description constraints that invite unsupported subject matter', () => {
    const constraints = [
      'Enable skilled person to practice',
      'Reference figures with numerals',
      'Include multiple embodiments',
      'Describe best mode',
      'Add specific parameters and examples'
    ]

    expect(filterDetailedDescriptionConstraints('detailedDescription', constraints)).toEqual([
      'Enable skilled person to practice',
      'Reference figures with numerals'
    ])
    expect(filterDetailedDescriptionConstraints('summary', constraints)).toEqual(constraints)
  })

  test('warns detailed description prompts not to invent missing figure or component context', () => {
    const guard = buildAntiHallucinationGuards(false, true, false)

    expect(guard).toContain('Do NOT invent figure numbers or titles')
    expect(guard).toContain('Do NOT invent component names or reference numerals')
  })
})
