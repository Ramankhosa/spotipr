import * as XLSX from 'xlsx'
import AdmZip from 'adm-zip'
import { describe, expect, test } from 'vitest'
import {
  AUTO_PATENT_DRAFT_BATCH_TEMPLATE_COLUMNS,
  buildAutoPatentDraftBatchTemplate,
  buildDocumentIdeasFromRows,
  parseAutoPatentDraftDocuments,
  parseAutoPatentDraftIdeasFromJson,
  parseAutoPatentDraftIdeasFromUpload,
  previewAutoPatentDraftBatchIdeas,
  type AutoPatentDraftDocumentRow,
} from '@/lib/auto-patent-draft-batch-service'

// 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64'
)

function makeDocxWithImage(text: string): Buffer {
  const zip = new AdmZip()
  zip.addFile(
    'word/document.xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
      'utf8'
    )
  )
  zip.addFile('word/media/image1.png', TINY_PNG)
  return zip.toBuffer()
}

describe('auto patent draft batch parsing', () => {
  test('parses ideas from JSON containers', () => {
    const ideas = parseAutoPatentDraftIdeasFromJson({
      ideas: [
        {
          title: 'Smart inhaler',
          ideaDetails: 'A dose tracking inhaler.',
          noveltyDetails: 'Uses a low-power sensor arrangement.'
        }
      ]
    })

    expect(ideas).toHaveLength(1)
    expect(ideas[0]).toMatchObject({
      title: 'Smart inhaler',
      ideaDetails: 'A dose tracking inhaler.'
    })
  })

  test('parses CSV uploads with drafting-specific columns', () => {
    const csv = [
      'title,ideaDetails,noveltyDetails,literatureReviewContent,figureRemarks,jurisdictions',
      '"Bottle cap","Tamper-evident cap","Novel hinge","US123 prior art","Generate exploded view","IN,US"'
    ].join('\n')

    const ideas = parseAutoPatentDraftIdeasFromUpload({
      filename: 'batch.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8')
    })

    expect(ideas).toHaveLength(1)
    expect(ideas[0]).toMatchObject({
      title: 'Bottle cap',
      noveltyDetails: 'Novel hinge',
      figureRemarks: 'Generate exploded view'
    })
  })

  test('parses XLSX uploads', () => {
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet([
      {
        title: 'Posture chair',
        ideaDetails: 'Chair with adaptive lumbar support',
        noveltyDetails: 'Sensor-controlled support geometry'
      }
    ])
    XLSX.utils.book_append_sheet(workbook, sheet, 'Ideas')
    const buffer = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))

    const ideas = parseAutoPatentDraftIdeasFromUpload({
      filename: 'ideas.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer
    })

    expect(ideas).toHaveLength(1)
    expect(ideas[0].title).toBe('Posture chair')
  })

  test('builds a safe CSV upload template with the parser headers', () => {
    const template = buildAutoPatentDraftBatchTemplate('csv')
    const csv = template.buffer.toString('utf8')

    expect(template.filename).toBe('patent-drafting-batch-template.csv')
    expect(csv.trim()).toBe(AUTO_PATENT_DRAFT_BATCH_TEMPLATE_COLUMNS.join(','))
  })

  test('builds an XLSX template with upload, instructions, and example sheets', () => {
    const template = buildAutoPatentDraftBatchTemplate('xlsx')
    const workbook = XLSX.read(template.buffer, { type: 'buffer' })

    expect(template.filename).toBe('patent-drafting-batch-template.xlsx')
    expect(workbook.SheetNames).toEqual(['Batch Upload', 'Instructions', 'Example'])

    const uploadRows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['Batch Upload'], { header: 1 })
    expect(uploadRows[0]).toEqual([...AUTO_PATENT_DRAFT_BATCH_TEMPLATE_COLUMNS])

    const ideas = parseAutoPatentDraftIdeasFromUpload({
      filename: template.filename,
      mimeType: template.mimeType,
      buffer: template.buffer,
    })
    expect(ideas).toEqual([])
  })

  test('previews rows without requiring database writes', () => {
    const preview = previewAutoPatentDraftBatchIdeas([
      {
        title: 'Smart latch',
        ideaDetails: 'A latch with a monitored locking pin.',
        jurisdictions: 'US, EP',
      }
    ])

    expect(preview).toMatchObject({
      totalRows: 1,
      validRows: 1,
      invalidRows: 0,
    })
    expect(preview.rows[0]).toMatchObject({
      rowNo: 1,
      title: 'Smart latch',
      jurisdictions: ['US', 'EP'],
      filingType: 'utility',
      claimsHandling: 'draft from brief',
      priorArtHandling: 'auto',
      errors: [],
    })
  })

  test('keeps AI prior-art review enabled by default even when literature review text is supplied', () => {
    const preview = previewAutoPatentDraftBatchIdeas([
      {
        title: 'Prior art assisted idea',
        ideaDetails: 'A controller-assisted storage tray.',
        literatureReviewContent: 'US123 describes a conventional tray.'
      }
    ])

    expect(preview.rows[0]).toMatchObject({
      priorArtHandling: 'auto',
    })
  })

  test('applies defaults only when row values are blank', () => {
    const preview = previewAutoPatentDraftBatchIdeas([
      {
        title: 'Defaulted idea',
        ideaDetails: 'A controller-assisted storage tray.',
      },
      {
        title: 'Override idea',
        ideaDetails: 'A tray with a local sensor.',
        jurisdictions: 'JP',
        filingType: 'provisional',
        claimsHandling: 'improve',
        priorArtHandling: 'use only',
      }
    ], {
      defaultJurisdictions: 'IN,US',
      defaultFilingType: 'utility',
      defaultClaimsHandling: 'draft from brief',
      defaultPriorArtHandling: 'auto',
    })

    expect(preview.rows[0]).toMatchObject({
      jurisdictions: ['IN', 'US'],
      filingType: 'utility',
      claimsHandling: 'draft from brief',
      priorArtHandling: 'auto',
    })
    expect(preview.rows[1]).toMatchObject({
      jurisdictions: ['JP'],
      filingType: 'provisional',
      claimsHandling: 'improve',
      priorArtHandling: 'use only',
    })
  })

  test('marks rows without idea details as invalid', () => {
    const preview = previewAutoPatentDraftBatchIdeas([
      {
        title: 'Incomplete idea',
        noveltyDetails: 'Novelty without disclosure.',
      }
    ])

    expect(preview.invalidRows).toBe(1)
    expect(preview.rows[0].errors).toContain('ideaDetails is required.')
  })
})

