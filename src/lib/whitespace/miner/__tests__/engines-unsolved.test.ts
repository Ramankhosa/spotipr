/**
 * The product's headline number.
 *
 * `unsolved = 1 − addressing/admitting`, so every family that answers the
 * problem and is MISSED pushes it towards 1.0. The labelled fixture in here is
 * the regression guard: it is a set of real-shaped mechanism texts where the
 * lexical arm misses and the vector arm catches, and it fails loudly if anyone
 * ever reduces the addressing test to string containment.
 */
import { describe, expect, it } from 'vitest'
import {
  absenceSentence,
  carriesDomainNoun,
  checkExclusions,
  containsHeadNoun,
  decideAddressing,
  GENRE_CONVENTION_SHARE,
  headNounClass,
  keyTerms,
  problemHeadNoun,
  rankUnsolved,
  singularise,
  summariseAddressing,
  WIDELY_DISCUSSED_SHARE,
  type AddressingCandidate,
} from '../engines/unsolved'
import { describeRate, lowerWilsonBound, wilsonInterval } from '../engines/wilson'

// ---------------------------------------------------------------------------
// Wilson
// ---------------------------------------------------------------------------

describe('wilsonInterval', () => {
  it('never collapses at p = 1, which the normal approximation does', () => {
    const one = wilsonInterval(1, 1)
    expect(one.point).toBe(1)
    // The normal interval here is [1, 1] — a certainty from one observation.
    expect(one.lower).toBeLessThan(0.3)
    expect(one.upper).toBe(1)
  })

  it('tightens as evidence accumulates, so 180/200 outranks 1/1', () => {
    expect(lowerWilsonBound(180, 200)).toBeGreaterThan(lowerWilsonBound(1, 1))
    expect(lowerWilsonBound(9, 10)).toBeLessThan(lowerWilsonBound(90, 100))
  })

  it('matches the hand-computed value for 1 of 2', () => {
    // centre = (0.5 + 1.9207) / (1 + 1.9207) = 0.5 exactly; half-width from the
    // score inversion is ~0.4551.
    const interval = wilsonInterval(1, 2)
    expect(interval.point).toBe(0.5)
    expect(interval.lower).toBeCloseTo(0.0945, 3)
    expect(interval.upper).toBeCloseTo(0.9055, 3)
  })

  it('is the whole unit line at zero trials — nothing observed is not zero probability', () => {
    expect(wilsonInterval(0, 0)).toMatchObject({ point: 0, lower: 0, upper: 1 })
  })

  it('clamps successes to trials rather than reporting a rate above 1', () => {
    expect(wilsonInterval(5, 3).point).toBe(1)
  })

  it('stays inside [0, 1] for the boundary cases', () => {
    for (const [k, n] of [[0, 1], [0, 5], [5, 5], [1, 3]]) {
      const interval = wilsonInterval(k, n)
      expect(interval.lower).toBeGreaterThanOrEqual(0)
      expect(interval.upper).toBeLessThanOrEqual(1)
      expect(interval.lower).toBeLessThanOrEqual(interval.upper)
    }
  })
})

describe('describeRate', () => {
  it('puts the denominator inside the sentence so it cannot be printed without it', () => {
    expect(describeRate('Addressed', wilsonInterval(3, 12))).toContain('3 of 12 families')
    expect(describeRate('Addressed', wilsonInterval(3, 12))).toContain('95% interval')
  })

  it('says "not measured" rather than "0%" when nothing was observed', () => {
    expect(describeRate('Addressed', wilsonInterval(0, 0))).toContain('not measured')
  })
})

// ---------------------------------------------------------------------------
// Reading a problem statement
// ---------------------------------------------------------------------------

describe('problemHeadNoun', () => {
  it('takes the head of the noun phrase, before the first preposition', () => {
    expect(problemHeadNoun('burst release from a gastroretentive matrix')).toBe('release')
    expect(problemHeadNoun('uneven airflow in known tray dryers')).toBe('airflow')
    expect(problemHeadNoun('cold-start recommendations for new users')).toBe('recommendation')
  })

  it('skips the generic vocabulary every background uses', () => {
    // "a known drawback" is entirely generic, so the head is read from what the
    // statement is actually about: the head of "airflow distribution".
    expect(problemHeadNoun('a known drawback of existing airflow distribution')).toBe('distribution')
  })

  it('resolves to the prior art, not the fault, when the sentence opens with the art', () => {
    // A KNOWN LIMITATION, and the reason the addressing test is a union: the
    // lexical arm searches for "dryer" here when the fault is the airflow.
    expect(problemHeadNoun('known dryers suffer from uneven airflow')).toBe('dryer')
  })

  it('falls back past the first breaker rather than returning nothing', () => {
    expect(problemHeadNoun('there remains a need for uniform airflow')).toBe('airflow')
  })

  it('returns null when the statement names no technology at all', () => {
    expect(problemHeadNoun('the known method has a cost drawback')).toBeNull()
  })
})

