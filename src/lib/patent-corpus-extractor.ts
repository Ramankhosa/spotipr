import crypto from 'crypto'
import path from 'path'
import { pathToFileURL } from 'url'

export const PATENT_CORPUS_EXTRACTION_VERSION = 'indian-journal-layout-v3-universal'

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
  warningBreakdown: Record<string, number>
  ignoredPageBreakdown: Partial<Record<PatentPageSection, number>>
}

type AnchorPosition = {
  y: number
  x: number
  line: PdfLayoutLine
}

export type PatentPageSection =
  | 'applicationPublication'
  | 'frontMatter'
  | 'weeklyFer'
  | 'grantList'
  | 'designPublication'
  | 'corrigendum'
  | 'continuedMarker'
  | 'otherNotice'
  | 'unknown'

export type ApplicationLayout = {
  columnMode: 'oldOneColumn' | 'twoColumnInterleaved' | 'modernTwoColumn' | 'compactLabel' | 'unknown'
  classificationStyle: 'internationalClassification' | 'internationalColon' | 'internationalBare' | 'standaloneClassification' | 'missing'
  compactLabels: boolean
}

const PATENT_ANCHOR_PATTERNS = [
  /\(12\)\s*PATENT\s*APPLICATION\s*PUBLICATION/i,
  /\(21\)\s*Application\s*No\.?/i,
  /\(22\)\s*Date\s*of\s*filing/i,
  /\(43\)\s*Publication\s*Date/i,
  /\((?:54|5)\)\s*Title\s*of\s*the\s*invention/i,
  /\(51\)(?:\s*International(?:\s*classification|\s*:)?|\s*)/i,
  /\(71\)\s*Name\s*of(?:\s*Applicant)?/i,
  /\(72\)\s*Name\s*of\s*Inventor/i,
  /\(57\)\s*Abstract/i,
]

const APPLICATION_PUBLICATION_PATTERN = /\(12\)\s*PATENT\s*APPLICATION\s*PUBLICATION/i

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
      .replace(/\(\s*(\d{2})\s*\)/g, '($1)')
      .replace(/\((\d{2})\)\s*(Name|Title|Application|Date|Publication|International|Abstract|PATENT)/gi, '($1) $2')
      .replace(/Application\s*No\b/gi, 'Application No')
      .replace(/Title\s+of\s*the\s*invention/gi, 'Title of the invention')
      .replace(/Date\s+of\s*filing/gi, 'Date of filing')
      .replace(/Publication\s*Date/gi, 'Publication Date')
  )
}

function normalizedSectionText(pageOrText: PdfPageModel | string) {
  const text = typeof pageOrText === 'string' ? pageOrText : pageOrText.rawText || linesToText(pageOrText.lines)
  return normalizeForMatching(text)
}

export function classifyPageSection(pageOrText: PdfPageModel | string): PatentPageSection {
  const text = normalizedSectionText(pageOrText)
  if (APPLICATION_PUBLICATION_PATTERN.test(text)) return 'applicationPublication'
  if (/corrigendum|correction\s+to\s+patent\s+application|errata/i.test(text)) return 'corrigendum'
  if (/first\s+examination\s+report|\bFER\b|requests?\s+for\s+examination|public\s+notice\s+under\s+rule\s+24B/i.test(text)) return 'weeklyFer'
  if (/patents?\s+granted|grant\s+of\s+patents?|u\/s\s*43|section\s+43|date\s+of\s+grant/i.test(text)) return 'grantList'
  if (/designs?\s+publication|design\s+number|class\s+and\s+sub-class|date\s+of\s+registration|reciprocity\s+date/i.test(text)) return 'designPublication'
  if (/continued\s+from\s+previous\s+page|contd\.?|continued\s+on\s+next\s+page/i.test(text)) return 'continuedMarker'
  if (/contents|index|the\s+patent\s+office\s+journal|official\s+journal\s+of\s+the\s+patent\s+office/i.test(text)) return 'frontMatter'
  if (/notice|notification|office\s+order|withdrawn|abandoned|restoration|post\s+grant|pre-grant/i.test(text)) return 'otherNotice'
  return 'unknown'
}

