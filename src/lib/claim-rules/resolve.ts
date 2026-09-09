// Resolves the claim-rule profile for a jurisdiction.
//
// Order: built-in default for the office (defaults.ts) → the profile's legacy
// fields under rules.claims (twoPartFormPreferred, allowMultipleDependent, …)
// → the profile's structured fields, when present. A DB value that is not a
// valid member of its enum is ignored and reported as drift; it never becomes
// a rule the model is told and the validator enforces.

import type { ClaimRuleProfile, ClaimRuleProfileOverrides } from './types'
import {
  CLAIM_RULE_LANGUAGES,
  CLAIM_ORDERINGS,
  CRM_CLAIM_FORMS,
  DEPENDENT_CLAIM_PHRASES,
  MEDICAL_METHOD_CLAIM_MODES,
  MULTIPLE_DEPENDENCY_MODES,
  OMNIBUS_CLAIM_MODES,
  PRODUCT_BY_PROCESS_MODES,
  REFERENCE_NUMERAL_MODES,
  TWO_PART_FORMS,
  USE_CLAIM_MODES,
  ClaimRuleProfileSchema,
} from './types'
import { CLAIM_RULE_DEFAULTS, GENERIC_CLAIM_RULES, canonicalClaimRuleCode } from './defaults'

export type ClaimRuleDrift = { field: string; value: unknown; reason: string }

export type ResolvedClaimRules = {
  rules: ClaimRuleProfile
  drift: ClaimRuleDrift[]
  /** True when the office has no built-in profile and the neutral rules were used. */
  generic: boolean
}

const MAX_NOTES = 8
const MAX_NOTE_CHARS = 400
const MIN_BUDGET = 5
const MAX_BUDGET = 30

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.map(item => String(item ?? '').trim()).filter(Boolean)
}

function pickEnum<T extends readonly string[]>(
  values: T,
  field: string,
  raw: unknown,
  drift: ClaimRuleDrift[]
): T[number] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const value = String(raw).trim()
  if ((values as readonly string[]).includes(value)) return value as T[number]
  drift.push({ field, value: raw, reason: `not one of ${values.join('|')}` })
  return undefined
}

function pickCount(field: string, raw: unknown, drift: ClaimRuleDrift[]): number | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  const value = Number(raw)
  if (Number.isInteger(value) && value >= 0) return value
  drift.push({ field, value: raw, reason: 'not a non-negative integer' })
  return undefined
}

/**
 * Builds the profile for `jurisdiction` from the built-in default and the
 * profile's rules.claims block (legacy and structured fields alike).
 */
