import { describe, expect, it } from 'vitest'
import { buildReading, verifyExtraction } from '../harvest-stage'
import { textHashFor } from '../text-tiers'
import { DESCRIPTION_FULL_CHARS, DESCRIPTION_PREFIX_CHARS } from '../prompts'

// ---------------------------------------------------------------------------
// verifyExtraction — nothing enters the index that is not in the text
// ---------------------------------------------------------------------------

const SOURCE =
  'Description: Conventional solar dryers suffer from uneven airflow across the drying trays, which leaves the lower trays wet after a full cycle. ' +
  'However, raising the inlet temperature further degrades the product. ' +
  'The invention provides a perforated baffle plate that distributes the airflow evenly between the trays.'

const reading = (over: Partial<{ sourceText: string; hasClaims: boolean; translated: boolean }> = {}) => ({
  sourceText: SOURCE,
  hasClaims: true,
  translated: false,
  ...over,
})

const spanOf = (needle: string, length = 120) => ({
  start: SOURCE.indexOf(needle),
  end: Math.min(SOURCE.length, SOURCE.indexOf(needle) + length),
})

describe('verifyExtraction — problems', () => {
  it('keeps a located, correctly classified problem', () => {
    const result = verifyExtraction(
      {
        problems: [
          {
            statement: 'Uneven airflow across the drying trays leaves the lower trays wet',
            kind: 'admitted_drawback',
            sourceSpan: spanOf('Conventional'),
          },
        ],
      },
      reading()
    )
    expect(result.extraction.problems).toEqual([
      { statement: 'Uneven airflow across the drying trays leaves the lower trays wet', kind: 'admitted_drawback' },
    ])
    expect(result.droppedProblems).toBe(0)
  })

  it('DROPS and COUNTS a problem that is not in the text — the model’s own knowledge of the field', () => {
    const result = verifyExtraction(
      {
        problems: [
          {
            statement: 'Photovoltaic panel efficiency degrades badly at elevated ambient temperature',
            kind: 'admitted_drawback',
            sourceSpan: spanOf('Conventional'),
          },
        ],
      },
      reading()
    )
    expect(result.extraction.problems).toEqual([])
    expect(result.droppedProblems).toBe(1)
  })

  it('drops a problem with no span at all rather than trusting it', () => {
    const result = verifyExtraction(
      { problems: [{ statement: 'Uneven airflow across the drying trays', kind: 'stated_need' }] },
      reading()
    )
    expect(result.extraction.problems).toEqual([])
    expect(result.droppedProblems).toBe(1)
  })

  it('drops a problem whose kind is not one of the three', () => {
    const result = verifyExtraction(
      {
        problems: [
          {
            statement: 'Uneven airflow across the drying trays leaves the lower trays wet',
            kind: 'my_opinion',
            sourceSpan: spanOf('Conventional'),
          },
        ],
      },
      reading()
    )
    expect(result.extraction.problems).toEqual([])
    expect(result.droppedProblems).toBe(1)
  })
})

describe('verifyExtraction — mechanisms', () => {
  it('keeps a located mechanism and normalises its elements', () => {
    const result = verifyExtraction(
      {
        mechanisms: [
          {
            statement: 'A perforated baffle plate distributes airflow evenly between the trays',
            elements: ['Perforated Baffle Plate', 'drying   TRAY', 'x', 'a', 'b', 'c', 'd', 'e', 'f'],
            sourceSpan: spanOf('The invention provides'),
          },
        ],
      },
      reading()
    )
    expect(result.extraction.mechanisms).toHaveLength(1)
    expect(result.extraction.mechanisms[0].elements).toEqual(['perforated baffle plate', 'drying tray'])
    expect(result.droppedMechanisms).toBe(0)
  })

  it('drops an unlocatable mechanism and counts it', () => {
    const result = verifyExtraction(
      {
        mechanisms: [
          {
            statement: 'A lithium electrolyte additive suppresses dendrite formation on the anode',
            elements: [],
            sourceSpan: spanOf('The invention provides'),
          },
        ],
      },
      reading()
    )
    expect(result.extraction.mechanisms).toEqual([])
    expect(result.droppedMechanisms).toBe(1)
  })
})

describe('verifyExtraction — teaching away', () => {
  it('keeps a verbatim single sentence', () => {
    const quote = 'However, raising the inlet temperature further degrades the product.'
    const result = verifyExtraction({ teachingAway: [{ quote }] }, reading())
    expect(result.extraction.teachingAway).toEqual([{ quote }])
    expect(result.droppedQuotes).toBe(0)
  })

  it('drops a paraphrase presented as a quotation', () => {
    const result = verifyExtraction(
      { teachingAway: [{ quote: 'Raising the temperature is said to spoil the produce.' }] },
      reading()
    )
    expect(result.extraction.teachingAway).toEqual([])
    expect(result.droppedQuotes).toBe(1)
  })

  it('drops a stitched pair, which is how the qualifier gets removed', () => {
    const stitched =
      'However, raising the inlet temperature further degrades the product. The invention provides a perforated baffle plate that distributes the airflow evenly between the trays.'
    const result = verifyExtraction({ teachingAway: [{ quote: stitched }] }, reading())
    expect(result.extraction.teachingAway).toEqual([])
    expect(result.droppedQuotes).toBe(1)
  })

  it('drops EVERY quote from a translated reading — a translated quote is not a quote', () => {
    const quote = 'However, raising the inlet temperature further degrades the product.'
    const result = verifyExtraction({ teachingAway: [{ quote }] }, reading({ translated: true }))
    expect(result.extraction.teachingAway).toEqual([])
    expect(result.droppedQuotes).toBe(1)
  })
})

