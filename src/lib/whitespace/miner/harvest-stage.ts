/**
 * Invention Miner — stage 1, the harvest.
 *
 * Reads the field's text and records WHAT THE CORPUS ADMITS is unsolved. Every
 * later stage is arithmetic over what this one indexed, so the whole product is
 * only as honest as this file.
 *
 * THE HONESTY CONTRACT, in the order the failures actually happen:
 *
 *  1. NOTHING ENTERS THE INDEX THAT IS NOT IN THE TEXT. A problem statement is
 *     kept only when its `sourceSpan` resolves to a passage of the supplied text
 *     that supports it, and a teaching-away quote only when it is verbatim.
 *     Everything else is DROPPED AND COUNTED. A systematic offset failure
 *     therefore shows up as a large `droppedProblems` number — a visible
 *     coverage fact — rather than as a plausible index nobody can audit.
 *  2. EVERY COUNT CARRIES ITS DENOMINATOR. `read` is of `sampled` is of
 *     `familiesInField`, at a stated text tier, with the sampling fraction on
 *     the result. A ratio computed over a sample that is not representative is
 *     worse than no ratio, so the sample is drawn RANDOMLY WITHIN EACH TIER
 *     (md5 of the family key), never tier-first-then-recency: recency correlates
 *     with jurisdiction, era and applicant, and every engine downstream is a
 *     ratio of counts over this sample.
 *  3. A REFUSAL IS CHEAPER THAN A THIN ANSWER. Seven preconditions run before
 *     any model call — wrong study kind, no census for this scope, a statement
 *     column that cannot be compared, an unconfigured plan, a field too large to
 *     speak about, a field too small to count, and a field our corpus holds only
 *     as abstracts. Each names its own fix.
 *  4. A PROVIDER OUTAGE IS NOT A COVERAGE CAVEAT. The circuit breaker aborts the
 *     run TRANSIENTLY (so the retry budget applies) rather than completing a
 *     harvest that read almost nothing — whose leads would then carry
 *     denominators reading as "this field is thin" instead of "the model was
 *     down".
 *  5. NARRATION SAYS WHAT WAS DONE, NEVER WHAT WAS FOUND. Publication numbers
 *     and titles being read are work; a count of distinct problems discovered is
 *     a finding, and findings appear when the run completes, not while it runs.
 */

import { Prisma, TaskCode } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { WhitespacePermanentError } from '../run-lease'
import { isStatementTimeout, narrowingAdvice, setStatementTimeout, canonicaliseAssignee, extractApplicantNames } from '../field-map'
import { resolveFieldBand, resolveFieldDefinition } from '../field-definition'
import { wideningAdviceFor } from '../field-rule'
import { stableJson, studyKindOf, type TextCoverage, type WhitespaceScope } from '../types'
import type { RunReporter } from '../run-reporter'
import type { WhitespaceLLMContext } from '../llm'
import { parseModelJson } from '../llm'
import { gradeQuote, normaliseForQuote } from './citations'
import { embedStatements } from './embed'
import { checkMinerIndexConfig } from './index-config'
import { scopeFingerprint } from './scope-fingerprint'
import { describeTierMix, resolveTextTier, textHashFor, tierIsRicher, type TextTier } from './text-tiers'
import { statementVectorLiteralSql } from './vector-sql'
import { assertMinerStagesConfigured, MINER_EXTRACT_STAGE_CODE, runMinerLLM, minerConcurrencyLimit } from './llm'
import {
  ABSTRACT_CHARS,
  buildExtractionPrompt,
  CLAIMS_CHARS,
  DESCRIPTION_FULL_CHARS,
  DESCRIPTION_PREFIX_CHARS,
  EXTRACTION_FAMILIES_PER_CALL,
  MAX_MECHANISM_ELEMENTS,
  MAX_QUOTE_CHARS,
  MAX_STATEMENT_CHARS,
  MAX_TECHNICAL_EFFECTS,
  normaliseSourceText,
  type ExtractionSubject,
} from './prompts'
import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// Budgets — every one of these is a real limit somewhere, not a preference
// ---------------------------------------------------------------------------

/** Ceiling on families read in one harvest. 3,000 families = 1,500 extraction calls. */
export const HARVEST_FAMILY_CAP = Math.max(50, Number(process.env.WHITESPACE_MINER_FAMILY_CAP) || 3_000)

/**
 * The smallest share of a field a statement about that field may be made from.
 *
 * A statement about what a field leaves unsolved cannot be made from 2.5% of it:
 * the missing 97.5% is exactly where the counter-example lives. Named so it can
 * be tuned, and printed in the refusal so the number is never implicit.
 */
export const MIN_SAMPLING_FRACTION = clampFraction(process.env.WHITESPACE_MINER_MIN_SAMPLING_FRACTION, 0.05)

/**
 * The smallest share of a field that must carry description text before the
 * miner will read it at all.
 *
 * The miner reads problems out of BACKGROUND SECTIONS. An abstract is a summary
 * of the solution and states a problem only by accident, so a field our corpus
 * holds as abstracts is a field the miner has nothing to read — and would
 * report as "the field admits very few problems", which is a statement about
 * our corpus dressed as a statement about the technology.
 */
export const MIN_DESCRIPTION_SHARE = clampFraction(process.env.WHITESPACE_MINER_MIN_DESCRIPTION_SHARE, 0.2)

/** Input tokens one harvest may spend before it refuses to keep reading. */
export const READ_TOKEN_CEILING = Math.max(
  100_000,
  Number(process.env.WHITESPACE_MINER_TOKEN_CEILING) || 15_000_000
)

/** Extraction calls in flight. 1,500 sequential calls is roughly two hours. */
const EXTRACTION_CONCURRENCY = Math.min(8, Math.max(1, Number(process.env.WHITESPACE_MINER_CONCURRENCY) || 5))

/**
 * How wide we may actually fan out, which is not our decision alone.
 *
 * The gateway reserves a slot per call and throws CONCURRENCY_LIMIT past the
 * tenant's cap. That throw reaches the batch loop looking exactly like a
 * provider failure, so a harvest configured wider than the cap spends its
 * circuit breaker on its own reservations and aborts a run that was never
 * unhealthy — observed on the first live run, where a cap of 2 against a fan-out
 * of 5 failed three of every five batches.
 */
async function resolveConcurrency(context: WhitespaceLLMContext): Promise<number> {
  const allowed = await minerConcurrencyLimit(context, TaskCode.IM_EXTRACT)
  return Math.max(1, allowed ? Math.min(EXTRACTION_CONCURRENCY, allowed) : EXTRACTION_CONCURRENCY)
}

/** Staging pass ceiling — the only statement that touches the 45M-row table. */
const STAGE_TIMEOUT_MS = Math.max(10_000, Number(process.env.WHITESPACE_MINER_STAGE_TIMEOUT_MS) || 90_000)
/** Representative pick, which reads the staged temp table and the availability view. */
const PICK_TIMEOUT_MS = 45_000
/** Text fetch for the sample, by publication number. */
const READ_TIMEOUT_MS = 30_000

/** Families sampled from a tier that is present at all, before proportionality. */
const SAMPLE_FLOOR_PER_TIER = 25

/** Publications persisted or read per round trip. */
const DB_CHUNK = 500
/** Statement rows inserted per round trip. */
const STATEMENT_CHUNK = 200

/** Event lines emitted between two awaits. The reporter's own ceiling is 20. */
const MAX_EVENTS_PER_CHUNK = 14

function clampFraction(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 && value < 1 ? value : fallback
}

const HARVEST_STEPS = [
  { key: 'field', label: 'Loading the field definition' },
  { key: 'stage', label: 'Staging the field' },
  { key: 'sample', label: 'Choosing families to read' },
  { key: 'read', label: 'Reading their text' },
  { key: 'extract', label: 'Extracting problems and mechanisms' },
  { key: 'index', label: 'Indexing the statements' },
  { key: 'record', label: 'Recording coverage' },
]
const HARVEST_COUNTERS = [
  { key: 'families', label: 'Families in the field' },
  { key: 'sampled', label: 'Families chosen' },
  { key: 'read', label: 'Families with readable text' },
  { key: 'extracted', label: 'Families read' },
  { key: 'statements', label: 'Statements indexed' },
  { key: 'cacheHits', label: 'Readings already extracted' },
]

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type TierCounts = Record<TextTier, number>

