// Stable identity for a claim set.
//
// Used by the claim challenge to detect that claims changed after a review ran,
// and by the claim version history to recognise identical content. Whitespace
// insensitive so a reformat does not count as a change, but any substantive
// edit to text or numbering does. Server-only: it uses node's crypto module.

import { createHash } from 'crypto'
import type { DraftClaim } from '@/lib/draft-claims-parser'

export function computeClaimsFingerprint(claims: DraftClaim[] | null | undefined): string {
  const list = Array.isArray(claims) ? claims : []
  const canonical = list
    .map(claim => ({
      number: Number(claim?.number) || 0,
      text: String(claim?.text || '').replace(/\s+/g, ' ').trim(),
    }))
    .sort((a, b) => a.number - b.number)
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16)
}
