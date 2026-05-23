import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import {
  classifyPageSection,
  extractPatentRecordsFromPage,
  segmentsToLines,
  type PdfPageModel,
  type PdfTextSegment,
} from '../src/lib/patent-corpus-extractor'

const args = new Map(
  process.argv.slice(2).flatMap((arg, index, all) => {
    if (!arg.startsWith('--')) return []
    const key = arg.slice(2)
    const next = all[index + 1]
    return [[key, next && !next.startsWith('--') ? next : 'true']]
  })
)

const downloadsDir = args.get('dir') || 'C:/Users/raman/Documents/Patentjournal/downloads'
const targetPage = Number(args.get('page') || process.env.PATENT_SMOKE_PAGE || '25') || 25
const concurrency = Math.max(1, Number(args.get('concurrency') || process.env.PATENT_SMOKE_CONCURRENCY || '4') || 4)
const outDir = path.join(process.cwd(), 'tmp')
fs.mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const jsonPath = path.join(outDir, `patent-page${targetPage}-smoke-${stamp}.json`)
const csvPath = path.join(outDir, `patent-page${targetPage}-smoke-${stamp}.csv`)

let pdfjs: any

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function linesToText(lines: PdfPageModel['lines']) {
  return lines
    .sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0))
    .map(line => compactWhitespace(line.text))
    .filter(Boolean)
    .join('\n')
}

function warningBreakdown(records: ReturnType<typeof extractPatentRecordsFromPage>) {
  return records.flatMap(record => record.extractionWarnings).reduce<Record<string, number>>((acc, warning) => {
    acc[warning] = (acc[warning] || 0) + 1
    return acc
  }, {})
}

function csvEscape(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

async function extractOnePage(pdfPath: string) {
  const data = new Uint8Array(fs.readFileSync(pdfPath))
  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    disableFontFace: true,
    useSystemFonts: true,
    isEvalSupported: false,
  })
  const document = await loadingTask.promise
  try {
    const pageNumber = Math.min(targetPage, document.numPages)
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
      segments.push({ text, x0: x, x1: x + width, y0: yTop, y1: yTop + height, height })
    }

    const lines = segmentsToLines(segments)
    const model: PdfPageModel = {
      pageNumber,
      width: Number(viewport.width),
      height: Number(viewport.height),
      segments,
      lines,
      rawText: linesToText(lines),
    }
    const section = classifyPageSection(model)
    const fileHash = crypto.createHash('sha256').update(pdfPath).digest('hex')
    const records = extractPatentRecordsFromPage(model, fileHash)
    const warnings = warningBreakdown(records)
    return {
      file: path.basename(pdfPath),
      totalPages: document.numPages,
      testedPage: pageNumber,
      section,
      records: records.length,
      warnings: Object.values(warnings).reduce((sum, count) => sum + count, 0),
      warningBreakdown: warnings,
      lowConfidence: records.filter(record => record.extractionConfidence < 0.78).length,
      applications: records.map(record => record.applicationNumberRaw).filter(Boolean),
      firstTitle: records[0]?.title || null,
      classifications: records.reduce((sum, record) => sum + record.classifications.length, 0),
      error: null as string | null,
    }
  } finally {
    await document.destroy()
  }
}

async function runPool<T, R>(items: T[], worker: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
      if ((index + 1) % 100 === 0) console.log(`processed ${index + 1}/${items.length}`)
    }
  })
  await Promise.all(workers)
  return results
}

async function main() {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
  ).href

  const pdfs = fs.readdirSync(downloadsDir)
    .filter(name => name.toLowerCase().endsWith('.pdf'))
    .sort()
    .map(name => path.join(downloadsDir, name))

  console.log(`testing page ${targetPage} for ${pdfs.length} PDFs with concurrency ${concurrency}`)
  const started = Date.now()
  const rows = await runPool(pdfs, async pdfPath => {
    try {
      return await extractOnePage(pdfPath)
    } catch (error) {
      return {
        file: path.basename(pdfPath),
        totalPages: 0,
        testedPage: targetPage,
        section: 'error',
        records: 0,
        warnings: 0,
        warningBreakdown: {},
        lowConfidence: 0,
        applications: [],
        firstTitle: null,
        classifications: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  const aggregate = rows.reduce((acc, row) => {
    acc.files += 1
    acc.records += row.records
    acc.warnings += row.warnings
    acc.lowConfidence += row.lowConfidence
    acc.errors += row.error ? 1 : 0
    acc.sections[row.section] = (acc.sections[row.section] || 0) + 1
    for (const [warning, count] of Object.entries(row.warningBreakdown || {})) {
      acc.warningBreakdown[warning] = (acc.warningBreakdown[warning] || 0) + Number(count)
    }
    return acc
  }, {
    files: 0,
    records: 0,
    warnings: 0,
    lowConfidence: 0,
    errors: 0,
    sections: {} as Record<string, number>,
    warningBreakdown: {} as Record<string, number>,
  })

  const suspicious = rows.filter(row => !row.error && row.section === 'applicationPublication' && (row.records === 0 || row.warnings > 0 || row.lowConfidence > 0))
  const ignoredUnknown = rows.filter(row => !row.error && row.section === 'unknown')

  fs.writeFileSync(jsonPath, JSON.stringify({ targetPage, aggregate, suspicious, ignoredUnknown, rows }, null, 2))
  const csvHeaders = ['file', 'totalPages', 'testedPage', 'section', 'records', 'warnings', 'lowConfidence', 'classifications', 'applications', 'firstTitle', 'warningBreakdown', 'error']
  const csv = [
    csvHeaders.join(','),
    ...rows.map(row => csvHeaders.map(header => csvEscape((row as any)[header])).join(',')),
  ].join('\n')
  fs.writeFileSync(csvPath, csv)

  console.log(JSON.stringify({
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    jsonPath,
    csvPath,
    aggregate,
    suspiciousCount: suspicious.length,
    ignoredUnknownCount: ignoredUnknown.length,
    firstSuspicious: suspicious.slice(0, 20).map(row => ({
      file: row.file,
      page: row.testedPage,
      records: row.records,
      warnings: row.warningBreakdown,
      lowConfidence: row.lowConfidence,
    })),
    firstUnknown: ignoredUnknown.slice(0, 20).map(row => ({ file: row.file, page: row.testedPage })),
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
