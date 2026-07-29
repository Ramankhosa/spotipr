/**
 * Office Action Studio — post-draft contradiction check
 *
 * This and the full-document absence scan close the same failure from opposite
 * ends. The scan stops the CHART being wrong; this stops the PROSE contradicting
 * a chart that is right.
 *
 * A drafted section can say "D1 does not disclose the phaseolin promoter" while
 * the chart for D1 records that very feature as disclosed. Nothing upstream
 * catches that: the sentence is fluent, cites a real document, and quotes
 * nothing it needs to verify.
 *
 * Deterministic — no model call. Which is exactly why it must be honest about
 * how sure it is. Mapping a sentence to a claim limitation is easy when the
 * sentence names a rare technical term and one document, and unreliable when it
 * carries several limitations, several documents, pronouns, or is arguing about
 * the examiner rather than about a document. So only a HIGH-confidence mapping
 * may block a filing; everything else is surfaced and left to the attorney.
 */

import { isRareToken } from './absence-scan'

export type Polarity = 'PRESENT' | 'ABSENT'
export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export interface ChartFact {
  citationLabel: string
  claimNumber: number
  feature: string
  verdict: string
}

export interface ContradictionMatch {
  sentence: string
  where: string
  citationLabels: string[]
  polarity: Polarity
  matchedFeatures: string[]
  confidence: MatchConfidence
  verdict: string
  /** Only ever true at HIGH confidence. */
  blocking: boolean
  message: string
}

/** "D1", "D3" — the labels an office uses for cited documents. */
const CITATION_LABEL_RE = /\bD\s?(\d{1,2})\b/g

const ABSENT_PATTERNS = [
  /\bdoes not disclose\b/i, /\bdo not disclose\b/i, /\bfails? to disclose\b/i,
  /\bis silent\b/i, /\bare silent\b/i, /\bno(?:t any)? (?:express )?disclosure\b/i,
  /\bnone of (?:the )?(?:cited|D\s?\d)/i, /\bneither\b/i, /\bnowhere\b/i,
  /\bfails? to (?:teach|suggest|describe)\b/i, /\bdoes not teach\b/i
]
const PRESENT_PATTERNS = [
  /\bdiscloses\b/i, /\bteaches\b/i, /\bdescribes\b/i, /\bshows\b/i
]

/** A sentence about the examiner's reasoning is not a claim about a document. */
const NOT_A_DOCUMENT_CLAIM = /\bexaminer\b|\bcontroller\b|\bobjection\b|\bhindsight\b|\bcombination is\b/i

function splitSentences(text: string): string[] {
  return (text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.;])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
}

function labelsIn(sentence: string): string[] {
  const out: string[] = []
  CITATION_LABEL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CITATION_LABEL_RE.exec(sentence)) !== null) out.push(`D${m[1]}`)
  return Array.from(new Set(out))
}

function polarityOf(sentence: string): Polarity | null {
  if (ABSENT_PATTERNS.some(re => re.test(sentence))) return 'ABSENT'
  if (PRESENT_PATTERNS.some(re => re.test(sentence))) return 'PRESENT'
  return null
}

function normalize(s: string): string {
  return (s || '').toLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Which charted feature is this sentence talking about?
 *
 * A rare technical token shared with exactly one feature is a confident match —
 * "phaseolin" appears in one limitation and nowhere else. Anything vaguer is
 * not, and says so.
 */
function matchFeatures(sentence: string, facts: ChartFact[]): { features: ChartFact[]; confidence: MatchConfidence } {
  const normSentence = normalize(sentence)
  const scored = facts.map(fact => {
    const featureTokens = Array.from(new Set(normalize(fact.feature).split(' ').filter(Boolean)))
    const rare = featureTokens.filter(isRareToken)
    const rareHits = rare.filter(t => normSentence.includes(t))
    const phrase = normalize(fact.feature)
    const exact = phrase.length > 12 && normSentence.includes(phrase)
    return { fact, rareHits: rareHits.length, exact }
  })

  const strong = scored.filter(s => s.exact || s.rareHits >= 1)
  if (!strong.length) return { features: [], confidence: 'LOW' }

  // Exactly one feature, matched on something specific → confident.
  if (strong.length === 1 && (strong[0].exact || strong[0].rareHits >= 1)) {
    return { features: [strong[0].fact], confidence: 'HIGH' }
  }
  return { features: strong.map(s => s.fact), confidence: 'MEDIUM' }
}

export interface ContradictionInput {
  /** Approved section texts that will actually be filed. */
  sections: Array<{ where: string; text: string }>
  /** Every charted cell available for this case. */
  facts: ChartFact[]
}

/**
 * Find statements the reply makes about the prior art that its own evidence
 * contradicts.
 */
export function findContradictions(input: ContradictionInput): ContradictionMatch[] {
  const out: ContradictionMatch[] = []
  if (!input.facts.length) return out

  for (const section of input.sections) {
    for (const sentence of splitSentences(section.text)) {
      const labels = labelsIn(sentence)
      if (!labels.length) continue
      const polarity = polarityOf(sentence)
      if (!polarity) continue
      if (NOT_A_DOCUMENT_CLAIM.test(sentence)) continue

      const relevant = input.facts.filter(f => labels.includes(f.citationLabel))
      if (!relevant.length) continue

      const { features, confidence: featureConfidence } = matchFeatures(sentence, relevant)
      if (!features.length) continue

      // One document + one feature, matched on a specific term, is the only
      // shape confident enough to block a filing.
      const confidence: MatchConfidence =
        labels.length === 1 && featureConfidence === 'HIGH' ? 'HIGH'
        : featureConfidence === 'LOW' ? 'LOW' : 'MEDIUM'

      for (const fact of features) {
        const contradictsPresence = polarity === 'ABSENT' && fact.verdict === 'DISCLOSED'
        const contradictsAbsence = polarity === 'PRESENT' && fact.verdict === 'NOT_FOUND'
        const assertsFromUnknown = polarity === 'ABSENT' && fact.verdict === 'UNKNOWN_DOCUMENT_INCOMPLETE'
        if (!contradictsPresence && !contradictsAbsence && !assertsFromUnknown) continue

        const message = contradictsPresence
          ? `The reply states that ${fact.citationLabel} does not disclose "${fact.feature}", but the evidence on this case records that it does.`
          : contradictsAbsence
            ? `The reply states that ${fact.citationLabel} discloses "${fact.feature}", but no disclosure was found for it.`
            : `The reply asserts an absence in ${fact.citationLabel} for "${fact.feature}", but that document is not completely on file — the absence has not actually been checked.`

        out.push({
          sentence, where: section.where, citationLabels: labels, polarity,
          matchedFeatures: [fact.feature], confidence, verdict: fact.verdict,
          blocking: confidence === 'HIGH',
          message
        })
      }
    }
  }

  return out
}
