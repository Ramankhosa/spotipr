/**
 * Office Action Studio — PDF text extraction
 *
 * Attorneys upload the FER (and often the specification) as a PDF. This pulls
 * the text layer out with pdfjs — the same library already used elsewhere in the
 * repo — preserving reading order and page breaks, then hands it to the existing
 * furniture cleaner. Scanned/image-only PDFs yield little or no text; the caller
 * detects that (low character yield) and routes to manual entry / OCR.
 *
 * PARAGRAPH STRUCTURE IS THE POINT. Everything downstream — paragraph anchors,
 * the amendment-basis check, retrieval chunking — is built on where paragraphs
 * begin and end. Two constraints shape the algorithm below:
 *
 *  1. EXACTLY ONE newline per visual line. `cleanOfficeActionText` is line-based
 *     (it strips running headers and the duplicated line at each page break), so
 *     joining wrapped lines with a space would silently disable furniture
 *     removal and break examiner-quote verification on every FER.
 *  2. A paragraph break is a SECOND newline, and it must be inferred from
 *     measurement, not from `hasEOL`. The previous implementation emitted one
 *     newline for the y-shift AND another for hasEOL, so every wrapped line
 *     looked like a paragraph break and each printed line became its own
 *     "paragraph".
 */

import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { PAGE_SEPARATOR } from './document-intake'

export type ExtractionQuality = 'GOOD' | 'PARTIAL' | 'FAILED'

export interface PdfExtraction {
  text: string
  pageCount: number
  charsPerPage: number
  /** True when the PDF appears to be scanned images with no usable text layer. */
  likelyScanned: boolean
  /**
   * PARTIAL when reading order could not be established confidently — a
   * multi-column layout or a table. Downstream this becomes
   * UNKNOWN_DOCUMENT_INCOMPLETE rather than a confident absence finding: a
   * plausible-looking wrong reading order is worse than an admitted unknown.
   */
  extractionQuality: ExtractionQuality
  qualityNotes: string[]
}

const SCANNED_CHARS_PER_PAGE_THRESHOLD = 120

/** Items within this many points of each other are on the same visual line. */
const Y_EPSILON = 2
/** A vertical gap beyond this is a section break, not line leading — ignore when measuring. */
const UPPER_REASONABLE_GAP = 80
/** Gap greater than this multiple of the line baseline starts a new paragraph. */
const PARAGRAPH_GAP_FACTOR = 1.6
/** A first line indented by at least this much starts a paragraph even at normal leading. */
const MIN_INDENT_POINTS = 8

/**
 * Load pdfjs and point it at a worker path that survives bundling.
 *
 * Under webpack (every Next.js API route) pdfjs defaults `workerSrc` to the
 * relative './pdf.worker.mjs', which it then resolves next to the emitted
 * vendor chunk instead of node_modules — `getDocument` rejects with
 * "Setting up fake worker failed: Cannot find module ...pdf.worker.mjs".
 * Resolving the real file up front keeps the route and the CLI scripts on the
 * same path. (patent-corpus-extractor does the same thing.)
 */
async function loadPdfjs(): Promise<any> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // Set unconditionally: getDocument() defaults it to './pdf.worker.mjs' on the
  // first call, and pdfjs memoises the resulting (failed) worker load for the
  // life of the process.
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(resolveWorkerPath()).href
  return pdfjs
}

function resolveWorkerPath(): string {
  const fromCwd = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
  if (fs.existsSync(fromCwd)) return fromCwd
  // Hoisted/pnpm layouts and standalone builds: ask Node (not webpack) to resolve it.
  const nodeRequire = (0, eval)('require') as NodeRequire
  return nodeRequire.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
}

