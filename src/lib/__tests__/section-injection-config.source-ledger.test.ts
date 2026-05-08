import { describe, expect, test } from 'vitest'
import {
  buildAntiHallucinationGuards,
  buildDetailedDescriptionSourceLockBlock,
  buildDetailedDescriptionScopeContext,
  buildNormalizedDataBlock,
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
