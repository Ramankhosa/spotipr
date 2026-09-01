// Heuristics that power supporting-data hints in the intake and DD data UIs.
// Both are advisory only — they toggle hints/defaults, never gate behavior.

import { isMarkdownTableRow } from './markdown-table'

// A TSV row (e.g. pasted from Excel) has at least two non-empty tab-separated cells.
function isTsvRow(line: string): boolean {
  if (!line.includes('\t')) return false
  return line.split('\t').filter(cell => cell.trim().length > 0).length >= 2
}

/**
 * True when the text contains something that reads as a data table:
 * a run of 2+ pipe-delimited Markdown rows, or 2+ consecutive TSV rows.
 * Mirrors the export-side rule (a lone pipe line is too weak a signal).
 */
export function detectTabularData(text: string): boolean {
  if (!text) return false
  const lines = text.split('\n').map(l => l.trim())
  let pipeRun = 0
  let tsvRun = 0
  for (const line of lines) {
    pipeRun = isMarkdownTableRow(line) ? pipeRun + 1 : 0
    tsvRun = isTsvRow(line) ? tsvRun + 1 : 0
    if (pipeRun >= 2 || tsvRun >= 2) return true
  }
  return false
}

// Number followed by a measurement unit ("78 percent", "0.9 m/s", "350 g", "48 degrees C").
// Deliberately unit-anchored: bare numbers ("claim 3", "Figure 2") must not count.
const NUMBER_WITH_UNIT = /\b\d+(?:\.\d+)?[\s-]?(?:%|percent|°\s?[cf]\b|deg(?:rees)?(?:\s+[cf]\b|\s+celsius|\s+fahrenheit)?|kg|mg|g|ml|l\b|mm|cm|m\/s|m\b|rpm|min(?:utes?)?\b|h(?:ours?)?\b|hrs?\b|sec(?:onds?)?\b|s\b|pa\b|kpa|mpa|bar\b|ppm|wt%|mol|v\b|mv|ma\b|mah|w\b|kw|hz|khz)/gi

/**
 * True when the text reads like it carries measured/experimental results:
 * three or more number-with-unit occurrences, or an explicit tabular block.
 * Used only for a non-blocking "you can add supporting data" hint at intake.
 */
export function detectNumericResults(text: string): boolean {
  if (!text) return false
  if (detectTabularData(text)) return true
  const matches = text.match(NUMBER_WITH_UNIT)
  return (matches?.length || 0) >= 3
}
