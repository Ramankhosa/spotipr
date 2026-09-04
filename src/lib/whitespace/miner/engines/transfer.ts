/**
 * Invention Miner — engine (ii): mechanisms borrowed from another field.
 *
 * The question: is there a publication OUTSIDE this field's classifications
 * that solves the same KIND of problem with a mechanism this field has never
 * used? That is the only one of the four engines that reads text the harvest
 * never staged, so it is the only one that spends model budget here — and the
 * only one whose central claim ("this mechanism does not appear in the field")
 * is an ABSENCE, which is the claim most easily faked by not looking.
 *
 * WHAT MAKES A TRANSFER A TRANSFER, AND NOT A CATEGORY ERROR.
 *
 *  1. THE SOURCE MUST BE OUT OF FIELD BY CLASSIFICATION, NOT BY DISTANCE. A
 *     semantically distant neighbour inside A61K is not another domain, it is
 *     the same domain discussed differently. So the neighbour must share NO CPC
 *     subclass with the field's own subclass set.
 *
 *  2. THE TWO PROBLEMS MUST SHARE AN OBJECT TYPE. Embedding proximity alone
 *     will happily pair "degradation of a polymer coating" with "degradation of
 *     service quality": near in vector space, and transferring a mechanism
 *     between them is a category error dressed as an insight. The head-noun
 *     class (unsolved.ts's `headNounClass`) is a weak signal used here as a
 *     VETO — different classes refuse, same class does not thereby prove
 *     anything.
 *
 *  3. THE ABSENCE MUST BE MEASURED OVER READABLE TEXT, WITH DENOMINATORS. "Zero
 *     hits in the field" is trivially true when the field has no text: a field
 *     held as abstracts returns zero for every query, and every mechanism in
 *     the world would look transferable into it. Hence the hard skip below —
 *     under a 20% readable share the engine does not run at all, because its
 *     output would be an artefact of our corpus rather than a finding about the
 *     technology.
 *
 * Pure. The retrieval, the mini-harvest and the SQL counts live in the stage.
 */

import type { LabelledCount, ScopeClassification } from '../../types'
import { cpcSubclassPrefixes } from '../harvest-stage'
import { headNounClass, type ObjectClass } from './unsolved'

/**
 * Below this share of the field carrying readable text, "zero hits in the
 * field" is guaranteed and means nothing. See decision 3.
 */
export const MIN_READABLE_FIELD_SHARE = 0.2

/** Publications this engine may put to the model in one run. */
export const MINI_HARVEST_CAP = 300

/** Problem components this engine reads outside the field for. */
export const TRANSFER_COMPONENTS = 6

/** Abstract-index neighbours fetched per component before the subclass filter. */
export const NEIGHBOUR_LIMIT = 60

/** Share of the field's families the derived subclass set must cover. */
export const DERIVED_SUBCLASS_COVERAGE = 0.8

export function readableShareSkip(readableFamilies: number, fieldFamilies: number): string {
  const pct = fieldFamilies > 0 ? Math.round((readableFamilies / fieldFamilies) * 1000) / 10 : 0
  return (
    `Only ${readableFamilies.toLocaleString()} of ${fieldFamilies.toLocaleString()} families in this field ` +
    `(${pct}%) carry text we can search, below the ${Math.round(MIN_READABLE_FIELD_SHARE * 100)}% this engine ` +
    'needs. Its central test is that a borrowed mechanism appears NOWHERE in the field, and over text this thin ' +
    'that is guaranteed for every mechanism — the answer would be about our corpus, not about the technology.'
  )
}

export const NO_SUBCLASS_SKIP =
  'This scope accepts no classifications and the field census recorded none either, so there is no definition of ' +
  '“outside this field” to search against. Add CPC classifications to the scope and run the census again.'

// ---------------------------------------------------------------------------
// The field's subclass set
// ---------------------------------------------------------------------------

export type SubclassSource = 'scope' | 'field-map'

export interface FieldSubclasses {
  subclasses: string[]
  source: SubclassSource
  /** Present when the set was derived rather than declared — the note says so. */
  note: string | null
}

/**
 * The field's own subclasses: the scope's ACCEPTED classifications first.
 *
 * `accepted: false` codes are ones the user rejected during scope review, and
 * including them would define "outside the field" using classifications the
 * user explicitly said were not the field — which would then suppress genuine
 * transfer candidates from those very neighbourhoods.
 */
