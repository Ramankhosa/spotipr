export interface NoveltyClaimExcerpt {
  text: string
  claimNumbers: number[]
  excerpted: boolean
}

interface ParsedClaimBlock {
  number: number
  text: string
  sourceIndex: number
  independent: boolean
  relevance: number
}

const CLAIM_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'comprising', 'comprises',
  'for', 'from', 'in', 'including', 'is', 'of', 'on', 'or', 'said', 'that',
  'the', 'thereof', 'to', 'wherein', 'which', 'with',
])

function normalizedText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function featureTokens(features: string[]): Set<string> {
  const tokens = new Set<string>()
  for (const feature of features) {
    for (const token of String(feature || '').toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || []) {
      if (!CLAIM_STOP_WORDS.has(token)) tokens.add(token)
    }
  }
  return tokens
}

function blockRelevance(text: string, tokens: Set<string>): number {
  const normalized = text.toLowerCase()
  let score = 0
  for (const token of Array.from(tokens)) {
    if (normalized.includes(token)) score += 1
  }
  return score
}

function isDependentClaim(text: string): boolean {
  return /\b(?:according to|as (?:set forth|recited|defined) in|of)\s+(?:any one of\s+)?claims?\s+\d+/i.test(text)
    || /\bclaims?\s+\d+\s*(?:-|to|and|or|,)\s*\d+/i.test(text)
}

function parseNumberedClaims(text: string, features: string[]): ParsedClaimBlock[] {
  const starts: Array<{ number: number; index: number; bodyIndex: number }> = []
  const pattern = /(?:^|\r?\n)\s*(?:claim\s+)?(\d{1,4})\s*[.):]\s*/gim
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    starts.push({
      number: Number(match[1]),
      index: match.index + (match[0].match(/^[\r\n]+/)?.[0].length || 0),
      bodyIndex: pattern.lastIndex,
    })
  }
  if (starts.length === 0) return []

  const tokens = featureTokens(features)
  return starts.map((start, sourceIndex) => {
    const end = starts[sourceIndex + 1]?.index ?? text.length
    const body = normalizedText(text.slice(start.bodyIndex, end))
    const rendered = `${start.number}. ${body}`.trim()
    return {
      number: start.number,
      text: rendered,
      sourceIndex,
      independent: !isDependentClaim(body),
      relevance: blockRelevance(body, tokens),
    }
  }).filter(block => block.text.length > 3)
}

function appendWithinBudget(parts: string[], value: string, maxChars: number): boolean {
  const separatorLength = parts.length > 0 ? 1 : 0
  const remaining = maxChars - parts.join('\n').length - separatorLength
  if (remaining <= 0) return false
  parts.push(value.length <= remaining ? value : value.slice(0, remaining).trimEnd())
  return value.length <= remaining
}

/**
 * Selects deterministic, feature-focused claim text without requiring another
 * model call. Claim 1 is protected, followed by other independent claims, then
 * feature-relevant dependent claims. Unparseable records safely fall back to a
 * prefix excerpt.
 */
export function selectNoveltyClaimExcerpt(
  claimsText: string,
  features: string[],
  maxChars: number
): NoveltyClaimExcerpt {
  const source = String(claimsText || '').trim()
  const budget = Math.max(1, Math.trunc(maxChars))
  if (!source) return { text: '', claimNumbers: [], excerpted: false }
  if (source.length <= budget) {
    const blocks = parseNumberedClaims(source, features)
    return {
      text: blocks.length > 0 ? blocks.map(block => block.text).join('\n') : normalizedText(source),
      claimNumbers: blocks.map(block => block.number),
      excerpted: false,
    }
  }

  const blocks = parseNumberedClaims(source, features)
  if (blocks.length === 0) {
    return { text: normalizedText(source.slice(0, budget)), claimNumbers: [], excerpted: true }
  }

  const claimOne = blocks.find(block => block.number === 1)
  const rankedIndependent = blocks
    .filter(block => block.independent && block !== claimOne)
    .sort((a, b) => b.relevance - a.relevance || a.sourceIndex - b.sourceIndex)
  const rankedDependent = blocks
    .filter(block => !block.independent && block !== claimOne)
    .sort((a, b) => b.relevance - a.relevance || a.sourceIndex - b.sourceIndex)
  const remaining = blocks
    .filter(block => block !== claimOne && !rankedIndependent.includes(block) && !rankedDependent.includes(block))
    .sort((a, b) => b.relevance - a.relevance || a.sourceIndex - b.sourceIndex)
  const ordered = [claimOne, ...rankedIndependent, ...rankedDependent, ...remaining]
    .filter((block): block is ParsedClaimBlock => Boolean(block))

  const parts: string[] = []
  const claimNumbers: number[] = []
  for (const block of ordered) {
    const complete = appendWithinBudget(parts, block.text, budget)
    if (parts[parts.length - 1]) claimNumbers.push(block.number)
    if (!complete) break
  }
  return {
    text: parts.join('\n'),
    claimNumbers,
    excerpted: true,
  }
}

export function findNoveltyClaimNumber(claimsText: string, quote: string): number | undefined {
  const normalizedQuote = normalizedText(quote).toLowerCase()
  if (!normalizedQuote) return undefined
  const blocks = parseNumberedClaims(String(claimsText || ''), [])
  return blocks.find(block => normalizedText(block.text).toLowerCase().includes(normalizedQuote))?.number
}

/** Equal allocation keeps batch order from deciding which claim-bearing patent is read. */
export function allocateNoveltyClaimsCharacters(
  claimBearingReferenceCount: number,
  perReferenceMaximum: number,
  batchMaximum: number,
  minimumPerReference = 2000
): number {
  const count = Math.max(0, Math.trunc(claimBearingReferenceCount))
  if (count === 0) return 0
  const minimum = Math.max(1, Math.trunc(minimumPerReference))
  const perReference = Math.max(minimum, Math.trunc(perReferenceMaximum))
  const effectiveBatchMaximum = Math.max(count * minimum, Math.trunc(batchMaximum))
  return Math.min(perReference, Math.max(minimum, Math.floor(effectiveBatchMaximum / count)))
}
