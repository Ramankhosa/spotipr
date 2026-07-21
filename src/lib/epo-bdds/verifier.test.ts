import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { computeAllChecksums, computeChecksum, detectChecksumAlgorithm, verifyFile } from './verifier'

let dir: string
let filePath: string
const CONTENT = 'EPO BDDS archive contents, pretend this is a multi-GB zip.'

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'epo-verifier-'))
  filePath = join(dir, 'sample.zip')
  await writeFile(filePath, CONTENT)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

const digestOf = (algorithm: string) => createHash(algorithm).update(CONTENT).digest('hex')

describe('computeChecksum', () => {
  it('matches node crypto for each algorithm', async () => {
    expect(await computeChecksum(filePath, 'md5')).toBe(digestOf('md5'))
    expect(await computeChecksum(filePath, 'sha1')).toBe(digestOf('sha1'))
    expect(await computeChecksum(filePath, 'sha256')).toBe(digestOf('sha256'))
  })
})

describe('computeAllChecksums', () => {
  it('produces all three digests from a single pass', async () => {
    const digests = await computeAllChecksums(filePath)
    expect(digests.md5).toBe(digestOf('md5'))
    expect(digests.sha1).toBe(digestOf('sha1'))
    expect(digests.sha256).toBe(digestOf('sha256'))
  })
})

describe('detectChecksumAlgorithm', () => {
  it('identifies the algorithm the feed used', async () => {
    expect((await detectChecksumAlgorithm(filePath, digestOf('md5')))?.algorithm).toBe('md5')
    expect((await detectChecksumAlgorithm(filePath, digestOf('sha256')))?.algorithm).toBe('sha256')
  })

  it('tolerates uppercase hex and an algorithm prefix', async () => {
    expect((await detectChecksumAlgorithm(filePath, digestOf('sha1').toUpperCase()))?.algorithm).toBe('sha1')
    expect((await detectChecksumAlgorithm(filePath, `md5:${digestOf('md5')}`))?.algorithm).toBe('md5')
  })

  it('returns null when nothing matches, rather than assuming md5', async () => {
    expect(await detectChecksumAlgorithm(filePath, 'deadbeef')).toBeNull()
  })
})

describe('verifyFile', () => {
  it('passes a good file against a known algorithm', async () => {
    const result = await verifyFile(filePath, digestOf('md5'), 'md5')
    expect(result.ok).toBe(true)
    expect(result.algorithm).toBe('md5')
  })

  it('FAILS a corrupt file — the gate that stops it ever being parsed', async () => {
    const corrupt = join(dir, 'corrupt.zip')
    await writeFile(corrupt, `${CONTENT} but tampered with`)
    const result = await verifyFile(corrupt, digestOf('md5'), 'md5')
    expect(result.ok).toBe(false)
    expect(result.actual).not.toBe(result.expected)
  })

  it('detects the algorithm when it is not yet known', async () => {
    const result = await verifyFile(filePath, digestOf('sha256'))
    expect(result.ok).toBe(true)
    expect(result.algorithm).toBe('sha256')
  })

  it('does not claim success when no checksum was advertised', async () => {
    const result = await verifyFile(filePath, '')
    expect(result.ok).toBe(false)
  })
})
