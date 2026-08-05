/**
 * Office Action Studio — invention document intake (deterministic, no LLM)
 *
 * Normalizes an attorney-provided specification / claims into:
 *   - paragraphs with stable IDs — the anchors the basis finder and the UI
 *     basis chips cite;
 *   - canonical sections (field/background/summary/…);
 *   - individual claim elements (the claim-chart rows);
 *   - token-bounded chunks (each retaining its paragraph range) for one-time
 *     embedding and later retrieval.
 *
 * Everything here is pure string work — the whole point is to spend ZERO LLM
 * tokens on structure, so the only paid step later is a single embed pass.
 *
 * PARAGRAPH NUMBERING IS THE LOAD-BEARING PART. An Indian reply cites basis as
 * "paragraph [0007]" of the specification as filed. If that number is one we
 * invented by counting blocks, the reply tells the Controller something false
 * about their own file — and the basis check, resolving against the same
 * invented table, agrees with it. So numbering has two modes:
 *
 *   AUTHORED — the document carries its own [0038] markers and we read them.
 *              Anchors are `¶0038`, and `¶0038` IS the document's [0038].
 *   DERIVED  — the document has no markers. Anchors are positional `¶0001`,
 *              usable internally for retrieval and basis resolution, and
 *              NEVER renderable as a filing citation.
 *
 * `citable` is the single flag that governs the difference. The filing renderer
 * never emits a number it cannot stand behind — it substitutes a visible
 * placeholder instead. It does not refuse to render: whether to file is the
 * attorney's decision, and the lint has already told them what is unresolved.
 */

export type ParagraphNumbering = 'AUTHORED' | 'DERIVED'
export type NumberingConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export interface Paragraph {
  /** "¶0038" (authored marker or derived position) | "§0007" (never citable) */
  id: string
  /** 1-based POSITION in the document. Never the marker — splitSections depends on this. */
  index: number
  text: string
  /** The document's own marker digits, present only when authored and valid. */
  marker?: string
  /** May this anchor become a filing citation? */
  citable: boolean
  /** PDF sources only — pages are unknowable for DOCX and pasted text. */
  pageNumber?: number
}

export interface MarkerAnalysis {
  mode: ParagraphNumbering
  confidence: NumberingConfidence
  /** Why the document was not read as authored, or which anomalies downgraded confidence. */
  reasons: string[]
  markerCount: number
  firstMarker?: string
  lastMarker?: string
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
  /** Verbatim span from the claims text — what elementId is anchored to. */
  sourceText: string
  startOffset: number
  endOffset: number
  /** Stable across re-parses and unaffected by element re-ordering. */
  elementId: string
}

export interface DocumentChunk {
  /** "¶0038-¶0041", or null when the chunk holds no anchorable paragraph. */
  sectionRef: string | null
  text: string
  tokenCount: number
}

/**
 * Page separator emitted by the PDF extractor. A form feed is the conventional
 * page break and never occurs in real prose, so it survives as an unambiguous
 * signal without colliding with document content.
 */
export const PAGE_SEPARATOR = '\f'

/** ~4 chars/token heuristic — good enough for budgeting; never used for billing. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.replace(/\s+/g, ' ').trim().length / 4)
}

function padNum(n: number | string): string {
  return String(n).padStart(4, '0')
}

// ---------------------------------------------------------------------------
// Marker analysis
// ---------------------------------------------------------------------------

/**
 * A paragraph marker at the start of a line: [0038], ［0038］, 【0038】.
 * Anchored to line start deliberately — an inline "[12]" is a reference, and a
 * mid-sentence bracketed number is never paragraph numbering.
 */
const MARKER_RE = /^[ \t]*(?:\[|［|【)\s*(\d{4,5})\s*(?:\]|］|】)[ \t]*/gm

/** Detection thresholds. Each one kills a specific family of false positives. */
const MIN_MARKER_COUNT = 8       // a stray bracket cannot carry a short document
const MIN_SPAN_FRACTION = 0.5    // a bibliography clusters in the tail
const MAX_ANOMALY_RATE = 0.02    // one OCR glitch must not demote a 200-¶ spec
const MAX_FIRST_MARKER = 20      // a real sequence begins a document

