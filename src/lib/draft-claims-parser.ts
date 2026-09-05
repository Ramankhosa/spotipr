export type DraftClaim = {
  number: number
  type: 'independent' | 'dependent'
  dependsOn?: number
  text: string
  category?: 'method' | 'system' | 'apparatus' | 'composition' | 'product'
}

export type DraftClaimSupportMatrixItem = {
  claimNumber: number
  supportRefs: string[]
  supportSummary?: string
  sourceFields?: string[]
}

export type DraftClaimsGenerationPayload = {
  claims: DraftClaim[]
  supportMatrix: DraftClaimSupportMatrixItem[]
  qualityWarnings: string[]
}

export class DraftClaimsParseError extends Error {
  constructor(message = 'Could not parse generated claims from the LLM response.') {
    super(message)
    this.name = 'DraftClaimsParseError'
  }
}

const CLAIM_CATEGORIES = ['method', 'system', 'apparatus', 'composition', 'product'] as const

export function normalizeDraftClaimType(value: unknown): DraftClaim['type'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')

  if (!normalized) return undefined
  if (['i', 'ind', 'independent', 'independent claim'].includes(normalized)) return 'independent'
  if (['d', 'dep', 'dependent', 'dependent claim'].includes(normalized)) return 'dependent'
  if (/^independent\b/.test(normalized)) return 'independent'
  if (/^dependent\b/.test(normalized)) return 'dependent'
  return undefined
}

