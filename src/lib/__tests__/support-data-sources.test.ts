import { describe, expect, test } from 'vitest'
import {
  buildDetailedDescriptionEvidencePromptBlock,
  buildDetailedDescriptionEvidencePreview,
  buildSupportDataSourceEntries,
  buildSupportDataSourcePromptBlock,
  coerceSupportDataSources,
  completeSupportDataSources,
  extractSupportDataSourceCandidates,
  previewSupportDataSource,
  projectSupportDataDestinations,
  updateDetailedDescriptionInjectionControls,
  isDetailedDescriptionSourceTableModeActive,
} from '@/lib/support-data-sources'

// A Stage 0 extraction that captured a real table grid (headers + rows).
function stage0TableData(overrides: Record<string, any> = {}) {
  return {
    supportDataSources: coerceSupportDataSources([
      {
        kind: 'table',
        label: 'Dissolution profile',
        value: 'Dissolution of batches B1 and B2.',
        claimUse: 'dependent',
        sectionTargets: ['detailedDescription'],
        details: {
          headers: ['Batch', 'Load (mg)', 'Release 60 min (%)'],
          rows: [['B1', '45', '82.1'], ['B2', '60', '74.3']],
        },
      },
    ]),
    detailedDescriptionSourceSelection: {
      schemaVersion: 1,
      status: 'ready',
      sectionKey: 'detailedDescription',
      jurisdiction: 'US',
      inputHash: 'hash-s0',
      selectedSources: [{ sourceId: 'SDS-001', role: 'claim_support', confidence: 'high' }],
      guardrailSources: [],
      excludedSources: [],
      warnings: [],
    },
    ...overrides,
  }
}

