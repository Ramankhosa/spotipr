import type { OfficeActionProfile, CanonicalObjectionCode } from './oa-profile-schema'
import { CANONICAL_OBJECTION_CODES } from './oa-profile-schema'
import { runOaStage, type OaGateway } from './oa-llm-service'
import type { ParsedObjection } from './oa-parser'

/**
 * Office Action Studio — objection classifier
 *
 * Turns raw parsed objections into canonical objection cards. The LLM assigns
 * a canonical code + subtype + local basis; then a DETERMINISTIC guard verifies
 * every examiner quote is an exact substring of the source document. A card
 * whose quote does not verify is flagged, never silently trusted.
 */

export interface ClassifiedObjection {
  sortOrder: number
  canonicalCode: CanonicalObjectionCode
  subTypeId?: string
  localBasis?: string
  /** The office's own numbering ("1", "2.a") — preserved for the reply letter. */
  officeNumber?: string
  examinerText: string
  quoteVerified: boolean
  claimsAffected?: number[]
  citationLabels?: string[]
  rationale?: string
}

const CODE_SET = new Set<string>(CANONICAL_OBJECTION_CODES)

/**
 * Fold a string for tolerant matching against real PDF-extracted text:
 * NFKC-normalize (superscripts, ligatures), unify dash/quote/space variants,
 * collapse whitespace, lowercase. Words are preserved, so a true fabrication
 * still fails — this only absorbs extraction noise, not invented content.
 */
function foldForMatch(s: string): string {
  return (s || '')
    .normalize('NFKC')
    .replace(/[‐-―−]/g, '-')   // dash/hyphen/minus variants → '-'
    .replace(/[‘’‛]/g, "'")     // smart single quotes → '
    .replace(/[“”]/g, '"')            // smart double quotes → "
    .replace(/[   ]/g, ' ')      // non-breaking spaces → space
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const WORD_RE = /[a-z0-9]+/g

/** First entry of the ascending list that is >= `from`, or -1. */
function firstAtOrAfter(sorted: number[], from: number): number {
  let lo = 0, hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < from) lo = mid + 1
    else hi = mid
  }
  return lo < sorted.length ? sorted[lo] : -1
}

/**
 * A quotation may only absorb so much noise before it stops being a quotation:
 * the window it is allowed to occupy in the source is its own length plus this
 * much room for dropped superscripts, hyphenation and page furniture.
 */
const WINDOW_SLACK_RATIO = 0.25
const WINDOW_SLACK_FLOOR = 8
/** Alignments tried before giving up — bounds the cost when every needle word is common. */
const MAX_ANCHOR_CANDIDATES = 64

/**
 * How much of the needle aligns, IN ORDER, against one contiguous window of the
 * source.
 *
 * Exported for the regression tests: this is the function that decides whether a
 * "verbatim" passage really is one.
 */
export function alignedCoverage(needleWords: string[], hayWords: string[]): number {
  if (!needleWords.length || !hayWords.length) return 0

  // Positions of every hay word the needle actually uses — the alignment never
  // needs the rest of the document.
  const wanted = new Set(needleWords)
  const positions = new Map<string, number[]>()
  for (let i = 0; i < hayWords.length; i++) {
    const w = hayWords[i]
    if (!wanted.has(w)) continue
    const list = positions.get(w)
    if (list) list.push(i)
    else positions.set(w, [i])
  }

  // Anchor on the needle word that occurs LEAST often in the source: it yields
  // the fewest candidate alignments and is the most diagnostic of them.
  let anchorIndex = -1
  let anchorHits: number[] | undefined
  for (let i = 0; i < needleWords.length; i++) {
    const hits = positions.get(needleWords[i])
    if (!hits?.length) continue
    if (!anchorHits || hits.length < anchorHits.length) { anchorHits = hits; anchorIndex = i }
    if (anchorHits.length === 1) break
  }
  if (!anchorHits || anchorIndex < 0) return 0

  const slack = Math.ceil(needleWords.length * WINDOW_SLACK_RATIO) + WINDOW_SLACK_FLOOR
  let best = 0

  for (const at of anchorHits.slice(0, MAX_ANCHOR_CANDIDATES)) {
    const start = Math.max(0, at - anchorIndex - slack)
    const end = Math.min(hayWords.length, start + needleWords.length + 2 * slack)

    // Greedy in-order walk: each needle word must appear AFTER the previous
    // match and inside the window. Reordered clauses cannot both match.
    let cursor = start
    let matched = 0
    for (const w of needleWords) {
      const hits = positions.get(w)
      if (!hits) continue
      const found = firstAtOrAfter(hits, cursor)
      if (found >= 0 && found < end) { matched++; cursor = found + 1 }
    }

    const coverage = matched / needleWords.length
    if (coverage > best) best = coverage
    if (best === 1) break
  }

  return best
}

