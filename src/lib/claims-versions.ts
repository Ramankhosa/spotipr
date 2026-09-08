// Claim set version history.
//
// Every tracked change to the working claims (generation, a manual save, a
// challenge apply, a prior-art refinement apply, finalisation) records the
// resulting claim set as a version. The attorney can switch the working set to
// any recorded version and back again; switching moves a pointer, it never
// rewrites history, and a later change made while an older version is active
// simply appends a new version.
//
// Storage is inside normalizedData alongside the claims it describes:
//   claimsVersions        ClaimsVersion[]   oldest first
//   claimsActiveVersionId string            the version the working set came from
//
// Everything here is pure so the rules are unit-testable.

import type { DraftClaim } from '@/lib/draft-claims-parser'
import { formatDraftClaimsAsHtml } from '@/lib/draft-claims-parser'
import { computeClaimsFingerprint } from '@/lib/claims-fingerprint'

/** Versions kept per claim set. The oldest non-active version is dropped first. */
export const MAX_CLAIMS_VERSIONS = 20

export type ClaimsVersionSource =
  | 'generated'
  | 'manual_edit'
  | 'challenge_apply'
  | 'refinement_apply'
  | 'finalized'
  | 'baseline'

export const CLAIMS_VERSION_LABELS: Record<ClaimsVersionSource, string> = {
  generated: 'Generated claims',
  manual_edit: 'Manual edit',
  challenge_apply: 'Challenge amendments',
  refinement_apply: 'Prior-art refinement',
  finalized: 'Finalized claims',
  baseline: 'Earlier claims',
}

export type ClaimsVersion = {
  id: string
  number: number
  createdAt: string
  source: ClaimsVersionSource
  label: string
  note?: string
  fingerprint: string
  claimCount: number
  claims: string
  claimsStructured: DraftClaim[]
}

export type CaptureClaimsVersionParams = {
  source: ClaimsVersionSource
  html: string
  structured: DraftClaim[]
  note?: string
  label?: string
  now?: string
}

export type ClaimsVersionFields = {
  claimsVersions: ClaimsVersion[]
  claimsActiveVersionId?: string
}

function isVersion(value: any): value is ClaimsVersion {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    Number.isFinite(Number(value.number)) &&
    Array.isArray(value.claimsStructured)
  )
}

/** The stored history, oldest first, with malformed entries dropped. */
export function listClaimsVersions(normalized: Record<string, any> | null | undefined): ClaimsVersion[] {
  const raw = normalized?.claimsVersions
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isVersion)
    .map(version => ({ ...version, number: Number(version.number) }))
    .sort((a, b) => a.number - b.number)
}

function makeVersion(
  number: number,
  params: { source: ClaimsVersionSource; html: string; structured: DraftClaim[]; note?: string; label?: string; createdAt: string; fingerprint?: string }
): ClaimsVersion {
  const structured = params.structured.map(claim => ({ ...claim }))
  const html = String(params.html || '').trim() || formatDraftClaimsAsHtml(structured)
  const note = String(params.note || '').trim()
  return {
    id: `v${number}`,
    number,
    createdAt: params.createdAt,
    source: params.source,
    label: String(params.label || '').trim() || CLAIMS_VERSION_LABELS[params.source],
    ...(note ? { note } : {}),
    fingerprint: params.fingerprint || computeClaimsFingerprint(structured),
    claimCount: structured.length,
    claims: html,
    claimsStructured: structured,
  }
}

function trimVersions(versions: ClaimsVersion[], activeId: string): ClaimsVersion[] {
  if (versions.length <= MAX_CLAIMS_VERSIONS) return versions
  const kept = [...versions]
  while (kept.length > MAX_CLAIMS_VERSIONS) {
    const index = kept.findIndex(version => version.id !== activeId)
    if (index === -1) break
    kept.splice(index, 1)
  }
  return kept
}

/**
 * Records `structured` as the newest version and makes it active.
 *
 * `previous` is the record BEFORE the change. A session that predates the
 * history has no versions at all, so the first capture also records what the
 * working set was before this change: otherwise the attorney's first switch
 * would have nowhere to go back to. Identical content is never recorded twice;
 * a save that changes nothing just re-points at the version already holding
 * that content. An empty claim set is never recorded.
 *
 * Returns only the two history fields, to be spread into the update.
 */
