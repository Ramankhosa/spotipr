import { describe, expect, test } from 'vitest'
import {
  buildDetailedDescriptionSelectionInputHash,
  validateDetailedDescriptionSourceSelection,
} from '@/lib/dd-source-selection-service'
import { coerceSupportDataSources } from '@/lib/support-data-sources'

describe('dd source selection service', () => {
  test('validation rejects unsafe positive source selections', () => {
    const sources = coerceSupportDataSources([
      { kind: 'component', label: 'Controller', value: 'Controller 102 receives sensor data.', claimUse: 'core', sectionTargets: ['detailedDescription'] },
      { kind: 'prior_art', label: 'Known controller', value: 'Prior art controller receives data.', claimUse: 'background_only', sectionTargets: ['background'] },
      { kind: 'risk', label: 'Avoid direct control', value: 'Do not state direct sensor control.', claimUse: 'do_not_claim', sectionTargets: ['claims', 'detailedDescription'] },
      { kind: 'component', label: 'Unsupported component', value: 'Unsupported detail.', status: 'unsupported', claimUse: 'dependent', sectionTargets: ['detailedDescription'] },
    ])

    const selection = validateDetailedDescriptionSourceSelection(
      {
        selectedSources: [
          { sourceId: 'SDS-001', role: 'component_support', reason: 'Claim support.', confidence: 'high' },
          { sourceId: 'SDS-002', role: 'claim_support', reason: 'Bad prior art selection.', confidence: 'high' },
          { sourceId: 'SDS-003', role: 'claim_support', reason: 'Bad guardrail selection.', confidence: 'high' },
          { sourceId: 'SDS-999', role: 'claim_support', reason: 'Unknown.', confidence: 'high' },
        ],
        guardrailSources: [
          { sourceId: 'SDS-003', reason: 'Use only as a guardrail.' },
          { sourceId: 'SDS-004', reason: 'Unsupported should not pass.' },
        ],
        excludedSources: [],
        warnings: [],
      },
      sources,
      { jurisdiction: 'US', inputHash: 'hash' }
    )

    expect(selection.status).toBe('ready')
    expect(selection.selectedSources).toHaveLength(1)
    expect(selection.selectedSources?.[0]).toMatchObject({ sourceId: 'SDS-001', role: 'component_support', confidence: 'high' })
    expect(selection.guardrailSources).toEqual([{ sourceId: 'SDS-003', reason: 'Use only as a guardrail.' }])
    expect(selection.excludedSources?.some(item => item.sourceId === 'SDS-002')).toBe(true)
    expect(selection.excludedSources?.some(item => item.sourceId === 'SDS-004')).toBe(true)
    expect(selection.warnings?.some(warning => warning.includes('SDS-999'))).toBe(true)
  })

  test('input hash changes when frozen claims or sources change', () => {
    const baseSession = {
      id: 'session-1',
      ideaRecord: {
        normalizedData: {
          claimsApprovedAt: '2026-01-01T00:00:00.000Z',
          claimsFinal: '<p>1. A system comprising a controller.</p>',
          claimsStructuredFinal: [{ number: 1, type: 'independent', text: 'A system comprising a controller.' }],
          supportDataSources: coerceSupportDataSources([
            { kind: 'component', label: 'Controller', value: 'Controller 102 receives data.', claimUse: 'core', sectionTargets: ['detailedDescription'] },
          ]),
        },
      },
      referenceMap: { components: [{ name: 'controller', referenceLabel: '102' }] },
      figurePlans: [{ id: 'fig-1', figureNo: 1, title: 'System overview', description: 'Controller overview' }],
    }

    const hashA = buildDetailedDescriptionSelectionInputHash(baseSession, 'US')
    const hashB = buildDetailedDescriptionSelectionInputHash({
      ...baseSession,
      ideaRecord: {
        normalizedData: {
          ...baseSession.ideaRecord.normalizedData,
          claimsStructuredFinal: [{ number: 1, type: 'independent', text: 'A system comprising a controller and a sensor.' }],
          claimsFinal: '<p>1. A system comprising a controller and a sensor.</p>',
        },
      },
    }, 'US')
    const hashC = buildDetailedDescriptionSelectionInputHash({
      ...baseSession,
      ideaRecord: {
        normalizedData: {
          ...baseSession.ideaRecord.normalizedData,
          supportDataSources: coerceSupportDataSources([
            { kind: 'component', label: 'Controller', value: 'Controller 102 receives data.', claimUse: 'core', sectionTargets: ['detailedDescription'] },
            { kind: 'process_step', label: 'Filter data', value: 'Filtering the received data.', claimUse: 'dependent', sectionTargets: ['detailedDescription'] },
          ]),
        },
      },
    }, 'US')

    expect(hashA).not.toBe(hashB)
    expect(hashA).not.toBe(hashC)
  })
})