describe('singularise / keyTerms', () => {
  it('collapses the regular plurals a head noun actually meets', () => {
    expect(singularise('releases')).toBe('release')
    expect(singularise('dryers')).toBe('dryer')
    expect(singularise('bodies')).toBe('body')
    expect(singularise('branches')).toBe('branch')
    expect(singularise('gas')).toBe('gas')
    expect(singularise('glass')).toBe('glass')
  })

  it('leaves irregular plurals alone rather than mangling the regular ones', () => {
    // Documented, not accidental: handling "-ices" would turn "devices" into
    // "devix". An under-matching lexical arm costs a lexical hit the vector arm
    // still catches; an over-matching one lowers the unsolved rate invisibly.
    expect(singularise('matrices')).toBe('matrice')
    expect(singularise('devices')).toBe('device')
  })

  it('returns the longest specific terms, generics removed', () => {
    // Longest first; equal lengths break alphabetically so a re-run orders the
    // same terms the same way and the whole-field count is reproducible.
    expect(keyTerms('the known drawback of uneven airflow distribution in dryers', 3)).toEqual([
      'distribution',
      'airflow',
      'dryers',
    ])
  })
})

describe('carriesDomainNoun', () => {
  it('rejects a medoid made only of the genre’s own vocabulary', () => {
    expect(carriesDomainNoun('improve efficiency')).toBe(false)
    expect(carriesDomainNoun('reduce cost and complexity')).toBe(false)
    expect(carriesDomainNoun('the prior art has a drawback')).toBe(false)
  })

  it('accepts anything naming an actual technology', () => {
    expect(carriesDomainNoun('improve the efficiency of the perforated tray')).toBe(true)
    expect(carriesDomainNoun('burst release')).toBe(true)
  })
})