/**
 * Decide whether a document numbers its own paragraphs, without splitting it.
 *
 * Cheap enough to call from an API route. The output is surfaced to the
 * attorney ("read from the document, [0001]–[0126]") because a mis-read is the
 * one failure downstream checks cannot catch: the citation resolves in our own
 * table and the lint passes. A human spots it in one glance; nobody audits a
 * JSON field.
 */
export function analyzeParagraphMarkers(text: string): MarkerAnalysis {
  const src = text || ''
  const hits: Array<{ value: number; index: number }> = []
  MARKER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MARKER_RE.exec(src)) !== null) {
    hits.push({ value: Number(m[1]), index: m.index })
  }

  const derived = (reasons: string[]): MarkerAnalysis => ({
    mode: 'DERIVED',
    confidence: 'LOW',
    reasons,
    markerCount: hits.length,
    firstMarker: hits.length ? padNum(hits[0].value) : undefined,
    lastMarker: hits.length ? padNum(hits[hits.length - 1].value) : undefined
  })

  if (hits.length < MIN_MARKER_COUNT) {
    return derived([`Only ${hits.length} paragraph marker(s) found; ${MIN_MARKER_COUNT} are needed to read a document as self-numbered.`])
  }

  const reasons: string[] = []
  const spanFraction = src.length > 0
    ? (hits[hits.length - 1].index - hits[0].index) / src.length
    : 0
  if (spanFraction < MIN_SPAN_FRACTION) {
    return derived([`Markers cover only ${Math.round(spanFraction * 100)}% of the document — they look like a reference list or a single numbered section, not paragraph numbering.`])
  }

  let descending = 0
  const seen = new Set<number>()
  let duplicates = 0
  for (let i = 0; i < hits.length; i++) {
    if (i > 0 && hits[i].value < hits[i - 1].value) descending++
    if (seen.has(hits[i].value)) duplicates++
    seen.add(hits[i].value)
  }
  const descRate = descending / hits.length
  const dupRate = duplicates / hits.length

  if (descRate > MAX_ANOMALY_RATE) {
    return derived([`${descending} marker(s) run backwards — this looks like several documents concatenated, or a table of contents.`])
  }
  if (dupRate > MAX_ANOMALY_RATE) {
    return derived([`${duplicates} marker(s) repeat — this looks like a running header rather than paragraph numbering.`])
  }
  if (hits[0].value > MAX_FIRST_MARKER) {
    return derived([`Numbering starts at [${padNum(hits[0].value)}], so this is not the beginning of a numbered document.`])
  }

  // Authored. Confidence records anomalies that survived the tolerances.
  if (descending > 0) reasons.push(`${descending} marker(s) out of order.`)
  if (duplicates > 0) reasons.push(`${duplicates} marker(s) repeated.`)
  if (hits[0].value > 2) reasons.push(`Numbering starts at [${padNum(hits[0].value)}] rather than [0001].`)
  if (spanFraction < 0.75) reasons.push(`Markers cover ${Math.round(spanFraction * 100)}% of the document.`)

  return {
    mode: 'AUTHORED',
    confidence: reasons.length === 0 ? 'HIGH' : 'MEDIUM',
    reasons,
    markerCount: hits.length,
    firstMarker: padNum(hits[0].value),
    lastMarker: padNum(hits[hits.length - 1].value)
  }
}

// ---------------------------------------------------------------------------
// Paragraph splitting
// ---------------------------------------------------------------------------

/** Split one raw block at every internal marker, keeping the marker with its text. */
function fragmentAtMarkers(block: string): Array<{ marker?: string; text: string }> {
  MARKER_RE.lastIndex = 0
  const positions: Array<{ index: number; length: number; value: string }> = []
  let m: RegExpExecArray | null
  while ((m = MARKER_RE.exec(block)) !== null) {
    positions.push({ index: m.index, length: m[0].length, value: m[1] })
  }
  if (!positions.length) return [{ text: block }]

  const out: Array<{ marker?: string; text: string }> = []
  // Anything before the first marker is its own unmarked fragment (a heading,
  // a title page, the preamble).
  if (positions[0].index > 0) {
    const lead = block.slice(0, positions[0].index)
    if (lead.trim()) out.push({ text: lead })
  }
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index + positions[i].length
    const end = i + 1 < positions.length ? positions[i + 1].index : block.length
    out.push({ marker: padNum(positions[i].value), text: block.slice(start, end) })
  }
  return out
}

