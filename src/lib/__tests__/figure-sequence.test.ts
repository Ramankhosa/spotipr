import { describe, expect, test } from 'vitest'
import { appendFigureToSequence, normalizeFigureSequence } from '@/lib/figure-sequence'

describe('figure-sequence', () => {
  test('normalizes to include all available figures exactly once', () => {
    const available = [
      { id: 'diagram-1', type: 'diagram' as const, sourceId: 'fp1' },
      { id: 'sketch-a', type: 'sketch' as const, sourceId: 'a' },
      { id: 'diagram-2', type: 'diagram' as const, sourceId: 'fp2' },
    ]

    const input = [
      { id: 'diagram-2', type: 'diagram', sourceId: 'fp2', finalFigNo: 99 },
      { id: 'diagram-2', type: 'diagram', sourceId: 'fp2' }, // dup
      { id: 'sketch-a', type: 'diagram', sourceId: 'a' }, // wrong type
      { id: 'unknown', type: 'diagram', sourceId: 'x' }, // unknown
    ]

    const result = normalizeFigureSequence(input, available)
    expect(result.normalized.map(s => s.id)).toEqual(['diagram-2', 'diagram-1', 'sketch-a'])
    expect(result.normalized.map(s => s.finalFigNo)).toEqual([1, 2, 3])
    expect(result.meta.dedupedCount).toBe(1)
    expect(result.meta.droppedUnknownCount).toBe(1)
    expect(result.meta.droppedTypeMismatchCount).toBe(1)
    expect(result.meta.appendedMissingCount).toBe(2)
  })

  test('drops sourceId mismatches to prevent spoofing', () => {
    const available = [
      { id: 'diagram-1', type: 'diagram' as const, sourceId: 'fp1' },
    ]
    const input = [
      { id: 'diagram-1', type: 'diagram', sourceId: 'fp999' },
    ]
    const result = normalizeFigureSequence(input, available)
    expect(result.normalized).toEqual([{ id: 'diagram-1', type: 'diagram', sourceId: 'fp1', finalFigNo: 1 }])
    expect(result.meta.droppedSourceMismatchCount).toBe(1)
    expect(result.meta.appendedMissingCount).toBe(1)
  })

  test('reports all dirty sequence metadata needed for finalization rejection', () => {
    const available = [
      { id: 'diagram-1', type: 'diagram' as const, sourceId: 'fp1' },
      { id: 'sketch-s1', type: 'sketch' as const, sourceId: 's1' },
    ]
    const input = [
      { id: 'diagram-1', type: 'diagram', sourceId: 'fp1' },
      { id: 'diagram-1', type: 'diagram', sourceId: 'fp1' },
      { id: 'sketch-s1', type: 'diagram', sourceId: 's1' },
      { id: 'sketch-s1', type: 'sketch', sourceId: 'wrong' },
      { id: 'sketch-old', type: 'sketch', sourceId: 'old' },
    ]

    const result = normalizeFigureSequence(input, available)

    expect(result.normalized.map(s => s.id)).toEqual(['diagram-1', 'sketch-s1'])
    expect(result.meta.dedupedCount).toBe(1)
    expect(result.meta.droppedTypeMismatchCount).toBe(1)
    expect(result.meta.droppedSourceMismatchCount).toBe(1)
    expect(result.meta.droppedUnknownCount).toBe(1)
    expect(result.meta.appendedMissingCount).toBe(1)
  })

  test('appends a newly uploaded external image after existing figures when no sequence exists', () => {
    const existing = [
      { id: 'diagram-1', type: 'diagram' as const, sourceId: 'fp1' },
      { id: 'sketch-a', type: 'sketch' as const, sourceId: 'a' },
      { id: 'sketch-b', type: 'sketch' as const, sourceId: 'b' },
    ]

    const result = appendFigureToSequence([], existing, {
      id: 'diagram-2',
      type: 'diagram',
      sourceId: 'fp2',
    })

    expect(result.normalized.map(s => s.id)).toEqual(['diagram-1', 'sketch-a', 'sketch-b', 'diagram-2'])
    expect(result.normalized.map(s => s.finalFigNo)).toEqual([1, 2, 3, 4])
    expect(result.meta.appendedMissingCount).toBe(4)
  })

  test('keeps saved custom order and appends a newly uploaded external image last', () => {
    const existing = [
      { id: 'diagram-1', type: 'diagram' as const, sourceId: 'fp1' },
      { id: 'sketch-a', type: 'sketch' as const, sourceId: 'a' },
    ]
    const input = [
      { id: 'sketch-a', type: 'sketch', sourceId: 'a', finalFigNo: 1 },
      { id: 'diagram-1', type: 'diagram', sourceId: 'fp1', finalFigNo: 2 },
    ]

    const result = appendFigureToSequence(input, existing, {
      id: 'diagram-2',
      type: 'diagram',
      sourceId: 'fp2',
    })

    expect(result.normalized.map(s => s.id)).toEqual(['sketch-a', 'diagram-1', 'diagram-2'])
    expect(result.normalized.map(s => s.finalFigNo)).toEqual([1, 2, 3])
  })
})