export function detectApplicationLayout(linesOrText: PdfLayoutLine[] | string): ApplicationLayout {
  const rawText = Array.isArray(linesOrText) ? linesToText(linesOrText) : linesOrText
  const text = normalizeForMatching(rawText)
  const hasCompactLabels = /\(\s*(21|54|71|72|51)\s*\)(Application|Title|Name|International)/i.test(rawText)
    || /ApplicationNo\.?|Title\s+ofthe|Title\s+of\s+theinvention/i.test(rawText)

  let classificationStyle: ApplicationLayout['classificationStyle'] = 'missing'
  if (/\(51\)\s*International\s+classification/i.test(text)) classificationStyle = 'internationalClassification'
  else if (/\(51\)\s*International\s*:/i.test(text)) classificationStyle = 'internationalColon'
  else if (/\(51\)\s*International\b/i.test(text)) classificationStyle = 'internationalBare'
  else if (/\bclassification\b/i.test(text)) classificationStyle = 'standaloneClassification'

  const applicantIndex = text.search(/\(71\)\s*Name\s*of\s*Applicant/i)
  const inventorIndex = text.search(/\(72\)\s*Name\s*of\s*Inventor/i)
  const classificationIndex = text.search(/\(51\)\s*International|\bclassification\b/i)
  let columnMode: ApplicationLayout['columnMode'] = 'unknown'
  if (hasCompactLabels) columnMode = 'compactLabel'
  else if (classificationIndex >= 0 && applicantIndex >= 0 && Math.abs(classificationIndex - applicantIndex) < 260) columnMode = 'twoColumnInterleaved'
  else if (classificationIndex >= 0 && applicantIndex >= 0 && classificationIndex < applicantIndex) columnMode = 'modernTwoColumn'
  else if (inventorIndex >= 0 && (classificationIndex < 0 || classificationIndex > inventorIndex)) columnMode = 'oldOneColumn'

  return {
    columnMode,
    classificationStyle,
    compactLabels: hasCompactLabels,
  }
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
        ? line.segments.find(item => new RegExp(`\\(\\s*${code}\\s*\\)`).test(item.text))
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
    .filter(line => APPLICATION_PUBLICATION_PATTERN.test(normalizeForMatching(line.text)))
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
      .replace(/\(72\)\s*Name\s*of\s*Inventor\s*:?.*$/i, '')
      .replace(/\(71\)\s*Name\s*of\s*(?:Applicant)?\s*:?/i, '')
      .replace(/^Applicant\s*:?\s*/i, ''),
    /^/
  )

  const addressMatch = cleaned.match(/Address\s*of\s*Applicant\s*:?\s*/i)
  if (!addressMatch || addressMatch.index == null) {
    return parseNumberedList(cleaned)
      .map(item => ({
        sequence: item.sequence,
        name: cleanPartyName(item.value),
        raw: item.raw,
      }))
      .filter(item => item.name)
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
  return allEntries
    .map((item, index) => ({
      sequence: item.sequence || index + 1,
      name: cleanPartyName(item.value),
      raw: item.raw,
      ...(address && beforeEntries.length === 1 && index === 0 ? { address } : {}),
      ...(commonAddress ? { commonAddress } : {}),
    }))
    .filter(item => item.name)
}

function cleanPartyName(value: string) {
  return compactWhitespace(
    value
      .replace(/\bAddress\s*of\s*(?:Applicant|Inventor)\s*:?.*$/i, '')
      .replace(/\bName\s*of\s*Applicant\s*:?.*$/i, '')
      .replace(/\bName\s*of\s*Inventor\s*:?.*$/i, '')
  )
}

export function parseInventors(rawBlock: string | null) {
  if (!rawBlock) return []
  const cleaned = stripLabel(
    normalizePatentText(rawBlock)
      .replace(/\(72\)\s*Name\s*of\s*Inventor\s*:?/i, '')
      .replace(/\(57\)\s*Abstract\s*:?.*$/i, ''),
    /^/
  )
  return parseNumberedList(cleaned)
    .map(item => cleanPartyName(item.value))
    .filter(Boolean)
}

function normalizeIpcCode(section: string, classDigits: string, subclass: string, mainGroup: string, subgroup?: string) {
  const prefix = `${section.toUpperCase()}${classDigits}${subclass.toUpperCase()}`
  const main = mainGroup.replace(/\s+/g, '')
  const sub = subgroup?.replace(/\s+/g, '')
  if (sub) return `${prefix} ${main}/${sub}`
  return main.length > 4 ? `${prefix}${main}` : `${prefix} ${main}`
}

export function harvestIpcClassifications(value: string | null) {
  if (!value) return []
  const text = compactWhitespace(
    normalizePatentText(value)
      .replace(/\|/g, ' ')
      .replace(/\b([A-H])O(\d[A-Z])\b/g, (_match, section, rest) => `${section}0${rest}`)
      .replace(/\bN\s*\/\s*A\b/gi, 'NA')
  )
  if (!text || /^:?NA$/i.test(text)) return []

  const matches: Array<{ index: number; code: string }> = []
  const slashRegex = /\b([A-H])\s*(\d{2})\s*([A-Z])\s*([0-9]{1,5})\s*\/\s*([0-9]{1,8}[A-Z0-9]*)/gi
  const compactRegex = /\b([A-H])\s*(\d{2})\s*([A-Z])\s*([0-9]{6,10})(?=\d+\)|\D|$)/gi
  let match: RegExpExecArray | null
  while ((match = slashRegex.exec(text)) !== null) {
    matches.push({ index: match.index, code: normalizeIpcCode(match[1], match[2], match[3], match[4], match[5]) })
  }
  while ((match = compactRegex.exec(text)) !== null) {
    matches.push({ index: match.index, code: normalizeIpcCode(match[1], match[2], match[3], match[4]) })
  }

  const ordered = matches.sort((a, b) => a.index - b.index).map(item => item.code)
  return Array.from(new Set(ordered))
}

