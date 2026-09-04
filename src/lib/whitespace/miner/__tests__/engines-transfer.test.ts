/**
 * The transfer engine's gate.
 *
 * Its central claim is an ABSENCE — "this mechanism appears nowhere in the
 * field" — which is the claim most easily faked by not looking. Every refusal
 * in here exists because the corresponding pass would be a lie of a different
 * shape.
 */
import { describe, expect, it } from 'vitest'
import {
  DERIVED_SUBCLASS_COVERAGE,
  enablingCondition,
  gateTransferCandidate,
  MIN_READABLE_FIELD_SHARE,
  NO_SUBCLASS_SKIP,
  readableShareSkip,
  resolveFieldSubclasses,
  sharesFieldSubclass,
  subclassesFromCensus,
  subclassesFromScope,
} from '../engines/transfer'
import type { LabelledCount, ScopeClassification } from '../../types'

const classification = (code: string, accepted: boolean): ScopeClassification => ({
  code,
  origin: 'user',
  accepted,
})
const facet = (label: string, families: number): LabelledCount => ({ label, families })

// ---------------------------------------------------------------------------
// The field's subclass set
// ---------------------------------------------------------------------------

describe('subclassesFromScope', () => {
  it('uses only the classifications the user ACCEPTED', () => {
    expect(
      subclassesFromScope([
        classification('A61K9/20', true),
        classification('G06F16/00', false),
        classification('A61P1/00', true),
      ])
    ).toEqual(['A61K', 'A61P'])
  })

  it('normalises spacing the way the census does', () => {
    expect(subclassesFromScope([classification('A01G 25/16', true)])).toEqual(['A01G'])
  })

  it('is empty when the scope declares nothing, so the caller falls through', () => {
    expect(subclassesFromScope([])).toEqual([])
    expect(subclassesFromScope(undefined)).toEqual([])
  })
})

describe('subclassesFromCensus', () => {
  it('takes the subclasses covering 80% of the field’s families, biggest first', () => {
    const derived = subclassesFromCensus(
      [facet('A61K9/20', 500), facet('A61P1/00', 300), facet('B01D3/00', 5), facet('G06F16/00', 2)],
      1_000
    )
    expect(derived).toEqual(['A61K', 'A61P'])
    expect(DERIVED_SUBCLASS_COVERAGE).toBe(0.8)
  })

  it('is empty with no facet, or no family total, rather than guessing', () => {
    expect(subclassesFromCensus([], 1_000)).toEqual([])
    expect(subclassesFromCensus([facet('A61K9/20', 500)], 0)).toEqual([])
  })
})

describe('resolveFieldSubclasses', () => {
  it('prefers the scope’s own classifications and adds no note', () => {
    const resolved = resolveFieldSubclasses({
      scopeClassifications: [classification('A61K9/20', true)],
      censusClassifications: [facet('G06F16/00', 900)],
      familyCount: 1_000,
    })
    expect(resolved).toMatchObject({ subclasses: ['A61K'], source: 'scope', note: null })
  })

  it('falls back to the census and SAYS SO — "outside" is only outside in a derived sense', () => {
    const resolved = resolveFieldSubclasses({
      scopeClassifications: [],
      censusClassifications: [facet('A61K9/20', 900)],
      familyCount: 1_000,
    })
    expect(resolved?.source).toBe('field-map')
    expect(resolved?.note).toContain('declares no classifications')
    expect(resolved?.note).toContain('A61K')
  })

  it('returns null when neither source produced a set, and the skip reason names the fix', () => {
    expect(resolveFieldSubclasses({ familyCount: 1_000 })).toBeNull()
    expect(NO_SUBCLASS_SKIP).toContain('Add CPC classifications to the scope')
  })
})

