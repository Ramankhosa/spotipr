import { describe, expect, test } from 'vitest'
import {
  buildDisclosureCoverageLedger,
  evaluateCoverageLedger,
  materializeCoverageLedger,
  normalizeCoverageClaims,
  repairFigureSetCoverage,
  stageCoverageComponentAdditions,
} from '@/lib/patent-diagrams/coverage'
import { figureSetPlanSchema, type FigureCoverageLedger, type PatentDiagramComponent } from '@/lib/patent-diagrams/types'

const components: PatentDiagramComponent[] = [
  { id: 'controller', name: 'controller', referenceLabel: '100', claimSupport: { matchedClaims: [1], claimRole: 'claim_1' } },
  { id: 'sensor', name: 'sensor', referenceLabel: '200', claimSupport: { matchedClaims: [1, 2], claimRole: 'claim_1' } },
]

describe('claim-complete patent diagram coverage', () => {
  test('normalizes every independent and dependent claim without truncating claim text', () => {
    const claims = normalizeCoverageClaims({
      claims: [
        { number: 1, type: 'independent', text: 'A system comprising a controller and a sensor.' },
        { number: 2, type: 'dependent', dependsOn: 1, text: 'The system of claim 1, wherein the controller applies a threshold.' },
      ],
    })
    expect(claims).toHaveLength(2)
    expect(claims[1]).toMatchObject({ number: 2, type: 'dependent', dependsOn: 1 })
    expect(claims[1].text).toContain('applies a threshold')
  })

  test('materializes grounded requirements and rejects text not present in the identified claim', () => {
    const claims = normalizeCoverageClaims([{ number: 1, text: 'A system comprising a controller coupled to a sensor.' }])
    const extraction = {
      requirements: [{
        claimNumber: 1,
        type: 'RELATIONSHIP' as const,
        label: 'controller coupled to sensor',
        sourceText: 'controller coupled to a sensor',
        componentIds: ['controller', 'sensor'],
      }],
    }
    const ledger = materializeCoverageLedger({ contextChecksum: 'context-1', claims, extraction, components })
    expect(ledger.requirements[0].sourceId).toBe('CLAIM-1')
    expect(ledger.requirements[0].evidenceIds[0]).toMatch(/^CLM-1-/)
    expect(() => materializeCoverageLedger({
      contextChecksum: 'context-1', claims,
      extraction: { requirements: [{ ...extraction.requirements[0], sourceText: 'invented wireless network' }] },
      components,
    })).toThrow(/not an exact claim excerpt/i)
  })

  test('rejects a ledger that silently omits an independent or dependent claim limitation', () => {
    const claims = normalizeCoverageClaims([
      { number: 1, text: 'A system comprising a controller; a sensor configured to measure temperature.' },
      { number: 2, type: 'dependent', dependsOn: 1, text: 'The system of claim 1, wherein the controller stores a threshold.' },
    ])
    expect(() => materializeCoverageLedger({
      contextChecksum: 'context-limitations', claims, components,
      extraction: {
        requirements: [{
          claimNumber: 1, type: 'COMPONENT', label: 'controller', sourceText: 'controller', componentIds: ['controller'],
        }],
      },
    })).toThrow(/omitted claim limitations/i)
  })

  test('retains every supported requirement category with exact claim provenance', () => {
    const phrases = [
      ['COMPONENT', 'a controller'],
      ['RELATIONSHIP', 'the controller coupled to a sensor'],
      ['PROCESS_STEP', 'deriving an output'],
      ['STATE_CONDITION', 'when a threshold is exceeded'],
      ['ALTERNATIVE', 'alternatively selecting a stored value'],
      ['QUANTITY_RANGE', 'a ratio from 1:2 to 1:4'],
      ['CONSTITUENT_ROLE', 'a binder configured to retain particles'],
      ['DATA_STRUCTURE', 'a record storing the output'],
    ] as const
    const claims = normalizeCoverageClaims([{ number: 1, text: phrases.map(([, phrase]) => phrase).join('; ') }])
    const ledger = materializeCoverageLedger({
      contextChecksum: 'context-categories', claims, components,
      extraction: {
        requirements: phrases.map(([type, sourceText]) => ({
          claimNumber: 1, type, label: sourceText, sourceText, componentIds: ['controller'],
        })),
      },
    })
    expect(new Set(ledger.requirements.map(requirement => requirement.type))).toEqual(new Set(phrases.map(([type]) => type)))
    expect(ledger.requirements.every(requirement => requirement.sourceId === 'CLAIM-1')).toBe(true)
  })

  test('auto-adds a missing claim component with an append-only stable reference label', () => {
    const ledger: FigureCoverageLedger = {
      schemaVersion: 1,
      contextChecksum: 'context-2',
      basis: 'CLAIMS',
      requirements: [{
        id: 'COV-2-variable', claimNumber: 2, type: 'DATA_STRUCTURE', label: 'state variable',
        sourceText: 'a state variable', sourceId: 'CLAIM-2', componentIds: [], evidenceIds: ['CLM-2-variable'], required: true,
        componentCandidate: { name: 'state variable', type: 'MEMORY', parentId: 'controller' },
      }],
    }
    const staged = stageCoverageComponentAdditions({
      ledger,
      numberingStyle: 'NUMERIC_BUCKET',
      storedComponents: components.map(component => ({ ...component, numeral: Number(component.referenceLabel) })),
    })
    expect(staged.additions).toHaveLength(1)
    expect(staged.additions[0]).toMatchObject({ name: 'state variable', referenceLabel: '300', numeral: 300, parentId: 'controller' })
    expect(staged.ledger.requirements[0].componentIds).toEqual([staged.additions[0].id])
    expect(components.map(component => component.referenceLabel)).toEqual(['100', '200'])
  })

  test('refuses automatic append when existing reference labels are not stable', () => {
    const ledger: FigureCoverageLedger = {
      schemaVersion: 1, contextChecksum: 'context-unstable', basis: 'CLAIMS',
      requirements: [{
        id: 'COV-missing', claimNumber: 1, type: 'COMPONENT', label: 'missing unit', sourceText: 'missing unit',
        sourceId: 'CLAIM-1', componentIds: [], evidenceIds: ['CLM-1-missing'], required: true,
        componentCandidate: { name: 'missing unit', type: 'MODULE' },
      }],
    }
    expect(() => stageCoverageComponentAdditions({
      ledger, numberingStyle: 'NUMERIC_BUCKET',
      storedComponents: [{ id: 'a', name: 'A', referenceLabel: '100' }, { id: 'b', name: 'B', referenceLabel: '100' }],
    })).toThrow(/duplicated/i)
  })

  test('treats six as a target and adds a seventh figure instead of dropping coverage', () => {
    const fullIds = Array.from({ length: 96 }, (_, index) => `component-${index + 1}`)
    const figures = Array.from({ length: 6 }, (_, index) => ({
      key: `figure-${index + 1}`, kind: 'COMPONENT' as const, title: `Figure ${index + 1}`, purpose: 'Architecture coverage',
      detailLevel: 'DETAIL' as const, direction: 'TB' as const,
      componentIds: fullIds.slice(index * 16, index * 16 + 16), claimCriticalComponentIds: [],
      orderedGroups: [], phaseHints: [], evidenceIds: [], coverageRequirementIds: [],
    }))
    const ledger: FigureCoverageLedger = {
      schemaVersion: 1, contextChecksum: 'context-3', basis: 'CLAIMS',
      requirements: [{
        id: 'COV-8-extra', claimNumber: 8, type: 'COMPONENT', label: 'additional controller',
        sourceText: 'additional controller', sourceId: 'CLAIM-8', componentIds: ['extra'], evidenceIds: ['CLM-8-extra'], required: true,
      }],
    }
    const plan = figureSetPlanSchema.parse({ schemaVersion: 2, contextChecksum: 'context-3', coverageLedger: ledger, figures })
    const repaired = repairFigureSetCoverage({ plan, ledger })
    expect(repaired.plan.figures).toHaveLength(7)
    expect(repaired.plan.figures[6].coverageRequirementIds).toEqual(['COV-8-extra'])
    expect(repaired.summary.figureChanges).toEqual([{
      figureKey: 'coverage-cov-8-extra', action: 'ADDED', requirementIds: ['COV-8-extra'], claimNumbers: [8],
    }])
    expect(evaluateCoverageLedger({ ledger, figures: repaired.plan.figures }).status).toBe('COMPLETE')
  })

  test('keeps a manually described batch exact and reports remaining disclosure coverage', () => {
    const ledger = buildDisclosureCoverageLedger({ contextChecksum: 'context-4', components, evidenceCatalog: [{ id: 'SF-processSteps-1', value: 'compare the sensor value with a threshold' }] })
    const plan = figureSetPlanSchema.parse({
      schemaVersion: 2, contextChecksum: 'context-4', coverageLedger: ledger,
      figures: [{
        key: 'manual-1', kind: 'COMPONENT', title: 'Manual figure', purpose: 'Requested figure',
        componentIds: ['controller'], claimCriticalComponentIds: [], orderedGroups: [], phaseHints: [], evidenceIds: [], coverageRequirementIds: [],
      }],
    })
    const repaired = repairFigureSetCoverage({ plan, ledger, manualExactCount: true })
    expect(repaired.plan.figures).toHaveLength(1)
    expect(evaluateCoverageLedger({ ledger, figures: repaired.plan.figures }).status).toBe('INCOMPLETE')
  })
})
