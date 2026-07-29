import { extractPdfText } from './pdf-extract'
import { ACCEPTED_UPLOAD_LABEL } from './upload-formats'

/**
 * Office Action Studio — uploaded-file text extraction
 *
 * Every OA upload path (the examination report itself, the as-filed
 * specification/claims, supplementary material) funnels through here so the
 * accepted formats and the error messages are identical everywhere.
 *
 * Attorneys hold the drafted specification as .docx far more often than as PDF,
 * so DOCX is a first-class input — previously any non-PDF upload was decoded as
 * UTF-8, which turned a Word file into binary noise and stored it as the
 * "specification" without complaint.
 *
 * Format is detected from magic bytes first (a mis-named file still works) and
 * only then from the extension / MIME type.
 */

export type UploadFormat = 'pdf' | 'docx' | 'text'

export interface ExtractedUpload {
  text: string
  format: UploadFormat
  /** PDF only. */
  pageCount?: number
  charsPerPage?: number
  /** Non-fatal note for the attorney (e.g. a degraded DOCX read). */
  warning?: string
}

/** Thrown when the file cannot yield usable text; `status` is the HTTP status the route should return. */
export class UnreadableUploadError extends Error {
  status: number
  detail?: Record<string, unknown>
  constructor(message: string, status = 415, detail?: Record<string, unknown>) {
    super(message)
    this.name = 'UnreadableUploadError'
    this.status = status
    this.detail = detail
  }
}

export { ACCEPTED_UPLOAD_EXTENSIONS, ACCEPTED_UPLOAD_LABEL, MAX_OA_UPLOAD_BYTES } from './upload-formats'

const startsWith = (buf: Buffer, bytes: number[]) =>
  buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b)

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]              // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]              // PK.. — docx/xlsx/pptx container
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]              // legacy .doc / .xls

const LEGACY_DOC_MESSAGE =
  'This is a legacy Word (.doc) file. Open it in Word and save it as .docx or PDF, then upload again.'

function detectFormat(buf: Buffer, fileName?: string, mimeType?: string, label = 'document'): UploadFormat {
  if (startsWith(buf, PDF_MAGIC)) return 'pdf'
  if (startsWith(buf, OLE_MAGIC)) throw new UnreadableUploadError(LEGACY_DOC_MESSAGE)
  if (startsWith(buf, ZIP_MAGIC)) {
    const name = (fileName || '').toLowerCase()
    if (name.endsWith('.docx') || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return 'docx'
    }
    // A zip that is not a Word document (xlsx/pptx/plain archive) has no text we
    // can trust as the document the attorney meant to file.
    throw new UnreadableUploadError(
      `This file is a zipped archive, not a document. Upload the ${label} as ${ACCEPTED_UPLOAD_LABEL}.`
    )
  }

  const name = (fileName || '').toLowerCase()
  if (name.endsWith('.pdf') || mimeType === 'application/pdf') return 'pdf'
  if (name.endsWith('.docx')) return 'docx'
  if (name.endsWith('.doc')) throw new UnreadableUploadError(LEGACY_DOC_MESSAGE)
  return 'text'
}

/** Decode a plain-text upload, honouring the BOMs Windows editors write. */
function decodeText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16BE — swap to LE then decode.
    const swapped = Buffer.from(buf.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  return buf.toString('utf8')
}

/**
 * Guard against a binary file that slipped past detection being stored as
 * "text". Sampled, so a large upload costs nothing.
 */
function looksBinary(text: string): boolean {
  const sample = text.slice(0, 4000)
  if (!sample) return false
  let control = 0
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i)
    if (c === 0) return true                                  // a NUL never appears in real text
    // Control characters other than tab/newline/carriage-return, plus U+FFFD
    // (what a mis-decoded byte becomes).
    if ((c < 0x20 && c !== 9 && c !== 10 && c !== 13) || c === 0xfffd) control++
  }
  return control / sample.length > 0.05
}

/** Last-resort DOCX read: pull word/document.xml straight out of the zip. */
async function docxTextFromZip(buf: Buffer): Promise<string> {
  try {
    const AdmZip = (await import('adm-zip')).default as any
    const zip = new AdmZip(buf)
    const entry = zip.getEntry('word/document.xml')
    if (!entry) return ''
    const xml: string = zip.readAsText(entry)
    return xml
      // A BLANK line between paragraphs, not a single newline. With one newline
      // the downstream splitter (which needs /\n\s*\n+/) never matches, so an
      // entire specification collapsed into a single paragraph — which in turn
      // made the amendment-basis word-overlap check vacuous, because every word
      // in the document was "in" the one giant basis paragraph.
      .replace(/<\/w:p>/g, '</w:p>\n\n')
      .replace(/<w:p\s*\/>/g, '\n\n')             // empty self-closing paragraph
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')                     // last: an escaped &amp;lt; must not become <
      .replace(/\n{3,}/g, '\n\n')
  } catch {
    return ''
  }
}

async function extractDocx(buf: Buffer): Promise<ExtractedUpload> {
  let text = ''
  let warning: string | undefined
  try {
    const mammoth = (await import('mammoth')).default
    const result = await mammoth.extractRawText({ buffer: buf })
    text = result.value || ''
  } catch (err) {
    console.warn('[OA upload] mammoth failed, falling back to raw zip read:', err instanceof Error ? err.message : err)
  }
  if (!text.trim()) {
    text = await docxTextFromZip(buf)
    if (text.trim()) warning = 'This Word file needed a fallback reader — check the text on file before drafting.'
  }
  if (!text.trim()) {
    throw new UnreadableUploadError(
      'No text could be read from this Word file. Save it as PDF, or paste the text instead.',
      422
    )
  }
  return { text, format: 'docx', warning }
}

/**
 * Extract text from an uploaded file.
 * @param opts.label what the file is, used in error copy (e.g. "examination report", "specification").
 */
export async function extractUploadText(
  buf: Buffer,
  opts: { fileName?: string; mimeType?: string; label?: string } = {}
): Promise<ExtractedUpload> {
  const label = opts.label || 'document'
  const format = detectFormat(buf, opts.fileName, opts.mimeType, label)

  if (format === 'pdf') {
    const extracted = await extractPdfText(buf)
    if (extracted.likelyScanned) {
      throw new UnreadableUploadError(
        `This ${label} appears to be a scan with no text layer. Upload a text-based PDF or Word file, or paste the text instead.`,
        422,
        { pageCount: extracted.pageCount, charsPerPage: extracted.charsPerPage }
      )
    }
    return {
      text: extracted.text,
      format: 'pdf',
      pageCount: extracted.pageCount,
      charsPerPage: extracted.charsPerPage
    }
  }

  if (format === 'docx') return extractDocx(buf)

  const text = decodeText(buf)
  if (looksBinary(text)) {
    throw new UnreadableUploadError(
      `This file is not readable as text. Upload the ${label} as ${ACCEPTED_UPLOAD_LABEL}.`
    )
  }
  return { text, format: 'text' }
}
