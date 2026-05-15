import { describe, expect, test } from 'vitest'
import {
  formatIndependentClaimsText,
  getAuthoritativeClaims,
  getEditableClaims,
  getIndependentClaims,
  getIndependentClaimsText,
  normalizeClaimsForSession,
} from '@/lib/claims-context'

describe('claims context helpers', () => {
  test('uses frozen final claims as authoritative when claims are approved', () => {
    const snapshot = getAuthoritativeClaims({
      claimsApprovedAt: '2026-05-15T00:00:00.000Z',
      claimsStructured: [{ number: 1, type: 'independent', text: 'A working system.' }],
      claimsStructuredFinal: [{ number: 1, type: 'independent', text: 'A frozen system.' }],
      claims: '<p><strong>1.</strong> A working system.</p>',
      claimsFinal: '<p><strong>1.</strong> A frozen system.</p>',
    })

    expect(snapshot.source).toBe('final')
    expect(snapshot.structured[0].text).toBe('A frozen system.')
    expect(snapshot.html).toContain('A frozen system')
  })

  test('uses working claims before final fields after unfreeze', () => {
    const snapshot = getAuthoritativeClaims({
      claimsStructured: [{ number: 1, type: 'independent', text: 'A working system.' }],
      claimsStructuredFinal: [{ number: 1, type: 'independent', text: 'A stale frozen system.' }],
      claims: '<p><strong>1.</strong> A working system.</p>',
      claimsFinal: '<p><strong>1.</strong> A stale frozen system.</p>',
    })

    expect(snapshot.source).toBe('working')
    expect(snapshot.structured[0].text).toBe('A working system.')
  })

  test('uses legacy final-only claims as fallback when no working copy exists', () => {
    const snapshot = getAuthoritativeClaims({
      claimsStructuredFinal: [{ number: 1, type: 'independent', text: 'A legacy frozen system.' }],
      claimsFinal: '<p><strong>1.</strong> A legacy frozen system.</p>',
    })

    expect(snapshot.source).toBe('final')
    expect(snapshot.structured[0].text).toBe('A legacy frozen system.')
  })

  test('keeps editable claims working-copy first', () => {
    const snapshot = getEditableClaims({
      claimsApprovedAt: '2026-05-15T00:00:00.000Z',
      claimsStructured: [{ number: 1, type: 'independent', text: 'Editable claim.' }],
      claimsStructuredFinal: [{ number: 1, type: 'independent', text: 'Frozen claim.' }],
    })

    expect(snapshot.source).toBe('working')
    expect(snapshot.structured[0].text).toBe('Editable claim.')
  })

  test('formats only LLM-classified independent claims', () => {
    const normalized = normalizeClaimsForSession({
      claimsStructured: [
        { number: 1, type: 'independent', category: 'system', text: 'A system comprising a controller.' },
        { number: 2, type: 'dependent', text: 'The system of claim 1, wherein the controller filters signals.' },
        { number: 8, type: 'independent', category: 'method', text: 'A method comprising controlling the system.' },
      ],
    })

    const independentClaims = getIndependentClaims(normalized)
    expect(independentClaims.map(claim => claim.number)).toEqual([1, 8])
    expect(formatIndependentClaimsText(independentClaims)).toContain('Claim 8 (method):')
    expect(getIndependentClaimsText(normalized)).not.toContain('filters signals')
  })

  test('requires frozen independent claims when requested', () => {
    expect(getIndependentClaims({
      claimsStructured: [{ number: 1, type: 'independent', text: 'A working claim.' }],
    }, { requireFrozen: true })).toEqual([])
  })
})
