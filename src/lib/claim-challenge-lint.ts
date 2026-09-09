// Deterministic pre-screening for the claim challenge feature.
//
// These checks are free: they run before any LLM call, they seed the challenger
// prompt with concrete observations so the model spends its budget on judgement
// rather than detection, and they are merged into the remark list tagged
// source:'lint'.
//
// Two defect families are covered. The "source adherence" family is claim text
// that mirrors the inventor's disclosure so closely that it inherits defects
// the disclosure was never required to avoid: subjective adjectives, internal
// project vocabulary, species detail marooned in Claim 1, chemistry welded into
// sequence strings, and outcomes recited inside static claims. The "claim form"
// family is ordinary drafting discipline: optional language, trademarks,
// omnibus references, multi-sentence claims, "and/or", means-plus-function
// wording, broken dependencies, duplicates, and negative limitations.
//
// Findings are ONLY ever rendered inside the challenge panel. They are not
// unsolicited quality warnings and must not be surfaced elsewhere.

import type { DraftClaim } from '@/lib/draft-claims-parser'
import type { OfficeFormCode } from '@/lib/claim-rules/codes'

export { computeClaimsFingerprint } from '@/lib/claims-fingerprint'

export type ClaimChallengeLintCode =
  | 'INDEFINITE_MODIFIER'
  | 'SOURCE_JARGON'
  | 'PICTURE_CLAIM_1'
  | 'SEQUENCE_CONFLATION'
  | 'FUNCTIONAL_RESULT_STATIC'
  | 'OPTIONAL_LANGUAGE'
  | 'TRADEMARK'
  | 'OMNIBUS_REFERENCE'
  | 'MULTI_SENTENCE'
  | 'AND_OR'
  | 'MEANS_PLUS_FUNCTION'
  | 'IMPROPER_DEPENDENCY'
  | 'MULTIPLE_DEPENDENT_CHAIN'
  | 'DUPLICATE_CLAIM'
  | 'NEGATIVE_LIMITATION'

export type ChallengeLintFinding = {
  /** A jurisdiction-blind code from this module, or an office-form code merged in by the challenge handler. */
  code: ClaimChallengeLintCode | OfficeFormCode
  claimNumber: number
  excerpt: string
  message: string
}

export type ClaimChallengeLintContext = {
  components?: unknown
}

/**
 * The fixed objection checklist the challenger must evaluate. Exported as a
 * constant so the prompt text is unit-testable and reviewable in one place
 * rather than buried in a template literal inside the route.
 */
export const CLAIM_CHALLENGE_CHECKLIST = `MANDATORY CHECKLIST - evaluate EVERY item against EVERY claim, and items 14 and 15 against the claim set as a whole:
1. DEFINITENESS - subjective, relative, or qualitative modifiers with no concrete structural, compositional, or numeric anchor; terms of degree with no stated standard; a trademark used to identify a material or component. A word is only acceptable if the claim itself defines it by a measurable threshold.
2. PICTURE_CLAIM - Claim 1 reciting a specific embodiment, named species, trade-specific grade, or the claim set's only numeric range, where the disclosure supports a broader class. A competitor must not escape Claim 1 by substituting a disclosed alternative.
3. JARGON - internal project names, marketing monikers, arbitrary acronyms, and capitalised functional labels that carry no recognised meaning in the art.
4. CATEGORY_MIX - active method steps, intended uses, or result statements inside a static claim (apparatus, system, product, composition), which draw no patentable weight; a single claim that mixes statutory classes, such as a system claim that requires a user to perform a step.
5. SEQUENCE_CONFLATION - biological sequences fused with chemical modifications in a single string, or any conflation of distinct structural, chemical, or operational domains that should be recited as separate limitations plus an explicit linkage.
6. ANTECEDENT_BASIS - "the"/"said" references with no prior introduction in the claim chain, elements introduced twice, and a singular introduced but later referenced as a plural or the reverse.
7. TERMINOLOGY_DRIFT - the same element named differently across claims, or a narrow term introduced before the broad term it should have followed.
8. UNSUPPORTED_MATTER - limitations, values, effects, or use cases with no support in the source context supplied above.
9. CLAIM_FORM - a claim that is not one sentence with a preamble, a transition, and a body; an unintended or inconsistent transition ("consisting of" closing a claim that should stay open); omnibus references to the description or drawings ("as described herein", "as shown in the figures"); "and/or" where "at least one of" is meant; alternatives not recited in "selected from the group consisting of" form; product-by-process wording in a product claim.
10. DEPENDENCY - a dependent claim that does not further limit the claim it references, that references a later or non-existent claim, that contradicts or broadens its parent, or that depends from a claim of another statutory category without the proper form; a multiple dependent claim that depends on another multiple dependent claim.
11. FUNCTIONAL_CLAIMING - "means for"/"step for", or a generic placeholder ("module", "unit", "mechanism") plus a function, at the point of novelty, invoking means-plus-function treatment without corresponding structure in the disclosure; a purely functional recitation of the inventive feature that claims the result rather than the structure achieving it.
12. OPTIONAL_LANGUAGE - "optionally", "preferably", "such as", "for example", "e.g.", "may", "can", "if desired" inside a claim; each leaves the scope of the limitation undecided.
13. RANGES - numeric limitations without units; open-ended ranges with no support at the open end; "about" or "approximately" with no tolerance; a range nested inside another range in one claim; a numeric limitation in Claim 1 that a dependent claim should carry.
14. CLAIM_SET_STRATEGY - no independent claim for a statutory category the disclosure supports (apparatus, method, system, composition, computer-readable medium as applicable); a flat dependent set in which every claim narrows Claim 1 the same way instead of a ladder of intermediate generalisations from broadest to narrowest; no fallback position for the feature most likely to be attacked; the broadest claim not first.
15. REDUNDANCY - duplicate or near-duplicate claims, dependents that merely restate their parent, and limitations repeated across claims.
16. NEGATIVE_LIMITATION - "not", "free of", "without", "excluding", "devoid of" where the disclosure gives no basis for the exclusion.`

