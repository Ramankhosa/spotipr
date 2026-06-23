import * as XLSX from 'xlsx'
import { describe, expect, test } from 'vitest'
import {
  AUTO_PATENT_DRAFT_BATCH_TEMPLATE_COLUMNS,
  buildAutoPatentDraftBatchTemplate,
  parseAutoPatentDraftIdeasFromJson,
  parseAutoPatentDraftIdeasFromUpload,
} from '@/lib/auto-patent-draft-batch-service'

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
      'title,ideaDetails,noveltyDetails,literatureReviewContent,figureRemarks,draftingRemarks,jurisdictions',
      '"Bottle cap","Tamper-evident cap","Novel hinge","US123 prior art","Generate exploded view","Use concise claims","IN,US"'
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
})
