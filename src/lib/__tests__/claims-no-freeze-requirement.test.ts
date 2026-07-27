import { describe, expect, it } from 'vitest'
import {
  areClaimsFrozen,
  getGatingReason,
  isClaim1AvailableForDrafting,
  shouldGateSection,
} from '@/lib/section-injection-config'

// Freezing a claim set is an optional lock, not a prerequisite for downstream drafting.
// These tests pin that: only a total absence of claims may block section generation.

const STRUCTURED_CLAIMS = [
  { number: 1, type: 'independent', category: 'system', text: 'A system comprising a controller.' },
  { number: 2, type: 'dependent', dependsOn: 1, category: 'system', text: 'The system of claim 1, wherein...' },
]

const UNFROZEN = {
  claims: '<p><strong>1.</strong> A system comprising a controller.</p>',
  claimsStructured: STRUCTURED_CLAIMS,
}

const FROZEN = {
  ...UNFROZEN,
  claimsFinal: UNFROZEN.claims,
  claimsStructuredFinal: STRUCTURED_CLAIMS,
  claimsApprovedAt: '2026-07-27T00:00:00.000Z',
}

// A section that requires Claim 1 — the case that used to demand frozen claims.
const GATED_SECTION = 'detailedDescription'

describe('drafting works without freezing claims', () => {
  it('treats unfrozen claims as available for drafting', () => {
    expect(isClaim1AvailableForDrafting(UNFROZEN)).toBe(true)
    expect(isClaim1AvailableForDrafting(FROZEN)).toBe(true)
  })

  it('does not gate a claim-dependent section on unfrozen claims', () => {
    expect(shouldGateSection(GATED_SECTION, UNFROZEN)).toBe(false)
    expect(getGatingReason(GATED_SECTION, UNFROZEN)).toBeNull()
  })

  it('still gates when no claims exist at all', () => {
    expect(shouldGateSection(GATED_SECTION, {})).toBe(true)
    expect(getGatingReason(GATED_SECTION, {})).toContain('no claims are available')
    expect(shouldGateSection(GATED_SECTION, null)).toBe(true)
  })

  it('accepts claims that only exist as HTML', () => {
    const htmlOnly = { claims: '<p>1. A system comprising a controller.</p>' }
    expect(isClaim1AvailableForDrafting(htmlOnly)).toBe(true)
    expect(shouldGateSection(GATED_SECTION, htmlOnly)).toBe(false)
  })

  it('still reports lock state for callers that care', () => {
    expect(areClaimsFrozen(UNFROZEN)).toBe(false)
    expect(areClaimsFrozen(FROZEN)).toBe(true)
  })
})
