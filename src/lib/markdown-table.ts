// Markdown-table handling for the export layer.
//
// Drafted section text is plain text; when DD table mode is on, the LLM emits
// GitHub-style Markdown tables. The export normalizer groups those lines into
// dedicated table blocks so DOCX/PDF render real tables and paragraph numbering
// skips them (numbers belong on prose paragraphs, not table rows).

export interface ParsedMarkdownTable {
  headers: string[]
  rows: string[][]
}

// A table row is pipe-delimited with a leading and trailing pipe: "| a | b |"
export function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length >= 2 && trimmed.startsWith('|') && trimmed.endsWith('|')
}

// The header/body separator: "|---|:---:|" (dashes with optional alignment colons)
export function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim()
  if (!isMarkdownTableRow(trimmed)) return false
  const inner = trimmed.slice(1, -1)
  return inner.split('|').every(cell => /^\s*:?-{2,}:?\s*$/.test(cell))
}

function splitCells(line: string): string[] {
  const trimmed = line.trim()
  return trimmed
    .slice(1, -1)
    .split('|')
    .map(cell => cell.trim())
}

/**
 * Parse a block of contiguous Markdown table lines into headers and rows.
 * Separator rows are dropped. Without a separator, the first row is still
 * treated as the header row.
 */
export function parseMarkdownTable(content: string): ParsedMarkdownTable | null {
  const lines = content
    .split('\n')
    .map(l => l.trim())
    .filter(l => isMarkdownTableRow(l) && !isMarkdownTableSeparator(l))
  if (lines.length === 0) return null

  const cellRows = lines.map(splitCells)
  const columnCount = Math.max(...cellRows.map(r => r.length))
  // Pad ragged rows so every row has the same number of cells
  const padded = cellRows.map(r => r.length < columnCount ? [...r, ...Array(columnCount - r.length).fill('')] : r)

  return {
    headers: padded[0],
    rows: padded.slice(1),
  }
}

export type ContentSegment =
  | { kind: 'paragraph'; content: string }
  | { kind: 'table'; content: string }

/**
 * Split section text into paragraph and table segments.
 *
 * Non-table lines keep the existing export semantics: every non-empty line is
 * its own paragraph. A run of 2+ consecutive table rows becomes one table
 * segment; a lone pipe-delimited line stays a paragraph (too weak a signal).
 */
export function splitContentSegments(text: string): ContentSegment[] {
  const segments: ContentSegment[] = []
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  let tableRun: string[] = []
  const flushTableRun = () => {
    if (tableRun.length === 0) return
    if (tableRun.length >= 2) {
      segments.push({ kind: 'table', content: tableRun.join('\n') })
    } else {
      segments.push({ kind: 'paragraph', content: tableRun[0] })
    }
    tableRun = []
  }

  for (const line of lines) {
    if (isMarkdownTableRow(line)) {
      tableRun.push(line)
    } else {
      flushTableRun()
      segments.push({ kind: 'paragraph', content: line })
    }
  }
  flushTableRun()

  return segments
}
