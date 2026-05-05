import { describe, expect, test } from 'vitest'
import {
  buildDetailedDescriptionScopeContext,
  buildNormalizedDataBlock
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
})
