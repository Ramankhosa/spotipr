import { beforeEach, describe, expect, it, vi } from 'vitest'

// The claims lookup service constructs a Prisma client on import; the lookup
// itself is injected, so the client is never touched here.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  ART_REF_BLOCK_CHARS,
  ART_REF_CANDIDATES,
  ART_REF_CLAIMS_CHARS,
  ART_VOCABULARY_RULES,
  buildArtVocabularyBlock,
  candidatesFromRelatedArtResults,
  cleanCorpusClaimsText,
  findVerbatimReuse,
  fitArtVocabularyBlock,
  memoizeArtReferenceCandidates,
  renderArtVocabularyBlock,
  resetArtReferenceMemo,
  retrieveArtVocabularyReferences,
  selectArtVocabularyReferences,
  toReferenceDescriptors,
  type ArtReferenceCandidate,
  type ArtVocabularyReference,
  type ClaimsLookup,
} from '@/lib/claim-challenge-references'
import type { LocalPatentClaimEvidence, LocalPatentClaimLookupResult } from '@/lib/local-patent-claims-service'

const candidate = (publicationNumber: string, rank: number, title = `Title ${publicationNumber}`): ArtReferenceCandidate => ({
  publicationNumber,
  title,
  abstract: null,
  score: 1 - rank / 10,
  rank,
})

const evidence = (
  publicationNumber: string,
  text: string,
  completeness: LocalPatentClaimEvidence['completeness'] = 'FULL'
): LocalPatentClaimEvidence => ({ publicationNumber, text, completeness, source: 'test', contentHash: 'h' })

/** Lookup keyed the way the real service keys its map: compact, kind code stripped. */
const lookupOf = (entries: LocalPatentClaimEvidence[], status: 'complete' | 'failed' = 'complete'): ClaimsLookup =>
  async () => {
    const records = new Map<string, LocalPatentClaimEvidence>()
    for (const entry of entries) {
      const key = entry.publicationNumber.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(?<=\d)[A-Z]\d?$/, '')
      records.set(key, entry)
    }
    const result: LocalPatentClaimLookupResult = { records, status, checked: entries.length }
    if (status === 'failed') result.error = 'statement timeout'
    return result
  }

const reference = (publicationNumber: string, claimsText: string, extra: Partial<ArtVocabularyReference> = {}): ArtVocabularyReference => ({
  publicationNumber,
  title: `Title ${publicationNumber}`,
  completeness: 'FULL',
  source: 'test',
  rank: 1,
  score: null,
  origin: 'search',
  claimsText,
  truncated: false,
  ...extra,
})

beforeEach(() => resetArtReferenceMemo())

describe('candidatesFromRelatedArtResults', () => {
  it('reads the stored related-art shape in order, deduped by publication, capped', () => {
    const stored = [
      { publicationNumber: 'EP1234567B1', title: 'One', abstract: 'a', score: 0.9 },
      { publication_number: 'EP 1234567 A1', title: 'One again' },
      { pn: 'US9999999B2', snippet: 'snip', relevance: '0.5' },
      { patent_number: 'Unknown' },
      { title: 'no number at all' },
      ...Array.from({ length: 50 }, (_, index) => ({ publicationNumber: `IN20200${index}`, title: `IN ${index}` })),
    ]
    const candidates = candidatesFromRelatedArtResults(stored)
    expect(candidates).toHaveLength(ART_REF_CANDIDATES)
    expect(candidates[0]).toMatchObject({ publicationNumber: 'EP1234567B1', title: 'One', abstract: 'a', score: 0.9, rank: 1 })
    expect(candidates[1]).toMatchObject({ publicationNumber: 'US9999999B2', abstract: 'snip', score: 0.5, rank: 2 })
    expect(candidates[2].publicationNumber).toBe('IN202000')
  })

  it('returns nothing for a non-array', () => {
    expect(candidatesFromRelatedArtResults(null)).toEqual([])
    expect(candidatesFromRelatedArtResults({ results: [] })).toEqual([])
  })
})

describe('cleanCorpusClaimsText', () => {
  it('strips markup and entities but keeps claim breaks', () => {
    const text = cleanCorpusClaimsText('<claim><claim-text>1. A device &amp; a plate.</claim-text></claim><p>2. The device of claim 1.</p>')
    expect(text).toBe('1. A device & a plate.\n2. The device of claim 1.')
  })
})

