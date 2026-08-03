import { describe, expect, it } from 'vitest'
import { buildConceptQuery, buildScopeFilter } from '../field-map'
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
