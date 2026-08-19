import { describe, expect, it } from 'vitest'
import {
  buildConceptQuery,
  buildScopeFilter,
  combinations,
  conceptQueryArms,
  conceptQueryGroups,
  emptyFieldAdvice,
  minimumOptionalBounds,
  textMatchPredicate,
} from '../field-map'
import { DISABLED_REASON, UNCALIBRATED_REASON } from '../candidates'
import { emptyWhitespaceScope } from '../types'

describe('buildScopeFilter', () => {
  it('normalises stored CPC spacing when matching accepted classification prefixes', () => {
    const scope = emptyWhitespaceScope()
    scope.classifications = [
      {
        code: 'A01G 25/16',
        accepted: true,
        origin: 'user',
      },
    ]

    const filter = buildScopeFilter(scope)

    expect(filter.strings.join('')).toContain("regexp_replace(upper(c), '[[:space:]]+', '', 'g') LIKE")
    expect(filter.values).toContain('A01G25/16%')
  })
})

describe('buildConceptQuery', () => {
  const scopeWith = (concepts: Array<[label: string, required: boolean, synonyms?: string[]]>) => {
    const scope = emptyWhitespaceScope()
    scope.concepts = concepts.map(([label, required, synonyms], index) => ({
      id: `c${index}`,
      label,
      synonyms: synonyms ?? [],
      required,
      origin: 'user' as const,
    }))
    return scope
  }

  it('separates must-appear groups from optional groups and defaults to the loosest rung', () => {
    const scope = scopeWith([
      ['moisture sensor', true, ['humidity probe']],
      ['irrigation valve', false, ['water valve']],
    ])

    const plan = buildConceptQuery(scope)

    expect(plan?.required).toEqual(['"moisture sensor" OR "humidity probe"'])
    expect(plan?.optional).toEqual(['"irrigation valve" OR "water valve"'])
    // A must-appear concept exists, so the loosest rung is 0: optional
    // concepts never narrow — the pre-ladder behaviour, unchanged by default.
    expect(plan?.minimumOptional).toBe(0)
    expect(plan?.groupLabels).toEqual([['moisture sensor'], ['irrigation valve']])
    expect(conceptQueryGroups(plan!)).toHaveLength(2)
  })

  it('with nothing must-appear the loosest rung is 1 — the union, never an empty gate', () => {
    const scope = scopeWith([
      ['a', false],
      ['b', false],
      ['c', false],
    ])
    expect(minimumOptionalBounds(scope)).toEqual({ min: 1, max: 3 })
    expect(buildConceptQuery(scope)?.minimumOptional).toBe(1)
    // Asking for 0 is clamped back up to 1.
    expect(buildConceptQuery(scope, 0)?.minimumOptional).toBe(1)
    // And past the top is clamped down.
    expect(buildConceptQuery(scope, 9)?.minimumOptional).toBe(3)
  })

  it('emits one predicate arm per k-subset of the optional concepts, each carrying every must-appear group', () => {
    const scope = scopeWith([
      ['R', true],
      ['a', false],
      ['b', false],
      ['c', false],
    ])
    const arms = conceptQueryArms(buildConceptQuery(scope, 2)!)
    // C(3, 2) = 3 subsets: {a,b} {a,c} {b,c}
    expect(arms).toHaveLength(3)
    for (const arm of arms) {
      // Every arm ANDs the must-appear group with exactly two optional groups.
      expect(arm.values.filter(value => value === '"R"')).toHaveLength(1)
      expect(arm.values.filter(value => value !== '"R"')).toHaveLength(2)
    }
    expect(arms.map(arm => arm.values.slice(1))).toEqual([
      ['"a"', '"b"'],
      ['"a"', '"c"'],
      ['"b"', '"c"'],
    ])
  })

  it('k = 0 with must-appear concepts is the must-appear conjunction alone', () => {
    const scope = scopeWith([
      ['R', true],
      ['S', true],
      ['a', false],
    ])
    const arms = conceptQueryArms(buildConceptQuery(scope, 0)!)
    expect(arms).toHaveLength(1)
    expect(arms[0].values).toEqual(['"R"', '"S"'])
  })

  it('carries exclusions inside every arm, and never emits an exclusion-only arm', () => {
    const scope = scopeWith([
      ['a', false],
      ['b', false],
    ])
    scope.exclusions = [{ term: 'toy', origin: 'user' }]
    const arms = conceptQueryArms(buildConceptQuery(scope, 1)!)
    expect(arms).toHaveLength(2)
    for (const arm of arms) {
      expect(arm.values).toContain('"toy"')
      expect(arm.strings.join(' ')).toContain('!!')
    }
  })

  it('textMatchPredicate crosses arms with the readable corpora and returns null for an empty gate', () => {
    const scope = scopeWith([
      ['a', false],
      ['b', false],
    ])
    const predicate = textMatchPredicate(buildConceptQuery(scope, 1)!)!
    // 2 arms × 2 corpora, each provable against its own partial index.
    expect(predicate.strings.join('').match(/corpusSources/g)).toHaveLength(4)
    expect(predicate.strings.join('')).toContain("ARRAY['google-patents-corpus']")
    expect(predicate.strings.join('')).toContain("ARRAY['indian-corpus']")

    const noGate = { required: [], optional: ['"a"'], minimumOptional: 0, groupLabels: [['a']], exclusions: null }
    expect(textMatchPredicate(noGate)).toBeNull()
  })

  it('combinations enumerates k-subsets in a stable order', () => {
    expect(combinations(['a', 'b', 'c'], 2)).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ])
    expect(combinations(['a', 'b'], 0)).toEqual([[]])
    expect(combinations(['a'], 2)).toEqual([])
  })
})

describe('emptyFieldAdvice', () => {
  const LANE_DID_NOT_RUN = 'The semantic lane did not run'

  it('names the semantic lane when no ceiling could be estimated for the query', () => {
    // Reached when the background sample is too thin to derive a ceiling from.
    // The keyword list has now missed this reason TWICE — once when it said
    // "uncalibrated" and again when the wording moved to "estimated" — so it is
    // pinned here in both directions.
    const advice = emptyFieldAdvice(emptyWhitespaceScope(), UNCALIBRATED_REASON)

    expect(advice).toContain(LANE_DID_NOT_RUN)
  })

  it('names the semantic lane when the operator has switched it off', () => {
    const advice = emptyFieldAdvice(emptyWhitespaceScope(), DISABLED_REASON)

    expect(advice).toContain(LANE_DID_NOT_RUN)
  })

  it('recognises did-not-run reasons through the coverage-note wrapper', () => {
    const advice = emptyFieldAdvice(
      emptyWhitespaceScope(),
      'Field matched on concept text alone — Semantic search is not configured (no embedding key), so the field is lexical-only.'
    )

    expect(advice).toContain(LANE_DID_NOT_RUN)
  })

  it('does not blame the semantic lane when it ran and simply added nothing', () => {
    const advice = emptyFieldAdvice(
      emptyWhitespaceScope(),
      'Field matched on concept text alone — the semantic lane found no additional documents in this slice.'
    )

    expect(advice).not.toContain(LANE_DID_NOT_RUN)
  })

  it('points at accepted classifications, the structural filter most likely to empty a field', () => {
    const scope = emptyWhitespaceScope()
    scope.classifications = [{ code: 'A61B5/1455', accepted: true, origin: 'user' }]

    const advice = emptyFieldAdvice(scope)

    expect(advice).toContain('A61B5/1455')
  })
})