export function captureClaimsVersion(
  previous: Record<string, any> | null | undefined,
  params: CaptureClaimsVersionParams
): ClaimsVersionFields {
  const prior = previous || {}
  const versions = listClaimsVersions(prior)
  const structured = Array.isArray(params.structured) ? params.structured.filter(claim => claim && String(claim.text || '').trim()) : []
  if (structured.length === 0) {
    return {
      claimsVersions: versions,
      ...(typeof prior.claimsActiveVersionId === 'string' ? { claimsActiveVersionId: prior.claimsActiveVersionId } : {}),
    }
  }

  const now = params.now || new Date().toISOString()
  const fingerprint = computeClaimsFingerprint(structured)
  let next = [...versions]

  if (next.length === 0) {
    const priorStructured: DraftClaim[] = Array.isArray(prior.claimsStructured) ? prior.claimsStructured : []
    if (priorStructured.length > 0 && computeClaimsFingerprint(priorStructured) !== fingerprint) {
      next.push(makeVersion(1, {
        source: 'baseline',
        html: typeof prior.claims === 'string' ? prior.claims : '',
        structured: priorStructured,
        createdAt: String(prior.claimsLastSavedAt || prior.claimsGeneratedAt || now),
      }))
    }
  }

  const existing = next.find(version => version.fingerprint === fingerprint)
  if (existing) {
    return { claimsVersions: next, claimsActiveVersionId: existing.id }
  }

  const number = next.reduce((max, version) => Math.max(max, version.number), 0) + 1
  const version = makeVersion(number, { ...params, structured, createdAt: now, fingerprint })
  next.push(version)
  next = trimVersions(next, version.id)
  return { claimsVersions: next, claimsActiveVersionId: version.id }
}

/** The version the working claims currently match, by content first and pointer second. */
export function resolveActiveClaimsVersion(normalized: Record<string, any> | null | undefined): ClaimsVersion | null {
  const versions = listClaimsVersions(normalized)
  if (versions.length === 0) return null
  const working: DraftClaim[] = Array.isArray(normalized?.claimsStructured) ? normalized!.claimsStructured : []
  if (working.length > 0) {
    const fingerprint = computeClaimsFingerprint(working)
    const byContent = versions.find(version => version.fingerprint === fingerprint)
    if (byContent) return byContent
  }
  const pointer = normalized?.claimsActiveVersionId
  return versions.find(version => version.id === pointer) || null
}

export type RestoreClaimsVersionResult =
  | { ok: true; normalized: Record<string, any>; version: ClaimsVersion }
  | { ok: false; code: string; error: string }

/**
 * Makes a recorded version the working claim set.
 *
 * The provisional pair follows, exactly as a manual save does while the claims
 * are unlocked, so the prior-art refinement stage sees the switch too. A
 * challenge amendment preview drafted against different claims is discarded,
 * because its fingerprint can no longer match and applying it would be refused
 * anyway; the challenge itself and its dispositions are kept so switching back
 * restores a consistent review.
 */
export function restoreClaimsVersion(
  normalized: Record<string, any> | null | undefined,
  versionId: string,
  now: string = new Date().toISOString()
): RestoreClaimsVersionResult {
  const current = normalized || {}
  if (current.claimsApprovedAt) {
    return { ok: false, code: 'CLAIMS_LOCKED', error: 'Claims are locked. Unlock them before switching versions.' }
  }
  const version = listClaimsVersions(current).find(entry => entry.id === String(versionId || '').trim())
  if (!version) {
    return { ok: false, code: 'NO_SUCH_VERSION', error: 'That claim version no longer exists.' }
  }
  const structured = version.claimsStructured.filter(claim => claim && String(claim.text || '').trim())
  if (structured.length === 0) {
    return { ok: false, code: 'EMPTY_VERSION', error: 'That claim version holds no claims and cannot be restored.' }
  }
  const html = String(version.claims || '').trim() || formatDraftClaimsAsHtml(structured)

  const next: Record<string, any> = {
    ...current,
    claims: html,
    claimsStructured: structured.map(claim => ({ ...claim })),
    claimsProvisional: html,
    claimsStructuredProvisional: structured.map(claim => ({ ...claim })),
    claimsLastSavedAt: now,
    claimsActiveVersionId: version.id,
  }

  const preview = current.claimsChallengeRefinePreview
  if (preview && preview.claimsFingerprint !== version.fingerprint) {
    delete next.claimsChallengeRefinePreview
    if (current.claimsChallenge?.status === 'REFINE_READY') {
      next.claimsChallenge = { ...current.claimsChallenge, status: 'OPEN' }
    }
  }

  return { ok: true, normalized: next, version }
}
