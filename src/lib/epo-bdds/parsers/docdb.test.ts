import { describe, expect, it } from 'vitest'
import { normalizeIpc, parseDocdbString } from './docdb'

// Fixture mirrors the real feed: EPO sample product 20, delivery 3157,
// DOCDB-202538-Amend-PubDate20250912AndBefore-IN-0001.xml. It keeps the awkward
// parts — the exch: namespace, duplicate parties in a second data-format, an
// abstract borrowed from a family member, and fixed-width IPC text.
const FIXTURE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE exch:exchange-documents SYSTEM "docdb-entities.dtd">
<exch:exchange-documents xmlns:exch="http://www.epo.org/exchange" dtd-version="2.5.9">
  <exch:exchange-document country="IN" doc-number="202163" kind="B" date-publ="20070202" family-id="27589531">
    <exch:bibliographic-data>
      <exch:publication-reference data-format="docdb">
        <document-id lang="en"><country>IN</country><doc-number>202163</doc-number><kind>B</kind><date>20070202</date></document-id>
      </exch:publication-reference>
      <exch:classifications-ipcr>
        <classification-ipcr sequence="1"><text>B01J  25/00        20060101AFI20060310RMJP        </text></classification-ipcr>
        <classification-ipcr sequence="2"><text>C07C 209/48        20060101ALI20060310RMJP        </text></classification-ipcr>
      </exch:classifications-ipcr>
      <exch:parties>
        <exch:applicants>
          <exch:applicant sequence="1" data-format="docdb">
            <exch:applicant-name><name>RHODIA POLYAMIDE INTERMEDIATES</name></exch:applicant-name>
            <residence><country>FR</country></residence>
          </exch:applicant>
          <exch:applicant sequence="1" data-format="epodoc">
            <exch:applicant-name><name>RHODIA POLYAMIDE INTERMEDIATES SAS</name></exch:applicant-name>
          </exch:applicant>
        </exch:applicants>
        <exch:inventors>
          <exch:inventor sequence="1" data-format="docdb"><exch:inventor-name><name>BOCQUENET GERALD</name></exch:inventor-name></exch:inventor>
          <exch:inventor sequence="2" data-format="docdb"><exch:inventor-name><name>CHESNAIS ANDRE</name></exch:inventor-name></exch:inventor>
          <exch:inventor sequence="1" data-format="original"><exch:inventor-name><name>BOCQUENET, GERALD</name></exch:inventor-name></exch:inventor>
        </exch:inventors>
      </exch:parties>
      <exch:invention-title lang="en" data-format="docdba">Continuous method for hydrogenation of nitriles</exch:invention-title>
    </exch:bibliographic-data>
    <exch:abstract lang="en" country="US" doc-number="7453012" kind="B2" abstract-source="national office">
      <exch:p>A process for the hydrogenation of compounds.</exch:p>
    </exch:abstract>
  </exch:exchange-document>
  <exch:exchange-document country="IN" doc-number="24CHN2014" kind="A" date-publ="20150821" family-id="47260715">
    <exch:bibliographic-data>
      <exch:invention-title lang="en" data-format="docdba">OSCILLATING POSITIVE EXPIRATORY PRESSURE DEVICE</exch:invention-title>
    </exch:bibliographic-data>
    <exch:abstract lang="en" abstract-source="national office">
      <exch:p>A respiratory treatment device</exch:p><exch:p>comprising at least one chamber.</exch:p>
    </exch:abstract>
  </exch:exchange-document>
</exch:exchange-documents>`

describe('normalizeIpc', () => {
  it('collapses the fixed-width form to a compact code', () => {
    expect(normalizeIpc('B01J  25/00        20060101AFI20060310RMJP        ')).toBe('B01J25/00')
    expect(normalizeIpc('C07C 209/48        20060101ALI20060310RMJP')).toBe('C07C209/48')
    expect(normalizeIpc('A61M  16/20')).toBe('A61M16/20')
  })

  it('returns null for empty input rather than an empty code', () => {
    expect(normalizeIpc('')).toBeNull()
    expect(normalizeIpc('   ')).toBeNull()
  })
})

describe('parseDocdbStream', () => {
  it('emits one record per exchange-document', async () => {
    const records = await parseDocdbString(FIXTURE)
    expect(records).toHaveLength(2)
    expect(records.map(r => r.publicationNumber)).toEqual(['IN202163B', 'IN24CHN2014A'])
  })

  it('reads identity and family from the element attributes', async () => {
    const [first] = await parseDocdbString(FIXTURE)
    expect(first.country).toBe('IN')
    expect(first.kind).toBe('B')
    expect(first.familyId).toBe('27589531')
    expect(first.publicationDate).toBe('20070202')
  })

  it('extracts the English title', async () => {
    const [first] = await parseDocdbString(FIXTURE)
    expect(first.title).toBe('Continuous method for hydrogenation of nitriles')
  })

  it('flags an abstract borrowed from another family member instead of passing it off as its own', async () => {
    const [first, second] = await parseDocdbString(FIXTURE)
    expect(first.abstract).toBe('A process for the hydrogenation of compounds.')
    expect(first.abstractSourcePublication).toBe('US7453012B2')
    // The second document's abstract is genuinely its own.
    expect(second.abstractSourcePublication).toBeNull()
  })

  it('joins multi-paragraph abstracts', async () => {
    const [, second] = await parseDocdbString(FIXTURE)
    expect(second.abstract).toBe('A respiratory treatment device comprising at least one chamber.')
  })

  it('keeps only the docdb data-format parties, so duplicates do not multiply', async () => {
    const [first] = await parseDocdbString(FIXTURE)
    expect(first.applicants).toEqual([{ name: 'RHODIA POLYAMIDE INTERMEDIATES', country: 'FR' }])
    expect(first.inventors).toEqual(['BOCQUENET GERALD', 'CHESNAIS ANDRE'])
  })

  it('normalizes and de-duplicates IPC codes', async () => {
    const [first] = await parseDocdbString(FIXTURE)
    expect(first.ipc).toEqual(['B01J25/00', 'C07C209/48'])
  })

  it('does not leak state between documents', async () => {
    const [, second] = await parseDocdbString(FIXTURE)
    expect(second.applicants).toEqual([])
    expect(second.inventors).toEqual([])
    expect(second.ipc).toEqual([])
    expect(second.familyId).toBe('47260715')
  })

  it('survives the undeclared external DTD entities DOCDB references', async () => {
    // docdb-entities.dtd is never fetched; an unresolvable entity must not abort
    // a 100 MB file mid-stream.
    const withEntity = FIXTURE.replace('nitriles', 'nitriles &Aacute; more')
    const records = await parseDocdbString(withEntity)
    expect(records).toHaveLength(2)
  })
})
