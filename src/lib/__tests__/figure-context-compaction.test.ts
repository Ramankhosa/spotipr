import { describe, expect, it } from 'vitest'
import { compactClaimsContextDetailed, compactInventionContextDetailed } from '@/lib/patent-diagrams/prompts'

describe('compactInventionContextDetailed', () => {
  it('keeps everything and reports nothing when the record fits', () => {
    const result = compactInventionContextDetailed({ processSteps: ['a', 'b'], materials: ['steel'] })
    expect(result.droppedKeys).toEqual([])
    expect(result.truncatedKeys).toEqual([])
    expect(JSON.parse(result.json)).toEqual({ processSteps: ['a', 'b'], materials: ['steel'] })
  })

  it('truncates an oversized string key instead of dropping it whole', () => {
    const result = compactInventionContextDetailed({
      processSteps: ['step one'],
      detailedDescription: 'x'.repeat(50_000),
    })
    expect(result.truncatedKeys).toEqual(['detailedDescription'])
    const parsed = JSON.parse(result.json)
    expect(parsed.detailedDescription).toContain('[TRUNCATED')
    expect(parsed.detailedDescription.length).toBeLessThan(50_000)
  })

  it('stops admitting keys after the first overflow — no holey record', () => {
    // A non-string oversized key cannot be truncated, so it and everything
    // after it must be dropped; smaller later keys must NOT sneak back in.
    const result = compactInventionContextDetailed({
      processSteps: Array.from({ length: 4000 }, (_, i) => `step ${i} with padding text`),
      materials: ['steel'],
      conditions: ['when wet'],
    })
    expect(result.droppedKeys).toEqual(['processSteps', 'materials', 'conditions'])
    expect(JSON.parse(result.json)).toEqual({})
  })

  it('reports every dropped key past the break point', () => {
    const big = 'y'.repeat(13_000)
    const result = compactInventionContextDetailed({
      processSteps: [big],
      materials: ['steel'],
      advantages: ['fast'],
    })
    expect(result.droppedKeys).toContain('materials')
    expect(result.droppedKeys).toContain('advantages')
  })
})

describe('compactClaimsContextDetailed', () => {
  it('reports the claim numbers that did not fit', () => {
    const claims = Array.from({ length: 30 }, (_, i) => ({
      number: i + 1,
      text: `Claim body ${i + 1} ${'z'.repeat(400)}`,
    }))
    const result = compactClaimsContextDetailed(claims)
    const kept = JSON.parse(result.json)
    expect(kept.length + result.droppedClaimNumbers.length).toBe(30)
    expect(result.droppedClaimNumbers.length).toBeGreaterThan(0)
    expect(result.droppedClaimNumbers[0]).toBe(kept.length + 1)
  })

  it('drops nothing when all claims fit', () => {
    const result = compactClaimsContextDetailed([{ number: 1, text: 'A system.' }])
    expect(result.droppedClaimNumbers).toEqual([])
  })
})