/**
 * Split text into stable numbered paragraphs.
 *
 * Blank lines give the block structure; internal markers then sub-split each
 * block. That sub-split is what makes numbering survive bad extraction — a
 * DOCX read through the zip fallback arrives as ONE block, and a legacy PDF
 * arrives as one block per printed line. Both recover here, with no
 * re-extraction, as long as the document numbers itself.
 *
 * A paragraph continuing across a page break is split by the page boundary.
 * In authored mode the marker keeps the numbering right; in derived mode it is
 * a minor over-split.
 */
export function splitParagraphs(text: string, analysis?: MarkerAnalysis): Paragraph[] {
  const clean = (text || '').replace(/\r\n/g, '\n')
  const assessment = analysis ?? analyzeParagraphMarkers(clean)
  const authored = assessment.mode === 'AUTHORED'

  const pages = clean.split(PAGE_SEPARATOR)
  const hasPages = pages.length > 1

  const paragraphs: Paragraph[] = []
  const seenMarkers = new Set<string>()
  let lastMarkerValue = -Infinity

  pages.forEach((page, pageIdx) => {
    const blocks = page.split(/\n\s*\n+/)
    for (const block of blocks) {
      if (!block.trim()) continue
      const fragments = authored ? fragmentAtMarkers(block) : [{ text: block } as { marker?: string; text: string }]
      for (const frag of fragments) {
        const body = frag.text.replace(/\s+/g, ' ').trim()
        if (!body) continue

        const index = paragraphs.length + 1
        let id: string
        let citable = false
        let marker: string | undefined

        if (authored && frag.marker) {
          const value = Number(frag.marker)
          // A repeat or a backwards jump is a local defect, not a reason to
          // distrust the document — demote this one block and keep going.
          const anomalous = seenMarkers.has(frag.marker) || value < lastMarkerValue
          if (anomalous) {
            id = `§${padNum(index)}`
          } else {
            seenMarkers.add(frag.marker)
            lastMarkerValue = value
            marker = frag.marker
            id = `¶${frag.marker}`
            citable = true
          }
        } else if (authored) {
          // Authored document, unmarked fragment: a heading, a claims block, a
          // formula. Real text, but never a paragraph number we may file.
          id = `§${padNum(index)}`
        } else {
          // Derived: positional anchors, usable internally, never filable.
          id = `¶${padNum(index)}`
        }

        paragraphs.push({
          id, index, text: body, marker, citable,
          ...(hasPages ? { pageNumber: pageIdx + 1 } : {})
        })
      }
    }
  })

  return paragraphs
}

/**
 * Render internal paragraph anchors for on-screen preview.
 *
 * Authored anchors become the filing form so the attorney reads what they will
 * file. Anything that cannot be filed is shown as an obvious placeholder rather
 * than quietly rewritten — a bare number would look correct and be wrong.
 */
export function formatParagraphRefsForPreview(
  text: string,
  numbering: ParagraphNumbering,
  citableIds?: Set<string>
): string {
  const src = text || ''
  if (numbering === 'DERIVED') {
    return src.replace(/[¶§]\s?\d{1,6}/g, '⟨unverified paragraph reference⟩')
  }
  // Unwrap a bracketed anchor to a bare one FIRST, so "[¶0007]" and "¶0007" take
  // the same citable check below. Stripping the ¶ here without checking is what
  // let an unvetted anchor through as an authoritative-looking "[0007]".
  return src
    .replace(/§\s?\d{1,6}/g, '⟨unverified paragraph reference⟩')
    .replace(/\[([^\]]*¶[^\]]*)\]/g, (_m, inner: string) => inner.trim())
    .replace(/¶\s?(\d{1,6})/g, (_m, digits: string) => {
      if (citableIds && !citableIds.has(`¶${padNum(digits)}`)) return '⟨unverified paragraph reference⟩'
      return `[${padNum(digits)}]`
    })
}

/** The filing renderer refused to emit text it cannot stand behind. */
export class FilingValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FilingValidationError'
  }
}

/** Stands in for a reference the system will not vouch for. Obvious on the page. */
export const UNVERIFIED_REF_PLACEHOLDER = '[reference to verify]'

/**
 * Render internal anchors for the filed document.
 *
 * CONVERTS a valid authored anchor — authored mode is exactly when `¶0038` must
 * become "[0038]".
 *
 * Anything it cannot stand behind becomes a VISIBLE PLACEHOLDER rather than a
 * number. It does not block: whether to file is the attorney's call, and the
 * lint has already told them what is unresolved. But it will not emit a
 * citation that looks authoritative and is not — a glaring
 * "[reference to verify]" they can fix in Word is strictly better than a
 * fabricated "[0007]" that reads as correct.
 */
