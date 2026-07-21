// Streaming access to BDDS archives.
//
// Two properties matter here and both come from yauzl:
//
//   1. A zip carries a central directory, so we can enumerate every entry —
//      with its compressed and uncompressed size — WITHOUT decompressing
//      anything. That is what makes the composition report cheap.
//   2. Entries can be opened selectively. EP full-text packages are ~95% PDF/A
//      page images, which are useless for search; we never decompress them.
//
// ⚠️ Do NOT reach for `adm-zip` (already a dependency of this repo). It reads
// the entire archive into memory and will OOM on a 10 GB weekly delivery.
//
// Archives are also nested — a delivery zip contains per-publication zips — so
// the iterator recurses, spilling inner archives to a temp file only when it
// must.

import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl, { type Entry, type ZipFile } from 'yauzl'

export interface ArchiveEntry {
  /** Path within the archive, including any nested-archive prefix. */
  path: string
  compressedSize: number
  uncompressedSize: number
  /** Lowercased extension without the dot, or '' when there is none. */
  extension: string
}

function extensionOf(path: string): string {
  const match = path.match(/\.([A-Za-z0-9]+)\s*$/)
  return match ? match[1].toLowerCase() : ''
}

function openZip(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    // lazyEntries lets us pull entries one at a time instead of buffering them.
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (error, zipFile) => {
      if (error || !zipFile) reject(error ?? new Error(`Could not open ${zipPath}`))
      else resolve(zipFile)
    })
  })
}

function openEntryStream(zipFile: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error(`Could not read ${entry.fileName}`))
      else resolve(stream as unknown as Readable)
    })
  })
}

const isDirectory = (entry: Entry) => /\/$/.test(entry.fileName)
const isNestedArchive = (path: string) => /\.(zip)$/i.test(path)

/**
 * Enumerate every entry, recursing into nested zips.
 *
 * Reads the central directory only — no entry payload is decompressed — EXCEPT
 * for nested archives, which must be extracted to be enumerated. Pass
 * `recurse: false` to describe the outer archive alone (much faster, and enough
 * for a first look at composition).
 */
export async function listEntries(
  zipPath: string,
  options: { recurse?: boolean; prefix?: string } = {}
): Promise<ArchiveEntry[]> {
  const recurse = options.recurse ?? true
  const prefix = options.prefix ?? ''
  const zipFile = await openZip(zipPath)
  const entries: ArchiveEntry[] = []
  const nested: Entry[] = []

  await new Promise<void>((resolve, reject) => {
    zipFile.on('entry', (entry: Entry) => {
      if (!isDirectory(entry)) {
        const path = prefix + entry.fileName
        entries.push({
          path,
          compressedSize: entry.compressedSize,
          uncompressedSize: entry.uncompressedSize,
          extension: extensionOf(entry.fileName),
        })
        if (recurse && isNestedArchive(entry.fileName)) nested.push(entry)
      }
      zipFile.readEntry()
    })
    zipFile.on('end', () => resolve())
    zipFile.on('error', reject)
    zipFile.readEntry()
  })

  for (const entry of nested) {
    const scratch = await mkdtemp(join(tmpdir(), 'epo-nested-'))
    const innerPath = join(scratch, 'inner.zip')
    try {
      await pipeline(await openEntryStream(zipFile, entry), createWriteStream(innerPath))
      entries.push(...await listEntries(innerPath, {
        recurse,
        prefix: `${prefix}${entry.fileName}!/`,
      }))
    } catch {
      // A nested archive we cannot open is reported as the opaque entry we
      // already recorded above, rather than failing the whole listing.
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => {})
    }
  }

  zipFile.close()
  return entries
}

export interface StreamedEntry {
  path: string
  uncompressedSize: number
  stream: Readable
}

/**
 * Yield read streams for entries matching `predicate`, recursing into nested
 * zips. Non-matching entries are never decompressed.
 *
 * Consume each `stream` fully before advancing the iterator.
 */
export async function* streamEntries(
  zipPath: string,
  predicate: (entry: ArchiveEntry) => boolean,
  options: { prefix?: string } = {}
): AsyncGenerator<StreamedEntry> {
  const prefix = options.prefix ?? ''
  const zipFile = await openZip(zipPath)

  // Walk the directory first so we can close over a plain list; nested archives
  // are handled after, to avoid holding two zip handles open mid-stream.
  const pending: Entry[] = []
  await new Promise<void>((resolve, reject) => {
    zipFile.on('entry', (entry: Entry) => {
      if (!isDirectory(entry)) pending.push(entry)
      zipFile.readEntry()
    })
    zipFile.on('end', () => resolve())
    zipFile.on('error', reject)
    zipFile.readEntry()
  })

  try {
    for (const entry of pending) {
      const path = prefix + entry.fileName
      const described: ArchiveEntry = {
        path,
        compressedSize: entry.compressedSize,
        uncompressedSize: entry.uncompressedSize,
        extension: extensionOf(entry.fileName),
      }

      if (isNestedArchive(entry.fileName)) {
        const scratch = await mkdtemp(join(tmpdir(), 'epo-nested-'))
        const innerPath = join(scratch, 'inner.zip')
        try {
          await pipeline(await openEntryStream(zipFile, entry), createWriteStream(innerPath))
          yield* streamEntries(innerPath, predicate, { prefix: `${path}!/` })
        } finally {
          await rm(scratch, { recursive: true, force: true }).catch(() => {})
        }
        continue
      }

      if (!predicate(described)) continue // never decompressed
      yield {
        path,
        uncompressedSize: entry.uncompressedSize,
        stream: await openEntryStream(zipFile, entry),
      }
    }
  } finally {
    zipFile.close()
  }
}

export interface CompositionRow {
  extension: string
  count: number
  compressedBytes: number
  uncompressedBytes: number
}

/** Group entries by extension — the basis of the "how much is images?" report. */
export function summarizeComposition(entries: ArchiveEntry[]): CompositionRow[] {
  const byExtension = new Map<string, CompositionRow>()
  for (const entry of entries) {
    const key = entry.extension || '(none)'
    const row = byExtension.get(key) ?? {
      extension: key, count: 0, compressedBytes: 0, uncompressedBytes: 0,
    }
    row.count++
    row.compressedBytes += entry.compressedSize
    row.uncompressedBytes += entry.uncompressedSize
    byExtension.set(key, row)
  }
  // Array.from, not spread: the repo's tsconfig target predates downlevelIteration.
  return Array.from(byExtension.values()).sort((a, b) => b.compressedBytes - a.compressedBytes)
}

/** Read a whole entry into a string. Only for entries known to be small (XML). */
export async function readEntryText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}