export function subclassesFromScope(classifications: readonly ScopeClassification[] | undefined): string[] {
  const accepted = (classifications ?? []).filter(entry => entry?.accepted).map(entry => entry.code)
  return cpcSubclassPrefixes(accepted)
}

/**
 * The subclasses covering `coverage` of the field's families, from the census's
 * own classifications facet.
 *
 * Ordered by family count descending and accumulated until the target share is
 * reached, so the set is "what this field is classified as" rather than "every
 * code that appeared once". `familyCount` is the census's family total, not the
 * sum of the facet — a publication carries several classifications, so the
 * facet's counts sum to well over the field.
 */
export function subclassesFromCensus(
  classifications: readonly LabelledCount[] | undefined,
  familyCount: number,
  coverage: number = DERIVED_SUBCLASS_COVERAGE
): string[] {
  if (!classifications?.length || familyCount <= 0) return []
  const target = familyCount * Math.min(1, Math.max(0, coverage))
  const ranked = [...classifications].sort(
    (a, b) => (b.families || 0) - (a.families || 0) || (a.label < b.label ? -1 : 1)
  )
  const kept = new Set<string>()
  let covered = 0
  for (const entry of ranked) {
    const [subclass] = cpcSubclassPrefixes([entry.label])
    if (subclass) kept.add(subclass)
    covered += Math.max(0, entry.families || 0)
    if (covered >= target) break
  }
  return Array.from(kept).sort()
}

/** The set, and where it came from. Null when neither source produced one. */
export function resolveFieldSubclasses(input: {
  scopeClassifications?: readonly ScopeClassification[]
  censusClassifications?: readonly LabelledCount[]
  familyCount: number
}): FieldSubclasses | null {
  const declared = subclassesFromScope(input.scopeClassifications)
  if (declared.length) return { subclasses: declared, source: 'scope', note: null }

  const derived = subclassesFromCensus(input.censusClassifications, input.familyCount)
  if (derived.length) {
    return {
      subclasses: derived,
      source: 'field-map',
      note:
        'This scope declares no classifications, so “outside this field” was defined from the classifications the ' +
        `field census actually found — the ${derived.length} subclasses covering ` +
        `${Math.round(DERIVED_SUBCLASS_COVERAGE * 100)}% of its families (${derived.join(', ')}). A transfer ` +
        'candidate is “outside” only in that derived sense.',
    }
  }
  return null
}

/** Does this publication share any subclass with the field? */
export function sharesFieldSubclass(
  publicationClassifications: readonly (string | null)[] | null | undefined,
  fieldSubclasses: readonly string[]
): boolean {
  if (!fieldSubclasses.length) return true // no definition of the field: nothing is outside it
  const field = new Set(fieldSubclasses)
  return cpcSubclassPrefixes(publicationClassifications).some(subclass => field.has(subclass))
}

// ---------------------------------------------------------------------------
// The candidate gate
// ---------------------------------------------------------------------------

export interface TransferGateInput {
  /** Head noun of the component's medoid — the problem being solved IN the field. */
  targetHeadNoun: string | null
  /** Head noun of the out-of-field problem the borrowed mechanism answers. */
  sourceHeadNoun: string | null
  /**
   * Distance from the borrowed mechanism to the field's NEAREST mechanism
   * statement, normalised. Null when the field has no mechanism vector to
   * compare against, which is an absence of measurement and refuses.
   */
  nearestInFieldMechanismDistance: number | null
  /** The component cut. The mechanism must be BEYOND it to be new to the field. */
  cut: number
  /**
   * Exact whole-field count of the mechanism's key terms over READABLE text,
   * with its denominator. Null when the count did not run, which refuses.
   */
  fieldTermHits: { hits: number; countedFamilies: number } | null
}

export type TransferRefusal =
  | 'different-object-class'
  | 'object-class-unknown'
  | 'already-in-field-by-vector'
  | 'already-in-field-by-terms'
  | 'not-measured'

export interface TransferGateResult {
  admitted: boolean
  refusal: TransferRefusal | null
  sourceClass: ObjectClass
  targetClass: ObjectClass
  detail: string
}

