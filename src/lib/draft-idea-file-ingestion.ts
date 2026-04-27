import mammoth from 'mammoth'
import AdmZip from 'adm-zip'
import { createRequire } from 'module'
import { MAX_DRAFTING_INPUT_CHARS } from '@/lib/drafting-constants'

const require = createRequire(import.meta.url)

export const DRAFT_IDEA_FILE_MAX_BYTES = 5 * 1024 * 1024

export type DraftIdeaFileFormat = 'txt' | 'doc' | 'docx' | 'pdf'

export type DraftIdeaFileExtractionResult = {
  textContent: string
  fileName: string
  fileSize: number
  detectedFormat: DraftIdeaFileFormat
  warning?: string
}

export class DraftIdeaFileIngestionError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'DraftIdeaFileIngestionError'
    this.status = status
  }
}

type ExtractInput = {
  fileName: string
  mimeType?: string
  buffer: Buffer
}

type ExtractionDependencies = {
  extractDocxText?: (buffer: Buffer) => Promise<string>
  extractDocText?: (buffer: Buffer) => Promise<string>
  extractPdfText?: (buffer: Buffer) => Promise<string>
}

const MIME_TO_FORMAT: Record<string, DraftIdeaFileFormat> = {
  'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/pdf': 'pdf',
}

function normalizeText(text: string) {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function extractTextFromDocxXml(xml: string) {
  const pieces: string[] = []
  const tokenRegex = /<(?:w|a):t\b[^>]*>([\s\S]*?)<\/(?:w|a):t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>|<\/w:p>/g
  let match: RegExpExecArray | null

  while ((match = tokenRegex.exec(xml)) !== null) {
    if (typeof match[1] === 'string') {
      pieces.push(decodeXmlEntities(match[1]))
    } else if (match[0].startsWith('<w:tab')) {
      pieces.push('\t')
    } else {
      pieces.push('\n')
    }
  }

  return pieces.join('')
}

function extractDocxTextFromZip(buffer: Buffer) {
  try {
    const zip = new AdmZip(buffer)
    const entries = zip.getEntries()
    const documentEntries = entries.filter(entry => {
      const name = entry.entryName
      return (
        name === 'word/document.xml' ||
        /^word\/(?:header|footer)\d+\.xml$/.test(name) ||
        ['word/footnotes.xml', 'word/endnotes.xml', 'word/comments.xml'].includes(name) ||
        /^word\/charts\/.*\.xml$/.test(name) ||
        /^word\/diagrams\/.*\.xml$/.test(name)
      )
    })

    documentEntries.sort((a, b) => {
      if (a.entryName === 'word/document.xml') return -1
      if (b.entryName === 'word/document.xml') return 1
      return 0
    })

    return documentEntries
      .map(entry => extractTextFromDocxXml(entry.getData().toString('utf8')))
      .filter(Boolean)
      .join('\n')
  } catch {
    return ''
  }
}

function detectFormat(fileName: string, mimeType?: string): DraftIdeaFileFormat {
  const lower = fileName.toLowerCase()

  if (lower.endsWith('.docx')) return 'docx'
  if (lower.endsWith('.doc')) return 'doc'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.txt')) return 'txt'

  const normalizedMime = (mimeType || '').toLowerCase()
  const format = MIME_TO_FORMAT[normalizedMime]
  if (format) return format

  throw new DraftIdeaFileIngestionError('Unsupported file type. Please upload .txt, .doc, .docx, or .pdf files.')
}

async function defaultExtractDocxText(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

async function defaultExtractPdfText(buffer: Buffer) {
  const pdfParse = require('pdf-parse-fork') as (buffer: Buffer) => Promise<{ text?: string }>
  const result = await pdfParse(buffer)
  return result.text || ''
}

async function defaultExtractDocText(buffer: Buffer) {
  const WordExtractor = require('word-extractor') as new () => {
    extract: (source: Buffer) => Promise<{
      getBody: () => string
      getTextboxes?: () => string
    }>
  }
  const extractor = new WordExtractor()
  const document = await extractor.extract(buffer)
  return [document.getBody(), document.getTextboxes?.() || ''].filter(Boolean).join('\n')
}

async function extractDocxWithFallback(
  buffer: Buffer,
  fileName: string,
  extractFn: (buffer: Buffer) => Promise<string>
): Promise<{ text: string; warning?: string }> {
  let mammothError: Error | null = null

  try {
    const text = await extractFn(buffer)
    if (normalizeText(text)) {
      return { text }
    }
    console.warn('[docx-ingestion] Primary parser returned empty text, trying zip fallback', {
      fileName,
      bufferSize: buffer.byteLength,
    })
  } catch (error) {
    mammothError = error instanceof Error ? error : new Error(String(error))
    console.error('[docx-ingestion] Primary parser failed, trying zip fallback', {
      fileName,
      bufferSize: buffer.byteLength,
      error: mammothError.message,
      stack: mammothError.stack,
    })
  }

  const zipText = extractDocxTextFromZip(buffer)
  if (normalizeText(zipText)) {
    return {
      text: zipText,
      ...(mammothError
        ? { warning: 'File was processed using fallback extraction. Some formatting may have been lost.' }
        : {}),
    }
  }

  throw new DraftIdeaFileIngestionError(
    'Could not extract text from this .docx file. Please save it as .txt and upload again.'
  )
}

function assertUsableText(text: string, format: DraftIdeaFileFormat) {
  if (!text) {
    if (format === 'pdf') {
      throw new DraftIdeaFileIngestionError('No readable text was found. Scanned PDFs are not supported yet.')
    }
    throw new DraftIdeaFileIngestionError('File appears to be empty or contains no readable text.')
  }

  if (text.length > MAX_DRAFTING_INPUT_CHARS) {
    throw new DraftIdeaFileIngestionError(
      `File content exceeds ${MAX_DRAFTING_INPUT_CHARS.toLocaleString()} characters. Please shorten the document and try again.`
    )
  }
}

export async function extractDraftIdeaTextFromBuffer(
  input: ExtractInput,
  dependencies: ExtractionDependencies = {}
): Promise<DraftIdeaFileExtractionResult> {
  const detectedFormat = detectFormat(input.fileName, input.mimeType)

  let rawText = ''
  let warning: string | undefined

  try {
    if (detectedFormat === 'txt') {
      rawText = input.buffer.toString('utf8')
    } else if (detectedFormat === 'docx') {
      const docxResult = await extractDocxWithFallback(
        input.buffer,
        input.fileName,
        dependencies.extractDocxText || defaultExtractDocxText
      )
      rawText = docxResult.text
      warning = docxResult.warning
    } else if (detectedFormat === 'pdf') {
      rawText = await (dependencies.extractPdfText || defaultExtractPdfText)(input.buffer)
    } else {
      rawText = await (dependencies.extractDocText || defaultExtractDocText)(input.buffer)
    }
  } catch (error) {
    if (error instanceof DraftIdeaFileIngestionError) throw error
    if (detectedFormat === 'doc') {
      throw new DraftIdeaFileIngestionError('Could not extract text from this .doc file. Please save it as .docx or .txt and upload again.')
    } else if (detectedFormat === 'pdf') {
      throw new DraftIdeaFileIngestionError('No readable text was found. Scanned PDFs are not supported yet.')
    } else {
      throw error
    }
  }

  const textContent = normalizeText(rawText)
  assertUsableText(textContent, detectedFormat)

  return {
    textContent,
    fileName: input.fileName,
    fileSize: input.buffer.byteLength,
    detectedFormat,
    ...(warning ? { warning } : {}),
  }
}
