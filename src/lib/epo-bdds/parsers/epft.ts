// Parser for EP full-text publication XML (`ep-patent-document`, DTD v1.7).
//
// Structure confirmed against the EPO's own sample (product 20, delivery 2254,
// "EP FULL TEXT SAMPLE 2025.zip", file EP12783558NWB1.xml):
//
//   <ep-patent-document id="EP12783558B1" lang="en" country="EP"
//                       doc-number="2912867" kind="B1" date-publ="20250129">
//     <SDOBI>
//       <B100><B110>2912867</B110><B140><date>20250129</date></B140>
//       <B200><B210>12783558.5</B210><B220><date>20121029</date></B220>
//       <B500>
//         <B510EP><classification-ipcr><text>H04W  12/04  …</text>
//         <B520EP><classifications-cpc><classification-cpc><text>…
//         <B540><B541>de</B541><B542>VERFAHREN…</B542>
//               <B541>en</B541><B542>METHODS…</B542>
//               <B541>fr</B541><B542>PROCÉDÉS…</B542></B540>
//     <description id="desc" lang="en"><heading/><p num="0001">…</p></description>
//     <claims id="claims01" lang="en"><claim num="0001"><claim-text>…
//     <claims id="claims02" lang="de">…   <claims id="claims03" lang="fr">…
//
// Three things here bite a parser written from a spec rather than the data:
//   1. Titles are PAIRED siblings — B541 carries a language, the B542 that
//      follows carries that language's title. They are not nested.
//   2. Granted EP specifications publish claims in all three official
//      languages; taking the first <claims> block yields German a third of the
//      time. We select on lang.
//   3. <claim-text> nests inside <claim-text> for sub-clauses, so text must be
//      flattened rather than read at one level.
//
// Each publication is its own ~80 KB XML file (the ARCHIVE is huge, the
// documents are not), so parsing per-document from a string is memory-safe.

import { SaxesParser, type SaxesTagPlain } from 'saxes'
import { normalizeIpc } from './docdb'

export interface EpFullTextRecord {
  /**
   * The PUBLICATION number, e.g. "EP2912867B1" — country + doc-number + kind.
   *
   * ⚠️ NOT the root element's `id` attribute. That is built from the
   * APPLICATION number ("EP12783558B1" for this same document) and matches
   * nothing in a corpus keyed by publication number. Using it meant a full
   * archive of 4,258 EP publications matched zero rows in local_patents.
   */
  publicationNumber: string
  /** The root `id` attribute — application-number based. Kept for traceability
   *  back to the source file; never used as a join key. */
  documentId: string | null
  country: string
  docNumber: string
  kind: string
  lang: string | null
  publicationDate: string | null
  applicationNumber: string | null
  title: string | null
  titleLang: string | null
  /**
   * Present on A-publications (applications) only. Granted specifications
   * (B1/B2) carry NO abstract — verified against the real feed — which is why
   * row creation is gated on this field: without it there is nothing to embed
   * under the corpus convention of `title + abstract`.
   */
  abstract: string | null
  /** One entry per <claim>, in publication order. Lets a caller store all
   *  claims, or only claim 1, without re-parsing. */
  claims: string[]
  claimsText: string | null
  claimsCount: number
  claimsLang: string | null
  descriptionText: string | null
  ipc: string[]
  cpc: string[]
}

const local = (name: string) => name.replace(/^.*:/, '')
const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Preference order when the requested language is absent. */
const LANG_PREFERENCE = ['en', 'de', 'fr']

function pickByLang<T>(byLang: Map<string, T>, preferred = LANG_PREFERENCE): { lang: string; value: T } | null {
  for (const lang of preferred) {
    const value = byLang.get(lang)
    if (value !== undefined) return { lang, value }
  }
  const first = byLang.entries().next()
  return first.done ? null : { lang: first.value[0], value: first.value[1] }
}

/**
 * Parse one EP publication document.
 *
 * `preferLang` sets which language wins for title/claims/description; the
 * others are discarded rather than stored, since keeping all three would
 * roughly triple the storage for no retrieval benefit in an English corpus.
 */
