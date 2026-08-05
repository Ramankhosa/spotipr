import { describe, expect, it } from 'vitest'
import { buildConceptQuery, buildScopeFilter, emptyFieldAdvice } from '../field-map'
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
  it('intersects required concepts and leaves optional concepts out of the field-defining predicate', () => {
    const scope = emptyWhitespaceScope()
    scope.concepts = [
      { id: 'a', label: 'moisture sensor', synonyms: ['humidity probe'], required: true, origin: 'user' },
      { id: 'b', label: 'irrigation valve', synonyms: ['water valve'], required: false, origin: 'user' },
    ]

    const plan = buildConceptQuery(scope)

    expect(plan?.groups).toEqual(['"moisture sensor" OR "humidity probe"'])
    expect(plan?.groupLabels).toEqual([['moisture sensor']])
  })
})

describe('emptyFieldAdvice', () => {
  const LANE_DID_NOT_RUN = 'The semantic lane did not run'

  it('names the semantic lane when a binary installation has no calibrated ceiling', () => {
    // The production state right after deploy: Voyage vectors, env var unset.
    // An earlier keyword list missed this reason and the advice dropped its
    // most relevant sentence exactly where it mattered most.
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
