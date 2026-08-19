/**
 * Client mirror of the DIMENSION_MAP result (src/lib/whitespace/types.ts).
 *
 * Kept as its own file so the invention components share one shape, and so the
 * server type never has to be imported into a client bundle.
 */

export interface DimensionValue {
  id: string
  label: string
  synonyms: string[]
  query: string
  families: number
  share: number
  sampleFamilies: number
  round: number
  provenance: 'seed' | 'grow' | 'user'
}

export interface Dimension {
  id: string
  label: string
  description: string
  values: DimensionValue[]
  introducedInRound: number
  assignedFamilies: number
  residualFamilies: number
  residualShare: number
  multiAssignmentRatio: number
  sampleAssignedFamilies: number
  sampleResidualShare: number
}

export type RejectionReason =
  | 'BELOW_SAMPLE_FLOOR'
  | 'DUPLICATE_OF_EXISTING'
  | 'DIMENSION_RESTATES_EXISTING'
  | 'EXPLAINS_TOO_LITTLE_RESIDUAL'
  | 'QUERY_STEMS_TO_NOTHING'
  | 'REGISTRY_FULL'

export interface DimensionRound {
  round: number
  slice: { families: number; basis: 'sample' | 'residual' }
  proposedDimensions: string[]
  proposedValues: Array<{ dimension: string; value: string }>
  acceptedDimensions: string[]
  acceptedValues: Array<{ dimension: string; value: string }>
  rejected: Array<{ kind: 'dimension' | 'value'; label: string; reason: RejectionReason; detail: string }>
  residualShareAfter: number
  modelCode: string | null
}

export interface DimensionMatrix {
  aDimensionId: string
  bDimensionId: string
  redundancy: number | null
  harvested: boolean
  skipReason: string | null
  cells: Array<{ aValueId: string; bValueId: string; observed: number }>
}

export interface DimensionGap {
  id: string
  aDimensionId: string
  aDimensionLabel: string
  aValueId: string
  aValueLabel: string
  bDimensionId: string
  bDimensionLabel: string
  bValueId: string
  bValueLabel: string
  observed: number
  marginA: number
  marginB: number
  expected: number
  z: number
  rarity: number
  nearMissB: { valueId: string; valueLabel: string; families: number } | null
  nearMissA: { valueId: string; valueLabel: string; families: number } | null
  unassignedOnB: number
  unassignedOnA: number
  armFamilies: number | null
  armClaimsReadable: number | null
  coverageSuspect: boolean
  suspectReason: string | null
  rank: number
  hypothesisId: string | null
}

export interface DimensionMapResult {
  familyCount: number
  publicationCount: number
  sample: { families: number; weight: number; method: string }
  registry: Dimension[]
  rounds: DimensionRound[]
  settled: boolean
  settledReason:
    | 'RESIDUAL_UNDER_FLOOR'
    | 'NO_ACCEPTED_ADDITIONS'
    | 'REGISTRY_FULL'
    | 'MAX_ROUNDS'
    | 'REGISTRY_SUPPLIED'
  matrices: DimensionMatrix[]
  gaps: DimensionGap[]
  thresholds: {
    marginFloor: number
    expectedFloor: number
    residualCeiling: number
    redundancyCeiling: number
  }
  unclassifiedFamilies: number
  unclassifiedShare: number
  coverageNotes: string[]
  limitations: string[]
  /** How the concept list was turned into this field; absent on runs before the rule existed. */
  fieldRule?: FieldRule
  generatedAt: string
}

/** Client mirror of FieldRule / FieldRuleRung (src/lib/whitespace/types.ts). */
export interface FieldRuleRung {
  minimumOptional: number
  publications: number | null
  families: number | null
  overCap: boolean
  timedOut: boolean
  skipped: boolean
}

export interface FieldRule {
  mode: 'auto' | 'pinned'
  requiredCount: number
  optionalCount: number
  minimumOptional: number
  fit: 'in-band' | 'too-narrow' | 'too-broad' | 'cliff' | 'pinned' | 'none'
  ladder: FieldRuleRung[]
  band: { minFamilies: number; maxPublications: number }
}

/**
 * Categorical hues for viewpoints.
 *
 * Deliberately clear of cobalt (`lamp`/`primary`), which means action and AI
 * throughout this product — the same rule the ideation mind-map states for its
 * family colours. Values within a viewpoint use one hue at varying strength.
 */
export const DIMENSION_HUES = [
  { name: 'emerald', chip: 'bg-emerald-50 text-emerald-800 border-emerald-200', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  { name: 'amber', chip: 'bg-amber-50 text-amber-900 border-amber-200', bar: 'bg-amber-500', dot: 'bg-amber-500' },
  { name: 'violet', chip: 'bg-violet-50 text-violet-800 border-violet-200', bar: 'bg-violet-500', dot: 'bg-violet-500' },
  { name: 'rose', chip: 'bg-rose-50 text-rose-800 border-rose-200', bar: 'bg-rose-500', dot: 'bg-rose-500' },
  { name: 'teal', chip: 'bg-teal-50 text-teal-800 border-teal-200', bar: 'bg-teal-500', dot: 'bg-teal-500' },
  { name: 'orange', chip: 'bg-orange-50 text-orange-900 border-orange-200', bar: 'bg-orange-500', dot: 'bg-orange-500' },
  { name: 'fuchsia', chip: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200', bar: 'bg-fuchsia-500', dot: 'bg-fuchsia-500' },
  { name: 'lime', chip: 'bg-lime-50 text-lime-900 border-lime-200', bar: 'bg-lime-600', dot: 'bg-lime-600' },
] as const

export function hueFor(index: number) {
  return DIMENSION_HUES[index % DIMENSION_HUES.length]
}

export const REJECTION_LABEL: Record<RejectionReason, string> = {
  BELOW_SAMPLE_FLOOR: 'too rare to be a category',
  DUPLICATE_OF_EXISTING: 'already covered',
  DIMENSION_RESTATES_EXISTING: 'restates another viewpoint',
  EXPLAINS_TOO_LITTLE_RESIDUAL: 'explains too little',
  QUERY_STEMS_TO_NOTHING: 'no searchable words',
  REGISTRY_FULL: 'registry full',
}

export const SETTLED_LABEL: Record<DimensionMapResult['settledReason'], string> = {
  RESIDUAL_UNDER_FLOOR: 'settled — nearly every family is placed',
  NO_ACCEPTED_ADDITIONS: 'settled — a further round found nothing new',
  REGISTRY_FULL: 'stopped — the registry reached its size limit',
  MAX_ROUNDS: 'stopped at the round limit — more viewpoints may exist',
  REGISTRY_SUPPLIED: 'recounted against your edited viewpoints',
}
