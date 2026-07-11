import mammoth from 'mammoth'
import AdmZip from 'adm-zip'
import * as XLSX from 'xlsx'
import { createRequire } from 'module'
import crypto from 'crypto'
import { imageSize } from 'image-size'
import { MAX_DRAFTING_INPUT_CHARS, MAX_DRAFTING_UPLOAD_BYTES } from '@/lib/drafting-constants'

const require = createRequire(import.meta.url)

export const DRAFT_IDEA_FILE_MAX_BYTES = MAX_DRAFTING_UPLOAD_BYTES

export type DraftIdeaFileFormat = 'txt' | 'md' | 'csv' | 'tsv' | 'xlsx' | 'doc' | 'docx' | 'pdf'

export type DraftIdeaExtractedImage = {
  id: string
  fileName: string
  mimeType: string
  size: number
  dataUrl: string
  source: 'docx' | 'xlsx' | 'pdf-page'
  label: string
  width?: number
  height?: number
}

export type DraftIdeaFileExtractionResult = {
  textContent: string
  fileName: string
  fileSize: number
  detectedFormat: DraftIdeaFileFormat
  images: DraftIdeaExtractedImage[]
  sourceInputMeta: {
    originalFileName: string
    mimeType?: string
    fileSize: number
    detectedFormat: DraftIdeaFileFormat
    extractedCharCount: number
    extractedImageCount: number
    extractionHash: string
    extractedAt: string
  }
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
  extractImages?: (input: ExtractInput, format: DraftIdeaFileFormat) => Promise<DraftIdeaExtractedImage[]>
}

const MIME_TO_FORMAT: Record<string, DraftIdeaFileFormat> = {
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
  'text/csv': 'csv',
  'application/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/pdf': 'pdf',
}

const SUPPORTED_FILE_TYPES_MESSAGE = 'Unsupported file type. Please upload .txt, .md, .csv, .tsv, .xlsx, .doc, .docx, or .pdf files.'
const MAX_EXTRACTED_IMAGES = 12
const MAX_EXTRACTED_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_EXTRACTED_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024
const PDF_SNAPSHOT_MAX_PAGES = 12
const PDF_SNAPSHOT_MAX_SIDE = 1600
const PDF_SNAPSHOT_MAX_PIXELS = 1600 * 1200

const EXTENSION_TO_FORMAT: Record<string, DraftIdeaFileFormat> = {
  xlsx: 'xlsx',
  docx: 'docx',
  doc: 'doc',
  pdf: 'pdf',
  md: 'md',
  markdown: 'md',
  csv: 'csv',
  tsv: 'tsv',
  txt: 'txt',
}

const IMAGE_EXTENSION_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
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

function fileExtension(name: string) {
  const match = /\.([a-z0-9]+)$/i.exec(name)
  return match?.[1]?.toLowerCase() || ''
}

function imageMimeTypeForName(name: string) {
  return IMAGE_EXTENSION_TO_MIME[fileExtension(name)]
}

function sanitizeImageFileName(name: string, index: number, mimeType: string) {
  const extensionFromName = fileExtension(name)
  const fallbackExtension = mimeType === 'image/jpeg'
    ? 'jpg'
    : mimeType === 'image/svg+xml'
      ? 'svg'
      : mimeType.split('/')[1] || 'png'
  const extension = IMAGE_EXTENSION_TO_MIME[extensionFromName] ? extensionFromName : fallbackExtension
  const base = name
    .replace(/[\\/]/g, '-')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `image-${index}`
  return `${base}.${extension}`
}

function readImageDimensions(buffer: Buffer, mimeType: string) {
  if (mimeType === 'image/svg+xml') return {}
  try {
    const dimensions = imageSize(buffer)
    return {
      ...(dimensions.width ? { width: dimensions.width } : {}),
      ...(dimensions.height ? { height: dimensions.height } : {}),
    }
  } catch {
    return {}
  }
}