describe('auto patent draft document mode', () => {
  test('extracts one idea per uploaded document with a title from the filename', async () => {
    const rows = await parseAutoPatentDraftDocuments([
      { filename: 'Smart Inhaler Disclosure.txt', mimeType: 'text/plain', buffer: Buffer.from('A dose tracking inhaler with a low-power sensor.', 'utf8') },
      { filename: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Widget\nA self-cleaning widget.', 'utf8') },
    ])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ rowNo: 1, sourceFilename: 'Smart Inhaler Disclosure.txt', title: 'Smart Inhaler Disclosure', imageCount: 0 })
    expect(rows[0].ideaDetails).toContain('dose tracking inhaler')
    expect(rows[1].title).toBe('notes')
    expect(rows[1].ideaDetails).toContain('self-cleaning widget')
  })

  test('captures embedded images from a document', async () => {
    const rows = await parseAutoPatentDraftDocuments([
      {
        filename: 'invention.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: makeDocxWithImage('An improved widget assembly with a hinged cover.'),
      },
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].ideaDetails).toContain('widget assembly')
    expect(rows[0].imageCount).toBe(1)
    expect(rows[0].extractedImages).toHaveLength(1)
    expect(rows[0].extractedImages[0].mimeType).toBe('image/png')
  })

  test('records a per-file error for an unsupported document without aborting the batch', async () => {
    const rows = await parseAutoPatentDraftDocuments([
      { filename: 'good.txt', mimeType: 'text/plain', buffer: Buffer.from('A usable disclosure.', 'utf8') },
      { filename: 'broken.xyz', mimeType: 'application/octet-stream', buffer: Buffer.from('nope', 'utf8') },
    ])

    expect(rows).toHaveLength(2)
    expect(rows[0].extractionError).toBeUndefined()
    expect(rows[1].extractionError).toBeTruthy()
    expect(rows[1].ideaDetails).toBe('')
  })

  test('maps global figure defaults and honors per-file overrides', () => {
    const rows: AutoPatentDraftDocumentRow[] = [
      { rowNo: 1, sourceFilename: 'a.docx', title: 'A', ideaDetails: 'Idea A', imageCount: 2, extractedImages: [{ id: 'img-1' } as any] },
      { rowNo: 2, sourceFilename: 'b.pdf', title: 'B', ideaDetails: 'Idea B', imageCount: 0, extractedImages: [] },
    ]

    const { ideas, skipped } = buildDocumentIdeasFromRows(
      rows,
      [{ useUploadedFigures: false }, {}],
      { useUploadedFigures: true, generateDiagrams: true }
    )

    expect(skipped).toHaveLength(0)
    expect(ideas).toHaveLength(2)
    // Per-file override wins: item 1 opts out of images despite the global default.
    expect(ideas[0]).toMatchObject({ title: 'A', useUploadedFigures: false, generateDiagrams: true })
    expect(ideas[0].extractedImages).toHaveLength(0) // image bytes dropped when not used
    // Item 2 inherits the global default.
    expect(ideas[1]).toMatchObject({ title: 'B', useUploadedFigures: true, generateDiagrams: true })
  })

  test('reports files with no usable idea text as skipped', () => {
    const rows: AutoPatentDraftDocumentRow[] = [
      { rowNo: 1, sourceFilename: 'empty.pdf', title: 'Empty', ideaDetails: '', imageCount: 0, extractionError: 'No readable text was found.', extractedImages: [] },
    ]

    const { ideas, skipped } = buildDocumentIdeasFromRows(rows, [], { useUploadedFigures: true, generateDiagrams: true })

    expect(ideas).toHaveLength(0)
    expect(skipped).toEqual([{ rowNo: 1, sourceFilename: 'empty.pdf', reason: 'No readable text was found.' }])
  })

  test('honors an edited idea-text override even when extraction was empty', () => {
    const rows: AutoPatentDraftDocumentRow[] = [
      { rowNo: 1, sourceFilename: 'scan.pdf', title: 'Scan', ideaDetails: '', imageCount: 0, extractionError: 'No readable text was found.', extractedImages: [] },
    ]

    const { ideas, skipped } = buildDocumentIdeasFromRows(
      rows,
      [{ ideaDetails: 'Manually typed disclosure.' }],
      { useUploadedFigures: true, generateDiagrams: true }
    )

    expect(skipped).toHaveLength(0)
    expect(ideas[0].ideaDetails).toBe('Manually typed disclosure.')
  })
})
