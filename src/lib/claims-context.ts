import {
  formatDraftClaimsAsHtml,
  normalizeDraftClaimType,
  type DraftClaim,
} from '@/lib/draft-claims-parser'

export type ClaimSource = 'final' | 'working' | 'provisional' | 'none'

export interface ClaimsSnapshot {
  structured: DraftClaim[]
  html: string
  frozen: boolean
  source: ClaimSource
}

export interface IndependentClaimContext {
  number: number
  category?: string
  text: string
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function arrayOrEmpty(value: unknown): DraftClaim[] {
  return Array.isArray(value) ? value.filter(isRecord) as DraftClaim[] : []
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstStructured(
  normalized: Record<string, any>,
  keys: string[]
): { structured: DraftClaim[]; source: ClaimSource; key?: string } {
  for (const key of keys) {
    const structured = arrayOrEmpty(normalized[key])
    if (structured.length > 0) {
      const source: ClaimSource =
        key === 'claimsStructuredFinal' ? 'final' :
        key === 'claimsStructuredProvisional' ? 'provisional' :
        'working'
      return { structured, source, key }
    }
  }
  return { structured: [], source: 'none' }
}

function firstHtml(normalized: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    const html = stringOrEmpty(normalized[key])
    if (html) return html
  }
  return ''
}

function cleanClaimText(claim: any): string {
  const raw = stringOrEmpty(claim?.text)
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function claimNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim())
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
  }
  return 0
}

export function normalizeClaimsForSession(normalized: Record<string, any> = {}): Record<string, any> {
  const merged = { ...(isRecord(normalized) ? normalized : {}) }

  if (!merged.claimsProvisional && merged.claims) merged.claimsProvisional = merged.claims
  if (!merged.claimsStructuredProvisional && merged.claimsStructured) {
    merged.claimsStructuredProvisional = merged.claimsStructured
  }

  if (merged.claimsApprovedAt) {
    // Backfill the frozen pair TOGETHER, never field by field.
    //
    // These two used to be filled independently, so a session that already had
    // claimsStructuredFinal but no claimsFinal took its HTML from the working
    // `claims` — pairing a frozen structured claim set with working HTML, and
    // letting a section anchor on one revision while rendering another.
    const hasStructuredFinal = Array.isArray(merged.claimsStructuredFinal) && merged.claimsStructuredFinal.length > 0

    if (!hasStructuredFinal && Array.isArray(merged.claimsStructured) && merged.claimsStructured.length > 0) {
      merged.claimsStructuredFinal = merged.claimsStructured
      if (!merged.claimsFinal) merged.claimsFinal = merged.claims || merged.claimsProvisional
    } else if (!hasStructuredFinal && !merged.claimsFinal) {
      // No structured claims at all on either side — HTML is all there is.
      merged.claimsFinal = merged.claims || merged.claimsProvisional
    }
    // When claimsStructuredFinal already exists, claimsFinal is deliberately left
    // alone: getAuthoritativeClaims renders the frozen structured set instead of
    // adopting unrelated working HTML.
  }

  return merged
}

/** HTML key that belongs with each structured key, so the pair never desyncs. */
const HTML_KEY_FOR_STRUCTURED: Record<string, string> = {
  claimsStructuredFinal: 'claimsFinal',
  claimsStructured: 'claims',
  claimsStructuredProvisional: 'claimsProvisional',
}

export function getAuthoritativeClaims(normalizedInput: Record<string, any> = {}): ClaimsSnapshot {
  const normalized = normalizeClaimsForSession(normalizedInput)
  const frozen = !!normalized.claimsApprovedAt
  const structuredKeys = frozen
    ? ['claimsStructuredFinal', 'claimsStructured', 'claimsStructuredProvisional']
    : ['claimsStructured', 'claimsStructuredProvisional', 'claimsStructuredFinal']

  const { structured, source, key } = firstStructured(normalized, structuredKeys)

  // Resolve the HTML from the SAME generation as the structured claims.
  //
  // These two used to be resolved from independent priority lists: structured
  // from ['claimsStructuredFinal', …] and html from ['claimsFinal', …]. When a
  // frozen session had claimsStructuredFinal but no claimsFinal, the structured
  // claims came from the frozen set while the HTML fell through to the working
  // `claims` — so the Claim-1 anchor injected into a section and the claims text
  // rendered beside it could come from different revisions.
  const pairedHtmlKey = key ? HTML_KEY_FOR_STRUCTURED[key] : undefined
  const pairedHtml = pairedHtmlKey ? stringOrEmpty(normalized[pairedHtmlKey]) : ''
  const html = pairedHtml
    || (structured.length ? formatDraftClaimsAsHtml(structured) : '')
    || firstHtml(normalized, frozen
      ? ['claimsFinal', 'claims', 'claimsProvisional']
      : ['claims', 'claimsProvisional', 'claimsFinal'])

  return { structured, html, frozen, source }
}

export function getEditableClaims(normalizedInput: Record<string, any> = {}): ClaimsSnapshot {
  const normalized = normalizeClaimsForSession(normalizedInput)
  const { structured, source } = firstStructured(normalized, [
    'claimsStructured',
    'claimsStructuredProvisional',
    'claimsStructuredFinal',
  ])
  const html = firstHtml(normalized, ['claims', 'claimsProvisional', 'claimsFinal']) ||
    (structured.length ? formatDraftClaimsAsHtml(structured) : '')

  return { structured, html, frozen: !!normalized.claimsApprovedAt, source }
}

export function getIndependentClaims(
  normalizedInput: Record<string, any> | null | undefined,
  options: { requireFrozen?: boolean } = {}
): IndependentClaimContext[] {
  if (!normalizedInput) return []
  const snapshot = getAuthoritativeClaims(normalizedInput)
  if (options.requireFrozen && !snapshot.frozen) return []

  return snapshot.structured
    .filter((claim: any) => normalizeDraftClaimType(claim?.type) === 'independent')
    .map((claim: any) => ({
      number: claimNumber(claim.number),
      category: stringOrEmpty(claim.category) || undefined,
      text: cleanClaimText(claim),
    }))
    .filter(claim => claim.text)
    .sort((a, b) => (a.number || Number.MAX_SAFE_INTEGER) - (b.number || Number.MAX_SAFE_INTEGER))
}

export function formatIndependentClaimsText(claims: IndependentClaimContext[]): string {
  if (claims.length === 0) return ''
  if (claims.length === 1) return claims[0].text

  return claims
    .map(claim => {
      const number = claim.number || '?'
      const label = claim.category ? ` (${claim.category})` : ''
      return `Claim ${number}${label}:\n${claim.text}`
    })
    .join('\n\n')
}

export function getIndependentClaimsText(
  normalizedInput: Record<string, any> | null | undefined,
  options: { requireFrozen?: boolean } = {}
): string {
  return formatIndependentClaimsText(getIndependentClaims(normalizedInput, options))
}
