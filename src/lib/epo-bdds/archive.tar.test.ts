import AdmZip from 'adm-zip'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline as streamPipeline } from 'node:stream/promises'
import { pack as tarPack } from 'tar-stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listEntries, readEntryText, streamEntries, summarizeComposition } from './archive'

// EP full-text ships 1978-2022 as TAR and 2023-2026 as ZIP, with identical
// contents inside: ./DOC/<kind>/<pub>.zip per publication. A whole year (52
// archives) failed with "End of central directory record signature not found"
// before the extractor learned to dispatch on the container format.
//
// Fixture mirrors the real structure verified against
// EPRTBJV1987000008001001.tar: ustar, PAX headers, ./-prefixed paths.

let dir: string
let tarPath: string
const XML_A = '<ep-patent-document id="EP1"/>'
const XML_B = '<ep-patent-document id="EP2"/>'

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'epo-tar-'))
  tarPath = join(dir, 'delivery.tar')

  const publication = (xml: string, name: string) => {
    const zip = new AdmZip()
    zip.addFile(`${name}.xml`, Buffer.from(xml))
    zip.addFile(`${name}.pdf`, Buffer.alloc(2048, 0x25)) // facsimile stand-in
    return zip.toBuffer()
  }

  const pack = tarPack()
  // Directory entries and ./ prefixes, exactly as the real archives carry them.
  pack.entry({ name: './', type: 'directory' })
  pack.entry({ name: './DOC/', type: 'directory' })
  pack.entry({ name: './DOC/EPNWB1/', type: 'directory' })
  pack.entry({ name: './DOC/EPNWB1/EP1NWB1.zip' }, publication(XML_A, 'EP1'))
  pack.entry({ name: './DOC/EPNWB1/EP2NWB1.zip' }, publication(XML_B, 'EP2'))
  pack.finalize()

  await streamPipeline(pack, createWriteStream(tarPath))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('TAR archives', () => {
  it('reaches the XML inside the nested ZIPs', async () => {
    const texts: string[] = []
    for await (const entry of streamEntries(tarPath, e => e.extension === 'xml')) {
      texts.push(await readEntryText(entry.stream, { path: entry.path }))
    }
    expect(texts.sort()).toEqual([XML_A, XML_B])
  })

  it('namespaces nested paths the same way ZIP archives do', async () => {
    const paths: string[] = []
    for await (const entry of streamEntries(tarPath, e => e.extension === 'xml')) {
      paths.push(entry.path)
      entry.stream.resume()
    }
    expect(paths.every(p => p.includes('!/'))).toBe(true)
    expect(paths.some(p => p.startsWith('DOC/EPNWB1/'))).toBe(true)
  })

  it('strips the ./ prefix the real archives use', async () => {
    const entries = await listEntries(tarPath)
    expect(entries.every(e => !e.path.startsWith('./'))).toBe(true)
  })

  it('never yields the PDF facsimiles when the predicate excludes them', async () => {
    const paths: string[] = []
    for await (const entry of streamEntries(tarPath, e => e.extension === 'xml')) {
      paths.push(entry.path)
      entry.stream.resume()
    }
    expect(paths.some(p => p.endsWith('.pdf'))).toBe(false)
  })

  it('enumerates and composes like a ZIP delivery', async () => {
    const composition = summarizeComposition(await listEntries(tarPath))
    const byExt = new Map(composition.map(r => [r.extension, r.count]))
    expect(byExt.get('xml')).toBe(2)
    expect(byExt.get('pdf')).toBe(2)
    expect(byExt.get('zip')).toBe(2) // the nested archives themselves
  })

  it('skips directory entries rather than treating them as files', async () => {
    const entries = await listEntries(tarPath)
    expect(entries.every(e => !e.path.endsWith('/'))).toBe(true)
  })

  it('yields nothing when the predicate matches nothing, without hanging', async () => {
    const seen: string[] = []
    for await (const entry of streamEntries(tarPath, e => e.extension === 'docx')) {
      seen.push(entry.path)
    }
    expect(seen).toEqual([])
  })
})