/**
 * Every condition a transfer candidate must clear, in the order that refuses
 * most cheaply first.
 *
 * `not-measured` is its own refusal and is NOT a pass. An unmeasured absence is
 * the exact shape of the dishonesty this engine is most exposed to.
 */
export function gateTransferCandidate(input: TransferGateInput): TransferGateResult {
  const sourceClass = headNounClass(input.sourceHeadNoun)
  const targetClass = headNounClass(input.targetHeadNoun)

  // A transfer must be shown to be a transfer. Requiring only that the two
  // classes do not PROVABLY differ let every pair the morphology could not
  // classify through, and on the first live run that was most of them: a
  // surgical tissue glue and an analytical UV method were both offered against
  // a gastric-retention problem, each with sourceClass and targetClass
  // 'unknown'. That is the same shape as an unmeasured absence, which this
  // module already refuses rather than passes — so an unclassified pair refuses
  // too, and says which side it could not read.
  // Unknown is checked first so an unreadable pair is reported as unreadable.
  // Folding it into the difference test would announce a "category error"
  // between a class we read and one we did not, which claims a finding the
  // reading does not support.
  if (sourceClass === 'unknown' || targetClass === 'unknown') {
    return {
      admitted: false,
      refusal: 'object-class-unknown',
      sourceClass,
      targetClass,
      detail:
        'the problem on one side states no object this reading could classify, so there is nothing to show the two are the same kind of problem rather than two sentences that sit near each other.',
    }
  }
  if (sourceClass !== targetClass) {
    return {
      admitted: false,
      refusal: 'different-object-class',
      sourceClass,
      targetClass,
      detail: `the borrowed problem is about a ${sourceClass} and this field's is about a ${targetClass}, so moving the mechanism between them is a category error rather than a transfer.`,
    }
  }

  const distance = input.nearestInFieldMechanismDistance
  if (distance === null || !Number.isFinite(distance)) {
    return {
      admitted: false,
      refusal: 'not-measured',
      sourceClass,
      targetClass,
      detail: 'the field holds no comparable mechanism vector, so “this mechanism is new to the field” could not be measured.',
    }
  }
  if (distance <= input.cut) {
    return {
      admitted: false,
      refusal: 'already-in-field-by-vector',
      sourceClass,
      targetClass,
      detail: `the field already holds a mechanism within the component cut (${Math.round(distance * 1000) / 1000} ≤ ${Math.round(input.cut * 1000) / 1000}).`,
    }
  }

  if (!input.fieldTermHits) {
    return {
      admitted: false,
      refusal: 'not-measured',
      sourceClass,
      targetClass,
      detail: 'the whole-field term count did not run, so “zero hits in the field” was never established.',
    }
  }
  if (input.fieldTermHits.hits > 0) {
    return {
      admitted: false,
      refusal: 'already-in-field-by-terms',
      sourceClass,
      targetClass,
      detail: `its key terms already appear in ${input.fieldTermHits.hits.toLocaleString()} of ${input.fieldTermHits.countedFamilies.toLocaleString()} readable field families.`,
    }
  }

  return {
    admitted: true,
    refusal: null,
    sourceClass,
    targetClass,
    detail: `no mechanism in the readable text of ${input.fieldTermHits.countedFamilies.toLocaleString()} field families carries its key terms, and the field's nearest mechanism vector is beyond the component cut.`,
  }
}

/**
 * The transfer's ENABLING CONDITION, recorded on the lead.
 *
 * The gate's plausibility step consumes this. A borrowed mechanism does not
 * work in the new field for free — it works IF something holds (the material
 * tolerates the temperature, the signal exists at that rate). Naming the
 * condition is what separates a transfer proposal from a wish, and leaving the
 * gate to invent one later is exactly the theatre the design forbids.
 */
export function enablingCondition(input: {
  mechanism: string
  sourceSubclasses: readonly string[]
  targetSubclasses: readonly string[]
}): string {
  const from = input.sourceSubclasses.length ? input.sourceSubclasses.join(', ') : 'another classification'
  const to = input.targetSubclasses.length ? input.targetSubclasses.join(', ') : 'this field'
  return (
    `This transfer holds only if ${input.mechanism} survives the operating conditions of ${to}. It was read in ` +
    `${from}, where those conditions differ, and nothing we measured tests it here — that is the condition the ` +
    'grantability screen has to put to the applicant, not something this engine established.'
  )
}
