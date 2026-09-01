import { describe, expect, test } from 'vitest'
import { computeDraftFidelityReport } from '@/lib/draft-fidelity-report'

const RAW_IDEA = [
  'A whistle-counting device for pressure cookers that clips onto the lid handle.',
  'It uses a microphone and a piezo vibration sensor together; the vibration sensor',
  'confirms the microphone so kitchen noise does not cause false counts. It counts',
  'whistles and rings an alarm after the user-set number. Runs on a coin cell and',
  'the clip has a silicone heat shield.',
].join(' ')

const NORMALIZED = {
  sourceHandlingMode: 'PRESERVE',
  title: 'Whistle Counting Device',
  problem: 'Kitchen noise causes false whistle counts.',
  logic: 'The piezo vibration sensor confirms the microphone before a whistle is counted.',
  components: [
    { name: 'microphone', description: 'detects the whistle sound' },
    { name: 'piezo vibration sensor', description: 'confirms the microphone detection' },
    { name: 'silicone heat shield', description: 'protects the clip from lid heat' },
  ],
  claimableFeatures: ['dual-sensor confirmation of whistle events', 'silicone heat shield on the clip'],
  sourceFactLedger: {
    componentsAndSubcomponents: ['microphone', 'piezo vibration sensor', 'silicone heat shield', 'coin cell'],
    safetyFallbackOrExpiryRules: [],
  },
}

