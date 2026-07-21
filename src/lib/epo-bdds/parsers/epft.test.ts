import { describe, expect, it } from 'vitest'
import { isEpPublicationXml, parseEpFullText } from './epft'

// Mirrors the real EPO sample (product 20, delivery 2254, EP12783558NWB1.xml),
// including the three things that break a spec-written parser: paired
// B541/B542 titles, claims in all three official languages, and nested
// <claim-text>.
const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ep-patent-document PUBLIC "-//EPO//EP PATENT DOCUMENT 1.7//EN" "ep-patent-document-v1-7.dtd">
<ep-patent-document id="EP12783558B1" file="EP12783558NWB1.xml" lang="en" country="EP"
                    doc-number="2912867" kind="B1" date-publ="20250129">
<SDOBI lang="en">
  <B100><B110>2912867</B110><B140><date>20250129</date></B140></B100>
  <B200><B210>12783558.5</B210><B220><date>20121029</date></B220></B200>
  <B500>
    <B510EP>
      <classification-ipcr sequence="1"><text>H04W  12/04        20210101AFI20240805BHEP        </text></classification-ipcr>
      <classification-ipcr sequence="2"><text>H04W  36/00        20090101ALI20240805BHEP        </text></classification-ipcr>
    </B510EP>
    <B520EP><classifications-cpc>
      <classification-cpc sequence="1"><text>H04W  12/043       20210101 FI20210101RHEP        </text></classification-cpc>
    </classifications-cpc></B520EP>
    <B540><B541>de</B541><B542>VERFAHREN ZUR VERBESSERUNG</B542><B541>en</B541><B542>METHODS ENABLING TO IMPROVE HANDOVER SECURITY</B542><B541>fr</B541><B542>PROCEDES PERMETTANT</B542></B540>
  </B500>
</SDOBI>
<abstract id="abst" lang="en"><p id="pa01" num="0001">An apparatus for improving handover security.</p></abstract>
<description id="desc" lang="en">
  <heading id="h0001">Field of the invention</heading>
  <p id="p0001" num="0001">The present invention relates to handover security.</p>
  <p id="p0002" num="0002">Further background follows.</p>
</description>
<claims id="claims01" lang="en">
  <claim id="c-en-01-0001" num="0001"><claim-text>An apparatus comprising
    <claim-text>a memory unit; and</claim-text>
    <claim-text>a control unit connected to the memory unit.</claim-text>
  </claim-text></claim>
  <claim id="c-en-01-0002" num="0002"><claim-text>The apparatus of claim 1, wherein the control unit is configured to verify a token.</claim-text></claim>
</claims>
<claims id="claims02" lang="de">
  <claim id="c-de-01-0001" num="0001"><claim-text>Vorrichtung mit einer Speichereinheit.</claim-text></claim>
</claims>
<claims id="claims03" lang="fr">
  <claim id="c-fr-01-0001" num="0001"><claim-text>Appareil comprenant une unite de memoire.</claim-text></claim>
</claims>
</ep-patent-document>`

describe('parseEpFullText', () => {
  it('reads identity from the root element', () => {
    const record = parseEpFullText(FIXTURE)!
    expect(record.publicationNumber).toBe('EP12783558B1')
    expect(record.country).toBe('EP')
    expect(record.kind).toBe('B1')
    expect(record.publicationDate).toBe('20250129')
    expect(record.applicationNumber).toBe('12783558.5')
  })

  it('pairs B541 language with the B542 that follows it, not by nesting', () => {
    const record = parseEpFullText(FIXTURE)!
    expect(record.titleLang).toBe('en')
    expect(record.title).toBe('METHODS ENABLING TO IMPROVE HANDOVER SECURITY')
  })

  it('picks the requested language, not simply the first claims block', () => {
    // A granted EP spec publishes claims in en/de/fr; taking the first block
    // would yield German for a third of the corpus.
    expect(parseEpFullText(FIXTURE)!.claimsLang).toBe('en')
    expect(parseEpFullText(FIXTURE, 'de')!.claimsText).toContain('Vorrichtung')
    expect(parseEpFullText(FIXTURE, 'fr')!.claimsText).toContain('Appareil')
  })

  it('flattens nested claim-text into its parent claim', () => {
    const record = parseEpFullText(FIXTURE)!
    expect(record.claimsCount).toBe(2)
    expect(record.claims).toHaveLength(2)
    expect(record.claims[0]).toBe(
      'An apparatus comprising a memory unit; and a control unit connected to the memory unit.'
    )
  })

  it('keeps claim boundaries so a caller can store only claim 1', () => {
    const record = parseEpFullText(FIXTURE)!
    expect(record.claims[1]).toContain('The apparatus of claim 1')
    // first-claim-only is a fraction of the whole
    expect(record.claims[0].length).toBeLessThan(record.claimsText!.length)
  })

  it('concatenates description headings and paragraphs', () => {
    const record = parseEpFullText(FIXTURE)!
    expect(record.descriptionText).toContain('Field of the invention')
    expect(record.descriptionText).toContain('handover security')
    expect(record.descriptionText).toContain('Further background follows.')
  })

  it('separates IPC from CPC and normalizes both', () => {
    const record = parseEpFullText(FIXTURE)!
    expect(record.ipc).toEqual(['H04W12/04', 'H04W36/00'])
    expect(record.cpc).toEqual(['H04W12/043'])
  })

  it('falls back to another language when the preferred one is absent', () => {
    const deOnly = FIXTURE
      .replace(/<claims id="claims01" lang="en">[\s\S]*?<\/claims>/, '')
      .replace(/<description[\s\S]*?<\/description>/, '')
    const record = parseEpFullText(deOnly, 'en')!
    expect(record.claimsLang).toBe('de')
  })

  it('returns a record with no text for a search-report (A3) publication', () => {
    const a3 = FIXTURE
      .replace(/<claims[\s\S]*<\/claims>/, '')
      .replace(/<description[\s\S]*?<\/description>/, '')
    const record = parseEpFullText(a3)!
    expect(record.claimsText).toBeNull()
    expect(record.descriptionText).toBeNull()
    expect(record.claimsCount).toBe(0)
  })

  it('extracts the abstract that A-publications carry', () => {
    const record = parseEpFullText(FIXTURE)!
    expect(record.abstract).toBe('An apparatus for improving handover security.')
  })

  it('leaves abstract null for a granted spec, which has none', () => {
    // B1/B2 carry no <abstract> — verified against the real feed. Row creation
    // is gated on this, so such publications are never given a fabricated one.
    const granted = FIXTURE.replace(/<abstract[\s\S]*?<\/abstract>/, '')
    expect(parseEpFullText(granted)!.abstract).toBeNull()
  })

  it('does not mistake abstract paragraphs for description paragraphs', () => {
    const record = parseEpFullText(FIXTURE)!
    expect(record.descriptionText).not.toContain('improving handover security.')
    expect(record.descriptionText).toContain('Field of the invention')
  })

  it('returns null for XML that is not an ep-patent-document', () => {
    expect(parseEpFullText('<TOC><entry/></TOC>')).toBeNull()
  })
})

describe('isEpPublicationXml', () => {
  it('accepts publication documents and rejects TOC/index files', () => {
    expect(isEpPublicationXml('DOC/EP12783558NWB1.zip!/EP12783558NWB1.xml')).toBe(true)
    expect(isEpPublicationXml('DOC/EP12783558NWB1.zip!/TOC.xml')).toBe(false)
    expect(isEpPublicationXml('DOC/package-index.xml')).toBe(false)
    expect(isEpPublicationXml('DOC/EP12783558NWB1.pdf')).toBe(false)
  })
})