function buildExtractedImage(params: {
  buffer: Buffer
  originalName: string
  source: DraftIdeaExtractedImage['source']
  label: string
  index: number
}): DraftIdeaExtractedImage | null {
  const mimeType = imageMimeTypeForName(params.originalName)
  if (!mimeType) return null
  if (params.buffer.byteLength === 0 || params.buffer.byteLength > MAX_EXTRACTED_IMAGE_BYTES) return null

  const hash = crypto.createHash('sha256').update(params.buffer).digest('hex')
  const sanitizedName = sanitizeImageFileName(params.originalName, params.index, mimeType)
  const extension = fileExtension(sanitizedName)
  const base = sanitizedName.replace(/\.[a-z0-9]+$/i, '')
  const fileName = `${base}-${hash.slice(0, 10)}.${extension}`
  return {
    id: `${params.source}-${hash.slice(0, 16)}`,
    fileName,
    mimeType,
    size: params.buffer.byteLength,
    dataUrl: `data:${mimeType};base64,${params.buffer.toString('base64')}`,
    source: params.source,
    label: params.label,
    ...readImageDimensions(params.buffer, mimeType),
  }
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

function extractImagesFromZipEntries(
  buffer: Buffer,
  source: 'docx' | 'xlsx',
  entryPrefix: string
): DraftIdeaExtractedImage[] {
  try {
    const zip = new AdmZip(buffer)
    const seenHashes = new Set<string>()
    const images: DraftIdeaExtractedImage[] = []
    let totalBytes = 0

    const mediaEntries = zip.getEntries()
      .filter(entry => !entry.isDirectory && entry.entryName.startsWith(entryPrefix))
      .filter(entry => !!imageMimeTypeForName(entry.entryName))
      .sort((a, b) => a.entryName.localeCompare(b.entryName))

    for (const entry of mediaEntries) {
      if (images.length >= MAX_EXTRACTED_IMAGES) break

      const imageBuffer = entry.getData()
      if (imageBuffer.byteLength === 0 || imageBuffer.byteLength > MAX_EXTRACTED_IMAGE_BYTES) continue
      if (totalBytes + imageBuffer.byteLength > MAX_EXTRACTED_IMAGE_TOTAL_BYTES) break

      const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex')
      if (seenHashes.has(hash)) continue
      seenHashes.add(hash)

      const image = buildExtractedImage({
        buffer: imageBuffer,
        originalName: entry.entryName.split('/').pop() || `image-${images.length + 1}`,
        source,
        label: source === 'docx'
          ? `Embedded document image ${images.length + 1}`
          : `Embedded spreadsheet image ${images.length + 1}`,
        index: images.length + 1,
      })
      if (!image) continue

      images.push(image)
      totalBytes += imageBuffer.byteLength
    }

    return images
  } catch {
    return []
  }
}

async function extractPdfPageSnapshots(buffer: Buffer): Promise<DraftIdeaExtractedImage[]> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const nodeRequire = (0, eval)('require') as (moduleName: string) => unknown
    const { createCanvas } = nodeRequire('@napi-rs/canvas') as {
      createCanvas: (width: number, height: number) => {
        getContext: (contextType: '2d') => unknown
        toBuffer: (mimeType: 'image/png') => Buffer
      }
    }

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      useSystemFonts: true,
    })
    const pdf = await loadingTask.promise
    const imageOps = new Set([
      pdfjs.OPS?.paintImageXObject,
      pdfjs.OPS?.paintInlineImageXObject,
      pdfjs.OPS?.paintJpegXObject,
      pdfjs.OPS?.paintImageMaskXObject,
    ].filter((value): value is number => typeof value === 'number'))

    const snapshots: DraftIdeaExtractedImage[] = []
    let totalBytes = 0
    const pageCount = Math.min(Number(pdf.numPages) || 0, PDF_SNAPSHOT_MAX_PAGES)

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      if (snapshots.length >= MAX_EXTRACTED_IMAGES) break

      const page = await pdf.getPage(pageNumber)
      try {
        const operatorList = await page.getOperatorList()
        const hasImage = Array.isArray(operatorList?.fnArray) && operatorList.fnArray.some((fn: number) => imageOps.has(fn))
        if (!hasImage) continue

        const baseViewport = page.getViewport({ scale: 1 })
        const scaleBySide = PDF_SNAPSHOT_MAX_SIDE / Math.max(baseViewport.width, baseViewport.height)
        const scaleByPixels = Math.sqrt(PDF_SNAPSHOT_MAX_PIXELS / (baseViewport.width * baseViewport.height))
        const scale = Math.min(1.5, scaleBySide, scaleByPixels)
        const viewport = page.getViewport({ scale })
        const width = Math.max(1, Math.floor(viewport.width))
        const height = Math.max(1, Math.floor(viewport.height))
        const canvas = createCanvas(width, height)
        const canvasContext = canvas.getContext('2d')

        await page.render({ canvasContext, viewport }).promise
        const imageBuffer = canvas.toBuffer('image/png')
        if (imageBuffer.byteLength > MAX_EXTRACTED_IMAGE_BYTES) continue
        if (totalBytes + imageBuffer.byteLength > MAX_EXTRACTED_IMAGE_TOTAL_BYTES) break

        const image = buildExtractedImage({
          buffer: imageBuffer,
          originalName: `pdf-page-${pageNumber}.png`,
          source: 'pdf-page',
          label: `PDF page ${pageNumber} image snapshot`,
          index: snapshots.length + 1,
        })
        if (!image) continue

        snapshots.push(image)
        totalBytes += imageBuffer.byteLength
      } finally {
        page.cleanup?.()
      }
    }

    await pdf.destroy?.()
    return snapshots
  } catch {
    return []
  }
}