/** Extract the text layer from a PDF buffer. */
export async function extractPdfText(data: Uint8Array | Buffer): Promise<PdfExtraction> {
  const pdfjs = await loadPdfjs()
  // pdfjs rejects Node Buffers (a Uint8Array subclass) — hand it a plain view.
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const doc = await pdfjs.getDocument({ data: bytes, disableWorker: true, useSystemFonts: true }).promise

  const pages: string[] = []
  const notes = new Set<string>()
  let quality: ExtractionQuality = 'GOOD'

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const rendered = renderPage(content.items)
    pages.push(rendered.text)
    if (rendered.quality === 'PARTIAL') {
      quality = 'PARTIAL'
      rendered.notes.forEach(n => notes.add(`page ${p}: ${n}`))
    }
  }

  // A form feed between pages, so paragraph splitting can attribute a page
  // number without the marker surviving as visible text.
  const text = pages.join(`\n${PAGE_SEPARATOR}\n`)
  const pageCount = doc.numPages
  const charsPerPage = pageCount ? Math.round(text.replace(/\s/g, '').length / pageCount) : 0
  const likelyScanned = charsPerPage < SCANNED_CHARS_PER_PAGE_THRESHOLD

  return {
    text, pageCount, charsPerPage, likelyScanned,
    extractionQuality: likelyScanned ? 'FAILED' : quality,
    qualityNotes: Array.from(notes)
  }
}

// ---------------------------------------------------------------------------
// Layout reconstruction (exported for tests — this is the riskiest logic here)
// ---------------------------------------------------------------------------

interface VisualLine {
  y: number
  xStart: number
  fontSize: number
  text: string
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * The single most common line gap — the wrap leading, by definition.
 *
 * A median is the wrong estimator here: it is computed over a set that also
 * contains the paragraph gaps we are trying to detect, so on a page with few
 * lines it lands between the two and nothing is ever classified as a break.
 * Ties resolve downward, because the wrap gap is always the smaller of the two.
 */
function modalGap(values: number[]): number {
  if (!values.length) return 0
  const counts = new Map<number, number>()
  for (const v of values) {
    const key = Math.round(v)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  let best = 0, bestCount = 0
  for (const [value, count] of Array.from(counts.entries())) {
    if (count > bestCount || (count === bestCount && value < best)) { best = value; bestCount = count }
  }
  return best
}

/** Group pdfjs items into visual lines, preserving left-to-right order within each. */
export function groupIntoLines(items: any[]): VisualLine[] {
  const usable = items.filter(i => typeof i?.str === 'string' && i.str.length > 0 && Array.isArray(i.transform))
  if (!usable.length) return []

  const buckets: Array<{ y: number; entries: Array<{ x: number; str: string; size: number }> }> = []
  for (const item of usable) {
    const x = Number(item.transform[4])
    const y = Number(item.transform[5])
    const size = Math.abs(Number(item.transform[3])) || Number(item.height) || 0
    const bucket = buckets.find(b => Math.abs(b.y - y) <= Y_EPSILON)
    if (bucket) bucket.entries.push({ x, str: item.str, size })
    else buckets.push({ y, entries: [{ x, str: item.str, size }] })
  }

  return buckets.map(b => {
    const entries = [...b.entries].sort((p, q) => p.x - q.x)
    let text = ''
    for (const e of entries) {
      if (text && !text.endsWith(' ') && !e.str.startsWith(' ')) text += ' '
      text += e.str
    }
    return {
      y: b.y,
      xStart: entries[0]?.x ?? 0,
      fontSize: median(entries.map(e => e.size).filter(Boolean)),
      text: text.replace(/[ \t]{2,}/g, ' ').trimEnd()
    }
  })
}

/**
 * Two stable left margins separated by a real gap mean a two-column layout —
 * common for the research papers cited as NPL.
 *
 * This MUST run on raw items, before any grouping by y. In a two-column page
 * the left and right lines sit at the SAME vertical position, so grouping first
 * merges "left line 3" and "right line 3" into a single line and the layout
 * becomes undetectable — the columns are already interleaved by then.
 */
export function detectColumns(items: any[]): { columns: number; splitX?: number } {
  const xs = items
    .filter(i => typeof i?.str === 'string' && i.str.trim() && Array.isArray(i.transform))
    .map(i => Number(i.transform[4]))
  if (xs.length < 12) return { columns: 1 }

  const sorted = [...xs].sort((a, b) => a - b)
  if (sorted[sorted.length - 1] - sorted[0] < 100) return { columns: 1 }

  // Widest horizontal gap in the distribution of item start positions.
  let bestGap = 0, splitX = 0
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1]
    if (gap > bestGap) { bestGap = gap; splitX = (sorted[i] + sorted[i - 1]) / 2 }
  }
  if (bestGap < 60) return { columns: 1 }