export interface MinerHarvestResult {
  scopeFingerprint: string
  familiesInField: number
  byTierField: TierCounts
  sampled: number
  byTierSampled: TierCounts
  /** Per-tier share of that tier's families actually sampled, plus the overall figure. */
  samplingFraction: { overall: number; byTier: Record<TextTier, number> }
  read: number
  extracted: number
  cacheHits: number
  extractionFailures: number
  extractionFailureRate: number
  droppedProblems: number
  droppedMechanisms: number
  droppedQuotes: number
  unreadableText: number
  languageMix: Record<string, number>
  statementsIndexed: number
  /**
   * The newest publication date anywhere in the staged field. Every downstream
   * lead has to be able to say "applications filed in the last 18 months are
   * unpublished and invisible; the newest publication we could read here is
   * dated X" — without it, an absence reads as a fact about the technology
   * rather than about the data edge.
   */
  newestPublicationDate: string | null
  resolvedModels: Record<string, string>
  tokensUsed: { input: number; output: number }
  coverageNotes: string[]
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Pure helpers — every one of these is exported because every one is tested
// ---------------------------------------------------------------------------

const ALL_TIERS: TextTier[] = ['description-full', 'description-5k', 'claims', 'abstract']

export function zeroTierCounts(): TierCounts {
  return { 'description-full': 0, 'description-5k': 0, claims: 0, abstract: 0 }
}

/**
 * The structural shape the staging query can produce cheaply.
 *
 * The field can be 120,000 publications, so the staging pass must not detoast
 * `descriptionText`: it reads a 5,001-character SLICE and reports its length,
 * which is all `resolveTextTier`'s length rule needs (is the body longer than
 * the 5,000-character import cap?).
 */
export interface StagedTextShape {
  descriptionChars: number
  hasClaims: boolean
  hasAbstract: boolean
  claimsAvailability: string | null
  descriptionAvailability: string | null
}

/**
 * The tier of a staged row, resolved through `resolveTextTier` and nowhere else.
 *
 * The sentinel is how a LENGTH gets to a function that takes TEXT. text-tiers is
 * the single source of truth for the rule ("length wins over the view's label"),
 * and re-implementing the comparison here is exactly the drift its header warns
 * about — so a string of the measured length is handed to it instead. `slice`
 * on a long constant is O(1) in V8 and the result is garbage immediately, so
 * this costs nothing across 120,000 rows.
 */
const LENGTH_SENTINEL = 'x'.repeat(5_001)

export function stagedTextTier(shape: StagedTextShape): TextTier | null {
  const chars = Math.max(0, Math.trunc(shape.descriptionChars || 0))
  return resolveTextTier({
    descriptionText: chars > 0 ? LENGTH_SENTINEL.slice(0, Math.min(chars, LENGTH_SENTINEL.length)) : null,
    descriptionAvailability: shape.descriptionAvailability,
    claimsText: shape.hasClaims ? 'claims' : null,
    claimsAvailability: shape.claimsAvailability,
    abstract: shape.hasAbstract ? 'abstract' : null,
  })
}

/**
 * Cut `text` at the last SENTENCE boundary at or before `cap`.
 *
 * Not a nicety. A tail cut mid-sentence passes every substring check while being
 * a fragment that can invert the meaning of what it came from: "It has been
 * suggested that X is unsuitable, however" reads as an admitted drawback and is
 * the opposite of one. The model is shown only whole sentences, so a quote it
 * copies is a whole sentence.
 *
 * The boundary is searched across the WHOLE window, not just its tail: the
 * safety property is unconditional, and cutting short is always better than
 * cutting into a sentence. Only when the window holds no sentence boundary at
 * all — a claim set, or OCR with the punctuation lost — does it fall back to a
 * WORD boundary, and to the hard cut when even that would throw away most of the
 * budget. `truncatedAtChars` records where the cut fell in every case.
 */
const MIN_KEEP_RATIO = 0.5

export function truncateAtSentence(text: string, cap: number): { text: string; truncatedAtChars: number | null } {
  const source = String(text ?? '')
  if (cap <= 0) return { text: '', truncatedAtChars: 0 }
  if (source.length <= cap) return { text: source, truncatedAtChars: null }

  const window = source.slice(0, cap)
  const floor = Math.floor(cap * MIN_KEEP_RATIO)
  for (let i = window.length - 1; i >= 0; i--) {
    const char = window[i]
    if (char !== '.' && char !== '!' && char !== '?') continue
    const next = window[i + 1]
    // The text is whitespace-normalised, so a real terminator is followed by a
    // space or ends the window. "3.5" and "Fig. 2" are excluded by that plus the
    // digit test — an abbreviation's period is followed by a space too, but a
    // sentence that ends on "Fig." is rare enough to be worth the false cut.
    if (next !== undefined && next !== ' ') continue
    if (char === '.' && /\d/.test(window[i - 1] ?? '')) continue
    return { text: window.slice(0, i + 1), truncatedAtChars: i + 1 }
  }

  const lastSpace = window.lastIndexOf(' ')
  if (lastSpace > floor) return { text: window.slice(0, lastSpace), truncatedAtChars: lastSpace }
  return { text: window, truncatedAtChars: window.length }
}

/**
 * Scripts that do not separate words with spaces, so the token rules do not apply.
 *
 * Written as explicit \uXXXX ranges rather than \p{Script=...}: tsconfig sets no
 * `target`, so tsc defaults to ES5 and rejects the `u` flag a Unicode property
 * escape needs. Plain BMP ranges match the same characters without it.
 */
const SCRIPTLESS = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/

/** "A letter, in any script the corpus carries" — BMP ranges, for the same reason. */
const LETTER_RANGES =
  'A-Za-z\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF\\u0590-\\u05FF\\u0600-\\u06FF' +
  '\\u0900-\\u097F\\u0E00-\\u0E7F\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uAC00-\\uD7AF'
const LETTER_RE = new RegExp('[' + LETTER_RANGES + ']', 'g')
const ALPHABETIC_TOKEN_RE = new RegExp('^[' + LETTER_RANGES + '][' + LETTER_RANGES + "\\u0300-\\u036F'\\u2019-]*$")

/**
 * Is this text too broken to spend a model call on?
 *
 * The corpus carries OCR output from scanned specifications, and a page of
 * mis-segmented glyphs costs the same as a page of prose and yields statements
 * that are locatable in the text and meaningless. Two cheap tests catch it:
 * a low share of word-shaped tokens, and absurd mean token length (the
 * signature of lost spacing).
 *
 * CJK text passes both tests only because they are skipped for it. Applying the
 * mean-token-length rule to a Japanese abstract — one "token", hundreds of
 * characters — would have silently binned every CJK publication as unreadable,
 * which is a coverage lie in the shape of a quality check.
 */
export const MIN_ALPHABETIC_TOKEN_RATIO = 0.6
export const MAX_MEAN_TOKEN_CHARS = 15
export const MIN_READABLE_TOKENS = 12

export function looksUnreadable(text: string): boolean {
  const source = String(text ?? '').trim()
  if (!source) return true

  if (SCRIPTLESS.test(source)) {
    // Character-level instead: letters (any script) as a share of non-space characters.
    const dense = source.replace(/\s+/g, '')
    if (dense.length < MIN_READABLE_TOKENS) return true
    const letters = (dense.match(LETTER_RE) ?? []).length
    return letters / dense.length < MIN_ALPHABETIC_TOKEN_RATIO
  }

  const tokens = source.split(/\s+/).filter(Boolean)
  if (tokens.length < MIN_READABLE_TOKENS) return true
  const alphabetic = tokens.filter(token => ALPHABETIC_TOKEN_RE.test(token)).length
  if (alphabetic / tokens.length < MIN_ALPHABETIC_TOKEN_RATIO) return true
  const meanLength = tokens.reduce((sum, token) => sum + token.length, 0) / tokens.length
  return meanLength > MAX_MEAN_TOKEN_CHARS
}

/**
 * A best-effort language label for a reading.
 *
 * `local_patents` HAS NO LANGUAGE COLUMN — there is nothing in the corpus to
 * read this off, so it is a SCRIPT test with a jurisdiction fallback and it is
 * used for exactly two things: marking a reading as translated (so its
 * statements can never be used as verbatim quote evidence) and recording
 * `language` on the statement row. It is never used to assert what language a
 * document is in, and Latin-script publications that are not recognisably
 * English resolve to their office's language or to null, never to a guess.
 */
const OFFICE_LANGUAGE: Record<string, string> = {
  DE: 'de', AT: 'de', CH: 'de',
  FR: 'fr', BE: 'fr',
  ES: 'es', MX: 'es', AR: 'es',
  IT: 'it', PT: 'pt', BR: 'pt',
  NL: 'nl', SE: 'sv', NO: 'no', DK: 'da', FI: 'fi', PL: 'pl', TR: 'tr', VN: 'vi', ID: 'id',
}
const ENGLISH_MARKERS = /\b(the|and|of|for|with|that|which|said|wherein|comprising|is|are|to|in)\b/gi

export function detectSourceLanguage(text: string, country: string | null | undefined): string | null {
  const source = String(text ?? '')
  if (!source.trim()) return null
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(source)) return 'ja'
  if (/[\uAC00-\uD7AF]/.test(source)) return 'ko'
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(source)) return 'zh'
  if (/[\u0400-\u04FF]/.test(source)) return 'ru'
  if (/[\u0900-\u097F]/.test(source)) return 'hi'
  if (/[\u0600-\u06FF]/.test(source)) return 'ar'
  if (/[\u0590-\u05FF]/.test(source)) return 'he'
  if (/[\u0E00-\u0E7F]/.test(source)) return 'th'
  if (/[\u0370-\u03FF]/.test(source)) return 'el'

  const words = source.split(/\s+/).filter(Boolean).length
  const markers = (source.match(ENGLISH_MARKERS) ?? []).length
  if (words >= 20 && markers / words >= 0.08) return 'en'
  const office = String(country ?? '').trim().toUpperCase()
  return OFFICE_LANGUAGE[office] ?? (words >= 20 ? null : null)
}

/**
 * How many families to read from each tier.
 *
 * Proportional, with a floor so a tier that is present at all is present in the
 * sample — the whole point of recording the tier mix is that conclusions read
 * differently at each depth, and a tier that contributes nothing to the sample
 * cannot be reasoned about. Deterministic: the same counts always allocate the
 * same way, so a re-run reads the same families.
 */
export function allocateTierSample(counts: TierCounts, cap: number, floor = SAMPLE_FLOOR_PER_TIER): TierCounts {
  const allocation = zeroTierCounts()
  const total = ALL_TIERS.reduce((sum, tier) => sum + Math.max(0, counts[tier] || 0), 0)
  if (total <= 0 || cap <= 0) return allocation
  if (total <= cap) {
    for (const tier of ALL_TIERS) allocation[tier] = Math.max(0, counts[tier] || 0)
    return allocation
  }

  for (const tier of ALL_TIERS) {
    const available = Math.max(0, counts[tier] || 0)
    if (!available) continue
    const proportional = Math.round((cap * available) / total)
    allocation[tier] = Math.min(available, Math.max(Math.min(available, floor), proportional))
  }

  // Trim, largest-first, never below the tier's floor while another tier is
  // still above its own; then, if that is not enough, below the floor too.
  const sum = () => ALL_TIERS.reduce((acc, tier) => acc + allocation[tier], 0)
  for (const guardFloor of [true, false]) {
    while (sum() > cap) {
      const candidates = ALL_TIERS.filter(
        tier => allocation[tier] > (guardFloor ? Math.min(floor, counts[tier] || 0) : 0)
      )
      if (!candidates.length) break
      const biggest = candidates.reduce((a, b) => (allocation[b] > allocation[a] ? b : a))
      allocation[biggest] -= 1
    }
    if (sum() <= cap) break
  }
  // Give back any slack the rounding left, to the tiers with headroom.
  while (sum() < cap) {
    const candidates = ALL_TIERS.filter(tier => allocation[tier] < Math.max(0, counts[tier] || 0))
    if (!candidates.length) break
    const roomiest = candidates.reduce((a, b) =>
      (counts[b] || 0) - allocation[b] > (counts[a] || 0) - allocation[a] ? b : a
    )
    allocation[roomiest] += 1
  }
  return allocation
}