/** Subjective modifiers that render a limitation indefinite absent a numeric anchor. */
const INDEFINITE_MODIFIERS = [
  'substantially',
  'essentially',
  'approximately',
  'about',
  'relatively',
  'generally',
  'improved',
  'optimized',
  'optimised',
  'enhanced',
  'high-fidelity',
  'high fidelity',
  'robust',
  'efficient',
  'rapid',
  'superior',
  'user-friendly',
  'user friendly',
  'advanced',
  'effective',
  'safe',
  'suitable',
  'desired',
  'appropriate',
  'sufficient',
  'high',
  'low',
  'near',
  'smart',
  'intelligent',
]

/** Chemical moieties that must not live inside a biological sequence string. */
const CHEMICAL_MOIETY_TOKENS = [
  'peg',
  'mpeg',
  'peg2000',
  'azide',
  'maleimide',
  'biotin',
  'fitc',
  'nhs',
  'dbco',
  'tamra',
  'cy5',
  'cy3',
  'acetyl',
  'palmitoyl',
]

/** Verbs that state an outcome rather than a structure. */
const RESULT_VERBS = [
  'triggers',
  'trigger',
  'causes',
  'cause',
  'treats',
  'treat',
  'cures',
  'cure',
  'improves',
  'improve',
  'increases',
  'increase',
  'reduces',
  'reduce',
  'prevents',
  'prevent',
  'enables',
  'enable',
  'enhances',
  'enhance',
  'eliminates',
  'eliminate',
  'ensures',
  'ensure',
]

/** Claim categories that are static: no active steps or outcomes may be recited. */
const STATIC_CATEGORIES = new Set(['apparatus', 'system', 'composition', 'product', 'medium', 'program', 'kit', 'compound'])

/** Structural anchors that convert a result into a capability. */
const CAPABILITY_ANCHORS = /\b(configured to|programmed to|adapted to|arranged to|operable to|structured to)\b/i

const CLAIM_BOILERPLATE = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'and', 'or', 'for', 'with', 'wherein', 'said',
  'claim', 'claims', 'comprising', 'consisting', 'according', 'method', 'system',
  'apparatus', 'composition', 'product', 'device', 'process', 'further', 'thereof',
])

function clauses(text: string): string[] {
  return String(text || '')
    .split(/;|,|\bwherein\b|\bwhereby\b/i)
    .map(part => part.trim())
    .filter(Boolean)
}

/**
 * A clause carries a numeric anchor when it states a measurable quantity.
 *
 * A bare digit is not enough. Claim text is full of digits that quantify
 * nothing: the dependency reference "of claim 1", and code names like "Pep-B2"
 * or "ABE8e" where the digit is part of a label. Counting those as a threshold
 * would silently excuse the very modifiers this check exists to catch, so the
 * number must stand as its own token.
 */