export function formatParagraphRefsForFiling(
  text: string,
  opts: { numbering: ParagraphNumbering; citableIds?: Set<string> }
): string {
  const src = text || ''

  // A non-citable anchor is never a filing citation, in either mode.
  let out = src.replace(/§\s?\d{1,6}/g, UNVERIFIED_REF_PLACEHOLDER)

  if (opts.numbering === 'DERIVED') {
    // The document numbers nothing, so no number here can be its own.
    return out.replace(/¶\s?\d{1,6}/g, UNVERIFIED_REF_PLACEHOLDER)
  }

  // Unwrap a bracketed anchor to a bare one so it takes the SAME citable check
  // below. Stripping the ¶ here and emitting the brackets unchanged is what let
  // "[¶0007]" reach the filing as an authoritative-looking "[0007]" that nothing
  // had vetted — the one hole in this function's guarantee.
  out = out.replace(/\[([^\]]*¶[^\]]*)\]/g, (_m, inner: string) => inner.trim())
  return out.replace(/¶\s?(\d{1,6})/g, (_m, digits: string) => {
    if (opts.citableIds && !opts.citableIds.has(`¶${padNum(digits)}`)) return UNVERIFIED_REF_PLACEHOLDER
    return `[${padNum(digits)}]`
  })
}

/**
 * Paragraph numbers a piece of drafted text presents as specification citations.
 *
 * The bracketed form is deliberately conservative. `[1979] 2 SCC 511` is an
 * Indian case citation, not a paragraph reference, and a check that fires on
 * every authority in every reply gets switched off within a week.
 */
export function extractCitedParagraphNumbers(text: string): string[] {
  const src = text || ''
  const found: string[] = []

  for (const m of Array.from(src.matchAll(/[¶§]\s?(\d{1,6})/g))) found.push(padNum(m[1]))

  for (const m of Array.from(src.matchAll(/\[(\d{3,5})\]/g))) {
    const digits = m[1]
    const value = Number(digits)
    const zeroPadded = digits.startsWith('0')
    const outsideYearRange = value < 1800 || value > 2100
    const before = src.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0)
    const introduced = /\b(paragraph|paragraphs|para|paras|¶)\s*$/i.test(before)
    if (zeroPadded || outsideYearRange || introduced) found.push(padNum(digits))
  }

  return Array.from(new Set(found))
}

/**
 * Resolve model-supplied basis references against the paragraph table.
 *
 * Accepts every form the drafting stages actually produce — "¶0038", "0038",
 * "[0038]" — and expands ranges. The range case is not hypothetical: retrieval
 * labels a chunk "[¶0038-¶0041]" and the prompt asks for "the ¶ ids", so a
 * model that echoes the label verbatim would otherwise fail to resolve and the
 * amendment would silently lose its basis.
 */