/**
 * Does `span` actually point at text that supports `statement`?
 *
 * The model is told to point the span at the passage it read the statement from,
 * a sentence or two. Three things are checked and each of them is a real failure
 * mode:
 *
 *   - THE SPAN MUST BE A RANGE IN THE TEXT. An offset past the end means the
 *     model was not reading the text it was given.
 *   - THE SPAN MUST BE NARROW. "The whole document" is not a location, and a
 *     span of the entire block would let any statement pass — which is exactly
 *     how a verification becomes a formality.
 *   - THE PASSAGE MUST SHARE THE STATEMENT'S CONTENT WORDS. Problems are
 *     PARAPHRASES by contract, so verbatim matching is the wrong test; a
 *     paraphrase of a passage carries most of that passage's content words, and
 *     one that does not is about something else.
 *
 * The tolerance absorbs the model's counting jitter. It does NOT absorb a
 * statement that is simply not in the document: content words absent from the
 * whole window fail whatever the offsets say.
 */
export const MAX_SPAN_CHARS = 1_500
export const SPAN_TOLERANCE_CHARS = 600
export const SPAN_SUPPORT_RATIO = 0.6
const MIN_CONTENT_TOKENS = 3

function contentTokens(text: string): string[] {
  const seen = new Set<string>()
  for (const raw of normaliseForQuote(text).split(' ')) {
    const token = raw.replace(/[^a-z0-9\u00C0-\uFFFF]/g, '').replace(/s$/, '')
    if (token.length < 4) continue
    seen.add(token)
  }
  return Array.from(seen)
}

