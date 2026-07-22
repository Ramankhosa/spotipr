import type { RelationshipCategory } from './types'

export type PatentRelationshipVisualStyle = 'PRIMARY' | 'SECONDARY' | 'ASSOCIATION'

const SECONDARY_RELATIONSHIP_CATEGORIES: ReadonlySet<RelationshipCategory> = new Set<RelationshipCategory>([
  'CONTROL',
  'CONFIGURATION',
  'VALIDATION',
  'RESPONSE',
  'REVIEW_FEEDBACK',
  'STORAGE',
  'OPTIONAL',
])

export function relationshipVisualStyle(category: RelationshipCategory): PatentRelationshipVisualStyle {
  if (category === 'ASSOCIATION') return 'ASSOCIATION'
  if (SECONDARY_RELATIONSHIP_CATEGORIES.has(category)) return 'SECONDARY'
  return 'PRIMARY'
}
