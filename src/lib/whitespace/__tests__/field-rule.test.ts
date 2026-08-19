import { describe, expect, it } from 'vitest'
import {
  chooseRung,
  fieldRuleNote,
  ladderRungs,
  narrowingAdviceFor,
  rungPhrase,
  trivialFieldRule,
  wideningAdviceFor,
  type RungMeasurement,
} from '../field-rule'
import { combinationCount, rungIsCompilable, scopeIsRunnable, MAX_RUNG_COMBINATIONS } from '../scope-schema'
import { emptyWhitespaceScope, type FieldRule } from '../types'

const band = { minFamilies: 500, maxPublications: 120_000 }
const rung = (k: number, families: number, extra: Partial<RungMeasurement> = {}): RungMeasurement => ({
  minimumOptional: k,
  publications: families,
  families,
  overCap: false,
  timedOut: false,
  ...extra,
})

describe('chooseRung', () => {
  it('takes the TIGHTEST rung inside the band', () => {
    // ≥4: 3, ≥3: 812 (in band), ≥2 not measured — the fit stops here.
    const decision = chooseRung([rung(4, 3), rung(3, 812)], band)
    expect(decision).toEqual({ minimumOptional: 3, fit: 'in-band' })
  })

  it('reports too-narrow at the loosest rung when nothing reaches the floor', () => {
    const decision = chooseRung([rung(3, 0), rung(2, 6), rung(1, 237)], band)
    expect(decision).toEqual({ minimumOptional: 1, fit: 'too-narrow' })
  })

  it('reports too-broad at the tightest rung when even it crosses the ceiling', () => {
    const decision = chooseRung([rung(3, 120_001, { overCap: true })], band)
    expect(decision).toEqual({ minimumOptional: 3, fit: 'too-broad' })
  })

  it('a timeout counts as over the ceiling', () => {
    const decision = chooseRung([rung(2, 0, { timedOut: true, overCap: true })], band)
    expect(decision).toEqual({ minimumOptional: 2, fit: 'too-broad' })
  })

  it('names a cliff and runs the tighter, countable rung', () => {
    // ≥2: 40 families (under the floor), ≥1: over the ceiling.
    const decision = chooseRung([rung(2, 40), rung(1, 120_001, { overCap: true })], band)
    expect(decision).toEqual({ minimumOptional: 2, fit: 'cliff' })
  })
})

describe('ladderRungs', () => {
  it('lists rungs tightest first and skips the ones that cannot be compiled', () => {
    expect(ladderRungs(0, 4, () => true)).toEqual([4, 3, 2, 1, 0])
    expect(ladderRungs(1, 10, k => rungIsCompilable(10, k))).toEqual([10, 9, 8, 2, 1])
  })
})

describe('combination cap', () => {
  it('bounds a rung to MAX_RUNG_COMBINATIONS index scans', () => {
    expect(combinationCount(8, 4)).toBe(70)
    expect(rungIsCompilable(8, 4)).toBe(true)
    expect(combinationCount(9, 4)).toBe(126)
    expect(rungIsCompilable(9, 4)).toBe(false)
    expect(rungIsCompilable(24, 0)).toBe(true)
    expect(MAX_RUNG_COMBINATIONS).toBe(70)
  })

  it('refuses a pinned rule the concept list cannot express, where the user can still change it', () => {
    const scope = emptyWhitespaceScope()
    scope.concepts = Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, label: `c${i}`, synonyms: [], required: false, origin: 'user' as const }))
    scope.matching = { minimumOptionalConcepts: 5 }
    expect(scopeIsRunnable(scope).runnable).toBe(false)
    expect(scopeIsRunnable(scope).reason).toMatch(/only 3 are optional/)

    scope.matching = { minimumOptionalConcepts: 2 }
    expect(scopeIsRunnable(scope).runnable).toBe(true)

    scope.concepts = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, label: `c${i}`, synonyms: [], required: false, origin: 'user' as const }))
    scope.matching = { minimumOptionalConcepts: 5 }
    expect(scopeIsRunnable(scope).reason).toMatch(/too many concept combinations/)
  })
})