/**
 * Verify the examiner quote is grounded in the source document.
 *  - Short quotes (< 12 words): require an exact folded substring — strict.
 *  - Long quotes: require the words to ALIGN, IN ORDER, against one contiguous
 *    window of the source. This tolerates a stray dash/superscript/OCR glitch
 *    inside a 2000-char verbatim span while rejecting a passage that was never
 *    written as one.
 *
 * Word bigrams used to be collected into a Set and tested for membership one by
 * one, so neither order nor proximity was checked at all: a passage spliced from
 * two distant paragraphs of the same document — or one whose clauses had been
 * rearranged — scored close to 1.0 and was reported as verbatim. That verdict is
 * the trust root for `quoteVerified` on every objection card, for every
 * DISCLOSED chart cell, and for the quotation check over the filed prose, so all
 * three inherited the weakness.
 */
export function verifyQuote(examinerText: string, sourceText: string, threshold = 0.85): boolean {
  const needleFolded = foldForMatch(examinerText)
  const hayFolded = foldForMatch(sourceText)
  if (!needleFolded) return false

  // Fast path: exact folded substring.
  if (hayFolded.includes(needleFolded)) return true

  const needleWords = needleFolded.match(WORD_RE) || []
  // Short quotes must match exactly (already failed above) — no fuzzy pass.
  if (needleWords.length < 12) return false

  const hayWords = hayFolded.match(WORD_RE) || []
  return alignedCoverage(needleWords, hayWords) >= threshold
}

/**
 * Build the classifier input describing the profile's taxonomy so the model
 * maps to codes/subtypes the jurisdiction actually declares.
 */
function taxonomyBrief(profile: OfficeActionProfile): string {
  return profile.objections
    .map(o => {
      const subs = (o.subTypes || []).map(s => `${s.id} (${s.basis || ''})`).join(', ')
      return `- ${o.canonical}${o.localLabel ? ` = ${o.localLabel}` : ''} [${o.legalBasis.join(', ')}]${subs ? ` subtypes: ${subs}` : ''}`
    })
    .join('\n')
}

export async function classifyObjections(
  profile: OfficeActionProfile,
  rawObjections: ParsedObjection[],
  sourceText: string,
  opts: { tenantId?: string; userId?: string; requestHeaders?: Record<string, string> } = {},
  gateway?: OaGateway
): Promise<{ success: boolean; objections: ClassifiedObjection[]; error?: string }> {
  if (rawObjections.length === 0) {
    return { success: true, objections: [] }
  }

  const input = [
    'Canonical codes: ' + CANONICAL_OBJECTION_CODES.join(', ') + '.',
    'Jurisdiction taxonomy (map to these):',
    taxonomyBrief(profile),
    '',
    'Objections to classify (JSON):',
    JSON.stringify(rawObjections.map((o, i) => ({ index: i, number: o.number, examinerText: o.examinerText, legalBasisMentioned: o.legalBasisMentioned, claimsAffected: o.claimsAffected, citationLabels: o.citationLabels }))),
    '',
    'Return JSON: { objections: [{ index, canonicalCode, subTypeId?, localBasis?, examinerText (copied verbatim from the input), claimsAffected?: number[], citationLabels?: string[], rationale? }] }.'
  ].join('\n')

  const result = await runOaStage<{ objections: any[] }>(
    { stageCode: 'OA_OBJECTION_CLASSIFY', profile, input, tenantId: opts.tenantId, userId: opts.userId, requestHeaders: opts.requestHeaders, purpose: 'office_action:classify' },
    gateway
  )

  if (!result.success || !result.data?.objections) {
    // Classification failed — fall back to deterministic cards built straight
    // from the parsed objections (code OTHER) so no objection is ever lost.
    return {
      success: false,
      objections: fallbackCards(rawObjections, sourceText),
      error: result.error || 'Classification failed'
    }
  }

  const objections = normalizeClassified(result.data.objections, rawObjections, sourceText)
  return { success: true, objections }
}

