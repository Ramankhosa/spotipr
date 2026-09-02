/**
 * The gate ladder is the product's central epistemic claim: a hypothesis is
 * only ever promoted by surviving searches that actually ran. The case pinned
 * hardest here is the one that used to leak — a vocabulary attack that could
 * NOT run being treated the same as a vocabulary attack survived.
 */

import { describe, expect, it } from 'vitest'
import {
  applyMappingOutcomes,
  decideTypeAndStatus,
  selectMappingCandidates,
  type AttackHit,
  type MappedCandidate,
} from '../validate-stage'
import type { AttackRecord, GateOutcome } from '../types'

const gates = (overrides: Partial<Record<GateOutcome['gate'], GateOutcome['outcome']>>): GateOutcome[] => {
  const base: Record<GateOutcome['gate'], GateOutcome['outcome']> = {
    G1_DATA: 'PASSED',
    G2_TERMINOLOGY: 'PASSED',
    G3_ADJACENT_CLAIMS: 'PASSED',
    G4_FEASIBILITY: 'UNASSESSED',
    G5_COMMERCIAL: 'ADVISORY',
    G6_REGULATORY: 'ADVISORY',
  }
  return Object.entries({ ...base, ...overrides }).map(([gate, outcome]) => ({
    gate: gate as GateOutcome['gate'],
    outcome: outcome as GateOutcome['outcome'],
    basis: 'test',
  }))
}

describe('decideTypeAndStatus', () => {
  it('refutes outright when a family maps the full combination', () => {
    expect(decideTypeAndStatus({ gates: gates({}), fullRefutation: true, confidence: 0.9 })).toEqual({
      type: 'UNDETERMINED',
      status: 'REFUTED',
    })
  })

  it('stops at the first failing gate and types the hypothesis from it', () => {
    expect(decideTypeAndStatus({ gates: gates({ G1_DATA: 'FAILED' }), fullRefutation: false, confidence: 0.9 })).toEqual({
      type: 'DATA_WHITESPACE',
      status: 'INCONCLUSIVE',
    })
    expect(
      decideTypeAndStatus({ gates: gates({ G2_TERMINOLOGY: 'FAILED' }), fullRefutation: false, confidence: 0.9 })
    ).toEqual({ type: 'TERMINOLOGY_WHITESPACE', status: 'REFUTED' })
  })

  it('will not validate a claim gap when no vocabulary attack could run', () => {
    // The leak: G3 PASSED_WITH_WEAKENING returned VALIDATED unconditionally, so
    // a hypothesis whose synonym and paraphrase searches both failed to run was
    // promoted on the strength of searches that never happened.
    const unassessed = decideTypeAndStatus({
      gates: gates({ G2_TERMINOLOGY: 'UNASSESSED', G3_ADJACENT_CLAIMS: 'PASSED_WITH_WEAKENING' }),
      fullRefutation: false,
      confidence: 0.9,
    })
    expect(unassessed).toEqual({ type: 'CLAIM_WHITESPACE', status: 'INCONCLUSIVE' })

    // With the same evidence plus a vocabulary attack that DID run, it validates.
    const tested = decideTypeAndStatus({
      gates: gates({ G3_ADJACENT_CLAIMS: 'PASSED_WITH_WEAKENING' }),
      fullRefutation: false,
      confidence: 0.9,
    })
    expect(tested).toEqual({ type: 'CLAIM_WHITESPACE', status: 'VALIDATED' })
  })

  it('will not validate a sparse area either when the vocabulary gate went unassessed', () => {
    expect(
      decideTypeAndStatus({
        gates: gates({ G2_TERMINOLOGY: 'UNASSESSED' }),
        fullRefutation: false,
        confidence: 0.9,
      })
    ).toEqual({ type: 'PATENT_WHITESPACE', status: 'INCONCLUSIVE' })
  })

  it('reaches GENUINE only with every mandatory gate passed and high confidence', () => {
    const allPassed = gates({ G4_FEASIBILITY: 'PASSED' })
    expect(decideTypeAndStatus({ gates: allPassed, fullRefutation: false, confidence: 0.8 })).toEqual({
      type: 'GENUINE',
      status: 'VALIDATED',
    })
    // Same gates, confidence just under the bar — a candidate, not a verdict.
    expect(decideTypeAndStatus({ gates: allPassed, fullRefutation: false, confidence: 0.74 })).toEqual({
      type: 'PATENT_WHITESPACE',
      status: 'INCONCLUSIVE',
    })
  })
})

// ---------------------------------------------------------------------------
// Mapping-candidate selection and the unread-art rule. The leak these pin: the
// old "first 8 hits in insertion order" slice read only the first lexical
// attack's retrieval, every other attack's art went unread, and
// applyMappingOutcomes left those attacks CLEAN — survival credited to
// searches whose results nobody looked at.
// ---------------------------------------------------------------------------

const hit = (familyKey: string, publicationNumber: string): AttackHit => ({
  familyKey,
  publicationNumber,
  title: publicationNumber,
  abstract: null,
  claimsText: null,
  strategy: 'SYNONYM_SHIFTED',
})

/** Mirrors keyForAttack in validate-stage: strategy + NUL + query. */
const attackKey = (strategy: AttackRecord['strategy'], query: string) => `${strategy}\u0000${query}`