describe('trivialFieldRule', () => {
  const counts = { requiredCount: 1, optionalCount: 3 }
  it('pins when the scope says so', () => {
    const scope = emptyWhitespaceScope()
    scope.matching = { minimumOptionalConcepts: 2 }
    expect(trivialFieldRule(scope, counts, band)).toMatchObject({ mode: 'pinned', minimumOptional: 2, fit: 'pinned' })
  })
  it('clamps a pinned value into the expressible range', () => {
    const scope = emptyWhitespaceScope()
    scope.matching = { minimumOptionalConcepts: 9 }
    expect(trivialFieldRule(scope, counts, band)?.minimumOptional).toBe(3)
  })
  it('has nothing to fit with no optional concepts, or with only one rung', () => {
    expect(trivialFieldRule(emptyWhitespaceScope(), { requiredCount: 2, optionalCount: 0 }, band)).toMatchObject({
      mode: 'auto',
      minimumOptional: 0,
      fit: 'none',
    })
    expect(trivialFieldRule(emptyWhitespaceScope(), { requiredCount: 0, optionalCount: 1 }, band)).toMatchObject({
      minimumOptional: 1,
      fit: 'none',
    })
  })
  it('returns null when there is a ladder to climb', () => {
    expect(trivialFieldRule(emptyWhitespaceScope(), counts, band)).toBeNull()
  })
})

describe('words', () => {
  const rule: FieldRule = {
    mode: 'auto',
    requiredCount: 1,
    optionalCount: 4,
    minimumOptional: 3,
    fit: 'in-band',
    band,
    ladder: [
      { minimumOptional: 4, publications: 3, families: 3, overCap: false, timedOut: false, skipped: false },
      { minimumOptional: 3, publications: 900, families: 812, overCap: false, timedOut: false, skipped: false },
      { minimumOptional: 2, publications: null, families: null, overCap: false, timedOut: false, skipped: true },
      { minimumOptional: 1, publications: null, families: null, overCap: false, timedOut: false, skipped: true },
      { minimumOptional: 0, publications: null, families: null, overCap: false, timedOut: false, skipped: true },
    ],
  }

  it('phrases rungs the way the UI does', () => {
    expect(rungPhrase(rule, 3)).toBe('at least 3 of the 4 other concepts')
    expect(rungPhrase(rule, 4)).toBe('all 4 other concepts')
    expect(rungPhrase(rule, 0)).toBe('any number of the 4 other concepts (none need appear)')
    expect(rungPhrase({ requiredCount: 0, optionalCount: 2 }, 1)).toBe('at least 1 of the 2 concepts')
    expect(rungPhrase({ requiredCount: 0, optionalCount: 1 }, 1)).toBe('the concept')
  })

  it('states the rule, how it was decided, and every measured rung', () => {
    const note = fieldRuleNote(rule)
    expect(note).toContain('every must-appear concept (1) and at least 3 of the 4 other concepts')
    expect(note).toContain('auto-fitted')
    expect(note).toContain('≥4 of 4: 3 families')
    expect(note).toContain('≥3 of 4: 812 families (used)')
    // Skipped rungs are not listed as measurements.
    expect(note).not.toContain('not measured')
  })

  it('narrowing advice names the measured tighter rung instead of "mark more concepts required"', () => {
    const scope = emptyWhitespaceScope()
    scope.concepts = [{ id: 'a', label: 'a', synonyms: [], required: true, origin: 'user' }]
    const broad: FieldRule = { ...rule, minimumOptional: 2, fit: 'cliff' }
    expect(narrowingAdviceFor(scope, broad)).toContain('set the match rule to at least 3 of the 4 other concepts (812 families measured)')
    expect(narrowingAdviceFor(scope, broad)).not.toContain('mark more concepts as required')

    const hopeless: FieldRule = { ...rule, minimumOptional: 4, fit: 'too-broad', ladder: [] }
    expect(narrowingAdviceFor(scope, hopeless)).toContain('Even requiring every concept')
  })

  it('widening advice distinguishes a pinned rule from concepts that simply do not reach', () => {
    const scope = emptyWhitespaceScope()
    scope.concepts = [{ id: 'a', label: 'a', synonyms: [], required: true, origin: 'user' }]
    const pinned: FieldRule = { ...rule, mode: 'pinned', fit: 'pinned', minimumOptional: 3 }
    expect(wideningAdviceFor(scope, pinned)).toContain('pinned at at least 3 of the 4 other concepts')

    const narrow: FieldRule = { ...rule, minimumOptional: 0, fit: 'too-narrow' }
    expect(wideningAdviceFor(scope, narrow)).toMatch(/^Even any number of the 4 other concepts/)
    expect(wideningAdviceFor(scope, narrow)).toContain('make the must-appear concept optional')

    const cliff: FieldRule = {
      ...rule,
      minimumOptional: 2,
      fit: 'cliff',
      ladder: [
        { minimumOptional: 2, publications: 40, families: 40, overCap: false, timedOut: false, skipped: false },
        { minimumOptional: 1, publications: 120_001, families: 0, overCap: true, timedOut: false, skipped: false },
      ],
    }
    // Number formatting is locale-dependent (en-IN prints 1,20,000), so match around it.
    expect(wideningAdviceFor(scope, cliff)).toMatch(
      /next looser rung \(at least 1 of the 4 other concepts\) matches more than [\d,]+ publications/
    )
  })
})
