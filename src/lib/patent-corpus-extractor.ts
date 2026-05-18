import crypto from 'crypto'
import path from 'path'
import { pathToFileURL } from 'url'

export const PATENT_CORPUS_EXTRACTION_VERSION = 'indian-journal-layout-v1'

export type PdfTextSegment = {
  text: string
  x0: number
  x1: number
  y0: number
  y1: number
  height: number
}

export type PdfLayoutLine = {
  text: string
  x0: number
  x1: number
  y0: number
  y1: number
  segments: PdfTextSegment[]
}

export type PdfPageModel = {
  pageNumber: number
  width: number
  height: number
  segments: PdfTextSegment[]
  lines: PdfLayoutLine[]
  rawText: string
}

export type ParsedApplicant = {
  sequence: number
  name: string
  address?: string
  commonAddress?: string
  raw: string
}

export type ExtractedPatentRecord = {
  publicationNumber: string
  applicationNumberRaw: string | null
  kind: string | null
  country: string | null
  filingDate: Date | null
  publicationDate: Date | null
  title: string
  abstract: string | null
  abstractOriginal: string | null
  applicants: ParsedApplicant[]
  inventors: string[]
  classifications: string[]
  rawApplicantBlock: string | null
  rawInventorBlock: string | null
  rawClassificationBlock: string | null
  rawText: string
  numberOfPages: number | null
  numberOfClaims: number | null
  sourcePageNumber: number
  ragText: string
  embeddingText: string
  extractionVersion: string
  extractionConfidence: number
  extractionWarnings: string[]
}

export type ExtractPdfResult = {
  totalPages: number
  records: ExtractedPatentRecord[]
  ignoredPages: number
  lowConfidencePages: number
  warningCount: number
}

type AnchorPosition = {
  y: number
  x: number
  line: PdfLayoutLine
}

const PATENT_ANCHOR_PATTERNS = [
  /\(12\)\s*PATENT\s+APPLICATION\s+PUBLICATION/i,
  /\(21\)\s*Application\s+No\.?/i,
  /\(22\)\s*Date\s+of\s+filing/i,
  /\(43\)\s*Publication\s+Date/i,
  /\(54\)\s*Title\s+of\s+the\s+invention/i,
  /\(51\)\s*International\s+classification/i,
  /\(71\)\s*Name\s+of\s+Applicant/i,
  /\(72\)\s*Name\s+of\s+Inventor/i,
  /\(57\)\s*Abstract/i,
]

const FOOTER_PATTERNS = [
  /The Patent Office Journal No\./i,
  /^\d{4,6}$/,
]

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizePatentText(value: string) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
}

function normalizeForMatching(value: string) {
  return compactWhitespace(
    normalizePatentText(value)
      .replace(/\((\d{2})\)\s*Name/g, '($1) Name')
      .replace(/\((\d{2})\)\s*Title/g, '($1) Title')
  )
}

function median(values: number[]) {
  if (!values.length) return 8
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export function segmentsToLines(segments: PdfTextSegment[]): PdfLayoutLine[] {
  const meaningful = segments
    .filter(segment => compactWhitespace(segment.text))
    .sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0))

  const lineHeight = median(meaningful.map(segment => segment.height).filter(height => height > 0))
  const tolerance = Math.max(2.5, lineHeight * 0.65)
  const buckets: PdfTextSegment[][] = []

  for (const segment of meaningful) {
    const bucket = buckets.find(candidate => Math.abs(median(candidate.map(item => item.y0)) - segment.y0) <= tolerance)
    if (bucket) {
      bucket.push(segment)
    } else {
      buckets.push([segment])
    }
  }

  return buckets
    .map(bucket => {
      const sorted = bucket.sort((a, b) => a.x0 - b.x0)
      const parts: string[] = []
      let previous: PdfTextSegment | null = null
      const averageHeight = median(sorted.map(item => item.height).filter(Boolean))

      for (const item of sorted) {
        if (previous) {
          const gap = item.x0 - previous.x1
          if (gap > averageHeight * 1.6) parts.push(' ')
        }
        parts.push(item.text)
        previous = item
      }

      return {
        text: normalizePatentText(parts.join('')),
        x0: Math.min(...sorted.map(item => item.x0)),
        x1: Math.max(...sorted.map(item => item.x1)),
        y0: Math.min(...sorted.map(item => item.y0)),
        y1: Math.max(...sorted.map(item => item.y1)),
        segments: sorted,
      }
    })
    .sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0))
}

