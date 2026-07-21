import AdmZip from 'adm-zip'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  listEntries,
  readEntryText,
  streamEntries,
  summarizeComposition,
  type ArchiveEntry,
} from './archive'

// NOTE: adm-zip is used here to BUILD tiny fixtures only. It must never be used
// at runtime to READ archives — it loads the whole file into memory and would
// OOM on a 10 GB delivery, which is why archive.ts uses yauzl.

let dir: string
let flatZip: string
let nestedZip: string

const CLAIMS_XML = '<claims><claim num="1">A device comprising a widget.</claim></claims>'

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'epo-archive-'))

  const flat = new AdmZip()
  flat.addFile('doc1.xml', Buffer.from(CLAIMS_XML))
  flat.addFile('doc2.xml', Buffer.from('<abstract>Short abstract.</abstract>'))
  // Stand-in for a PDF/A facsimile: incompressible bytes, much larger than the XML.
  flat.addFile('scan1.pdf', Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251)))
  flat.addFile('notes.txt', Buffer.from('readme'))
  flatZip = join(dir, 'flat.zip')
  flat.writeZip(flatZip)

  // A delivery zip containing a per-publication zip — the real BDDS shape.
  const inner = new AdmZip()
  inner.addFile('EP1234567B1.xml', Buffer.from('<description>Inner description text.</description>'))
  inner.addFile('EP1234567B1.pdf', Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 251)))

  const outer = new AdmZip()
  outer.addFile('outer.xml', Buffer.from('<index/>'))
  outer.addFile('EP1234567B1.zip', inner.toBuffer())
  nestedZip = join(dir, 'nested.zip')
  outer.writeZip(nestedZip)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

const pathsOf = (entries: ArchiveEntry[]) => entries.map(e => e.path).sort()

describe('listEntries', () => {
  it('enumerates every entry with sizes and extensions', async () => {
    const entries = await listEntries(flatZip)
    expect(pathsOf(entries)).toEqual(['doc1.xml', 'doc2.xml', 'notes.txt', 'scan1.pdf'])

    const doc1 = entries.find(e => e.path === 'doc1.xml')!
    expect(doc1.extension).toBe('xml')
    expect(doc1.uncompressedSize).toBe(Buffer.byteLength(CLAIMS_XML))
  })

  it('recurses into nested archives and namespaces the inner paths', async () => {
    const entries = await listEntries(nestedZip)
    expect(pathsOf(entries)).toContain('EP1234567B1.zip!/EP1234567B1.xml')
    expect(pathsOf(entries)).toContain('EP1234567B1.zip!/EP1234567B1.pdf')
    expect(pathsOf(entries)).toContain('outer.xml')
  })

  it('does not recurse when asked not to', async () => {
    const entries = await listEntries(nestedZip, { recurse: false })
    expect(entries.some(e => e.path.includes('!/'))).toBe(false)
  })
})

describe('streamEntries', () => {
  it('yields only matching entries — images are never decompressed', async () => {
    const seen: string[] = []
    for await (const entry of streamEntries(flatZip, e => e.extension === 'xml')) {
      seen.push(entry.path)
      await readEntryText(entry.stream)
    }
    expect(seen.sort()).toEqual(['doc1.xml', 'doc2.xml'])
    expect(seen).not.toContain('scan1.pdf')
  })

  it('reads the actual content of a matched entry', async () => {
    for await (const entry of streamEntries(flatZip, e => e.path === 'doc1.xml')) {
      expect(await readEntryText(entry.stream)).toBe(CLAIMS_XML)
    }
  })

  it('reaches XML inside a nested archive', async () => {
    const texts: string[] = []
    for await (const entry of streamEntries(nestedZip, e => e.extension === 'xml')) {
      texts.push(await readEntryText(entry.stream))
    }
    expect(texts).toContain('<description>Inner description text.</description>')
    expect(texts).toContain('<index/>')
  })

  it('yields nothing when the predicate matches nothing', async () => {
    const seen: string[] = []
    for await (const entry of streamEntries(flatZip, e => e.extension === 'docx')) {
      seen.push(entry.path)
    }
    expect(seen).toEqual([])
  })
})

describe('summarizeComposition', () => {
  it('groups by extension, biggest first — the images-vs-text report', async () => {
    const composition = summarizeComposition(await listEntries(flatZip))
    expect(composition[0].extension).toBe('pdf') // the facsimile dominates
    const xml = composition.find(r => r.extension === 'xml')!
    expect(xml.count).toBe(2)
    expect(xml.uncompressedBytes).toBeGreaterThan(0)
  })

  it('labels extensionless entries rather than dropping them', () => {
    const composition = summarizeComposition([
      { path: 'LICENSE', compressedSize: 10, uncompressedSize: 20, extension: '' },
    ])
    expect(composition[0].extension).toBe('(none)')
  })
})
