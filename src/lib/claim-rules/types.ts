// Structured claim-drafting rules for one patent office.
//
// Before this module the runtime knew nine loosely typed booleans and numbers
// from CountryProfile.profileData.rules.claims, rendered as prose. Everything
// that decides claim FORM — dependent-claim phrasing, multiple-dependency mode,
// two-part form, which statutory categories exist, how software and medical
// subject-matter must be claimed, fee thresholds — lived only in top-up prose
// or nowhere. The office-form validator, the normaliser and the prompt block
// all key off this one profile, so the rule that is enforced is the rule that
// was told to the model.

import { z } from 'zod'

export const DEPENDENT_CLAIM_PHRASES = ['of', 'according_to', 'as_claimed_in', 'characterized'] as const
export type DependentClaimPhrase = (typeof DEPENDENT_CLAIM_PHRASES)[number]

export const MULTIPLE_DEPENDENCY_MODES = ['none', 'alternative_only', 'any'] as const
export type MultipleDependencyMode = (typeof MULTIPLE_DEPENDENCY_MODES)[number]

export const TWO_PART_FORMS = ['required', 'preferred', 'optional', 'discouraged'] as const
export type TwoPartForm = (typeof TWO_PART_FORMS)[number]

export const USE_CLAIM_MODES = ['allowed', 'allowed_as_method', 'not_allowed'] as const
export type UseClaimMode = (typeof USE_CLAIM_MODES)[number]

export const MEDICAL_METHOD_CLAIM_MODES = [
  'allowed',
  'allowed_with_for_use_mirror',
  'for_use_only',
  'swiss_type_only',
  'composition_only',
  'use_claim_only',
] as const
export type MedicalMethodClaimMode = (typeof MEDICAL_METHOD_CLAIM_MODES)[number]

export const CRM_CLAIM_FORMS = [
  'non_transitory_medium',
  'program_and_medium',
  'program_stored_in_medium',
  'medium_and_program_product',
  'medium_only',
  'not_recommended',
] as const
export type CrmClaimForm = (typeof CRM_CLAIM_FORMS)[number]

export const REFERENCE_NUMERAL_MODES = ['optional', 'recommended_if_drawings', 'permitted', 'not_allowed'] as const
export type ReferenceNumeralMode = (typeof REFERENCE_NUMERAL_MODES)[number]

export const OMNIBUS_CLAIM_MODES = ['forbidden', 'permitted', 'customary'] as const
export type OmnibusClaimMode = (typeof OMNIBUS_CLAIM_MODES)[number]

export const PRODUCT_BY_PROCESS_MODES = ['allowed', 'only_if_necessary'] as const
export type ProductByProcessMode = (typeof PRODUCT_BY_PROCESS_MODES)[number]

export const CLAIM_ORDERINGS = ['grouped_by_category', 'decreasing_scope'] as const
export type ClaimOrdering = (typeof CLAIM_ORDERINGS)[number]

export const CLAIM_RULE_LANGUAGES = ['en', 'pt-BR', 'ru'] as const
export type ClaimRuleLanguage = (typeof CLAIM_RULE_LANGUAGES)[number]

/** Bump when a default changes in a way that alters findings; persisted in every report. */
export const CLAIM_RULES_VERSION = 1

export type ClaimRuleProfile = {
  jurisdiction: string
  office: string
  language: ClaimRuleLanguage
  rulesVersion: number

  // Form
  dependentClaimPhrase: DependentClaimPhrase
  multipleDependencyMode: MultipleDependencyMode
  multiOnMultiProhibited: boolean
  twoPartForm: TwoPartForm
  characterisedSpelling: 's' | 'z'
  /** EPC Rule 43(2): one independent claim per category save the listed exceptions. */
  singleIndependentPerCategory: boolean
  referenceNumerals: ReferenceNumeralMode
  omnibusClaims: OmnibusClaimMode
  claimOrdering: ClaimOrdering
  preferredTransitions: string[]
  discouragedTransitions: string[]
  forbiddenPhrases: string[]

  // Eligibility and category conversions
  useClaims: UseClaimMode
  medicalMethodClaims: MedicalMethodClaimMode
  crmClaimForm: CrmClaimForm
  softwareEligibilityDoctrine: string
  excludedSubjectMatter: string[]
  productByProcess: ProductByProcessMode

  // Count and fees
  /** null = no threshold; 0 = every claim carries a fee. */
  freeTotalClaims: number | null
  freeIndependentClaims: number | null
  /** Default generation cap when the attorney does not ask for a count. */
  defaultClaimBudget: number
  feeNote: string

  // Support and unity
  requireSupportInDescription: boolean
  unityStandard: string
  /** Free-text profile notes; rendered after the structured rules, capped. */
  notes: string[]
}

