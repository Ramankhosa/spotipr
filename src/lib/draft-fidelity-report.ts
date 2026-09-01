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
import { coerceSupportDataSources, isSupportDataGuardrail } from '@/lib/support-data-sources'
import { coerceScopeRecommendations, getEffectiveScopeUse } from '@/lib/scope-recommendations'
import { coverageCategoryKeyForSourceField } from '@/lib/coverage-categories'

export type DraftFidelityOmission = {
  id: string
  label: string
  sourceField: string
}

export type DraftFidelityAddition = {
  /** Stable content key for acknowledgment persistence. */
  key: string
  section: string
  sentence: string
  unmatchedTerms: string[]
}

/** Where a covered source item landed in the draft. */
export type DraftFidelityLocation = {
  section: string
  /** Best-matching sentence in that section; '' when only a section-level match exists. */
  sentence: string
}

export type DraftFidelityItem = {
  /**
   * Stable content key: hash(sourceField | normalized value). Positional entry
   * ids (SDS-001, SF-<cat>-n) shift when arrays reorder, so acknowledgments and
   * review marks must key on content, never position.
   */
  key: string
  id: string
  label: string
  /**
   * Display name for table rows. Component entries match against a long
   * name+description+IO blob; the table shows the Stage-0 component name.
   */
  shortLabel: string
  sourceField: string
  category: string
  status: 'covered' | 'open'
  coveredIn: DraftFidelityLocation[]
}

export type DraftFidelityExclusionReason =
  | 'removed_by_you'
  | 'marked_do_not_claim'
  | 'guardrail'
  | 'scope_no_claim'
  | 'scope_excluded'

export type DraftFidelityExclusion = {
  key: string
  label: string
  reason: DraftFidelityExclusionReason
  sourceField: string
}

export type DraftFidelityTerm = {
  term: string
  key: string
  status: 'found' | 'missing'
  foundIn: string[]
}