describe('support data sources', () => {
  test('coerces, dedupes, filters malformed items, and mints ids for id-less entries', () => {
    const sources = coerceSupportDataSources([
      { id: 'bad', kind: 'component', label: 'Controller', value: 'Controller receives sensor data', claimUse: 'core' },
      { kind: 'component', label: 'Controller', value: 'Controller receives sensor data', claimUse: 'core' },
      { kind: 'table', label: '', value: '', details: { headers: ['A'], rows: [] } },
      null,
    ])

    expect(sources).toHaveLength(2)
    expect(sources[0]).toMatchObject({ id: 'SDS-001', kind: 'component', label: 'Controller', claimUse: 'core' })
    expect(sources[1]).toMatchObject({ id: 'SDS-002', kind: 'table' })
  })

  test('preserves well-formed supplied ids, even out of order', () => {
    const sources = coerceSupportDataSources([
      { id: 'SDS-007', kind: 'component', label: 'Pump', value: 'A pump circulates fluid.' },
      { id: 'SDS-002', kind: 'component', label: 'Valve', value: 'A valve regulates flow.' },
    ])

    expect(sources.map(s => s.id)).toEqual(['SDS-007', 'SDS-002'])
  })

  test('deleting an earlier fact does not renumber later ones', () => {
    const original = coerceSupportDataSources([
      { kind: 'component', label: 'Pump', value: 'A pump circulates fluid.' },
      { kind: 'component', label: 'Valve', value: 'A valve regulates flow.' },
      { kind: 'component', label: 'Tank', value: 'A tank stores fluid.' },
    ])
    expect(original.map(s => s.id)).toEqual(['SDS-001', 'SDS-002', 'SDS-003'])

    const afterDelete = coerceSupportDataSources(original.filter(s => s.id !== 'SDS-001'))
    expect(afterDelete.map(s => s.id)).toEqual(['SDS-002', 'SDS-003'])
  })

  test('de-collides duplicate supplied ids, first wins, and mints above the highest suffix', () => {
    const sources = coerceSupportDataSources([
      { id: 'SDS-005', kind: 'component', label: 'Pump', value: 'A pump circulates fluid.' },
      { id: 'SDS-005', kind: 'component', label: 'Valve', value: 'A valve regulates flow.' },
      { kind: 'component', label: 'Tank', value: 'A tank stores fluid.' },
    ])

    expect(sources[0].id).toBe('SDS-005')
    expect(sources[1].id).toBe('SDS-006')
    expect(sources[2].id).toBe('SDS-007')
    expect(new Set(sources.map(s => s.id)).size).toBe(sources.length)
  })

  test('completeSupportDataSources merges fresh candidates without id collisions', () => {
    const rawIdea = [
      'The dryer uses a controller.',
      '',
      '| Temp | Time |',
      '| --- | --- |',
      '| 60 C | 4 h |',
    ].join('\n')
    const existing = coerceSupportDataSources([
      { id: 'SDS-001', kind: 'component', label: 'Controller', value: 'A controller manages heating.' },
      { id: 'SDS-004', kind: 'numeric_value', label: 'airflow', value: '2 m/s' },
    ])

    const { supportDataSources } = completeSupportDataSources(rawIdea, { supportDataSources: existing })

    const ids = supportDataSources.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('SDS-001')
    expect(ids).toContain('SDS-004')
    // Candidates mint above the highest existing suffix — they never reuse a gap.
    const minted = ids.filter(id => !['SDS-001', 'SDS-004'].includes(id))
    expect(minted.length).toBeGreaterThan(0)
    minted.forEach((id) => {
      expect(parseInt(id.slice(4), 10)).toBeGreaterThan(4)
    })
  })

  test('destination projection agrees with the prompt builder, caps included', () => {
    const raw = [
      ...Array.from({ length: 47 }, (_, i) => ({
        kind: 'component',
        label: `Component ${i + 1}`,
        value: `Component ${i + 1} performs step ${i + 1}.`,
        claimUse: 'dependent',
        sectionTargets: ['claims'],
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        kind: 'do_not_claim',
        label: `Exclusion ${i + 1}`,
        value: `Do not claim variant ${i + 1}.`,
        claimUse: 'do_not_claim',
        sectionTargets: ['claims'],
      })),
    ]
    const sources = coerceSupportDataSources(raw)
    const claims = projectSupportDataDestinations(sources).find(p => p.section === 'claims')

    expect(claims).toBeDefined()
    expect(claims!.positiveTotal).toBe(47)
    expect(claims!.positives).toBe(40)
    expect(claims!.guardrails).toBe(5)
    expect(claims!.truncated).toBe(true)

    const block = buildSupportDataSourcePromptBlock({ supportDataSources: sources }, 'claims')
    const injectedLines = (block.match(/^- \[SDS-/gm) || []).length
    expect(injectedLines).toBe(claims!.positives + claims!.guardrails)
  })

  test('injects claim support with guardrails and excludes deleted/background-only positives', () => {
    const normalizedData = {
      supportDataSources: coerceSupportDataSources([
        { kind: 'component', label: 'Core sensor', value: 'A pressure sensor supplies raw readings.', claimUse: 'core', sectionTargets: ['claims'] },
        { kind: 'prior_art', label: 'Known pump', value: 'Known pumps used manual calibration.', claimUse: 'background_only', sectionTargets: ['background'] },
        { kind: 'risk', label: 'India Section 3(k)', value: 'Computer program per se language requires technical-effect framing.', claimUse: 'do_not_claim', sectionTargets: ['claims'] },
        { kind: 'numeric_value', label: 'Deleted range', value: '10-20 ms', status: 'deleted', claimUse: 'dependent', sectionTargets: ['claims'] },
      ]),
    }

    const block = buildSupportDataSourcePromptBlock(normalizedData, 'claims')

    expect(block).toContain('Core sensor')
    expect(block).toContain('Guardrails / exclusions / risks')
    expect(block).toContain('India Section 3(k)')
    expect(block).not.toContain('Known pump')
    expect(block).not.toContain('Deleted range')
  })

  test('keeps support data out of list of numerals injection', () => {
    const normalizedData = {
      supportDataSources: coerceSupportDataSources([
        { kind: 'figure', label: 'Exploded view', value: 'Figure 1 shows the housing.', figureUse: 'include', sectionTargets: ['listOfNumerals'] },
      ]),
    }

    expect(buildSupportDataSourcePromptBlock(normalizedData, 'listOfNumerals')).toBe('')
  })

  test('filters detailed description evidence through selected source IDs only', () => {
    const normalizedData = {
      supportDataSources: coerceSupportDataSources([
        { kind: 'component', label: 'Controller', value: 'Controller 102 receives sensor data.', claimUse: 'core', sectionTargets: ['claims', 'detailedDescription'] },
        { kind: 'prior_art', label: 'Known controller', value: 'Prior art controllers receive sensor data.', claimUse: 'background_only', sectionTargets: ['background'] },
        { kind: 'risk', label: 'Avoid direct control', value: 'Do not state that the sensor directly controls the actuator.', claimUse: 'do_not_claim', sectionTargets: ['claims', 'detailedDescription'] },
      ]),
      detailedDescriptionSourceSelection: {
        schemaVersion: 1,
        status: 'ready',
        sectionKey: 'detailedDescription',
        jurisdiction: 'US',
        inputHash: 'hash',
        selectedSources: [{ sourceId: 'SDS-001', role: 'component_support', reason: 'Supports controller 102.', confidence: 'high' }],
        guardrailSources: [{ sourceId: 'SDS-003', reason: 'Avoid unsupported control relationship.' }],
        excludedSources: [{ sourceId: 'SDS-002', reason: 'Prior art only.' }],
        warnings: [],
      },
    }

    const block = buildSupportDataSourcePromptBlock(normalizedData, 'detailedDescription')

    expect(block).toContain('BEGIN AUTO-SELECTED DETAILED DESCRIPTION SOURCE DATA')
    expect(block).toContain('Controller 102 receives sensor data')
    expect(block).toContain('BEGIN DETAILED DESCRIPTION SOURCE GUARDRAILS')
    expect(block).toContain('Avoid direct control')
    expect(block).not.toContain('Prior art controllers receive sensor data')
  })

  test('uses deterministic safe DD fallback when no saved evidence pack exists', () => {
    const normalizedData = {
      supportDataSources: coerceSupportDataSources([
        { kind: 'process_step', label: 'Receive input', value: 'Receiving a sensor input.', claimUse: 'dependent', sectionTargets: ['detailedDescription'] },
        { kind: 'prior_art', label: 'Known input', value: 'A known system receives inputs.', claimUse: 'background_only', sectionTargets: ['background'] },
        { kind: 'component', label: 'Unsupported sensor', value: 'Unsupported sensor detail.', status: 'unsupported', claimUse: 'dependent', sectionTargets: ['detailedDescription'] },
      ]),
    }

    const block = buildDetailedDescriptionEvidencePromptBlock(normalizedData)
    const preview = buildDetailedDescriptionEvidencePreview(normalizedData)

    expect(block).toContain('Receiving a sensor input')
    expect(block).toContain('DD role=component_support')
    expect(block).not.toContain('known system')
    expect(block).not.toContain('Unsupported sensor detail')
    expect(preview.status).toBe('missing')
  })

  test('applies DD injection controls and prompt-only source text overrides', () => {
    const normalizedData = {
      supportDataSources: coerceSupportDataSources([
        { kind: 'component', label: 'Controller', value: 'Original controller detail.', claimUse: 'core', sectionTargets: ['detailedDescription'] },
        { kind: 'process_step', label: 'Filter input', value: 'Filtering the received input.', claimUse: 'dependent', sectionTargets: ['detailedDescription'] },
        { kind: 'risk', label: 'Avoid direct actuation', value: 'Do not state direct actuation.', claimUse: 'do_not_claim', sectionTargets: ['detailedDescription'] },
      ]),
      detailedDescriptionSourceSelection: {
        schemaVersion: 1,
        status: 'ready',
        sectionKey: 'detailedDescription',
        jurisdiction: 'US',
        inputHash: 'hash-1',
        selectedSources: [
          { sourceId: 'SDS-001', role: 'component_support', confidence: 'high', reason: 'Controller support.' },
          { sourceId: 'SDS-002', role: 'claim_support', confidence: 'medium', reason: 'Input support.' },
        ],
        guardrailSources: [{ sourceId: 'SDS-003', reason: 'Guardrail.' }],
        excludedSources: [],
        warnings: [],
      },
      detailedDescriptionInjectionControls: {
        schemaVersion: 1,
        sectionKey: 'detailedDescription',
        jurisdictions: {
          US: {
            selectionInputHash: 'hash-1',
            excludedSelectedSourceIds: ['SDS-002'],
            excludedGuardrailSourceIds: ['SDS-003'],
            sourceTextOverrides: {
              'SDS-001': { text: 'Attorney approved controller disclosure.' },
            },
          },
        },
      },
    }

    const block = buildDetailedDescriptionEvidencePromptBlock(normalizedData, { jurisdiction: 'US' })
    const preview = buildDetailedDescriptionEvidencePreview(normalizedData, 'US')

    expect(block).toContain('Attorney approved controller disclosure')
    expect(block).not.toContain('Original controller detail')
    expect(block).not.toContain('Filtering the received input')
    expect(block).not.toContain('Do not state direct actuation')
    expect(preview.selectedSources[0]).toMatchObject({ sourceId: 'SDS-001', included: true, edited: true })
    expect(preview.selectedSources[1]).toMatchObject({ sourceId: 'SDS-002', included: false })
    expect(preview.guardrailSources[0]).toMatchObject({ sourceId: 'SDS-003', included: false })
  })

  test('renderSourcesAsTable adds the table-presentation instruction, gated by tablesAllowed', () => {
    const base = {
      supportDataSources: coerceSupportDataSources([
        { kind: 'test_result', label: 'Dissolution', value: 'F1 released 92.4% at 60 min.', claimUse: 'dependent', sectionTargets: ['detailedDescription'] },
      ]),
      detailedDescriptionSourceSelection: {
        schemaVersion: 1,
        status: 'ready',
        sectionKey: 'detailedDescription',
        jurisdiction: 'US',
        inputHash: 'hash-t',
        selectedSources: [{ sourceId: 'SDS-001', role: 'claim_support', confidence: 'high', reason: 'Data support.' }],
        guardrailSources: [],
        excludedSources: [],
        warnings: [],
      },
    }
    const withTables = {
      ...base,
      detailedDescriptionInjectionControls: {
        schemaVersion: 1,
        sectionKey: 'detailedDescription',
        jurisdictions: { US: { selectionInputHash: 'hash-t', renderSourcesAsTable: true } },
      },
    }

    // Off by default
    expect(buildDetailedDescriptionEvidencePromptBlock(base, { jurisdiction: 'US' }))
      .not.toContain('SOURCE DATA TABLE PRESENTATION')
    // On when the attorney enabled it
    const enabledBlock = buildDetailedDescriptionEvidencePromptBlock(withTables, { jurisdiction: 'US' })
    expect(enabledBlock).toContain('BEGIN SOURCE DATA TABLE PRESENTATION (ATTORNEY-ENABLED)')
    expect(enabledBlock).toContain('Markdown table')
    expect(enabledBlock).toContain('VERBATIM')
    // Suppressed where the jurisdiction disallows tables
    expect(buildDetailedDescriptionEvidencePromptBlock(withTables, { jurisdiction: 'US', tablesAllowed: false }))
      .not.toContain('SOURCE DATA TABLE PRESENTATION')
    // Preview surfaces the flag
    expect(buildDetailedDescriptionEvidencePreview(withTables, 'US').renderSourcesAsTable).toBe(true)
    expect(buildDetailedDescriptionEvidencePreview(base, 'US').renderSourcesAsTable).toBe(false)
  })

  test('updateDetailedDescriptionInjectionControls round-trips renderSourcesAsTable', () => {
    const normalizedData = {
      supportDataSources: coerceSupportDataSources([
        { kind: 'test_result', label: 'Dissolution', value: 'F1 released 92.4% at 60 min.', claimUse: 'dependent', sectionTargets: ['detailedDescription'] },
      ]),
      detailedDescriptionSourceSelection: {
        schemaVersion: 1,
        status: 'ready',
        sectionKey: 'detailedDescription',
        jurisdiction: 'US',
        inputHash: 'hash-t',
        selectedSources: [{ sourceId: 'SDS-001', role: 'claim_support', confidence: 'high' }],
        guardrailSources: [],
        excludedSources: [],
        warnings: [],
      },
    }

    const enabled = updateDetailedDescriptionInjectionControls(normalizedData, 'US', { renderSourcesAsTable: true })
    expect(enabled.jurisdictions?.US?.renderSourcesAsTable).toBe(true)

    const disabled = updateDetailedDescriptionInjectionControls(
      { ...normalizedData, detailedDescriptionInjectionControls: enabled },
      'US',
      { renderSourcesAsTable: false }
    )
    // Explicit false is persisted (tri-state), so it beats the auto-on default
    expect(disabled.jurisdictions?.US?.renderSourcesAsTable).toBe(false)

    // Stage 0 table auto-enables table mode without the attorney touching anything
    expect(isDetailedDescriptionSourceTableModeActive(stage0TableData(), { jurisdiction: 'US' })).toBe(true)

    // Untouched when the update omits the field
    const untouched = updateDetailedDescriptionInjectionControls(
      { ...normalizedData, detailedDescriptionInjectionControls: enabled },
      'US',
      { coveragePreset: 'lean' }
    )
    expect(untouched.jurisdictions?.US?.renderSourcesAsTable).toBe(true)
  })

  test('applies DD coverage presets to LLM-selected source support', () => {
    const supportDataSources = coerceSupportDataSources(
      Array.from({ length: 20 }, (_, index) => ({
        kind: 'component',
        label: `Component ${index + 1}`,
        value: `Detailed description support detail ${index + 1}.`,
        claimUse: 'dependent',
        sectionTargets: ['detailedDescription'],
      }))
    )
    const normalizedData = {
      supportDataSources,
      detailedDescriptionSourceSelection: {
        schemaVersion: 1,
        status: 'ready',
        sectionKey: 'detailedDescription',
        jurisdiction: 'US',
        inputHash: 'hash-coverage',
        selectedSources: supportDataSources.map(source => ({
          sourceId: source.id,
          role: 'component_support',
          confidence: 'medium',
        })),
        guardrailSources: [],
        excludedSources: [],
        warnings: [],
      },
    }

    const leanControls = updateDetailedDescriptionInjectionControls(normalizedData, 'US', { coveragePreset: 'lean' })
    const leanData = { ...normalizedData, detailedDescriptionInjectionControls: leanControls }
    const leanPreview = buildDetailedDescriptionEvidencePreview(leanData, 'US')
    const leanBlock = buildDetailedDescriptionEvidencePromptBlock(leanData, { jurisdiction: 'US' })

    expect(leanPreview.coveragePreset).toBe('lean')
    expect(leanPreview.includedSelectedCount).toBe(5)
    expect(leanBlock).toContain('Detailed description support detail 5.')
    expect(leanBlock).not.toContain('Detailed description support detail 6.')

    const balancedControls = updateDetailedDescriptionInjectionControls(normalizedData, 'US', { coveragePreset: 'balanced' })
    const balancedPreview = buildDetailedDescriptionEvidencePreview({ ...normalizedData, detailedDescriptionInjectionControls: balancedControls }, 'US')

    expect(balancedPreview.coveragePreset).toBe('balanced')
    expect(balancedPreview.includedSelectedCount).toBe(10)

    const fullControls = updateDetailedDescriptionInjectionControls(normalizedData, 'US', { coveragePreset: 'full' })
    const fullPreview = buildDetailedDescriptionEvidencePreview({ ...normalizedData, detailedDescriptionInjectionControls: fullControls }, 'US')

    expect(fullPreview.coveragePreset).toBe('full')
    expect(fullPreview.includedSelectedCount).toBe(20)
  })

  test('adds custom DD coverage instructions only in custom mode', () => {
    const normalizedData = {
      supportDataSources: coerceSupportDataSources([
        { kind: 'example', label: 'Battery test', value: 'Prototype A retained 91% capacity after cycling.', claimUse: 'dependent', sectionTargets: ['detailedDescription'] },
      ]),
      detailedDescriptionSourceSelection: {
        schemaVersion: 1,
        status: 'ready',
        sectionKey: 'detailedDescription',
        jurisdiction: 'US',
        inputHash: 'hash-custom',
        selectedSources: [{ sourceId: 'SDS-001', role: 'example_support', confidence: 'high' }],
        guardrailSources: [],
        excludedSources: [],
        warnings: [],
      },
    }

    const customControls = updateDetailedDescriptionInjectionControls(normalizedData, 'US', {
      coveragePreset: 'custom',
      customIncludeInstruction: 'Prioritize cycling performance examples.',
      customIntegrationInstruction: 'Use concise embodiment language and avoid numeric thresholds.',
    })
    const customData = { ...normalizedData, detailedDescriptionInjectionControls: customControls }
    const customBlock = buildDetailedDescriptionEvidencePromptBlock(customData, { jurisdiction: 'US' })
    const customPreview = buildDetailedDescriptionEvidencePreview(customData, 'US')

    expect(customPreview).toMatchObject({
      coveragePreset: 'custom',
      customIncludeInstruction: 'Prioritize cycling performance examples.',
      customIntegrationInstruction: 'Use concise embodiment language and avoid numeric thresholds.',
    })
    expect(customBlock).toContain('BEGIN ATTORNEY CUSTOM INSTRUCTIONS FOR SELECTED DETAILED DESCRIPTION DATA')
    expect(customBlock).toContain('What to include: Prioritize cycling performance examples.')
    expect(customBlock).toContain('How to integrate: Use concise embodiment language and avoid numeric thresholds.')

    const fullControls = updateDetailedDescriptionInjectionControls(customData, 'US', { coveragePreset: 'full' })
    const fullBlock = buildDetailedDescriptionEvidencePromptBlock(
      { ...normalizedData, detailedDescriptionInjectionControls: fullControls },
      { jurisdiction: 'US' }
    )

    expect(fullBlock).not.toContain('ATTORNEY CUSTOM INSTRUCTIONS')
    expect(fullBlock).toContain('Prototype A retained 91% capacity')
  })

  test('ignores stale DD injection controls when the selection hash changes', () => {
    const normalizedData = {
      supportDataSources: coerceSupportDataSources([
        { kind: 'component', label: 'Controller', value: 'Current controller detail.', claimUse: 'core', sectionTargets: ['detailedDescription'] },
      ]),
      detailedDescriptionSourceSelection: {
        schemaVersion: 1,
        status: 'ready',
        sectionKey: 'detailedDescription',
        jurisdiction: 'US',
        inputHash: 'hash-new',
        selectedSources: [{ sourceId: 'SDS-001', role: 'component_support', confidence: 'high' }],
        guardrailSources: [],
        excludedSources: [],
        warnings: [],
      },
      detailedDescriptionInjectionControls: {
        schemaVersion: 1,
        sectionKey: 'detailedDescription',
        jurisdictions: {
          US: {
            selectionInputHash: 'hash-old',
            excludedSelectedSourceIds: ['SDS-001'],
            sourceTextOverrides: {
              'SDS-001': { text: 'Stale edited detail.' },
            },
          },
        },
      },
    }

    const block = buildDetailedDescriptionEvidencePromptBlock(normalizedData, { jurisdiction: 'US' })
    const preview = buildDetailedDescriptionEvidencePreview(normalizedData, 'US')

    expect(block).toContain('Current controller detail')
    expect(block).not.toContain('Stale edited detail')
    expect(preview.controlsStale).toBe(true)
    expect(preview.selectedSources[0]).toMatchObject({ included: true, edited: false, controlsStale: true })
  })

  test('extracts structured candidates from attorney source text', () => {
    const candidates = extractSupportDataSourceCandidates(`
| Metric | Value |
| --- | --- |
| Efficiency | 92% |

score = (a + b) / c

\`\`\`json
{ "input": "pressure", "output": "alarm" }
\`\`\`

SEQ ID NO: 1 ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT
The software is described as a computer program per se.
`)

    expect(candidates.some(item => item.kind === 'table')).toBe(true)
    expect(candidates.some(item => item.kind === 'equation')).toBe(true)
    expect(candidates.some(item => item.kind === 'data_schema')).toBe(true)
    expect(candidates.some(item => item.kind === 'bio_sequence')).toBe(true)
    expect(candidates.some(item => item.kind === 'risk' && item.label.includes('Section 3(k)'))).toBe(true)
  })

  test('builds claim support entries from positive SDS facts only', () => {
    const normalizedData = {
      supportDataSources: coerceSupportDataSources([
        { kind: 'component', label: 'Core controller', value: 'A controller adjusts valve timing.', claimUse: 'core', sectionTargets: ['claims'] },
        { kind: 'do_not_claim', label: 'Excluded feature', value: 'Do not claim a generic business method.', claimUse: 'do_not_claim', sectionTargets: ['claims'] },
      ]),
    }

    const entries = buildSupportDataSourceEntries(normalizedData)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 'SDS-001', label: 'Core controller' })
  })

  test('previews complex details compactly', () => {
    const [table, equation] = coerceSupportDataSources([
      { kind: 'table', label: 'Results', details: { headers: ['A', 'B', 'C'], rows: [['1', '2', '3'], ['4', '5', '6']] } },
      { kind: 'equation', label: 'Score', details: { expression: 'S = a / b', variables: { a: 'signal', b: 'baseline' } } },
    ])

    expect(previewSupportDataSource(table)).toBe('Table: 3 columns x 2 rows')
    expect(previewSupportDataSource(equation)).toContain('variables: 2')
  })
})

