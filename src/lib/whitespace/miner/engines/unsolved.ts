/**
 * Invention Miner — engine (i): problems the field admits and does not answer.
 *
 * This file decides the single most consequential number the product prints.
 * Everything in it exists because of one arithmetic fact:
 *
 *     unsolved = 1 − addressing / admitting
 *
 * Every family that answers the problem and is MISSED pushes that number
 * towards 1.0. A test with a high false-negative rate therefore does not make
 * the engine "conservative", it makes it CONFIDENTLY WRONG — it manufactures
 * openings out of its own blind spots, and the more it misses the better the
 * lead looks.
 *
 * THE ADDRESSING TEST IS A UNION, AND THAT IS THE WHOLE POINT.
 *
 *   (a) LEXICAL: some MECHANISM statement or claimed-scope element of the
 *       family contains the problem object's head noun.
 *   (b) VECTOR: the family's nearest MECHANISM statement to the component's
 *       medoid falls within the same cut that formed the component.
 *
 * Lexical alone fails BY CONSTRUCTION, not occasionally. Patent drafting names
 * the problem in the background and the solution in the embodiments, and the
 * two share no vocabulary on purpose: a mechanism answering "burst release"
 * is written "swellable crosslinked matrix", a mechanism answering "cold start"
 * is written "content-based feature backfill". Neither contains the other's
 * head noun. Run lexical-only over a labelled set and the misses are not
 * scattered — they are exactly the families that solved the problem WELL
 * enough to have their own vocabulary for it.
 *
 * Vector alone is not enough either: the medoid is one point, embeddings are
 * approximate, and a family that says the words is answering the problem
 * whatever the vector thinks. So: union. A family counts as addressing if
 * EITHER test fires, which can only ever LOWER the unsolved rate — the honest
 * direction for a number whose failure mode is inflation.
 *
 * BOILERPLATE IS EXCLUDED, NOT PENALISED. Every gastroretentive background
 * recites burst release; every recommender background recites cold-start.
 * Those components maximise admitting count, recency and assignee spread all
 * at once, so any ranking function puts the genre's stock complaints on top.
 * A rank penalty would only move them down the list. They are dropped, and the
 * drop is REPORTED — the user sees what was found and why it was not shown.
 *
 * Pure. The SQL and the model calls live in the stage.
 */

import { lowerWilsonBound, wilsonInterval, type WilsonInterval } from './wilson'

// ---------------------------------------------------------------------------
// Reading a problem statement
// ---------------------------------------------------------------------------

/**
 * Words that appear in a problem statement without saying what the problem is
 * ABOUT. Two groups: ordinary function words, and the technical-sounding
 * vocabulary every patent background uses regardless of field ("improve
 * efficiency", "reduce cost", "increase performance").
 *
 * Deliberately SMALL. A big stoplist starts eating real domain nouns — "device"
 * and "system" are generic in software and are the object itself in mechanics —
 * and the specificity test below refuses a medoid whose every noun is on this
 * list, so a word added here is a whole class of leads silently refused.
 */
export const GENERIC_TECHNICAL_WORDS = new Set([
  // function words
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'for', 'from', 'has', 'have',
  'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'there', 'these', 'they',
  'this', 'those', 'to', 'was', 'were', 'which', 'while', 'with', 'without', 'not', 'no', 'more', 'less',
  'such', 'said', 'when', 'than', 'then', 'also', 'may', 'can', 'must', 'should', 'would', 'could',
  // the genre's own vocabulary
  'ability', 'accuracy', 'advantage', 'amount', 'apparatus', 'approach', 'art', 'benefit', 'capability',
  'complexity', 'conventional', 'cost', 'demand', 'difficulty', 'disadvantage', 'drawback', 'effect',
  'efficiency', 'existing', 'expense', 'field', 'improvement', 'invention', 'issue', 'known', 'lack',
  'limitation', 'manner', 'means', 'method', 'need', 'object', 'objective', 'operation', 'performance',
  'possibility', 'prior', 'problem', 'process', 'product', 'quality', 'reliability', 'requirement',
  'result', 'shortcoming', 'solution', 'state', 'step', 'technique', 'technology', 'time', 'use',
  'usefulness', 'value', 'way', 'work',
  // The genre's VERBS. Without these "improve efficiency" and "reduce cost"
  // passed the specificity test on their verb, which is the exact phrase the
  // test exists to reject.
  'achieve', 'avoid', 'enhance', 'improve', 'increase', 'lower', 'maximise', 'maximize', 'minimise',
  'minimize', 'obtain', 'optimise', 'optimize', 'overcome', 'provide', 'raise', 'reduce', 'yield',
])