function linesToText(lines: PdfLayoutLine[]) {
  return lines
    .sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0))
    .map(line => compactWhitespace(line.text))
    .filter(Boolean)
    .join('\n')
}

function isFooterLine(line: PdfLayoutLine, pageHeight: number) {
  const text = compactWhitespace(line.text)
  if (!text) return true
  const nearBottom = line.y0 > pageHeight - 155
  return nearBottom && FOOTER_PATTERNS.some(pattern => pattern.test(text))
}

function filterNoiseLines(lines: PdfLayoutLine[], pageHeight: number) {
  return lines.filter(line => !isFooterLine(line, pageHeight))
}

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
  ).href
  return pdfjs
}

export async function extractPdfPageModels(buffer: Buffer): Promise<PdfPageModel[]> {
  const pdfjs = await loadPdfjs()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    disableFontFace: true,
    useSystemFonts: true,
    isEvalSupported: false,
  })
  const document = await loadingTask.promise
  const pages: PdfPageModel[] = []

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent({ includeMarkedContent: false })
    const segments: PdfTextSegment[] = []

    for (const item of content.items as any[]) {
      const text = typeof item.str === 'string' ? item.str : ''
      if (!compactWhitespace(text)) continue

      const transform = item.transform || [0, 0, 0, 0, 0, 0]
      const x = Number(transform[4] || 0)
      const y = Number(transform[5] || 0)
      const height = Math.abs(Number(item.height || transform[3] || transform[0] || 8)) || 8
      const width = Math.max(0, Number(item.width || 0))
      const yTop = Number(viewport.height) - y - height

      segments.push({
        text,
        x0: x,
        x1: x + width,
        y0: yTop,
        y1: yTop + height,
        height,
      })
    }

    const lines = filterNoiseLines(segmentsToLines(segments), Number(viewport.height))
    pages.push({
      pageNumber,
      width: Number(viewport.width),
      height: Number(viewport.height),
      segments,
      lines,
      rawText: linesToText(lines),
    })
  }

  await document.destroy()
  return pages
}

function findAnchor(lines: PdfLayoutLine[], pattern: RegExp, minY = -Infinity, maxY = Infinity): AnchorPosition | null {
  for (const line of lines) {
    if (line.y0 < minY || line.y0 >= maxY) continue
    if (pattern.test(normalizeForMatching(line.text))) {
      const code = pattern.source.match(/\\\((\d{2})\\\)/)?.[1]
      const segment = code
        ? line.segments.find(item => new RegExp(`\\(${code}\\)`).test(item.text))
        : undefined
      return { y: line.y0, x: segment?.x0 ?? line.x0, line }
    }
  }
  return null
}

function patentPageScore(lines: PdfLayoutLine[]) {
  const text = normalizeForMatching(lines.map(line => line.text).join('\n'))
  return PATENT_ANCHOR_PATTERNS.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0)
}

function getPatentWindows(page: PdfPageModel) {
  const starts = page.lines
    .filter(line => /\(12\)\s*PATENT\s+APPLICATION\s+PUBLICATION/i.test(normalizeForMatching(line.text)))
    .map(line => line.y0)
    .sort((a, b) => a - b)

  if (!starts.length) {
    return [{ y0: 0, y1: page.height }]
  }

  return starts.map((start, index) => ({
    y0: Math.max(0, start - 2),
    y1: index + 1 < starts.length ? starts[index + 1] - 2 : page.height,
  }))
}

