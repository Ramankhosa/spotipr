/**
 * Office Action Studio — invention document intake (deterministic, no LLM)
 *
 * Normalizes an attorney-provided specification / claims into:
 *   - paragraphs with stable IDs (¶0001…) — the anchors the s.59 basis finder
 *     and the UI basis chips cite;
 *   - canonical sections (field/background/summary/…);
 *   - individual claim elements (the claim-chart rows);
 *   - token-bounded chunks (each retaining its paragraph range) for one-time
 *     embedding and later retrieval.
 *
 * Everything here is pure string work — the whole point is to spend ZERO LLM
 * tokens on structure, so the only paid step later is a single embed pass.
 */

export interface Paragraph {
  id: string        // "¶0001"
  index: number     // 1-based
  text: string
}

export interface SectionSpan {
  key: string       // canonical section key
  heading: string   // as printed
  fromId: string    // first ¶ id
  toId: string      // last ¶ id
}

export interface ClaimElement {
  claimNumber: number
  isIndependent: boolean
  elementIndex: number
  text: string
}

export interface DocumentChunk {
  sectionRef: string  // "¶0038-¶0041"
  text: string
  tokenCount: number
}

/** ~4 chars/token heuristic — good enough for budgeting; never used for billing. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.replace(/\s+/g, ' ').trim().length / 4)
}

function padId(n: number): string {
  return '¶' + String(n).padStart(4, '0')
}

/**
 * Render internal paragraph anchors the way a filing does.
 *
 * ¶0007 is an internal anchor — it is what the retrieval blocks label chunks
 * with and what the s.59 basis check resolves against. It must never reach the
 * examiner: an Indian reply cites "paragraph [0007]". Apply this at display and
 * export time only; the stored text keeps the anchors so basis stays verifiable.
 */
export function formatParagraphRefs(text: string): string {
  return (text || '')
    // Already bracketed — "[¶0007; ¶0021–¶0022]" — just drop the markers, or the
    // next pass would nest a second pair of brackets inside the first.
    .replace(/\[([^\]]*¶[^\]]*)\]/g, (_m, inner: string) => `[${inner.replace(/¶\s?/g, '')}]`)
    .replace(/¶\s?(\d{1,6})/g, '[$1]')
}

/**
 * Split text into stable numbered paragraphs. Honors existing patent paragraph
 * markers ([0001], [0038]) when present; otherwise numbers blank-line-separated
 * blocks sequentially. IDs are 1-based and stable for a given input.
 */
export function splitParagraphs(text: string): Paragraph[] {
  const clean = (text || '').replace(/\r\n/g, '\n')
  const blocks = clean.split(/\n\s*\n+/).map(b => b.replace(/\s+/g, ' ').trim()).filter(Boolean)
  return blocks.map((t, i) => ({ id: padId(i + 1), index: i + 1, text: t }))
}

// Canonical section headings we recognize in an as-filed spec.
const SECTION_PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: 'title', re: /^title\b/i },
  { key: 'crossReference', re: /^(cross[- ]reference|related applications?)\b/i },
  { key: 'field', re: /^(field of (the )?invention|technical field)\b/i },
  { key: 'background', re: /^background\b/i },
  { key: 'objects', re: /^objects? of (the )?invention\b/i },
  { key: 'summary', re: /^summary\b/i },
  { key: 'briefDescriptionOfDrawings', re: /^brief description of (the )?(drawings|figures)\b/i },
  { key: 'detailedDescription', re: /^detailed description\b|^description of (the )?embodiments?\b/i },
  { key: 'claims', re: /^(what is claimed|claims?|i\/we claim)\b/i },
  { key: 'abstract', re: /^abstract\b/i },
]

/**
 * Assign paragraphs to canonical sections by detecting heading paragraphs.
 * A paragraph that is short and matches a heading pattern opens a section that
 * runs until the next heading. Text before the first heading is 'preamble'.
 */
export function splitSections(paragraphs: Paragraph[]): SectionSpan[] {
  const spans: SectionSpan[] = []
  let current: SectionSpan | null = null
  for (const p of paragraphs) {
    const short = p.text.length <= 60
    const match = short ? SECTION_PATTERNS.find(s => s.re.test(p.text)) : undefined
    if (match) {
      if (current) current.toId = paragraphs[p.index - 2]?.id || current.fromId
      current = { key: match.key, heading: p.text, fromId: p.id, toId: p.id }
      spans.push(current)
    } else if (current) {
      current.toId = p.id
    } else {
      current = { key: 'preamble', heading: '(preamble)', fromId: p.id, toId: p.id }
      spans.push(current)
    }
  }
  return spans
}

