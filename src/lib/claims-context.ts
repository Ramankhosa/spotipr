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
): { structured: DraftClaim[]; source: ClaimSource } {
  for (const key of keys) {
    const structured = arrayOrEmpty(normalized[key])
    if (structured.length > 0) {
      const source: ClaimSource =
        key === 'claimsStructuredFinal' ? 'final' :
        key === 'claimsStructuredProvisional' ? 'provisional' :
        'working'
      return { structured, source }
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
    if (!merged.claimsFinal) merged.claimsFinal = merged.claims || merged.claimsProvisional
    if (!merged.claimsStructuredFinal && merged.claimsStructured) {
      merged.claimsStructuredFinal = merged.claimsStructured
    }
  }

  return merged
}

export function getAuthoritativeClaims(normalizedInput: Record<string, any> = {}): ClaimsSnapshot {
  const normalized = normalizeClaimsForSession(normalizedInput)
  const frozen = !!normalized.claimsApprovedAt
  const structuredKeys = frozen
    ? ['claimsStructuredFinal', 'claimsStructured', 'claimsStructuredProvisional']
    : ['claimsStructured', 'claimsStructuredProvisional', 'claimsStructuredFinal']
  const htmlKeys = frozen
    ? ['claimsFinal', 'claims', 'claimsProvisional']
    : ['claims', 'claimsProvisional', 'claimsFinal']

  const { structured, source } = firstStructured(normalized, structuredKeys)
  const html = firstHtml(normalized, htmlKeys) || (structured.length ? formatDraftClaimsAsHtml(structured) : '')

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