function hasNumericAnchor(clause: string): boolean {
  return /(?:^|[\s(])[<>~±]?\d[\d.,]*\s*(?:%|[a-zA-Z°µ]{1,12}\b)?/.test(stripNonQuantityDigits(clause))
}

/** Removes digits that label rather than measure. */
function stripNonQuantityDigits(text: string): string {
  return String(text || '')
    // "of claim 1", "claims 1-3" — the dependency reference, never a threshold.
    .replace(/\bclaims?\s+\d+(?:\s*(?:[-,]|to|and|or)\s*\d+)*/gi, ' ')
    // Alphanumeric labels: a digit welded to letters on either side.
    .replace(/\b[A-Za-z]+[-]?[A-Za-z]?\d+[A-Za-z]*\b/g, ' ')
}

function excerptAround(text: string, needle: string, width = 60): string {
  const idx = text.toLowerCase().indexOf(needle.toLowerCase())
  if (idx === -1) return text.slice(0, width).trim()
  const start = Math.max(0, idx - Math.floor(width / 2))
  const end = Math.min(text.length, idx + needle.length + Math.floor(width / 2))
  return `${start > 0 ? '...' : ''}${text.slice(start, end).trim()}${end < text.length ? '...' : ''}`
}

function claimCategory(claim: DraftClaim): string {
  return String((claim as any)?.category || '').trim().toLowerCase()
}

/**
 * Subjective modifiers with no numeric anchor in the same clause.
 *
 * The suppression is deliberately clause-scoped rather than claim-scoped: a
 * numeric range elsewhere in a long claim does not cure "substantially planar".
 */
export function findIndefiniteModifiers(claims: DraftClaim[]): ChallengeLintFinding[] {
  const findings: ChallengeLintFinding[] = []
  for (const claim of claims) {
    const text = String(claim?.text || '')
    if (!text) continue
    const seen = new Set<string>()
    for (const clause of clauses(text)) {
      if (hasNumericAnchor(clause)) continue
      for (const modifier of INDEFINITE_MODIFIERS) {
        const pattern = new RegExp(`\\b${modifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
        if (!pattern.test(clause)) continue
        if (seen.has(modifier)) continue
        seen.add(modifier)
        findings.push({
          code: 'INDEFINITE_MODIFIER',
          claimNumber: Number(claim.number),
          excerpt: excerptAround(text, modifier),
          message: `Claim ${claim.number} uses "${modifier}" with no numeric threshold in the same clause.`,
        })
      }
    }
  }
  return findings
}

/**
 * Inventor vocabulary that has no recognised meaning in the art.
 *
 * Three signals, all conservative: alphanumeric code names (Pep-B2, ABE8e),
 * capitalised multi-word labels appearing mid-sentence, and exact matches of
 * component names that themselves look coined.
 */
export function findSourceJargon(
  claims: DraftClaim[],
  context: ClaimChallengeLintContext = {}
): ChallengeLintFinding[] {
  const findings: ChallengeLintFinding[] = []

  const coinedComponents = (Array.isArray(context.components) ? context.components : [])
    .map((component: any) => (typeof component?.name === 'string' ? component.name.trim() : ''))
    .filter(name => name.length > 2 && looksCoined(name))

  for (const claim of claims) {
    const text = String(claim?.text || '')
    if (!text) continue
    const reported = new Set<string>()
    // Every dependent claim says "of claim 1". Scanning that would report the
    // dependency reference as a coined code name in every claim but the first.
    const scannable = text.replace(/\bclaims?\s+\d+(?:\s*(?:[-,]|to|and|or)\s*\d+)*/gi, ' ')

    // Alphanumeric code names: a letter run welded to digits, hyphenated or
    // concatenated. A space between the letters and the digits is not a code
    // name, it is a word followed by a quantity.
    const codeNames = scannable.match(/\b[A-Za-z]{2,}-?[A-Za-z]?\d+[a-z]?\b/g) || []
    for (const code of codeNames) {
      const token = code.trim()
      const key = token.toLowerCase()
      if (reported.has(key)) continue
      // A bare unit quantity ("5 mm", "20 mg") is not a code name.
      if (/^\d+$/.test(token)) continue
      reported.add(key)
      findings.push({
        code: 'SOURCE_JARGON',
        claimNumber: Number(claim.number),
        excerpt: excerptAround(text, token),
        message: `Claim ${claim.number} recites "${token}", which reads as an internal code rather than an art-recognised term.`,
      })
    }

    // Capitalised labels appearing after the first word of the claim body.
    const body = scannable.replace(/^\s*(?:A|An|The)\b\s*/i, '')
    const capitalised = body.match(/\b(?:[A-Z][a-z]{2,}\s){1,2}[A-Z][a-z]{2,}\b/g) || []
    for (const label of capitalised) {
      const token = label.trim()
      const key = token.toLowerCase()
      if (reported.has(key)) continue
      reported.add(key)
      findings.push({
        code: 'SOURCE_JARGON',
        claimNumber: Number(claim.number),
        excerpt: excerptAround(text, token),
        message: `Claim ${claim.number} recites the capitalised label "${token}", which reads as an internal project name.`,
      })
    }

    for (const name of coinedComponents) {
      const key = name.toLowerCase()
      if (reported.has(key)) continue
      if (!new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) continue
      reported.add(key)
      findings.push({
        code: 'SOURCE_JARGON',
        claimNumber: Number(claim.number),
        excerpt: excerptAround(text, name),
        message: `Claim ${claim.number} reuses the inventor's own label "${name}" verbatim.`,
      })
    }
  }

  return findings
}

function looksCoined(name: string): boolean {
  if (/\d/.test(name)) return true
  if (/[A-Z]{2,}/.test(name)) return true
  if (/[a-z][A-Z]/.test(name)) return true
  if (/-/.test(name) && /[A-Z]/.test(name)) return true
  return false
}

/**
 * Claim 1 carrying species detail that a dependent also narrows, or holding the
 * claim set's only numeric range.
 *
 * Both are proxies for the same defect: the independent claim was written at
 * embodiment level, so the ladder below it adds nothing a competitor must clear.
 */
export function findPictureClaim1(claims: DraftClaim[]): ChallengeLintFinding[] {
  const findings: ChallengeLintFinding[] = []
  const claimOne = claims.find(claim => Number(claim?.number) === 1)
  if (!claimOne) return findings

  const claimOneText = String(claimOne.text || '')
  if (!claimOneText) return findings

  const dependents = claims.filter(claim => Number(claim?.number) !== 1)

  // A term that Claim 1 recites and a dependent narrows again is species detail
  // that belongs one rung down.
  const claimOneTerms = new Set(
    (claimOneText.toLowerCase().match(/\b[a-z][a-z-]{3,}\b/g) || []).filter(term => !CLAIM_BOILERPLATE.has(term))
  )
  const reported = new Set<string>()
  for (const dependent of dependents) {
    const dependentText = String(dependent.text || '').toLowerCase()
    // "wherein the X is Y" — X already in Claim 1 means the dependent re-narrows it.
    const narrowed = dependentText.match(/\bwherein\s+(?:the|said)\s+([a-z][a-z\s-]{2,40}?)\s+(?:is|comprises|consists|includes)\b/g) || []
    for (const phrase of narrowed) {
      const subject = phrase
        .replace(/^\bwherein\s+(?:the|said)\s+/, '')
        .replace(/\s+(?:is|comprises|consists|includes)\b.*$/, '')
        .trim()
      const head = subject.split(/\s+/).filter(word => !CLAIM_BOILERPLATE.has(word)).pop() || ''
      if (!head || head.length < 4) continue
      if (!claimOneTerms.has(head)) continue
      if (reported.has(head)) continue
      reported.add(head)
      findings.push({
        code: 'PICTURE_CLAIM_1',
        claimNumber: 1,
        excerpt: excerptAround(claimOneText, head),
        message: `Claim 1 recites "${head}", which claim ${dependent.number} narrows again — check whether Claim 1 should recite the broader class instead.`,
      })
    }
  }

  // Claim 1 holding the set's only numeric limitation. Dependency references
  // ("of claim 1") are stripped first, or every dependent would look numeric.
  const numericInClaimOne = hasNumericAnchor(claimOneText)
  const numericElsewhere = dependents.some(claim => hasNumericAnchor(String(claim.text || '')))
  if (numericInClaimOne && !numericElsewhere && dependents.length > 0) {
    const value = (stripNonQuantityDigits(claimOneText).match(/\b\d[\d.,]*\s*[a-zA-Z%°]*\b/) || [''])[0]
    findings.push({
      code: 'PICTURE_CLAIM_1',
      claimNumber: 1,
      excerpt: excerptAround(claimOneText, value || claimOneText.slice(0, 30)),
      message: `Claim 1 carries the claim set's only numeric limitation${value ? ` ("${value.trim()}")` : ''}; no dependent claim narrows further.`,
    })
  }

  return findings
}

/**
 * Biological sequence strings fused with chemical modifications.
 *
 * WIPO ST.26 treats sequences and chemical conjugations as separate matter; a
 * hyphenated run mixing both is rejected at the sequence desk.
 */
export function findSequenceConflation(claims: DraftClaim[]): ChallengeLintFinding[] {
  const findings: ChallengeLintFinding[] = []
  for (const claim of claims) {
    const text = String(claim?.text || '')
    if (!text) continue
    // Hyphenated runs of at least two segments.
    const runs = text.match(/\b[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+\b/g) || []
    const reported = new Set<string>()
    for (const run of runs) {
      const segments = run.split('-')
      const hasResidueRun = segments.some(segment =>
        (/^[ACDEFGHIKLMNPQRSTVWY]{4,}$/.test(segment) || /^[ACGTU]{6,}$/i.test(segment))
      )
      if (!hasResidueRun) continue
      const chemical = segments.find(segment =>
        CHEMICAL_MOIETY_TOKENS.some(token => segment.toLowerCase().startsWith(token))
      )
      if (!chemical) continue
      const key = run.toLowerCase()
      if (reported.has(key)) continue
      reported.add(key)
      findings.push({
        code: 'SEQUENCE_CONFLATION',
        claimNumber: Number(claim.number),
        excerpt: excerptAround(text, run),
        message: `Claim ${claim.number} embeds the chemical moiety "${chemical}" inside the sequence string "${run}"; recite the sequence and the conjugation as separate limitations.`,
      })
    }
  }
  return findings
}

/**
 * Outcome language inside a static claim.
 *
 * A result recited in an apparatus or composition claim draws no patentable
 * weight against the prior art, so it costs scope without buying anything.
 */
export function findFunctionalResultStatic(claims: DraftClaim[]): ChallengeLintFinding[] {
  const findings: ChallengeLintFinding[] = []
  for (const claim of claims) {
    const category = claimCategory(claim)
    if (category && !STATIC_CATEGORIES.has(category)) continue
    // Without a category we can still catch the obvious static preambles.
    if (!category && !/^\s*(?:a|an|the)\s+[^.]*\b(?:apparatus|system|device|composition|product|assembly|formulation)\b/i.test(String(claim?.text || ''))) {
      continue
    }

    const text = String(claim?.text || '')
    if (!text) continue
    const reported = new Set<string>()
    for (const clause of clauses(text)) {
      if (CAPABILITY_ANCHORS.test(clause)) continue
      for (const verb of RESULT_VERBS) {
        const pattern = new RegExp(`\\b${verb}\\b`, 'i')
        if (!pattern.test(clause)) continue
        if (reported.has(verb)) continue
        reported.add(verb)
        findings.push({
          code: 'FUNCTIONAL_RESULT_STATIC',
          claimNumber: Number(claim.number),
          excerpt: excerptAround(text, verb),
          message: `Claim ${claim.number} is a static claim but recites the result "${verb}" without a "configured to" style structural anchor.`,
        })
      }
    }
  }
  return findings
}

// ---------------------------------------------------------------------------
// Claim form checks
// ---------------------------------------------------------------------------

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Words that make a limitation optional, and so leave its scope undecided. */
const OPTIONAL_PHRASES = [
  'optionally',
  'preferably',
  'such as',
  'for example',
  'for instance',
  'e.g.',
  'i.e.',
  'may be',
  'can be',
  'if desired',
  'in some embodiments',
  'in one embodiment',
  'in an embodiment',
  'or the like',
  'and the like',
  'etc.',
]

/** Optional or exemplary language inside a claim. */
export function findOptionalLanguage(claims: DraftClaim[]): ChallengeLintFinding[] {
  const findings: ChallengeLintFinding[] = []
  for (const claim of claims) {
    const text = String(claim?.text || '')
    if (!text) continue
    for (const phrase of OPTIONAL_PHRASES) {
      const pattern = new RegExp(`(?:^|[^a-z])${escapeRegExp(phrase)}(?![a-z])`, 'i')
      if (!pattern.test(text)) continue
      findings.push({
        code: 'OPTIONAL_LANGUAGE',
        claimNumber: Number(claim.number),
        excerpt: excerptAround(text, phrase),
        message: `Claim ${claim.number} uses "${phrase}", which leaves the limitation optional and the claim's scope undecided.`,
      })
    }
  }
  return findings
}

/** Well-known marks that drafters reach for as if they were generic materials. */
const TRADEMARK_NAMES = [
  'Teflon', 'Velcro', 'Kevlar', 'Plexiglas', 'Plexiglass', 'Styrofoam', 'Lycra', 'Tyvek',
  'Gore-Tex', 'Scotch-Brite', 'Formica', 'Mylar', 'Lexan', 'Bakelite', 'Freon', 'Lucite', 'Nomex', 'Dacron',
]

/** A trademark identifies a source, not a composition, so it cannot define a limitation. */
export function findTrademarks(claims: DraftClaim[]): ChallengeLintFinding[] {
  const findings: ChallengeLintFinding[] = []
  for (const claim of claims) {
    const text = String(claim?.text || '')
    if (!text) continue
    const reported = new Set<string>()
    const symbol = /([A-Za-z][A-Za-z0-9-]*)\s?[®™]/g
    let match: RegExpExecArray | null
    while ((match = symbol.exec(text))) {
      const name = match[1]
      if (reported.has(name.toLowerCase())) continue
      reported.add(name.toLowerCase())
      findings.push({
        code: 'TRADEMARK',
        claimNumber: Number(claim.number),
        excerpt: excerptAround(text, name),
        message: `Claim ${claim.number} recites the trademark "${name}"; a mark identifies a source, not a composition or structure, so the limitation is indefinite. Recite the generic material or structure.`,
      })
    }
    for (const name of TRADEMARK_NAMES) {
      if (reported.has(name.toLowerCase())) continue
      if (!new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(text)) continue
      reported.add(name.toLowerCase())
      findings.push({
        code: 'TRADEMARK',
        claimNumber: Number(claim.number),
        excerpt: excerptAround(text, name),
        message: `Claim ${claim.number} recites "${name}", a trademark; a mark identifies a source, not a composition or structure, so the limitation is indefinite. Recite the generic material or structure.`,
      })
    }
  }
  return findings
}

const OMNIBUS_PATTERNS: Array<[RegExp, string]> = [
  [/\bas\s+(?:described|disclosed|shown|illustrated|depicted|set\s+forth)\b(?!\s+in\s+claims?\b)/i, 'as described or shown'],
  [/\bherein\b/i, 'herein'],
  [/\b(?:in|to)\s+(?:the\s+)?(?:accompanying\s+)?(?:figures?|drawings?|specification|description)\b/i, 'the figures or description'],
  [/\bfigs?\.\s*\d/i, 'Fig.'],
  [/\bwith\s+reference\s+to\b/i, 'with reference to'],
]

/** Omnibus references import the description or drawings into a claim. */
export function findOmnibusReferences(claims: DraftClaim[]): ChallengeLintFinding[] {
  const findings: ChallengeLintFinding[] = []
  for (const claim of claims) {
    const text = String(claim?.text || '')
    if (!text) continue
    for (const [pattern, label] of OMNIBUS_PATTERNS) {
      const match = pattern.exec(text)
      if (!match) continue
      findings.push({
        code: 'OMNIBUS_REFERENCE',
        claimNumber: Number(claim.number),
        excerpt: excerptAround(text, match[0]),
        message: `Claim ${claim.number} refers to the description or drawings ("${label}"); a claim must define the invention in its own words and such omnibus references are objectionable.`,
      })
      break
    }
  }
  return findings
}

/** Tokens before a period that end an abbreviation rather than a sentence. */
const ABBREVIATION_BEFORE_PERIOD = /(?:\b(?:e\.g|i\.e|no|nos|fig|figs|approx|vs|dr|mr|mrs|ms|inc|ltd|co|st|al|etc|cf|ca|min|max|sec|wt|vol|mol)|\b[a-z])\.$/i

/** A claim must be a single sentence. */
export function findMultiSentenceClaims(claims: DraftClaim[]): ChallengeLintFinding[] {
  const findings: ChallengeLintFinding[] = []
  for (const claim of claims) {
    const text = String(claim?.text || '').trim()
    if (!text) continue
    const boundary = /\.\s+(?=[A-Z])/g
    let match: RegExpExecArray | null
    let breaks = 0
    let firstBreak = ''
    while ((match = boundary.exec(text))) {
      const before = text.slice(0, match.index + 1)
      if (ABBREVIATION_BEFORE_PERIOD.test(before)) continue
      breaks += 1
      if (!firstBreak) firstBreak = text.slice(Math.max(0, match.index - 20), match.index + 1)
    }
    if (breaks === 0) continue
    findings.push({
      code: 'MULTI_SENTENCE',
      claimNumber: Number(claim.number),
      excerpt: excerptAround(text, firstBreak.trim() || text.slice(0, 30)),
      message: `Claim ${claim.number} contains more than one sentence; a claim must be a single sentence ending in a period.`,
    })
  }
  return findings
}

/** "and/or" is ambiguous in scope; "at least one of" is the accepted form. */
export function findAndOr(claims: DraftClaim[]): ChallengeLintFinding[] {
  const findings: ChallengeLintFinding[] = []
  for (const claim of claims) {
    const text = String(claim?.text || '')
    if (!/\band\/or\b/i.test(text)) continue
    findings.push({
      code: 'AND_OR',
      claimNumber: Number(claim.number),
      excerpt: excerptAround(text, 'and/or'),
      message: `Claim ${claim.number} uses "and/or"; recite "at least one of A and B" (or separate the alternatives into claims) so the scope is unambiguous.`,
    })
  }
  return findings
}

const MEANS_FOR = /\b(?:means|steps?)\s+for\s+\w+ing\b/i
const NONCE_FOR = /\b(?:module|unit|mechanism|element|member|assembly|arrangement)\s+for\s+\w+ing\b/i

/** Wording that invokes means-plus-function treatment. */
export function findMeansPlusFunction(claims: DraftClaim[]): ChallengeLintFinding[] {
  const findings: ChallengeLintFinding[] = []
  for (const claim of claims) {
    const text = String(claim?.text || '')
    if (!text) continue
    const explicit = MEANS_FOR.exec(text)
    if (explicit) {
      findings.push({
        code: 'MEANS_PLUS_FUNCTION',
        claimNumber: Number(claim.number),
        excerpt: excerptAround(text, explicit[0]),
        message: `Claim ${claim.number} recites "${explicit[0]}", which invokes means-plus-function treatment: confirm the description discloses the corresponding structure, or recite that structure in the claim.`,
      })
      continue
    }
    const nonce = NONCE_FOR.exec(text)
    if (nonce) {
      findings.push({
        code: 'MEANS_PLUS_FUNCTION',
        claimNumber: Number(claim.number),
        excerpt: excerptAround(text, nonce[0]),
        message: `Claim ${claim.number} recites "${nonce[0]}", a generic placeholder plus a function that may be read as a means-plus-function limitation with no structure; recite the structure that performs the function.`,
      })
    }
  }
  return findings
}

/**
 * Claim numbers a claim's text depends from, with a flag for multiple
 * dependency ("claim 1 or 2", "any of claims 1 to 3", "any preceding claim").
 */
export function referencedClaimNumbers(
  text: string,
  ownNumber: number,
  allNumbers: number[]
): { refs: number[]; multiple: boolean } {
  const lower = String(text || '').toLowerCase()
  const refs = new Set<number>()
  let multiple = false

  if (/\b(?:preceding|previous|foregoing)\s+claims\b/.test(lower)) {
    allNumbers.filter(number => number < ownNumber).forEach(number => refs.add(number))
    multiple = true
  } else if (/\bthe\s+(?:preceding|previous|foregoing)\s+claim\b/.test(lower)) {
    refs.add(ownNumber - 1)
  }

  const pattern = /\bclaims?\s+(\d{1,3}(?:\s*(?:-|–|to|through)\s*\d{1,3})?(?:\s*,?\s*(?:,|or|and)\s*\d{1,3}(?:\s*(?:-|–|to|through)\s*\d{1,3})?)*)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(lower))) {
    const segments = match[1].split(/\s*(?:,|\bor\b|\band\b)\s*/).filter(Boolean)
    for (const segment of segments) {
      const range = /^(\d+)\s*(?:-|–|to|through)\s*(\d+)$/.exec(segment)
      if (range) {
        const low = Math.min(Number(range[1]), Number(range[2]))
        const high = Math.max(Number(range[1]), Number(range[2]))
        for (let number = low; number <= high && number - low < 200; number++) refs.add(number)
      } else {
        const number = Number(segment)
        if (Number.isFinite(number)) refs.add(number)
      }
    }
    if (segments.length > 1 || /(?:-|–|to|through)/.test(match[1])) multiple = true
  }

  return { refs: Array.from(refs).sort((a, b) => a - b), multiple: multiple || refs.size > 1 }
}

