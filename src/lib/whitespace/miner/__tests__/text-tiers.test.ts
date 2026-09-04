import { describe, expect, it } from 'vitest'
import {
  describeTierMix,
  resolveTextTier,
  textHashFor,
  tierIsRicher,
  TIER_RANK,
  type TextTier,
} from '../text-tiers'

const zeroCounts = (): Record<TextTier, number> => ({
  'description-full': 0,
  'description-5k': 0,
  claims: 0,
  abstract: 0,
})

describe('resolveTextTier', () => {
  it('reads a stored description as a 5,000-character PREFIX by default', () => {
    expect(
      resolveTextTier({
        descriptionText: 'x'.repeat(5000),
        descriptionAvailability: 'TRUNCATED_5K',
        claimsText: 'A dryer comprising...',
        claimsAvailability: 'FIRST_CLAIM_ONLY',
      })
    ).toBe('description-5k')
  })

  it('lets LENGTH beat the view label for the IPIndia captures the view mislabels', () => {
    // patent_text_availability resolves any un-marked row with description text
    // to TRUNCATED_5K by rule, which mislabels exactly the rows that are NOT
    // truncated — the manual IPIndia captures, the only ones past the cap.
    expect(
      resolveTextTier({
        descriptionText: 'x'.repeat(5001),
        descriptionAvailability: 'TRUNCATED_5K',
      })
    ).toBe('description-full')
  })

  it('believes an explicit completeness marker for a short but complete EPO body', () => {
    expect(
      resolveTextTier({ descriptionText: 'A short but complete body.', descriptionAvailability: 'FULL_EPO' })
    ).toBe('description-full')
    expect(
      resolveTextTier({ descriptionText: 'A short but complete body.', descriptionAvailability: 'FULL' })
    ).toBe('description-full')
  })

  it('falls to claims when there is no description, whether the set is full or first-claim-only', () => {
    expect(
      resolveTextTier({ claimsText: '1. A dryer comprising a tray stack.', claimsAvailability: 'FIRST_CLAIM_ONLY' })
    ).toBe('claims')
    expect(
      resolveTextTier({ claimsText: '1. A dryer...\n2. The dryer of claim 1...', claimsAvailability: 'FULL_EPO' })
    ).toBe('claims')
  })

  it('does not treat claims as readable when the label says they are not stored here', () => {
    expect(
      resolveTextTier({
        claimsText: '',
        claimsAvailability: 'ON_DEMAND_BIGQUERY',
        abstract: 'A solar dryer with forced convection.',
      })
    ).toBe('abstract')
  })

  it('falls to the abstract, and to null when nothing at all is readable', () => {
    expect(resolveTextTier({ abstract: 'A solar dryer.' })).toBe('abstract')
    expect(resolveTextTier({})).toBeNull()
    expect(resolveTextTier({ descriptionText: '   ', claimsText: '', abstract: '\n\t' })).toBeNull()
  })

  it('prefers the richest available tier', () => {
    const tier = resolveTextTier({
      descriptionText: 'y'.repeat(400),
      claimsText: '1. A dryer.',
      abstract: 'A dryer.',
    })
    expect(tier).toBe('description-5k')
    expect(TIER_RANK[tier!]).toBeGreaterThan(TIER_RANK.claims)
  })
})

describe('textHashFor', () => {
  it('is stable for the same tier and text', () => {
    expect(textHashFor('claims', 'the same words')).toBe(textHashFor('claims', 'the same words'))
  })

  it('CHANGES with the tier, so a richer reading cannot collide with a thinner one', () => {
    // patent_text_extractions is unique on (publicationNumber, textHash): without
    // the tier inside the hash, an EPO claims fill arriving after an abstract-only
    // pass would look like the same row and leave the thin extraction in place.
    const text = 'A solar dryer with forced convection.'
    expect(textHashFor('claims', text)).not.toBe(textHashFor('abstract', text))
    expect(textHashFor('description-full', text)).not.toBe(textHashFor('description-5k', text))
  })

  it('separates tier from text injectively, so no tier+text pair can concatenate into another', () => {
    expect(textHashFor('claims', 'abstract')).not.toBe(textHashFor('abstract', ''))
  })
})

describe('tierIsRicher', () => {
  it('orders description-full > description-5k > claims > abstract', () => {
    expect(tierIsRicher('description-full', 'description-5k')).toBe(true)
    expect(tierIsRicher('description-5k', 'claims')).toBe(true)
    expect(tierIsRicher('claims', 'abstract')).toBe(true)
    expect(tierIsRicher('abstract', 'claims')).toBe(false)
    expect(tierIsRicher('claims', 'claims')).toBe(false)
  })
})

describe('describeTierMix', () => {
  it('never claims to have read "the description"', () => {
    const sentence = describeTierMix({ ...zeroCounts(), 'description-5k': 812, claims: 40 })
    // A 5,000-character prefix usually stops before the embodiments — before the
    // part that would disclose the mechanism. Saying "the description" tells the
    // attorney the miner read something it did not.
    expect(sentence).not.toMatch(/the description/i)
    expect(sentence).toContain('5,000-character description prefix')
  })

  it('names every tier present, richest first, with the total', () => {
    const sentence = describeTierMix({
      'description-full': 3,
      'description-5k': 812,
      claims: 40,
      abstract: 5,
    })
    expect(sentence).toBe(
      'Read 860 publications: 3 from a full description, 812 from a 5,000-character description prefix, '
        + '40 from claims only, 5 from abstracts only.'
    )
  })

  it('omits tiers with no publications', () => {
    const sentence = describeTierMix({ ...zeroCounts(), claims: 1 })
    expect(sentence).toBe('Read 1 publication: 1 from claims only.')
    expect(sentence).not.toContain('abstract')
  })

  it('says so plainly when nothing was readable', () => {
    expect(describeTierMix(zeroCounts())).toBe('No publication in this set had any readable text.')
  })

  it('treats junk counts as zero rather than rendering them', () => {
    const counts = { ...zeroCounts(), claims: -4, abstract: Number.NaN, 'description-5k': 2 }
    expect(describeTierMix(counts)).toBe('Read 2 publications: 2 from a 5,000-character description prefix.')
  })
})
