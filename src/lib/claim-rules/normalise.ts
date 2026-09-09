// Deterministic claim-set normaliser.
//
// Fixes what a regex can fix without an LLM and without touching the technical
// substance of a claim: numbering, dependency order, in-text claim references,
// duplicate claims, the office's dependent-claim phrasing, a dependent claim's
// preamble noun, closed Markush wording, "non-transitory" for US medium claims,
// the house spelling of "characterised", capitalisation and the terminal
// period. Every change is recorded so the version note and the report can say
// exactly what was touched.
//
// Idempotent: normalising an already-normal set returns it unchanged. Text
// rewrites apply to English claim sets only; pt-BR and ru sets get numbering
// and dependency repair, nothing else.

import type { DraftClaim } from '@/lib/draft-claims-parser'
import { dependencyFromClaimText, inferClaimCategory, stripTrailingClaimDependencyLabel } from '@/lib/draft-claims-parser'
import { referencedClaimNumbers } from '@/lib/claim-challenge-lint'
import type { ClaimNormalisationChange, ClaimRuleProfile } from './types'
import { preambleNounPhrase } from './office-form-lint'

export type NormaliseClaimSetResult = {
  claims: DraftClaim[]
  changes: ClaimNormalisationChange[]
}

const GENERIC_DEPENDENT_NOUNS = new Set([
  'device', 'apparatus', 'system', 'method', 'process', 'composition', 'product', 'invention', 'assembly',
  'article', 'kit', 'medium', 'compound', 'formulation', 'arrangement', 'unit', 'machine',
])

const DEPENDENT_OPENING = /^(\s*)(the|said|a|an)(\s+)([^.;,:]{1,80}?)(\s+)(of|according\s+to|as\s+(?:claimed|recited|defined|described|set\s+forth)\s+in|as\s+in)(\s+)((?:any\s+(?:one\s+)?of\s+)?(?:the\s+)?(?:preceding\s+)?claims?\s+\d+(?:\s*(?:-|–|to|through)\s*\d+)?(?:\s*,?\s*(?:,|or|and)\s*\d+(?:\s*(?:-|–|to|through)\s*\d+)?)*)/i

const CLAIM_REFERENCE = /\b(claims?)(\s+)(\d{1,3}(?:\s*(?:-|–|to|through)\s*\d{1,3})?(?:\s*,?\s*(?:,|or|and)\s*\d{1,3}(?:\s*(?:-|–|to|through)\s*\d{1,3})?)*)/gi

