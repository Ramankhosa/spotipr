import fs from 'fs'
import { describe, expect, it } from 'vitest'
import {
  classifyPageSection,
  extractPatentRecordsFromPdf,
  normalizeClassifications,
  parseApplicationNumber,
  parseApplicants,
  parseCounts,
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

  it('harvests IPC classifications from modern continuation styles', () => {
    expect(normalizeClassifications(`
      (51) International : G06Q0040080000, G06Q0020100000,
      classification G06F0007020000, G06Q0020240000,
      (71)Name of Applicant : Example Limited
    `)).toEqual([
      'G06Q0040080000',
      'G06Q0020100000',
      'G06F0007020000',
      'G06Q0020240000',
    ])
  })

  it('keeps compact IPC codes when applicant numbering is glued to the classification line', () => {
    expect(normalizeClassifications(`
      (51) (71)Name of Applicant :
      International:D02J0013000000,D02J0001220000,A23G00015400001)RELIANCE INDUSTRIES LIMITED.
      classification Address of Applicant : Example address
    `)).toEqual([
      'D02J0013000000',
      'D02J0001220000',
      'A23G0001540000',
    ])
  })

  it('recombines old split IPC formats without applicant contamination', () => {
    expect(normalizeClassifications(`
      (51) International classification
      G01R
      37/28
      H 04 L 12/00
      (71) Name of Applicant : Controller General of Patents
    `)).toEqual([
      'G01R 37/28',
      'H04L 12/00',
    ])
  })

  it('parses compact and old application number labels', () => {
    expect(parseApplicationNumber('(21) ApplicationNo.202311051949 A')).toMatchObject({
      raw: '202311051949 A',
      publicationNumber: 'IN202311051949A',
    })
    expect(parseApplicationNumber('(21) APPLICATION No: 0869/DEL/2005 A')).toMatchObject({
      raw: '0869/DEL/2005 A',
      publicationNumber: 'IN08692005A',
    })
  })

  it('parses compact page and claim counts', () => {
    expect(parseCounts('No. of Pages : 3No. of Claims : 10')).toEqual({
      numberOfPages: 3,
      numberOfClaims: 10,
    })
  })

  it('classifies ignored patent journal sections', () => {
    expect(classifyPageSection('(12) PATENT APPLICATIONPUBLICATION\n(21) Application No.202411077405 A')).toBe('applicationPublication')
    expect(classifyPageSection('FIRST EXAMINATION REPORT ISSUED IN THE WEEK')).toBe('weeklyFer')
    expect(classifyPageSection('PATENTS GRANTED U/S 43 DATE OF GRANT')).toBe('grantList')
    expect(classifyPageSection('DESIGN NUMBER CLASS AND SUB-CLASS DATE OF REGISTRATION')).toBe('designPublication')
    expect(classifyPageSection('CORRIGENDUM The Patent Office Journal')).toBe('corrigendum')
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

  it('keeps names clean when applicant and inventor blocks contain repeated address labels', () => {
    const applicants = parseApplicants(`
      (71)Name of Applicant :
      1)Directorate of Forensic Science Services
      Address of Applicant :Block No. 9, 8th Floor, CGO Complex, New Delhi
      2)Panjab University
      Name of Applicant : NA
      Address of Applicant : NA
    `)
    const inventors = parseInventors(`
      (72)Name of Inventor :
      1)Garima Joshi
      Address of Applicant :University Institute of Engineering and Technology, Chandigarh
      2)Dr. S.K. Jain
      Address of Applicant :Directorate of Forensic Science Services, New Delhi
      3)Dr. Archana Singh
    `)

    expect(applicants.map(item => item.name)).toEqual([
      'Directorate of Forensic Science Services',
      'Panjab University',
    ])
    expect(inventors).toEqual(['Garima Joshi', 'Dr. S.K. Jain', 'Dr. Archana Singh'])
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
