import { describe, expect, it } from 'vitest'
import { buildScopeFilter, corpusMembershipPredicate, exclusionPredicate } from '../field-map'
import { candidateCoverageNote, candidateQueryText } from '../candidates'
import { emptyWhitespaceScope } from '../types'

const scopeWithConcepts = () => {
  const scope = emptyWhitespaceScope()
  scope.concepts = [
    { id: 'a', label: 'moisture sensor', synonyms: ['humidity probe'], required: true, origin: 'user' },
    { id: 'b', label: 'irrigation valve', synonyms: ['water valve'], required: false, origin: 'user' },
  ]
  return scope
}

describe('buildScopeFilter hybrid concept gate', () => {
  it('ORs semantic candidate ids into the concept gate rather than replacing the text match', () => {
    const filter = buildScopeFilter(scopeWithConcepts(), [101, 202])
    const sql = filter.strings.join('')

    // Both arms present: the hybrid only ever widens.
    expect(sql).toContain('to_tsvector')
    expect(sql).toContain('lp."id" = ANY(')
    expect(sql).toContain(' OR lp."id" = ANY(')
    // Bound as an int[] — local_patents.id is an autoincrement Int, and binding
    // it as text[] made Postgres reject the whole predicate with 42883.
    expect(sql).toContain('::int[]')
    expect(filter.values).toContainEqual([101, 202])
  })

  it('leaves the predicate purely lexical when no candidates were resolved', () => {
    const empty = buildScopeFilter(scopeWithConcepts(), [])
    const absent = buildScopeFilter(scopeWithConcepts())

    expect(empty.strings.join('')).not.toContain('lp."id" = ANY(')
    expect(absent.strings.join('')).not.toContain('lp."id" = ANY(')
  })

  it('keeps structural filters as separate AND clauses so candidates cannot escape them', () => {
    const scope = scopeWithConcepts()
    scope.filters.jurisdictions = ['IN']
    scope.filters.yearFrom = 2015
    scope.filters.yearTo = 2020

    const filter = buildScopeFilter(scope, [101])
    const sql = filter.strings.join('')

    // The jurisdiction and filing-date clauses sit outside the OR group, so a
    // semantically-admitted document is still bound by them.
    expect(sql).toContain('lp."country" = ANY(')
    expect(sql).toContain('lp."filingDate" >=')
    expect(sql.indexOf('lp."country" = ANY(')).toBeGreaterThan(sql.indexOf(' OR lp."id" = ANY('))
  })
})

describe('candidate-side predicates', () => {
  it('restricts semantic candidates to exactly the corpora the census reads', () => {
    const sql = corpusMembershipPredicate().strings.join('')

    expect(sql).toContain("ARRAY['google-patents-corpus']::TEXT[]")
    expect(sql).toContain("ARRAY['indian-corpus']::TEXT[]")
    // The census excludes these deliberately; the semantic arm must not readmit them.
    expect(sql).not.toContain('epo-ops')
    expect(sql).not.toContain('pqai')
  })

  it('applies scope exclusions to the semantic arm, which never sees the composed tsquery', () => {
    const scope = scopeWithConcepts()
    scope.exclusions = [{ term: 'medical implant', origin: 'user' }]

    const predicate = exclusionPredicate(scope)

    expect(predicate).not.toBeNull()
    expect(predicate!.strings.join('')).toContain('NOT (')
    expect(predicate!.values).toContain('"medical implant"')
  })

  it('has no exclusion predicate when the scope excludes nothing', () => {
    expect(exclusionPredicate(emptyWhitespaceScope())).toBeNull()
  })
})

describe('candidateQueryText', () => {
  it('leads with required concepts and carries synonyms into the encoded query', () => {
    expect(candidateQueryText(scopeWithConcepts())).toBe(
      'moisture sensor, humidity probe; irrigation valve, water valve'
    )
  })

  it('orders required concepts first even when they are declared last', () => {
    const scope = emptyWhitespaceScope()
    scope.concepts = [
      { id: 'a', label: 'optional one', synonyms: [], required: false, origin: 'user' },
      { id: 'b', label: 'required one', synonyms: [], required: true, origin: 'user' },
    ]

    expect(candidateQueryText(scope)).toBe('required one; optional one')
  })

  it('returns null for a scope with no concepts, where there is no concept gate to widen', () => {
    expect(candidateQueryText(emptyWhitespaceScope())).toBeNull()
  })
})

describe('candidateCoverageNote', () => {
  it('states the semantic contribution so the reader knows how the field was assembled', () => {
    const note = candidateCoverageNote({
      ids: [1, 2],
      available: true,
      saturated: false,
      cap: 20000,
      maxDistance: 0.35,
    })

    // "fell within", not "admitted by meaning rather than wording" — the ids
    // overlap the lexical arm, and the note must not claim a split this module
    // never measures.
    expect(note).toContain('2 documents fell within')
    expect(note).toContain('some may also match the concept wording')
    expect(note).toContain('0.35')
  })

  it('warns when the semantic arm was clipped at the cap', () => {
    const note = candidateCoverageNote({
      ids: [1],
      available: true,
      saturated: true,
      cap: 20000,
      maxDistance: 0.35,
    })

    expect(note).toContain('ceiling')
    expect(note).toContain('narrow the scope')
  })

  it('does not claim a concept-text match for a scope that has no concepts', () => {
    const note = candidateCoverageNote({
      ids: [],
      available: false,
      reason: 'The scope states no concepts, so no semantic candidates are needed.',
      saturated: false,
      cap: 20000,
      maxDistance: 0.35,
    })

    // A CPC-only field has no concept text; "matched on concept text alone"
    // would be flatly wrong on its census.
    expect(note).toContain('structural filters alone')
    expect(note).not.toContain('concept text alone')
  })

  it('says the field was lexical-only, and why, when the lane could not run', () => {
    const note = candidateCoverageNote({
      ids: [],
      available: false,
      reason: 'Semantic search is not configured (no embedding key), so the field is lexical-only.',
      saturated: false,
      cap: 20000,
      maxDistance: 0.35,
    })

    expect(note).toContain('concept text alone')
    expect(note).toContain('no embedding key')
  })
})