const enumOf = <T extends readonly string[]>(values: T) => z.enum(values as unknown as [T[number], ...T[number][]])

export const ClaimRuleProfileSchema = z.object({
  jurisdiction: z.string().min(2),
  office: z.string().min(1),
  language: enumOf(CLAIM_RULE_LANGUAGES),
  rulesVersion: z.number().int().positive(),
  dependentClaimPhrase: enumOf(DEPENDENT_CLAIM_PHRASES),
  multipleDependencyMode: enumOf(MULTIPLE_DEPENDENCY_MODES),
  multiOnMultiProhibited: z.boolean(),
  twoPartForm: enumOf(TWO_PART_FORMS),
  characterisedSpelling: z.enum(['s', 'z']),
  singleIndependentPerCategory: z.boolean(),
  referenceNumerals: enumOf(REFERENCE_NUMERAL_MODES),
  omnibusClaims: enumOf(OMNIBUS_CLAIM_MODES),
  claimOrdering: enumOf(CLAIM_ORDERINGS),
  preferredTransitions: z.array(z.string()),
  discouragedTransitions: z.array(z.string()),
  forbiddenPhrases: z.array(z.string()),
  useClaims: enumOf(USE_CLAIM_MODES),
  medicalMethodClaims: enumOf(MEDICAL_METHOD_CLAIM_MODES),
  crmClaimForm: enumOf(CRM_CLAIM_FORMS),
  softwareEligibilityDoctrine: z.string().min(1),
  excludedSubjectMatter: z.array(z.string()),
  productByProcess: enumOf(PRODUCT_BY_PROCESS_MODES),
  freeTotalClaims: z.number().int().min(0).nullable(),
  freeIndependentClaims: z.number().int().min(0).nullable(),
  defaultClaimBudget: z.number().int().min(3).max(50),
  feeNote: z.string(),
  requireSupportInDescription: z.boolean(),
  unityStandard: z.string(),
  notes: z.array(z.string()),
})

/**
 * The optional structured fields a country profile may carry under
 * rules.claims in addition to the legacy booleans. Every field is optional so
 * an existing profile stays valid; a present field overrides the built-in
 * default for that office.
 */
export type ClaimRuleProfileOverrides = Partial<
  Pick<
    ClaimRuleProfile,
    | 'dependentClaimPhrase'
    | 'multipleDependencyMode'
    | 'multiOnMultiProhibited'
    | 'twoPartForm'
    | 'characterisedSpelling'
    | 'singleIndependentPerCategory'
    | 'referenceNumerals'
    | 'omnibusClaims'
    | 'claimOrdering'
    | 'useClaims'
    | 'medicalMethodClaims'
    | 'crmClaimForm'
    | 'softwareEligibilityDoctrine'
    | 'excludedSubjectMatter'
    | 'productByProcess'
    | 'freeTotalClaims'
    | 'freeIndependentClaims'
    | 'defaultClaimBudget'
    | 'feeNote'
    | 'language'
  >
>

export type OfficeFormSeverity = 'block' | 'warn' | 'info'
export type OfficeFormFix = 'auto' | 'llm' | 'manual'

export type OfficeFormFinding = {
  /** Stable within one report (F1, F2, …); used as the remark id in a repair pass. */
  id: string
  code: string
  severity: OfficeFormSeverity
  fix: OfficeFormFix
  /** null = a finding about the claim set as a whole. */
  claimNumber: number | null
  excerpt: string
  /** Office voice: what the objection would say, never what the model thinks. */
  message: string
  /** The statute, rule or guideline the finding rests on. */
  basis: string
  jurisdiction: string
}

export type ClaimNormalisationChange = {
  claimNumber: number
  code: string
  before: string
  after: string
}

export type ClaimFormRepairRecord = {
  attempted: boolean
  resolvedFindingIds: string[]
  unresolvedFindingIds: string[]
  changedClaimNumbers: number[]
  addedClaimNumbers: number[]
  /** Why a repair was not applied (guard refusal, model failure). Internal, not for the UI. */
  refusalReason?: string
}

export type ClaimFormReport = {
  generatedAt: string
  jurisdiction: string
  rulesVersion: number
  /** Client-computable signature of the claim set the report describes. */
  claimsSignature: string
  findings: OfficeFormFinding[]
  normalisation: ClaimNormalisationChange[]
  repair: ClaimFormRepairRecord | null
  counts: {
    total: number
    independent: number
    freeTotal: number | null
    freeIndependent: number | null
  }
}