/** Deterministic cards from the raw parse — used when classification fails. */
export function fallbackCards(rawObjections: ParsedObjection[], sourceText: string): ClassifiedObjection[] {
  // examinerText is a required, non-null column. The parse output it comes from
  // is an unvalidated cast of LLM JSON, so a model that omits the field used to
  // reach prisma.create as `undefined` and throw — failing the whole ingest after
  // every paid call, and returning a 500 instead of the objection cards.
  return rawObjections
    .map((raw, i) => ({
      sortOrder: i,
      canonicalCode: 'OTHER' as CanonicalObjectionCode,
      localBasis: raw.legalBasisMentioned?.join(', ') || undefined,
      officeNumber: raw.number,
      examinerText: String(raw.examinerText || '').trim(),
      quoteVerified: verifyQuote(String(raw.examinerText || ''), sourceText),
      claimsAffected: raw.claimsAffected,
      citationLabels: raw.citationLabels
    }))
    .filter(c => c.examinerText)
}

/**
 * Deterministic post-processing: coerce to valid codes, verify quotes against
 * the source, and fall back to the raw examiner text when the model's copy
 * drifted (so the card still shows the real objection).
 *
 * RECONCILIATION GUARANTEE: every raw parsed objection produces exactly one
 * card. A raw the model dropped comes back as an OTHER card; a raw the model
 * mapped twice is only consumed once (the duplicate falls back to its own
 * positional raw, or none). Losing an objection here would mean the attorney
 * files a reply that skips an examiner objection.
 */
export function normalizeClassified(
  llmObjections: any[],
  rawObjections: ParsedObjection[],
  sourceText: string
): ClassifiedObjection[] {
  const consumed = new Set<number>()
  const cards = llmObjections.map((o, i) => {
    // An explicit index binds to that raw; a repeat of an already-consumed index
    // is a duplicate and must NOT consume a different raw (that would mark an
    // unrelated objection as answered). Positional fallback only when the model
    // gave no usable index at all.
    const explicit = typeof o?.index === 'number' && rawObjections[o.index] ? o.index : null
    let idx: number
    if (explicit !== null) idx = consumed.has(explicit) ? -1 : explicit
    else idx = consumed.has(i) || !rawObjections[i] ? -1 : i
    const raw = idx >= 0 ? rawObjections[idx] : undefined
    if (idx >= 0) consumed.add(idx)

    let examinerText = typeof o?.examinerText === 'string' && o.examinerText.trim()
      ? o.examinerText
      : String(raw?.examinerText || '')
    // If the model's quote doesn't verify but the raw parsed text does, trust the raw text.
    let quoteVerified = verifyQuote(examinerText, sourceText)
    if (!quoteVerified && raw?.examinerText && verifyQuote(raw.examinerText, sourceText)) {
      examinerText = raw.examinerText
      quoteVerified = true
    }

    const code: CanonicalObjectionCode = CODE_SET.has(o?.canonicalCode) ? o.canonicalCode : 'OTHER'

    return {
      sortOrder: idx >= 0 ? idx : rawObjections.length + i,
      canonicalCode: code,
      subTypeId: typeof o?.subTypeId === 'string' ? o.subTypeId : undefined,
      localBasis: typeof o?.localBasis === 'string' ? o.localBasis : (raw?.legalBasisMentioned?.join(', ') || undefined),
      officeNumber: raw?.number,
      examinerText,
      quoteVerified,
      claimsAffected: Array.isArray(o?.claimsAffected) ? o.claimsAffected : raw?.claimsAffected,
      citationLabels: Array.isArray(o?.citationLabels) ? o.citationLabels : raw?.citationLabels,
      rationale: typeof o?.rationale === 'string' ? o.rationale : undefined
    }
  }).filter(c => c.examinerText.trim())

  // Any raw objection the model dropped is appended as an OTHER card. Coerced
  // and filtered like the mapped cards: this path bypassed the text filter
  // above, so an undefined examinerText from the parse reached Prisma directly.
  rawObjections.forEach((raw, idx) => {
    if (consumed.has(idx)) return
    const text = String(raw.examinerText || '').trim()
    if (!text) return
    cards.push({
      sortOrder: idx,
      canonicalCode: 'OTHER',
      subTypeId: undefined,
      localBasis: raw.legalBasisMentioned?.join(', ') || undefined,
      officeNumber: raw.number,
      examinerText: text,
      quoteVerified: verifyQuote(text, sourceText),
      claimsAffected: raw.claimsAffected,
      citationLabels: raw.citationLabels,
      rationale: 'Not classified by the model — review and re-categorize.'
    })
  })

  return cards.sort((a, b) => a.sortOrder - b.sortOrder)
}
