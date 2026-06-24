import { describe, expect, test } from 'vitest'
import {
  filterProtectedAIReviewIssues,
  isClaimMutationSuggestion,
  isDiagramAssetMutationSuggestion,
  isProtectedAIReviewSection,
} from '@/lib/ai-review-protection'

describe('ai review protection helpers', () => {
  test('treats claims as a protected review section', () => {
    expect(isProtectedAIReviewSection('claims')).toBe(true)
    expect(isProtectedAIReviewSection('Claims')).toBe(true)
    expect(isProtectedAIReviewSection('detailedDescription')).toBe(false)
  })

  test('drops direct claim-section issues', () => {
    const issues = filterProtectedAIReviewIssues([
      { sectionKey: 'claims', title: 'Claim issue', fix: 'Change Claim 2.' },
      { sectionKey: 'summary', title: 'Summary issue', fix: 'Revise the summary text.' },
    ])

    expect(issues).toHaveLength(1)
    expect(issues[0].sectionKey).toBe('summary')
  })

  test('detects direct claim mutation suggestions even when mis-targeted', () => {
    expect(isClaimMutationSuggestion({
      sectionKey: 'detailedDescription',
      fix: "In Claim 2, change 'the processor' to 'a processor'.",
    })).toBe(true)

    expect(isClaimMutationSuggestion({
      sectionKey: 'detailedDescription',
      fix: 'Add a paragraph in detailedDescription supporting frozen Claim 1.',
    })).toBe(false)
  })

  test('detects approved diagram asset mutation suggestions', () => {
    expect(isDiagramAssetMutationSuggestion({
      sectionKey: 'detailedDescription',
      fix: 'Update the PlantUML for FIG. 1 to add a controller block.',
    })).toBe(true)

    expect(isDiagramAssetMutationSuggestion({
      sectionKey: 'summary',
      fix: 'Change Figure 1 diagram to include a sensor.',
    })).toBe(true)
  })

  test('keeps text-section fixes that reference locked figures', () => {
    const issues = filterProtectedAIReviewIssues([
      {
        sectionKey: 'briefDescriptionOfDrawings',
        title: 'Caption omits detail',
        fix: 'Revise briefDescriptionOfDrawings to match approved FIG. 1.',
      },
      {
        sectionKey: 'detailedDescription',
        title: 'Missing claim support',
        fix: 'Add a paragraph in detailedDescription supporting frozen Claim 1.',
      },
    ])

    expect(issues).toHaveLength(2)
  })
})
