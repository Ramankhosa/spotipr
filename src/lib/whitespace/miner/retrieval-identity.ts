import { createHash } from 'node:crypto'
import { normalizeScope } from '../scope-schema'
import { stableJson, type WhitespaceScope } from '../types'

const canonical = (values: string[]) => Array.from(new Set(values.map(v => v.trim().toLowerCase()).filter(Boolean))).sort()

/** Retrieval meaning only. Display titles, generated IDs and array order are not inputs. */
export function minerRetrievalIdentity(input: WhitespaceScope): string {
  const scope = normalizeScope(input)
  const concepts = scope.concepts.map(c => ({ terms: canonical([c.label, ...c.synonyms]), required: c.required }))
    .sort((a, b) => stableJson(a).localeCompare(stableJson(b)))
  const classifications = scope.classifications.filter(c => c.accepted).map(c => c.code)
  const exclusions = scope.exclusions.map(e => ({ ...e }))
  return createHash('sha256').update(stableJson({
    version: 1, concepts, classifications: canonical(classifications),
    exclusions: exclusions.map(e => ({ term: e.term.trim().toLowerCase() }))
      .sort((a, b) => stableJson(a).localeCompare(stableJson(b))),
    filters: { ...scope.filters, jurisdictions: canonical(scope.filters.jurisdictions), assignees: canonical(scope.filters.assignees) },
    matching: scope.matching,
  })).digest('hex')
}