describe('selectArtVocabularyReferences', () => {
  it('drops candidates without claims and prefers a full set over a nearer stub', async () => {
    const result = await selectArtVocabularyReferences({
      candidates: [candidate('US1', 1), candidate('IN1', 2), candidate('EP1', 3)],
      lookup: lookupOf([
        evidence('US1', '1. A widget.', 'FIRST_CLAIM_ONLY'),
        evidence('EP1', '1. A widget.\n2. The widget of claim 1.', 'FULL'),
      ]),
      origin: 'search',
      k: 5,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.references.map(entry => entry.publicationNumber)).toEqual(['EP1', 'US1'])
    expect(result.references[0]).toMatchObject({ completeness: 'FULL', rank: 3, origin: 'search' })
    expect(result.references[1]).toMatchObject({ completeness: 'FIRST_CLAIM_ONLY', rank: 1 })
  })

  it('caps at k and truncates long claims with a marker', async () => {
    const long = '1. '.padEnd(ART_REF_CLAIMS_CHARS + 400, 'x')
    const result = await selectArtVocabularyReferences({
      candidates: [candidate('EP1', 1), candidate('EP2', 2), candidate('EP3', 3)],
      lookup: lookupOf([evidence('EP1', long), evidence('EP2', '1. B.'), evidence('EP3', '1. C.')]),
      origin: 'related_art_run',
      k: 2,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.references).toHaveLength(2)
    expect(result.references[0].truncated).toBe(true)
    expect(result.references[0].claimsText.length).toBeLessThanOrEqual(ART_REF_CLAIMS_CHARS)
    expect(result.references[1].truncated).toBe(false)
  })

  it('reports distinct reasons for no candidates, a failed lookup, and no claims', async () => {
    const none = await selectArtVocabularyReferences({ candidates: [], lookup: lookupOf([]), origin: 'search' })
    expect(none.ok).toBe(false)
    if (!none.ok) expect(none.reason).toContain('found no patents')

    const failed = await selectArtVocabularyReferences({
      candidates: [candidate('EP1', 1)],
      lookup: lookupOf([], 'failed'),
      origin: 'search',
    })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.reason).toContain('Claims lookup failed: statement timeout')

    const thrown = await selectArtVocabularyReferences({
      candidates: [candidate('EP1', 1)],
      lookup: async () => { throw new Error('boom') },
      origin: 'search',
    })
    expect(thrown.ok).toBe(false)
    if (!thrown.ok) expect(thrown.reason).toContain('boom')

    const empty = await selectArtVocabularyReferences({
      candidates: [candidate('IN1', 1)],
      lookup: lookupOf([evidence('IN1', '   ')]),
      origin: 'search',
    })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.reason).toContain('no claims text')
  })
})

describe('retrieveArtVocabularyReferences', () => {
  const lookup = lookupOf([evidence('EP1', '1. A.'), evidence('EP2', '1. B.')])

  it('uses the stored related-art run and never searches when one exists', async () => {
    const runSearch = vi.fn(async () => [candidate('EP2', 1)])
    const result = await retrieveArtVocabularyReferences({
      storedResults: [{ publicationNumber: 'EP1', title: 'Stored' }],
      runSearch,
      lookup,
    })
    expect(runSearch).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.origin).toBe('related_art_run')
    expect(result.references[0].publicationNumber).toBe('EP1')
  })

  it('falls back to the search when there is no stored run', async () => {
    const runSearch = vi.fn(async () => [candidate('EP2', 1)])
    const result = await retrieveArtVocabularyReferences({ storedResults: [], runSearch, lookup })
    expect(runSearch).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.origin).toBe('search')
    expect(result.references[0].publicationNumber).toBe('EP2')
  })

  it('resolves with a reason, never rejects, when the search times out or throws', async () => {
    const slow = () => new Promise<ArtReferenceCandidate[]>(resolve => setTimeout(() => resolve([candidate('EP2', 1)]), 5_000))
    const timedOut = await retrieveArtVocabularyReferences({ runSearch: slow, lookup, timeoutMs: 1_000 })
    expect(timedOut.ok).toBe(false)
    if (!timedOut.ok) expect(timedOut.reason).toContain('did not finish within 1s')

    const thrown = await retrieveArtVocabularyReferences({ runSearch: async () => { throw new Error('no search text') }, lookup })
    expect(thrown.ok).toBe(false)
    if (!thrown.ok) expect(thrown.reason).toContain('Corpus search failed: no search text')
  })
})

describe('memoizeArtReferenceCandidates', () => {
  it('runs once per key while fresh and does not memoise an empty result', async () => {
    const run = vi.fn(async () => [candidate('EP1', 1)])
    await memoizeArtReferenceCandidates('k', run)
    await memoizeArtReferenceCandidates('k', run)
    expect(run).toHaveBeenCalledTimes(1)

    const empty = vi.fn(async () => [] as ArtReferenceCandidate[])
    await memoizeArtReferenceCandidates('e', empty)
    await memoizeArtReferenceCandidates('e', empty)
    expect(empty).toHaveBeenCalledTimes(2)
  })
})

