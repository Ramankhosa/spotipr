import { describe, expect, test } from 'vitest'
import {
  allocateNoveltyClaimsCharacters,
  findNoveltyClaimNumber,
  selectNoveltyClaimExcerpt,
} from './novelty-claims-evidence'

describe('novelty claims evidence selection', () => {
  test('allocates the default batch budget fairly across every claim-bearing reference', () => {
    expect(allocateNoveltyClaimsCharacters(2, 6000, 24000)).toBe(6000)
    expect(allocateNoveltyClaimsCharacters(8, 6000, 24000)).toBe(3000)
    expect(allocateNoveltyClaimsCharacters(12, 6000, 24000)).toBe(2000)
  })

  test('protects claim 1 and independent claims before selecting relevant dependent claims', () => {
    const claims = [
      `1. A marine inspection system comprising a drone and a sensor.${' core'.repeat(20)}`,
      `2. The system of claim 1, wherein the housing is blue.${' filler'.repeat(20)}`,
      `3. A maintenance method comprising collecting offshore sensor data.${' method'.repeat(20)}`,
      `4. The method of claim 3, wherein an anomaly model triggers a maintenance alert.${' relevant'.repeat(20)}`,
      `5. The system of claim 1, wherein decorative output is displayed.${' filler'.repeat(80)}`,
    ].join('\n')

    const excerpt = selectNoveltyClaimExcerpt(claims, [
      'anomaly model triggers a maintenance alert from offshore sensor data',
    ], 700)

    expect(excerpt.excerpted).toBe(true)
    expect(excerpt.claimNumbers.slice(0, 2)).toEqual([1, 3])
    expect(excerpt.claimNumbers).toContain(4)
    expect(excerpt.text.length).toBeLessThanOrEqual(700)
    expect(findNoveltyClaimNumber(excerpt.text, 'anomaly model triggers a maintenance alert')).toBe(4)
  })

  test('uses a bounded prefix when numbered claims cannot be parsed', () => {
    const source = 'A claim record without numbering '.repeat(100)
    const excerpt = selectNoveltyClaimExcerpt(source, ['claim record'], 250)
    expect(excerpt.text.length).toBeLessThanOrEqual(250)
    expect(excerpt.claimNumbers).toEqual([])
    expect(excerpt.excerpted).toBe(true)
  })
})
