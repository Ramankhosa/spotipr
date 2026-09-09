// Client-safe identity for a claim set.
//
// computeClaimsFingerprint (claims-fingerprint.ts) uses node's crypto and is
// server-only. The office-form findings panel needs to tell whether the report
// it holds still describes the claims in the editor, so it needs the same
// notion of identity in the browser. FNV-1a over the canonical claim list is
// enough: this is a staleness check, not a security boundary.

export function computeClaimsSignature(
  claims: Array<{ number?: number | string; text?: string | null }> | null | undefined
): string {
  const list = Array.isArray(claims) ? claims : []
  const canonical = list
    .map(claim => ({
      number: Number(claim?.number) || 0,
      text: String(claim?.text || '').replace(/\s+/g, ' ').trim(),
    }))
    .sort((a, b) => a.number - b.number)
  const input = JSON.stringify(canonical)
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  // Two passes over the input in opposite directions widen the signature
  // beyond 32 bits so accidental collisions between edits are negligible.
  let hash2 = 0x811c9dc5
  for (let i = input.length - 1; i >= 0; i--) {
    hash2 ^= input.charCodeAt(i)
    hash2 = Math.imul(hash2, 0x01000193) >>> 0
  }
  return `${hash.toString(16).padStart(8, '0')}${hash2.toString(16).padStart(8, '0')}`
}
