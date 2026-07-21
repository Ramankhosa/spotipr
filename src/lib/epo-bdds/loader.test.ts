import { describe, expect, it } from 'vitest'
import { DESCRIPTION_SNIPPET_CHARS, applyTextPolicy, publicationNumberKey } from './loader'
import type { EpFullTextRecord } from './parsers/epft'

function record(overrides: Partial<EpFullTextRecord> = {}): EpFullTextRecord {
  const claims = ['Claim one text.', 'Claim two text.', 'Claim three text.']
  return {
    publicationNumber: 'EP2912867B1',
    documentId: 'EP12783558B1',
    country: 'EP',
    docNumber: '2912867',
    kind: 'B1',
    lang: 'en',
    publicationDate: '20250129',
    applicationNumber: '12783558.5',
    title: 'A TITLE',
    titleLang: 'en',
    abstract: 'An abstract, present on A-publications only.',
    claims,
    claimsText: claims.join('\n'),
    claimsCount: claims.length,
    claimsLang: 'en',
    descriptionText: 'D'.repeat(40_000),
    ipc: [],
    cpc: [],
    ...overrides,
  }
}

describe('publicationNumberKey', () => {
  it('matches the Google loader expression: uppercase, strip non-alphanumerics, KEEP the kind code', () => {
    // regexp_replace(upper(x), '[^A-Z0-9]', '', 'g') — 04-postgres-load-and-upsert.sql:68
    expect(publicationNumberKey('EP 2912867 B1')).toBe('EP2912867B1')
    expect(publicationNumberKey('ep-2912867-b1')).toBe('EP2912867B1')
    expect(publicationNumberKey('IN 24CHN2014 A')).toBe('IN24CHN2014A')
  })

  it('does NOT strip the kind code — that is pub_canonical, a different key', () => {
    expect(publicationNumberKey('EP2912867B1')).not.toBe('EP2912867')
  })

  it('returns empty string for junk rather than throwing', () => {
    expect(publicationNumberKey('')).toBe('')
    expect(publicationNumberKey('---')).toBe('')
  })
})

describe('applyTextPolicy', () => {
  describe('claims-full+description-5k (the default)', () => {
    const policy = 'claims-full+description-5k' as const

    it('keeps all claims and truncates the description to 5,000 chars', () => {
      const stored = applyTextPolicy(record(), policy)
      expect(stored.claimsText).toContain('Claim three text.')
      expect(stored.claimsCount).toBe(3)
      expect(stored.descriptionText).toHaveLength(DESCRIPTION_SNIPPET_CHARS)
    })

    it('reports a truncated description as INCOMPLETE', () => {
      // Overstating this would make `coverage` lie and hide the rows a later
      // full-description pass needs to upgrade.
      const stored = applyTextPolicy(record(), policy)
      expect(stored.descriptionComplete).toBe(false)
      expect(stored.descriptionCharCount).toBe(DESCRIPTION_SNIPPET_CHARS)
    })

    it('reports a short description as COMPLETE, because nothing was lost', () => {
      const stored = applyTextPolicy(record({ descriptionText: 'Short description.' }), policy)
      expect(stored.descriptionComplete).toBe(true)
      expect(stored.descriptionText).toBe('Short description.')
    })

    it('marks claims complete, since all of them are kept', () => {
      expect(applyTextPolicy(record(), policy).claimsComplete).toBe(true)
    })
  })

  describe('claims-full', () => {
    it('drops the description entirely and reports it incomplete', () => {
      const stored = applyTextPolicy(record(), 'claims-full')
      expect(stored.descriptionText).toBeNull()
      expect(stored.descriptionCharCount).toBe(0)
      expect(stored.descriptionComplete).toBe(false)
      expect(stored.claimsText).toContain('Claim three text.')
    })
  })

  describe('claims-full+description-full', () => {
    it('keeps the whole description and marks it complete', () => {
      const stored = applyTextPolicy(record(), 'claims-full+description-full')
      expect(stored.descriptionText).toHaveLength(40_000)
      expect(stored.descriptionComplete).toBe(true)
    })
  })

  describe('first-claim-only', () => {
    const policy = 'first-claim-only' as const

    it('keeps only claim 1', () => {
      const stored = applyTextPolicy(record(), policy)
      expect(stored.claimsText).toBe('Claim one text.')
      expect(stored.claimsCount).toBe(1)
    })

    it('NEVER reports claims complete — the dependent claims were discarded', () => {
      expect(applyTextPolicy(record(), policy).claimsComplete).toBe(false)
    })
  })

  describe('documents with no text', () => {
    it('handles an A3 search-report publication without inventing content', () => {
      const stored = applyTextPolicy(
        record({ claims: [], claimsText: null, claimsCount: 0, descriptionText: null }),
        'claims-full+description-5k'
      )
      expect(stored.claimsText).toBeNull()
      expect(stored.claimsCount).toBe(0)
      expect(stored.claimsComplete).toBe(false)
      expect(stored.descriptionText).toBeNull()
      expect(stored.descriptionComplete).toBe(false)
    })
  })

  it('does not carry the abstract into stored text — it belongs on local_patents, not epo_ep_fulltext', () => {
    const stored = applyTextPolicy(record(), 'claims-full+description-5k') as unknown as Record<string, unknown>
    expect(stored.abstract).toBeUndefined()
  })
})