function linesInWindow(page: PdfPageModel, y0: number, y1: number) {
  return page.lines.filter(line => line.y0 >= y0 && line.y0 < y1)
}

function segmentsInRegion(page: PdfPageModel, bounds: { x0?: number; x1?: number; y0?: number; y1?: number }) {
  const minX = bounds.x0 ?? -Infinity
  const maxX = bounds.x1 ?? Infinity
  const minY = bounds.y0 ?? -Infinity
  const maxY = bounds.y1 ?? Infinity

  return page.segments.filter(segment => {
    const centerY = (segment.y0 + segment.y1) / 2
    const overlapsX = segment.x1 >= minX && segment.x0 <= maxX
    return overlapsX && centerY >= minY && centerY <= maxY
  })
}

function textInRegion(page: PdfPageModel, bounds: { x0?: number; x1?: number; y0?: number; y1?: number }) {
  return linesToText(segmentsToLines(segmentsInRegion(page, bounds)))
}

function stripLabel(value: string, label: RegExp) {
  return compactWhitespace(value.replace(label, '').replace(/^[:\s]+/, ''))
}

function parseDate(value: string | null) {
  if (!value) return null
  const match = value.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (!day || !month || !year) return null
  return new Date(Date.UTC(year, month - 1, day))
}

function parseNumberedList(value: string) {
  const text = compactWhitespace(value)
  const matches: RegExpExecArray[] = []
  const markerRegex = /(?:^|\s)(\d+)\)\s*/g
  let markerMatch: RegExpExecArray | null
  while ((markerMatch = markerRegex.exec(text)) !== null) {
    matches.push(markerMatch)
  }
  if (!matches.length) {
    const only = compactWhitespace(text)
    return only ? [{ sequence: 1, value: only, raw: only }] : []
  }

  return matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length
    const end = index + 1 < matches.length ? matches[index + 1].index || text.length : text.length
    const raw = text.slice(start, end)
    return {
      sequence: Number(match[1]) || index + 1,
      value: compactWhitespace(raw),
      raw: compactWhitespace(`${match[1]}) ${raw}`),
    }
  }).filter(item => item.value)
}

export function parseApplicants(rawBlock: string | null): ParsedApplicant[] {
  if (!rawBlock) return []
  const cleaned = stripLabel(
    normalizePatentText(rawBlock)
      .replace(/\(72\)\s*Name\s+of\s+Inventor\s*:?.*$/i, '')
      .replace(/\(71\)\s*Name\s+of\s+Applicant\s*:?/i, ''),
    /^/
  )

  const addressMatch = cleaned.match(/Address\s+of\s+Applicant\s*:?\s*/i)
  if (!addressMatch || addressMatch.index == null) {
    return parseNumberedList(cleaned).map(item => ({
      sequence: item.sequence,
      name: item.value,
      raw: item.raw,
    }))
  }

  const beforeAddress = cleaned.slice(0, addressMatch.index)
  const afterLabel = cleaned.slice(addressMatch.index + addressMatch[0].length)
  const nextNumber = afterLabel.search(/(?:^|\s)\d+\)\s*/)
  const address = compactWhitespace(nextNumber >= 0 ? afterLabel.slice(0, nextNumber) : afterLabel)
  const trailingNames = nextNumber >= 0 ? afterLabel.slice(nextNumber) : ''
  const beforeEntries = parseNumberedList(beforeAddress)
  const trailingEntries = parseNumberedList(trailingNames)
  const allEntries = [...beforeEntries, ...trailingEntries]

  if (!allEntries.length) {
    return []
  }

  const commonAddress = beforeEntries.length > 1 && trailingEntries.length === 0 ? address : undefined
  return allEntries.map((item, index) => ({
    sequence: item.sequence || index + 1,
    name: item.value,
    raw: item.raw,
    ...(address && beforeEntries.length === 1 && index === 0 ? { address } : {}),
    ...(commonAddress ? { commonAddress } : {}),
  }))
}

