import { describe, expect, it } from 'vitest'
import { gradeCitations, gradeQuote, normaliseForQuote } from '../citations'

/** A description-prefix paragraph of the kind the extract stage is shown. */
const SOURCE = [
  'Known solar dryers rely on natural convection, and the resulting airflow across the tray stack',
  'is uneven, so the trays nearest the inlet dry far faster than those at the rear, which forces the',
  'operator to rotate the trays by hand several times during a single drying cycle.',
].join(' ')

describe('normaliseForQuote', () => {
  it('collapses whitespace, trims and lowercases — and nothing else', () => {
    expect(normaliseForQuote('  The   Tray\n\tstack  ')).toBe('the tray stack')
    // Punctuation and digits are deliberately preserved: "not suitable" must not
    // be allowed to verify against "suitable", and 5 must not verify against 50.
    expect(normaliseForQuote('Not suitable above 5 °C.')).toBe('not suitable above 5 °c.')
  })
})

describe('gradeQuote', () => {
  it('grades a verbatim quote exact', () => {
    expect(gradeQuote('the trays nearest the inlet dry far faster than those at the rear', SOURCE)).toBe('exact')
  })

  it('grades a re-wrapped, re-cased copy exact — the check is truthfulness, not formatting', () => {
    const rewrapped = 'The trays nearest the inlet dry\n   far faster\tthan those at the rear'
    expect(gradeQuote(rewrapped, SOURCE)).toBe('exact')
  })

  it('grades a copy with one word slipped near', () => {
    const slipped =
      'Known solar dryers rely on natural convection, and the resulting airflow across the tray stack '
      + 'is uneven, so the trays nearest the inlet dry much faster than those at the rear, which forces the '
      + 'operator to rotate the trays by hand several times during a single drying cycle.'
    expect(gradeQuote(slipped, SOURCE)).toBe('near')
  })

  it('grades a paraphrase dropped, however faithful its meaning', () => {
    // Same claim, different words. A paraphrase presented as a quotation is not
    // evidence, and grading it 'near' would let the report cite it as one.
    const paraphrase = 'Existing dryers dry unevenly because convection is not forced, so trays must be rotated manually.'
    expect(gradeQuote(paraphrase, SOURCE)).toBe('dropped')
  })

  it('grades an invented quote dropped', () => {
    expect(gradeQuote('the apparatus further comprises a lithium electrolyte membrane', SOURCE)).toBe('dropped')
  })

  it('refuses to verify a quote too short to mean anything', () => {
    // Not a substring, and three words match too much. Unverifiable grades
    // dropped: the rule only ever bites in the weakening direction.
    expect(gradeQuote('rely upon convection', SOURCE)).toBe('dropped')
  })

  it('handles empty and oversized inputs without throwing', () => {
    expect(gradeQuote('', SOURCE)).toBe('dropped')
    expect(gradeQuote('anything at all here', '')).toBe('dropped')
    expect(gradeQuote(`${SOURCE} and a great deal more text than the source ever held`, SOURCE)).toBe('dropped')
  })
})

describe('gradeCitations', () => {
  interface Cite {
    pub: string
    quote: string
  }
  const sources = new Map([['EP1234567A1', SOURCE]])

  it('drops a citation to a publication the model was never shown', () => {
    // The strongest possible signal that the quote was generated rather than
    // read: no textual similarity to anything else could redeem it.
    const graded = gradeCitations<Cite>(
      [{ pub: 'US9999999B2', quote: 'the trays nearest the inlet dry far faster than those at the rear' }],
      c => c,
      sources
    )
    expect(graded.map(g => g.grade)).toEqual(['dropped'])
  })

  it('returns every item, in order, graded — nothing is filtered away', () => {
    const items: Cite[] = [
      { pub: 'EP1234567A1', quote: 'the trays nearest the inlet dry far faster than those at the rear' },
      { pub: 'EP1234567A1', quote: 'existing dryers dry unevenly because convection is not forced' },
      { pub: 'WO2020000001A1', quote: 'the trays nearest the inlet dry far faster than those at the rear' },
    ]

    const graded = gradeCitations(items, c => c, sources)

    expect(graded.map(g => g.grade)).toEqual(['exact', 'dropped', 'dropped'])
    // A dropped citation is a coverage fact that travels with the conclusion it
    // failed to support; it must never be quietly removed to make the remaining
    // ones look complete.
    expect(graded.map(g => g.item)).toEqual(items)
  })

  it('reads the quote and publication through the caller-supplied accessor', () => {
    const rows = [{ ref: { publication: 'EP1234567A1', text: 'rotate the trays by hand several times' } }]
    const graded = gradeCitations(rows, r => ({ quote: r.ref.text, pub: r.ref.publication }), sources)
    expect(graded[0].grade).toBe('exact')
  })
})
