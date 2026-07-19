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

/**
 * Verify the examiner quote is grounded in the source document.
 *  - Short quotes (< 12 words): require an exact folded substring — strict.
 *  - Long quotes: require a high fraction of consecutive word-BIGRAMS to appear
 *    in the source. This tolerates a stray dash/superscript/OCR glitch inside a
 *    2000-char verbatim span while still rejecting fabricated sentences (whose
 *    bigrams are absent from the source).
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

  // Bigram coverage: fraction of the needle's consecutive word-pairs present in the source.
  const hayWords = hayFolded.match(WORD_RE) || []
  const hayBigrams = new Set<string>()
  for (let i = 0; i < hayWords.length - 1; i++) hayBigrams.add(hayWords[i] + ' ' + hayWords[i + 1])

  let present = 0
  const total = needleWords.length - 1
  for (let i = 0; i < total; i++) {
    if (hayBigrams.has(needleWords[i] + ' ' + needleWords[i + 1])) present++
  }
  return total > 0 && present / total >= threshold
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
    return { success: false, objections: [], error: result.error || 'Classification failed' }
  }

  const objections = normalizeClassified(result.data.objections, rawObjections, sourceText)
  return { success: true, objections }
}

/**
 * Deterministic post-processing: coerce to valid codes, verify quotes against
 * the source, and fall back to the raw examiner text when the model's copy
 * drifted (so the card still shows the real objection).
 */
export function normalizeClassified(
  llmObjections: any[],
  rawObjections: ParsedObjection[],
  sourceText: string
): ClassifiedObjection[] {
  return llmObjections.map((o, i) => {
    const idx = typeof o?.index === 'number' && rawObjections[o.index] ? o.index : i
    const raw = rawObjections[idx]

    let examinerText = typeof o?.examinerText === 'string' && o.examinerText.trim() ? o.examinerText : (raw?.examinerText || '')
    // If the model's quote doesn't verify but the raw parsed text does, trust the raw text.
    let quoteVerified = verifyQuote(examinerText, sourceText)
    if (!quoteVerified && raw?.examinerText && verifyQuote(raw.examinerText, sourceText)) {
      examinerText = raw.examinerText
      quoteVerified = true
    }

    const code: CanonicalObjectionCode = CODE_SET.has(o?.canonicalCode) ? o.canonicalCode : 'OTHER'

    return {
      sortOrder: idx,
      canonicalCode: code,
      subTypeId: typeof o?.subTypeId === 'string' ? o.subTypeId : undefined,
      localBasis: typeof o?.localBasis === 'string' ? o.localBasis : (raw?.legalBasisMentioned?.join(', ') || undefined),
      examinerText,
      quoteVerified,
      claimsAffected: Array.isArray(o?.claimsAffected) ? o.claimsAffected : raw?.claimsAffected,
      citationLabels: Array.isArray(o?.citationLabels) ? o.citationLabels : raw?.citationLabels,
      rationale: typeof o?.rationale === 'string' ? o.rationale : undefined
    }
  }).sort((a, b) => a.sortOrder - b.sortOrder)
}
