import { describe, expect, test, vi } from 'vitest'
import {
  areFiguresSkipped,
  buildFigurelessDraftGuard,
  filterDrawingSectionKeys,
  filterDrawingSections,
  getEffectiveFigures,
  isDrawingSectionKey
} from '@/lib/figure-availability'
import { buildAntiHallucinationGuards } from '@/lib/section-injection-config'
import { validateFullDraft } from '@/lib/unified-validation-service'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    countrySectionValidation: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([])
    },
    userValidationOverride: {
      findUnique: vi.fn().mockResolvedValue(null)
    }
  }
}))

describe('figure availability helpers', () => {
  test('suppresses figures and drawing sections when figures are skipped', () => {
    const session = { figuresSkipped: true }

    expect(areFiguresSkipped(session)).toBe(true)
    expect(getEffectiveFigures(session, [{ figureNo: 1 }])).toEqual([])
    expect(isDrawingSectionKey('briefDescriptionOfDrawings')).toBe(true)
    expect(filterDrawingSectionKeys(session, ['summary', 'briefDescriptionOfDrawings', 'claims'])).toEqual([
      'summary',
      'claims'
    ])
    expect(
      filterDrawingSections(
        session,
        [{ key: 'summary' }, { key: 'brief_description_of_drawings' }, { key: 'claims' }],
        section => section.key
      )
    ).toEqual([{ key: 'summary' }, { key: 'claims' }])
  })

  test('emits a strict figureless drafting guard', () => {
    const guard = buildFigurelessDraftGuard()
    const antiHallucination = buildAntiHallucinationGuards(false, true, true, { figuresSkipped: true })

    expect(guard).toContain('intentionally chose')
    expect(guard).toContain('Do NOT create')
    expect(antiHallucination).toContain('FIG. X')
    expect(antiHallucination).toContain('Brief Description of Drawings')
  })
})

describe('figureless validation', () => {
  test('ignores preserved figure records but flags disabled figure references', async () => {
    const noReferenceIssues = await validateFullDraft(
      { detailedDescription: 'The controller receives sensor input and updates the output state.' },
      'US',
      { figurePlans: [{ figureNo: 1 }], figuresSkipped: true }
    )

    expect(noReferenceIssues).toEqual([])

    const issues = await validateFullDraft(
      {
        detailedDescription: 'The controller arrangement is shown in FIG. 1.',
        briefDescriptionOfDrawings: 'FIG. 1 is a block diagram.'
      },
      'US',
      { figurePlans: [{ figureNo: 1 }], figuresSkipped: true }
    )

    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('Figureless draft mode')
  })
})