describe('sharesFieldSubclass', () => {
  it('is true when any classification matches the field', () => {
    expect(sharesFieldSubclass(['A61K9/20', 'B01D3/00'], ['A61K'])).toBe(true)
  })

  it('is false for a genuinely foreign publication', () => {
    expect(sharesFieldSubclass(['G06N3/08'], ['A61K', 'A61P'])).toBe(false)
  })

  it('treats EVERYTHING as inside the field when the field has no definition', () => {
    // Fail-closed: with no subclass set, nothing can honestly be called
    // "outside this field", so the engine finds no candidates rather than
    // treating every publication as one.
    expect(sharesFieldSubclass(['G06N3/08'], [])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The candidate gate
// ---------------------------------------------------------------------------

describe('gateTransferCandidate', () => {
  const admissible = {
    targetHeadNoun: 'degradation',
    sourceHeadNoun: 'delamination',
    nearestInFieldMechanismDistance: 0.8,
    cut: 0.35,
    fieldTermHits: { hits: 0, countedFamilies: 3_200 },
  }

  it('admits a candidate that clears every measured condition', () => {
    const gate = gateTransferCandidate(admissible)
    expect(gate.admitted).toBe(true)
    expect(gate.detail).toContain('3,200 field families')
  })

  it('refuses a category error: a process problem and a device problem are not the same problem', () => {
    const gate = gateTransferCandidate({ ...admissible, sourceHeadNoun: 'sensor' })
    expect(gate).toMatchObject({ admitted: false, refusal: 'different-object-class' })
    expect(gate.detail).toContain('category error')
  })

  // This rule was inverted after the first live run. Passing an unclassified
  // pair — on the reasoning that a failed classification is not evidence of
  // difference — meant most candidates were admitted with both classes
  // 'unknown', and the leads that reached the top included a surgical tissue
  // glue and a UV-spectrophotometric assay offered against a gastric-retention
  // problem. A transfer has to be shown to be a transfer; not-provably-wrong is
  // the same shape as the unmeasured absence this module already refuses.
  it('refuses an UNKNOWN class: a pair it cannot classify is not a pair it has matched', () => {
    const unreadableSource = gateTransferCandidate({ ...admissible, sourceHeadNoun: 'zzz' })
    expect(unreadableSource).toMatchObject({ admitted: false, refusal: 'object-class-unknown' })
    expect(unreadableSource.detail).toContain('sit near each other')
    expect(gateTransferCandidate({ ...admissible, targetHeadNoun: null }).admitted).toBe(false)
  })

  it('refuses when the field already holds a mechanism inside the cut', () => {
    const gate = gateTransferCandidate({ ...admissible, nearestInFieldMechanismDistance: 0.2 })
    expect(gate).toMatchObject({ admitted: false, refusal: 'already-in-field-by-vector' })
  })

  it('refuses when the mechanism’s terms already appear in the field', () => {
    const gate = gateTransferCandidate({
      ...admissible,
      fieldTermHits: { hits: 7, countedFamilies: 3_200 },
    })
    expect(gate).toMatchObject({ admitted: false, refusal: 'already-in-field-by-terms' })
    expect(gate.detail).toContain('7 of 3,200')
  })

  it('treats an UNMEASURED vector comparison as a refusal, never as a pass', () => {
    const gate = gateTransferCandidate({ ...admissible, nearestInFieldMechanismDistance: null })
    expect(gate).toMatchObject({ admitted: false, refusal: 'not-measured' })
  })

  it('treats an UNMEASURED term count as a refusal, never as zero hits', () => {
    const gate = gateTransferCandidate({ ...admissible, fieldTermHits: null })
    expect(gate).toMatchObject({ admitted: false, refusal: 'not-measured' })
    expect(gate.detail).toContain('never established')
  })
})

// ---------------------------------------------------------------------------
// The hard skip
// ---------------------------------------------------------------------------

describe('the readable-text skip', () => {
  it('explains that a zero over no text is guaranteed rather than a finding', () => {
    const reason = readableShareSkip(200, 4_000)
    expect(reason).toContain('200 of 4,000 families')
    expect(reason).toContain('5%')
    expect(reason).toContain('guaranteed for every mechanism')
    expect(reason).toContain('about our corpus, not about the technology')
  })

  it('sets the floor at 20%', () => {
    expect(MIN_READABLE_FIELD_SHARE).toBe(0.2)
  })
})

describe('enablingCondition', () => {
  it('names the condition rather than leaving the gate to invent one', () => {
    const condition = enablingCondition({
      mechanism: 'a swellable crosslinked matrix',
      sourceSubclasses: ['C08J'],
      targetSubclasses: ['A61K'],
    })
    expect(condition).toContain('holds only if a swellable crosslinked matrix')
    expect(condition).toContain('C08J')
    expect(condition).toContain('A61K')
    expect(condition).toContain('nothing we measured tests it here')
  })

  it('still reads correctly with no classifications on either side', () => {
    const condition = enablingCondition({ mechanism: 'x', sourceSubclasses: [], targetSubclasses: [] })
    expect(condition).toContain('another classification')
    expect(condition).toContain('this field')
  })
})
