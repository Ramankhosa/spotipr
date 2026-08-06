// Client-safe coverage arithmetic over already-scored element cells.
//
// Split out of element-scoring.ts deliberately: that module imports Prisma and
// the corpus embedding service (which pulls in adm-zip/fs), so a 'use client'
// component importing VALUE exports from it drags the whole server graph into
// the browser bundle — `next build` fails on `fs`, and the dev page dies at
// module-init inside adm-zip. This file must import NOTHING server-side; its
// only dependency is the (import-free) types module. Keep it that way.
//
// Scoring (prisma + embeddings) stays in element-scoring.ts; the pure set
// arithmetic the ElementGrid needs lives here.

import type { StudioElement, StudioElementCell } from './types'

/** Elements a document is considered to teach (for coverage arithmetic). */
export function coveredElements(
  cells: Record<string, StudioElementCell> | undefined,
  elements: StudioElement[],
  { includePartial = true }: { includePartial?: boolean } = {}
): string[] {
  if (!cells) return []
  return elements
    .filter(element => {
      const verdict = cells[element.id]?.verdict
      if (verdict === 'STRONG') return true
      return includePartial && verdict === 'PART'
    })
    .map(element => element.id)
}

export interface CombinationCandidate {
  familyKeys: string[]
  publicationNumbers: string[]
  coverage: Record<string, string[]> // elementId -> publicationNumbers teaching it
  covered: number
  total: number
}

/**
 * Minimal complementary sets that jointly reach every element. This is set
 * arithmetic ONLY — whether references may properly be combined is an
 * obviousness judgment the attorney must make and record.
 */
export function findCombinations(input: {
  elements: StudioElement[]
  rows: Array<{ familyKey: string; publicationNumber: string; cells?: Record<string, StudioElementCell> }>
  maxSetSize?: number
  limit?: number
}): CombinationCandidate[] {
  const { elements, rows } = input
  const maxSetSize = input.maxSetSize ?? 2
  const limit = input.limit ?? 3
  if (elements.length < 2 || rows.length < 2) return []

  const elementIds = elements.map(e => e.id)
  const covers = rows.map(row => ({
    row,
    set: new Set(coveredElements(row.cells, elements)),
  }))

  // Anything already covering everything alone is an anticipation candidate,
  // not a combination — exclude it here.
  const partials = covers.filter(c => c.set.size > 0 && c.set.size < elementIds.length)

  const results: CombinationCandidate[] = []
  for (let i = 0; i < partials.length && results.length < limit * 6; i++) {
    for (let j = i + 1; j < partials.length; j++) {
      const iIds = Array.from(partials[i].set)
      const jIds = Array.from(partials[j].set)
      const union = new Set(iIds.concat(jIds))
      if (union.size !== elementIds.length) continue
      // Require genuine complementarity: each must contribute something unique.
      const iUnique = iIds.some(id => !partials[j].set.has(id))
      const jUnique = jIds.some(id => !partials[i].set.has(id))
      if (!iUnique || !jUnique) continue

      const members = [partials[i].row, partials[j].row]
      const coverage: Record<string, string[]> = {}
      for (const id of elementIds) {
        coverage[id] = members
          .filter(m => coveredElements(m.cells, elements).includes(id))
          .map(m => m.publicationNumber)
      }
      results.push({
        familyKeys: members.map(m => m.familyKey),
        publicationNumbers: members.map(m => m.publicationNumber),
        coverage,
        covered: union.size,
        total: elementIds.length,
      })
      if (results.length >= limit) return results
    }
  }
  if (maxSetSize < 2) return []
  return results.slice(0, limit)
}

export interface AnticipationCandidate {
  familyKey: string
  publicationNumber: string
  strongCount: number
  /**
   * ANTICIPATION — every element read as STRONG. This is the only tier that may
   * be presented as a single-reference §102 candidate.
   *
   * NEAR — every element is covered, but at least one only as PART. This used to
   * be lumped in with the tier above (coveredElements defaults to
   * includePartial: true), so a document where NOTHING scored better than PART
   * was highlighted and labelled as anticipating the claim. Anticipation
   * requires each and every element; "arguably present" across the board is a
   * different finding and has to be labelled as one.
   */
  tier: 'ANTICIPATION' | 'NEAR'
}

/**
 * Documents that alone teach every element.
 *
 * Returns both tiers, strongest first, because hiding the NEAR ones would be the
 * opposite failure — they are often the closest art in the set. The caller must
 * render the distinction; it must never present NEAR as §102.
 */
export function findAnticipationCandidates(input: {
  elements: StudioElement[]
  rows: Array<{ familyKey: string; publicationNumber: string; cells?: Record<string, StudioElementCell> }>
}): AnticipationCandidate[] {
  const { elements, rows } = input
  if (!elements.length) return []
  return rows
    .filter(row => coveredElements(row.cells, elements).length === elements.length)
    .map(row => {
      const strongCount = elements.filter(e => row.cells?.[e.id]?.verdict === 'STRONG').length
      return {
        familyKey: row.familyKey,
        publicationNumber: row.publicationNumber,
        strongCount,
        tier: strongCount === elements.length ? ('ANTICIPATION' as const) : ('NEAR' as const),
      }
    })
    .sort((a, b) => b.strongCount - a.strongCount)
}

/** Only the rows that may be called single-reference §102 candidates. */
export function anticipationOnly(candidates: AnticipationCandidate[]): AnticipationCandidate[] {
  return candidates.filter(candidate => candidate.tier === 'ANTICIPATION')
}