/** Verbs and prepositions that end the head noun phrase of a problem statement. */
const PHRASE_BREAKERS = new Set([
  'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'because', 'before',
  'behind', 'below', 'beneath', 'beside', 'between', 'beyond', 'during', 'except', 'inside', 'near',
  'onto', 'outside', 'over', 'per', 'since', 'through', 'throughout', 'toward', 'towards', 'under',
  'until', 'upon', 'via', 'within',
  // verbs a background sentence turns on
  'affect', 'affects', 'cause', 'causes', 'caused', 'exhibit', 'exhibits', 'experience', 'experiences',
  'fail', 'fails', 'lead', 'leads', 'require', 'requires', 'result', 'results', 'suffer', 'suffers',
  'suffered', 'tend', 'tends',
  // Existential and copular verbs. "There remains a need for uniform airflow"
  // is about AIRFLOW; without these it resolved to "remain".
  'remain', 'remains', 'remained', 'exist', 'exists', 'existed', 'is', 'are', 'was', 'were', 'be',
  'has', 'have', 'had', 'become', 'becomes',
  ...['for', 'from', 'in', 'into', 'of', 'on', 'to', 'with', 'without', 'at', 'by', 'as', 'that', 'which'],
])

/** Lowercase alphanumeric tokens, hyphens kept (a hyphenated term is one word). */
export function tokenise(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\- ]+/g, ' ')
    .split(/\s+/)
    .map(token => token.replace(/^-+|-+$/g, ''))
    .filter(Boolean)
}

/**
 * Crude singular form, so "releases"/"release" and "dryers"/"dryer" compare
 * equal.
 *
 * DELIBERATELY CRUDE, and its failures are known: "matrices" resolves to
 * "matrice" rather than "matrix", "gases" to "gase", "series" to "sery". A real
 * stemmer (Porter, or Postgres's own english_stem) would fix those and would
 * also conflate "sensing" with "sensor" and "coating" with "coat" — which is
 * exactly the over-merging that would make the lexical arm fire on mechanisms
 * that answer a different problem. An UNDER-matching lexical arm costs a
 * lexical hit that the vector arm still catches; an over-matching one silently
 * lowers the unsolved rate with false positives nobody can see.
 *
 * The 'ses' case is not handled at all: stripping "es" turns "releases" into
 * "releas", and a head noun that does not match its own plural is worse than
 * one that does not match an irregular form.
 */
export function singularise(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 4 && (token.endsWith('ches') || token.endsWith('shes') || token.endsWith('xes'))) {
    return token.slice(0, -2)
  }
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

/**
 * The HEAD NOUN of what the problem is about.
 *
 * English puts the head of a noun phrase last: "burst release from a
 * gastroretentive matrix" is about RELEASE, "uneven airflow in known dryers" is
 * about AIRFLOW. So: take the tokens up to the first phrase breaker, drop the
 * generic ones, and keep the last survivor.
 *
 * It is a HEURISTIC and it is wrong on sentences that open with the prior art
 * rather than the fault ("known dryers suffer from uneven airflow" resolves to
 * "dryers"). That is tolerable ONLY because the addressing test is a union: a
 * wrong head noun costs the lexical arm, and the vector arm still decides.
 * It would not be tolerable as the sole test, which is the argument this whole
 * module is built around.
 */