function keepClassificationLineTokens(line: string) {
  return line
    .replace(/^(\s*\d{1,5}\s*\/\s*[0-9A-Z]{1,8})\s*,?\s*\d+\).*$/i, '$1')
    .replace(/(\b[A-H]\s*\d{2}\s*[A-Z])\s+\d+\).*$/i, '$1')
}

function stripClassificationLabels(rawBlock: string) {
  return normalizePatentText(rawBlock)
    .replace(/\(51\)\s*International(?:\s*classification|\s*:)?/ig, ' ')
    .replace(/\bInternational(?:\s*classification|\s*:)?/ig, ' ')
    .replace(/\bclassification\s*:?\s*/ig, ' ')
    .replace(/\((71|72)\)\s*Name\s*of\s*(Applicant|Inventor)\s*:?.*$/gim, ' ')
    .replace(/\bAddress\s*of\s*(Applicant|Inventor)\s*:?.*$/gim, ' ')
    .split('\n')
    .map(keepClassificationLineTokens)
    .join('\n')
}

function trimClassificationBlock(rawBlock: string) {
  const text = stripClassificationLabels(rawBlock)
    .replace(/\((31|32|33|43|57|61|62|71|72|86|87)\)[\s\S]*$/i, ' ')
  return text.replace(/^[:\s,]+/, '')
}

export function normalizeClassifications(rawBlock: string | null) {
  if (!rawBlock) return []
  const harvested = harvestIpcClassifications(stripClassificationLabels(rawBlock))
  if (harvested.length) return harvested

  const fallback = compactWhitespace(trimClassificationBlock(rawBlock))
  if (!fallback || /^:?NA$/i.test(fallback)) return []
  return Array.from(new Set(
    fallback
      .split(/[,\n;]/)
      .map(item => compactWhitespace(item.replace(/^:/, '')))
      .filter(item => item && /^[A-H]\s*\d{2}\s*[A-Z]/i.test(item) && !/^NA$/i.test(item) && !/\b(Name|Address)\s*of\s*(Applicant|Inventor)\b/i.test(item))
  ))
}

export function parseApplicationNumber(text: string) {
  const match = normalizePatentText(text).match(/\(21\)\s*Application\s*No\.?\s*:?\s*([A-Z/]{0,8}\s*\d[\dA-Z/ -]{2,}\s*[A-Z]?)\b/i)
  if (!match) return { raw: null, kind: null, publicationNumber: null }
  const raw = compactWhitespace(match[1])
  const kindMatch = raw.match(/([A-Z])$/)
  const digits = raw.replace(/[^0-9]/g, '')
  const kind = kindMatch?.[1] || null
  const publicationNumber = digits ? `IN${digits}${kind || ''}` : null
  return { raw, kind, publicationNumber }
}

function makeSyntheticPublicationNumber(sourceFileHash: string, pageNumber: number, rawText: string) {
  const digest = crypto.createHash('sha1').update(`${sourceFileHash}:${pageNumber}:${rawText}`).digest('hex').slice(0, 10).toUpperCase()
  return `UNPARSED-${sourceFileHash.slice(0, 8).toUpperCase()}-P${pageNumber}-${digest}`
}

export function parseCounts(text: string) {
  const match = normalizePatentText(text).match(/No\.?\s*of\s*Pages?\s*:?\s*(\d+)\s*(?:[,;|]?\s*)?No\.?\s*of\s*Claims?\s*:?\s*(\d+)/i)
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
  if (record.classifications?.length) score += 0.06
  score -= Math.min(warnings.length * 0.025, 0.15)
  return Math.max(0, Math.min(1, Number(score.toFixed(3))))
}

function extractClassificationFallbackText(windowText: string) {
  const text = normalizePatentText(windowText)
  const classificationIndex = text.search(/\(51\)\s*International|\bclassification\b/i)
  const abstractIndex = text.search(/\(57\)\s*Abstract/i)
  if (classificationIndex >= 0) {
    return text.slice(classificationIndex, abstractIndex >= 0 ? abstractIndex : undefined)
  }

  const titleIndex = text.search(/\(54\)\s*Title\s*of\s*the\s*invention/i)
  return text.slice(titleIndex >= 0 ? titleIndex : 0, abstractIndex >= 0 ? abstractIndex : undefined)
}

