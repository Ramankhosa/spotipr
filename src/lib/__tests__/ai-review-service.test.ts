import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/metering', () => ({
  llmGateway: {
    executeLLMOperation: vi.fn(),
  },
}))

import { buildReviewPrompt } from '@/lib/ai-review-service'

describe('buildReviewPrompt locked review context', () => {
  test('excludes claims from reviewable draft sections and keeps them read-only', () => {
    const prompt = buildReviewPrompt(
      {
        title: 'Thermal controller',
        summary: 'A controller manages thermal drift.',
        detailedDescription: 'The controller (100) receives sensor data.',
        claims: '1. A frozen system comprising a controller configured to predict thermal drift.',
      },
      [],
      'IN',
      'Thermal controller'
    )

    const draftSections = prompt.slice(
      prompt.indexOf('DRAFT SECTIONS'),
      prompt.indexOf('LOCKED CLAIMS CONTEXT')
    )
    const lockedClaims = prompt.slice(
      prompt.indexOf('LOCKED CLAIMS CONTEXT'),
      prompt.indexOf('LOCKED PATENT FIGURES')
    )

    expect(draftSections).not.toContain('### Claims')
    expect(draftSections).not.toContain('A frozen system comprising')
    expect(lockedClaims).toContain('Frozen Claims (Read-Only')
    expect(lockedClaims).toContain('A frozen system comprising')
    expect(prompt).not.toContain('Claims properly numbered')
    expect(prompt).not.toContain('Proper antecedent basis in claims')
    expect(prompt).not.toContain('max 20 claims')
  })

  test('marks approved diagrams and sketches as locked read-only context', () => {
    const prompt = buildReviewPrompt(
      {
        briefDescriptionOfDrawings: 'FIG. 1 illustrates a controller.',
        detailedDescription: 'The controller (100) is shown in FIG. 1.',
        claims: '1. A frozen system comprising a controller.',
      },
      [{ figureNo: 1, title: 'Controller diagram', plantuml: '@startuml\nrectangle "Controller (100)"\n@enduml' }],
      'IN',
      'Thermal controller',
      [{ name: 'controller', numeral: '100' }],
      [{ figureNo: 2, title: 'Sensor sketch', description: 'Approved sensor sketch', isIncluded: true }]
    )

    expect(prompt).toContain('LOCKED PATENT FIGURES')
    expect(prompt).toContain('APPROVED DIAGRAM FIGURES (Read-Only Structured Facts)')
    expect(prompt).toContain('APPROVED SKETCH FIGURES')
    expect(prompt).toContain('Do NOT suggest changing PlantUML')
    expect(prompt).toContain('Target only editable text sections for fixes')
  })

  test('filters claim limits and claim-targeted cross validations from prompt context', () => {
    const prompt = buildReviewPrompt(
      {
        summary: 'A summary.',
        detailedDescription: 'A detailed description.',
        claims: '1. A frozen system.',
      },
      [],
      'IN',
      'System',
      [],
      [],
      [
        { sectionKey: 'claims', maxCount: 20, maxIndependent: 3 },
        { sectionKey: 'summary', maxWords: 150 },
      ],
      [
        {
          ruleKey: 'description_supports_claims',
          sourceSection: 'claims',
          targetSection: 'detailedDescription',
          ruleName: 'Description supports claims',
          description: 'Frozen claim features must be supported in the description.',
          severity: 'warning',
        },
        {
          ruleKey: 'claims_match_summary',
          sourceSection: 'summary',
          targetSection: 'claims',
          ruleName: 'Claims match summary',
          description: 'Claims should match summary.',
          severity: 'warning',
        },
      ]
    )

    expect(prompt).not.toContain('max 20 claims')
    expect(prompt).not.toContain('max 3 independent claims')
    expect(prompt).toContain('Summary: max 150 words')
    expect(prompt).toContain('Description supports claims')
    expect(prompt).not.toContain('Claims match summary')
  })
})
