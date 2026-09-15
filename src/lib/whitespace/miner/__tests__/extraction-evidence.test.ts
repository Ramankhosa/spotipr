import { describe, expect, it } from 'vitest'
import { verifyEvidenceExtraction } from '../extraction-evidence'

const source = 'Description: The controller does not open the valve when pressure is below 20 kPa. Claims: 1. A controller coupled to a pressure sensor and a valve. 2. The controller of claim 1 wherein the valve remains closed below 20 kPa. Abstract: irrigation control.'

describe('evidence-backed extraction contract', () => {
  it('keeps exact evidence and numbered supplied claims', () => {
    const result = verifyEvidenceExtraction({
      problems: [{ kind: 'admitted_drawback', statement: 'The valve remains closed below 20 kPa.', quote: 'the valve remains closed below 20 kPa' }],
      mechanisms: [{ statement: 'A controller is coupled to a pressure sensor and valve.', quote: 'A controller coupled to a pressure sensor and a valve', elements: [{ statement: 'pressure sensor', quote: 'coupled to a pressure sensor and a valve' }] }],
      technicalEffects: [], teachingAway: [],
      claimedScope: { independentElements: [{ statement: 'controller coupled to sensor and valve', quote: 'A controller coupled to a pressure sensor and a valve', claimNumber: 1 }], dependentNarrowings: [{ statement: 'valve remains closed below 20 kPa', quote: 'the valve remains closed below 20 kPa', claimNumber: 2 }] },
    }, source, true)
    expect(result.claimedScope?.independentElements).toHaveLength(1)
    expect(result.claimedScope?.dependentNarrowings).toHaveLength(1)
    expect(result.sourceEvidence?.every(item => item.quote.length > 0)).toBe(true)
  })

  it('rejects changed negation, quantities, unsupported claims and fabricated spans', () => {
    const result = verifyEvidenceExtraction({
      problems: [{ kind: 'admitted_drawback', statement: 'The controller opens below 30 kPa.', quote: 'does not open the valve when pressure is below 20 kPa' }],
      mechanisms: [{ statement: 'A wireless actuator controls the valve.', quote: 'wireless actuator controls the valve', elements: [] }],
      technicalEffects: [], teachingAway: [],
      claimedScope: { independentElements: [{ statement: 'wireless actuator', quote: 'A controller coupled to a pressure sensor and a valve', claimNumber: 7 }], dependentNarrowings: [] },
    }, source, true)
    expect(result.problems).toEqual([])
    expect(result.mechanisms).toEqual([])
    expect(result.claimedScope).toBeNull()
  })
})
