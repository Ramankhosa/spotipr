// Finding codes raised by the office-form validator.
//
// Kept in a leaf module so claim-challenge-lint.ts (which the validator
// imports for its rule implementations) can widen its finding type with these
// codes without importing the validator back.

export const OFFICE_FORM_CODES = [
  // Structure — fixed deterministically by the normaliser.
  'NUMBERING_GAP',
  'DEPENDENT_BEFORE_PARENT',
  'DEPENDENT_PHRASE_FORM',
  'PREAMBLE_NOUN_MISMATCH',
  'OPENING_ARTICLE',
  'TRAILING_PERIOD',
  'CHARACTERISED_SPELLING',
  'MARKUSH_OPEN_GROUP',
  'CRM_NOT_NON_TRANSITORY',
  'MULTIPLE_DEPENDENCY_FORM',
  // Form — an LLM repair pass or the attorney.
  'ANTECEDENT_BASIS',
  'FORBIDDEN_PHRASE',
  'USE_CLAIM',
  'METHOD_OF_TREATMENT',
  'SWISS_TYPE_FORM',
  'SECOND_MEDICAL_USE',
  'CRM_FORM_NOT_RECOMMENDED',
  'PROGRAM_PER_SE',
  'ELIGIBILITY_TECHNICAL_ANCHOR',
  'INDEPENDENT_PER_CATEGORY_EXCEEDED',
  'UNITY_BREAK',
  'CATEGORY_MIX',
  'RESULT_ONLY_LIMITATION',
  'UNSUPPORTED_NUMBER',
  'TWO_PART_FORM_MISSING',
  'TWO_PART_FORM_DISCOURAGED',
  'REFERENCE_NUMERAL_FORM',
  'PRODUCT_BY_PROCESS',
  'INDIAN_3D_FORM',
  'INDIAN_3E_ADMIXTURE',
  'OMNIBUS_CLAIM_EXPECTED',
  'CLAIM_COUNT_OVER_FREE',
  'INDEPENDENT_COUNT_OVER_FREE',
  'TAUTOLOGY',
  'EXPERIMENTAL_PARAMETER',
  // Normalisation-only codes (never findings): terminology substitution from the strategy map.
  'TERMINOLOGY_MAP',
  'TERMINOLOGY_RETAINED',
] as const

export type OfficeFormCode = (typeof OFFICE_FORM_CODES)[number]
