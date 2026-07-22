import AdmZip from 'adm-zip'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  EntryTooLargeError,
  MAX_ENTRY_TEXT_BYTES,
  readEntryText,
  streamEntries,
} from './archive'

// Regression cover for the failure that killed three whole 6 GB archives:
// one enormous entry (EP applications ship biological sequence listings as XML
// running to hundreds of MB) made Buffer.concat().toString() exceed Node's
// 0x1fffffe8 string limit, aborting the archive and losing ~5,000 good
// publications with it.

let dir: string
let zipPath: string
const SMALL_XML = '<ep-patent-document id="EP1"/>'
const BIG_BYTES = 3 * 1024 * 1024 // stands in for a sequence listing

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'epo-oversize-'))
  const zip = new AdmZip()
  zip.addFile('DOC/EP1.xml', Buffer.from(SMALL_XML))
  zip.addFile('DOC/SEQUENCE.xml', Buffer.alloc(BIG_BYTES, 0x41))
  zip.addFile('DOC/EP2.xml', Buffer.from(SMALL_XML))
  zipPath = join(dir, 'archive.zip')
  zip.writeZip(zipPath)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readEntryText size guard', () => {
  it('throws EntryTooLargeError instead of Node\'s opaque string-length crash', async () => {
    for await (const entry of streamEntries(zipPath, e => e.path.endsWith('SEQUENCE.xml'))) {
      await expect(
        readEntryText(entry.stream, { maxBytes: 1024, path: entry.path })
      ).rejects.toBeInstanceOf(EntryTooLargeError)
    }
  })

  it('names the offending entry, so the operator learns what it was', async () => {
    for await (const entry of streamEntries(zipPath, e => e.path.endsWith('SEQUENCE.xml'))) {
      await readEntryText(entry.stream, { maxBytes: 1024, path: entry.path }).catch(error => {
        expect(error.message).toContain('SEQUENCE.xml')
        expect(error.path).toContain('SEQUENCE.xml')
      })
    }
  })

  it('reads normal entries unaffected', async () => {
    for await (const entry of streamEntries(zipPath, e => e.path.endsWith('EP1.xml'))) {
      expect(await readEntryText(entry.stream, { path: entry.path })).toBe(SMALL_XML)
    }
  })

  it('defaults to a cap far below Node\'s limit but far above a real publication', () => {
    expect(MAX_ENTRY_TEXT_BYTES).toBeLessThan(0x1fffffe8)
    expect(MAX_ENTRY_TEXT_BYTES).toBeGreaterThan(1024 * 1024) // a publication is ~80 KB
  })
})

describe('skipping by uncompressedSize', () => {
  it('reports the real size up front, so an oversized entry is never read', async () => {
    const sizes = new Map<string, number>()
    for await (const entry of streamEntries(zipPath, () => true)) {
      sizes.set(entry.path, entry.uncompressedSize)
      entry.stream.resume() // the drain the loader uses when skipping
    }
    expect(sizes.get('DOC/SEQUENCE.xml')).toBe(BIG_BYTES)
    expect(sizes.get('DOC/EP1.xml')).toBe(Buffer.byteLength(SMALL_XML))
  })

  it('CONTINUES past a skipped entry — the whole point, since one bad entry used to kill the archive', async () => {
    const parsed: string[] = []
    for await (const entry of streamEntries(zipPath, e => e.path.endsWith('.xml'))) {
      if (entry.uncompressedSize > 1024) {
        entry.stream.resume()
        continue
      }
      parsed.push(await readEntryText(entry.stream, { path: entry.path }))
    }
    // Both good documents survive; only the oversized one is dropped.
    expect(parsed).toHaveLength(2)
    expect(parsed.every(x => x === SMALL_XML)).toBe(true)
  })
})
