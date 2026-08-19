/**
 * Whitespace Studio — the field rule, in words and in arithmetic.
 *
 * Pure functions only (no database, no Prisma), so the fit decision and every
 * sentence the user reads about it can be tested against fixed numbers. The
 * measuring lives in field-definition.ts.
 *
 * Background. The field used to be defined by the concept list plus a boolean
 * per concept: required concepts intersect, optional ones never narrow. That is
 * a step function of the number of required concepts — one required concept
 * matches a technology sector (hundreds of thousands of publications, past the
 * census ceiling, or past its timeout), two intersect to a reading list of a
 * few dozen families (below every downstream floor). Users toggled between
 * "too broad to count" and "too few to analyse" with no rung in between, which
 * is the failure this module exists to remove. "At least k of the optional
 * concepts" is that rung, and `auto` picks it.
 */

import type { FieldRule, FieldRuleFit, FieldRuleRung, WhitespaceScope } from './types'
import { scopeMatching } from './types'

/** The band a fitted field must land in. Both env-tunable; see resolveFieldBand. */
export interface FieldBand {
  /** Below this many families the downstream stages cannot say anything honest. */
  minFamilies: number
  /** Above this many publications the exact census will not stage the field. */
  maxPublications: number
}

/** A rung's measurement, as the sizer reports it. */
export interface RungMeasurement {
  minimumOptional: number
  publications: number
  families: number
  overCap: boolean
  timedOut: boolean
}

export interface FitDecision {
  minimumOptional: number
  fit: FieldRuleFit
}

/**
 * Picks the rung to run with, from the rungs measured so far (tightest first).
 *
 * The rule: the TIGHTEST rung that reaches the family floor without crossing
 * the publication ceiling. Tightest, because for a study "around" a subject the
 * field should be as specific as the analysis can bear — looser rungs admit
 * documents that share fewer of the concepts.
 *
 * When no rung lands in the band the least-bad rung is chosen and the fit is
 * NAMED, so every caller can say exactly what went wrong instead of failing
 * with a bare number:
 *   - too-narrow: even the loosest rung is under the floor → run the loosest
 *     (the most the concepts can find), and the stage's own floor check will
 *     say what to widen.
 *   - too-broad: even the tightest rung is over the ceiling → run the tightest,
 *     and the census will refuse with the number and what to tighten.
 *   - cliff: adjacent rungs jump from under the floor to over the ceiling →
 *     run the tighter (it is at least countable) and say the next rung would
 *     need exclusions or filters before it could be.
 *
 * `measured` is tightest-first and may stop at the first over-cap rung (every
 * looser rung is a superset, so nothing past it can be under the ceiling).
 */
export function chooseRung(measured: readonly RungMeasurement[], band: FieldBand): FitDecision {
  if (!measured.length) throw new Error('chooseRung needs at least one measured rung')
  const under = (rung: RungMeasurement) => !rung.overCap && !rung.timedOut
  const inBand = measured.find(rung => under(rung) && rung.families >= band.minFamilies)
  if (inBand) return { minimumOptional: inBand.minimumOptional, fit: 'in-band' }

  const overCap = measured.filter(rung => !under(rung))
  const underCap = measured.filter(under)
  if (!underCap.length) {
    // Tightest first, so the first measured rung is the tightest expressible.
    return { minimumOptional: measured[0].minimumOptional, fit: 'too-broad' }
  }
  // Loosest countable rung — the most families the concepts can reach.
  const loosest = underCap[underCap.length - 1]
  return { minimumOptional: loosest.minimumOptional, fit: overCap.length ? 'cliff' : 'too-narrow' }
}

/**
 * The rungs an auto fit visits, tightest first, restricted to what can be
 * compiled (rungIsCompilable) — the sizer measures them in this order and stops
 * at the first that crosses the ceiling.
 */
