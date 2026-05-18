import fs from 'fs'
import { describe, expect, it } from 'vitest'
import {
  extractPatentRecordsFromPdf,
  normalizeClassifications,
  parseApplicants,
  parseInventors,
} from '@/lib/patent-corpus-extractor'

describe('patent corpus field parsers', () => {
  it('normalizes split and compact classifications', () => {
    expect(normalizeClassifications(':C07D | 471/04,\nC07D | 401/14,\nE04H0009020000')).toEqual([
      'C07D 471/04',
      'C07D 401/14',
      'E04H0009020000',
    ])
  })

  it('parses applicant lists with an address tied to the first applicant', () => {
    const applicants = parseApplicants(`
      (71)Name of Applicant :
      1)Raghav Garg
      Address of Applicant :House No. 1450 Sector 14 Faridabad Haryana India
      2)Rayirth Kundu
      3)Neeyati Saini
    `)

    expect(applicants).toHaveLength(3)
    expect(applicants[0]).toMatchObject({
      sequence: 1,
      name: 'Raghav Garg',
      address: 'House No. 1450 Sector 14 Faridabad Haryana India',
    })
    expect(applicants[1].name).toBe('Rayirth Kundu')
    expect(applicants[2].name).toBe('Neeyati Saini')
  })

  it('parses inventor lists without imposing a count limit', () => {
    const inventors = parseInventors(`
      (72)Name of Inventor :
      1)A
      2)B
      3)C
      4)D
      5)E
      6)F
      7)G
      8)H
    `)

    expect(inventors).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
  })
})

describe('patent corpus PDF extraction', () => {
  const samplePath = 'c:/Users/raman/Downloads/Sample.pdf'
  const runIfSampleExists = fs.existsSync(samplePath) ? it : it.skip

  runIfSampleExists('extracts all patent pages from the sample PDF', async () => {
    const result = await extractPatentRecordsFromPdf(fs.readFileSync(samplePath))

    expect(result.totalPages).toBe(25)
    expect(result.records).toHaveLength(25)
    expect(result.ignoredPages).toBe(0)

    const connectingAssembly = result.records.find(record => record.applicationNumberRaw === '202411077405 A')
    expect(connectingAssembly).toMatchObject({
      publicationNumber: 'IN202411077405A',
      title: 'CONNECTING ASSEMBLY AND BRACED FRAMED SYSTEMS',
      numberOfPages: 30,
      numberOfClaims: 8,
    })
    expect(connectingAssembly?.classifications).toContain('E04H0009020000')

    const hydrogenStorage = result.records.find(record => record.applicationNumberRaw === '202411081566 A')
    expect(hydrogenStorage).toMatchObject({
      title: 'A METHOD FOR HYDROGEN STORAGE IN NANOSTRUCTURED METAL SHEET',
      numberOfPages: 18,
      numberOfClaims: 9,
    })

    const multiInventor = result.records.find(record => record.sourcePageNumber === 19)
    expect(multiInventor?.inventors.length).toBeGreaterThanOrEqual(8)

    const splitClassification = result.records.find(record => record.sourcePageNumber === 24)
    expect(splitClassification?.classifications).toContain('C07D 471/04')
    expect(splitClassification?.classifications).toContain('A61K 31/437')
  })
})
