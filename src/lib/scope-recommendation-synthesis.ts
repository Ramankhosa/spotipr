import type {
  ScopeClaimUse,
  ScopeSourceType,
  ScopeUseSelection,
} from '@/lib/scope-recommendations'

/**
 * Deterministic Stage 0 scope synthesis.
 *
 * In the split-call normalization flow, the core-extraction LLM call returns
 * lightweight inline scope enums on each component / claimable feature instead
 * of a full scopeRecommendations object. This module re-projects those enums
 * into the scopeRecommendations shape consumed downstream. The output is still
 * passed through coerceScopeRecommendations, which generates element ids,
 * dedupes by label/sourceType, and fills the basis from normalizedData.
 */

export type InlineScope = Partial<ScopeUseSelection> & { why?: string }

const CLAIM_VALUES = new Set(['claim_1', 'dependent_claim', 'none'])
const NUMBERING_VALUES = new Set(['number', 'do_not_number'])
const FIGURE_VALUES = new Set(['include', 'optional', 'do_not_show'])
const DESCRIPTION_VALUES = new Set(['exclude', 'include', 'optional'])

// Permissive defaults: an omitted or invalid inline enum must never exclude a
// source-stated component from claims/numbering/figures downstream.
const COMPONENT_DEFAULTS: ScopeUseSelection = {
  claim: 'dependent_claim',
  numbering: 'number',
  figures: 'include',
  description: 'include',
}

const FEATURE_DEFAULTS: ScopeUseSelection = {
  claim: 'dependent_claim',
  numbering: 'do_not_number',
  figures: 'optional',
  description: 'include',
}

const FALLBACK_LIMITATION_DEFAULTS: ScopeUseSelection = {
  claim: 'dependent_claim',
  numbering: 'do_not_number',
  figures: 'do_not_show',
  description: 'include',
}

const DO_NOT_CLAIM_DEFAULTS: ScopeUseSelection = {
  claim: 'none',
  numbering: 'do_not_number',
  figures: 'do_not_show',
  description: 'optional',
}

// Keyed `${patentType}|${sourceType}|${claim}`, matched with wildcard
// fallbacks: exact -> *|sourceType|claim -> *|*|claim -> generic.
const REASON_RULES: Record<string, string> = {
  'PRODUCT|component|claim_1': 'Core structural element required for the broad product claim.',
  'PRODUCT|component|dependent_claim': 'Source-stated feature suitable for a narrowing dependent claim.',
  'SYSTEM|component|claim_1': 'Cooperating subsystem needed for the independent system claim.',
  'SYSTEM|component|dependent_claim': 'Optional or narrowing subsystem for dependent claims.',
  'PROCESS|process_step|claim_1': 'Essential method step for the independent process claim.',
  'PROCESS|process_step|dependent_claim': 'Optional or refining step suitable for a dependent claim.',
  'COMPOSITION|constituent|claim_1': 'Essential constituent of the claimed composition.',
  'COMPOSITION|constituent|dependent_claim': 'Optional constituent or range for dependent claims.',
  '*|subcomponent|dependent_claim': 'Subcomponent detail appropriate for dependent-claim narrowing.',
  '*|other|dependent_claim': 'Source-stated claimable feature reserved for dependent claims.',
  '*|*|claim_1': 'Source-supported core element required for the independent claim.',
  '*|*|none': 'Context or unsupported detail; not promoted into claims.',
}

const GENERIC_REASON = 'Deterministic Stage 0 scope recommendation from normalized components.'

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function pickEnum<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  const candidate = cleanText(value).toLowerCase()
  return allowed.has(candidate) ? (candidate as T) : fallback
}

function normalizeInlineScope(scope: unknown, defaults: ScopeUseSelection): ScopeUseSelection {
  const raw = (scope && typeof scope === 'object') ? (scope as Record<string, unknown>) : {}
  return {
    claim: pickEnum(raw.claim, CLAIM_VALUES, defaults.claim),
    numbering: pickEnum(raw.numbering, NUMBERING_VALUES, defaults.numbering),
    figures: pickEnum(raw.figures, FIGURE_VALUES, defaults.figures),
    description: pickEnum(raw.description, DESCRIPTION_VALUES, defaults.description),
  }
}

function reasonFor(
  patentType: string,
  sourceType: ScopeSourceType,
  claim: ScopeClaimUse,
  why: unknown
): string {
  const explicit = cleanText(why)
  if (explicit) return explicit
  return (
    REASON_RULES[`${patentType}|${sourceType}|${claim}`] ||
    REASON_RULES[`*|${sourceType}|${claim}`] ||
    REASON_RULES[`*|*|${claim}`] ||
    GENERIC_REASON
  )
}