/**
 * Parse a claims block into elements. Splits into claims by leading number,
 * marks independence (a claim referring to "claim N" / "of claims" is dependent),
 * and splits each claim into elements on ';' and ' and ' at clause boundaries.
 */
export function parseClaimElements(claimsText: string): ClaimElement[] {
  const text = (claimsText || '').replace(/\r\n/g, '\n')
  // Split on a number that starts a claim (line start or after ". ").
  const parts = text.split(/(?=(?:^|\n)\s*\d+\s*[\.\)]\s)/).map(s => s.trim()).filter(Boolean)
  const elements: ClaimElement[] = []
  for (const part of parts) {
    const m = /^(\d+)\s*[\.\)]\s*([\s\S]*)$/.exec(part)
    if (!m) continue
    const claimNumber = Number(m[1])
    const body = m[2].replace(/\s+/g, ' ').trim()
    const isIndependent = !/\bclaim(?:s)?\s+\d+/i.test(body.slice(0, 80))
    // Claim elements are conventionally separated by ';' (optionally ';and').
    const clauses = body.split(/;\s*(?:and\s+)?/i).map(c => c.trim()).filter(c => c.length > 3)
    ;(clauses.length ? clauses : [body]).forEach((c, i) =>
      elements.push({ claimNumber, isIndependent, elementIndex: i, text: c })
    )
  }
  return elements
}

/**
 * Group paragraphs into token-bounded chunks (default ~400 tokens) with a
 * 1-paragraph overlap, each labelled with its paragraph range for citation.
 */
export function chunkParagraphs(paragraphs: Paragraph[], maxTokens = 400): DocumentChunk[] {
  const chunks: DocumentChunk[] = []
  let buf: Paragraph[] = []
  let tokens = 0
  const flush = () => {
    if (!buf.length) return
    chunks.push({
      sectionRef: buf.length === 1 ? buf[0].id : `${buf[0].id}-${buf[buf.length - 1].id}`,
      text: buf.map(p => p.text).join('\n\n'),
      tokenCount: tokens
    })
  }
  for (const p of paragraphs) {
    const t = estimateTokens(p.text)
    if (tokens + t > maxTokens && buf.length) {
      flush()
      const overlap = buf[buf.length - 1]
      buf = [overlap]
      tokens = estimateTokens(overlap.text)
    }
    buf.push(p)
    tokens += t
  }
  flush()
  return chunks
}

export interface NormalizedInvention {
  paragraphs: Paragraph[]
  sections: SectionSpan[]
  claimElements: ClaimElement[]
  chunks: DocumentChunk[]
  totalTokens: number
}

/** One-shot normalization of a spec (+ optional separate claims block). */
export function normalizeInvention(specText: string, claimsText?: string): NormalizedInvention {
  const paragraphs = splitParagraphs(specText)
  const sections = splitSections(paragraphs)
  const chunks = chunkParagraphs(paragraphs)
  const claimSource = claimsText || sectionText(paragraphs, sections, 'claims')
  const claimElements = parseClaimElements(claimSource)
  return {
    paragraphs,
    sections,
    claimElements,
    chunks,
    totalTokens: paragraphs.reduce((s, p) => s + estimateTokens(p.text), 0)
  }
}

function sectionText(paragraphs: Paragraph[], sections: SectionSpan[], key: string): string {
  const span = sections.find(s => s.key === key)
  if (!span) return ''
  const from = Number(span.fromId.slice(1)), to = Number(span.toId.slice(1))
  return paragraphs.filter(p => p.index >= from && p.index <= to).map(p => p.text).join('\n\n')
}

/**
 * Extract the claims section from a complete specification (Indian practice
 * files claims inside the complete specification). Returns '' when no claims
 * heading is found or the section parses to no claim elements — callers treat
 * that as "claims not present, ask for a separate upload".
 */
export function extractClaimsText(specText: string): string {
  const paragraphs = splitParagraphs(specText)
  const sections = splitSections(paragraphs)
  const text = sectionText(paragraphs, sections, 'claims')
  if (!text.trim()) return ''
  return parseClaimElements(text).length > 0 ? text : ''
}