describe('selectMappingCandidates', () => {
  const fixture = () => {
    const allHits = new Map<string, AttackHit>()
    const byAttack = new Map<string, Set<string>>()
    const addAttack = (key: string, families: string[]) => {
      byAttack.set(key, new Set(families))
      for (const family of families) {
        if (!allHits.has(family)) allHits.set(family, hit(family, family.toUpperCase()))
      }
    }
    return { allHits, byAttack, addAttack }
  }

  it('takes the top hit of every attack before the second of any', () => {
    const { allHits, byAttack, addAttack } = fixture()
    addAttack('a', ['a1', 'a2', 'a3', 'a4'])
    addAttack('b', ['b1', 'b2'])
    addAttack('c', ['c1'])

    const chosen = selectMappingCandidates(byAttack, allHits, 5).map(entry => entry.familyKey)
    expect(chosen).toEqual(['a1', 'b1', 'c1', 'a2', 'b2'])
  })

  it('does not choose a family twice when attacks overlap, and stops at exhaustion', () => {
    const { allHits, byAttack, addAttack } = fixture()
    addAttack('a', ['f1', 'f2'])
    addAttack('b', ['f1', 'f3'])

    const chosen = selectMappingCandidates(byAttack, allHits, 10).map(entry => entry.familyKey)
    expect(chosen).toEqual(['f1', 'f2', 'f3'])
  })

  it('respects the limit', () => {
    const { allHits, byAttack, addAttack } = fixture()
    addAttack('a', ['a1', 'a2', 'a3'])
    addAttack('b', ['b1', 'b2', 'b3'])
    expect(selectMappingCandidates(byAttack, allHits, 4)).toHaveLength(4)
    expect(selectMappingCandidates(byAttack, allHits, 0)).toHaveLength(0)
  })
})

describe('applyMappingOutcomes', () => {
  const verdict = (
    publicationNumber: string,
    fullCombination: MappedCandidate['fullCombination']
  ): MappedCandidate => ({ publicationNumber, basis: 'claims', fullCombination, elements: [] })

  const world = () => {
    const allHits = new Map<string, AttackHit>([
      ['f1', hit('f1', 'P1')],
      ['f2', hit('f2', 'P2')],
      ['f3', hit('f3', 'P3')],
    ])
    const byAttack = new Map<string, Set<string>>([
      [attackKey('SYNONYM_SHIFTED', 'q1'), new Set(['f1', 'f2'])],
      [attackKey('CPC_ADJACENT', 'q2'), new Set(['f3'])],
      [attackKey('ASSIGNEE_PIVOT', 'q3'), new Set<string>()],
    ])
    const attacks: AttackRecord[] = [
      { strategy: 'SYNONYM_SHIFTED', query: 'q1', hits: 2, outcome: 'CLEAN' },
      { strategy: 'CPC_ADJACENT', query: 'q2', hits: 1, outcome: 'CLEAN' },
      // Ran and legitimately found nothing — CLEAN is the truth for this one.
      { strategy: 'ASSIGNEE_PIVOT', query: 'q3', hits: 0, outcome: 'CLEAN' },
      { strategy: 'LITERATURE', query: 'q4', hits: 0, outcome: 'NOT_RUN', reason: 'no provider' },
    ]
    return { allHits, byAttack, attacks }
  }

  it('marks an attack whose retrieved art was never mapped NOT_RUN instead of CLEAN', () => {
    const { allHits, byAttack, attacks } = world()
    applyMappingOutcomes(attacks, byAttack, allHits, [verdict('P1', 'PARTIAL')])

    expect(attacks[0].outcome).toBe('WEAKENING') // read: a PARTIAL among its hits
    expect(attacks[1].outcome).toBe('NOT_RUN') // retrieved 1 document, none read
    expect(attacks[1].reason).toContain('unread')
    expect(attacks[2].outcome).toBe('CLEAN') // zero hits is a genuine clean run
    expect(attacks[3].outcome).toBe('NOT_RUN') // untouched
    expect(attacks[3].reason).toBe('no provider')
  })

  it('propagates a PRESENT verdict to REFUTING on the retrieving attack', () => {
    const { allHits, byAttack, attacks } = world()
    applyMappingOutcomes(attacks, byAttack, allHits, [verdict('P2', 'PRESENT'), verdict('P3', 'ABSENT')])

    expect(attacks[0].outcome).toBe('REFUTING')
    // ABSENT is still a READ verdict: the CPC attack stays CLEAN, not unread.
    expect(attacks[1].outcome).toBe('CLEAN')
  })

  it('keeps unread attacks excluded from the terminology gate the ladder reads', () => {
    // End to end through decideTypeAndStatus semantics: an unread expansion
    // attack must not count as vocabulary tested, so a weakened G3 cannot
    // reach VALIDATED on its strength.
    const { allHits, byAttack, attacks } = world()
    applyMappingOutcomes(attacks, byAttack, allHits, [verdict('P3', 'PARTIAL')])
    // Only the CPC attack was read; the synonym attack is unread → NOT_RUN.
    expect(attacks[0].outcome).toBe('NOT_RUN')
    const expansionRan = attacks.some(
      attack =>
        (attack.strategy === 'SYNONYM_SHIFTED' || attack.strategy === 'SEMANTIC_PARAPHRASE') &&
        attack.outcome !== 'NOT_RUN'
    )
    expect(expansionRan).toBe(false)
  })
})
