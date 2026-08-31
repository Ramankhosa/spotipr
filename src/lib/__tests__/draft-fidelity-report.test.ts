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
})