export function parseInventors(rawBlock: string | null) {
  if (!rawBlock) return []
  const cleaned = stripLabel(
    normalizePatentText(rawBlock)
      .replace(/\(72\)\s*Name\s+of\s+Inventor\s*:?/i, '')
      .replace(/\(57\)\s*Abstract\s*:?.*$/i, ''),
    /^/
  )
  return parseNumberedList(cleaned).map(item => item.value)
}

export function normalizeClassifications(rawBlock: string | null) {
  if (!rawBlock) return []
  const withoutLabel = normalizePatentText(rawBlock)
    .replace(/\(51\)\s*International\s+classification/i, '')
    .replace(/\((31|32|33|86|87|61|62|57)\).*$/i, '')
    .replace(/International\s+classification/i, '')
    .replace(/\|/g, ' ')
    .replace(/^[:\s,]+/, '')

  const normalized = compactWhitespace(withoutLabel)
  if (!normalized || /^:?NA$/i.test(normalized)) return []

  const matches = normalized.match(/[A-H]\d{2}[A-Z]\s*\d+[A-Z0-9]*(?:\/\d+[A-Z0-9]*)?/g)
  if (matches?.length) {
    return Array.from(new Set(matches.map(item => compactWhitespace(item).replace(/\s+/, ' '))))
  }

  return Array.from(new Set(
    normalized
      .split(/[,\n;]/)
      .map(item => compactWhitespace(item.replace(/^:/, '')))
      .filter(item => item && !/^NA$/i.test(item))
  ))
}

function parseApplicationNumber(text: string) {
  const match = text.match(/\(21\)\s*Application\s+No\.?\s*:?\s*([A-Z]{0,3}\s*\d[\d/ -]{5,}\s*[A-Z]?)\b/i)
  if (!match) return { raw: null, kind: null, publicationNumber: null }
  const raw = compactWhitespace(match[1])
  const kindMatch = raw.match(/\b([A-Z])$/)
  const digits = raw.replace(/[^0-9]/g, '')
  const kind = kindMatch?.[1] || null
  const publicationNumber = digits ? `IN${digits}${kind || ''}` : null
  return { raw, kind, publicationNumber }
}

function makeSyntheticPublicationNumber(sourceFileHash: string, pageNumber: number, rawText: string) {
  const digest = crypto.createHash('sha1').update(`${sourceFileHash}:${pageNumber}:${rawText}`).digest('hex').slice(0, 10).toUpperCase()
  return `UNPARSED-${sourceFileHash.slice(0, 8).toUpperCase()}-P${pageNumber}-${digest}`
}

function parseCounts(text: string) {
  const match = text.match(/No\.\s*of\s*Pages\s*:\s*(\d+)\s*No\.\s*of\s*Claims\s*:\s*(\d+)/i)
  return {
    numberOfPages: match ? Number(match[1]) : null,
    numberOfClaims: match ? Number(match[2]) : null,
  }
}

function buildRagText(record: {
  title: string
  abstract: string | null
  classifications: string[]
  applicants: ParsedApplicant[]
  inventors: string[]
}) {
  return [
    `Title: ${record.title}`,
    record.abstract ? `Abstract: ${record.abstract}` : '',
    record.classifications.length ? `Classifications: ${record.classifications.join(', ')}` : '',
    record.applicants.length ? `Applicants: ${record.applicants.map(item => item.name).join('; ')}` : '',
    record.inventors.length ? `Inventors: ${record.inventors.join('; ')}` : '',
  ].filter(Boolean).join('\n')
}

function buildEmbeddingText(record: { title: string; abstract: string | null; classifications: string[] }) {
  return [
    `Title: ${record.title}`,
    record.abstract ? `Abstract: ${record.abstract}` : '',
    record.classifications.length ? `Classifications: ${record.classifications.join(', ')}` : '',
  ].filter(Boolean).join('\n')
}