/** Dependencies that point forward, at nothing, or at another multiple dependent claim. */
export function findImproperDependencies(claims: DraftClaim[]): ChallengeLintFinding[] {
  const findings: ChallengeLintFinding[] = []
  const numbers = claims.map(claim => Number(claim?.number)).filter(number => Number.isFinite(number))
  const exists = new Set(numbers)

  const parsed = claims.map(claim => ({
    claim,
    number: Number(claim?.number),
    ...referencedClaimNumbers(String(claim?.text || ''), Number(claim?.number), numbers),
  }))
  const multipleDependents = new Set(parsed.filter(entry => entry.multiple).map(entry => entry.number))

  for (const entry of parsed) {
    const text = String(entry.claim?.text || '')
    const recorded = Number(entry.claim?.dependsOn)

    if (entry.refs.length === 0) {
      if (entry.claim?.type === 'dependent' && Number.isFinite(recorded) && recorded > 0) {
        findings.push({
          code: 'IMPROPER_DEPENDENCY',
          claimNumber: entry.number,
          excerpt: text.slice(0, 60).trim(),
          message: `Claim ${entry.number} is recorded as depending on claim ${recorded}, but its text does not refer to any claim.`,
        })
      }
      continue
    }

    const forward = entry.refs.find(ref => ref >= entry.number)
    const missing = entry.refs.find(ref => ref < entry.number && !exists.has(ref))
    if (forward !== undefined) {
      findings.push({
        code: 'IMPROPER_DEPENDENCY',
        claimNumber: entry.number,
        excerpt: excerptAround(text, `claim ${forward}`),
        message: `Claim ${entry.number} refers to claim ${forward}, which is not an earlier claim; a dependent claim may only refer back.`,
      })
    } else if (missing !== undefined) {
      findings.push({
        code: 'IMPROPER_DEPENDENCY',
        claimNumber: entry.number,
        excerpt: excerptAround(text, `claim ${missing}`),
        message: `Claim ${entry.number} refers to claim ${missing}, which does not exist in the set.`,
      })
    } else if (Number.isFinite(recorded) && recorded > 0 && entry.refs.length === 1 && entry.refs[0] !== recorded) {
      findings.push({
        code: 'IMPROPER_DEPENDENCY',
        claimNumber: entry.number,
        excerpt: excerptAround(text, `claim ${entry.refs[0]}`),
        message: `Claim ${entry.number} is recorded as depending on claim ${recorded}, but its text refers to claim ${entry.refs[0]}.`,
      })
    }

    if (entry.multiple) {
      const chained = entry.refs.filter(ref => multipleDependents.has(ref))
      if (chained.length > 0) {
        findings.push({
          code: 'MULTIPLE_DEPENDENT_CHAIN',
          claimNumber: entry.number,
          excerpt: excerptAround(text, `claim ${chained[0]}`),
          message: `Claim ${entry.number} depends on more than one claim and includes claim ${chained[0]}, which is itself a multiple dependent claim; a multiple dependent claim may not serve as a basis for another (US practice) and attracts fees or objections elsewhere.`,
        })
      }
    }
  }
  return findings
}

