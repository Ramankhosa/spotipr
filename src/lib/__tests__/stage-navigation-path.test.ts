import { describe, expect, it } from 'vitest'
import { getStageNavigationPath } from '../stage-navigation-path'

type Stage =
  | 'IDEA_ENTRY'
  | 'PRELIMINARY_CLAIMS'
  | 'RELATED_ART'
  | 'CLAIM_REFINEMENT'
  | 'COMPONENT_PLANNER'
  | 'FIGURE_PLANNER'
  | 'ANNEXURE_DRAFT'

const order: Stage[] = [
  'IDEA_ENTRY',
  'PRELIMINARY_CLAIMS',
  'RELATED_ART',
  'CLAIM_REFINEMENT',
  'COMPONENT_PLANNER',
  'FIGURE_PLANNER',
  'ANNEXURE_DRAFT',
]

describe('getStageNavigationPath', () => {
  it('walks forward through every visible stage between current and target', () => {
    expect(getStageNavigationPath(order, 'PRELIMINARY_CLAIMS', 'COMPONENT_PLANNER')).toEqual([
      'RELATED_ART',
      'CLAIM_REFINEMENT',
      'COMPONENT_PLANNER',
    ])
  })

  it('walks backward through every visible stage between current and target', () => {
    expect(getStageNavigationPath(order, 'CLAIM_REFINEMENT', 'PRELIMINARY_CLAIMS')).toEqual([
      'RELATED_ART',
      'PRELIMINARY_CLAIMS',
    ])
  })

  it('returns the target directly when either stage is outside the visible order', () => {
    expect(getStageNavigationPath(order, 'CLAIM_REFINEMENT', 'COUNTRY_WISE_DRAFTING' as Stage)).toEqual([
      'COUNTRY_WISE_DRAFTING',
    ])
  })

  it('does nothing when already on the target stage', () => {
    expect(getStageNavigationPath(order, 'RELATED_ART', 'RELATED_ART')).toEqual([])
  })
})
