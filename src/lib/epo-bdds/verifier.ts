// Checksum verification for downloaded BDDS archives.
//
// The API documents `fileChecksum` but never states the algorithm, and the two
// reference clients only ever call it "checksum". Rather than assume MD5 we
// hash a file once with all three candidates and report which matches; the
// winning algorithm is persisted per file in the ledger.
//
// HARD RULE: a file that fails verification is never parsed and never loaded.

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { ChecksumAlgorithm } from './types'

const ALGORITHMS: ChecksumAlgorithm[] = ['md5', 'sha1', 'sha256']

/** Stream a file through one hash. Never buffers the whole file. */
export async function computeChecksum(filePath: string, algorithm: ChecksumAlgorithm): Promise<string> {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

/** Stream a file ONCE through all candidate hashes. */
export async function computeAllChecksums(filePath: string): Promise<Record<ChecksumAlgorithm, string>> {
  const hashes = ALGORITHMS.map(algorithm => ({ algorithm, hash: createHash(algorithm) }))
  for await (const chunk of createReadStream(filePath)) {
    for (const entry of hashes) entry.hash.update(chunk as Buffer)
  }
  return hashes.reduce((acc, entry) => {
    acc[entry.algorithm] = entry.hash.digest('hex')
    return acc
  }, {} as Record<ChecksumAlgorithm, string>)
}

function normalize(checksum: string): string {
  // Some feeds emit uppercase hex, or "md5:<hex>", or a base64 digest.
  return String(checksum || '').trim().replace(/^[a-z0-9]+[:=]/i, '').toLowerCase()
}

/**
 * Work out which algorithm the feed uses by comparing all three against the
 * advertised checksum. Returns null when none match (corrupt download, or an
 * algorithm/encoding we do not handle).
 */
export async function detectChecksumAlgorithm(
  filePath: string,
  expectedChecksum: string
): Promise<{ algorithm: ChecksumAlgorithm; digest: string } | null> {
  const expected = normalize(expectedChecksum)
  if (!expected) return null
  const digests = await computeAllChecksums(filePath)
  for (const algorithm of ALGORITHMS) {
    if (digests[algorithm] === expected) return { algorithm, digest: digests[algorithm] }
  }
  return null
}

export interface VerificationResult {
  ok: boolean
  algorithm: ChecksumAlgorithm | null
  expected: string
  actual: string | null
}

/**
 * Verify a downloaded file. When `algorithm` is known, hash once; otherwise
 * fall back to detection (first download of a product).
 */
export async function verifyFile(
  filePath: string,
  expectedChecksum: string,
  algorithm?: ChecksumAlgorithm | null
): Promise<VerificationResult> {
  const expected = normalize(expectedChecksum)
  if (!expected) {
    // No checksum advertised: we cannot verify, so we must not claim we did.
    return { ok: false, algorithm: algorithm ?? null, expected: '', actual: null }
  }

  if (algorithm) {
    const actual = await computeChecksum(filePath, algorithm)
    return { ok: actual === expected, algorithm, expected, actual }
  }

  const detected = await detectChecksumAlgorithm(filePath, expected)
  if (detected) return { ok: true, algorithm: detected.algorithm, expected, actual: detected.digest }

  const digests = await computeAllChecksums(filePath)
  return { ok: false, algorithm: null, expected, actual: digests.md5 }
}
