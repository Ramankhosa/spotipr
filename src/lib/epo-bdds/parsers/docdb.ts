// Streaming parser for DOCDB "exchange document" XML.
//
// Written against the real feed, not a spec: the structure below was taken from
// the EPO's own sample product (id 20, delivery 3157,
// DOCDB-202538-Amend-PubDate20250912AndBefore-IN-0001.xml).
//
//   <exch:exchange-documents ...>
//     <exch:exchange-document country="IN" doc-number="202163" kind="B"
//                             date-publ="20070202" family-id="27589531">
//       <exch:bibliographic-data>
//         <exch:publication-reference data-format="docdb">
//           <document-id><country/><doc-number/><kind/><date/></document-id>
//         <exch:classifications-ipcr>
//           <classification-ipcr><text>B01J  25/00        2006…</text>
//         <exch:parties>
//           <exch:applicants><exch:applicant data-format="docdb">
//             <exch:applicant-name><name>RHODIA …</name>
//           <exch:inventors><exch:inventor …><exch:inventor-name><name>…
//         <exch:invention-title lang="en">…</exch:invention-title>
//       <exch:abstract lang="en"><exch:p>…</exch:p></exch:abstract>
//
// Files run to 100+ MB, so this is SAX-based (saxes) and emits one record at a
// time. Never use @xmldom/xmldom here — it builds a full DOM.

import { SaxesParser, type SaxesTagPlain } from 'saxes'
import type { Readable } from 'node:stream'

export interface DocdbApplicant {
  name: string
  country?: string
}

export interface DocdbRecord {
  /** country + doc-number + kind, e.g. "IN202163B". */
  publicationNumber: string
  country: string
  docNumber: string
  kind: string
  familyId: string | null
  publicationDate: string | null
  title: string | null
  abstract: string | null
  /**
   * DOCDB frequently supplies an abstract borrowed from another member of the
   * same family; the source publication is recorded here rather than silently
   * presented as the document's own. Null when it is the document's own.
   */
  abstractSourcePublication: string | null
  applicants: DocdbApplicant[]
  inventors: string[]
  ipc: string[]
}

/**
 * "B01J  25/00        20060101AFI20060310RMJP" -> "B01J25/00".
 * The fixed-width prefix is section/class/subclass + group/subgroup; everything
 * from the version date onwards is classification metadata we do not keep.
 */
export function normalizeIpc(text: string): string | null {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null
  const match = trimmed.match(/^([A-H])\s*(\d{2})\s*([A-Z])\s*(\d{1,4})\s*\/\s*(\d{2,6})/)
  if (!match) {
    const compact = trimmed.split(/\s{2,}/)[0]?.replace(/\s+/g, '')
    return compact || null
  }
  const [, section, klass, subclass, group, subgroup] = match
  return `${section}${klass}${subclass}${group}/${subgroup}`
}

interface ParseState {
  record: DocdbRecord | null
  path: string[]
  text: string
  /** data-format of the parties block currently open; we keep "docdb" only. */
  partiesFormat: string | null
  seenApplicants: Set<string>
  seenInventors: Set<string>
  currentApplicant: DocdbApplicant | null
  abstractParts: string[]
  inAbstract: boolean
  titleLang: string | null
}

const local = (name: string) => name.replace(/^.*:/, '')

function emptyRecord(attrs: Record<string, string>): DocdbRecord {
  const country = attrs['country'] || ''
  const docNumber = attrs['doc-number'] || ''
  const kind = attrs['kind'] || ''
  return {
    publicationNumber: `${country}${docNumber}${kind}`,
    country,
    docNumber,
    kind,
    familyId: attrs['family-id'] || null,
    publicationDate: attrs['date-publ'] || null,
    title: null,
    abstract: null,
    abstractSourcePublication: null,
    applicants: [],
    inventors: [],
    ipc: [],
  }
}

/**
 * Parse a DOCDB XML stream, invoking `onRecord` per exchange-document.
 *
 * `onRecord` may be async; parsing pauses until it resolves, so a slow loader
 * cannot be outrun by the parser.
 */