export function problemHeadNoun(statement: string): string | null {
  const tokens = tokenise(statement)
  const phrase: string[] = []
  for (const token of tokens) {
    if (PHRASE_BREAKERS.has(token)) {
      if (phrase.length) break
      continue
    }
    phrase.push(token)
  }
  const meaningful = phrase.filter(token => token.length > 2 && !GENERIC_TECHNICAL_WORDS.has(token))
  if (meaningful.length) return singularise(meaningful[meaningful.length - 1])

  // Nothing before the first breaker was a domain word — fall back to the whole
  // statement's last meaningful token rather than returning nothing, so a
  // statement like "there remains a need for uniform airflow" still resolves.
  const anywhere = tokens.filter(
    token => token.length > 2 && !GENERIC_TECHNICAL_WORDS.has(token) && !PHRASE_BREAKERS.has(token)
  )
  return anywhere.length ? singularise(anywhere[anywhere.length - 1]) : null
}

/**
 * The terms a whole-field lexical count searches for.
 *
 * Longest-first because a longer word is a more specific one, and the count is
 * an AND: three generic terms match half a corpus, three specific ones match
 * the genre that uses them.
 */
export function keyTerms(statement: string, max = 3): string[] {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const token of tokenise(statement)) {
    if (token.length < 4 || GENERIC_TECHNICAL_WORDS.has(token)) continue
    const key = singularise(token)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(token)
  }
  return kept.sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).slice(0, Math.max(1, max))
}

/**
 * Does this statement name anything at all, or is it "improve efficiency"?
 *
 * A component whose medoid carries no word outside the generic-technical list
 * describes no technology, so a lead built on it would read as a finding while
 * saying nothing. Rejected before ranking, not penalised in it.
 */
export function carriesDomainNoun(statement: string): boolean {
  return tokenise(statement).some(token => token.length > 3 && !GENERIC_TECHNICAL_WORDS.has(singularise(token)))
}

/**
 * A coarse class for the head noun, used ONLY by the transfer engine to refuse
 * a "transfer" between a process and a device.
 *
 * Morphological, because it has to work on any field's vocabulary with no
 * lexicon: -tion/-ing name processes, -er/-or name devices, -ity/-ness name
 * properties. It is a weak signal and it is used as a VETO, never as evidence:
 * two problems in the same class are not thereby related, but two in different
 * classes are not the same problem however close their vectors are.
 */
export type ObjectClass = 'process' | 'device' | 'property' | 'substance' | 'unknown'