function componentSourceType(component: Record<string, any>, patentType: string): ScopeSourceType {
  const level = typeof component?.level === 'number' ? component.level : 0
  const parent = cleanText(component?.parent)
  if (level >= 1 || parent) return 'subcomponent'
  if (patentType === 'PROCESS') return 'process_step'
  if (patentType === 'COMPOSITION') return 'constituent'
  return 'component'
}

/** Extracts the feature text from either a plain string or a `{ feature, scope }` object. */
function featureText(entry: unknown): string {
  if (typeof entry === 'string') return cleanText(entry)
  if (entry && typeof entry === 'object') {
    const raw = entry as Record<string, unknown>
    return cleanText(raw.feature ?? raw.label ?? raw.value ?? raw.text)
  }
  return ''
}

function featureScope(entry: unknown): unknown {
  if (entry && typeof entry === 'object') return (entry as Record<string, unknown>).scope
  return undefined
}

function featureWhy(entry: unknown): unknown {
  const scope = featureScope(entry)
  if (scope && typeof scope === 'object') return (scope as Record<string, unknown>).why
  return undefined
}

function stringEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => featureText(entry))
    .filter((text) => text && !/^not stated by source$/i.test(text))
}

export function synthesizeScopeRecommendations(core: Record<string, any>): {
  scopeRecommendations: Record<string, any> | undefined
  claimableFeatureTexts: string[]
} {
  const patentType = cleanText(core?.patentTypePrimary).toUpperCase()
  const components = Array.isArray(core?.components) ? core.components : []
  const claimableFeaturesRaw = Array.isArray(core?.claimableFeatures) ? core.claimableFeatures : []

  const claimableFeatureTexts = claimableFeaturesRaw
    .map((entry: unknown) => featureText(entry))
    .filter(Boolean)

  const elements: Record<string, any>[] = []

  components.forEach((component: any, index: number) => {
    const label = cleanText(component?.name)
    if (!label) return
    const sourceType = componentSourceType(component || {}, patentType)
    const recommended = normalizeInlineScope(component?.scope, COMPONENT_DEFAULTS)
    elements.push({
      label,
      sourceType,
      recommended,
      reason: reasonFor(patentType, sourceType, recommended.claim, component?.scope?.why),
      sourceRefs: [`components[${index}]`],
    })
  })

  claimableFeaturesRaw.forEach((entry: unknown, index: number) => {
    const label = featureText(entry)
    if (!label || /^not stated by source$/i.test(label)) return
    const recommended = normalizeInlineScope(featureScope(entry), FEATURE_DEFAULTS)
    elements.push({
      label,
      sourceType: 'other' as ScopeSourceType,
      recommended,
      reason: reasonFor(patentType, 'other', recommended.claim, featureWhy(entry)),
      sourceRefs: [`claimableFeatures[${index}]`],
    })
  })

  stringEntries(core?.fallbackLimitations).forEach((label, index) => {
    elements.push({
      label,
      sourceType: 'condition' as ScopeSourceType,
      recommended: { ...FALLBACK_LIMITATION_DEFAULTS },
      reason: 'Source-stated fallback or limiting condition reserved for dependent-claim narrowing.',
      sourceRefs: [`fallbackLimitations[${index}]`],
    })
  })

  stringEntries(core?.doNotClaim).forEach((label, index) => {
    elements.push({
      label,
      sourceType: 'other' as ScopeSourceType,
      recommended: { ...DO_NOT_CLAIM_DEFAULTS },
      reason: 'Not source-supported as a required feature; excluded from claims.',
      sourceRefs: [`doNotClaim[${index}]`],
    })
  })

  if (elements.length === 0) {
    return { scopeRecommendations: undefined, claimableFeatureTexts }
  }

  return {
    scopeRecommendations: {
      version: 1,
      generatedAt: new Date().toISOString(),
      basis: {
        patentTypePrimary: patentType || undefined,
        inventionType: Array.isArray(core?.inventionType)
          ? core.inventionType.map((entry: unknown) => cleanText(entry)).filter(Boolean)
          : undefined,
        fieldOfRelevance: cleanText(core?.fieldOfRelevance) || undefined,
        subfield: cleanText(core?.subfield) || undefined,
      },
      elements,
    },
    claimableFeatureTexts,
  }
}