export async function parseDocdbStream(
  input: Readable,
  onRecord: (record: DocdbRecord) => void | Promise<void>
): Promise<number> {
  const state: ParseState = {
    record: null,
    path: [],
    text: '',
    partiesFormat: null,
    seenApplicants: new Set(),
    seenInventors: new Set(),
    currentApplicant: null,
    abstractParts: [],
    inAbstract: false,
    titleLang: null,
  }

  let count = 0
  const pending: Array<Promise<void> | void> = []
  // No options: keeps the tag type as SaxesTagPlain. Passing `fileName` here
  // changes the generic and breaks the handler signatures for no real gain.
  const parser = new SaxesParser()

  parser.on('error', error => {
    // DOCDB declares custom entities in an external DTD we do not fetch. An
    // unresolvable entity must not abort a 100 MB file, so it is skipped.
    if (!/undefined entity|entity/i.test(String(error?.message))) throw error
  })

  parser.on('opentag', (tag: SaxesTagPlain) => {
    const name = local(tag.name)
    state.path.push(name)
    state.text = ''
    const attrs = tag.attributes as Record<string, string>

    switch (name) {
      case 'exchange-document':
        state.record = emptyRecord(attrs)
        state.seenApplicants = new Set()
        state.seenInventors = new Set()
        break
      case 'applicant':
      case 'inventor':
        state.partiesFormat = attrs['data-format'] || null
        state.currentApplicant = null
        break
      case 'abstract':
        if (!state.record) break
        // Keep the first English abstract; note when it is borrowed from a
        // family member in another jurisdiction.
        if (state.record.abstract === null && (attrs['lang'] || 'en').toLowerCase() === 'en') {
          state.inAbstract = true
          state.abstractParts = []
          state.record.abstractSourcePublication = attrs['country'] && attrs['doc-number']
            ? `${attrs['country']}${attrs['doc-number']}${attrs['kind'] || ''}`
            : null
        }
        break
      case 'invention-title':
        state.titleLang = (attrs['lang'] || '').toLowerCase()
        break
    }
  })

  parser.on('text', text => { state.text += text })

  parser.on('closetag', (tag: SaxesTagPlain) => {
    const name = local(tag.name)
    const text = state.text.trim()
    const record = state.record
    state.path.pop()

    if (!record) { state.text = ''; return }

    switch (name) {
      case 'invention-title':
        // First English title wins; fall back to any title if none is English.
        if (text && (state.titleLang === 'en' || record.title === null)) {
          if (state.titleLang === 'en' || record.title === null) record.title = text
        }
        break

      case 'p':
        if (state.inAbstract && text) state.abstractParts.push(text)
        break

      case 'abstract':
        if (state.inAbstract) {
          const joined = state.abstractParts.join(' ').replace(/\s+/g, ' ').trim()
          if (joined) record.abstract = joined
          state.inAbstract = false
          state.abstractParts = []
        }
        break

      case 'name': {
        // <name> occurs inside both applicant-name and inventor-name; the
        // enclosing element (now one level up, since we popped) disambiguates.
        if (!text) break
        const parent = state.path[state.path.length - 1] || ''
        if (parent === 'applicant-name' && state.partiesFormat === 'docdb') {
          if (!state.seenApplicants.has(text)) {
            state.seenApplicants.add(text)
            state.currentApplicant = { name: text }
            record.applicants.push(state.currentApplicant)
          }
        } else if (parent === 'inventor-name' && state.partiesFormat === 'docdb') {
          if (!state.seenInventors.has(text)) {
            state.seenInventors.add(text)
            record.inventors.push(text)
          }
        }
        break
      }

      case 'country':
        // Residence country of the applicant currently being built.
        if (state.currentApplicant && state.path[state.path.length - 1] === 'residence') {
          state.currentApplicant.country = text
        }
        break

      case 'text': {
        if (state.path[state.path.length - 1] !== 'classification-ipcr') break
        const code = normalizeIpc(text)
        if (code && !record.ipc.includes(code)) record.ipc.push(code)
        break
      }

      case 'applicant':
      case 'inventor':
        state.partiesFormat = null
        state.currentApplicant = null
        break

      case 'exchange-document':
        count++
        pending.push(onRecord(record))
        state.record = null
        break
    }

    state.text = ''
  })

  for await (const chunk of input) {
    parser.write(chunk.toString('utf8'))
    // Await any handler backpressure accumulated during this chunk.
    while (pending.length) await pending.shift()
  }
  parser.close()
  while (pending.length) await pending.shift()

  return count
}

/** Convenience for tests and small files. */
export async function parseDocdbString(xml: string): Promise<DocdbRecord[]> {
  const { Readable } = await import('node:stream')
  const records: DocdbRecord[] = []
  await parseDocdbStream(Readable.from([xml]), record => { records.push(record) })
  return records
}
