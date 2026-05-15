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

function inferCategory(text: string): DraftClaim['category'] {
  const lower = text.toLowerCase()
  if (/\bmethod|process\b/.test(lower)) return 'method'
  if (/\bsystem\b/.test(lower)) return 'system'
  if (/\bapparatus|device|assembly|module\b/.test(lower)) return 'apparatus'
  if (/\bcomposition|formulation\b/.test(lower)) return 'composition'
  if (/\bproduct|article\b/.test(lower)) return 'product'
  return undefined
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
  const dependencyFromText = text.match(/\bclaims?\s+(\d+)\b/i)
  const dependsOn = Number(dependsOnRaw || dependencyFromText?.[1])
  const validDependsOn = Number.isFinite(dependsOn) && dependsOn > 0 ? dependsOn : undefined

  const llmType = normalizeDraftClaimType(raw.type ?? raw.claimType ?? raw.claim_type ?? raw.kind)
  const type: DraftClaim['type'] = llmType || (number === 1 ? 'independent' : 'dependent')

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

    const dependency = claimText.match(/\bclaims?\s+(\d+)\b/i)
    const dependsOn = dependency ? Number(dependency[1]) : undefined
    const type: DraftClaim['type'] = number === 1 ? 'independent' : 'dependent'

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
    return {
      claims: textClaims,
      supportMatrix: [],
      qualityWarnings: [],
    }
  }

  throw new DraftClaimsParseError()
}

export function formatDraftClaimsAsHtml(claims: DraftClaim[]) {
  return claims
    .map(claim => `<p><strong>${claim.number}.</strong> ${stripTrailingClaimDependencyLabel(claim.text)}</p>`)
    .join('\n')
}
