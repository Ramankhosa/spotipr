import { describe, it, expect } from 'vitest'
import {
  captureClaimsVersion,
  listClaimsVersions,
  MAX_CLAIMS_VERSIONS,
  resolveActiveClaimsVersion,
  restoreClaimsVersion,
} from '@/lib/claims-versions'
import { computeClaimsFingerprint } from '@/lib/claims-fingerprint'
import type { DraftClaim } from '@/lib/draft-claims-parser'

const claim = (number: number, text: string): DraftClaim => ({
  number,
  text,
  type: number === 1 ? 'independent' : 'dependent',
  ...(number === 1 ? {} : { dependsOn: 1 }),
})

const setA = [claim(1, 'A device comprising a plate.'), claim(2, 'The device of claim 1, wherein the plate is steel.')]
const setB = [claim(1, 'A device comprising a support member.'), claim(2, 'The device of claim 1, wherein the support member is steel.')]
const setC = [claim(1, 'A device comprising a support member and a seal.')]
const html = (claims: DraftClaim[]) => claims.map(c => `<p><strong>${c.number}.</strong> ${c.text}</p>`).join('\n')

describe('captureClaimsVersion', () => {
  it('records the first version of a fresh session', () => {
    const fields = captureClaimsVersion({}, { source: 'generated', html: html(setA), structured: setA, now: '2026-09-08T00:00:00.000Z' })
    expect(fields.claimsVersions).toHaveLength(1)
    expect(fields.claimsVersions[0]).toMatchObject({ id: 'v1', number: 1, source: 'generated', label: 'Generated claims', claimCount: 2 })
    expect(fields.claimsActiveVersionId).toBe('v1')
  })

  it('captures the pre-existing working set as a baseline for a session that predates the history', () => {
    const legacy = { claims: html(setA), claimsStructured: setA, claimsGeneratedAt: '2026-09-01T00:00:00.000Z' }
    const fields = captureClaimsVersion(legacy, { source: 'manual_edit', html: html(setB), structured: setB })
    expect(fields.claimsVersions.map(v => [v.id, v.source])).toEqual([['v1', 'baseline'], ['v2', 'manual_edit']])
    expect(fields.claimsVersions[0].createdAt).toBe('2026-09-01T00:00:00.000Z')
    expect(fields.claimsVersions[0].claimsStructured[0].text).toBe('A device comprising a plate.')
    expect(fields.claimsActiveVersionId).toBe('v2')
  })

  it('does not record identical content twice, only re-points at it', () => {
    const first = captureClaimsVersion({}, { source: 'generated', html: html(setA), structured: setA })
    const second = captureClaimsVersion({ ...first, claimsStructured: setA }, { source: 'manual_edit', html: html(setA), structured: setA })
    expect(second.claimsVersions).toHaveLength(1)
    expect(second.claimsActiveVersionId).toBe('v1')
  })

  it('appends a new version when an older version is active and the claims change', () => {
    const v1 = captureClaimsVersion({}, { source: 'generated', html: html(setA), structured: setA })
    const v2 = captureClaimsVersion({ ...v1, claimsStructured: setA }, { source: 'manual_edit', html: html(setB), structured: setB })
    const restored = restoreClaimsVersion({ ...v2, claimsStructured: setB, claims: html(setB) }, 'v1')
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    const v3 = captureClaimsVersion(restored.normalized, { source: 'challenge_apply', html: html(setC), structured: setC, note: 'Claim 1: added seal' })
    expect(v3.claimsVersions.map(v => v.id)).toEqual(['v1', 'v2', 'v3'])
    expect(v3.claimsVersions[2].note).toBe('Claim 1: added seal')
    expect(v3.claimsActiveVersionId).toBe('v3')
  })

  it('never records an empty claim set', () => {
    const fields = captureClaimsVersion({ claimsVersions: [], claimsActiveVersionId: undefined }, { source: 'finalized', html: '', structured: [] })
    expect(fields.claimsVersions).toEqual([])
    expect(fields).not.toHaveProperty('claimsActiveVersionId')
  })

  it('drops the oldest version beyond the cap but never the active one', () => {
    let record: Record<string, any> = {}
    for (let index = 0; index < MAX_CLAIMS_VERSIONS + 3; index++) {
      const structured = [claim(1, `A device comprising part ${index}.`)]
      const fields = captureClaimsVersion(record, { source: 'manual_edit', html: html(structured), structured })
      record = { ...record, ...fields, claimsStructured: structured }
    }
    const versions = listClaimsVersions(record)
    expect(versions).toHaveLength(MAX_CLAIMS_VERSIONS)
    expect(versions[0].id).toBe('v4')
    expect(versions[versions.length - 1].id).toBe(record.claimsActiveVersionId)
  })
})

