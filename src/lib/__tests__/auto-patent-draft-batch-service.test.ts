import * as XLSX from 'xlsx'
import { describe, expect, test } from 'vitest'
import {
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
})