describe('verifyExtraction — claimed scope', () => {
  it('records scope only when claims were actually supplied', () => {
    const document = { claimedScope: { independentElements: ['perforated baffle', 'drying chamber'], dependentNarrowings: ['sensor'] } }
    expect(verifyExtraction(document, reading({ hasClaims: true })).extraction.claimedScope).toEqual({
      independentElements: ['perforated baffle', 'drying chamber'],
      dependentNarrowings: ['sensor'],
    })
    // "We did not read claims" is a different fact from "this patent claims
    // nothing", and only one of them is null.
    expect(verifyExtraction(document, reading({ hasClaims: false })).extraction.claimedScope).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// buildReading
// ---------------------------------------------------------------------------

const stagedRow = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    familyKey: 'FAM-1',
    publicationNumber: 'US1234567A1',
    country: 'US',
    filingYear: 2019,
    publicationDate: new Date('2020-01-01'),
    tier: 'description-5k',
    descriptionChars: 5000,
    hasClaims: true,
    hasAbstract: true,
    ...over,
  }) as Parameters<typeof buildReading>[0]

const textRow = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    publicationNumber: 'US1234567A1',
    title: 'Solar dryer with perforated baffle',
    abstract: 'A solar dryer in which a perforated baffle distributes the airflow evenly between the drying trays of the chamber.',
    abstractOriginal: null,
    claims_text: '1. A solar dryer comprising a drying chamber, a plurality of trays, and a perforated baffle arranged to distribute airflow.',
    description_text: `${'Conventional solar dryers suffer from uneven airflow across the drying trays. '.repeat(200)}`,
    classifications: ['F26B 3/28', 'A23B7/02'],
    applicants: ['Acme Solar Pvt. Ltd.'],
    filing_year: 2019,
    country: 'US',
    ...over,
  }) as Parameters<typeof buildReading>[1]

describe('buildReading', () => {
  it('caps a 5,000-character PREFIX at the prefix budget, not the full-description one', () => {
    const result = buildReading(stagedRow(), textRow())!
    const description = result.sourceText.split('\n')[0]
    expect(description.startsWith('Description: ')).toBe(true)
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_PREFIX_CHARS + 'Description: '.length)
    expect(result.truncatedAtChars).not.toBeNull()
  })

  it('reads more of a genuinely full description', () => {
    const result = buildReading(stagedRow({ tier: 'description-full', descriptionChars: 5001 }), textRow())!
    const description = result.sourceText.split('\n')[0]
    expect(description.length).toBeGreaterThan(DESCRIPTION_PREFIX_CHARS)
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_FULL_CHARS + 'Description: '.length)
  })

  it('hashes the reading with its TIER inside, so a richer reading is a new row', () => {
    const result = buildReading(stagedRow(), textRow())!
    expect(result.textHash).toBe(textHashFor('description-5k', result.sourceText))
    expect(result.textHash).not.toBe(textHashFor('description-full', result.sourceText))
  })

  it('prefers the English abstract and does not mark the reading translated', () => {
    const result = buildReading(stagedRow(), textRow({ abstractOriginal: 'Sonnentrockner mit Prallblech' }))!
    expect(result.translated).toBe(false)
    expect(result.sourceText).toContain('A solar dryer in which a perforated baffle')
  })

  it('marks a reading translated when only the office-language abstract exists', () => {
    const result = buildReading(
      stagedRow({ country: 'DE' }),
      textRow({
        abstract: null,
        abstractOriginal: 'Sonnentrockner mit einem Prallblech zur gleichmaessigen Verteilung der Luft',
        country: 'DE',
      })
    )!
    expect(result.translated).toBe(true)
    expect(result.language).toBe('de')
  })

  it('records the applicant and CPC subclasses the way the census does', () => {
    const result = buildReading(stagedRow(), textRow())!
    // Exactly what canonicaliseAssignee produces, warts included: its suffix
    // list has PTE and PTY but not the Indian PVT, so that token survives. The
    // point of this assertion is that the miner and the census agree about who
    // an applicant is, not that either of them is perfect.
    expect(result.applicantNorm).toBe('ACME SOLAR PVT')
    expect(result.cpcSubclasses).toEqual(['F26B', 'A23B'])
  })

  it('returns null for a row with nothing readable, so the caller can count it', () => {
    expect(
      buildReading(
        stagedRow({ tier: 'abstract', descriptionChars: 0, hasClaims: false }),
        textRow({ abstract: null, abstractOriginal: null, claims_text: null, description_text: null })
      )
    ).toBeNull()
  })

  it('returns null for OCR soup rather than spending a call on it', () => {
    expect(
      buildReading(
        stagedRow({ tier: 'abstract', descriptionChars: 0, hasClaims: false }),
        textRow({
          abstract: '|[ 0O12 ]| $%^ 3// \\\\ 8|9 ~~ ][ }{ ;; @@ ## ** ++ f1g 2a',
          abstractOriginal: null,
          claims_text: null,
          description_text: null,
        })
      )
    ).toBeNull()
  })

  it('puts the source text in one block whose offsets the harvest can index into', () => {
    const result = buildReading(stagedRow(), textRow())!
    // No re-normalisation between the prompt and the check: the span the model
    // returns indexes into exactly this string.
    const start = result.sourceText.indexOf('Claims:')
    expect(result.sourceText.slice(start, start + 7)).toBe('Claims:')
    expect(result.sourceText.split('\n').map(line => line.split(':')[0])).toEqual([
      'Description',
      'Claims',
      'Abstract',
    ])
  })
})
