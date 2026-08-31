// Deterministic source-traceability pass over a finished draft.
//
// Compares the final specification sections and claims back to the inventor's
// raw idea and the Stage-0 normalized record, and reports three things:
//   - omissions:    source-stated facts the draft never covered
//   - additions:    draft sentences whose distinctive vocabulary has no source match
//   - terminology:  inventor component terms the draft dropped or renamed
//
// This is a review aid, not a quality verdict: every list is a pointer for the
// attorney to inspect, computed with the same token-matching machinery the
// preliminary-claims support matrix uses. No LLM call is involved, so the report
// is cheap, reproducible, and safe to recompute on demand.

import {
  entryMatchesClaim,
  supportEntriesFromContext,
  type PreliminaryClaimContext,
  type SupportEntry,
} from '@/lib/preliminary-claim-generation'
import { resolveSourceFidelityMode, type SourceFidelityMode } from '@/lib/source-fidelity'

export type DraftFidelityOmission = {
  id: string
  label: string
  sourceField: string
}

export type DraftFidelityAddition = {
  section: string
  sentence: string
  unmatchedTerms: string[]
}

export type DraftFidelityReport = {
  generatedAt: string
  sourceHandlingMode: SourceFidelityMode
  coverage: { covered: number; total: number }
  omissions: DraftFidelityOmission[]
  additions: DraftFidelityAddition[]
  terminology: { missingTerms: string[]; totalTerms: number }
}

export type DraftFidelityInput = {
  rawIdea: string
  normalizedData: Record<string, any> | null | undefined
  /** Final section texts keyed by section key (HTML or plain text). */
  sections: Record<string, string | null | undefined>
  /** Final claims text (plain or HTML); counted as accepted scope, not as an addition. */
  claimsText?: string
}

const MAXIMUM_REPORTED_ADDITIONS = 25
const MAXIMUM_REPORTED_OMISSIONS = 40

// Sections whose content is derived mechanically (numbering, figure lists) or is
// too short/formulaic for sentence-level matching to be meaningful.
const ADDITION_EXEMPT_SECTIONS = new Set([
  'title',
  'claims',
  'listOfNumerals',
  'briefDescriptionOfDrawings',
  'crossReference',
  'preamble',
])

const STOPWORDS = new Set([
  'about', 'above', 'accordance', 'according', 'after', 'also', 'and', 'another', 'any',
  'apparatus', 'are', 'aspect', 'based', 'being', 'below', 'between', 'both', 'can',
  'claim', 'claims', 'comprises', 'comprising', 'configured', 'described', 'description',
  'device', 'disclosed', 'disclosure', 'each', 'embodiment', 'embodiments', 'exemplary',
  'figure', 'figures', 'first', 'from', 'further', 'having', 'herein', 'include',
  'includes', 'including', 'invention', 'into', 'least', 'may', 'method', 'more', 'one',
  'only', 'operatively', 'plurality', 'present', 'provided', 'provides', 'said', 'second',
  'section', 'shown', 'some', 'source', 'stated', 'step', 'steps', 'substantially',
  'such', 'system', 'that', 'the', 'thereby', 'thereof', 'third', 'this', 'through',
  'various', 'well', 'when', 'where', 'wherein', 'which', 'with', 'within', 'without',
])

function normalizeText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9.%/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(value: unknown): string[] {
  return normalizeText(value)
    .split(' ')
    .map(token => token.replace(/^[./-]+|[./-]+$/g, ''))
    .filter(Boolean)
}

function distinctiveTokens(value: unknown): string[] {
  return tokens(value).filter(token =>
    token.length > 3 && !STOPWORDS.has(token) && !/^\d+([./-]\d+)*%?$/.test(token)
  )
}

function stemLight(token: string): string {
  // Just enough stemming that "sensors" matches "sensor" and "counting" matches
  // "count" without a stemming dependency.
  return token
    .replace(/(ings?|edly|edly|ally)$/i, '')
    .replace(/(es|s)$/i, '')
}

function splitSentences(text: string): string[] {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map(sentence => sentence.replace(/\s+/g, ' ').trim())
    .filter(sentence => sentence.length > 0)
}

function nonNotStated(entries: SupportEntry[]): SupportEntry[] {
  return entries.filter(entry => entry.value.trim() && !/^not stated by source$/i.test(entry.value.trim()))
}

function componentNames(normalizedData: Record<string, any> | null | undefined): string[] {
  const components = normalizedData?.components
  if (!Array.isArray(components)) return []
  const seen = new Set<string>()
  const names: string[] = []
  components.forEach((component: any) => {
    const name = typeof component?.name === 'string' ? component.name.replace(/\s+/g, ' ').trim() : ''
    const key = name.toLowerCase()
    if (!name || seen.has(key)) return
    seen.add(key)
    names.push(name)
  })
  return names
}