export type DraftFidelityReport = {
  generatedAt: string
  sourceHandlingMode: SourceFidelityMode
  coverage: { covered: number; total: number }
  omissions: DraftFidelityOmission[]
  additions: DraftFidelityAddition[]
  terminology: { missingTerms: string[]; totalTerms: number; terms: DraftFidelityTerm[] }
  /** Every support entry, covered and open — the coverage denominator made visible. */
  items: DraftFidelityItem[]
  /** Source material intentionally excluded by the user's own selections. */
  excluded: DraftFidelityExclusion[]
  draft: { sectionKeys: string[] }
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

// Stable content hash (djb2 → hex). Keys survive array reordering and
// re-normalization as long as the underlying fact text is unchanged.
function contentKey(...parts: string[]): string {
  const text = parts.map(part => normalizeText(part)).join('|')
  let hash = 5381
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

type SectionMatchIndex = {
  section: string
  corpus: string
  stemSet: Set<string>
  prefixSet: Set<string>
  sentences: string[]
}

function buildSectionMatchIndex(section: string, text: string): SectionMatchIndex {
  const corpus = normalizeText(text)
  const stemSet = new Set<string>()
  const prefixSet = new Set<string>()
  distinctiveTokens(corpus).forEach(token => {
    const stem = stemLight(token)
    stemSet.add(stem)
    if (stem.length >= 6) prefixSet.add(stem.slice(0, 6))
  })
  return { section, corpus, stemSet, prefixSet, sentences: splitSentences(text) }
}

function sectionHits(index: SectionMatchIndex, entryTokens: string[]): number {
  let hits = 0
  for (const token of entryTokens) {
    const stem = stemLight(token)
    if (index.stemSet.has(stem) || (stem.length >= 6 && index.prefixSet.has(stem.slice(0, 6)))) hits++
  }
  return hits
}

function bestSentence(index: SectionMatchIndex, entryTokens: string[]): string {
  let best = ''
  let bestScore = 0
  for (const sentence of index.sentences) {
    const sentenceStems = new Set<string>()
    const sentencePrefixes = new Set<string>()
    distinctiveTokens(sentence).forEach(token => {
      const stem = stemLight(token)
      sentenceStems.add(stem)
      if (stem.length >= 6) sentencePrefixes.add(stem.slice(0, 6))
    })
    let score = 0
    for (const token of entryTokens) {
      const stem = stemLight(token)
      // Exact stem hits outrank prefix hits so "confirms" beats an unrelated
      // sentence that merely shares one weak token.
      if (sentenceStems.has(stem)) score += 2
      else if (stem.length >= 6 && sentencePrefixes.has(stem.slice(0, 6))) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      best = sentence
    }
  }
  return best
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

  // Per-section indexes power the jump-to-draft locations; the whole-corpus
  // rule above stays the authority for covered/open status (a fact split across
  // sections still counts covered).
  const sectionIndexes: SectionMatchIndex[] = sectionEntries.map(([key, value]) => buildSectionMatchIndex(key, value))
  const claimsTextValue = String(input.claimsText || '')
  if (claimsTextValue.trim()) {
    sectionIndexes.push(buildSectionMatchIndex('claims', claimsTextValue))
  }

  const locateEntry = (value: string): DraftFidelityLocation[] => {
    const entryTokens = distinctiveTokens(value)
    if (!entryTokens.length) return []
    const required = Math.min(2, entryTokens.length)
    const matches: Array<{ location: DraftFidelityLocation; hits: number }> = []
    for (const index of sectionIndexes) {
      const hits = entryMatchesClaim(index.corpus, value)
        ? entryTokens.length
        : sectionHits(index, entryTokens)
      if (hits >= required) {
        matches.push({ location: { section: index.section, sentence: bestSentence(index, entryTokens) }, hits })
      }
    }
    if (matches.length > 0) {
      return matches.sort((a, b) => b.hits - a.hits).map(match => match.location)
    }
    // Covered across sections but no single section passes on its own: point at
    // the single best partial match so the attorney still gets a starting place.
    let best: { location: DraftFidelityLocation; hits: number } | null = null
    for (const index of sectionIndexes) {
      const hits = sectionHits(index, entryTokens)
      if (hits > 0 && (!best || hits > best.hits)) {
        best = { location: { section: index.section, sentence: bestSentence(index, entryTokens) }, hits }
      }
    }
    return best ? [best.location] : []
  }

  // Component entries carry a name+description+IO blob for matching; the table
  // row must show the Stage-0 component name the inventor recognizes.
  const componentNamesByIndex: string[] = (Array.isArray(normalizedData.components) ? normalizedData.components : [])
    .map((component: any) => (typeof component?.name === 'string' ? component.name.replace(/\s+/g, ' ').trim() : ''))
  const shortLabelFor = (entry: SupportEntry): string => {
    const componentMatch = entry.id.match(/^normalized\.components-(\d+)$/)
    if (componentMatch) {
      const name = componentNamesByIndex[Number(componentMatch[1]) - 1]
      if (name) return name
    }
    const singleLine = entry.value.replace(/\s+/g, ' ').trim()
    return singleLine.length > 140 ? `${singleLine.slice(0, 140)}…` : singleLine
  }

  const seenOmissionValues = new Set<string>()
  const omissions: DraftFidelityOmission[] = []
  const items: DraftFidelityItem[] = []
  const seenItemKeys = new Set<string>()
  let covered = 0
  supportEntries.forEach((entry) => {
    const isCovered = entryCovered(entry.value)
    if (isCovered) covered++

    const itemKey = contentKey(entry.sourceField, entry.value)
    if (!seenItemKeys.has(itemKey)) {
      seenItemKeys.add(itemKey)
      items.push({
        key: itemKey,
        id: entry.id,
        label: entry.value,
        shortLabel: shortLabelFor(entry),
        sourceField: entry.sourceField,
        category: coverageCategoryKeyForSourceField(entry.sourceField),
        status: isCovered ? 'covered' : 'open',
        coveredIn: isCovered ? locateEntry(entry.value) : [],
      })
    }

    if (isCovered) return
    const key = normalizeText(entry.value)
    if (!key || seenOmissionValues.has(key)) return
    seenOmissionValues.add(key)
    omissions.push({ id: entry.id, label: entry.value, sourceField: entry.sourceField })
  })

  // ── Exclusions: source material the USER deselected — accounted for, not lost ─
  const excluded: DraftFidelityExclusion[] = []
  const seenExclusionKeys = new Set<string>()
  const pushExclusion = (label: string, reason: DraftFidelityExclusionReason, sourceField: string) => {
    const trimmed = String(label || '').replace(/\s+/g, ' ').trim()
    if (!trimmed) return
    const key = contentKey(sourceField, trimmed)
    if (seenExclusionKeys.has(key) || seenItemKeys.has(key)) return
    seenExclusionKeys.add(key)
    excluded.push({ key, label: trimmed, reason, sourceField })
  }
  ;(Array.isArray(normalizedData.doNotClaim) ? normalizedData.doNotClaim : []).forEach((value: any) => {
    pushExclusion(String(value ?? ''), 'marked_do_not_claim', 'doNotClaim')
  })
  coerceSupportDataSources(normalizedData.supportDataSources).forEach(item => {
    const label = item.label || item.value
    const sourceField = `supportDataSources.${item.kind}`
    if (item.status === 'deleted') {
      pushExclusion(label, 'removed_by_you', sourceField)
    } else if (item.kind === 'do_not_claim' || item.claimUse === 'do_not_claim') {
      pushExclusion(label, 'marked_do_not_claim', sourceField)
    } else if (item.status === 'unsupported' || isSupportDataGuardrail(item)) {
      pushExclusion(label, 'guardrail', sourceField)
    }
  })
  const scopeRecommendations = coerceScopeRecommendations(normalizedData.scopeRecommendations)
  ;(scopeRecommendations?.elements || []).forEach(element => {
    const effective = getEffectiveScopeUse(element)
    if (effective.claim === 'none') {
      pushExclusion(element.label, 'scope_no_claim', 'scopeRecommendations.none')
    } else if (effective.description === 'exclude') {
      pushExclusion(element.label, 'scope_excluded', 'scopeRecommendations.exclude')
    }
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
          key: contentKey(sectionKey, sentence),
          section: sectionKey,
          sentence,
          unmatchedTerms: Array.from(new Set([...unmatched, ...unmatchedNumbers])).slice(0, 10),
        })
      }
    }
  }

  // ── Terminology: inventor component terms the draft dropped ────────────────
  const names = componentNames(normalizedData)
  const terms: DraftFidelityTerm[] = names.map(name => {
    const normalized = normalizeText(name)
    const found = Boolean(normalized) && (draftCorpus.includes(normalized) || entryMatchesClaim(draftCorpus, name))
    const foundIn = found
      ? sectionIndexes
          .filter(index => index.corpus.includes(normalized) || entryMatchesClaim(index.corpus, name))
          .map(index => index.section)
      : []
    return { term: name, key: contentKey('terminology', name), status: found ? 'found' : 'missing', foundIn }
  })
  const missingTerms = terms.filter(term => term.status === 'missing').map(term => term.term)

  return {
    generatedAt: new Date().toISOString(),
    sourceHandlingMode: mode,
    coverage: { covered, total: supportEntries.length },
    omissions: omissions.slice(0, MAXIMUM_REPORTED_OMISSIONS),
    additions,
    terminology: { missingTerms, totalTerms: names.length, terms },
    items,
    excluded,
    draft: { sectionKeys: sectionEntries.map(([key]) => key) },
  }
}
