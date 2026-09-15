import { describe, expect, it } from 'vitest'
import { emptyWhitespaceScope } from '../../types'
import { minerRetrievalIdentity } from '../retrieval-identity'

function scope() {
  const value = emptyWhitespaceScope()
  value.title = 'Display title'
  value.summary = 'Display summary'
  value.concepts = [
    { id: 'one', label: 'soil moisture', synonyms: ['water content', 'moisture level'], required: true, origin: 'user' },
    { id: 'two', label: 'valve control', synonyms: ['actuated valve'], required: false, origin: 'copilot' },
  ]
  value.exclusions = [{ term: 'manual watering', origin: 'user' }]
  return value
}

describe('miner retrieval identity', () => {
  it('ignores display edits, identifiers, origins, and equivalent ordering', () => {
    const a = scope()
    const b = scope()
    b.title = 'Renamed'
    b.summary = 'Cosmetic change'
    b.concepts.reverse()
    b.concepts[1].synonyms.reverse()
    b.concepts[0].id = 'different'
    b.concepts[0].origin = 'user'
    expect(minerRetrievalIdentity(b)).toBe(minerRetrievalIdentity(a))
  })

  it('changes when a retrieval condition changes', () => {
    const a = scope()
    const b = scope()
    b.filters.jurisdictions = ['US']
    expect(minerRetrievalIdentity(b)).not.toBe(minerRetrievalIdentity(a))
  })
})