export function ladderRungs(min: number, max: number, compilable: (k: number) => boolean): number[] {
  const rungs: number[] = []
  for (let k = max; k >= min; k--) if (compilable(k)) rungs.push(k)
  return rungs
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const n = (value: number) => value.toLocaleString()

/** "at least 2 of the 4 other concepts" — the phrase every note and message reuses. */
export function rungPhrase(rule: Pick<FieldRule, 'optionalCount' | 'requiredCount'>, k: number): string {
  // "other" only when there are must-appear concepts to be other than.
  const noun = (plural: boolean) => [rule.requiredCount > 0 ? 'other' : '', plural ? 'concepts' : 'concept'].filter(Boolean).join(' ')
  if (rule.optionalCount === 0) return rule.requiredCount > 0 ? 'every must-appear concept' : 'no concept'
  if (k <= 0) return `any number of the ${rule.optionalCount} ${noun(rule.optionalCount !== 1)} (none need appear)`
  if (k >= rule.optionalCount) {
    return rule.optionalCount === 1 ? `the ${noun(false)}` : `all ${rule.optionalCount} ${noun(true)}`
  }
  return `at least ${k} of the ${rule.optionalCount} ${noun(true)}`
}

/** One rung of the ladder as "≥2 of 4: 812 families". */
export function rungLabel(rung: FieldRuleRung, rule: FieldRule): string {
  const head =
    rule.optionalCount === 0
      ? 'all concepts'
      : rung.minimumOptional <= 0
        ? 'must-appear only'
        : `≥${rung.minimumOptional} of ${rule.optionalCount}`
  if (rung.skipped) return `${head}: not measured`
  if (rung.timedOut) return `${head}: could not be sized in time (treated as too broad)`
  if (rung.overCap) return `${head}: more than ${n(rule.band.maxPublications)} publications`
  return `${head}: ${n(rung.families ?? 0)} famil${rung.families === 1 ? 'y' : 'ies'}`
}

/**
 * The measured rungs in one clause, for failure messages: the numbers are the
 * most useful thing a refusal can carry, and a run that fails produces no
 * result for the ladder panel to show them in. Empty when nothing was measured.
 */
export function ladderSummary(rule: FieldRule | null | undefined): string {
  if (!rule || rule.optionalCount === 0) return ''
  const measured = rule.ladder.filter(rung => !rung.skipped)
  if (!measured.length) return ''
  return ` Rungs measured — ${measured
    .map(rung => `${rungLabel(rung, rule)}${rung.minimumOptional === rule.minimumOptional ? ' (used)' : ''}`)
    .join('; ')}.`
}

/**
 * The coverage note that travels with every result: what the rule was, how it
 * was decided, and what every measured rung looked like. Stated in the good
 * case too — a reader comparing two studies must be able to see that one
 * counted "≥2 of 4" and the other "≥3 of 5" before comparing their numbers.
 */
export function fieldRuleNote(rule: FieldRule): string {
  if (rule.fit === 'none' && rule.optionalCount === 0 && rule.requiredCount === 0) {
    return 'Field rule: no concepts — the field is defined by structural filters alone.'
  }
  const required =
    rule.requiredCount > 0
      ? `every must-appear concept (${rule.requiredCount})${rule.optionalCount > 0 ? ' and ' : ''}`
      : ''
  const optional = rule.optionalCount > 0 ? rungPhrase(rule, rule.minimumOptional) : ''
  const how =
    rule.mode === 'pinned'
      ? 'pinned in the scope'
      : rule.fit === 'in-band'
        ? `auto-fitted: the tightest rung with at least ${n(rule.band.minFamilies)} families and at most ${n(
            rule.band.maxPublications
          )} publications`
        : rule.fit === 'too-narrow'
          ? `auto-fitted to the loosest rung — even it is below the ${n(rule.band.minFamilies)}-family floor`
          : rule.fit === 'too-broad'
            ? `auto-fitted to the tightest rung — even it is above the ${n(rule.band.maxPublications)}-publication ceiling`
            : rule.fit === 'cliff'
              ? `auto-fitted to the tightest countable rung — the next looser rung is above the ${n(
                  rule.band.maxPublications
                )}-publication ceiling`
              : 'the only rung the concept list allows'
  const ladder = rule.ladder.filter(rung => !rung.skipped)
  const ladderText = ladder.length
    ? ` Rungs measured — ${ladder
        .map(rung => `${rungLabel(rung, rule)}${rung.minimumOptional === rule.minimumOptional ? ' (used)' : ''}`)
        .join('; ')}.`
    : ''
  return `Field rule: a document counts when it matches ${required}${optional} (${how}).${ladderText}`
}

/**
 * What to change when the field is too broad to count. Reads the ladder when
 * there is one, so the advice names a rung that was actually measured instead
 * of "mark more concepts as required" — the exact move that used to jump the
 * user from a sector to an empty intersection.
 */
export function narrowingAdviceFor(scope: WhitespaceScope, rule?: FieldRule | null): string {
  const hasConcepts = scope.concepts.some(concept => concept.label.trim())
  if (!hasConcepts) {
    return 'This scope matches on classification alone, which cannot use the text index and so reads the whole corpus. Add a concept — even one — and the search becomes index-backed.'
  }
  const structural = 'tighten the filing years, restrict jurisdictions, accept a narrower classification, or add exclusions'
  if (rule && rule.optionalCount > 0) {
    const tighter = [...rule.ladder]
      .filter(rung => !rung.skipped && !rung.overCap && !rung.timedOut && rung.minimumOptional > rule.minimumOptional)
      .sort((a, b) => a.minimumOptional - b.minimumOptional)[0]
    if (tighter) {
      return `Narrow it: set the match rule to ${rungPhrase(rule, tighter.minimumOptional)} (${n(
        tighter.families ?? 0
      )} families measured), or ${structural}.`
    }
    if (rule.fit === 'too-broad' || rule.minimumOptional >= rule.optionalCount) {
      return `Even requiring every concept matches more than the census can count, so the concept wording itself is too generic for this corpus: replace broad concepts (and broad synonyms such as single common words) with specific ones, ${structural}.`
    }
    return `Narrow it: pin the match rule to a higher minimum than ${rungPhrase(rule, rule.minimumOptional)}, or ${structural}.`
  }
  const hasRequired = scope.concepts.some(concept => concept.required && concept.label.trim())
  const requiredHint = hasRequired
    ? 'mark another concept as must-appear'
    : 'mark a concept as must-appear (must-appear concepts intersect; with none marked, the field is the union of every concept)'
  return `Narrow it: ${requiredHint}, raise the number of concepts a document must match, or ${structural}.`
}

/**
 * What to change when the field is too small. The counterpart of the above,
 * and — now that a ladder exists — it can say whether a looser rung would have
 * helped (a pinned rule) or whether the concepts simply do not reach that many
 * documents (auto, already at the loosest rung).
 */
export function wideningAdviceFor(scope: WhitespaceScope, rule?: FieldRule | null): string {
  const structural = 'broaden the concept synonyms, extend the filing years, add jurisdictions, drop the assignee or classification restriction'
  const required = scope.concepts.filter(concept => concept.required && concept.label.trim())
  if (rule && rule.optionalCount > 0) {
    if (rule.mode === 'pinned' && rule.minimumOptional > minimumRungFor(rule)) {
      return `The match rule is pinned at ${rungPhrase(rule, rule.minimumOptional)}. Lower it, or set it back to auto so the study can pick the widest rung that still counts — then ${structural}.`
    }
    if (rule.fit === 'cliff') {
      const next = rule.ladder.find(rung => (rung.overCap || rung.timedOut) && rung.minimumOptional < rule.minimumOptional)
      return `The next looser rung${next ? ` (${rungPhrase(rule, next.minimumOptional)})` : ''} matches more than ${n(
        rule.band.maxPublications
      )} publications, so it cannot be counted exactly. Bring it under the ceiling first — add exclusions, tighten filing years or jurisdictions — or ${structural} so this rung grows.`
    }
    return `Even ${rungPhrase(rule, rule.minimumOptional)} reaches only this many documents, so the concept wording is what limits the field: ${structural}${
      required.length ? `, or make ${required.length === 1 ? 'the must-appear concept' : 'some must-appear concepts'} optional` : ''
    }.`
  }
  return `Widen the scope: ${structural}${required.length ? `, or make ${required.length === 1 ? 'the must-appear concept' : 'some must-appear concepts'} optional` : ''}.`
}

/** The loosest rung a rule's concept list allows (0 with a must-appear concept, else 1). */
export function minimumRungFor(rule: Pick<FieldRule, 'requiredCount' | 'optionalCount'>): number {
  return rule.requiredCount > 0 ? 0 : Math.min(1, rule.optionalCount)
}

/** The rule for a scope with nothing to fit — pinned k, or no optional concepts at all. */
export function trivialFieldRule(
  scope: WhitespaceScope,
  counts: { requiredCount: number; optionalCount: number },
  band: FieldBand
): FieldRule | null {
  const matching = scopeMatching(scope)
  const min = minimumRungFor(counts)
  if (matching.minimumOptionalConcepts !== 'auto') {
    const k = Math.min(counts.optionalCount, Math.max(min, matching.minimumOptionalConcepts))
    return { mode: 'pinned', ...counts, minimumOptional: k, fit: 'pinned', ladder: [], band }
  }
  if (counts.optionalCount === 0 || min === counts.optionalCount) {
    return { mode: 'auto', ...counts, minimumOptional: min, fit: 'none', ladder: [], band }
  }
  return null
}