export function computeDraftFidelityReport(input: DraftFidelityInput): DraftFidelityReport {
  const normalizedData = input.normalizedData || {}
  const mode = resolveSourceFidelityMode(normalizedData)

  const context: PreliminaryClaimContext = {
    rawIdea: input.rawIdea,
    title: normalizedData.title,
    problem: normalizedData.problem,
    objectives: normalizedData.objectives,
    logic: normalizedData.logic,
    components: normalizedData.components,
    bestMethod: normalizedData.bestMethod,
    abstract: normalizedData.abstract,
    coreInventiveConcept: normalizedData.coreInventiveConcept,
    claimableFeatures: normalizedData.claimableFeatures,
    fallbackLimitations: normalizedData.fallbackLimitations,
    doNotClaim: normalizedData.doNotClaim,
    sourceFactLedger: normalizedData.sourceFactLedger,
    scopeRecommendations: normalizedData.scopeRecommendations,
    supportDataSources: normalizedData.supportDataSources,
  }

  const supportEntries = nonNotStated(supportEntriesFromContext(context))

  const sectionEntries = Object.entries(input.sections)
    .map(([key, value]) => [key, String(value || '')] as const)
    .filter(([, value]) => value.trim().length > 0)

  const draftCorpus = normalizeText(
    [...sectionEntries.map(([, value]) => value), input.claimsText || ''].join(' ')
  )

  // ── Omissions: source-stated facts absent from the whole draft ─────────────
  // entryMatchesClaim needs exact token hits; the stem/prefix fallback lets
  // morphological variants count ("confirmation" covers "confirms") so a
  // faithful draft is not flagged over inflection differences.
  const draftStemSet = new Set<string>()
  const draftPrefixSet = new Set<string>()
  distinctiveTokens(draftCorpus).forEach(token => {
    const stem = stemLight(token)
    draftStemSet.add(stem)
    if (stem.length >= 6) draftPrefixSet.add(stem.slice(0, 6))
  })
  const entryCovered = (value: string) => {
    if (entryMatchesClaim(draftCorpus, value)) return true
    const entryTokens = distinctiveTokens(value)
    if (!entryTokens.length) return true
    let hits = 0
    for (const token of entryTokens) {
      const stem = stemLight(token)
      if (draftStemSet.has(stem) || (stem.length >= 6 && draftPrefixSet.has(stem.slice(0, 6)))) hits++
    }
    return hits >= Math.min(2, entryTokens.length)
  }

  const seenOmissionValues = new Set<string>()
  const omissions: DraftFidelityOmission[] = []
  let covered = 0
  supportEntries.forEach((entry) => {
    if (entryCovered(entry.value)) {
      covered++
      return
    }
    const key = normalizeText(entry.value)
    if (!key || seenOmissionValues.has(key)) return
    seenOmissionValues.add(key)
    omissions.push({ id: entry.id, label: entry.value, sourceField: entry.sourceField })
  })

  // ── Additions: draft sentences with no source-vocabulary anchor ────────────
  // Source vocabulary = raw idea + normalized record + accepted claims. Claims
  // are included because by review time they are the user-approved scope.
  const sourceVocabulary = new Set<string>()
  const feedVocabulary = (value: unknown) => {
    distinctiveTokens(value).forEach(token => {
      sourceVocabulary.add(token)
      sourceVocabulary.add(stemLight(token))
    })
  }
  feedVocabulary(input.rawIdea)
  feedVocabulary(input.claimsText)
  feedVocabulary(normalizedData.title)
  ;['problem', 'objectives', 'logic', 'bestMethod', 'abstract', 'coreInventiveConcept', 'variants', 'inputs', 'outputs'].forEach(key => feedVocabulary(normalizedData[key]))
  supportEntries.forEach(entry => feedVocabulary(entry.value))
  ;(Array.isArray(normalizedData.components) ? normalizedData.components : []).forEach((component: any) => {
    feedVocabulary([component?.name, component?.description, component?.inputs, component?.outputs].filter(Boolean).join(' '))
  })

  const numericVocabulary = new Set(
    tokens([
      input.rawIdea,
      input.claimsText,
      ...supportEntries.map(entry => entry.value),
      normalizedData.logic,
      normalizedData.abstract,
    ].join(' ')).filter(token => /\d/.test(token))
  )

  const additions: DraftFidelityAddition[] = []
  for (const [sectionKey, sectionText] of sectionEntries) {
    if (ADDITION_EXEMPT_SECTIONS.has(sectionKey)) continue
    for (const sentence of splitSentences(sectionText)) {
      if (additions.length >= MAXIMUM_REPORTED_ADDITIONS) break
      const sentenceTokens = distinctiveTokens(sentence)
      if (sentenceTokens.length < 4) continue
      const unmatched = sentenceTokens.filter(token =>
        !sourceVocabulary.has(token) && !sourceVocabulary.has(stemLight(token))
      )
      const unmatchedNumbers = tokens(sentence)
        .filter(token => /\d/.test(token) && token.replace(/\D/g, '').length > 1)
        .filter(token => !numericVocabulary.has(token))
      const ratio = unmatched.length / sentenceTokens.length
      if ((unmatched.length >= 3 && ratio > 0.5) || unmatchedNumbers.length > 0) {
        additions.push({
          section: sectionKey,
          sentence,
          unmatchedTerms: Array.from(new Set([...unmatched, ...unmatchedNumbers])).slice(0, 10),
        })
      }
    }
  }

  // ── Terminology: inventor component terms the draft dropped ────────────────
  const names = componentNames(normalizedData)
  const missingTerms = names.filter(name => {
    const normalized = normalizeText(name)
    if (!normalized) return false
    if (draftCorpus.includes(normalized)) return false
    return !entryMatchesClaim(draftCorpus, name)
  })

  return {
    generatedAt: new Date().toISOString(),
    sourceHandlingMode: mode,
    coverage: { covered, total: supportEntries.length },
    omissions: omissions.slice(0, MAXIMUM_REPORTED_OMISSIONS),
    additions,
    terminology: { missingTerms, totalTerms: names.length },
  }
}
