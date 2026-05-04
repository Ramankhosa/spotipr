import { describe, expect, test } from 'vitest'
import { buildNormalizedDataBlock } from '@/lib/section-injection-config'

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
})
