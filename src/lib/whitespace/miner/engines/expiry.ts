/**
 * Invention Miner — engine (iv): platforms nearing the end of protection.
 *
 * The question: which problems in this field are addressed mostly by families
 * old enough that their patents are at or past a 20-year term, while the field
 * is STILL filing about the same problem? That pairs a technology about to
 * become freely usable with evidence that people still want it.
 *
 * TWO SENTENCES ARE NON-NEGOTIABLE ON EVERY LEAD THIS ENGINE PRODUCES, and
 * they are constants in this file rather than strings in the stage so nobody
 * can ship a lead without them.
 *
 *  1. WE HOLD NO LEGAL STATUS. `local_patents` has no renewal data, no grant
 *     register, no revocation record. A filing date 17 years old tells us the
 *     TERM would be nearly over IF the patent was granted AND maintained AND
 *     ever in force here. Any of those may be false, and for most publications
 *     at least one is. Printing "expiring" without that is a freedom-to-operate
 *     opinion this system cannot support.
 *
 *  2. EXPIRY CHANGES FREEDOM TO OPERATE, NOT PATENTABILITY. This is the
 *     correction that actually matters, and it is the one an excited reader
 *     gets wrong: an expired patent is prior art against your improvement
 *     FOREVER. Its expiry means you may practise what it disclosed; it does not
 *     make what it disclosed newly patentable, by you or by anyone.
 *
 * WHY 17 YEARS AND NOT 20. The term runs 20 years from filing, but a lead is
 * something an attorney acts on over the next year or two, and the corpus's
 * newest publications lag reality by ~18 months anyway. 17 years finds the
 * platforms whose protection ends inside a planning horizon. It is a decision,
 * flagged for calibration.
 *
 * Pure. Dates in, groups out.
 */

/** Filing age at which a family is treated as nearing the end of its term. */
export const EXPIRY_HORIZON_YEARS = 17

/** How far back "the field is still filing about this" looks. */
export const DEMAND_WINDOW_YEARS = 5

/** Below this many old families a "platform" is one or two documents. */
export const MIN_EXPIRING_FAMILIES = 3

/** Below this many recent admitting families there is no demonstrated demand. */
export const MIN_DEMAND_FAMILIES = 2

export const EXPIRY_LEGAL_STATUS_SENTENCE =
  'We hold no legal-status or renewal data, so the patent may have lapsed, been revoked, or never have been ' +
  'granted in India.'

export const EXPIRY_PRIOR_ART_SENTENCE =
  'An expired patent remains prior art against your improvement forever, so expiry changes freedom to operate, ' +
  'not patentability.'

/** One admitting family, with the only two facts this engine reads. */
export interface ExpiryFamily {
  familyKey: string
  /** The problem component this family admits. */
  componentId: string
  /** Filing year. Null when the corpus holds no filing date, which excludes the row. */
  filingYear: number | null
}

export interface ExpiryGroup {
  componentId: string
  /** Families filed at or before the horizon. */
  expiring: string[]
  /** Families filed inside the demand window that admit the same problem. */
  demand: string[]
  /** Families with no filing year at all — counted, never assumed old or new. */
  undated: string[]
}

/**
 * Group admitting families by problem component into expiring / still-in-demand.
 *
 * `referenceYear` is passed in rather than read from the clock so the grouping
 * is testable and so a re-run inside the same year produces the same answer.
 *
 * A family with no filing year is NOT old and NOT recent: EPO bulk-import rows
 * carry a publication date and no filing date at all, and treating a missing
 * date as either would put a whole import class on one side of the line. They
 * are counted separately and the count reaches the lead's coverage limitations.
 */
export function groupByExpiry(
  families: readonly ExpiryFamily[],
  referenceYear: number,
  horizonYears: number = EXPIRY_HORIZON_YEARS,
  demandWindowYears: number = DEMAND_WINDOW_YEARS
): ExpiryGroup[] {
  const expiringBefore = referenceYear - horizonYears
  const demandAfter = referenceYear - demandWindowYears

  const groups = new Map<string, ExpiryGroup>()
  const bucket = (componentId: string): ExpiryGroup => {
    let group = groups.get(componentId)
    if (!group) {
      group = { componentId, expiring: [], demand: [], undated: [] }
      groups.set(componentId, group)
    }
    return group
  }

  for (const family of families) {
    const group = bucket(family.componentId)
    const year = family.filingYear
    if (year === null || !Number.isFinite(year)) {
      group.undated.push(family.familyKey)
      continue
    }
    if (year <= expiringBefore) group.expiring.push(family.familyKey)
    if (year >= demandAfter) group.demand.push(family.familyKey)
  }

  for (const group of Array.from(groups.values())) {
    group.expiring.sort()
    group.demand.sort()
    group.undated.sort()
  }

  // Ranked by the pairing the engine is actually looking for — old platform AND
  // live demand — with the component id breaking ties so a re-run orders them
  // identically.
  return Array.from(groups.values()).sort(
    (a, b) =>
      Math.min(b.expiring.length, b.demand.length) - Math.min(a.expiring.length, a.demand.length) ||
      b.expiring.length - a.expiring.length ||
      (a.componentId < b.componentId ? -1 : a.componentId > b.componentId ? 1 : 0)
  )
}

/** Groups with enough of both halves to say anything. */
export function publishableExpiryGroups(groups: readonly ExpiryGroup[]): ExpiryGroup[] {
  return groups.filter(
    group => group.expiring.length >= MIN_EXPIRING_FAMILIES && group.demand.length >= MIN_DEMAND_FAMILIES
  )
}

/**
 * The coverage lines every expiry lead carries, in order. The first two are the
 * non-negotiable pair; the third states what was counted.
 */
export function expiryCoverageLines(input: {
  expiring: number
  demand: number
  undated: number
  referenceYear: number
  horizonYears?: number
  demandWindowYears?: number
}): string[] {
  const horizon = input.horizonYears ?? EXPIRY_HORIZON_YEARS
  const window = input.demandWindowYears ?? DEMAND_WINDOW_YEARS
  const lines = [
    EXPIRY_LEGAL_STATUS_SENTENCE,
    EXPIRY_PRIOR_ART_SENTENCE,
    `${input.expiring} famil${input.expiring === 1 ? 'y' : 'ies'} admitting this problem were filed in or before ` +
      `${input.referenceYear - horizon} (${horizon}+ years ago), and ${input.demand} were filed in the last ` +
      `${window} years.`,
  ]
  if (input.undated > 0) {
    lines.push(
      `${input.undated} further famil${input.undated === 1 ? 'y' : 'ies'} admitting it carry no filing date in our ` +
        'corpus and are on neither side of that line.'
    )
  }
  return lines
}