export function locateStatement(
  sourceText: string,
  statement: string,
  span: { start?: unknown; end?: unknown } | null | undefined
): boolean {
  const text = String(sourceText ?? '')
  if (!text || !span) return false
  const start = Number(span.start)
  const end = Number(span.end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false
  if (start < 0 || end <= start || end > text.length) return false
  if (end - start > MAX_SPAN_CHARS) return false

  const tokens = contentTokens(statement)
  // Too little content to verify. citations.ts takes the same position: an
  // unverifiable claim is a dropped one, never a generous pass.
  if (tokens.length < MIN_CONTENT_TOKENS) return false

  const window = normaliseForQuote(
    text.slice(Math.max(0, start - SPAN_TOLERANCE_CHARS), Math.min(text.length, end + SPAN_TOLERANCE_CHARS))
  )
  const windowTokens = new Set(contentTokens(window))
  const present = tokens.filter(token => windowTokens.has(token)).length
  return present / tokens.length >= SPAN_SUPPORT_RATIO
}

/** One sentence, so a quote cannot be a stitched pair with the qualifier removed. */
export function isSingleSentence(quote: string): boolean {
  const text = String(quote ?? '').trim()
  if (!text) return false
  const body = text.replace(/[.!?]+$/, '')
  return !/[.!?]\s+\S/.test(body)
}

/**
 * Aborts a run whose batches are mostly failing.
 *
 * Without it, a provider outage at batch 200 of 1,500 produces a COMPLETED
 * harvest that read almost nothing, and its leads then carry denominators an
 * attorney reads as "this field is thin" rather than "the model was down". The
 * abort is TRANSIENT on purpose: the run's retry budget should get another go at
 * a provider blip, which is the one thing a permanent refusal would prevent.
 */
export interface CircuitBreakerOptions {
  window?: number
  failureRate?: number
  consecutive?: number
  minObservations?: number
}

export class BatchCircuitBreaker {
  private readonly window: number
  private readonly failureRate: number
  private readonly consecutiveLimit: number
  private readonly minObservations: number
  private recent: boolean[] = []
  private consecutive = 0
  private total = 0
  private failures = 0

  constructor(options: CircuitBreakerOptions = {}) {
    this.window = Math.max(1, options.window ?? 25)
    this.failureRate = options.failureRate ?? 0.2
    this.consecutiveLimit = Math.max(1, options.consecutive ?? 10)
    this.minObservations = Math.max(1, options.minObservations ?? 10)
  }

  record(ok: boolean): void {
    this.total += 1
    if (!ok) this.failures += 1
    this.consecutive = ok ? 0 : this.consecutive + 1
    this.recent.push(ok)
    if (this.recent.length > this.window) this.recent.splice(0, this.recent.length - this.window)
  }

  /** The reason to abort, or null. */
  tripped(): string | null {
    if (this.consecutive >= this.consecutiveLimit) {
      return `${this.consecutive} extraction batches failed in a row`
    }
    if (this.recent.length >= this.minObservations) {
      const failed = this.recent.filter(ok => !ok).length
      const rate = failed / this.recent.length
      if (rate > this.failureRate) {
        return `${failed} of the last ${this.recent.length} extraction batches failed (${Math.round(rate * 100)}%)`
      }
    }
    return null
  }

  get observed(): number {
    return this.total
  }

  get failureCount(): number {
    return this.failures
  }
}

/**
 * Normalised four-character CPC/IPC subclass prefixes (A61K, G06F …).
 *
 * The whitespace census truncates classifications with
 * `regexp_replace(upper(c), '[[:space:]]+', '', 'g')` before comparing, because
 * the corpus holds both "A01G25/16" and "A01G 25/16"; this is the same
 * normalisation, taken to subclass depth.
 */
export function cpcSubclassPrefixes(classifications: readonly (string | null)[] | null | undefined): string[] {
  const out: string[] = []
  for (const raw of classifications ?? []) {
    if (typeof raw !== 'string') continue
    const prefix = raw.replace(/\s+/g, '').toUpperCase().slice(0, 4)
    if (!/^[A-Z]\d{2}[A-Z]$/.test(prefix)) continue
    if (!out.includes(prefix)) out.push(prefix)
    if (out.length >= 8) break
  }
  return out
}

/**
 * The first applicant, canonicalised the way the census canonicalises assignees.
 *
 * Same function, so a lead that says "the families admitting this problem are
 * your own client's" and the census's competitor facet can never disagree about
 * who an applicant is.
 */
export function applicantNormOf(applicants: unknown): string | null {
  const [first] = extractApplicantNames(applicants)
  if (!first) return null
  const canonical = canonicaliseAssignee(first)
  return canonical ? canonical.slice(0, 200) : null
}

/** sha256 of the normalised statement — unique PER PUBLICATION, never globally. */
export function statementTextHash(text: string): string {
  return createHash('sha256').update(normaliseForQuote(text)).digest('hex')
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0
}

// ---------------------------------------------------------------------------
// Internal row shapes
// ---------------------------------------------------------------------------

interface StagedFamily {
  familyKey: string
  publicationNumber: string
  country: string | null
  filingYear: number | null
  publicationDate: Date | null
  tier: TextTier | null
  descriptionChars: number
  hasClaims: boolean
  hasAbstract: boolean
}

/** One family's reading, with its extraction once it exists. Exported for the engines. */
export interface Reading {
  familyKey: string
  publicationNumber: string
  title: string
  tier: TextTier
  sourceText: string
  textHash: string
  hasClaims: boolean
  translated: boolean
  language: string | null
  truncatedAtChars: number | null
  cpcSubclasses: string[]
  filingYear: number | null
  applicantNorm: string | null
  /** Set once the extraction exists, fresh or cached. */
  extractionId?: string
  extraction?: NormalisedExtraction
}

/** A verified extraction: everything here is supported by the source text. */
export interface NormalisedExtraction {
  problems: Array<{ statement: string; kind: string }>
  mechanisms: Array<{ statement: string; elements: string[] }>
  technicalEffects: string[]
  teachingAway: Array<{ quote: string }>
  claimedScope: { independentElements: string[]; dependentNarrowings: string[] } | null
}

interface BatchOutcome {
  ok: boolean
  permanent?: unknown
  lines: string[]
  results: Array<{ reading: Reading; extraction: NormalisedExtraction }>
  droppedProblems: number
  droppedMechanisms: number
  droppedQuotes: number
  inputTokens: number
  outputTokens: number
  modelCode: string | null
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

export interface MinerHarvestInput {
  runId: string
  workerId: string
  reporter: RunReporter
  studyId: string
  scope: WhitespaceScope
  llmContext: WhitespaceLLMContext
}

export async function runMinerHarvestStage(input: MinerHarvestInput): Promise<MinerHarvestResult> {
  const { reporter } = input
  await reporter.plan(HARVEST_STEPS, HARVEST_COUNTERS)
  const coverageNotes: string[] = []
  const fingerprint = scopeFingerprint(input.scope)

  // =========================================================================
  // Preconditions. All permanent, all before any spend.
  // =========================================================================
  await reporter.step('field', 'Checking what this field can support')

  const study = await prisma.whitespaceStudy.findUnique({
    where: { id: input.studyId },
    select: { id: true, kind: true, scopeVersion: true },
  })
  if (!study) throw new WhitespacePermanentError('That study no longer exists.')

  // (a) The miner reads a miner study. Anything else has a different stage graph.
  const kind = studyKindOf(study.kind)
  if (kind !== 'MINER') {
    throw new WhitespacePermanentError(
      `The Invention Miner runs on a miner study, and this is a ${
        kind === 'INVENTION' ? 'invention' : 'landscape'
      } study. Create a study of the Invention Miner kind for this scope, or run the whitespace stages on this one.`
    )
  }

  // (b) A completed census OF THIS EXACT SCOPE.
  //
  // Keyed on the SNAPSHOT, never on scopeVersion. resolveFieldDefinition's reuse
  // path compares snapshots too, so a version check would pass here and then
  // find no persisted rule there — and the "consumer" would silently refit the
  // ladder, a walk budgeted at 300 seconds, inside this stage.
  const census = await newestMatchingCensus(input.studyId, input.scope)
  if (!census) {
    throw new WhitespacePermanentError(
      'The Invention Miner reads the field the census defined, and no completed field census matches this study’s current scope. Run the field census again for this scope.'
    )
  }

  // (c) The statement vector column must match the configured model, or nothing
  //     the harvest indexes can ever be compared with anything else.
  const indexConfig = await checkMinerIndexConfig()
  if (!indexConfig.ok) {
    throw new WhitespacePermanentError(
      `The miner cannot compare statements, so indexing them would be pointless: ${indexConfig.reason}`
    )
  }

  // (d) Every stage model this run will use, resolved before it spends anything.
  const resolvedModels = await assertMinerStagesConfigured(input.llmContext, [
    { stageCode: MINER_EXTRACT_STAGE_CODE, taskCode: TaskCode.IM_EXTRACT },
  ])

  // (g) Corpus depth. Read off the census's own textCoverage, so the refusal
  //     quotes the number the user already saw on the field map.
  const textCoverage = census.textCoverage
  const descriptionShare =
    textCoverage.familiesTotal > 0 ? textCoverage.withDescription / textCoverage.familiesTotal : 0
  if (textCoverage.familiesTotal > 0 && descriptionShare < MIN_DESCRIPTION_SHARE) {
    throw new WhitespacePermanentError(
      `Only ${textCoverage.withDescription.toLocaleString()} of ${textCoverage.familiesTotal.toLocaleString()} families in this field (${percent(
        textCoverage.withDescription,
        textCoverage.familiesTotal
      )}%) carry any description text in our corpus, against the ${Math.round(
        MIN_DESCRIPTION_SHARE * 100
      )}% the miner needs. The miner reads problems out of background sections and there are none here — every statement would come from an abstract, which summarises the solution and states the problem only by accident. Run a field census on this scope instead, or move the scope to the EP- and US-rich neighbouring subclasses, where descriptions are stored.`
    )
  }

  const field = await resolveFieldDefinition(input.scope, { studyId: input.studyId, reuse: true })
  const band = resolveFieldBand()
  coverageNotes.push(...field.coverageNotes)

  // =========================================================================
  // Staging. Never `field.where ⋈ view ORDER BY` — that touches the 45M-row
  // table twice through the view's LEFT JOIN and cannot early-exit.
  // =========================================================================
  await reporter.step('stage', 'Staging the field and picking one publication per family')
  const staged = await stageField(input.scope, field.where, field.rule, band.maxPublications)
  const familiesInField = staged.length
  reporter.count('families', familiesInField)
  reporter.event('count', `${familiesInField.toLocaleString()} families staged, one publication chosen for each`)

  // (f) Too small to count over.
  if (familiesInField < band.minFamilies) {
    throw new WhitespacePermanentError(
      `This field holds ${familiesInField.toLocaleString()} families, below the ${band.minFamilies.toLocaleString()} the miner needs before a count over it means anything — a problem admitted by two of five families is not a pattern. ${wideningAdviceFor(
        input.scope,
        field.rule
      )}`
    )
  }

  const byTierField = zeroTierCounts()
  let newestPublicationDate: Date | null = null
  for (const row of staged) {
    if (row.tier) byTierField[row.tier] += 1
    if (row.publicationDate && (!newestPublicationDate || row.publicationDate > newestPublicationDate)) {
      newestPublicationDate = row.publicationDate
    }
  }

  // =========================================================================
  // Sampling — randomly WITHIN each tier, proportionally, with a floor.
  // =========================================================================
  await reporter.step('sample', 'Choosing families to read')
  const readable = staged.filter(row => row.tier !== null)
  const allocation = allocateTierSample(byTierField, HARVEST_FAMILY_CAP)

  // (e) Too large to speak about. Checked here because it is a statement about
  //     the SAMPLE, and the sample is only known now — still before any spend.
  const plannedSample = ALL_TIERS.reduce((sum, tier) => sum + allocation[tier], 0)
  const samplingFraction = familiesInField > 0 ? plannedSample / familiesInField : 0
  if (samplingFraction < MIN_SAMPLING_FRACTION) {
    throw new WhitespacePermanentError(
      `This field holds ${familiesInField.toLocaleString()} families and the harvest can read at most ${plannedSample.toLocaleString()} of them — ${percent(
        plannedSample,
        familiesInField
      )}%, against the ${Math.round(
        MIN_SAMPLING_FRACTION * 100
      )}% floor. A statement about what a field leaves unsolved cannot be made from ${percent(
        plannedSample,
        familiesInField
      )}% of it: the counter-example lives in the part that was not read. ${narrowingAdvice(input.scope, field.rule)}`
    )
  }

  // The staged rows already arrive in md5(family_key) order, so taking the first
  // N of a tier IS a uniform random draw from that tier. Tier-first-then-recency
  // would correlate the sample with jurisdiction, era and applicant — and every
  // engine downstream is a ratio of counts over this sample.
  const remaining = { ...allocation }
  const sample: StagedFamily[] = []
  for (const row of readable) {
    const tier = row.tier as TextTier
    if (remaining[tier] <= 0) continue
    remaining[tier] -= 1
    sample.push(row)
  }
  const byTierSampled = zeroTierCounts()
  for (const row of sample) byTierSampled[row.tier as TextTier] += 1
  reporter.count('sampled', sample.length, familiesInField)
  reporter.event(
    'count',
    `${sample.length.toLocaleString()} families chosen at random within each text tier (${percent(
      sample.length,
      familiesInField
    )}% of the field)`
  )

  // Persist the WHOLE staged field, not just the sample: "inside the field" has
  // to be a join downstream, not a CPC guess.
  await reporter.heartbeat()
  const sampledKeys = new Set(sample.map(row => row.publicationNumber))
  await persistStagedField(input.studyId, fingerprint, study.scopeVersion, staged, sampledKeys, reporter)

  // =========================================================================
  // Reading
  // =========================================================================
  await reporter.step('read', `Reading the text of ${sample.length.toLocaleString()} families`)
  const { readings, unreadableText, languageMix } = await readSample(sample, reporter)
  const byTierRead = zeroTierCounts()
  for (const reading of readings) byTierRead[reading.tier] += 1
  reporter.count('read', readings.length, sample.length)
  reporter.event('count', `${readings.length.toLocaleString()} of ${sample.length.toLocaleString()} readings assembled`)
  if (unreadableText > 0) {
    coverageNotes.push(
      `${unreadableText.toLocaleString()} of ${sample.length.toLocaleString()} chosen families held no text this stage could read — OCR artefacts, fragments, or nothing at all — and were not put to the model. They are counted here, not hidden.`
    )
  }

  if (!readings.length) {
    await reporter.skip('extract', 'no readable text in the chosen families')
    await reporter.skip('index', 'no readable text in the chosen families')
    await reporter.step('record', 'Recording coverage')
    reporter.done()
    return buildResult({
      fingerprint,
      familiesInField,
      byTierField,
      sample: sample.length,
      byTierSampled,
      byTierRead: zeroTierCounts(),
      read: 0,
      extracted: 0,
      cacheHits: 0,
      extractionFailures: 0,
      batches: 0,
      droppedProblems: 0,
      droppedMechanisms: 0,
      droppedQuotes: 0,
      unreadableText,
      languageMix,
      statementsIndexed: 0,
      newestPublicationDate,
      resolvedModels,
      tokensIn: 0,
      tokensOut: 0,
      coverageNotes: [
        ...coverageNotes,
        'No family in the sample carried text this stage could read, so nothing was extracted. That is a corpus gap, not a finding about the field.',
      ],
    })
  }

  // R10 — an extraction of the SAME text (publication + textHash, not
  // superseded) skips the model entirely.
  const cached = await loadCachedExtractions(readings)
  let cacheHits = 0
  for (const reading of readings) {
    const hit = cached.get(readingKey(reading.publicationNumber, reading.textHash))
    if (!hit) continue
    reading.extractionId = hit.id
    reading.extraction = hit.extraction
    cacheHits += 1
  }
  reporter.count('cacheHits', cacheHits, readings.length)

  // =========================================================================
  // Extraction
  // =========================================================================
  const pending = readings.filter(reading => !reading.extraction)
  const batches = chunk(pending, EXTRACTION_FAMILIES_PER_CALL)
  const groups = chunk(batches, await resolveConcurrency(input.llmContext))
  const breaker = new BatchCircuitBreaker()
  let extracted = cacheHits
  let extractionFailures = 0
  let droppedProblems = 0
  let droppedMechanisms = 0
  let droppedQuotes = 0
  let tokensIn = 0
  let tokensOut = 0

  if (!batches.length) {
    await reporter.skip('extract', cacheHits ? 'every reading was already extracted' : 'nothing to extract')
  } else {
    let done = 0
    for (const group of groups) {
      await reporter.step('extract', undefined, { n: done + 1, total: batches.length })
      const outcomes = await Promise.all(group.map(batch => runExtractionBatch(batch, input.llmContext)))

      // A permanent fault (an unconfigured stage that slipped past the
      // preflight) is not "one batch failed" — it will fail every batch.
      const permanent = outcomes.find(outcome => outcome.permanent)
      if (permanent) throw permanent.permanent

      const lines: string[] = []
      for (let index = 0; index < outcomes.length; index++) {
        const outcome = outcomes[index]
        const batchSize = group[index].length
        done += 1
        breaker.record(outcome.ok)
        tokensIn += outcome.inputTokens
        tokensOut += outcome.outputTokens
        droppedProblems += outcome.droppedProblems
        droppedMechanisms += outcome.droppedMechanisms
        droppedQuotes += outcome.droppedQuotes
        if (outcome.modelCode) resolvedModels[MINER_EXTRACT_STAGE_CODE] = outcome.modelCode
        if (!outcome.ok) {
          extractionFailures += 1
          lines.push(`One batch of ${batchSize} families failed and is excluded`)
          continue
        }
        for (const result of outcome.results) {
          result.reading.extraction = result.extraction
          extracted += 1
        }
        lines.push(...outcome.lines)
      }

      for (const line of lines.slice(0, MAX_EVENTS_PER_CHUNK)) reporter.event('read', line)
      reporter.count('extracted', extracted, readings.length)

      await reporter.heartbeat()
      // Written BEFORE the abort checks below: the extraction cache is
      // corpus-level, so work already paid for must survive an abort and make
      // the retry cheaper rather than repeating the same spend.
      await persistExtractions(
        outcomes.flatMap(outcome => outcome.results.map(result => result.reading)),
        resolvedModels[MINER_EXTRACT_STAGE_CODE] ?? null
      )

      // R7 — a provider outage must not complete as a coverage caveat.
      const trip = breaker.tripped()
      if (trip) {
        await reporter.fail('extract', trip)
        throw new Error(
          `Extraction is failing systematically — ${trip}. The harvest stopped after ${done} of ${batches.length} batches rather than complete a reading of almost nothing. This is usually a provider outage; try again.`
        )
      }

      // R9 — the read budget. Permanent: retrying spends the same tokens again.
      if (tokensIn > READ_TOKEN_CEILING) {
        const familiesRead = readings.filter(reading => reading.extraction).length
        await reporter.fail(
          'extract',
          `the read budget for this field is exhausted at ${familiesRead} of ${readings.length} families`
        )
        throw new WhitespacePermanentError(
          `The read budget for this field is exhausted at ${familiesRead.toLocaleString()} of ${readings.length.toLocaleString()} families: ${tokensIn.toLocaleString()} input tokens of a ${READ_TOKEN_CEILING.toLocaleString()} ceiling. ${narrowingAdvice(
            input.scope,
            field.rule
          )}`
        )
      }
    }
  }

  if (extractionFailures > 0) {
    coverageNotes.push(
      `${extractionFailures} extraction batch${
        extractionFailures === 1 ? '' : 'es'
      } of ${EXTRACTION_FAMILIES_PER_CALL} families failed and ${
        extractionFailures === 1 ? 'is' : 'are'
      } missing from this harvest.`
    )
  }

  // =========================================================================
  // Indexing
  // =========================================================================
  await reporter.step('index', 'Indexing the statements')
  const statementsIndexed = await indexStatements(readings, reporter)
  reporter.count('statements', statementsIndexed)

  // =========================================================================
  // Coverage
  // =========================================================================
  await reporter.step('record', 'Recording coverage')
  const result = buildResult({
    fingerprint,
    familiesInField,
    byTierField,
    sample: sample.length,
    byTierSampled,
    byTierRead,
    read: readings.length,
    extracted,
    cacheHits,
    extractionFailures,
    batches: batches.length,
    droppedProblems,
    droppedMechanisms,
    droppedQuotes,
    unreadableText,
    languageMix,
    statementsIndexed,
    newestPublicationDate,
    resolvedModels,
    tokensIn,
    tokensOut,
    coverageNotes,
  })
  reporter.done()
  return result
}

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

/**
 * The newest COMPLETED field census whose scope snapshot is stableJson-equal to
 * the study's current scope.
 *
 * jsonb does not preserve key order, so a plain stringify comparison against the
 * database round-trip essentially never matches — the same trap persistedFieldRule
 * documents.
 */
async function newestMatchingCensus(
  studyId: string,
  scope: WhitespaceScope
): Promise<{ textCoverage: TextCoverage } | null> {
  const runs = await prisma.whitespaceRun.findMany({
    where: { studyId, stage: 'FIELD_MAP', status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { results: true, scopeSnapshot: true },
  })
  const wanted = stableJson(scope)
  for (const run of runs) {
    if (stableJson(run.scopeSnapshot ?? null) !== wanted) continue
    const coverage = (run.results as { textCoverage?: unknown } | null)?.textCoverage as TextCoverage | undefined
    if (coverage && typeof coverage.familiesTotal === 'number') return { textCoverage: coverage }
    // A census that completed without a text-coverage facet cannot answer the
    // corpus-depth question. Treat it as no census rather than assume zero.
  }
  return null
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

interface StagedRow {
  family_key: string
  publication_number: string
  country: string | null
  filing_year: number | null
  publication_date: Date | null
  description_chars: number | null
  has_claims: boolean
  has_abstract: boolean
  claims_availability: string | null
  description_availability: string | null
}

/**
 * The field, one publication per family, in random order.
 *
 * Two statements, one transaction, because the temp table lives on one
 * connection. The first is the only pass over `local_patents`; the second reads
 * the staged rows and joins the availability view by id. The alternative —
 * joining the view into the scope predicate and ordering — reads a 45M-row table
 * twice through the view's own LEFT JOIN and cannot early-exit on the cap.
 *
 * A statement timeout here is PERMANENT. If the field cannot be staged in the
 * budget it cannot be read in one either, and a retry would spend the same 90
 * seconds to reach the same answer.
 */
async function stageField(
  scope: WhitespaceScope,
  where: Prisma.Sql,
  rule: Parameters<typeof narrowingAdvice>[1],
  rowCap: number
): Promise<StagedFamily[]> {
  const rows = await prisma.$transaction(
    async tx => {
      await setStatementTimeout(tx, STAGE_TIMEOUT_MS)
      try {
        await tx.$executeRaw(Prisma.sql`
          CREATE TEMP TABLE ws_miner_field ON COMMIT DROP AS
          SELECT lp."id"                                                     AS id,
                 COALESCE(lp."familyId", lp."publicationNumber")             AS family_key,
                 lp."publicationNumber"                                      AS publication_number,
                 lp."country"                                                AS country,
                 lp."kind"                                                   AS kind,
                 lp."filingDate"                                             AS filing_date,
                 lp."publicationDate"                                        AS publication_date,
                 -- A SLICE, never the whole value: length() on a TOASTed
                 -- description detoasts it, and this pass covers the whole field.
                 -- 5,001 characters is all resolveTextTier's length rule needs.
                 length(substr(lp."descriptionText", 1, 5001))               AS description_chars,
                 (btrim(COALESCE(substr(lp."claimsText", 1, 64), '')) <> '') AS has_claims,
                 (btrim(COALESCE(substr(lp."abstract", 1, 64), '')) <> ''
                  OR btrim(COALESCE(substr(lp."abstractOriginal", 1, 64), '')) <> '') AS has_abstract
          FROM "local_patents" lp
          WHERE ${where}
          LIMIT ${rowCap + 1}`)
      } catch (error) {
        if (isStatementTimeout(error)) {
          throw new WhitespacePermanentError(
            `This field is too broad for the miner to stage within ${Math.round(
              STAGE_TIMEOUT_MS / 1000
            )}s. ${narrowingAdvice(scope, rule)}`
          )
        }
        throw error
      }

      const staged = await tx.$queryRaw<Array<{ publications: bigint }>>(
        Prisma.sql`SELECT COUNT(*)::bigint AS publications FROM ws_miner_field`
      )
      const publications = Number(staged[0]?.publications ?? 0)
      if (publications > rowCap) {
        throw new WhitespacePermanentError(
          `This field matches more than ${rowCap.toLocaleString()} publications — bigger than the miner will stage exactly. A sample drawn from an arbitrary prefix of the match set would be biased, and every engine downstream is a ratio over that sample. ${narrowingAdvice(
            scope,
            rule
          )}`
        )
      }

      await setStatementTimeout(tx, PICK_TIMEOUT_MS)
      try {
        return await tx.$queryRaw<StagedRow[]>(Prisma.sql`
          SELECT r.family_key,
                 r.publication_number,
                 r.country,
                 r.filing_year,
                 r.publication_date,
                 r.description_chars,
                 r.has_claims,
                 r.has_abstract,
                 r.claims_availability,
                 r.description_availability
          FROM (
            SELECT DISTINCT ON (t.family_key)
                   t.family_key                                  AS family_key,
                   t.publication_number                          AS publication_number,
                   t.country                                     AS country,
                   EXTRACT(YEAR FROM t.filing_date)::int         AS filing_year,
                   t.publication_date                            AS publication_date,
                   t.description_chars                           AS description_chars,
                   t.has_claims                                  AS has_claims,
                   t.has_abstract                                AS has_abstract,
                   v."claimsAvailability"                        AS claims_availability,
                   v."descriptionAvailability"                   AS description_availability
            FROM ws_miner_field t
            JOIN "patent_text_availability" v ON v."id" = t.id
            -- The family's most readable publication: a complete EP claim set
            -- first, then a granted document, then the most recent filing.
            ORDER BY t.family_key,
                     (v."claimsAvailability" = 'FULL_EPO') DESC,
                     (t.kind LIKE 'B%') DESC,
                     t.filing_date DESC NULLS LAST,
                     t.publication_number ASC
          ) r
          -- Random, and the SAME random order every run: the sample is drawn by
          -- taking the head of this order within each tier.
          ORDER BY md5(r.family_key)`)
      } catch (error) {
        if (isStatementTimeout(error)) {
          throw new WhitespacePermanentError(
            `The field staged but its publications could not be resolved to families within ${Math.round(
              PICK_TIMEOUT_MS / 1000
            )}s. ${narrowingAdvice(scope, rule)}`
          )
        }
        throw error
      }
    },
    { timeout: STAGE_TIMEOUT_MS + PICK_TIMEOUT_MS + 60_000, maxWait: 20_000 }
  )

  return rows.map(row => ({
    familyKey: row.family_key,
    publicationNumber: row.publication_number,
    country: row.country,
    filingYear: row.filing_year === null ? null : Number(row.filing_year),
    publicationDate: row.publication_date,
    descriptionChars: Number(row.description_chars ?? 0),
    hasClaims: Boolean(row.has_claims),
    hasAbstract: Boolean(row.has_abstract),
    tier: stagedTextTier({
      descriptionChars: Number(row.description_chars ?? 0),
      hasClaims: Boolean(row.has_claims),
      hasAbstract: Boolean(row.has_abstract),
      claimsAvailability: row.claims_availability,
      descriptionAvailability: row.description_availability,
    }),
  }))
}

/** Chunks between awaited heartbeats in a long write or read loop. */
const HEARTBEAT_EVERY_CHUNKS = 5

async function persistStagedField(
  studyId: string,
  fingerprint: string,
  scopeVersion: number,
  staged: readonly StagedFamily[],
  sampled: ReadonlySet<string>,
  reporter: RunReporter
): Promise<void> {
  // Replaced rather than merged: `sampled` is a property of THIS harvest, and a
  // skipDuplicates insert would leave a previous run's flags in place.
  await prisma.minerFieldPublication.deleteMany({ where: { studyId, scopeFingerprint: fingerprint } })
  const batches = chunk(staged, DB_CHUNK)
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index]
    if (index > 0 && index % HEARTBEAT_EVERY_CHUNKS === 0) await reporter.heartbeat()
    await prisma.minerFieldPublication.createMany({
      data: batch.map(row => ({
        studyId,
        scopeFingerprint: fingerprint,
        scopeVersion,
        publicationNumber: row.publicationNumber,
        familyKey: row.familyKey,
        // 'none' is deliberately OUTSIDE the tier vocabulary: it is not a
        // reading, it is a family in the field that holds no readable text at
        // all. Collapsing it into 'abstract' would put families in the tier mix
        // that were never readable.
        textTier: row.tier ?? 'none',
        sampled: sampled.has(row.publicationNumber),
      })),
      skipDuplicates: true,
    })
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface TextRow {
  publicationNumber: string
  title: string | null
  abstract: string | null
  abstractOriginal: string | null
  claims_text: string | null
  description_text: string | null
  classifications: string[] | null
  applicants: unknown
  filing_year: number | null
  country: string | null
}

async function readSample(
  sample: readonly StagedFamily[],
  reporter: RunReporter
): Promise<{
  readings: Reading[]
  unreadableText: number
  languageMix: Record<string, number>
}> {
  const readings: Reading[] = []
  const languageMix: Record<string, number> = {}
  const byPublication = new Map(sample.map(row => [row.publicationNumber, row]))

  const batches = chunk(sample, DB_CHUNK)
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index]
    if (index > 0) await reporter.heartbeat()
    const publicationNumbers = batch.map(row => row.publicationNumber)
    const [, rows] = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(READ_TIMEOUT_MS)}, true)`,
      prisma.$queryRaw<TextRow[]>(Prisma.sql`
        SELECT lp."publicationNumber",
               lp."title",
               lp."abstract",
               lp."abstractOriginal",
               -- ::int is not decoration. A JS number binds as int8, and there is
               -- no substr(text, integer, bigint) — the whole read step failed
               -- with 42883 until these were cast.
               substr(lp."claimsText", 1, ${CLAIMS_CHARS * 2}::int)      AS claims_text,
               substr(lp."descriptionText", 1, ${DESCRIPTION_FULL_CHARS * 2}::int) AS description_text,
               lp."classifications",
               lp."applicants",
               EXTRACT(YEAR FROM lp."filingDate")::int              AS filing_year,
               lp."country"
        FROM "local_patents" lp
        WHERE lp."publicationNumber" IN (${Prisma.join(
          publicationNumbers.map(value => Prisma.sql`${value}`),
          ', '
        )})`),
    ])

    for (const row of rows) {
      const staged = byPublication.get(row.publicationNumber)
      if (!staged || !staged.tier) continue
      const reading = buildReading(staged, row)
      if (!reading) continue
      const label = reading.language ?? 'unknown'
      languageMix[label] = (languageMix[label] ?? 0) + 1
      readings.push(reading)
    }
  }
  // Every family the sample chose that produced no reading: text too broken to
  // spend a call on, text that vanished between the staging pass and this one,
  // or a row whose sections were all empty. One number, and it is a COUNT, not a
  // silent omission -- the sample's denominator stays what it was.
  const unreadableText = sample.length - readings.length
  return { readings, unreadableText, languageMix }
}

/**
 * Assemble the exact block the model will be shown.
 *
 * `sourceText` is used UNCHANGED for the prompt and for verification, so a
 * character offset the model returns indexes into the string the harvest checks
 * against. Any re-normalisation between the two would silently shift every span.
 */
export function buildReading(staged: StagedFamily, row: TextRow): Reading | null {
  const sections: Array<{ label: string; text: string }> = []
  let truncatedAtChars: number | null = null

  const description = normaliseSourceText(row.description_text ?? '')
  if (description) {
    // Branching on descriptionAvailability, through the tier that resolves it:
    // 'description-full' is exactly (label FULL/FULL_EPO, or body past the
    // 5,000-character import cap). Everything else is a prefix of a prefix.
    const cap = staged.tier === 'description-full' ? DESCRIPTION_FULL_CHARS : DESCRIPTION_PREFIX_CHARS
    const cut = truncateAtSentence(description, cap)
    if (cut.text) {
      sections.push({ label: 'Description', text: cut.text })
      truncatedAtChars = cut.truncatedAtChars
    }
  }

  const claims = normaliseSourceText(row.claims_text ?? '')
  const claimsCut = claims ? truncateAtSentence(claims, CLAIMS_CHARS) : { text: '', truncatedAtChars: null }
  if (claimsCut.text) sections.push({ label: 'Claims', text: claimsCut.text })

  // Prefer the English abstract. `abstractOriginal` alone means the corpus holds
  // only the office's own language, and a statement reached through translation
  // cannot be quoted as evidence — the quote would not appear in the source.
  const english = normaliseSourceText(row.abstract ?? '')
  const original = normaliseSourceText(row.abstractOriginal ?? '')
  const abstract = english || original
  let translated = false
  let language: string | null = null
  if (abstract) {
    const cut = truncateAtSentence(abstract, ABSTRACT_CHARS)
    if (cut.text) sections.push({ label: 'Abstract', text: cut.text })
    language = detectSourceLanguage(abstract, row.country ?? staged.country)
    translated = !english && Boolean(original) && language !== null && language !== 'en'
  }

  if (!sections.length) return null
  const sourceText = sections.map(section => `${section.label}: ${section.text}`).join('\n')
  if (looksUnreadable(sourceText)) return null

  return {
    familyKey: staged.familyKey,
    publicationNumber: staged.publicationNumber,
    title: (row.title ?? staged.publicationNumber).slice(0, 300),
    tier: staged.tier as TextTier,
    sourceText,
    textHash: textHashFor(staged.tier as TextTier, sourceText),
    hasClaims: Boolean(claimsCut.text),
    translated,
    language,
    truncatedAtChars,
    cpcSubclasses: cpcSubclassPrefixes(row.classifications),
    filingYear: row.filing_year === null ? staged.filingYear : Number(row.filing_year),
    applicantNorm: applicantNormOf(row.applicants),
  }
}

// ---------------------------------------------------------------------------
// Extraction cache
// ---------------------------------------------------------------------------

/** The identity of one reading. NUL-separated so the encoding is injective, exactly as textHashFor is. */
function readingKey(publicationNumber: string, textHash: string): string {
  return `${publicationNumber}\u0000${textHash}`
}

async function loadCachedExtractions(
  readings: readonly Reading[]
): Promise<Map<string, { id: string; extraction: NormalisedExtraction }>> {
  const hits = new Map<string, { id: string; extraction: NormalisedExtraction }>()
  const wanted = new Map(readings.map(reading => [readingKey(reading.publicationNumber, reading.textHash), reading]))
  for (const batch of chunk(readings, DB_CHUNK)) {
    const rows = await prisma.patentTextExtraction.findMany({
      where: {
        publicationNumber: { in: batch.map(reading => reading.publicationNumber) },
        supersededAt: null,
      },
      select: {
        id: true,
        publicationNumber: true,
        textHash: true,
        problems: true,
        mechanisms: true,
        technicalEffects: true,
        teachingAway: true,
        claimedScope: true,
      },
    })
    for (const row of rows) {
      const key = readingKey(row.publicationNumber, row.textHash)
      if (!wanted.has(key) || hits.has(key)) continue
      hits.set(key, {
        id: row.id,
        extraction: {
          problems: Array.isArray(row.problems) ? (row.problems as NormalisedExtraction['problems']) : [],
          mechanisms: Array.isArray(row.mechanisms) ? (row.mechanisms as NormalisedExtraction['mechanisms']) : [],
          technicalEffects: Array.isArray(row.technicalEffects) ? (row.technicalEffects as string[]) : [],
          teachingAway: Array.isArray(row.teachingAway) ? (row.teachingAway as Array<{ quote: string }>) : [],
          claimedScope: (row.claimedScope as NormalisedExtraction['claimedScope']) ?? null,
        },
      })
    }
  }
  return hits
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface ModelDocument {
  publicationNumber?: unknown
  problems?: unknown
  mechanisms?: unknown
  technicalEffects?: unknown
  teachingAway?: unknown
  claimedScope?: unknown
}

/**
 * One batch: never throws for a model or parse failure (those are counted), and
 * always rethrows a permanent fault through `permanent` so the caller can stop.
 */
async function runExtractionBatch(
  batch: readonly Reading[],
  context: WhitespaceLLMContext
): Promise<BatchOutcome> {
  const outcome: BatchOutcome = {
    ok: false,
    lines: [],
    results: [],
    droppedProblems: 0,
    droppedMechanisms: 0,
    droppedQuotes: 0,
    inputTokens: 0,
    outputTokens: 0,
    modelCode: null,
  }

  const subjects: ExtractionSubject[] = batch.map(reading => ({
    publicationNumber: reading.publicationNumber,
    title: reading.title,
    sourceText: reading.sourceText,
    hasClaims: reading.hasClaims,
    translated: reading.translated,
    language: reading.language,
    tierLabel: reading.tier,
  }))

  try {
    const response = await runMinerLLM({
      taskCode: TaskCode.IM_EXTRACT,
      stageCode: MINER_EXTRACT_STAGE_CODE,
      prompt: buildExtractionPrompt(subjects),
      context,
    })
    outcome.inputTokens = response.inputTokens
    outcome.outputTokens = response.outputTokens
    outcome.modelCode = response.modelCode

    const parsed = parseModelJson<{ documents?: ModelDocument[] }>(response.output, 'Miner extraction')
    const byPublication = new Map(batch.map(reading => [reading.publicationNumber, reading]))
    for (const document of parsed.documents ?? []) {
      const reading = byPublication.get(String(document.publicationNumber ?? ''))
      if (!reading) continue
      const verified = verifyExtraction(document, reading)
      outcome.droppedProblems += verified.droppedProblems
      outcome.droppedMechanisms += verified.droppedMechanisms
      outcome.droppedQuotes += verified.droppedQuotes
      outcome.results.push({ reading, extraction: verified.extraction })
      outcome.lines.push(`${reading.publicationNumber} — ${reading.title.slice(0, 70)}`)
    }
    outcome.ok = true
  } catch (error) {
    if (error instanceof WhitespacePermanentError) {
      outcome.permanent = error
      return outcome
    }
    console.error('[Miner] Extraction batch failed:', error instanceof Error ? error.message : error)
    outcome.ok = false
  }
  return outcome
}

/**
 * Keep only what the supplied text supports.
 *
 * Exported for the tests, because this is the function the product rests on: the
 * entire value of "what the corpus ADMITS is unsolved" is that nothing entered
 * the index which is not in the text.
 */
export function verifyExtraction(
  document: ModelDocument,
  reading: Pick<Reading, 'sourceText' | 'hasClaims' | 'translated'>
): {
  extraction: NormalisedExtraction
  droppedProblems: number
  droppedMechanisms: number
  droppedQuotes: number
} {
  const text = reading.sourceText
  const PROBLEM_KINDS = new Set(['admitted_drawback', 'stated_need', 'objective'])

  const problems: NormalisedExtraction['problems'] = []
  let droppedProblems = 0
  for (const raw of Array.isArray(document.problems) ? document.problems : []) {
    const entry = (raw ?? {}) as { statement?: unknown; kind?: unknown; sourceSpan?: unknown }
    const statement = typeof entry.statement === 'string' ? entry.statement.trim().slice(0, MAX_STATEMENT_CHARS) : ''
    const kind = typeof entry.kind === 'string' ? entry.kind.trim() : ''
    if (!statement || !PROBLEM_KINDS.has(kind)) {
      droppedProblems += 1
      continue
    }
    if (!locateStatement(text, statement, entry.sourceSpan as { start?: unknown; end?: unknown } | null)) {
      droppedProblems += 1
      continue
    }
    problems.push({ statement, kind })
    if (problems.length >= 6) break
  }

  const mechanisms: NormalisedExtraction['mechanisms'] = []
  let droppedMechanisms = 0
  for (const raw of Array.isArray(document.mechanisms) ? document.mechanisms : []) {
    const entry = (raw ?? {}) as { statement?: unknown; elements?: unknown; sourceSpan?: unknown }
    const statement = typeof entry.statement === 'string' ? entry.statement.trim().slice(0, MAX_STATEMENT_CHARS) : ''
    if (!statement) {
      droppedMechanisms += 1
      continue
    }
    if (!locateStatement(text, statement, entry.sourceSpan as { start?: unknown; end?: unknown } | null)) {
      droppedMechanisms += 1
      continue
    }
    const elements = (Array.isArray(entry.elements) ? entry.elements : [])
      .filter((element): element is string => typeof element === 'string')
      .map(element => element.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60))
      .filter(element => element.length > 2)
      .slice(0, MAX_MECHANISM_ELEMENTS)
    mechanisms.push({ statement, elements })
    if (mechanisms.length >= 4) break
  }

  const technicalEffects = (Array.isArray(document.technicalEffects) ? document.technicalEffects : [])
    .filter((effect): effect is string => typeof effect === 'string')
    .map(effect => effect.trim().slice(0, MAX_STATEMENT_CHARS))
    .filter(Boolean)
    .slice(0, MAX_TECHNICAL_EFFECTS)

  const teachingAway: Array<{ quote: string }> = []
  let droppedQuotes = 0
  for (const raw of Array.isArray(document.teachingAway) ? document.teachingAway : []) {
    const entry = (raw ?? {}) as { quote?: unknown }
    const quote = typeof entry.quote === 'string' ? entry.quote.trim().slice(0, MAX_QUOTE_CHARS) : ''
    // Verbatim, one sentence, and never from a translated reading — a translated
    // quote cannot appear in the source text, so it is not a quote at all.
    if (!quote || reading.translated || !isSingleSentence(quote) || gradeQuote(quote, text) !== 'exact') {
      droppedQuotes += 1
      continue
    }
    teachingAway.push({ quote })
    if (teachingAway.length >= 3) break
  }

  // "We did not read claims" is a different thing from "this patent claims
  // nothing", so scope is null unless claims were actually supplied.
  let claimedScope: NormalisedExtraction['claimedScope'] = null
  if (reading.hasClaims && document.claimedScope && typeof document.claimedScope === 'object') {
    const scope = document.claimedScope as { independentElements?: unknown; dependentNarrowings?: unknown }
    const list = (value: unknown) =>
      (Array.isArray(value) ? value : [])
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80))
        .filter(item => item.length > 2)
        .slice(0, 12)
    const independentElements = list(scope.independentElements)
    const dependentNarrowings = list(scope.dependentNarrowings)
    if (independentElements.length) claimedScope = { independentElements, dependentNarrowings }
  }

  return {
    extraction: { problems, mechanisms, technicalEffects, teachingAway, claimedScope },
    droppedProblems,
    droppedMechanisms,
    droppedQuotes,
  }
}

/**
 * Write the batch's extractions and supersede the thinner readings they replace.
 *
 * A richer-tier reading of a publication does NOT overwrite the older row — the
 * tier is inside the text hash, so it is a different row — it stamps the older
 * one `supersededAt`, which is what keeps a study that already consumed the thin
 * extraction able to explain what it read.
 */
async function persistExtractions(readings: readonly Reading[], modelCode: string | null): Promise<void> {
  if (!readings.length) return
  await prisma.patentTextExtraction.createMany({
    data: readings.map(reading => ({
      publicationNumber: reading.publicationNumber,
      familyKey: reading.familyKey,
      textTier: reading.tier,
      textHash: reading.textHash,
      problems: (reading.extraction?.problems ?? []) as unknown as Prisma.InputJsonValue,
      mechanisms: (reading.extraction?.mechanisms ?? []) as unknown as Prisma.InputJsonValue,
      technicalEffects: (reading.extraction?.technicalEffects ?? []) as unknown as Prisma.InputJsonValue,
      teachingAway: (reading.extraction?.teachingAway ?? []) as unknown as Prisma.InputJsonValue,
      claimedScope: (reading.extraction?.claimedScope ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      cpcSubclasses: reading.cpcSubclasses,
      language: reading.language,
      translated: reading.translated,
      model: modelCode,
      stageCode: MINER_EXTRACT_STAGE_CODE,
    })),
    skipDuplicates: true,
  })

  const rows = await prisma.patentTextExtraction.findMany({
    where: {
      publicationNumber: { in: readings.map(reading => reading.publicationNumber) },
      textHash: { in: readings.map(reading => reading.textHash) },
    },
    select: { id: true, publicationNumber: true, textHash: true },
  })
  const byKey = new Map(rows.map(row => [readingKey(row.publicationNumber, row.textHash), row.id]))
  for (const reading of readings) {
    reading.extractionId = byKey.get(readingKey(reading.publicationNumber, reading.textHash))
  }

  // One updateMany per tier, not per publication: there are only four tiers.
  for (const tier of ALL_TIERS) {
    const publicationNumbers = readings
      .filter(reading => reading.tier === tier && reading.extractionId)
      .map(reading => reading.publicationNumber)
    if (!publicationNumbers.length) continue
    const poorer = ALL_TIERS.filter(other => tierIsRicher(tier, other))
    if (!poorer.length) continue
    await prisma.patentTextExtraction.updateMany({
      where: { publicationNumber: { in: publicationNumbers }, supersededAt: null, textTier: { in: poorer } },
      data: { supersededAt: new Date() },
    })
  }
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

interface PendingStatement {
  reading: Reading
  kind: 'PROBLEM' | 'MECHANISM' | 'CLAIM_CORE'
  text: string
  textHash: string
}

async function indexStatements(readings: readonly Reading[], reporter: RunReporter): Promise<number> {
  // A cached extraction whose statements were never written (the extraction row
  // committed, the statement insert did not) would otherwise stay invisible
  // forever: the cache would keep answering "already extracted" while the index
  // held nothing for it.
  const usable = readings.filter(reading => reading.extraction && reading.extractionId)
  const withStatements = new Set<string>()
  for (const batch of chunk(usable, DB_CHUNK)) {
    const rows = await prisma.patentProblemStatement.findMany({
      where: { extractionId: { in: batch.map(reading => reading.extractionId as string) } },
      select: { extractionId: true },
      distinct: ['extractionId'],
    })
    for (const row of rows) withStatements.add(row.extractionId)
  }

  const pending: PendingStatement[] = []
  for (const reading of usable) {
    if (withStatements.has(reading.extractionId as string)) continue
    const extraction = reading.extraction as NormalisedExtraction
    for (const problem of extraction.problems) {
      pending.push({ reading, kind: 'PROBLEM', text: problem.statement, textHash: statementTextHash(problem.statement) })
    }
    for (const mechanism of extraction.mechanisms) {
      pending.push({
        reading,
        kind: 'MECHANISM',
        text: mechanism.statement,
        textHash: statementTextHash(mechanism.statement),
      })
    }
    // One CLAIM_CORE per family that has claims: the independent claim's
    // elements joined, which is what "has this combination ever been claimed in
    // this field" is asked against.
    const core = extraction.claimedScope?.independentElements?.join('; ').trim()
    if (core) pending.push({ reading, kind: 'CLAIM_CORE', text: core, textHash: statementTextHash(core) })
  }
  if (!pending.length) return 0

  let inserted = 0
  for (const batch of chunk(pending, STATEMENT_CHUNK)) {
    const vectors = await embedStatements(batch.map(statement => statement.text))
    await reporter.heartbeat()
    const result = await prisma.patentProblemStatement.createMany({
      data: batch.map(statement => ({
        extractionId: statement.reading.extractionId as string,
        publicationNumber: statement.reading.publicationNumber,
        familyKey: statement.reading.familyKey,
        kind: statement.kind,
        text: statement.text,
        textHash: statement.textHash,
        cpcSubclasses: statement.reading.cpcSubclasses,
        filingYear: statement.reading.filingYear,
        applicantNorm: statement.reading.applicantNorm,
        language: statement.reading.language,
      })),
      skipDuplicates: true,
    })
    inserted += result.count

    // The vector column is Unsupported() — Prisma cannot write it, so it is set
    // in a second pass keyed on the row's own unique triple. `embedding IS NULL`
    // keeps a re-run from re-writing vectors another study already stored.
    const values = batch
      .map((statement, index) => ({ statement, literal: vectors[index] }))
      .filter((entry): entry is { statement: PendingStatement; literal: string } => Boolean(entry.literal))
    for (const group of chunk(values, 100)) {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "patent_problem_statements" s
        SET "embedding" = v.emb
        FROM (VALUES ${Prisma.join(
          group.map(
            entry =>
              Prisma.sql`(${entry.statement.reading.publicationNumber}, ${entry.statement.kind}, ${
                entry.statement.textHash
              }, ${statementVectorLiteralSql(entry.literal)})`
          ),
          ', '
        )}) AS v(pub, kind, hash, emb)
        WHERE s."publicationNumber" = v.pub
          AND s."kind" = v.kind
          AND s."textHash" = v.hash
          AND s."embedding" IS NULL`)
    }
  }
  return inserted
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