function confidenceFor(record: Partial<ExtractedPatentRecord>, anchorScore: number, warnings: string[]) {
  let score = Math.min(anchorScore / PATENT_ANCHOR_PATTERNS.length, 1) * 0.45
  if (record.applicationNumberRaw) score += 0.15
  if (record.title && !record.title.startsWith('[Unparsed')) score += 0.15
  if (record.abstract) score += 0.15
  if (record.applicants?.length) score += 0.04
  if (record.inventors?.length) score += 0.03
  if (record.classifications?.length) score += 0.03
  score -= Math.min(warnings.length * 0.025, 0.15)
  return Math.max(0, Math.min(1, Number(score.toFixed(3))))
}

function parsePatentWindow(page: PdfPageModel, y0: number, y1: number, sourceFileHash: string): ExtractedPatentRecord | null {
  const windowLines = linesInWindow(page, y0, y1)
  const anchorScore = patentPageScore(windowLines)
  if (anchorScore < 5) return null

  const warnings: string[] = []
  const windowText = linesToText(windowLines)
  const normalizedWindowText = normalizePatentText(windowText)
  const application = parseApplicationNumber(normalizedWindowText)

  const titleAnchor = findAnchor(windowLines, /\(54\)\s*Title\s+of\s+the\s+invention/i)
  const applicantAnchor = findAnchor(windowLines, /\(71\)\s*Name\s+of\s+Applicant/i)
  const inventorAnchor = findAnchor(windowLines, /\(72\)\s*Name\s+of\s+Inventor/i)
  const abstractAnchor = findAnchor(windowLines, /\(57\)\s*Abstract/i)
  const classificationAnchor = findAnchor(windowLines, /\(51\)\s*International\s+classification/i)
  const firstLeftAfterClassification = classificationAnchor
    ? windowLines.find(line =>
      line.y0 > classificationAnchor.y &&
      line.x0 < page.width * 0.5 &&
      /\((31|32|33|86|87|61|62)\)/.test(normalizeForMatching(line.text))
    )
    : null

  const titleEndY = Math.min(
    ...[
      classificationAnchor?.y,
      applicantAnchor?.y,
      abstractAnchor?.y,
      y1,
    ].filter((value): value is number => typeof value === 'number' && (!titleAnchor || value > titleAnchor.y))
  )

  const titleRaw = titleAnchor
    ? textInRegion(page, { y0: titleAnchor.y - 1, y1: titleEndY, x0: 0, x1: page.width })
    : ''
  const title = stripLabel(titleRaw, /\(54\)\s*Title\s+of\s+the\s+invention\s*:?\s*/i)

  const rightX = applicantAnchor?.x ?? page.width * 0.52
  const abstractY = abstractAnchor?.y ?? y1
  const rawApplicantBlock = applicantAnchor
    ? textInRegion(page, {
      x0: Math.max(0, rightX - 3),
      x1: page.width,
      y0: applicantAnchor.y - 1,
      y1: inventorAnchor?.y ?? abstractY,
    })
    : null
  const rawInventorBlock = inventorAnchor
    ? textInRegion(page, {
      x0: Math.max(0, rightX - 3),
      x1: page.width,
      y0: inventorAnchor.y - 1,
      y1: abstractY,
    })
    : null

  const classificationStartY = classificationAnchor
    ? Math.min(classificationAnchor.y, titleEndY)
    : titleEndY
  const rawClassificationBlock = classificationAnchor
    ? textInRegion(page, {
      x0: 0,
      x1: Math.min(page.width, rightX - 4),
      y0: Math.max(y0, classificationStartY - 1),
      y1: firstLeftAfterClassification?.y0 ?? abstractY,
    })
    : null

  const countLine = windowLines.find(line => /No\.\s*of\s*Pages/i.test(line.text))
  const abstractEndY = countLine?.y0 ?? Math.min(y1, page.height - 155)
  const abstractRaw = abstractAnchor
    ? textInRegion(page, {
      x0: 0,
      x1: page.width,
      y0: abstractAnchor.y - 1,
      y1: abstractEndY,
    })
    : ''
  const abstract = stripLabel(abstractRaw, /\(57\)\s*Abstract\s*:?\s*/i) || null
  const counts = parseCounts(normalizedWindowText)
  const applicants = parseApplicants(rawApplicantBlock)
  const inventors = parseInventors(rawInventorBlock)
  const classifications = normalizeClassifications(rawClassificationBlock)

  if (!application.raw) warnings.push('Missing application number')
  if (!title) warnings.push('Missing title')
  if (!abstract) warnings.push('Missing abstract')
  if (!applicants.length) warnings.push('Missing applicants')
  if (!inventors.length) warnings.push('Missing inventors')
  if (!classifications.length) warnings.push('Missing classifications')
  if (!counts.numberOfPages || !counts.numberOfClaims) warnings.push('Missing or malformed page/claim counts')

  const effectiveTitle = title || `[Unparsed patent page ${page.pageNumber}]`
  const publicationNumber = application.publicationNumber || makeSyntheticPublicationNumber(sourceFileHash, page.pageNumber, normalizedWindowText)
  const countryMatch = normalizedWindowText.match(/\(19\)\s*([A-Z][A-Z\s]+?)(?=\s+\(|\n|$)/i)
  const filingDateMatch = normalizedWindowText.match(/\(22\)\s*Date\s+of\s+filing\s+of\s+Application\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})/i)
  const publicationDateMatch = normalizedWindowText.match(/\(43\)\s*Publication\s+Date\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})/i)

  const base = {
    title: effectiveTitle,
    abstract,
    classifications,
    applicants,
    inventors,
  }

  const record: ExtractedPatentRecord = {
    publicationNumber,
    applicationNumberRaw: application.raw,
    kind: application.kind,
    country: countryMatch ? compactWhitespace(countryMatch[1]) : null,
    filingDate: parseDate(filingDateMatch?.[1] || null),
    publicationDate: parseDate(publicationDateMatch?.[1] || null),
    title: effectiveTitle,
    abstract,
    abstractOriginal: abstract,
    applicants,
    inventors,
    classifications,
    rawApplicantBlock,
    rawInventorBlock,
    rawClassificationBlock,
    rawText: normalizedWindowText,
    numberOfPages: counts.numberOfPages,
    numberOfClaims: counts.numberOfClaims,
    sourcePageNumber: page.pageNumber,
    ragText: buildRagText(base),
    embeddingText: buildEmbeddingText(base),
    extractionVersion: PATENT_CORPUS_EXTRACTION_VERSION,
    extractionConfidence: 0,
    extractionWarnings: warnings,
  }
  record.extractionConfidence = confidenceFor(record, anchorScore, warnings)
  return record
}