describe('restoreClaimsVersion', () => {
  const history = (() => {
    const v1 = captureClaimsVersion({}, { source: 'generated', html: html(setA), structured: setA })
    const v2 = captureClaimsVersion({ ...v1, claimsStructured: setA }, { source: 'challenge_apply', html: html(setB), structured: setB })
    return { ...v2, claims: html(setB), claimsStructured: setB, claimsProvisional: html(setB), claimsStructuredProvisional: setB }
  })()

  it('makes the version the working set and syncs the provisional pair', () => {
    const result = restoreClaimsVersion(history, 'v1', '2026-09-08T10:00:00.000Z')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.normalized.claimsStructured[0].text).toBe('A device comprising a plate.')
    expect(result.normalized.claims).toContain('a plate.')
    expect(result.normalized.claimsStructuredProvisional[0].text).toBe('A device comprising a plate.')
    expect(result.normalized.claimsProvisional).toContain('a plate.')
    expect(result.normalized.claimsActiveVersionId).toBe('v1')
    expect(result.normalized.claimsLastSavedAt).toBe('2026-09-08T10:00:00.000Z')
    // History is untouched by a switch.
    expect(listClaimsVersions(result.normalized).map(v => v.id)).toEqual(['v1', 'v2'])
  })

  it('refuses when the claims are locked', () => {
    const result = restoreClaimsVersion({ ...history, claimsApprovedAt: '2026-09-08T00:00:00.000Z' }, 'v1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('CLAIMS_LOCKED')
  })

  it('refuses an unknown version', () => {
    const result = restoreClaimsVersion(history, 'v9')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NO_SUCH_VERSION')
  })

  it('discards a challenge preview drafted against other claims and reopens the challenge', () => {
    const record = {
      ...history,
      claimsChallenge: { status: 'REFINE_READY', remarks: [{ id: 'R1' }], claimsFingerprint: computeClaimsFingerprint(setB) },
      claimsChallengeRefinePreview: { claimsFingerprint: computeClaimsFingerprint(setB), refinedClaims: [{ number: 1 }] },
    }
    const result = restoreClaimsVersion(record, 'v1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.normalized).not.toHaveProperty('claimsChallengeRefinePreview')
    expect(result.normalized.claimsChallenge.status).toBe('OPEN')
    expect(result.normalized.claimsChallenge.remarks).toHaveLength(1)
  })

  it('keeps a preview whose fingerprint matches the restored version', () => {
    const record = {
      ...history,
      claimsChallenge: { status: 'REFINE_READY', remarks: [] },
      claimsChallengeRefinePreview: { claimsFingerprint: computeClaimsFingerprint(setA), refinedClaims: [{ number: 1 }] },
    }
    const result = restoreClaimsVersion(record, 'v1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.normalized.claimsChallengeRefinePreview).toBeDefined()
    expect(result.normalized.claimsChallenge.status).toBe('REFINE_READY')
  })
})

describe('resolveActiveClaimsVersion', () => {
  it('prefers the version whose content matches the working claims', () => {
    const v1 = captureClaimsVersion({}, { source: 'generated', html: html(setA), structured: setA })
    const v2 = captureClaimsVersion({ ...v1, claimsStructured: setA }, { source: 'manual_edit', html: html(setB), structured: setB })
    // Pointer says v2 but the working set was put back to setA out of band.
    const active = resolveActiveClaimsVersion({ ...v2, claimsStructured: setA })
    expect(active?.id).toBe('v1')
  })

  it('falls back to the pointer when nothing matches', () => {
    const v1 = captureClaimsVersion({}, { source: 'generated', html: html(setA), structured: setA })
    const active = resolveActiveClaimsVersion({ ...v1, claimsStructured: setC })
    expect(active?.id).toBe('v1')
  })

  it('is null with no history', () => {
    expect(resolveActiveClaimsVersion({ claimsStructured: setA })).toBeNull()
  })
})