async function extractImagesFromBuffer(input: ExtractInput, format: DraftIdeaFileFormat) {
  if (format === 'docx') {
    return extractImagesFromZipEntries(input.buffer, 'docx', 'word/media/')
  }
  if (format === 'xlsx') {
    return extractImagesFromZipEntries(input.buffer, 'xlsx', 'xl/media/')
  }
  if (format === 'pdf') {
    return extractPdfPageSnapshots(input.buffer)
  }
  return []
}

function extractDocxTextFromZip(buffer: Buffer, fileName?: string) {
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
  } catch (error) {
    const caught = error instanceof Error ? error : new Error(String(error))
    console.warn('[docx-ingestion] Zip fallback extraction failed', {
      fileName,
      bufferSize: buffer.byteLength,
      error: caught.message,
    })
    return ''
  }
}

function detectFormat(fileName: string, mimeType?: string): DraftIdeaFileFormat {
  const lower = fileName.toLowerCase()
  const baseName = lower.split(/[\\/]/).pop() || lower
  const extensionMatch = /\.([a-z0-9]+)$/.exec(baseName)
  const extension = extensionMatch?.[1]
  if (extension) {
    const extensionFormat = EXTENSION_TO_FORMAT[extension]
    if (extensionFormat) return extensionFormat
    throw new DraftIdeaFileIngestionError(SUPPORTED_FILE_TYPES_MESSAGE)
  }

  const normalizedMime = (mimeType || '').toLowerCase()
  const format = MIME_TO_FORMAT[normalizedMime]
  if (format) return format

  throw new DraftIdeaFileIngestionError(SUPPORTED_FILE_TYPES_MESSAGE)
}

function escapeMarkdownTableCell(value: unknown) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

function xlsxRowsToMarkdown(sheetName: string, rows: unknown[][]) {
  const populatedRows = rows
    .map(row => row.map(cell => escapeMarkdownTableCell(cell)))
    .filter(row => row.some(cell => cell.length > 0))
  if (!populatedRows.length) return ''

  const columnCount = Math.max(...populatedRows.map(row => row.length))
  const normalizedRows = populatedRows.map(row => Array.from({ length: columnCount }, (_, index) => row[index] || ''))
  const header = normalizedRows[0].some(Boolean)
    ? normalizedRows[0]
    : Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`)
  const body = normalizedRows[0].some(Boolean) ? normalizedRows.slice(1) : normalizedRows
  const lines = [
    `# Sheet: ${sheetName}`,
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`),
  ]
  return lines.join('\n')
}

function extractXlsxText(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  return workbook.SheetNames
    .map((sheetName) => {
      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: '',
      }) as unknown[][]
      return xlsxRowsToMarkdown(sheetName, rows)
    })
    .filter(Boolean)
    .join('\n\n')
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

  const zipText = extractDocxTextFromZip(buffer, fileName)
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
    if (['txt', 'md', 'csv', 'tsv'].includes(detectedFormat)) {
      rawText = input.buffer.toString('utf8')
    } else if (detectedFormat === 'xlsx') {
      rawText = extractXlsxText(input.buffer)
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
    } else if (detectedFormat === 'xlsx') {
      throw new DraftIdeaFileIngestionError('Could not extract text from this .xlsx file. Please save it as .csv or .txt and upload again.')
    } else if (detectedFormat === 'pdf') {
      throw new DraftIdeaFileIngestionError('No readable text was found. Scanned PDFs are not supported yet.')
    } else {
      throw error
    }
  }

  const textContent = normalizeText(rawText)
  assertUsableText(textContent, detectedFormat)
  const images = await (dependencies.extractImages || extractImagesFromBuffer)(input, detectedFormat)

  return {
    textContent,
    fileName: input.fileName,
    fileSize: input.buffer.byteLength,
    detectedFormat,
    images,
    sourceInputMeta: {
      originalFileName: input.fileName,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      fileSize: input.buffer.byteLength,
      detectedFormat,
      extractedCharCount: textContent.length,
      extractedImageCount: images.length,
      extractionHash: crypto.createHash('sha256').update(textContent, 'utf8').digest('hex'),
      extractedAt: new Date().toISOString(),
    },
    ...(warning ? { warning } : {}),
  }
}