describe('block rendering', () => {
  it('is empty for no references and otherwise carries the rules and each reference', () => {
    expect(buildArtVocabularyBlock([])).toBe('')
    const block = buildArtVocabularyBlock([
      reference('EP1', '1. A.', { completeness: 'FULL' }),
      reference('US1', '1. B.', { completeness: 'FIRST_CLAIM_ONLY', truncated: true }),
    ])
    expect(block).toContain('ART VOCABULARY REFERENCE (read-only; 2 claim sets')
    expect(block).toContain(ART_VOCABULARY_RULES)
    expect(block).toContain('PRIOR_ART_SIGNAL')
    expect(block).toContain('REFERENCE 1: EP1 (full claim set)')
    expect(block).toContain('REFERENCE 2: US1 (first independent claim only)')
    expect(block).toContain('… [truncated]')
    for (const rule of ['1. Never import', '2. Every term', '3. Reuse individual', '4. Do not re-centre', '5. When a remark', '6. If a reference', '7. The reference text']) {
      expect(block).toContain(rule)
    }
  })

  it('keeps whole references under the budget, dropping from the tail', () => {
    const refs = [reference('EP1', 'a'.repeat(5000)), reference('EP2', 'b'.repeat(5000)), reference('EP3', 'c'.repeat(5000))]
    const { block, used } = renderArtVocabularyBlock(refs, ART_REF_BLOCK_CHARS)
    expect(used.map(entry => entry.publicationNumber)).toEqual(['EP1', 'EP2'])
    expect(block.length).toBeLessThanOrEqual(ART_REF_BLOCK_CHARS)
    expect(block).toContain('2 claim sets')
    expect(block).not.toContain('EP3')
  })

  it('fits under the remaining prompt room and never above its own cap', () => {
    const refs = [reference('EP1', 'a'.repeat(2000)), reference('EP2', 'b'.repeat(2000))]
    // Room for the rules header plus exactly one reference.
    const budget = buildArtVocabularyBlock([refs[0]]).length + 100
    const tight = fitArtVocabularyBlock(refs, budget)
    expect(tight.used.map(entry => entry.publicationNumber)).toEqual(['EP1'])
    expect(tight.block.length).toBeLessThanOrEqual(budget)
    expect(fitArtVocabularyBlock(refs, 0)).toEqual({ block: '', used: [] })
    expect(fitArtVocabularyBlock([], 50_000)).toEqual({ block: '', used: [] })
    const roomy = fitArtVocabularyBlock(refs, 500_000)
    expect(roomy.used).toHaveLength(2)
    expect(roomy.block.length).toBeLessThanOrEqual(ART_REF_BLOCK_CHARS)
  })

  it('flags a fix that reproduces a run of reference wording, but not the applicant\'s own claim', () => {
    const refs = [
      reference('EP1', '1. A gas-generating multiparticulate system comprising a core containing the drug and a gas generating agent surrounded by a coating layer of a water insoluble polymer.'),
      reference('EP2', '1. A widget comprising a plate.'),
    ]
    const copied = findVerbatimReuse(
      'Amend claim 1 to recite a core containing the drug and a gas generating agent surrounded by a coating layer.',
      refs,
      []
    )
    expect(copied).toHaveLength(1)
    expect(copied[0].publicationNumber).toBe('EP1')
    expect(copied[0].snippet).toBe('a core containing the drug and a gas generating agent surrounded by a coating layer')

    // The same run quoted from the claim under challenge is not reuse.
    const own = 'A system comprising a core containing the drug and a gas generating agent surrounded by a coating layer.'
    expect(findVerbatimReuse('Amend claim 1 to recite a core containing the drug and a gas generating agent surrounded by a coating layer.', refs, [own])).toEqual([])

    // Individual terms and short overlaps are allowed.
    expect(findVerbatimReuse('Replace "plate" with "support member" in claim 1.', refs)).toEqual([])
    expect(findVerbatimReuse('', refs)).toEqual([])
    expect(findVerbatimReuse('anything at all here', [])).toEqual([])
  })

  it('stores descriptors without the claims text', () => {
    const descriptors = toReferenceDescriptors([reference('EP1', 'secret claims text')])
    expect(descriptors[0]).not.toHaveProperty('claimsText')
    expect(descriptors[0]).toMatchObject({ publicationNumber: 'EP1', completeness: 'FULL', origin: 'search' })
    expect(JSON.stringify(descriptors)).not.toContain('secret claims text')
  })
})
