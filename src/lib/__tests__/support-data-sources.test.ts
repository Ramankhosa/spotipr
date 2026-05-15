import { describe, expect, test } from 'vitest'
import {
  buildSupportDataSourceEntries,
  buildSupportDataSourcePromptBlock,
  coerceSupportDataSources,
  extractSupportDataSourceCandidates,
  previewSupportDataSource,
} from '@/lib/support-data-sources'

describe('support data sources', () => {
  test('coerces, dedupes, filters malformed items, and reassigns SDS ids', () => {
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
