import { gradeQuote, normaliseForQuote } from './citations'
import type { NormalisedExtraction } from './harvest-stage'

export const EXTRACTION_VERSION = 2
export interface SourceEvidence {
  field: string
  statement: string
  quote: string
  start: number
  end: number
  claimNumber?: number
}

/** Quotes locate evidence; extraction statements remain attributed paraphrases. */
export function verifyEvidenceExtraction(raw: unknown, source: string, hasClaims: boolean): NormalisedExtraction {
  const doc = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const evidence: SourceEvidence[] = []
  const array = (v: unknown) => Array.isArray(v) ? v.slice(0, 12) : []
  const verify = (value: unknown, field: string, claim = false): string | null => {
    if (!value || typeof value !== 'object') return null
    const item = value as Record<string, unknown>
    const statementValue = item.statement
    const quoteValue = item.quote
    if (typeof statementValue !== 'string' || typeof quoteValue !== 'string') return null
    const statement: string = statementValue.trim().slice(0, 160)
    const quote: string = quoteValue.trim()
    if (!statement || quote.length > 1500 || quote.split(/\s+/).length < 4 || gradeQuote(quote, source) !== 'exact') return null
    const pattern = quote.trim().split(/\s+/).map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
    const located = new RegExp(pattern, 'i').exec(source)
    if (!located || located.index < 0) return null
    const start = located.index
    const claimNumber = Number(item.claimNumber)
    if (claim) {
      if (!hasClaims || !Number.isInteger(claimNumber) || claimNumber < 1) return null
      const claims = source.match(/Claims:\s*([\s\S]*?)(?:\s+Abstract:|$)/)?.[1] ?? ''
      const numbered = Array.from(claims.matchAll(/(?:^|\s)(\d+)\s*[.)]\s+/g))
      const index = numbered.findIndex(m => Number(m[1]) === claimNumber)
      if (index < 0) return null
      const begin = (numbered[index].index ?? 0) + numbered[index][0].length
      const end = index + 1 < numbered.length ? numbered[index + 1].index : claims.length
      if (gradeQuote(quote, claims.slice(begin, end)) !== 'exact') return null
    }
    // A quote cannot substantiate changed quantities or negation in its paraphrase.
    const quantities: string[] = statement.match(/\d+(?:[.,]\d+)?/g) ?? []
    const quotedQuantities: string[] = quote.match(/\d+(?:[.,]\d+)?/g) ?? []
    if (quantities.some(n => !quotedQuantities.includes(n))) return null
    const negative = /\b(not|never|without|cannot|unable)\b/i
    if (negative.test(statement) !== negative.test(quote)) return null
    evidence.push({ field, statement, quote: located[0], start, end: start + located[0].length, ...(claim ? { claimNumber } : {}) })
    return statement
  }
  const problems = array(doc.problems).flatMap(item => {
    const kindValue = item && typeof item === 'object' ? (item as Record<string, unknown>).kind : undefined
    if (typeof kindValue !== 'string' || !['admitted_drawback', 'stated_need', 'objective'].includes(kindValue)) return []
    const statement = verify(item, 'problem')
    return statement ? [{ statement, kind: kindValue }] : []
  }).slice(0, 6)
  const mechanisms = array(doc.mechanisms).flatMap(item => {
    const statement = verify(item, 'mechanism')
    const elements = array(item && typeof item === 'object' ? (item as Record<string, unknown>).elements : undefined)
      .map(e => verify(e, 'element')).filter((s): s is string => !!s)
    return statement ? [{ statement, elements: elements.slice(0, 6) }] : []
  }).slice(0, 4)
  const technicalEffects = array(doc.technicalEffects).map(e => verify(e, 'technicalEffect')).filter((s): s is string => !!s).slice(0, 4)
  const teachingAway = array(doc.teachingAway).flatMap(item => {
    const quoteValue = item && typeof item === 'object' ? (item as Record<string, unknown>).quote : undefined
    const quote = typeof quoteValue === 'string' ? quoteValue : ''
    return verify({ statement: quote, quote }, 'teachingAway') ? [{ quote }] : []
  }).slice(0, 3)
  const claimed = doc.claimedScope as Record<string, unknown> | undefined
  const independentElements = array(claimed?.independentElements).map(e => verify(e, 'independentElement', true)).filter((s): s is string => !!s)
  const dependentNarrowings = array(claimed?.dependentNarrowings).map(e => verify(e, 'dependentNarrowing', true)).filter((s): s is string => !!s)
  return { problems, mechanisms, technicalEffects, teachingAway,
    claimedScope: independentElements.length ? { independentElements, dependentNarrowings } : null,
    sourceEvidence: evidence,
  }
}

export const EVIDENCE_CONTRACT = `
EXTRACTION CONTRACT VERSION 2 (overrides the output examples above):
For every problem, mechanism, technical effect, mechanism element and claim element return
an object with statement and quote. quote must be an exact contiguous supporting passage
from that document's supplied text, 4 or more words and no more than 1500 characters.
Retain kind for problems. Every element in mechanisms[].elements is now {statement,quote}.
technicalEffects is now [{statement,quote}]. Both claimedScope arrays contain
{statement,quote,claimNumber}; omit entries when their numbered claim was not supplied.
Do not infer dependent claims from an abstract or a first claim. Teaching-away retains
{quote}. Preserve negation, numbers, units, conditions and causal direction. An empty
array is preferable to an unsupported assertion. Do not invent or translate quotations.
The statement may be an English paraphrase; the supporting quote remains in the source language.
`