  const left = xs.filter(x => x < splitX).length
  const minor = Math.min(left, xs.length - left)
  // Both sides must carry real content, or this is an indented block or a
  // right-aligned caption rather than a column.
  if (minor / xs.length < 0.25) return { columns: 1 }
  return { columns: 2, splitX }
}

/**
 * Rebuild a page's text from pdfjs items.
 *
 * The baseline is measured from LINE-TO-LINE distances, never from raw
 * item-to-item deltas: a line contains many items at the same y, so most raw
 * deltas are zero and their median is zero — which would collapse every
 * threshold below to zero and classify everything as a paragraph break.
 */
export function renderPage(items: any[]): { text: string; quality: ExtractionQuality; notes: string[] } {
  const notes: string[] = []
  let quality: ExtractionQuality = 'GOOD'

  // Columns are partitioned on the RAW items — see detectColumns. Grouping into
  // lines first would already have interleaved them.
  const layout = detectColumns(items)
  let ordered: VisualLine[]
  if (layout.columns === 2 && layout.splitX !== undefined) {
    const inLeft = (i: any) => Number(i?.transform?.[4]) < layout.splitX!
    const leftCol = groupIntoLines(items.filter(inLeft)).sort((a, b) => b.y - a.y)
    const rightCol = groupIntoLines(items.filter(i => !inLeft(i))).sort((a, b) => b.y - a.y)
    ordered = [...leftCol, ...rightCol]
    // Reading order is reconstructed, not known. Downstream this becomes
    // UNKNOWN_DOCUMENT_INCOMPLETE rather than a confident absence finding.
    quality = 'PARTIAL'
    notes.push('two-column layout — reading order reconstructed but not certain')
  } else {
    ordered = groupIntoLines(items).sort((a, b) => b.y - a.y)   // PDF y grows upward
  }

  if (!ordered.length) return { text: '', quality: 'GOOD', notes: [] }

  // Line-to-line gaps, excluding same-line noise and section-sized jumps.
  const gaps: number[] = []
  for (let i = 1; i < ordered.length; i++) {
    const d = Math.abs(ordered[i].y - ordered[i - 1].y)
    if (d > Y_EPSILON && d <= UPPER_REASONABLE_GAP) gaps.push(d)
  }
  const baseline = modalGap(gaps)
  const fontSize = median(ordered.map(l => l.fontSize).filter(Boolean))
  const leftMargin = median(ordered.map(l => l.xStart))
  const indentThreshold = leftMargin + Math.max(MIN_INDENT_POINTS, 0.8 * (fontSize || MIN_INDENT_POINTS))

  let out = ordered[0].text
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]
    const line = ordered[i]
    const delta = line.y - prev.y            // negative when flowing down the page
    const gap = Math.abs(delta)

    let separator: string
    if (!baseline) {
      // Single-line page, or no measurable leading: fall back to the old
      // absolute rule rather than inventing a threshold.
      separator = gap > Y_EPSILON ? '\n' : ' '
    } else if (delta > Y_EPSILON) {
      separator = '\n\n'                      // moved UP the page — new column or misordered run
    } else if (gap > PARAGRAPH_GAP_FACTOR * baseline) {
      separator = '\n\n'
    } else if (line.xStart > indentThreshold) {
      separator = '\n\n'                      // first-line indent: many patent PDFs paragraph this way
    } else {
      separator = '\n'                        // ordinary wrap — exactly one newline
    }
    out += separator + line.text
  }

  return {
    text: out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim(),
    quality,
    notes
  }
}

/** Back-compat name used by the older tests and callers. */
export function itemsToText(items: any[]): string {
  return renderPage(items).text
}