export function parseEpFullText(xml: string, preferLang = 'en'): EpFullTextRecord | null {
  const preference = [preferLang, ...LANG_PREFERENCE.filter(l => l !== preferLang)]

  let record: EpFullTextRecord | null = null
  const path: string[] = []

  // Text accumulation uses a STACK, not a single buffer.
  //
  // EP markup nests heavily — <claim-text> inside <claim-text> for sub-clauses,
  // <b>/<u> inside <heading>. Resetting one buffer on every opening tag silently
  // drops the parent's own text: "<claim-text>An apparatus comprising<claim-text>
  // a memory unit</claim-text>" loses the preamble, which is the part that says
  // what the invention IS. Instead each element gets its own buffer, and on close
  // its text is appended to its parent's, so an ancestor ends up holding all the
  // text beneath it.
  const textStack: string[] = []
  let text = ''

  // B540 title pairing: a B541 sets the language for the B542 that follows it.
  let pendingTitleLang: string | null = null
  const titles = new Map<string, string>()

  // Claims and description are collected per language, then chosen at the end.
  // Per language, an array of claims; each claim is an array of its (possibly
  // nested) claim-text fragments.
  const claimsByLang = new Map<string, string[][]>()
  const descriptionByLang = new Map<string, string[]>()
  const abstractByLang = new Map<string, string[]>()
  let currentClaimsLang: string | null = null
  let currentDescriptionLang: string | null = null
  let currentAbstractLang: string | null = null

  const ipc: string[] = []
  const cpc: string[] = []
  let inIpc = false
  let inCpc = false

  const parser = new SaxesParser()
  parser.on('error', error => {
    if (!/entity/i.test(String((error as Error)?.message))) throw error
  })

  parser.on('opentag', (tag: SaxesTagPlain) => {
    const name = local(tag.name)
    const attrs = tag.attributes as Record<string, string>
    path.push(name)
    textStack.push(text)
    text = ''

    switch (name) {
      case 'ep-patent-document': {
        const country = attrs['country'] || 'EP'
        const docNumber = attrs['doc-number'] || ''
        const kind = attrs['kind'] || ''
        record = {
          publicationNumber: `${country}${docNumber}${kind}`,
          documentId: attrs['id'] || null,
          country,
          docNumber,
          kind,
          lang: attrs['lang'] || null,
          publicationDate: attrs['date-publ'] || null,
          applicationNumber: null,
          title: null,
          titleLang: null,
          abstract: null,
          claims: [],
          claimsText: null,
          claimsCount: 0,
          claimsLang: null,
          descriptionText: null,
          ipc: [],
          cpc: [],
        }
        break
      }
      case 'claims':
        currentClaimsLang = (attrs['lang'] || 'en').toLowerCase()
        if (!claimsByLang.has(currentClaimsLang)) claimsByLang.set(currentClaimsLang, [])
        break
      case 'claim':
        // Only a top-level <claim> starts a new claim; claim-text nests, claim does not.
        if (currentClaimsLang) claimsByLang.get(currentClaimsLang)!.push([])
        break
      case 'description':
        currentDescriptionLang = (attrs['lang'] || 'en').toLowerCase()
        if (!descriptionByLang.has(currentDescriptionLang)) descriptionByLang.set(currentDescriptionLang, [])
        break
      case 'abstract':
        currentAbstractLang = (attrs['lang'] || 'en').toLowerCase()
        if (!abstractByLang.has(currentAbstractLang)) abstractByLang.set(currentAbstractLang, [])
        break
      case 'B510EP':
        inIpc = true
        break
      case 'B520EP':
        inCpc = true
        break
    }
  })

  parser.on('text', chunk => { text += chunk })

  parser.on('closetag', (tag: SaxesTagPlain) => {
    const name = local(tag.name)
    const value = squash(text)
    path.pop()
    // Hand this element's text up to its parent before handling the element.
    const parentText = textStack.pop() ?? ''
    text = value ? `${parentText} ${value}` : parentText

    switch (name) {
      case 'B541':
        pendingTitleLang = value.toLowerCase() || null
        break
      case 'B542':
        // Paired with the B541 immediately before it.
        if (value) titles.set(pendingTitleLang || 'und', value)
        pendingTitleLang = null
        break
      case 'B210':
        if (record && value) record.applicationNumber = value
        break
      case 'claim': {
        // `value` now holds every text node beneath this <claim>, including the
        // preamble that precedes any nested <claim-text>.
        if (!currentClaimsLang || !value) break
        const claims = claimsByLang.get(currentClaimsLang)!
        if (claims.length) claims[claims.length - 1].push(value)
        break
      }
      case 'heading':
      case 'p':
        if (!value) break
        if (currentAbstractLang && path.includes('abstract')) {
          abstractByLang.get(currentAbstractLang)!.push(value)
        } else if (currentDescriptionLang && path.includes('description')) {
          descriptionByLang.get(currentDescriptionLang)!.push(value)
        }
        break
      case 'claims':
        currentClaimsLang = null
        break
      case 'description':
        currentDescriptionLang = null
        break
      case 'abstract':
        currentAbstractLang = null
        break
      case 'text': {
        const code = normalizeIpc(value)
        if (code) {
          if (inIpc && !ipc.includes(code)) ipc.push(code)
          else if (inCpc && !cpc.includes(code)) cpc.push(code)
        }
        break
      }
      case 'B510EP':
        inIpc = false
        break
      case 'B520EP':
        inCpc = false
        break
    }
  })

  parser.write(xml)
  parser.close()

  if (!record) return null
  const result = record as EpFullTextRecord

  const title = pickByLang(titles, preference)
  if (title) { result.title = title.value; result.titleLang = title.lang }

  const claims = pickByLang(claimsByLang, preference)
  if (claims && claims.value.length) {
    // Flatten each claim's nested claim-text fragments into one string, keeping
    // claim boundaries so a caller can store all claims or only claim 1.
    const perClaim = claims.value.map(parts => squash(parts.join(' '))).filter(Boolean)
    result.claims = perClaim
    result.claimsText = perClaim.join('\n')
    result.claimsCount = perClaim.length
    result.claimsLang = claims.lang
  }

  const abstract = pickByLang(abstractByLang, preference)
  if (abstract && abstract.value.length) {
    result.abstract = abstract.value.join(' ').replace(/\s+/g, ' ').trim() || null
  }

  const description = pickByLang(descriptionByLang, preference)
  if (description && description.value.length) {
    result.descriptionText = description.value.join('\n')
  }

  result.ipc = ipc
  result.cpc = cpc
  return result
}

/** Is this archive entry a publication document (rather than TOC or index)? */
export function isEpPublicationXml(path: string): boolean {
  if (!/\.xml$/i.test(path)) return false
  return !/(TOC|index|package)/i.test(path.split('/').pop() || '')
}
