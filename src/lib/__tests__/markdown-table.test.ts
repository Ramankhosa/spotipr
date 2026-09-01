import { describe, expect, test } from 'vitest'
import {
  isMarkdownTableRow,
  isMarkdownTableSeparator,
  parseMarkdownTable,
  splitContentSegments,
} from '@/lib/markdown-table'

describe('markdown table detection', () => {
  test('recognizes pipe-delimited rows', () => {
    expect(isMarkdownTableRow('| Sample | Efficiency |')).toBe(true)
    expect(isMarkdownTableRow('|---|---|')).toBe(true)
    expect(isMarkdownTableRow('Plain prose sentence.')).toBe(false)
    expect(isMarkdownTableRow('a | b')).toBe(false)
  })

  test('recognizes separator rows including alignment colons', () => {
    expect(isMarkdownTableSeparator('|---|---|')).toBe(true)
    expect(isMarkdownTableSeparator('| :--- | ---: | :---: |')).toBe(true)
    expect(isMarkdownTableSeparator('| Sample | Efficiency |')).toBe(false)
  })
})

describe('parseMarkdownTable', () => {
  test('parses headers and rows, dropping the separator', () => {
    const parsed = parseMarkdownTable([
      '| Sample | Moisture (%) | Time (h) |',
      '|---|---|---|',
      '| A | 12.4 | 6 |',
      '| B | 8.1 | 9 |',
    ].join('\n'))
    expect(parsed).not.toBeNull()
    expect(parsed!.headers).toEqual(['Sample', 'Moisture (%)', 'Time (h)'])
    expect(parsed!.rows).toEqual([
      ['A', '12.4', '6'],
      ['B', '8.1', '9'],
    ])
  })

  test('pads ragged rows to the widest column count', () => {
    const parsed = parseMarkdownTable([
      '| A | B | C |',
      '|---|---|---|',
      '| 1 | 2 |',
    ].join('\n'))
    expect(parsed!.rows).toEqual([['1', '2', '']])
  })

  test('returns null for non-table content', () => {
    expect(parseMarkdownTable('just prose')).toBeNull()
  })
})

describe('splitContentSegments', () => {
  test('keeps existing one-paragraph-per-line semantics for prose', () => {
    const segments = splitContentSegments('First paragraph.\n\nSecond paragraph.')
    expect(segments).toEqual([
      { kind: 'paragraph', content: 'First paragraph.' },
      { kind: 'paragraph', content: 'Second paragraph.' },
    ])
  })

  test('groups a run of table rows into one table segment', () => {
    const segments = splitContentSegments([
      'Intro paragraph.',
      'Table 1 — Drying performance',
      '| Sample | Moisture (%) |',
      '|---|---|',
      '| A | 12.4 |',
      '| B | 8.1 |',
      'Closing paragraph.',
    ].join('\n'))
    expect(segments.map(s => s.kind)).toEqual(['paragraph', 'paragraph', 'table', 'paragraph'])
    expect(segments[2].content).toContain('| Sample | Moisture (%) |')
    expect(segments[2].content).toContain('| B | 8.1 |')
  })

  test('a lone pipe-delimited line stays a paragraph', () => {
    const segments = splitContentSegments('Before.\n| not really a table |\nAfter.')
    expect(segments.map(s => s.kind)).toEqual(['paragraph', 'paragraph', 'paragraph'])
  })

  test('handles multiple tables in one section', () => {
    const segments = splitContentSegments([
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      'Between tables.',
      '| C | D |',
      '|---|---|',
      '| 3 | 4 |',
    ].join('\n'))
    expect(segments.map(s => s.kind)).toEqual(['table', 'paragraph', 'table'])
  })
})