export function headNounClass(headNoun: string | null | undefined): ObjectClass {
  const word = String(headNoun ?? '').toLowerCase().trim()
  if (!word || word.length < 3) return 'unknown'
  // Order matters. A bare `er$` claims "polymer" for 'device', so the substance
  // rule runs first; `al$` claimed "material", "signal" and "crystal" for
  // 'process', so it is not in the list at all.
  if (/(tion|sion|ment|ing|age|ysis)$/.test(word)) return 'process'
  if (/(ity|ness|ility|bility|ance|ence|ency|ratio|rate|index)$/.test(word)) return 'property'
  if (/(ide|ate|ine|ol|one|ane|ene|yne|mer|acid|matrix|gel|film|alloy)$/.test(word)) return 'substance'
  if (/(er|or|ator|tron|ode|meter|scope|pump|valve|sensor|device|module|unit)$/.test(word)) return 'device'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// The addressing union
// ---------------------------------------------------------------------------

/** One admitting family, with everything both arms of the test need. */
export interface AddressingCandidate {
  familyKey: string
  /** MECHANISM statement texts extracted from this family. */
  mechanismTexts: readonly string[]
  /** `claimedScope.independentElements` + `dependentNarrowings`, normalised. */
  claimElements: readonly string[]
  /**
   * Distance from the component medoid to this family's NEAREST mechanism
   * statement, normalised to [0,1]. Null when the family has no mechanism
   * statement with a vector — which is an absence of measurement, and is
   * therefore never read as "beyond the cut".
   */
  nearestMechanismDistance: number | null
}

export interface AddressingVerdict {
  familyKey: string
  addressing: boolean
  /** Which arm(s) fired. Both false on a family that does not address it. */
  byLexical: boolean
  byVector: boolean
}

/** Does any of these texts contain the head noun as a whole token? */
export function containsHeadNoun(texts: readonly string[], headNoun: string | null): boolean {
  if (!headNoun) return false
  const target = singularise(headNoun)
  for (const text of texts) {
    for (const token of tokenise(text)) {
      if (singularise(token) === target) return true
    }
  }
  return false
}

/**
 * The union, per family. See the module header for why it is a union.
 *
 * `cut` is the SAME cut that formed the component — deliberately, so
 * "this family's mechanism is as close to the problem as the problem
 * statements are to each other" is one threshold across the whole stage rather
 * than a second, unrelated calibration.
 */
export function decideAddressing(
  candidate: AddressingCandidate,
  headNoun: string | null,
  cut: number
): AddressingVerdict {
  const byLexical =
    containsHeadNoun(candidate.mechanismTexts, headNoun) || containsHeadNoun(candidate.claimElements, headNoun)
  const distance = candidate.nearestMechanismDistance
  const byVector = distance !== null && Number.isFinite(distance) && distance <= cut
  return { familyKey: candidate.familyKey, addressing: byLexical || byVector, byLexical, byVector }
}

export interface AddressingSummary {
  admitting: number
  addressing: number
  /** How many the lexical arm alone would have found. */
  lexicalOnly: number
  /** How many the vector arm alone would have found. */
  vectorOnly: number
  /**
   * Families the vector arm caught that lexical missed. This is the regression
   * guard's number: on a real field it is large, and it is exactly the count by
   * which a lexical-only engine would have overstated "unsolved".
   */
  caughtOnlyByVector: number
  /** Families with no mechanism vector at all — measured, not assumed absent. */
  withoutMechanismVector: number
  verdicts: AddressingVerdict[]
}

export function summariseAddressing(
  candidates: readonly AddressingCandidate[],
  headNoun: string | null,
  cut: number
): AddressingSummary {
  const verdicts = candidates.map(candidate => decideAddressing(candidate, headNoun, cut))
  return {
    admitting: candidates.length,
    addressing: verdicts.filter(verdict => verdict.addressing).length,
    lexicalOnly: verdicts.filter(verdict => verdict.byLexical).length,
    vectorOnly: verdicts.filter(verdict => verdict.byVector).length,
    caughtOnlyByVector: verdicts.filter(verdict => verdict.byVector && !verdict.byLexical).length,
    withoutMechanismVector: candidates.filter(candidate => candidate.nearestMechanismDistance === null).length,
    verdicts,
  }
}

// ---------------------------------------------------------------------------
// Exclusions — hard, and reported
// ---------------------------------------------------------------------------

/**
 * A problem admitted by more than this share of the sampled families is the
 * genre's stock complaint, not an opening.
 *
 * A decision, flagged for calibration. The reasoning: a real unsolved problem
 * is admitted by the subset of the field that ran into it. A problem admitted
 * by two families in five is what everyone in the genre writes in their
 * background because the examiner expects it, and it will already have a
 * hundred solutions we did not read.
 */
export const GENRE_CONVENTION_SHARE = 0.4

/**
 * The share of READABLE field families whose text carries the component's key
 * terms, above which the problem is already widely discussed.
 *
 * Distinct from `GENRE_CONVENTION_SHARE`: that one is measured over what the
 * miner READ (the sample's extractions), this one over the whole field's text
 * by exact SQL. A problem can clear the first and fail the second when the
 * sample happened to miss the families that talk about it.
 *
 * A decision, flagged for calibration.
 */
export const WIDELY_DISCUSSED_SHARE = 0.35

export type ExclusionReason = 'genreConvention' | 'widelyDiscussed' | 'noDomainNoun'

export interface ExclusionCheck {
  excluded: boolean
  reason: ExclusionReason | null
  /** The measurement, so `inputs` can print what was found as well as the verdict. */
  detail: string
}

export interface ExclusionInput {
  medoidText: string
  admitting: number
  sampledFamilies: number
  /**
   * Field families whose text carries the key terms, and the families counted.
   * Null when the count did not run — an unmeasured exclusion is recorded as
   * unmeasured, never as a pass.
   */
  widelyDiscussed: { hits: number; countedFamilies: number } | null
}

export function checkExclusions(input: ExclusionInput): ExclusionCheck {
  if (!carriesDomainNoun(input.medoidText)) {
    return {
      excluded: true,
      reason: 'noDomainNoun',
      detail: `"${input.medoidText}" names no technology outside the generic vocabulary every background uses.`,
    }
  }

  const share = input.sampledFamilies > 0 ? input.admitting / input.sampledFamilies : 0
  if (share > GENRE_CONVENTION_SHARE) {
    return {
      excluded: true,
      reason: 'genreConvention',
      detail:
        `${input.admitting} of ${input.sampledFamilies} families we read (${Math.round(share * 1000) / 10}%) ` +
        `admit this, above the ${Math.round(GENRE_CONVENTION_SHARE * 100)}% at which it is what every background in ` +
        `the genre recites rather than an opening.`,
    }
  }

  if (input.widelyDiscussed && input.widelyDiscussed.countedFamilies > 0) {
    const { hits, countedFamilies } = input.widelyDiscussed
    const discussedShare = hits / countedFamilies
    if (discussedShare > WIDELY_DISCUSSED_SHARE) {
      return {
        excluded: true,
        reason: 'widelyDiscussed',
        detail:
          `its key terms appear in ${hits.toLocaleString()} of ${countedFamilies.toLocaleString()} readable field ` +
          `families (${Math.round(discussedShare * 1000) / 10}%), above the ` +
          `${Math.round(WIDELY_DISCUSSED_SHARE * 100)}% at which the field is already discussing it at length.`,
      }
    }
    return {
      excluded: false,
      reason: null,
      detail: `key terms found in ${hits.toLocaleString()} of ${countedFamilies.toLocaleString()} readable field families.`,
    }
  }

  return {
    excluded: false,
    reason: null,
    detail: 'the whole-field term count did not run, so the widely-discussed exclusion was not applied.',
  }
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface UnsolvedRankInput {
  /** Families admitting the problem at this tier. */
  admitting: number
  /** Of those, families whose text answers it (the union). */
  addressing: number
  /** Share of admitting families filed in the last five years, in [0,1]. */
  recentShare: number
  /** DISTINCT normalised applicants among the admitting families. */
  assigneeSpread: number
}

export interface UnsolvedRank {
  unsolved: WilsonInterval
  /** lowerWilsonBound(unsolved) × (0.5 + recentShare) × sqrt(assigneeSpread). */
  score: number
}

/**
 * The rank. Three factors, each answering a different objection:
 *
 *   - the Wilson LOWER bound on the unsolved rate, so 1-of-1 cannot outrank
 *     180-of-200 (see wilson.ts);
 *   - `0.5 + recentShare`, so a problem the field is still filing about beats
 *     one last complained about in 2004 — but only by 2×, never to zero, since
 *     an old unanswered problem is still unanswered;
 *   - `sqrt(assigneeSpread)`, so a complaint from eleven independent applicants
 *     beats one company's house style, damped because the eleventh applicant
 *     adds less than the second.
 *
 * Deliberately NOT a probability and never presented as one — it orders a list
 * and nothing else. There is no composite grantability number anywhere in this
 * product; see the InventionLead doc comment for why.
 */
export function rankUnsolved(input: UnsolvedRankInput): UnsolvedRank {
  const admitting = Math.max(0, Math.trunc(input.admitting))
  const addressing = Math.min(admitting, Math.max(0, Math.trunc(input.addressing)))
  const unsolved = wilsonInterval(admitting - addressing, admitting)
  const recentShare = Math.min(1, Math.max(0, Number(input.recentShare) || 0))
  const spread = Math.max(0, Math.trunc(input.assigneeSpread))
  const bound = lowerWilsonBound(admitting - addressing, admitting)
  return { unsolved, score: bound * (0.5 + recentShare) * Math.sqrt(spread) }
}

/**
 * The absence sentence. FIXED HERE so it cannot drift between the lead, the
 * evidence row and the report.
 *
 * Never "unsolved". Never "no patent does X". What was actually measured is
 * that nothing in the text we could read, of the families we searched, is
 * directed at the object — and the denominators are inside the sentence so a
 * caller cannot print the claim without them.
 */
export function absenceSentence(input: {
  object: string
  searchedFamilies: number
  ofFieldFamilies: number
  tier: string
}): string {
  return (
    `No mechanism in the readable text of these families is directed at ${input.object} — ` +
    `searched ${input.searchedFamilies.toLocaleString()} of ${input.ofFieldFamilies.toLocaleString()} families in ` +
    `the field, read at ${input.tier}.`
  )
}
