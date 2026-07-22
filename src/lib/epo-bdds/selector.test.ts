import { describe, expect, it } from 'vitest'
import { isDataFile, parseFileSliceInfo, selectFiles, summarizeSelection } from './selector'
import type { BddsDelivery } from './types'

describe('parseFileSliceInfo', () => {
  it('reads authority and publication year from a real DOCDB filename', () => {
    const slice = parseFileSliceInfo('DOCDB-201701-Amend-PubDate20161230AndBefore-AP-0001.zip')
    expect(slice.authority).toBe('AP')
    expect(slice.pubYearTo).toBe(2016)
    // "AndBefore" is an open-ended historical chunk: no reliable lower bound.
    expect(slice.pubYearFrom).toBeNull()
  })

  it('treats a bounded PubDate as a single year', () => {
    const slice = parseFileSliceInfo('DOCDB-202501-PubDate20250103-EP-0002.zip')
    expect(slice.authority).toBe('EP')
    expect(slice.pubYearFrom).toBe(2025)
    expect(slice.pubYearTo).toBe(2025)
  })

  it('reads the year out of an EP weekly archive filename', () => {
    // EPRTBJV<yyyy><wwwwww>001001.zip. The back file groups these under
    // per-year deliveries ("14.12 EP full-text data 2024") whose NAME has no
    // yyyy/ww stamp, so without this every pre-2025 year looked unreachable.
    const slice = parseFileSliceInfo('EPRTBJV2024000052001001.zip')
    expect(slice.pubYearFrom).toBe(2024)
    expect(slice.pubYearTo).toBe(2024)
  })

  it('reads the year for the oldest EP archives too', () => {
    expect(parseFileSliceInfo('EPRTBJV1978000001001001.zip').pubYearTo).toBe(1978)
    expect(parseFileSliceInfo('EPRTBJV2000000030001001.zip').pubYearTo).toBe(2000)
  })

  it('treats a year-week stamp as the DELIVERY date, not publication coverage', () => {
    // docdb_xml_bck_202607_… was produced in 2026 week 07 but contains
    // publications spanning decades. Using it as a publication bound would
    // silently discard nearly everything.
    const slice = parseFileSliceInfo('docdb_xml_bck_202607_031_D.zip')
    expect(slice.deliveryYear).toBe(2026)
    expect(slice.pubYearFrom).toBeNull()
    expect(slice.pubYearTo).toBeNull()
  })

  it('excludes release notes and spreadsheets from the work list', () => {
    expect(isDataFile('docdb_xml_bck_202607_031_D.zip')).toBe(true)
    expect(isDataFile('2026_FEBRUARY_DOCDB_Backfile_readme.zip')).toBe(false)
    expect(isDataFile('20260318_DOCDB_OLDDeliveriesRemoved_readme.docx')).toBe(false)
    expect(isDataFile('statistics_authority_code_202630.xlsx')).toBe(false)
  })

  it('returns nulls rather than guessing when the name carries no year', () => {
    const slice = parseFileSliceInfo('EP-fulltext-backfile-part17.zip')
    expect(slice.pubYearFrom).toBeNull()
    expect(slice.pubYearTo).toBeNull()
  })

  it('rejects implausible years instead of accepting garbage', () => {
    expect(parseFileSliceInfo('DOCDB-999901-PubDate99990101-EP-1.zip').pubYearTo).toBeNull()
  })
})

function delivery(files: Array<[number, string]>, stamp = '2025-01-08T00:00:00Z'): BddsDelivery {
  return {
    deliveryId: 1,
    deliveryName: 'd',
    deliveryPublicationDatetime: stamp,
    files: files.map(([fileId, fileName]) => ({
      fileId, fileName, fileSize: '1 GB', fileChecksum: 'abc',
    })),
  }
}

describe('selectFiles', () => {
  const deliveries = [
    delivery([
      [1, 'DOCDB-202501-PubDate20250103-EP-0001.zip'],
      [2, 'DOCDB-201901-PubDate20190104-EP-0001.zip'],
      [3, 'DOCDB-202501-PubDate20250103-US-0001.zip'],
      [4, 'EP-fulltext-backfile-part17.zip'],
    ]),
  ]

  it('skips files whose year is outside the requested range', () => {
    const decisions = selectFiles(deliveries, { fromYear: 2025, toYear: 2025 })
    const byFileId = new Map(decisions.map(d => [d.file.fileId, d]))
    expect(byFileId.get(1)?.include).toBe(true)
    expect(byFileId.get(2)?.include).toBe(false)
    expect(byFileId.get(2)?.skipReason).toBe('year-out-of-range')
  })

  it('skips excluded authorities', () => {
    const decisions = selectFiles(deliveries, { authorities: ['EP'] })
    const us = decisions.find(d => d.file.fileId === 3)
    expect(us?.include).toBe(false)
    expect(us?.skipReason).toBe('authority-excluded')
  })

  it('includes year-less files but flags that they need record-level filtering', () => {
    const decisions = selectFiles(deliveries, { fromYear: 2025, toYear: 2025 })
    const unknown = decisions.find(d => d.file.fileId === 4)
    expect(unknown?.include).toBe(true)
    expect(unknown?.requiresRecordLevelFilter).toBe(true)
  })

  it('does not flag record-level filtering when no year was requested', () => {
    const decisions = selectFiles(deliveries, {})
    expect(decisions.every(d => !d.requiresRecordLevelFilter)).toBe(true)
    expect(decisions.every(d => d.include)).toBe(true)
  })

  it('filters whole deliveries by publication datetime', () => {
    const older = delivery([[9, 'DOCDB-202401-PubDate20240103-EP-0001.zip']], '2024-01-08T00:00:00Z')
    const decisions = selectFiles([...deliveries, older], { from: '2025-01-01T00:00:00Z' })
    expect(decisions.find(d => d.file.fileId === 9)).toBeUndefined()
  })
})

describe('summarizeSelection', () => {
  it('counts what was included, skipped, and could not be sliced by filename', () => {
    const decisions = selectFiles(
      [delivery([
        [1, 'DOCDB-202501-PubDate20250103-EP-0001.zip'],
        [2, 'DOCDB-201901-PubDate20190104-EP-0001.zip'],
        [3, 'no-year-here.zip'],
      ])],
      { fromYear: 2025, toYear: 2025 }
    )
    const summary = summarizeSelection(decisions)
    expect(summary.total).toBe(3)
    expect(summary.included).toBe(2)
    expect(summary.skipped).toBe(1)
    expect(summary.withParsedYear).toBe(2)
    expect(summary.needingRecordLevelFilter).toBe(1)
  })
})