function cleanText(text: string): string {
  return stripTrailingClaimDependencyLabel(
    String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function singularHead(phrase: string): string {
  const head = phrase.trim().toLowerCase().split(/\s+/).pop() || ''
  if (/ies$/.test(head)) return head.replace(/ies$/, 'y')
  if (/(ss|us|is)$/.test(head)) return head
  return head.replace(/s$/, '')
}

function nounCovered(dependentNoun: string, parentNoun: string): boolean {
  const left = dependentNoun.trim().toLowerCase()
  const right = parentNoun.trim().toLowerCase()
  if (!left || !right) return true
  if (right.includes(left) || left.includes(right)) return true
  return singularHead(left) === singularHead(right)
}

function connectorFor(rules: ClaimRuleProfile): string {
  switch (rules.dependentClaimPhrase) {
    case 'of':
      return 'of'
    case 'as_claimed_in':
      return 'as claimed in'
    default:
      return 'according to'
  }
}

/**
 * Rewrites every "claim N" / "claims N to M" reference in a claim through a
 * number map. Numbers outside the map are left alone.
 */
export function renumberClaimReferences(text: string, map: Map<number, number>): string {
  return String(text || '').replace(CLAIM_REFERENCE, (whole, word: string, space: string, refs: string) => {
    const rewritten = refs.replace(/\d{1,3}/g, (digits) => {
      const mapped = map.get(Number(digits))
      return mapped === undefined ? digits : String(mapped)
    })
    return `${word}${space}${rewritten}`
  })
}

/** Orders claims so every claim appears after each claim it refers to. */
function orderByDependency(claims: DraftClaim[]): DraftClaim[] {
  const ordered = [...claims].sort((a, b) => Number(a.number) - Number(b.number))
  const numbers = ordered.map(claim => Number(claim.number))
  for (let pass = 0; pass < ordered.length; pass++) {
    let moved = false
    for (let index = 0; index < ordered.length; index++) {
      const claim = ordered[index]
      const { refs } = referencedClaimNumbers(claim.text, Number(claim.number), numbers)
      const referenced = refs.filter(ref => ref !== Number(claim.number) && numbers.includes(ref))
      if (!referenced.length) continue
      const lastRefIndex = Math.max(...referenced.map(ref => ordered.findIndex(candidate => Number(candidate.number) === ref)))
      if (lastRefIndex > index) {
        ordered.splice(index, 1)
        ordered.splice(lastRefIndex, 0, claim)
        moved = true
        break
      }
    }
    if (!moved) break
  }
  return ordered
}

export function normaliseClaimSet(claims: DraftClaim[] | null | undefined, rules: ClaimRuleProfile): NormaliseClaimSetResult {
  const changes: ClaimNormalisationChange[] = []
  const input = (Array.isArray(claims) ? claims : [])
    .filter(claim => claim && Number.isFinite(Number(claim.number)))
    .map(claim => ({ ...claim, number: Number(claim.number), text: cleanText(claim.text) }))
    .filter(claim => claim.text.length > 0)
  if (!input.length) return { claims: [], changes }

  const english = rules.language === 'en'

  // 1. Drop exact duplicates; later references to a dropped claim point at the survivor.
  const seen = new Map<string, number>()
  const duplicateMap = new Map<number, number>()
  const deduped: DraftClaim[] = []
  for (const claim of input) {
    const key = claim.text.toLowerCase()
    const survivor = seen.get(key)
    if (survivor !== undefined) {
      duplicateMap.set(claim.number, survivor)
      changes.push({ claimNumber: claim.number, code: 'DUPLICATE_CLAIM', before: claim.text, after: '' })
      continue
    }
    seen.set(key, claim.number)
    deduped.push(claim)
  }
  const afterDedupe = duplicateMap.size
    ? deduped.map(claim => ({ ...claim, text: renumberClaimReferences(claim.text, duplicateMap) }))
    : deduped

  // 2. Order by dependency, then renumber consecutively and rewrite references.
  const ordered = orderByDependency(afterDedupe)
  const numberMap = new Map<number, number>()
  ordered.forEach((claim, index) => numberMap.set(claim.number, index + 1))
  const renumbered = ordered.map((claim) => {
    const number = numberMap.get(claim.number) || claim.number
    const text = renumberClaimReferences(claim.text, numberMap)
    if (number !== claim.number) {
      changes.push({ claimNumber: number, code: 'NUMBERING_GAP', before: `${claim.number}. ${claim.text}`, after: `${number}. ${text}` })
    } else if (text !== claim.text) {
      changes.push({ claimNumber: number, code: 'NUMBERING_GAP', before: claim.text, after: text })
    }
    return { ...claim, number, text }
  })

  // 3. Text rewrites (English only).
  const output = renumbered.map((claim) => {
    let text = claim.text
    const record = (code: string, before: string, after: string) => {
      if (before !== after) changes.push({ claimNumber: claim.number, code, before, after })
    }

    if (english) {
      // Dependent-claim phrasing and preamble noun.
      // "A medium ... for performing the method of claim 1" incorporates claim 1 by
      // reference inside an independent claim; only "The/Said X of claim N" is a
      // dependent opening in the of-form (the parser draws the same line).
      const openingMatch = DEPENDENT_OPENING.exec(text)
      const opening = openingMatch && !(/^(a|an)$/i.test(openingMatch[2]) && /^of$/i.test(openingMatch[6]))
        ? openingMatch
        : null
      if (opening) {
        const [, lead, article, gap1, noun, gap2, connector, gap3, refs] = opening
        let nextArticle = article
        let nextNoun = noun
        let nextConnector = connector.replace(/\s+/g, ' ').toLowerCase()
        let nextRefs = refs

        const target = connectorFor(rules)
        if (nextConnector !== target) nextConnector = target
        if ((rules.dependentClaimPhrase === 'of' || rules.dependentClaimPhrase === 'as_claimed_in') && /^(a|an)$/i.test(article)) {
          nextArticle = 'The'
        }
        if (rules.multipleDependencyMode === 'alternative_only' && /\band\b/i.test(nextRefs)) {
          nextRefs = nextRefs.replace(/\band\b/gi, 'or')
        }

        const parentNumber = dependencyFromClaimText(text)
        const parent = parentNumber !== undefined ? renumbered.find(candidate => candidate.number === parentNumber) : undefined
        if (parent && parent.number !== claim.number) {
          const parentNoun = preambleNounPhrase(parent.text)
          const head = singularHead(noun)
          if (parentNoun && GENERIC_DEPENDENT_NOUNS.has(head) && !nounCovered(noun, parentNoun)) {
            nextNoun = parentNoun
          }
        }

        const before = text
        const rebuilt = `${lead}${nextArticle}${gap1}${nextNoun}${gap2}${nextConnector}${gap3}${nextRefs}`
        text = rebuilt + text.slice(opening[0].length)
        if (nextNoun !== noun) record('PREAMBLE_NOUN_MISMATCH', before, text)
        else if (nextRefs !== refs) record('MULTIPLE_DEPENDENCY_FORM', before, text)
        else record('DEPENDENT_PHRASE_FORM', before, text)
      }

      // Closed Markush groups.
      const markush = text.replace(/\bgroup\s+(?:comprising|including|consisting\s+essentially\s+of)\b/gi, 'group consisting of')
      record('MARKUSH_OPEN_GROUP', text, markush)
      text = markush

      // US medium claims must be non-transitory.
      if (rules.crmClaimForm === 'non_transitory_medium' && inferClaimCategory(text) === 'medium' && !/\bnon-transitory\b/i.test(text)) {
        const patched = /\b(computer|machine|processor)[- ]readable\b/i.test(text)
          ? text.replace(/\b(computer|machine|processor)[- ]readable\b/i, match => `non-transitory ${match}`)
          : text.replace(/\bstorage\s+medium\b/i, match => `non-transitory ${match}`)
        record('CRM_NOT_NON_TRANSITORY', text, patched)
        text = patched
      }

      // House spelling.
      const spelled = text.replace(/characteri(s|z)(ed|ing|es)\b/gi, (_match, _letter: string, ending: string) => `characteri${rules.characterisedSpelling}${ending}`)
      record('CHARACTERISED_SPELLING', text, spelled)
      text = spelled

      // Opening capital.
      if (/^[a-z]/.test(text)) {
        const capitalised = text[0].toUpperCase() + text.slice(1)
        record('OPENING_ARTICLE', text, capitalised)
        text = capitalised
      }
    }

    // Single terminal period (all languages).
    const trimmed = text.replace(/[\s;,:]+$/, '')
    const terminated = /[.。]$/.test(trimmed) ? trimmed : `${trimmed}.`
    record('TRAILING_PERIOD', text, terminated)
    text = terminated

    // Re-derive structure from the (possibly rewritten) text.
    const dependsOn = dependencyFromClaimText(text)
    const type: DraftClaim['type'] = dependsOn !== undefined
      ? 'dependent'
      : /^\s*(?:the|said)\s+/i.test(text) ? 'dependent' : 'independent'
    const category = inferClaimCategory(text) || claim.category

    return {
      ...claim,
      text,
      type,
      ...(type === 'dependent' && dependsOn !== undefined ? { dependsOn } : {}),
      ...(type === 'independent' ? { dependsOn: undefined } : {}),
      category,
    } as DraftClaim
  })

  // Strip undefined dependsOn so stored JSON stays tidy.
  const claimsOut = output.map((claim) => {
    const next: DraftClaim = { number: claim.number, type: claim.type, text: claim.text }
    if (claim.dependsOn !== undefined) next.dependsOn = claim.dependsOn
    if (claim.category) next.category = claim.category
    return next
  })

  return { claims: claimsOut, changes }
}

/** One-line summary of the normalisation for a version note. */
export function summariseNormalisation(changes: ClaimNormalisationChange[]): string {
  if (!changes.length) return ''
  const counts = new Map<string, number>()
  for (const change of changes) counts.set(change.code, (counts.get(change.code) || 0) + 1)
  const labels: Record<string, string> = {
    DUPLICATE_CLAIM: 'duplicate claim removed',
    NUMBERING_GAP: 'claim renumbered',
    DEPENDENT_PHRASE_FORM: 'dependent-claim phrasing aligned',
    MULTIPLE_DEPENDENCY_FORM: 'multiple dependency put in the alternative',
    PREAMBLE_NOUN_MISMATCH: 'dependent preamble matched to its parent',
    MARKUSH_OPEN_GROUP: 'Markush group closed',
    CRM_NOT_NON_TRANSITORY: '"non-transitory" inserted',
    CHARACTERISED_SPELLING: 'spelling aligned',
    OPENING_ARTICLE: 'capitalised',
    TRAILING_PERIOD: 'terminal period added',
  }
  return Array.from(counts.entries())
    .map(([code, count]) => `${count} ${labels[code] || code.toLowerCase().replace(/_/g, ' ')}${count > 1 && labels[code] ? 's' : ''}`)
    .join('; ')
}