export function extractPatentRecordsFromPage(page: PdfPageModel, sourceFileHash: string): ExtractedPatentRecord[] {
  const records: ExtractedPatentRecord[] = []
  for (const window of getPatentWindows(page)) {
    const record = parsePatentWindow(page, window.y0, window.y1, sourceFileHash)
    if (record) records.push(record)
  }
  return records
}

export async function extractPatentRecordsFromPdf(buffer: Buffer, sourceFileHash?: string): Promise<ExtractPdfResult> {
  const hash = sourceFileHash || crypto.createHash('sha256').update(buffer).digest('hex')
  const pages = await extractPdfPageModels(buffer)
  const records: ExtractedPatentRecord[] = []
  let ignoredPages = 0
  let lowConfidencePages = 0

  for (const page of pages) {
    const pageRecords = extractPatentRecordsFromPage(page, hash)
    if (!pageRecords.length) {
      ignoredPages += 1
      continue
    }
    for (const record of pageRecords) {
      if (record.extractionConfidence < 0.78) lowConfidencePages += 1
      records.push(record)
    }
  }

  return {
    totalPages: pages.length,
    records,
    ignoredPages,
    lowConfidencePages,
    warningCount: records.reduce((sum, record) => sum + record.extractionWarnings.length, 0),
  }
}
