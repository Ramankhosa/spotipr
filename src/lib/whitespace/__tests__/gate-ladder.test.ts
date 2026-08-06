/**
 * The gate ladder is the product's central epistemic claim: a hypothesis is
 * only ever promoted by surviving searches that actually ran. The case pinned
 * hardest here is the one that used to leak — a vocabulary attack that could
 * NOT run being treated the same as a vocabulary attack survived.
 */

import { describe, expect, it } from 'vitest'
import { decideTypeAndStatus } from '../validate-stage'
import type { GateOutcome } from '../types'

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
