import { describe, expect, it } from 'vitest'
import { elementTerms, stemTerm } from './stemming'

describe('stemTerm', () => {
  it('collapses the morphological variants patent drafting actually uses', () => {
    // Claim language and specification language differ in exactly this way, and
    // a raw substring test scored every one of these pairs as a miss.
    const pairs: Array<[string, string]> = [
      ['rotating', 'rotates'],
      ['rotating', 'rotation'],
      ['coupled', 'coupling'],
      ['housing', 'houses'],
      ['sensing', 'sensor'],
      ['engagement', 'engaging'],
      ['sterilizable', 'sterilize'],
    ]
    for (const [a, b] of pairs) {
      expect(stemTerm(a), `${a} vs ${b}`).toBe(stemTerm(b))
    }
  })

  it('keeps unrelated words apart', () => {
    expect(stemTerm('clutch')).not.toBe(stemTerm('cluster'))
    expect(stemTerm('torque')).not.toBe(stemTerm('torch'))
  })

  it('leaves short words alone rather than stemming them to nothing', () => {
    expect(stemTerm('gear')).toBe('gear')
    expect(stemTerm('pin')).toBe('pin')
    expect(stemTerm('led')).toBe('led')
  })
})

describe('elementTerms', () => {
  it('keeps acronyms that the length floor used to discard', () => {
    const terms = elementTerms('an RF transmitter driving an LED indicator')
    expect(terms).toContain('rf')
    expect(terms).toContain('led')
    expect(terms).toContain('transmitter')
  })

  it('drops claim boilerplate that every patent contains', () => {
    const terms = elementTerms('a plurality of first members configured to be adapted for said housing')
    expect(terms).not.toContain('plurality')
    expect(terms).not.toContain('configured')
    expect(terms).not.toContain('adapted')
    expect(terms).toContain('housing')
  })

  it('caps the term list so coverage stays a stable fraction', () => {
    const terms = elementTerms(
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar'
    )
    expect(terms.length).toBeLessThanOrEqual(12)
  })
})
