import { describe, expect, test } from 'vitest'

import {
  HIGH_IMPACT_SECTIONS,
  getPersonaCoverage,
  getPersonaReadiness,
  resolveCoveredSections
} from '@/lib/persona-guidance'

/** Every high-impact section taught under one jurisdiction. */
const fullSet = (jurisdiction: string) =>
  HIGH_IMPACT_SECTIONS.map(sectionKey => ({ sectionKey, jurisdiction }))

describe('persona coverage is jurisdiction-aware', () => {
  test('another country\'s samples do not count', () => {
    // Mirrors findPrimaryPersonaSample, which only looks at [jurisdiction, '*'].
    expect(resolveCoveredSections(fullSet('US'), 'IN')).toEqual([])
  })

  test('universal samples count everywhere', () => {
    expect(resolveCoveredSections(fullSet('*'), 'IN').sort()).toEqual([...HIGH_IMPACT_SECTIONS].sort())
  })

  test('exact jurisdiction and universal samples merge', () => {
    const covered = resolveCoveredSections(
      [
        { sectionKey: 'claims', jurisdiction: 'IN' },
        { sectionKey: 'abstract', jurisdiction: '*' },
        { sectionKey: 'summary', jurisdiction: 'US' }
      ],
      'IN'
    ).sort()

    expect(covered).toEqual(['abstract', 'claims'])
  })

  test('asking for the universal set ignores country samples', () => {
    expect(resolveCoveredSections(fullSet('US'), '*')).toEqual([])
  })

  test('jurisdiction is matched case-insensitively', () => {
    expect(resolveCoveredSections([{ sectionKey: 'claims', jurisdiction: 'in' }], 'IN')).toEqual(['claims'])
  })
})

describe('readiness reflects the jurisdiction being drafted', () => {
  test('a US-only persona is ready for US and not for India', () => {
    const samples = fullSet('US')

    expect(getPersonaReadiness(resolveCoveredSections(samples, 'US')).level).toBe('ready')
    expect(getPersonaReadiness(resolveCoveredSections(samples, 'IN')).level).toBe('empty')
  })

  test('a partially taught persona reports what is left', () => {
    const readiness = getPersonaReadiness(
      resolveCoveredSections([{ sectionKey: 'claims', jurisdiction: '*' }], 'IN')
    )

    expect(readiness.level).toBe('partial')
    expect(readiness.covered).toBe(1)
    expect(readiness.missing).not.toContain('claims')
  })
})

describe('getPersonaCoverage for surfaces without a jurisdiction', () => {
  test('names the countries a persona is ready for when it is not universally ready', () => {
    const coverage = getPersonaCoverage([...fullSet('US'), { sectionKey: 'claims', jurisdiction: 'IN' }])

    // Ready, but only for US — the meter and the label must agree on that.
    expect(coverage.readiness.level).toBe('ready')
    expect(coverage.jurisdiction).toBe('US')
    expect(coverage.readyJurisdictions).toEqual(['US'])
  })

  test('adds no country qualifier once the universal set is complete', () => {
    const coverage = getPersonaCoverage(fullSet('*'))

    expect(coverage.readiness.level).toBe('ready')
    expect(coverage.jurisdiction).toBe('*')
    expect(coverage.readyJurisdictions).toEqual([])
  })

  test('falls back to the furthest-along jurisdiction when none is ready', () => {
    const coverage = getPersonaCoverage([
      { sectionKey: 'claims', jurisdiction: '*' },
      { sectionKey: 'claims', jurisdiction: 'EP' },
      { sectionKey: 'summary', jurisdiction: 'EP' },
      { sectionKey: 'abstract', jurisdiction: 'EP' }
    ])

    expect(coverage.readiness.level).toBe('partial')
    expect(coverage.readiness.covered).toBe(3)
    expect(coverage.jurisdiction).toBe('EP')
    expect(coverage.readyJurisdictions).toEqual([])
  })

  test('an empty persona is empty, not ready', () => {
    expect(getPersonaCoverage(undefined).readiness.level).toBe('empty')
    expect(getPersonaCoverage([]).readyJurisdictions).toEqual([])
  })
})
