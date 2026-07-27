import { describe, expect, it } from 'vitest'
import { diffStreamingClaims, extractStreamingClaims } from '@/lib/draft-claims-stream'

const FULL_RESPONSE = `{
  "claims": [
    { "number": 1, "type": "independent", "category": "system", "text": "A wound-dressing system comprising a substrate." },
    { "number": 2, "type": "dependent", "dependsOn": 1, "category": "system", "text": "The system of claim 1, wherein the substrate is flexible." }
  ],
  "supportMatrix": [],
  "qualityWarnings": []
}`

describe('extractStreamingClaims', () => {
  it('returns nothing for empty or pre-claims buffers', () => {
    expect(extractStreamingClaims('')).toEqual([])
    expect(extractStreamingClaims('Here is the JSON you asked for:')).toEqual([])
    expect(extractStreamingClaims('{ "clai')).toEqual([])
  })

  it('reads a completed claim set', () => {
    const claims = extractStreamingClaims(FULL_RESPONSE)
    expect(claims).toHaveLength(2)
    expect(claims[0]).toMatchObject({
      number: 1,
      type: 'independent',
      category: 'system',
      text: 'A wound-dressing system comprising a substrate.',
      complete: true,
    })
    expect(claims[1]).toMatchObject({ number: 2, dependsOn: 1, complete: true })
  })

  it('exposes a claim whose text is still being written', () => {
    const partial = '{ "claims": [ { "number": 1, "type": "independent", "text": "A wound-dressing system compri'
    const claims = extractStreamingClaims(partial)
    expect(claims).toHaveLength(1)
    expect(claims[0].text).toBe('A wound-dressing system compri')
    expect(claims[0].complete).toBe(false)
  })

  it('marks earlier claims complete while a later one streams', () => {
    const partial = FULL_RESPONSE.slice(0, FULL_RESPONSE.indexOf('wherein the substrate') + 9)
    const claims = extractStreamingClaims(partial)
    expect(claims[0].complete).toBe(true)
    expect(claims[1].complete).toBe(false)
    expect(claims[1].text).toContain('The system of claim 1, wherein')
  })

  it('grows monotonically across every prefix of the response', () => {
    let previousLength = 0
    for (let i = 1; i <= FULL_RESPONSE.length; i++) {
      const claims = extractStreamingClaims(FULL_RESPONSE.slice(0, i))
      expect(claims.length).toBeGreaterThanOrEqual(previousLength)
      previousLength = claims.length
    }
    expect(previousLength).toBe(2)
  })

  it('decodes escapes and survives a half-written escape at the buffer edge', () => {
    const withEscape = '{ "claims": [ { "number": 1, "text": "A \\"smart\\" dressing with a line\\nbreak" } ] }'
    expect(extractStreamingClaims(withEscape)[0].text).toBe('A "smart" dressing with a line break')

    const truncatedEscape = '{ "claims": [ { "number": 1, "text": "A dressing\\'
    expect(extractStreamingClaims(truncatedEscape)[0].text).toBe('A dressing')
  })

  it('handles a markdown-fenced response', () => {
    const fenced = '```json\n' + FULL_RESPONSE
    expect(extractStreamingClaims(fenced)).toHaveLength(2)
  })

  it('strips a claim number the model repeated inside the text', () => {
    const repeated = '{ "claims": [ { "number": 1, "text": "1. A method of doing things." } ] }'
    expect(extractStreamingClaims(repeated)[0].text).toBe('A method of doing things.')
  })

  it('falls back to numbered text when the model ignores the JSON contract', () => {
    const numbered = '1. A method comprising a first step.\n\n2. The method of claim 1, wherein the step repeats.'
    const claims = extractStreamingClaims(numbered)
    expect(claims).toHaveLength(2)
    expect(claims[0]).toMatchObject({ number: 1, type: 'independent', complete: true })
    expect(claims[1].complete).toBe(false)
  })
})

describe('diffStreamingClaims', () => {
  it('emits only claims whose text or completion changed', () => {
    const previous = [
      { number: 1, text: 'A system', complete: false },
      { number: 2, text: 'The system of claim 1', complete: false },
    ]
    const next = [
      { number: 1, text: 'A system', complete: false },
      { number: 2, text: 'The system of claim 1, wherein', complete: false },
      { number: 3, text: 'The system of claim 2', complete: false },
    ]

    expect(diffStreamingClaims(previous, next).map(claim => claim.number)).toEqual([2, 3])
    expect(diffStreamingClaims(next, next)).toEqual([])
  })
})
