/**
 * Invention Miner — verifying that a model's quotes are real.
 *
 * Every gap engine asks a model to justify itself with quotes from publications
 * it was shown. A quote that is not in the source it names is not evidence: it is
 * either a paraphrase presented as a quotation, or an invention. Both look
 * exactly like a real citation on the page.
 *
 * THE PRODUCT RULE THIS ENFORCES: a dropped citation may only ever WEAKEN a
 * conclusion, never strengthen one. Concretely —
 *
 *   - A lead supported only by dropped citations is not "supported with a caveat".
 *     It is unsupported, and must be scored and shown as such.
 *   - "No prior art suggests this" is the single most valuable and most dangerous
 *     sentence the miner can emit. When the model reaches it by citing nothing
 *     checkable, the honest report is "nothing checkable was found either way" —
 *     an absence of verified evidence is not verified evidence of absence.
 *   - A dropped citation must therefore never be quietly removed from a list to
 *     make the remaining ones look complete. It is a coverage fact and travels
 *     with the conclusion it failed to support.
 *
 * `near` exists because models re-wrap, re-hyphenate and de-duplicate whitespace
 * when copying, and rejecting those would make the grade a formatting test rather
 * than a truthfulness one. It is deliberately tight: a paraphrase that changes a
 * tenth of the words is a paraphrase, and grades `dropped`.
 */

/**
 * The comparison form: whitespace collapsed to single spaces, trimmed, lowercased.
 *
 * Nothing else is normalised on purpose. Stripping punctuation would let "not
 * suitable for high temperatures" match "suitable for high temperatures", and
 * unifying numerals would let a quote about 5 °C verify against one about 50 °C —
 * both are exactly the kind of near-miss the check is here to catch.
 */
export function normaliseForQuote(s: string): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * exact   — the quote appears verbatim in the source (modulo whitespace and case)
 * near    — ≥ NEAR_THRESHOLD token-level Jaccard against the best same-length
 *           window of the source: the model copied it, with cosmetic slippage
 * dropped — neither, or the publication was never shown to the model at all
 */
export type CitationGrade = 'exact' | 'near' | 'dropped'

/**
 * Deliberately high. At 0.9 a ten-word quote may differ by one word; below that
 * the grade stops distinguishing "copied" from "wrote something similar", which
 * is the whole distinction the report rests on.
 */
const NEAR_THRESHOLD = 0.9

/** A quote shorter than this cannot be verified meaningfully — three words match anything. */
const MIN_QUOTE_TOKENS = 4

function tokenise(normalised: string): string[] {
  return normalised ? normalised.split(' ') : []
}

/**
 * Best token-set Jaccard between the quote and any window of the source of the
 * SAME token length.
 *
 * Same-length windows, rather than the whole source, because Jaccard against a
 * long document is dominated by the document's own vocabulary: a 12-word quote
 * measured against a 4,000-word description scores near zero even when it is
 * present verbatim. Deterministic and allocation-light — the window's token
 * counts are maintained incrementally as it slides, so this is O(source tokens ×
 * distinct quote tokens).
 */
function bestWindowJaccard(quoteTokens: string[], sourceTokens: string[]): number {
  if (!quoteTokens.length || !sourceTokens.length) return 0

  // Distinct quote tokens as a plain array — iterated once per window, so it is
  // built once here rather than re-derived from a Set inside the loop.
  const quoteDistinct: string[] = []
  const seen = new Map<string, true>()
  for (const token of quoteTokens) {
    if (seen.has(token)) continue
    seen.set(token, true)
    quoteDistinct.push(token)
  }

  // A quote longer than the whole source has no same-length window; compare
  // against the entire source as the single available window.
  const width = Math.min(quoteTokens.length, sourceTokens.length)

  const counts = new Map<string, number>()
  let distinct = 0
  const add = (token: string) => {
    const next = (counts.get(token) ?? 0) + 1
    counts.set(token, next)
    if (next === 1) distinct += 1
  }
  const remove = (token: string) => {
    const next = (counts.get(token) ?? 0) - 1
    if (next <= 0) {
      counts.delete(token)
      distinct -= 1
    } else {
      counts.set(token, next)
    }
  }

  let best = 0
  for (let i = 0; i < width; i += 1) add(sourceTokens[i])
  for (let start = 0; ; start += 1) {
    let intersection = 0
    for (const token of quoteDistinct) if (counts.has(token)) intersection += 1
    const union = quoteDistinct.length + distinct - intersection
    if (union > 0) best = Math.max(best, intersection / union)
    if (best >= 1) break

    const end = start + width
    if (end >= sourceTokens.length) break
    remove(sourceTokens[start])
    add(sourceTokens[end])
  }
  return best
}

/** Grade one quote against the text it claims to come from. */
export function gradeQuote(quote: string, sourceText: string): CitationGrade {
  const normalisedQuote = normaliseForQuote(quote)
  const normalisedSource = normaliseForQuote(sourceText)
  if (!normalisedQuote || !normalisedSource) return 'dropped'
  if (normalisedSource.includes(normalisedQuote)) return 'exact'

  const quoteTokens = tokenise(normalisedQuote)
  // Too short to verify: an unverifiable citation is a dropped one, never a
  // generous 'near'. The rule only ever bites in the weakening direction.
  if (quoteTokens.length < MIN_QUOTE_TOKENS) return 'dropped'

  return bestWindowJaccard(quoteTokens, tokenise(normalisedSource)) >= NEAR_THRESHOLD ? 'near' : 'dropped'
}

export interface GradedCitation<T> {
  item: T
  grade: CitationGrade
}

/**
 * Grade a model's citations against the texts it was actually shown.
 *
 * `sources` is keyed by publication number and MUST hold only what the model was
 * given — the same strings, at the same tier. A citation whose publication is not
 * in the map is `dropped` without further checking: the model cited a document it
 * was never shown, which is the strongest possible signal that the quote was
 * generated rather than read, and no amount of textual similarity to something
 * else would redeem it.
 *
 * Every input item is returned, in input order, graded. Nothing is filtered here:
 * the caller decides what a dropped citation does to a conclusion, and the rule
 * above says the only permitted answer is "weakens it".
 */
export function gradeCitations<T>(
  items: T[],
  read: (item: T) => { quote: string; pub: string },
  sources: Map<string, string>
): GradedCitation<T>[] {
  return items.map(item => {
    const { quote, pub } = read(item)
    const source = sources.get(pub)
    if (source === undefined) return { item, grade: 'dropped' as const }
    return { item, grade: gradeQuote(quote, source) }
  })
}
