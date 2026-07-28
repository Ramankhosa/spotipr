/**
 * Persona guidance — the plain-English layer over writing samples.
 *
 * The persona feature only works if an attorney understands three things:
 *   1. what to paste into each section,
 *   2. how much of it,
 *   3. when they have done enough for the persona to be worth switching on.
 *
 * The word limits already live in `writing-sample-limits`; this module adds the
 * human half — per-section prompts and a readiness model — so the UI can say
 * "Ready to use" instead of "7 samples".
 */

import { SECTION_WORD_LIMITS, DEFAULT_LIMITS } from './writing-sample-limits'

/**
 * The sections where style transfer actually shows. A persona that covers these
 * five produces recognisably "your" draft; the rest are refinements. Every key
 * here exists in the superset section list, so readiness can be computed from a
 * persona's covered sections alone — no per-jurisdiction lookup needed.
 */
export const HIGH_IMPACT_SECTIONS = [
  'claims',
  'detailedDescription',
  'background',
  'summary',
  'abstract'
] as const

/**
 * What to paste, in the attorney's terms. Falls back to the limit table's
 * description for sections that only exist in some jurisdictions.
 */
const SECTION_BLURBS: Record<string, string> = {
  title: 'How you phrase invention titles — length, specificity, capitalisation.',
  fieldOfInvention: 'Your standard opening sentence for the technical field.',
  background:
    'How you set up the prior art and the problem — the transitions and hedging you use before "however".',
  objectsOfInvention: 'How you enumerate the objects of the invention.',
  summary: 'How you restate the invention at a high level, and how closely you track the claims.',
  briefDescriptionOfDrawings: 'Your figure-caption phrasing and numbering convention.',
  detailedDescription:
    'Your embodiment prose — reference numerals, paragraph rhythm, and how you signal alternatives.',
  claims:
    'Your claim architecture — preamble, transitional phrase, dependency style, and antecedent handling.',
  abstract: 'Your abstract voice and length.',
  technicalProblem: 'How you state the technical problem.',
  technicalSolution: 'How you state the technical solution.',
  advantageousEffects: 'How you phrase advantages and effects.',
  industrialApplicability: 'Your standard industrial-applicability wording.',
  bestMethod: 'How you describe the best mode of carrying out the invention.',
  preamble: 'Your claim preamble style.',
  crossReference: 'Your cross-reference / priority-claim format.',
  listOfNumerals: 'How you lay out the reference-numeral list.'
}

export function sectionBlurb(sectionKey: string): string {
  return (
    SECTION_BLURBS[sectionKey] ||
    SECTION_WORD_LIMITS[sectionKey]?.description ||
    'A passage from one of your own patents, written the way you normally write it.'
  )
}

export function sectionRecommendedRange(sectionKey: string): { min: number; max: number } {
  return (SECTION_WORD_LIMITS[sectionKey] || DEFAULT_LIMITS).recommended
}

export function isHighImpact(sectionKey: string): boolean {
  return (HIGH_IMPACT_SECTIONS as readonly string[]).includes(sectionKey)
}

/** The jurisdiction code standing for "applies to every country". */
export const UNIVERSAL_JURISDICTION = '*'

/** The shape the persona API returns per sample — keys only, never the text. */
export interface PersonaSampleRef {
  sectionKey: string
  jurisdiction: string
}

/**
 * The sections a persona can actually supply for a given jurisdiction.
 *
 * This mirrors `findPrimaryPersonaSample` in the writing sample service, which
 * only ever looks at `[jurisdiction, '*']`. The distinction is not cosmetic:
 * five sections saved under "US" leave an Indian draft with nothing to mimic,
 * so counting them as covered would promise a style the drafter cannot deliver.
 *
 * Passing '*' asks the narrower question — what works for every country — and
 * deliberately ignores country-specific samples.
 */