describe('computeDraftFidelityReport', () => {
  test('flags omissions when the draft drops source-stated facts', () => {
    const report = computeDraftFidelityReport({
      rawIdea: RAW_IDEA,
      normalizedData: NORMALIZED,
      sections: {
        detailedDescription: [
          'The device comprises a microphone configured to detect a whistle sound.',
          'The piezo vibration sensor confirms the microphone detection before a count is registered.',
        ].join(' '),
      },
      claimsText: '1. A whistle counting device comprising a microphone and a piezo vibration sensor.',
    })

    expect(report.sourceHandlingMode).toBe('PRESERVE')
    const omitted = report.omissions.map(item => item.label.toLowerCase())
    expect(omitted.some(label => label.includes('heat shield'))).toBe(true)
    expect(omitted.some(label => label.includes('microphone') && !label.includes('confirm'))).toBe(false)
    expect(report.coverage.total).toBeGreaterThan(0)
    expect(report.coverage.covered).toBeGreaterThan(0)
    expect(report.coverage.covered).toBeLessThan(report.coverage.total)
  })

  test('flags additions whose vocabulary has no source anchor', () => {
    const report = computeDraftFidelityReport({
      rawIdea: RAW_IDEA,
      normalizedData: NORMALIZED,
      sections: {
        detailedDescription: [
          'The microphone detects the whistle sound and the piezo vibration sensor confirms the detection.',
          'A bluetooth transceiver streams telemetry packets toward a smartphone dashboard application.',
        ].join(' '),
      },
    })

    expect(report.additions.length).toBeGreaterThan(0)
    const flagged = report.additions.map(item => item.sentence.toLowerCase()).join(' ')
    expect(flagged).toContain('bluetooth')
    expect(flagged).not.toContain('confirms the detection')
  })

  test('flags unsupported numeric values', () => {
    const report = computeDraftFidelityReport({
      rawIdea: RAW_IDEA,
      normalizedData: NORMALIZED,
      sections: {
        detailedDescription: 'The microphone samples the whistle sound at 44100 Hz for the piezo vibration sensor confirmation.',
      },
    })

    expect(report.additions.some(item => item.unmatchedTerms.some(term => term.includes('44100')))).toBe(true)
  })

  test('reports inventor terms the draft never uses', () => {
    const report = computeDraftFidelityReport({
      rawIdea: RAW_IDEA,
      normalizedData: NORMALIZED,
      sections: {
        detailedDescription: 'An acoustic sensing module detects a pressure release event and a processing unit counts events.',
      },
    })

    expect(report.terminology.totalTerms).toBe(3)
    expect(report.terminology.missingTerms).toContain('microphone')
    expect(report.terminology.missingTerms).toContain('piezo vibration sensor')
  })

  test('a faithful draft yields full coverage and empty lists', () => {
    const faithful = [
      'The whistle counting device clips onto the lid handle of a pressure cooker.',
      'The microphone detects the whistle sound and the piezo vibration sensor confirms the microphone so kitchen noise does not cause false counts.',
      'The device counts whistles and rings an alarm after the user-set number.',
      'The device runs on a coin cell and the clip has a silicone heat shield.',
    ].join(' ')

    const report = computeDraftFidelityReport({
      rawIdea: RAW_IDEA,
      normalizedData: NORMALIZED,
      sections: { detailedDescription: faithful },
      claimsText: '1. A whistle counting device comprising a microphone, a piezo vibration sensor, and a silicone heat shield.',
    })

    expect(report.omissions).toEqual([])
    expect(report.additions).toEqual([])
    expect(report.terminology.missingTerms).toEqual([])
    expect(report.coverage.covered).toBe(report.coverage.total)
  })

  test('exempts mechanical sections from addition scanning', () => {
    const report = computeDraftFidelityReport({
      rawIdea: RAW_IDEA,
      normalizedData: NORMALIZED,
      sections: {
        listOfNumerals: '100 bluetooth transceiver; 102 telemetry gateway; 104 dashboard application module',
      },
    })

    expect(report.additions).toEqual([])
  })

  test('items enumerate the full denominator with attorney categories', () => {
    const report = computeDraftFidelityReport({
      rawIdea: RAW_IDEA,
      normalizedData: NORMALIZED,
      sections: {
        detailedDescription: 'The microphone detects the whistle sound and the piezo vibration sensor confirms it.',
      },
    })

    expect(report.items.length).toBeGreaterThan(0)
    const statuses = new Set(report.items.map(item => item.status))
    expect(statuses.has('covered')).toBe(true)
    expect(statuses.has('open')).toBe(true)
    const ledgerItem = report.items.find(item => item.sourceField === 'sourceFactLedger.componentsAndSubcomponents')
    expect(ledgerItem?.category).toBe('components')
    report.items.forEach(item => expect(item.key).toMatch(/^[0-9a-f]{8}$/))
  })

  test('item keys are stable when source arrays reorder', () => {
    const reordered = {
      ...NORMALIZED,
      sourceFactLedger: {
        componentsAndSubcomponents: ['coin cell', 'silicone heat shield', 'piezo vibration sensor', 'microphone'],
        safetyFallbackOrExpiryRules: [],
      },
    }
    const input = {
      rawIdea: RAW_IDEA,
      sections: { detailedDescription: 'The microphone detects the whistle sound.' },
    }
    const original = computeDraftFidelityReport({ ...input, normalizedData: NORMALIZED })
    const shuffled = computeDraftFidelityReport({ ...input, normalizedData: reordered })

    const keyFor = (report: ReturnType<typeof computeDraftFidelityReport>, label: string) =>
      report.items.find(item => item.label === label && item.sourceField.startsWith('sourceFactLedger'))?.key
    expect(keyFor(original, 'coin cell')).toBeTruthy()
    expect(keyFor(original, 'coin cell')).toBe(keyFor(shuffled, 'coin cell'))
    expect(keyFor(original, 'silicone heat shield')).toBe(keyFor(shuffled, 'silicone heat shield'))
  })

  test('covered items record the section and best-matching sentence', () => {
    const report = computeDraftFidelityReport({
      rawIdea: RAW_IDEA,
      normalizedData: NORMALIZED,
      sections: {
        summary: 'The device counts whistles for a pressure cooker.',
        detailedDescription: [
          'The clip attaches to the lid handle.',
          'A silicone heat shield protects the clip from lid heat during operation.',
        ].join(' '),
      },
    })

    const shieldItem = report.items.find(item => item.label.toLowerCase() === 'silicone heat shield')
    expect(shieldItem?.status).toBe('covered')
    const location = shieldItem?.coveredIn.find(loc => loc.section === 'detailedDescription')
    expect(location).toBeTruthy()
    expect(location?.sentence.toLowerCase()).toContain('heat shield')
  })

  test('exclusions enumerate the user-deselected material by reason', () => {
    const report = computeDraftFidelityReport({
      rawIdea: RAW_IDEA,
      normalizedData: {
        ...NORMALIZED,
        doNotClaim: ['drying chillies as such'],
        supportDataSources: [
          { id: 'SDS-001', kind: 'component', label: 'Old bracket', value: 'Old bracket', status: 'deleted', sectionTargets: ['claims'], claimUse: 'core', figureUse: 'include' },
          { id: 'SDS-002', kind: 'risk', label: 'Software per se risk', value: 'Software per se risk', status: 'source_stated', sectionTargets: ['claims'], claimUse: 'none', figureUse: 'do_not_show' },
          { id: 'SDS-003', kind: 'material', label: 'Paraffin as material', value: 'Paraffin as material', status: 'source_stated', sectionTargets: ['claims'], claimUse: 'do_not_claim', figureUse: 'do_not_show' },
        ],
        scopeRecommendations: {
          version: 1,
          generatedAt: '',
          basis: { patentTypePrimary: 'PRODUCT', inventionType: ['MECHANICAL'], fieldOfRelevance: 'Mechanical', subfield: '' },
          elements: [
            { id: 'kitchen_env', label: 'Kitchen environment', sourceType: 'environment', recommended: { claim: 'none', numbering: 'do_not_number', figures: 'do_not_show', description: 'optional' }, reason: 'context only', sourceRefs: [] },
            { id: 'decor_trim', label: 'Decorative trim', sourceType: 'component', recommended: { claim: 'dependent_claim', numbering: 'number', figures: 'optional', description: 'include' }, user: { description: 'exclude' }, reason: '', sourceRefs: [] },
          ],
        },
      },
      sections: { detailedDescription: 'The microphone detects the whistle sound.' },
    })

    const byReason = (reason: string) => report.excluded.filter(item => item.reason === reason).map(item => item.label)
    expect(byReason('marked_do_not_claim')).toContain('drying chillies as such')
    expect(byReason('marked_do_not_claim')).toContain('Paraffin as material')
    expect(byReason('removed_by_you')).toContain('Old bracket')
    expect(byReason('guardrail')).toContain('Software per se risk')
    expect(byReason('scope_no_claim')).toContain('Kitchen environment')
    expect(byReason('scope_excluded')).toContain('Decorative trim')
  })

  test('terminology terms carry found locations and stable keys', () => {
    const report = computeDraftFidelityReport({
      rawIdea: RAW_IDEA,
      normalizedData: NORMALIZED,
      sections: { summary: 'The microphone detects the whistle sound.' },
    })

    const microphone = report.terminology.terms.find(term => term.term === 'microphone')
    expect(microphone?.status).toBe('found')
    expect(microphone?.foundIn).toContain('summary')
    const shield = report.terminology.terms.find(term => term.term === 'silicone heat shield')
    expect(shield?.status).toBe('missing')
    expect(shield?.foundIn).toEqual([])
  })
})
