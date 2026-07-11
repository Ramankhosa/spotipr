import { describe, expect, test } from 'vitest'
import {
  IMPORTED_IMAGE_PENDING_DESCRIPTION,
  cleanFigureDescriptionForDrafting,
  isPendingImportedImageDescription,
} from '@/lib/diagram-image-analysis'

describe('diagram-image-analysis helpers', () => {
  test('identifies imported-image pending placeholders', () => {
    expect(isPendingImportedImageDescription(IMPORTED_IMAGE_PENDING_DESCRIPTION)).toBe(true)
    expect(isPendingImportedImageDescription(` ${IMPORTED_IMAGE_PENDING_DESCRIPTION} `)).toBe(true)
    expect(isPendingImportedImageDescription('A completed generated description.')).toBe(false)
  })

  test('removes pending placeholders from drafting context but keeps real descriptions', () => {
    expect(cleanFigureDescriptionForDrafting(IMPORTED_IMAGE_PENDING_DESCRIPTION)).toBe('')
    expect(cleanFigureDescriptionForDrafting('A completed generated description.')).toBe('A completed generated description.')
  })
})
