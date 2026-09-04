/**
 * The identity of a scope's MEANING, not of its revision.
 *
 * `WhitespaceStudy.scopeVersion` increments on every save, including a save that
 * changed nothing. Keying the miner's staged field on the version alone meant
 * pressing Save re-staged a whole field — up to 120,000 families — and charged a
 * fresh metered operation for work already done. Keying it on the fingerprint
 * means two scopes that normalise to the same thing are the same field, and a
 * scope that genuinely changed is a different one.
 *
 * The same value decides whether a lead is still current: a lead screened
 * against a field that no longer exists must not keep showing its verdict, so
 * every lead carries the fingerprint it was mined and screened against and reads
 * STALE when the study's has moved on.
 */

import { createHash } from 'crypto'
import { normalizeScope } from '../scope-schema'
import { stableJson } from '../types'
import type { WhitespaceScope } from '../types'

/**
 * Normalise first, then hash. `stableJson` alone would make two identical scopes
 * differ over a trailing space or a re-ordered synonym list, and the whole point
 * is to recognise that they are the same field.
 */
export function scopeFingerprint(scope: WhitespaceScope): string {
  return createHash('sha256').update(stableJson(normalizeScope(scope))).digest('hex').slice(0, 32)
}

/** True when a stored fingerprint still describes the study's current scope. */
export function scopeMatches(scope: WhitespaceScope, fingerprint: string | null | undefined): boolean {
  return Boolean(fingerprint) && scopeFingerprint(scope) === fingerprint
}
