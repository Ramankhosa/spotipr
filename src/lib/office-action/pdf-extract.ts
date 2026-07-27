/**
 * Office Action Studio — PDF text extraction
 *
 * Attorneys upload the FER (and often the specification) as a PDF. This pulls
 * the text layer out with pdfjs — the same library already used elsewhere in the
 * repo — preserving reading order and page breaks, then hands it to the existing
 * furniture cleaner. Scanned/image-only PDFs yield little or no text; the caller
 * detects that (low character yield) and routes to manual entry / OCR.
 */

import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

export interface PdfExtraction {
  text: string
  pageCount: number
  charsPerPage: number
  /** True when the PDF appears to be scanned images with no usable text layer. */
  likelyScanned: boolean
}

const SCANNED_CHARS_PER_PAGE_THRESHOLD = 120

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
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    pages.push(itemsToText(content.items))
  }
  const text = pages.join('\n\n')
  const pageCount = doc.numPages
  const charsPerPage = pageCount ? Math.round(text.replace(/\s/g, '').length / pageCount) : 0

  return { text, pageCount, charsPerPage, likelyScanned: charsPerPage < SCANNED_CHARS_PER_PAGE_THRESHOLD }
}

/**
 * Rebuild lines from pdfjs text items. Items carry a transform matrix; a change
 * in the vertical position starts a new line, which keeps numbered objection
 * lists and table rows readable.
 */
function itemsToText(items: any[]): string {
  let out = ''
  let lastY: number | null = null
  for (const item of items) {
    if (typeof item?.str !== 'string') continue
    const y = Array.isArray(item.transform) ? Math.round(item.transform[5]) : null
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) out += '\n'
    else if (out && !out.endsWith(' ') && !out.endsWith('\n') && item.str && !item.str.startsWith(' ')) out += ' '
    out += item.str
    if (item.hasEOL) out += '\n'
    lastY = y
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}