describe('headNounClass', () => {
  it('classifies morphologically, so it works on any field’s vocabulary', () => {
    expect(headNounClass('degradation')).toBe('process')
    expect(headNounClass('sensor')).toBe('device')
    expect(headNounClass('conductivity')).toBe('property')
    expect(headNounClass('polymer')).toBe('substance')
  })

  it('does not let a bare -er ending claim a substance, or -al claim a process', () => {
    // Both were live bugs: `er$` matched "polymer", `al$` matched "material".
    expect(headNounClass('polymer')).not.toBe('device')
    expect(headNounClass('material')).not.toBe('process')
  })

  it('answers "unknown" rather than guessing, so the transfer veto stays a veto', () => {
    expect(headNounClass('')).toBe('unknown')
    expect(headNounClass(null)).toBe('unknown')
    // A deverbal noun with no suffix marker. Morphology cannot see it, so the
    // class is unknown — and an unknown class never vetoes a transfer.
    expect(headNounClass('release')).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// THE ADDRESSING UNION — the regression guard
// ---------------------------------------------------------------------------

/**
 * A labelled fixture. Every family here DOES answer "burst release", by hand
 * inspection; the question is which arm of the test notices.
 *
 * The four with `nearestMechanismDistance` inside the cut and no shared token
 * are the real ones: patent drafting names the problem in the background and
 * the solution in the embodiments, and the two share no vocabulary on purpose.
 */
const CUT = 0.35
const HEAD_NOUN = 'release'

const FIXTURE: Array<AddressingCandidate & { label: string; trulyAddresses: boolean }> = [
  {
    label: 'says the word — lexical and vector both fire',
    familyKey: 'f1',
    mechanismTexts: ['a coating that slows the release of the active'],
    claimElements: [],
    nearestMechanismDistance: 0.2,
    trulyAddresses: true,
  },
  {
    label: 'says the word in a CLAIM element only',
    familyKey: 'f2',
    mechanismTexts: ['an outer barrier layer'],
    claimElements: ['sustained release core'],
    nearestMechanismDistance: 0.9,
    trulyAddresses: true,
  },
  {
    label: 'swellable crosslinked matrix — no shared token, vector catches it',
    familyKey: 'f3',
    mechanismTexts: ['a swellable crosslinked polymer matrix retaining the active in the stomach'],
    claimElements: ['crosslinked matrix'],
    nearestMechanismDistance: 0.18,
    trulyAddresses: true,
  },
  {
    label: 'osmotic push-pull core — no shared token, vector catches it',
    familyKey: 'f4',
    mechanismTexts: ['an osmotic push-pull core with a laser-drilled orifice'],
    claimElements: ['semipermeable membrane'],
    nearestMechanismDistance: 0.22,
    trulyAddresses: true,
  },
  {
    label: 'lipid multiparticulates — no shared token, vector catches it',
    familyKey: 'f5',
    mechanismTexts: ['lipid multiparticulates dispersed in a hydrophilic carrier'],
    claimElements: [],
    nearestMechanismDistance: 0.3,
    trulyAddresses: true,
  },
  {
    label: 'ion-exchange resinate — no shared token, vector catches it',
    familyKey: 'f6',
    mechanismTexts: ['a drug–ion-exchange resinate complex'],
    claimElements: [],
    nearestMechanismDistance: 0.34,
    trulyAddresses: true,
  },
  {
    label: 'genuinely unrelated mechanism — neither arm fires, and it should not',
    familyKey: 'f7',
    mechanismTexts: ['a tamper-evident blister foil'],
    claimElements: ['foil lidding'],
    nearestMechanismDistance: 0.8,
    trulyAddresses: false,
  },
  {
    label: 'no mechanism vector at all — an absence of measurement, never "beyond the cut"',
    familyKey: 'f8',
    mechanismTexts: [],
    claimElements: [],
    nearestMechanismDistance: null,
    trulyAddresses: false,
  },
]

describe('the addressing union', () => {
  it('LEXICAL ALONE misses four of the six families that really answer the problem', () => {
    const lexicalOnly = FIXTURE.filter(
      family => containsHeadNoun(family.mechanismTexts, HEAD_NOUN) || containsHeadNoun(family.claimElements, HEAD_NOUN)
    )
    expect(lexicalOnly.map(family => family.familyKey)).toEqual(['f1', 'f2'])

    const trulyAddressing = FIXTURE.filter(family => family.trulyAddresses)
    expect(trulyAddressing).toHaveLength(6)

    // The consequence, spelled out: a lexical-only engine reports 6 of 8
    // unsolved when the truth is 2 of 8. It does not fail safe — it inflates.
    const lexicalUnsolved = (FIXTURE.length - lexicalOnly.length) / FIXTURE.length
    const trueUnsolved = (FIXTURE.length - trulyAddressing.length) / FIXTURE.length
    expect(lexicalUnsolved).toBeCloseTo(0.75, 5)
    expect(trueUnsolved).toBeCloseTo(0.25, 5)
    expect(lexicalUnsolved).toBeGreaterThan(trueUnsolved)
  })

  it('THE UNION recovers every family the fixture labels as addressing', () => {
    const summary = summariseAddressing(FIXTURE, HEAD_NOUN, CUT)
    expect(summary.admitting).toBe(8)
    expect(summary.addressing).toBe(6)
    expect(summary.verdicts.filter(verdict => verdict.addressing).map(verdict => verdict.familyKey)).toEqual(
      FIXTURE.filter(family => family.trulyAddresses).map(family => family.familyKey)
    )
  })

  it('reports exactly how many the vector arm rescued — the number a lexical-only engine would have lost', () => {
    const summary = summariseAddressing(FIXTURE, HEAD_NOUN, CUT)
    expect(summary.lexicalOnly).toBe(2)
    expect(summary.vectorOnly).toBe(5)
    expect(summary.caughtOnlyByVector).toBe(4)
  })

  it('counts a family with no mechanism vector as unmeasured, never as beyond the cut', () => {
    const summary = summariseAddressing(FIXTURE, HEAD_NOUN, CUT)
    expect(summary.withoutMechanismVector).toBe(1)
    const verdict = summary.verdicts.find(entry => entry.familyKey === 'f8')
    expect(verdict).toMatchObject({ addressing: false, byVector: false, byLexical: false })
  })

  it('can only ever LOWER the unsolved rate relative to either arm alone', () => {
    const summary = summariseAddressing(FIXTURE, HEAD_NOUN, CUT)
    expect(summary.addressing).toBeGreaterThanOrEqual(summary.lexicalOnly)
    expect(summary.addressing).toBeGreaterThanOrEqual(summary.vectorOnly)
  })

  it('matches the head noun on a whole token and its plural, not on a substring', () => {
    expect(containsHeadNoun(['controlled releases of the active'], 'release')).toBe(true)
    // "released" is a different token; substring matching would fire here.
    expect(containsHeadNoun(['the drug is releasable'], 'release')).toBe(false)
    expect(containsHeadNoun(['a pressure relief valve'], 'release')).toBe(false)
  })

  it('falls back to the vector arm alone when no head noun could be read', () => {
    const verdict = decideAddressing(FIXTURE[2], null, CUT)
    expect(verdict).toMatchObject({ byLexical: false, byVector: true, addressing: true })
  })
})

// ---------------------------------------------------------------------------
// Exclusions — hard, not a rank penalty
// ---------------------------------------------------------------------------

describe('checkExclusions', () => {
  const base = { medoidText: 'burst release from a gastroretentive matrix', admitting: 10, sampledFamilies: 100 }

  it('drops a genre convention on the SHARE of families that admit it', () => {
    const verdict = checkExclusions({
      ...base,
      admitting: Math.ceil(100 * GENRE_CONVENTION_SHARE) + 1,
      widelyDiscussed: null,
    })
    expect(verdict).toMatchObject({ excluded: true, reason: 'genreConvention' })
    // The measurement is in the detail, so the user sees what was found as well
    // as why it was dropped.
    expect(verdict.detail).toMatch(/of 100 families/)
  })

  it('keeps a problem admitted by a minority of the field', () => {
    expect(checkExclusions({ ...base, widelyDiscussed: null }).excluded).toBe(false)
  })

  it('drops a widely-discussed problem on the whole-field term count', () => {
    const hits = Math.ceil(1_000 * WIDELY_DISCUSSED_SHARE) + 1
    const verdict = checkExclusions({ ...base, widelyDiscussed: { hits, countedFamilies: 1_000 } })
    expect(verdict).toMatchObject({ excluded: true, reason: 'widelyDiscussed' })
    expect(verdict.detail).toContain('1,000 readable field families')
  })

  it('records an UNMEASURED term count as unmeasured, never as a pass', () => {
    const verdict = checkExclusions({ ...base, widelyDiscussed: null })
    expect(verdict.excluded).toBe(false)
    expect(verdict.detail).toContain('did not run')
  })

  it('rejects a medoid that names no technology, before anything else is measured', () => {
    const verdict = checkExclusions({
      medoidText: 'improve efficiency and reduce cost',
      admitting: 4,
      sampledFamilies: 500,
      widelyDiscussed: { hits: 0, countedFamilies: 500 },
    })
    expect(verdict).toMatchObject({ excluded: true, reason: 'noDomainNoun' })
  })
})

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

describe('rankUnsolved', () => {
  it('ranks the Wilson LOWER bound, so one family cannot outrank two hundred', () => {
    const anecdote = rankUnsolved({ admitting: 1, addressing: 0, recentShare: 1, assigneeSpread: 1 })
    const measured = rankUnsolved({ admitting: 200, addressing: 20, recentShare: 1, assigneeSpread: 1 })
    expect(measured.score).toBeGreaterThan(anecdote.score)
  })

  it('rewards recency by at most 2x and never to zero', () => {
    const stale = rankUnsolved({ admitting: 40, addressing: 0, recentShare: 0, assigneeSpread: 9 })
    const live = rankUnsolved({ admitting: 40, addressing: 0, recentShare: 1, assigneeSpread: 9 })
    expect(stale.score).toBeGreaterThan(0)
    expect(live.score / stale.score).toBeCloseTo(3, 5)
  })

  it('damps assignee spread with a square root', () => {
    const one = rankUnsolved({ admitting: 40, addressing: 0, recentShare: 0.5, assigneeSpread: 1 })
    const four = rankUnsolved({ admitting: 40, addressing: 0, recentShare: 0.5, assigneeSpread: 4 })
    expect(four.score / one.score).toBeCloseTo(2, 5)
  })

  it('scores zero when one applicant’s house style is the whole signal', () => {
    expect(rankUnsolved({ admitting: 40, addressing: 0, recentShare: 1, assigneeSpread: 0 }).score).toBe(0)
  })

  it('carries the interval, not just the point estimate', () => {
    const rank = rankUnsolved({ admitting: 20, addressing: 5, recentShare: 0.5, assigneeSpread: 4 })
    expect(rank.unsolved.successes).toBe(15)
    expect(rank.unsolved.trials).toBe(20)
    expect(rank.unsolved.lower).toBeLessThan(rank.unsolved.point)
  })
})

// ---------------------------------------------------------------------------
// The absence sentence
// ---------------------------------------------------------------------------

describe('absenceSentence', () => {
  const sentence = absenceSentence({
    object: '“burst release”',
    searchedFamilies: 12,
    ofFieldFamilies: 4_310,
    tier: 'description-5k',
  })

  it('says what was measured, with both denominators inside the sentence', () => {
    expect(sentence).toContain('No mechanism in the readable text of these families is directed at “burst release”')
    expect(sentence).toContain('searched 12 of 4,310 families')
    expect(sentence).toContain('description-5k')
  })

  it('never says "unsolved" and never says "no patent does X"', () => {
    expect(sentence.toLowerCase()).not.toContain('unsolved')
    expect(sentence.toLowerCase()).not.toContain('no patent')
  })
})