export function resolveCoveredSections(
  samples: PersonaSampleRef[] | undefined,
  jurisdiction: string = UNIVERSAL_JURISDICTION
): string[] {
  const target = (jurisdiction || UNIVERSAL_JURISDICTION).toUpperCase()
  const covered = new Set<string>()

  for (const sample of samples || []) {
    if (!sample?.sectionKey) continue
    const code = (sample.jurisdiction || '').toUpperCase()
    if (code === UNIVERSAL_JURISDICTION || code === target) {
      covered.add(sample.sectionKey)
    }
  }

  return Array.from(covered)
}

export interface PersonaCoverage {
  /** The strongest readiness available, across the universal set and each country. */
  readiness: PersonaReadiness
  /** Where that readiness applies: '*' for every country, otherwise a country code. */
  jurisdiction: string
  /**
   * Every country the persona is fully ready for. Empty once it is universally
   * ready, since the qualifier would then add nothing.
   */
  readyJurisdictions: string[]
}

/**
 * Readiness for surfaces with no jurisdiction in hand, such as the persona
 * list. Universal wins when it is complete; otherwise the best country does,
 * so a deliberately US-only persona reads as ready for US rather than as
 * unfinished — while still never claiming to be ready everywhere.
 */
export function getPersonaCoverage(samples: PersonaSampleRef[] | undefined): PersonaCoverage {
  const universal = getPersonaReadiness(resolveCoveredSections(samples, UNIVERSAL_JURISDICTION))
  if (universal.level === 'ready') {
    return { readiness: universal, jurisdiction: UNIVERSAL_JURISDICTION, readyJurisdictions: [] }
  }

  const countries = Array.from(new Set(
    (samples || [])
      .map(s => (s?.jurisdiction || '').toUpperCase())
      .filter(code => code && code !== UNIVERSAL_JURISDICTION)
  ))

  let readiness = universal
  let jurisdiction = UNIVERSAL_JURISDICTION
  const readyJurisdictions: string[] = []

  for (const code of countries) {
    const forCountry = getPersonaReadiness(resolveCoveredSections(samples, code))
    if (forCountry.level === 'ready') readyJurisdictions.push(code)
    if (forCountry.covered > readiness.covered) {
      readiness = forCountry
      jurisdiction = code
    }
  }

  return { readiness, jurisdiction, readyJurisdictions }
}

export type ReadinessLevel = 'empty' | 'partial' | 'ready'

export interface PersonaReadiness {
  level: ReadinessLevel
  /** High-impact sections covered, out of HIGH_IMPACT_SECTIONS.length. */
  covered: number
  total: number
  /** 0–1, for meters. */
  ratio: number
  /** One line, safe to render on a card. */
  label: string
  /** The next concrete thing to do. Empty when ready. */
  nextStep: string
  /** Section keys still missing, in teaching order. */
  missing: string[]
}

/**
 * Readiness is measured against the high-impact five, not the total section
 * count: a persona with the five that matter is genuinely usable, and a goal of
 * five is one an attorney will actually finish.
 */
export function getPersonaReadiness(coveredSectionKeys: string[] | undefined): PersonaReadiness {
  const covered = new Set(coveredSectionKeys || [])
  const missing = HIGH_IMPACT_SECTIONS.filter(key => !covered.has(key))
  const total = HIGH_IMPACT_SECTIONS.length
  const done = total - missing.length

  if (done === 0) {
    return {
      level: 'empty',
      covered: 0,
      total,
      ratio: 0,
      label: 'No samples yet',
      nextStep: 'Add a sample to get started',
      missing: [...missing]
    }
  }

  if (missing.length > 0) {
    return {
      level: 'partial',
      covered: done,
      total,
      ratio: done / total,
      label: `${done} of ${total} key sections`,
      nextStep: `Add ${missing.length} more to finish`,
      missing: [...missing]
    }
  }

  return {
    level: 'ready',
    covered: done,
    total,
    ratio: 1,
    label: 'Ready to use',
    nextStep: '',
    missing: []
  }
}

/** Word count used consistently by the editor, the meter, and the save guard. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}