function stripMarkdownFences(text: string) {
  return text
    .replace(/^```(?:json|jsonc)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function extractCodeBlocks(text: string) {
  const blocks: string[] = []
  const regex = /```(?:json|jsonc)?\s*\n?([\s\S]*?)\n?\s*```/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match[1]?.trim()) blocks.push(match[1].trim())
  }
  return blocks
}

function extractBalancedJson(text: string, startIndex: number) {
  const open = text[startIndex]
  const close = open === '{' ? '}' : open === '[' ? ']' : null
  if (!close) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === open) depth++
    if (ch === close) {
      depth--
      if (depth === 0) return text.slice(startIndex, i + 1)
    }
  }

  return null
}

function extractJsonCandidates(text: string) {
  const candidates = new Set<string>()
  const trimmed = stripMarkdownFences(text)

  if (trimmed) candidates.add(trimmed)
  for (const block of extractCodeBlocks(text)) candidates.add(block)

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{' && text[i] !== '[') continue
    const balanced = extractBalancedJson(text, i)
    if (balanced) candidates.add(balanced)
  }

  const firstObject = text.indexOf('{')
  const lastObject = text.lastIndexOf('}')
  if (firstObject >= 0 && lastObject > firstObject) {
    candidates.add(text.slice(firstObject, lastObject + 1))
  }

  const firstArray = text.indexOf('[')
  const lastArray = text.lastIndexOf(']')
  if (firstArray >= 0 && lastArray > firstArray) {
    candidates.add(text.slice(firstArray, lastArray + 1))
  }

  return Array.from(candidates)
}

function escapeNewlinesInsideStrings(input: string) {
  let out = ''
  let inString = false
  let escape = false

  for (const ch of input) {
    if (escape) {
      out += ch
      escape = false
      continue
    }
    if (ch === '\\') {
      out += ch
      escape = true
      continue
    }
    if (ch === '"') {
      out += ch
      inString = !inString
      continue
    }
    if (inString && ch === '\n') {
      out += '\\n'
      continue
    }
    if (inString && ch === '\r') {
      continue
    }
    out += ch
  }

  return out
}

function repairJsonCandidate(candidate: string) {
  return escapeNewlinesInsideStrings(candidate)
    .replace(/^\uFEFF/, '')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*:/g, '$1"$2":')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
}

function parseJsonCandidate(candidate: string) {
  const attempts = [candidate.trim(), repairJsonCandidate(candidate)]
  for (const attempt of attempts) {
    if (!attempt) continue
    try {
      return JSON.parse(attempt)
    } catch {}
  }
  return null
}

/**
 * A claim's category is set by its preamble — "A method of…", "A system for…" —
 * not by vocabulary anywhere in its body.
 *
 * The old version tested `/\bmethod|process\b/` across the whole claim, first.
 * That alternation binds as `\bmethod` OR `process\b`, so the ordinary verb in
 * "configured to process the data" matched and every system claim that described
 * processing was categorised as a method. Read the preamble, and only fall back
 * to whole-text vocabulary when there is no recognisable preamble.
 */
const CATEGORY_NOUNS: Array<[RegExp, NonNullable<DraftClaim['category']>]> = [
  [/\b(method|process)\b/, 'method'],
  [/\bsystem\b/, 'system'],
  [/\b(apparatus|device|assembly|machine|module)\b/, 'apparatus'],
  [/\b(composition|formulation)\b/, 'composition'],
  [/\b(product|article)\b/, 'product'],
]

/**
 * The claim preamble: the opening noun phrase, cut at whatever starts the body.
 * "A control system for a vehicle, comprising…" → "a control system for a vehicle".
 */
function claimPreamble(lower: string): string {
  const cut = lower.search(
    /\s*(?:,|:|;|\bcomprising\b|\bconsisting\b|\bincluding\b|\bwherein\b|\bcharacteri[sz]ed\b|\baccording\s+to\b|\bas\s+(?:claimed|recited|defined|set\s+forth)\s+in\b|\bof\s+claims?\s+\d)/
  )
  return (cut >= 0 ? lower.slice(0, cut) : lower).slice(0, 160)
}

function inferCategory(text: string): DraftClaim['category'] {
  const lower = String(text || '').toLowerCase()

  // The EARLIEST category noun in the preamble wins: "a method of manufacturing a
  // device" is a method, "a device for performing a method" is an apparatus. This
  // works for dependent claims too ("the device of claim 1" → apparatus), which
  // an "a/an"-only preamble test missed — they fell through to whole-text
  // vocabulary, where "configured to process the signal" made them methods.
  const preamble = claimPreamble(lower)
  let best: { index: number; category: NonNullable<DraftClaim['category']> } | undefined
  for (const [pattern, category] of CATEGORY_NOUNS) {
    const match = preamble.match(pattern)
    if (match && match.index !== undefined && (!best || match.index < best.index)) {
      best = { index: match.index, category }
    }
  }
  if (best) return best.category

  // No category noun in the preamble at all — fall back to whole-text vocabulary,
  // most specific first, with every alternation grouped so boundaries apply.
  for (const [pattern, category] of [CATEGORY_NOUNS[3], CATEGORY_NOUNS[0], CATEGORY_NOUNS[1], CATEGORY_NOUNS[2], CATEGORY_NOUNS[4]]) {
    if (pattern.test(lower)) return category
  }
  return undefined
}

/**
 * Whether a claim's own text says it depends on another claim.
 *
 * Returns the referenced claim number, or undefined for an independent claim.
 * A dependent claim names its parent in its preamble, in one of two shapes:
 *
 *   US style   — "The system of claim 1, wherein…"
 *   EP/IN/PCT  — "A method according to claim 1, wherein…",
 *                "Apparatus as claimed in claim 1…",
 *                "The device according to any one of claims 1 to 3…"
 *
 * Only the preamble counts. A parent reference deeper in the body ("…coupled to
 * the housing of claim 1") is an incorporation by reference inside an otherwise
 * independent claim, and matching it used to file such claims as dependent.
 */
export function dependencyFromClaimText(text: string): number | undefined {
  const opening = String(text || '').slice(0, 200)
  const patterns = [
    // "The/Said <noun phrase> of claim N"
    /^\s*(?:the|said)\s+[^.;,:]{0,80}?\s+of\s+(?:any\s+(?:one\s+)?of\s+)?claims?\s+(\d+)/i,
    // "<article?> <noun phrase> according to / as claimed in / as recited in /
    // as defined in / as set forth in claim N" — any article, including none.
    /^\s*(?:(?:a|an|the|said)\s+)?[^.;,:]{0,80}?\s+(?:according\s+to|as\s+(?:claimed|recited|defined|described|set\s+forth)\s+in|as\s+in)\s+(?:any\s+(?:one\s+)?of\s+)?(?:the\s+)?(?:preceding\s+)?claims?\s+(\d+)/i,
  ]
  for (const pattern of patterns) {
    const match = opening.match(pattern)
    if (match) {
      const parsed = Number(match[1])
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
  }
  return undefined
}

/**
 * True when a claim opens the way an independent claim does. Exported for the
 * section guardrail, which otherwise demanded dependent form of every claim
 * after the first and flagged every multi-independent claim set.
 */
export function looksLikeIndependentClaim(text: string): boolean {
  return dependencyFromClaimText(text) === undefined && /^\s*(?:a|an)\s+/i.test(String(text || ''))
}

/**
 * Classify a claim from its own text when the model omitted the `type` field.
 *
 * The previous default was `number === 1 ? 'independent' : 'dependent'`, which
 * silently filed every second and later independent claim as dependent — with
 * the claim text ("A method of…" vs "The system of claim 1…") sitting unread. The
 * UDB anchors Summary, Detailed Description, Abstract and Best Mode on the stored
 * independent claims, so a claim misfiled that way lost its written-description
 * support entirely.
 */
function inferClaimType(text: string, number: number, dependsOn?: number): DraftClaim['type'] {
  if (dependsOn && dependsOn !== number) return 'dependent'
  if (number === 1) return 'independent'
  // A dependent claim must reference its parent in its preamble; a claim with no
  // such reference is independent by definition, whatever article it opens with
  // ("Apparatus for…" and "Method of…" are ordinary EP independent-claim openings).
  // The one carve-out: an opening "The/Said …" with no parent reference is a
  // malformed dependent claim, not a new independent one — keep it dependent so
  // the guardrail reports it rather than the UDB anchoring a section on it.
  if (/^\s*(?:the|said)\s+/i.test(String(text || ''))) return 'dependent'
  return 'independent'
}

function normalizeCategory(value: unknown, text: string): DraftClaim['category'] {
  const normalized = typeof value === 'string' ? value.toLowerCase().trim() : ''
  if ((CLAIM_CATEGORIES as readonly string[]).includes(normalized)) {
    return normalized as DraftClaim['category']
  }
  return inferCategory(text)
}

export function stripTrailingClaimDependencyLabel(value: string) {
  return value
    .replace(/\s*\(\s*Claim\s*\d+\s*\)\s*$/i, '')
    .trim()
}

export function stripTrailingClaimDependencyLabelsFromHtml(value: string) {
  return value
    .replace(/\s*\(\s*Claim\s*\d+\s*\)\s*(<\/p>)/gi, '$1')
    .replace(/\s*\(\s*Claim\s*\d+\s*\)\s*$/i, '')
    .trim()
}

function cleanClaimText(value: string, number?: number) {
  let text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (number) {
    text = text.replace(new RegExp(`^(?:claim\\s*)?${number}\\s*[.):\\-]?\\s*`, 'i'), '').trim()
  }

  return stripTrailingClaimDependencyLabel(text)
}

function normalizeClaim(raw: any, index: number): DraftClaim | null {
  if (!raw || typeof raw !== 'object') return null

  const number = Number(raw.number ?? raw.claimNumber ?? raw.claim_no ?? raw.claimNo ?? index + 1)
  if (!Number.isFinite(number) || number <= 0) return null

  const rawText = raw.text ?? raw.claim ?? raw.claimText ?? raw.body ?? raw.content
  if (typeof rawText !== 'string') return null

  const text = cleanClaimText(rawText, number)
  if (!text) return null

  const dependsOnRaw = raw.dependsOn ?? raw.depends_on ?? raw.parentClaim ?? raw.parent
  // Only an opening "The <noun> of claim N" counts as a dependency. Matching any
  // "claim N" anywhere in the body picked up incidental references.
  const textDependency = dependencyFromClaimText(text)
  const dependsOn = Number(dependsOnRaw || textDependency)
  const validDependsOn = Number.isFinite(dependsOn) && dependsOn > 0 && dependsOn !== number
    ? dependsOn
    : undefined

  const llmType = normalizeDraftClaimType(raw.type ?? raw.claimType ?? raw.claim_type ?? raw.kind)
  const type: DraftClaim['type'] = llmType || inferClaimType(text, number, validDependsOn)

  return {
    number,
    type,
    ...(type === 'dependent' && validDependsOn ? { dependsOn: validDependsOn } : {}),
    text,
    category: normalizeCategory(raw.category ?? raw.claimCategory, text),
  }
}

function normalizeClaimsFromParsed(parsed: any): DraftClaim[] {
  const rawClaims = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.claims)
      ? parsed.claims
      : Array.isArray(parsed?.generatedClaims)
        ? parsed.generatedClaims
        : null

  if (!rawClaims) {
    if (typeof parsed?.claims === 'string') {
      return parseClaimsFromNumberedText(parsed.claims)
    }
    return []
  }

  return rawClaims
    .map((claim: any, index: number) => normalizeClaim(claim, index))
    .filter(Boolean) as DraftClaim[]
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => typeof item === 'string' ? item.trim() : item == null ? '' : String(item).trim())
    .filter(Boolean)
}

function normalizeSupportMatrixItem(raw: any): DraftClaimSupportMatrixItem | null {
  if (!raw || typeof raw !== 'object') return null
  const claimNumber = Number(raw.claimNumber ?? raw.claim_number ?? raw.number ?? raw.claim)
  if (!Number.isFinite(claimNumber) || claimNumber <= 0) return null

  const supportRefs = toStringArray(raw.supportRefs ?? raw.support_refs ?? raw.sourceFactIds ?? raw.source_fact_ids ?? raw.refs)
  const sourceFields = toStringArray(raw.sourceFields ?? raw.source_fields ?? raw.fields)
  const supportSummary = typeof raw.supportSummary === 'string'
    ? raw.supportSummary.trim()
    : typeof raw.support_summary === 'string'
      ? raw.support_summary.trim()
      : typeof raw.summary === 'string'
        ? raw.summary.trim()
        : undefined

  return {
    claimNumber,
    supportRefs,
    ...(supportSummary ? { supportSummary } : {}),
    ...(sourceFields.length ? { sourceFields } : {}),
  }
}

function normalizeSupportMatrix(value: unknown): DraftClaimSupportMatrixItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeSupportMatrixItem)
    .filter(Boolean) as DraftClaimSupportMatrixItem[]
}

function normalizeQualityWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        const message = record.message || record.warning || record.reason || record.title
        return typeof message === 'string' ? message.trim() : JSON.stringify(item)
      }
      return item == null ? '' : String(item).trim()
    })
    .filter(Boolean)
}

function normalizePayloadFromParsed(parsed: any): DraftClaimsGenerationPayload {
  return {
    claims: sortAndDedupeClaims(normalizeClaimsFromParsed(parsed)),
    supportMatrix: normalizeSupportMatrix(parsed?.supportMatrix ?? parsed?.support_matrix ?? parsed?.claimSupportMatrix),
    qualityWarnings: normalizeQualityWarnings(parsed?.qualityWarnings ?? parsed?.quality_warnings ?? parsed?.warnings),
  }
}

function parseClaimsFromNumberedText(output: string): DraftClaim[] {
  const text = output
    .replace(/```(?:text|claims)?\s*/gi, '')
    .replace(/```/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\*\*/g, '')

  const claims: DraftClaim[] = []
  const claimRegex = /(?:^|\n)\s*(?:[-*]\s*)?(?:Claim\s*)?(\d{1,3})\s*[.)\:-]\s*([\s\S]*?)(?=(?:\n\s*(?:[-*]\s*)?(?:Claim\s*)?\d{1,3}\s*[.)\:-]\s+)|$)/gi
  let match: RegExpExecArray | null

  while ((match = claimRegex.exec(text)) !== null) {
    const number = Number(match[1])
    const claimText = cleanClaimText(match[2] || '', number)
    if (!claimText) continue

    const dependsOn = dependencyFromClaimText(claimText)
    const type: DraftClaim['type'] = inferClaimType(claimText, number, dependsOn)

    claims.push({
      number,
      type,
      ...(type === 'dependent' && dependsOn ? { dependsOn } : {}),
      text: claimText,
      category: inferCategory(claimText),
    })
  }

  return claims
}

function sortAndDedupeClaims(claims: DraftClaim[]) {
  const byNumber = new Map<number, DraftClaim>()
  for (const claim of claims) {
    if (!byNumber.has(claim.number)) byNumber.set(claim.number, claim)
  }
  return Array.from(byNumber.values()).sort((a, b) => a.number - b.number)
}

export function parseGeneratedClaimsFromLLMOutput(output: string): DraftClaim[] {
  return parseGeneratedClaimsPayloadFromLLMOutput(output).claims
}

export function parseGeneratedClaimsPayloadFromLLMOutput(output: string): DraftClaimsGenerationPayload {
  if (!output || !output.trim()) {
    throw new DraftClaimsParseError('The LLM returned an empty claims response.')
  }

  for (const candidate of extractJsonCandidates(output)) {
    const parsed = parseJsonCandidate(candidate)
    if (!parsed) continue

    const payload = normalizePayloadFromParsed(parsed)
    if (payload.claims.length > 0) return payload
  }

  const textClaims = sortAndDedupeClaims(parseClaimsFromNumberedText(output))
  if (textClaims.length > 0) {
    // Recovered from plain text because no JSON candidate parsed. The model's own
    // support matrix and quality warnings are gone with the JSON — downstream,
    // mergeSupportMatrix falls back to substring matching and isGenericClaimOne
    // (which wants >= 2 support refs) starts firing on well-supported claims.
    // Say so rather than returning empty arrays that read as "nothing to report".
    return {
      claims: textClaims,
      supportMatrix: [],
      qualityWarnings: [
        'Claims were recovered from plain text because the model did not return parseable JSON. Source-support references for each claim could not be read and were reconstructed by text matching only; verify claim support before relying on the support matrix.',
      ],
    }
  }

  throw new DraftClaimsParseError()
}

export function formatDraftClaimsAsHtml(claims: DraftClaim[]) {
  return claims
    .map(claim => `<p><strong>${claim.number}.</strong> ${stripTrailingClaimDependencyLabel(claim.text)}</p>`)
    .join('\n')
}