export function resolveBasisRefs(
  refs: string[],
  paragraphs: Paragraph[]
): { resolved: Paragraph[]; unresolved: string[] } {
  const byId = new Map(paragraphs.map(p => [p.id, p]))
  const resolved: Paragraph[] = []
  const unresolved: string[] = []

  const lookup = (token: string): Paragraph | undefined => {
    const digits = token.match(/(\d{1,6})/)
    if (!digits) return undefined
    const padded = padNum(digits[1])
    return byId.get(`¶${padded}`) || byId.get(`§${padded}`)
  }

  for (const raw of refs || []) {
    const ref = String(raw || '').trim()
    if (!ref) continue

    const range = ref.match(/(\d{1,6})\s*[-–—]\s*[¶§]?\s*(\d{1,6})/)
    if (range) {
      const from = Number(range[1]), to = Number(range[2])
      const members: Paragraph[] = []
      for (let n = from; n <= to && n - from < 500; n++) {
        const p = lookup(String(n))
        if (p) members.push(p)
      }
      if (members.length) resolved.push(...members)
      else unresolved.push(ref)
      continue
    }

    const hit = lookup(ref)
    if (hit) resolved.push(hit)
    else unresolved.push(ref)
  }

  const deduped = Array.from(new Map(resolved.map(p => [p.id, p])).values())
  return { resolved: deduped, unresolved }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

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
  // "WE CLAIM:" is the standard Indian Form 2 claims heading, and "I claim" /
  // "We claim" are equally routine. Matching only the literal "i/we claim" meant
  // claims inside a complete specification were silently never extracted.
  { key: 'claims', re: /^(what is claimed|claims?|(i|we|i\s*\/\s*we)\s+claim)\b/i },
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

/** The section a paragraph belongs to, for derived-mode citations. */
export function sectionKeyForParagraph(paragraph: Paragraph, paragraphs: Paragraph[], sections: SectionSpan[]): string | undefined {
  for (const span of sections) {
    const from = paragraphs.findIndex(p => p.id === span.fromId)
    const to = paragraphs.findIndex(p => p.id === span.toId)
    if (from < 0 || to < from) continue
    if (paragraph.index - 1 >= from && paragraph.index - 1 <= to) return span.key
  }
  return undefined
}

/**
 * Text of a canonical section.
 *
 * Resolves the span by ARRAY POSITION, not by parsing digits out of the id.
 * The old form compared `Number(fromId.slice(1))` against `p.index`, which is
 * only ever correct while an id's number happens to equal its position — the
 * moment `¶0038` means the document's own [0038], it silently reads the wrong
 * slice or none at all.
 */
function sectionText(paragraphs: Paragraph[], sections: SectionSpan[], key: string): string {
  const span = sections.find(s => s.key === key)
  if (!span) return ''
  const from = paragraphs.findIndex(p => p.id === span.fromId)
  const to = paragraphs.findIndex(p => p.id === span.toId)
  if (from < 0 || to < from) return ''
  return paragraphs.slice(from, to + 1).map(p => p.text).join('\n\n')
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

function normalizeClaimElementText(text: string): string {
  return (text || '').toLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Short, stable digest — anchored to the claim text, not to element ordering. */
function hashElement(claimNumber: number, start: number, end: number, sourceText: string): string {
  const basis = `${claimNumber}:${start}:${end}:${normalizeClaimElementText(sourceText)}`
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < basis.length; i++) {
    const c = basis.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'))
}

/**
 * Parse a claims block into elements. Splits into claims by leading number,
 * marks independence (a claim referring to "claim N" is dependent), and splits
 * each claim into elements on ';' at clause boundaries.
 *
 * Each element records its verbatim span in the source, and `elementId` is
 * derived from that span. Positional indices are display ordering only: they
 * shift whenever the splitting logic changes or a claim is amended, and a merge
 * keyed on them silently replaces one limitation with another.
 */
/**
 * Does this claim body refer back to another claim?
 *
 * Indian claim sets routinely phrase the reference without a number ("as claimed
 * in any of the preceding claims") and often place it well past the opening
 * words ("A medium storing instructions which … cause performance of the method
 * of claim 1"). A numbered-reference test over only the first 80 characters
 * marked both of those independent, which propagates into every chart row and
 * amendment that keys on independence.
 */
function isDependentClaimBody(body: string): boolean {
  const flat = (body || '').replace(/\s+/g, ' ')
  if (/\bclaims?\s+\d+/i.test(flat)) return true
  if (/\b(?:of|in|to|per)\s+claims?\s+\d+/i.test(flat)) return true
  // Numberless back-references: "the preceding claims", "any one of the previous
  // claims", "any of claims", "the immediately preceding claim".
  return /\b(?:preceding|previous|foregoing|above|earlier)\s+claims?\b/i.test(flat)
    || /\bany\s+(?:one\s+)?of\s+(?:the\s+)?(?:preceding\s+|previous\s+|foregoing\s+)?claims?\b/i.test(flat)
}

export function parseClaimElements(claimsText: string): ClaimElement[] {
  const text = (claimsText || '').replace(/\r\n/g, '\n')
  const elements: ClaimElement[] = []

  const claimRe = /(?:^|\n)\s*(\d+)\s*[.)]\s/g
  const starts: Array<{ number: number; matchStart: number; bodyStart: number }> = []
  let m: RegExpExecArray | null
  while ((m = claimRe.exec(text)) !== null) {
    // Record where the MATCH began, not a width reconstructed from the number's
    // digits. Any extra whitespace in the next claim's marker ("2 . The method")
    // used to leak that claim's number onto the end of this claim's last element.
    const leading = m[0].length - m[0].replace(/^\n/, '').length
    starts.push({ number: Number(m[1]), matchStart: m.index + leading, bodyStart: m.index + m[0].length })
  }

  for (let i = 0; i < starts.length; i++) {
    const { number: claimNumber, bodyStart } = starts[i]
    const bodyEnd = i + 1 < starts.length ? starts[i + 1].matchStart : text.length
    const body = text.slice(bodyStart, Math.max(bodyStart, bodyEnd))
    const isIndependent = !isDependentClaimBody(body)

    // Walk the clause boundaries so every element keeps its true offsets.
    const spans: Array<{ start: number; end: number }> = []
    const sepRe = /;\s*(?:and\s+)?/gi
    let cursor = 0
    let s: RegExpExecArray | null
    while ((s = sepRe.exec(body)) !== null) {
      spans.push({ start: cursor, end: s.index })
      cursor = s.index + s[0].length
    }
    spans.push({ start: cursor, end: body.length })

    const usable = spans.filter(sp => body.slice(sp.start, sp.end).trim().length > 3)
    const chosen = usable.length ? usable : [{ start: 0, end: body.length }]

    chosen.forEach((sp, elementIndex) => {
      const sourceText = body.slice(sp.start, sp.end)
      const startOffset = bodyStart + sp.start
      const endOffset = bodyStart + sp.end
      const collapsed = sourceText.replace(/\s+/g, ' ').trim()
      if (!collapsed) return
      elements.push({
        claimNumber,
        isIndependent,
        elementIndex,
        text: collapsed,
        sourceText,
        startOffset,
        endOffset,
        elementId: hashElement(claimNumber, startOffset, endOffset, sourceText)
      })
    })
  }

  return elements
}

/**
 * Every element's recorded span must actually be that text in the source.
 * A decomposition that cannot be anchored is a bug, not a row to chart against.
 */
export function assertClaimElementSpans(elements: ClaimElement[], claimsText: string): string[] {
  const problems: string[] = []
  for (const e of elements) {
    if (claimsText.slice(e.startOffset, e.endOffset) !== e.sourceText) {
      problems.push(`claim ${e.claimNumber} element ${e.elementIndex} does not match its recorded span`)
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Break a single over-long run into token-bounded pieces, on whitespace where
 * there is any and by raw length where there is not.
 */
function hardSplit(sentence: string, maxTokens: number): string[] {
  if (estimateTokens(sentence) <= maxTokens) return [sentence]
  const out: string[] = []
  const words = sentence.split(/\s+/).filter(Boolean)
  let buf: string[] = []
  let tokens = 0
  for (const w of words) {
    const t = Math.max(1, estimateTokens(w))
    if (tokens + t > maxTokens && buf.length) {
      out.push(buf.join(' '))
      buf = []
      tokens = 0
    }
    buf.push(w)
    tokens += t
  }
  if (buf.length) out.push(buf.join(' '))
  // A single unbroken token longer than the cap (base64-ish blob): slice it.
  const CHARS_PER_TOKEN = 4
  return out.flatMap(piece => {
    if (estimateTokens(piece) <= maxTokens) return [piece]
    const size = Math.max(1, maxTokens * CHARS_PER_TOKEN)
    const parts: string[] = []
    for (let i = 0; i < piece.length; i += size) parts.push(piece.slice(i, i + size))
    return parts
  })
}

/** Split an oversized paragraph on sentence boundaries so no chunk blows the caps. */
function splitOversized(p: Paragraph, maxTokens: number): Paragraph[] {
  if (estimateTokens(p.text) <= maxTokens * 2) return [p]
  // A run with no sentence punctuation at all — a sequence listing, a table row,
  // OCR garbage — yields ONE "sentence", so splitting on boundaries alone left
  // the chunk unbounded no matter what maxTokens said. Hard-split any sentence
  // that is itself over the cap before packing.
  const sentences = p.text.split(/(?<=[.;:])\s+/).flatMap(s => hardSplit(s, maxTokens))
  const out: Paragraph[] = []
  let buf: string[] = []
  let tokens = 0
  for (const sentence of sentences) {
    const t = estimateTokens(sentence)
    if (tokens + t > maxTokens && buf.length) {
      out.push({ ...p, text: buf.join(' ') })
      buf = []
      tokens = 0
    }
    buf.push(sentence)
    tokens += t
  }
  if (buf.length) out.push({ ...p, text: buf.join(' ') })
  return out.length ? out : [p]
}

/**
 * Group paragraphs into token-bounded chunks (default ~400 tokens) with a
 * 1-paragraph overlap, each labelled with its paragraph range for citation.
 */
export function chunkParagraphs(paragraphs: Paragraph[], maxTokens = 400): DocumentChunk[] {
  const expanded = paragraphs.flatMap(p => splitOversized(p, maxTokens))
  const chunks: DocumentChunk[] = []
  let buf: Paragraph[] = []
  let tokens = 0

  const flush = () => {
    if (!buf.length) return
    const first = buf[0].id
    const last = buf[buf.length - 1].id
    chunks.push({
      sectionRef: first === last ? first : `${first}-${last}`,
      text: buf.map(p => p.text).join('\n\n'),
      tokenCount: tokens
    })
  }

  for (const p of expanded) {
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

// ---------------------------------------------------------------------------
// One-shot normalization
// ---------------------------------------------------------------------------

export interface NormalizedInvention {
  paragraphs: Paragraph[]
  sections: SectionSpan[]
  claimElements: ClaimElement[]
  chunks: DocumentChunk[]
  totalTokens: number
  numbering: MarkerAnalysis
  /**
   * False when the text did not survive extraction well enough to support
   * amendment analysis — a whole specification read as one paragraph, or one
   * paragraph per printed line. Callers must refuse to offer amendment basis
   * or paragraph citations rather than working from the wreckage.
   */
  structureUsable: boolean
}

/** Blocks this short in bulk mean the extractor split on line wraps. */
const LINE_SPLIT_MEDIAN_CHARS = 120
/** Below this a document is too small for the structure heuristics to mean anything. */
const STRUCTURE_CHECK_MIN_CHARS = 4000

function medianLength(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * Did this text survive extraction with usable paragraph structure?
 *
 * Two failure shapes, both silent today: the DOCX zip fallback emits one
 * newline per paragraph so the whole document collapses into a single block
 * (which makes the amendment-basis word-overlap check vacuous — every word is
 * "in" the one giant paragraph), and legacy PDF extraction emitted a blank line
 * per visual line so every printed line became its own paragraph.
 */
export function assessStructureUsable(text: string, paragraphs: Paragraph[]): boolean {
  const len = (text || '').trim().length
  if (len < STRUCTURE_CHECK_MIN_CHARS) return true      // too small to judge
  if (paragraphs.length <= 1) return false              // collapsed to one block
  const median = medianLength(paragraphs.map(p => p.text.length))
  if (median < LINE_SPLIT_MEDIAN_CHARS) return false    // split on line wraps
  return true
}

/** One-shot normalization of a spec (+ optional separate claims block). */
export function normalizeInvention(specText: string, claimsText?: string): NormalizedInvention {
  const numbering = analyzeParagraphMarkers(specText || '')
  const paragraphs = splitParagraphs(specText || '', numbering)
  const sections = splitSections(paragraphs)
  const chunks = chunkParagraphs(paragraphs)
  // Claims feed only the element list — never the paragraph ids. That is what
  // keeps the upload path (spec only) and the run path (spec + claims) in
  // agreement about every anchor.
  const claimSource = claimsText || sectionText(paragraphs, sections, 'claims')
  const claimElements = parseClaimElements(claimSource)
  return {
    paragraphs,
    sections,
    claimElements,
    chunks,
    totalTokens: paragraphs.reduce((s, p) => s + estimateTokens(p.text), 0),
    numbering,
    structureUsable: assessStructureUsable(specText || '', paragraphs)
  }
}

/** Ids that may legitimately appear as a filing citation. */
export function citableIdSet(paragraphs: Paragraph[]): Set<string> {
  return new Set(paragraphs.filter(p => p.citable).map(p => p.id))
}

/**
 * Extract the claims section from a complete specification (Indian practice
 * files claims inside the complete specification). Returns '' when no claims
 * heading is found or the section parses to no claim elements — callers treat
 * that as "claims not present, ask for a separate upload".
 */
export function extractClaimsText(specText: string): string {
  const paragraphs = splitParagraphs(specText || '')
  const sections = splitSections(paragraphs)
  const text = sectionText(paragraphs, sections, 'claims')
  if (!text.trim()) return ''
  return parseClaimElements(text).length > 0 ? text : ''
}