function buildResult(input: {
  fingerprint: string
  familiesInField: number
  byTierField: TierCounts
  sample: number
  byTierSampled: TierCounts
  /** The tiers of the families actually READ -- what describeTierMix speaks about. */
  byTierRead: TierCounts
  read: number
  extracted: number
  cacheHits: number
  extractionFailures: number
  batches: number
  droppedProblems: number
  droppedMechanisms: number
  droppedQuotes: number
  unreadableText: number
  languageMix: Record<string, number>
  statementsIndexed: number
  newestPublicationDate: Date | null
  resolvedModels: Record<string, string>
  tokensIn: number
  tokensOut: number
  coverageNotes: string[]
}): MinerHarvestResult {
  const byTier = {} as Record<TextTier, number>
  for (const tier of ALL_TIERS) {
    byTier[tier] =
      input.byTierField[tier] > 0
        ? Math.round((input.byTierSampled[tier] / input.byTierField[tier]) * 1000) / 1000
        : 0
  }
  const overall = input.familiesInField > 0 ? Math.round((input.sample / input.familiesInField) * 1000) / 1000 : 0

  const notes = [...input.coverageNotes]
  // The tier mix, always, in words -- of what was READ, not of what was chosen.
  // Which depth a statement was read at changes what it means, and the sentence
  // has to travel with every number here.
  notes.push(describeTierMix(input.byTierRead))
  notes.push(
    `Read ${input.read.toLocaleString()} of ${input.sample.toLocaleString()} chosen families, sampled at random within each text tier from ${input.familiesInField.toLocaleString()} families in the field (${
      Math.round(overall * 1000) / 10
    }%). Every count in this harvest is over that sample, not over the field.`
  )
  if (input.newestPublicationDate) {
    notes.push(
      `The newest publication in this field is dated ${input.newestPublicationDate
        .toISOString()
        .slice(
          0,
          10
        )}. Applications filed in the last 18 months are unpublished and invisible to any search, so an absence here is an absence in published art only.`
    )
  }
  notes.push(
    'EP publications added by the bulk EPO import carry no filing date, and every field in this product is filing-year based, so those rows are outside this field entirely. European coverage here comes from EP and WO publications inside the Google corpus.'
  )
  const dropped = input.droppedProblems + input.droppedMechanisms + input.droppedQuotes
  if (dropped > 0) {
    notes.push(
      `${dropped.toLocaleString()} extracted item${
        dropped === 1 ? '' : 's'
      } could not be located in the text ${dropped === 1 ? 'it' : 'they'} came from and ${
        dropped === 1 ? 'was' : 'were'
      } dropped (${input.droppedProblems} problems, ${input.droppedMechanisms} mechanisms, ${
        input.droppedQuotes
      } quotes). Nothing enters the index that is not in the text, so a dropped item only ever weakens a conclusion.`
    )
  }
  if (input.cacheHits > 0) {
    notes.push(
      `${input.cacheHits.toLocaleString()} of ${input.read.toLocaleString()} readings had already been extracted from exactly this text and were reused rather than re-read.`
    )
  }

  return {
    scopeFingerprint: input.fingerprint,
    familiesInField: input.familiesInField,
    byTierField: input.byTierField,
    sampled: input.sample,
    byTierSampled: input.byTierSampled,
    samplingFraction: { overall, byTier },
    read: input.read,
    extracted: input.extracted,
    cacheHits: input.cacheHits,
    extractionFailures: input.extractionFailures,
    extractionFailureRate: input.batches > 0 ? Math.round((input.extractionFailures / input.batches) * 1000) / 1000 : 0,
    droppedProblems: input.droppedProblems,
    droppedMechanisms: input.droppedMechanisms,
    droppedQuotes: input.droppedQuotes,
    unreadableText: input.unreadableText,
    languageMix: input.languageMix,
    statementsIndexed: input.statementsIndexed,
    newestPublicationDate: input.newestPublicationDate ? input.newestPublicationDate.toISOString() : null,
    resolvedModels: input.resolvedModels,
    tokensUsed: { input: input.tokensIn, output: input.tokensOut },
    coverageNotes: notes,
    generatedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// The mini-harvest — the ONE extraction path, reused out of field
// ---------------------------------------------------------------------------

/** What a mini-harvest read, with the denominators its caller has to print. */
export interface MiniHarvestResult {
  /** Readings that ended up with an extraction, fresh or cached. */
  readings: Reading[]
  /** Publications asked for. */
  requested: number
  /** Publications that resolved to a readable reading. */
  read: number
  extracted: number
  cacheHits: number
  failedBatches: number
  statementsIndexed: number
  tokensUsed: { input: number; output: number }
  modelCode: string | null
}

/**
 * Read and extract a NAMED list of publications, outside any staged field.
 *
 * Exists so the cross-domain transfer engine does not grow a second extraction
 * path. Everything that makes the harvest honest lives in the functions this
 * calls — the tier resolution, the sentence-boundary truncation, the span
 * verification that DROPS anything not in the text, the corpus-level extraction
 * cache, and the statement indexing. A parallel implementation in the engines
 * would be a second place for that contract to be got wrong, and the one place
 * nobody would think to check when the numbers looked plausible.
 *
 * Differences from the harvest proper, all deliberate:
 *   - the caller supplies publication numbers instead of a scope predicate, so
 *     there is no staging pass and no field;
 *   - there is no circuit breaker. This is a bounded side-read of at most a few
 *     hundred publications; a provider outage here costs the transfer engine and
 *     is reported as a skipped engine, and must not abort a run whose other
 *     three engines are arithmetic over already-indexed statements.
 */
export async function runMiniHarvest(input: {
  publicationNumbers: readonly string[]
  reporter: RunReporter
  llmContext: WhitespaceLLMContext
  cap: number
  /** Narrated as this step's detail. */
  stepKey?: string
}): Promise<MiniHarvestResult> {
  const { reporter } = input
  const wanted = Array.from(new Set(input.publicationNumbers.filter(Boolean))).slice(0, Math.max(0, input.cap))
  const empty: MiniHarvestResult = {
    readings: [],
    requested: wanted.length,
    read: 0,
    extracted: 0,
    cacheHits: 0,
    failedBatches: 0,
    statementsIndexed: 0,
    tokensUsed: { input: 0, output: 0 },
    modelCode: null,
  }
  if (!wanted.length) return empty

  // Tier resolution needs the availability view, exactly as the staging pass
  // does — resolveTextTier is the single source of truth and nothing here may
  // infer a tier from a row.
  const staged: StagedFamily[] = []
  for (const batch of chunk(wanted, DB_CHUNK)) {
    const [, rows] = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(READ_TIMEOUT_MS)}, true)`,
      prisma.$queryRaw<StagedRow[]>(Prisma.sql`
        SELECT COALESCE(lp."familyId", lp."publicationNumber")            AS family_key,
               lp."publicationNumber"                                     AS publication_number,
               lp."country"                                               AS country,
               EXTRACT(YEAR FROM lp."filingDate")::int                    AS filing_year,
               lp."publicationDate"                                       AS publication_date,
               length(substr(lp."descriptionText", 1, 5001))              AS description_chars,
               (btrim(COALESCE(substr(lp."claimsText", 1, 64), '')) <> '') AS has_claims,
               (btrim(COALESCE(substr(lp."abstract", 1, 64), '')) <> ''
                OR btrim(COALESCE(substr(lp."abstractOriginal", 1, 64), '')) <> '') AS has_abstract,
               v."claimsAvailability"                                     AS claims_availability,
               v."descriptionAvailability"                                AS description_availability
        FROM "local_patents" lp
        JOIN "patent_text_availability" v ON v."id" = lp."id"
        WHERE lp."publicationNumber" IN (${Prisma.join(
          batch.map(value => Prisma.sql`${value}`),
          ', '
        )})`),
    ])
    for (const row of rows) {
      const tier = stagedTextTier({
        descriptionChars: Number(row.description_chars ?? 0),
        hasClaims: Boolean(row.has_claims),
        hasAbstract: Boolean(row.has_abstract),
        claimsAvailability: row.claims_availability,
        descriptionAvailability: row.description_availability,
      })
      if (!tier) continue
      staged.push({
        familyKey: row.family_key,
        publicationNumber: row.publication_number,
        country: row.country,
        filingYear: row.filing_year === null ? null : Number(row.filing_year),
        publicationDate: row.publication_date,
        descriptionChars: Number(row.description_chars ?? 0),
        hasClaims: Boolean(row.has_claims),
        hasAbstract: Boolean(row.has_abstract),
        tier,
      })
    }
    await reporter.heartbeat()
  }
  if (!staged.length) return empty

  const { readings } = await readSample(staged, reporter)
  if (!readings.length) return { ...empty, read: 0 }

  const cached = await loadCachedExtractions(readings)
  let cacheHits = 0
  for (const reading of readings) {
    const hit = cached.get(readingKey(reading.publicationNumber, reading.textHash))
    if (!hit) continue
    reading.extractionId = hit.id
    reading.extraction = hit.extraction
    cacheHits += 1
  }

  const pending = readings.filter(reading => !reading.extraction)
  const batches = chunk(pending, EXTRACTION_FAMILIES_PER_CALL)
  const groups = chunk(batches, await resolveConcurrency(input.llmContext))
  let extracted = cacheHits
  let failedBatches = 0
  let tokensIn = 0
  let tokensOut = 0
  let modelCode: string | null = null

  for (const group of groups) {
    const outcomes = await Promise.all(group.map(batch => runExtractionBatch(batch, input.llmContext)))
    // A permanent fault is not "one batch failed" — it will fail every batch.
    const permanent = outcomes.find(outcome => outcome.permanent)
    if (permanent) throw permanent.permanent
    for (const outcome of outcomes) {
      tokensIn += outcome.inputTokens
      tokensOut += outcome.outputTokens
      if (outcome.modelCode) modelCode = outcome.modelCode
      if (!outcome.ok) {
        failedBatches += 1
        continue
      }
      for (const result of outcome.results) {
        result.reading.extraction = result.extraction
        extracted += 1
      }
    }
    await reporter.heartbeat()
    await persistExtractions(
      outcomes.flatMap(outcome => outcome.results.map(result => result.reading)),
      modelCode
    )
  }

  const statementsIndexed = await indexStatements(readings, reporter)
  return {
    readings: readings.filter(reading => reading.extraction && reading.extractionId),
    requested: wanted.length,
    read: readings.length,
    extracted,
    cacheHits,
    failedBatches,
    statementsIndexed,
    tokensUsed: { input: tokensIn, output: tokensOut },
    modelCode,
  }
}