function countBreakdown(values: string[]) {
  return values.reduce<Record<string, number>>((breakdown, value) => {
    breakdown[value] = (breakdown[value] || 0) + 1
    return breakdown
  }, {})
}

function parsePatentWindow(page: PdfPageModel, y0: number, y1: number, sourceFileHash: string): ExtractedPatentRecord | null {
  const windowLines = linesInWindow(page, y0, y1)
  const anchorScore = patentPageScore(windowLines)
  if (classifyPageSection(linesToText(windowLines)) !== 'applicationPublication' || anchorScore < 4) return null

  const warnings: string[] = []
  const windowText = linesToText(windowLines)
  const normalizedWindowText = normalizePatentText(windowText)
  const layout = detectApplicationLayout(windowLines)
  const application = parseApplicationNumber(normalizedWindowText)

  const titleAnchor = findAnchor(windowLines, /\((?:54|5)\)\s*Title\s*of\s*the\s*invention/i)
  const applicantAnchor = findAnchor(windowLines, /\(71\)\s*Name\s*of(?:\s*Applicant)?/i)
  const inventorAnchor = findAnchor(windowLines, /\(72\)\s*Name\s*of\s*Inventor/i)
  const abstractAnchor = findAnchor(windowLines, /\(57\)\s*Abstract/i)
  const classificationAnchor = findAnchor(windowLines, /\(51\)(?:\s*International(?:\s*classification|\s*:)?|\s*)/i)
  const firstLeftAfterClassification = classificationAnchor
    ? windowLines.find(line =>
      line.y0 > classificationAnchor.y &&
      line.x0 < page.width * 0.5 &&
      /\((31|32|33|43|57|61|62|86|87)\)/.test(normalizeForMatching(line.text))
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
  const title = stripLabel(titleRaw, /\((?:54|5)\)\s*Title\s*of\s*the\s*invention\s*:?\s*/i)

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
  const classificationX1 = layout.columnMode === 'oldOneColumn' || layout.columnMode === 'compactLabel'
    ? page.width
    : Math.min(page.width, Math.max(rightX - 4, page.width * 0.48))
  const regionClassificationBlock = classificationAnchor
    ? textInRegion(page, {
      x0: 0,
      x1: classificationX1,
      y0: Math.max(y0, classificationStartY - 1),
      y1: firstLeftAfterClassification?.y0 ?? abstractY,
    })
    : null
  const rawClassificationBlock = regionClassificationBlock && normalizeClassifications(regionClassificationBlock).length
    ? regionClassificationBlock
    : extractClassificationFallbackText(normalizedWindowText)

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
  if (!classifications.length) warnings.push('Missing classifications')
  if (/No\.?\s*of\s*(?:Pages?|Claims?)/i.test(normalizedWindowText) && (!counts.numberOfPages || !counts.numberOfClaims)) {
    warnings.push('Missing or malformed page/claim counts')
  }

  const effectiveTitle = title || `[Unparsed patent page ${page.pageNumber}]`
  const publicationNumber = application.publicationNumber || makeSyntheticPublicationNumber(sourceFileHash, page.pageNumber, normalizedWindowText)
  const countryMatch = normalizedWindowText.match(/\(19\)\s*([A-Z][A-Z\s]+?)(?=\s+\(|\n|$)/i)
  const filingDateMatch = normalizedWindowText.match(/\(22\)\s*Date\s*of\s*filing(?:\s*of\s*Application)?\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})/i)
  const publicationDateMatch = normalizedWindowText.match(/\(43\)\s*Publication\s*Date\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})/i)

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
  if (classifyPageSection(page) !== 'applicationPublication') return []
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
  const ignoredPageBreakdown: Partial<Record<PatentPageSection, number>> = {}

  for (const page of pages) {
    const pageRecords = extractPatentRecordsFromPage(page, hash)
    if (!pageRecords.length) {
      ignoredPages += 1
      const section = classifyPageSection(page)
      ignoredPageBreakdown[section] = (ignoredPageBreakdown[section] || 0) + 1
      continue
    }
    for (const record of pageRecords) {
      if (record.extractionConfidence < 0.78) lowConfidencePages += 1
      records.push(record)
    }
  }

  const warnings = records.flatMap(record => record.extractionWarnings)
  return {
    totalPages: pages.length,
    records,
    ignoredPages,
    lowConfidencePages,
    warningCount: warnings.length,
    warningBreakdown: countBreakdown(warnings),
    ignoredPageBreakdown,
  }
}