/** Two claims with the same words claim the same thing twice. */
export function findDuplicateClaims(claims: DraftClaim[]): ChallengeLintFinding[] {
  const findings: ChallengeLintFinding[] = []
  const seen = new Map<string, number>()
  for (const claim of claims) {
    const text = String(claim?.text || '')
    const key = text.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!key) continue
    const earlier = seen.get(key)
    if (earlier !== undefined) {
      findings.push({
        code: 'DUPLICATE_CLAIM',
        claimNumber: Number(claim.number),
        excerpt: text.slice(0, 60).trim(),
        message: `Claim ${claim.number} duplicates claim ${earlier} word for word.`,
      })
      continue
    }
    seen.set(key, Number(claim.number))
  }
  return findings
}

const NEGATIVE_PATTERNS = [
  /\b(?:does|do|is|are)\s+not\b/i,
  /\bnot\s+(?:comprising|including|containing|having)\b/i,
  /\bfree\s+(?:of|from)\b/i,
  /\bdevoid\s+of\b/i,
  /\bwithout\b/i,
  /\bexcluding\b/i,
  /\bother\s+than\b/i,
  /\babsent\b/i,
  /\bexcept\b/i,
]

/** A negative limitation needs basis in the disclosure for the exclusion. */
export function findNegativeLimitations(claims: DraftClaim[]): ChallengeLintFinding[] {
  const findings: ChallengeLintFinding[] = []
  for (const claim of claims) {
    const text = String(claim?.text || '')
    if (!text) continue
    for (const pattern of NEGATIVE_PATTERNS) {
      const match = pattern.exec(text)
      if (!match) continue
      findings.push({
        code: 'NEGATIVE_LIMITATION',
        claimNumber: Number(claim.number),
        excerpt: excerptAround(text, match[0]),
        message: `Claim ${claim.number} recites the negative limitation "${match[0]}"; confirm the source gives a basis for the exclusion, since a negative limitation without one is unsupported.`,
      })
      break
    }
  }
  return findings
}

/** Runs every deterministic check over a claim set. */
export function runClaimChallengeLint(
  claims: DraftClaim[] | null | undefined,
  context: ClaimChallengeLintContext = {}
): ChallengeLintFinding[] {
  const list = Array.isArray(claims) ? claims.filter(claim => claim && Number.isFinite(Number(claim.number))) : []
  if (!list.length) return []
  return [
    ...findIndefiniteModifiers(list),
    ...findSourceJargon(list, context),
    ...findPictureClaim1(list),
    ...findSequenceConflation(list),
    ...findFunctionalResultStatic(list),
    ...findOptionalLanguage(list),
    ...findTrademarks(list),
    ...findOmnibusReferences(list),
    ...findMultiSentenceClaims(list),
    ...findAndOr(list),
    ...findMeansPlusFunction(list),
    ...findImproperDependencies(list),
    ...findDuplicateClaims(list),
    ...findNegativeLimitations(list),
  ]
}