export function resolveClaimRuleProfile(
  jurisdiction: string | null | undefined,
  dbRulesClaims?: unknown,
  meta?: { name?: string; office?: string } | null
): ResolvedClaimRules {
  const code = canonicalClaimRuleCode(jurisdiction)
  const base = CLAIM_RULE_DEFAULTS[code]
  const generic = !base
  const rules: ClaimRuleProfile = {
    ...(base || GENERIC_CLAIM_RULES),
    jurisdiction: code || GENERIC_CLAIM_RULES.jurisdiction,
    preferredTransitions: [...(base || GENERIC_CLAIM_RULES).preferredTransitions],
    discouragedTransitions: [...(base || GENERIC_CLAIM_RULES).discouragedTransitions],
    forbiddenPhrases: [...(base || GENERIC_CLAIM_RULES).forbiddenPhrases],
    excludedSubjectMatter: [...(base || GENERIC_CLAIM_RULES).excludedSubjectMatter],
    notes: [],
  }
  const drift: ClaimRuleDrift[] = []

  if (meta && typeof meta.office === 'string' && meta.office.trim()) {
    rules.office = meta.office.trim()
  }

  const db = dbRulesClaims && typeof dbRulesClaims === 'object' ? (dbRulesClaims as Record<string, any>) : null
  if (!db) {
    return { rules: finalise(rules, drift), drift, generic }
  }

  // ── Legacy booleans / numbers ─────────────────────────────────────────────
  if (db.allowMultipleDependent === false) {
    rules.multipleDependencyMode = 'none'
  }
  if (typeof db.prohibitMultipleDependentOnMultipleDependent === 'boolean') {
    rules.multiOnMultiProhibited = db.prohibitMultipleDependentOnMultipleDependent
  }
  if (db.twoPartFormPreferred === true && !['required', 'preferred'].includes(rules.twoPartForm)) {
    rules.twoPartForm = 'preferred'
  } else if (db.twoPartFormPreferred === false && !['optional', 'discouraged'].includes(rules.twoPartForm)) {
    rules.twoPartForm = 'optional'
  }
  const preferred = stringArray(db.preferredConnectors)
  if (preferred && preferred.length) rules.preferredTransitions = preferred
  const discouraged = stringArray(db.discouragedConnectors)
  if (discouraged) rules.discouragedTransitions = discouraged
  const forbidden = stringArray(db.forbiddenPhrases)
  if (forbidden) rules.forbiddenPhrases = forbidden
  if (db.allowReferenceNumeralsInClaims === false) {
    rules.referenceNumerals = 'not_allowed'
  }
  if (typeof db.requireSupportInDescription === 'boolean') {
    rules.requireSupportInDescription = db.requireSupportInDescription
  }
  if (typeof db.unityStandard === 'string' && db.unityStandard.trim()) {
    rules.unityStandard = db.unityStandard.trim().replace(/_/g, ' ')
  }
  const recommended = Number(db.maxTotalClaimsRecommended)
  if (Number.isInteger(recommended) && recommended > 0) {
    rules.defaultClaimBudget = Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, recommended))
  }

  // Fee model. The legacy `maxIndependentClaimsBeforeExtraFee` carries three
  // meanings across the profiles (a fee threshold, "no fee" as 0, "no free
  // claims" as 0, and EP's Rule 43(2) count as 1), so it is only trusted when
  // the fee model says independents are what the fee counts.
  const feeModel = db.feeModel && typeof db.feeModel === 'object' ? (db.feeModel as Record<string, any>) : null
  const independentsBeforeFee = Number(db.maxIndependentClaimsBeforeExtraFee)
  if (feeModel?.extraFeeBasedOnIndependents === true && Number.isInteger(independentsBeforeFee) && independentsBeforeFee > 0) {
    rules.freeIndependentClaims = independentsBeforeFee
  }
  if (feeModel) {
    const included = Number(feeModel.claimsIncludedInBasicFee)
    if (Number.isInteger(included) && included > 0) rules.freeTotalClaims = included
    if (feeModel.perClaimFeeFromFirstClaim === true) rules.freeTotalClaims = 0
    if (typeof feeModel.note === 'string' && feeModel.note.trim()) rules.feeNote = feeModel.note.trim()
  }
  const notes = stringArray(db.notes)
  if (notes) rules.notes = notes.slice(0, MAX_NOTES).map(note => note.slice(0, MAX_NOTE_CHARS))

  // ── Structured overrides ──────────────────────────────────────────────────
  const overrides: ClaimRuleProfileOverrides = {}
  overrides.dependentClaimPhrase = pickEnum(DEPENDENT_CLAIM_PHRASES, 'dependentClaimPhrase', db.dependentClaimPhrase, drift)
  overrides.multipleDependencyMode = pickEnum(MULTIPLE_DEPENDENCY_MODES, 'multipleDependencyMode', db.multipleDependencyMode, drift)
  overrides.twoPartForm = pickEnum(TWO_PART_FORMS, 'twoPartForm', db.twoPartForm, drift)
  overrides.useClaims = pickEnum(USE_CLAIM_MODES, 'useClaims', db.useClaims, drift)
  overrides.medicalMethodClaims = pickEnum(MEDICAL_METHOD_CLAIM_MODES, 'medicalMethodClaims', db.medicalMethodClaims, drift)
  overrides.crmClaimForm = pickEnum(CRM_CLAIM_FORMS, 'crmClaimForm', db.crmClaimForm, drift)
  overrides.referenceNumerals = pickEnum(REFERENCE_NUMERAL_MODES, 'referenceNumerals', db.referenceNumerals, drift)
  overrides.omnibusClaims = pickEnum(OMNIBUS_CLAIM_MODES, 'omnibusClaims', db.omnibusClaims, drift)
  overrides.productByProcess = pickEnum(PRODUCT_BY_PROCESS_MODES, 'productByProcess', db.productByProcess, drift)
  overrides.claimOrdering = pickEnum(CLAIM_ORDERINGS, 'claimOrdering', db.claimOrdering, drift)
  overrides.language = pickEnum(CLAIM_RULE_LANGUAGES, 'language', db.language, drift)
  overrides.characterisedSpelling = pickEnum(['s', 'z'] as const, 'characterisedSpelling', db.characterisedSpelling, drift)
  if (typeof db.multiOnMultiProhibited === 'boolean') overrides.multiOnMultiProhibited = db.multiOnMultiProhibited
  if (typeof db.singleIndependentPerCategory === 'boolean') overrides.singleIndependentPerCategory = db.singleIndependentPerCategory
  if (typeof db.softwareEligibilityDoctrine === 'string' && db.softwareEligibilityDoctrine.trim()) {
    overrides.softwareEligibilityDoctrine = db.softwareEligibilityDoctrine.trim()
  }
  const excluded = stringArray(db.excludedSubjectMatter)
  if (excluded) overrides.excludedSubjectMatter = excluded
  const freeTotal = pickCount('freeTotalClaims', db.freeTotalClaims, drift)
  if (freeTotal !== undefined) overrides.freeTotalClaims = freeTotal
  const freeIndependent = pickCount('freeIndependentClaims', db.freeIndependentClaims, drift)
  if (freeIndependent !== undefined) overrides.freeIndependentClaims = freeIndependent
  const budget = Number(db.defaultClaimBudget)
  if (db.defaultClaimBudget !== undefined) {
    if (Number.isInteger(budget) && budget >= MIN_BUDGET && budget <= MAX_BUDGET) overrides.defaultClaimBudget = budget
    else drift.push({ field: 'defaultClaimBudget', value: db.defaultClaimBudget, reason: `outside ${MIN_BUDGET}-${MAX_BUDGET}` })
  }
  if (typeof db.feeNote === 'string' && db.feeNote.trim()) overrides.feeNote = db.feeNote.trim()

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) (rules as any)[key] = value
  }

  return { rules: finalise(rules, drift), drift, generic }
}

function finalise(rules: ClaimRuleProfile, drift: ClaimRuleDrift[]): ClaimRuleProfile {
  const parsed = ClaimRuleProfileSchema.safeParse(rules)
  if (parsed.success) return parsed.data as ClaimRuleProfile
  // Should be unreachable: every overlay is validated before it is applied. If
  // it happens, the built-in default is safer than a half-applied overlay.
  drift.push({ field: '(profile)', value: parsed.error.issues.map(issue => issue.path.join('.')).join(','), reason: 'profile failed schema validation; built-in default used' })
  const fallback = CLAIM_RULE_DEFAULTS[rules.jurisdiction] || GENERIC_CLAIM_RULES
  return { ...fallback, jurisdiction: rules.jurisdiction }
}
