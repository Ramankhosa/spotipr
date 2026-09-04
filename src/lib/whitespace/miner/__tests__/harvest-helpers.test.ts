import { describe, expect, it } from 'vitest'
import {
  allocateTierSample,
  applicantNormOf,
  BatchCircuitBreaker,
  cpcSubclassPrefixes,
  detectSourceLanguage,
  isSingleSentence,
  locateStatement,
  looksUnreadable,
  MAX_SPAN_CHARS,
  statementTextHash,
  stagedTextTier,
  truncateAtSentence,
  zeroTierCounts,
} from '../harvest-stage'
import type { TextTier } from '../text-tiers'

const counts = (over: Partial<Record<TextTier, number>>) => ({ ...zeroTierCounts(), ...over })

// ---------------------------------------------------------------------------
// truncateAtSentence
// ---------------------------------------------------------------------------

describe('truncateAtSentence', () => {
  it('leaves text under the cap alone and reports no truncation', () => {
    expect(truncateAtSentence('One sentence. Another one.', 200)).toEqual({
      text: 'One sentence. Another one.',
      truncatedAtChars: null,
    })
  })

  it('cuts at the last sentence boundary, never mid-sentence', () => {
    // The failure this exists to prevent: a tail ending "..., however" reads as
    // the opposite of what the sentence says, and still passes a substring check.
    const text = 'Known dryers are cheap. It has been suggested that solar drying is unsuitable, however this is wrong.'
    const cut = truncateAtSentence(text, 80)
    expect(cut.text.endsWith('.')).toBe(true)
    expect(cut.text).toBe('Known dryers are cheap.')
    expect(cut.truncatedAtChars).toBe('Known dryers are cheap.'.length)
    expect(cut.text).not.toContain('however')
  })

  it('does not mistake a decimal point for a sentence boundary', () => {
    const text = `The ratio is 3.5 and the yield improves accordingly across every run of the trial series ${'x'.repeat(60)}. tail`
    const cut = truncateAtSentence(text, 60)
    expect(cut.text).not.toMatch(/3\.$/)
  })

  it('falls back to a WORD boundary when no sentence ends inside the budget', () => {
    // A 6,000-character run with no terminator is a claim set or an OCR
    // artefact; losing 95% of it over a missing full stop is the worse lie.
    const text = `${'alpha beta gamma '.repeat(40)}end`
    const cut = truncateAtSentence(text, 100)
    expect(cut.text.endsWith(' ')).toBe(false)
    expect(cut.text).toBe(cut.text.trimEnd())
    expect(cut.text.length).toBeLessThanOrEqual(100)
    expect(cut.truncatedAtChars).toBe(cut.text.length)
  })

  it('keeps the hard cut when even a word boundary would throw away most of the budget', () => {
    const cut = truncateAtSentence('x'.repeat(300), 100)
    expect(cut.text).toHaveLength(100)
    expect(cut.truncatedAtChars).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// looksUnreadable
// ---------------------------------------------------------------------------

describe('looksUnreadable', () => {
  it('accepts ordinary patent prose', () => {
    expect(
      looksUnreadable(
        'Description: A solar dryer comprising a perforated tray and a humidity sensor arranged to control airflow through the drying chamber.'
      )
    ).toBe(false)
  })

  it('rejects OCR soup by its share of word-shaped tokens', () => {
    expect(looksUnreadable('f1g 2a |[ 0O12 ]| $%^ 3// \\\\ 8|9 ~~ ][ }{ ;; @@ ## ** ++')).toBe(true)
  })

  it('rejects text whose spacing was lost', () => {
    const glued = Array.from({ length: 20 }, () => 'asolardryercomprisingaperforatedtray').join(' ')
    expect(looksUnreadable(glued)).toBe(true)
  })

  it('rejects a fragment too short to be a reading', () => {
    expect(looksUnreadable('A solar dryer.')).toBe(true)
  })

  it('does NOT bin CJK text, which has no spaces and no Latin letters', () => {
    // Applying the mean-token-length rule here would have silently dropped every
    // Japanese and Chinese publication as "unreadable" — a coverage lie wearing
    // a quality check's clothes.
    const japanese = '本発明は、乾燥装置に関するものであり、従来の装置では乾燥が不均一であるという問題があった'
    expect(looksUnreadable(japanese)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// detectSourceLanguage
// ---------------------------------------------------------------------------

describe('detectSourceLanguage', () => {
  it('reads the script where there is one to read', () => {
    expect(detectSourceLanguage('乾燥装置の問題を解決する', 'JP')).toBe('ja')
    expect(detectSourceLanguage('설명서의 문제', 'KR')).toBe('ko')
    expect(detectSourceLanguage('устройство для сушки', 'RU')).toBe('ru')
  })

  it('recognises English by its function words', () => {
    expect(
      detectSourceLanguage(
        'The invention relates to a dryer in which the air is heated and the trays are arranged so that the flow is even for all of the produce.',
        'US'
      )
    ).toBe('en')
  })

  it('falls back to the office language rather than guessing, and to null when it cannot', () => {
    expect(detectSourceLanguage('Vorrichtung zum Trocknen von Erntegut mittels Solarenergie', 'DE')).toBe('de')
    expect(detectSourceLanguage('Vorrichtung zum Trocknen von Erntegut mittels Solarenergie', 'ZZ')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// allocateTierSample
// ---------------------------------------------------------------------------

describe('allocateTierSample', () => {
  it('takes everything when the field fits under the cap', () => {
    const field = counts({ 'description-5k': 40, claims: 10 })
    expect(allocateTierSample(field, 3000)).toEqual(field)
  })

  it('allocates proportionally', () => {
    const allocation = allocateTierSample(counts({ 'description-5k': 8000, claims: 2000 }), 1000, 0)
    expect(allocation['description-5k']).toBe(800)
    expect(allocation.claims).toBe(200)
  })

  it('never exceeds the cap or a tier’s own supply', () => {
    const allocation = allocateTierSample(
      counts({ 'description-full': 3, 'description-5k': 50_000, claims: 20_000, abstract: 60_000 }),
      3_000
    )
    const total = (Object.values(allocation) as number[]).reduce((a, b) => a + b, 0)
    expect(total).toBe(3_000)
    expect(allocation['description-full']).toBe(3)
  })

  it('gives a thin but present tier a floor, so the tier mix can be reasoned about', () => {
    // description-full is 0.03% of this field. Purely proportional allocation
    // would read zero of them, and then no conclusion could be qualified by the
    // depth it was read at.
    const allocation = allocateTierSample(
      counts({ 'description-full': 30, 'description-5k': 100_000 }),
      3_000,
      25
    )
    expect(allocation['description-full']).toBeGreaterThanOrEqual(25)
  })

  it('is deterministic', () => {
    const field = counts({ 'description-5k': 7_777, claims: 3_333, abstract: 11_111 })
    expect(allocateTierSample(field, 2_500)).toEqual(allocateTierSample(field, 2_500))
  })
})

// ---------------------------------------------------------------------------
// locateStatement — the check the whole product rests on
// ---------------------------------------------------------------------------

describe('locateStatement', () => {
  const source =
    'Description: Conventional solar dryers suffer from uneven airflow across the drying trays, which leaves the lower trays wet. ' +
    'The present invention provides a perforated baffle that distributes the airflow evenly.'

  it('accepts a paraphrase whose span points at the passage it came from', () => {
    const span = { start: source.indexOf('Conventional'), end: source.indexOf('wet.') + 4 }
    expect(locateStatement(source, 'Conventional solar dryers give uneven airflow across the drying trays', span)).toBe(
      true
    )
  })

  it('rejects a statement whose content words are simply not in the document', () => {
    const span = { start: 0, end: 120 }
    expect(locateStatement(source, 'Lithium electrolyte decomposition shortens battery cycle life', span)).toBe(false)
  })

  it('rejects a span that is out of range or inverted', () => {
    expect(locateStatement(source, 'uneven airflow across drying trays', { start: 10, end: 5 })).toBe(false)
    expect(locateStatement(source, 'uneven airflow across drying trays', { start: 0, end: source.length + 50 })).toBe(
      false
    )
    expect(locateStatement(source, 'uneven airflow across drying trays', { start: 1.5, end: 40 })).toBe(false)
    expect(locateStatement(source, 'uneven airflow across drying trays', null)).toBe(false)
  })

  it('rejects "the whole document" as a location', () => {
    // A span of the entire block would let anything in the block pass, which is
    // how a verification quietly becomes a formality.
    const long = `${source} ${'filler words here '.repeat(200)}`
    expect(locateStatement(long, 'uneven airflow across the drying trays', { start: 0, end: long.length })).toBe(false)
    expect(MAX_SPAN_CHARS).toBeLessThan(long.length)
  })

  it('rejects a statement with too little content to verify', () => {
    const span = { start: 0, end: 120 }
    expect(locateStatement(source, 'it is bad', span)).toBe(false)
  })
})

describe('isSingleSentence', () => {
  it('accepts one sentence, with or without its terminator', () => {
    expect(isSingleSentence('However, increasing the temperature further degrades the product.')).toBe(true)
    expect(isSingleSentence('However, increasing the temperature further degrades the product')).toBe(true)
  })

  it('rejects a stitched pair, which is how a qualifier gets dropped', () => {
    expect(isSingleSentence('Higher temperatures are undesirable. The invention avoids them.')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// BatchCircuitBreaker
// ---------------------------------------------------------------------------

describe('BatchCircuitBreaker', () => {
  it('stays closed while batches are mostly succeeding', () => {
    const breaker = new BatchCircuitBreaker()
    for (let i = 0; i < 40; i++) breaker.record(i % 20 !== 0)
    expect(breaker.tripped()).toBeNull()
  })

  it('trips on ten consecutive failures, and not on nine', () => {
    const breaker = new BatchCircuitBreaker()
    for (let i = 0; i < 9; i++) breaker.record(false)
    expect(breaker.tripped()).toBeNull()
    breaker.record(false)
    expect(breaker.tripped()).toContain('10 extraction batches failed in a row')
  })

  it('trips when more than a fifth of the recent window failed', () => {
    const breaker = new BatchCircuitBreaker({ consecutive: 99 })
    for (let i = 0; i < 25; i++) breaker.record(i % 4 !== 0)
    expect(breaker.tripped()).toMatch(/of the last 25 extraction batches failed/)
  })

  it('needs a minimum number of observations before the rate rule bites', () => {
    const breaker = new BatchCircuitBreaker({ consecutive: 99, minObservations: 10 })
    breaker.record(false)
    breaker.record(true)
    expect(breaker.tripped()).toBeNull()
  })

  it('forgets failures once a window of successes has passed', () => {
    const breaker = new BatchCircuitBreaker()
    for (let i = 0; i < 9; i++) breaker.record(false)
    for (let i = 0; i < 25; i++) breaker.record(true)
    expect(breaker.tripped()).toBeNull()
    expect(breaker.observed).toBe(34)
    expect(breaker.failureCount).toBe(9)
  })
})

// ---------------------------------------------------------------------------
// Row-level normalisers
// ---------------------------------------------------------------------------

describe('cpcSubclassPrefixes', () => {
  it('normalises spacing the way the census does, to four characters', () => {
    expect(cpcSubclassPrefixes(['A01G 25/16', 'a01g25/02', 'F26B3/28'])).toEqual(['A01G', 'F26B'])
  })

  it('drops anything that is not a subclass', () => {
    expect(cpcSubclassPrefixes(['', 'XX', '12AB', null, 'A61'])).toEqual([])
  })
})

describe('applicantNormOf', () => {
  it('canonicalises the first applicant the way the census canonicalises assignees', () => {
    expect(applicantNormOf(['Samsung Electronics Co., Ltd.', 'Other Inc'])).toBe('SAMSUNG ELECTRONICS')
    expect(applicantNormOf([{ name: 'Bharat Heavy Electricals Limited' }])).toBe('BHARAT HEAVY ELECTRICALS')
  })

  it('is null when there is no applicant to read', () => {
    expect(applicantNormOf(null)).toBeNull()
    expect(applicantNormOf([])).toBeNull()
  })
})

describe('statementTextHash', () => {
  it('ignores case and whitespace, so one sentence has one identity', () => {
    expect(statementTextHash('Uneven  airflow')).toBe(statementTextHash('uneven airflow'))
  })

  it('separates statements that differ in a word', () => {
    expect(statementTextHash('uneven airflow')).not.toBe(statementTextHash('even airflow'))
  })
})

// ---------------------------------------------------------------------------
// stagedTextTier
// ---------------------------------------------------------------------------

describe('stagedTextTier', () => {
  it('resolves a stored description to the 5,000-character prefix tier', () => {
    expect(
      stagedTextTier({
        descriptionChars: 5000,
        hasClaims: true,
        hasAbstract: true,
        claimsAvailability: 'FIRST_CLAIM_ONLY',
        descriptionAvailability: 'TRUNCATED_5K',
      })
    ).toBe('description-5k')
  })

  it('lets LENGTH beat the view label, exactly as resolveTextTier does', () => {
    expect(
      stagedTextTier({
        descriptionChars: 5001,
        hasClaims: false,
        hasAbstract: false,
        claimsAvailability: 'NONE',
        descriptionAvailability: 'TRUNCATED_5K',
      })
    ).toBe('description-full')
  })

  it('falls through to claims and then to the abstract', () => {
    expect(
      stagedTextTier({
        descriptionChars: 0,
        hasClaims: true,
        hasAbstract: true,
        claimsAvailability: 'FULL_EPO',
        descriptionAvailability: 'NONE',
      })
    ).toBe('claims')
    expect(
      stagedTextTier({
        descriptionChars: 0,
        hasClaims: false,
        hasAbstract: true,
        claimsAvailability: 'NONE',
        descriptionAvailability: 'NONE',
      })
    ).toBe('abstract')
  })

  it('returns null for a row with nothing readable, which is a coverage fact', () => {
    expect(
      stagedTextTier({
        descriptionChars: 0,
        hasClaims: false,
        hasAbstract: false,
        claimsAvailability: 'ON_DEMAND_BIGQUERY',
        descriptionAvailability: 'NONE',
      })
    ).toBeNull()
  })
})