describe('Stage 0 tables reach the Detailed Description', () => {
  test('a table extracted at Stage 0 turns table mode on with no attorney action', () => {
    const data = stage0TableData()
    expect(isDetailedDescriptionSourceTableModeActive(data, { jurisdiction: 'US' })).toBe(true)
    expect(buildDetailedDescriptionEvidencePreview(data, 'US').renderSourcesAsTable).toBe(true)
  })

  test('the extracted grid is handed to the model as literal Markdown to copy', () => {
    const block = buildDetailedDescriptionEvidencePromptBlock(stage0TableData(), { jurisdiction: 'US' })
    expect(block).toContain('BEGIN VERBATIM SOURCE TABLES (COPY THESE EXACTLY)')
    expect(block).toContain('| Batch | Load (mg) | Release 60 min (%) |')
    expect(block).toContain('| --- | --- | --- |')
    expect(block).toContain('| B1 | 45 | 82.1 |')
    expect(block).toContain('| B2 | 60 | 74.3 |')
  })

  test('an explicit off from the attorney still wins over the auto default', () => {
    const off = stage0TableData({
      detailedDescriptionInjectionControls: {
        schemaVersion: 1,
        sectionKey: 'detailedDescription',
        jurisdictions: { US: { selectionInputHash: 'hash-s0', renderSourcesAsTable: false } },
      },
    })
    expect(isDetailedDescriptionSourceTableModeActive(off, { jurisdiction: 'US' })).toBe(false)
    expect(buildDetailedDescriptionEvidencePromptBlock(off, { jurisdiction: 'US' }))
      .not.toContain('VERBATIM SOURCE TABLES')
  })

  test('a jurisdiction that forbids tables suppresses table mode', () => {
    expect(isDetailedDescriptionSourceTableModeActive(stage0TableData(), { jurisdiction: 'US', tablesAllowed: false })).toBe(false)
  })

  test('non-tabular Stage 0 support does not trigger table mode', () => {
    const prose = {
      supportDataSources: coerceSupportDataSources([
        { kind: 'component', label: 'Controller', value: 'Controller 102 receives sensor data.', claimUse: 'core', sectionTargets: ['detailedDescription'] },
      ]),
      detailedDescriptionSourceSelection: {
        schemaVersion: 1, status: 'ready', sectionKey: 'detailedDescription', jurisdiction: 'US', inputHash: 'h',
        selectedSources: [{ sourceId: 'SDS-001', role: 'component_support', confidence: 'high' }],
        guardrailSources: [], excludedSources: [], warnings: [],
      },
    }
    expect(isDetailedDescriptionSourceTableModeActive(prose, { jurisdiction: 'US' })).toBe(false)
  })
})
