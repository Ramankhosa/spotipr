export type ScopePatentTypePrimary = 'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION'

export type ScopeSourceType =
  | 'component' | 'subcomponent' | 'process_step' | 'method_step'
  | 'constituent' | 'compound' | 'formulation' | 'material'
  | 'biological_entity' | 'sequence' | 'cell' | 'protein'
  | 'reagent' | 'sample' | 'assay_step' | 'therapeutic_step'
  | 'diagnostic_marker' | 'manufacturing_step' | 'condition'
  | 'range' | 'data_field' | 'interface' | 'use_case'
  | 'environment' | 'other'

export type ScopeClaimUse = 'claim_1' | 'dependent_claim' | 'none'
export type ScopeNumberingUse = 'number' | 'do_not_number'
export type ScopeFiguresUse = 'include' | 'optional' | 'do_not_show'
export type ScopeDescriptionUse = 'include' | 'optional' | 'exclude'

export type ScopeUseSelection = {
  claim: ScopeClaimUse
  numbering: ScopeNumberingUse
  figures: ScopeFiguresUse
  description: ScopeDescriptionUse
}

export type ScopeRecommendationElement = {
  id: string
  label: string
  sourceType: ScopeSourceType
  recommended: ScopeUseSelection
  user?: Partial<ScopeUseSelection>
  reason: string
  sourceRefs: string[]
}

export type ScopeRecommendations = {
  version: 1
  generatedAt: string
  basis: {
    patentTypePrimary: ScopePatentTypePrimary
    inventionType: string[]
    fieldOfRelevance?: string
    subfield?: string
  }
  elements: ScopeRecommendationElement[]
}

export type FigureScopeFilterResult<T = any> = {
  components: T[]
  excludedLabels: string[]
  includedLabels: string[]
  optionalLabels: string[]
}

const SOURCE_TYPES: ScopeSourceType[] = [
  'component', 'subcomponent', 'process_step', 'method_step',
  'constituent', 'compound', 'formulation', 'material',
  'biological_entity', 'sequence', 'cell', 'protein',
  'reagent', 'sample', 'assay_step', 'therapeutic_step',
  'diagnostic_marker', 'manufacturing_step', 'condition',
  'range', 'data_field', 'interface', 'use_case',
  'environment', 'other',
]

const CLAIM_VALUES: ScopeClaimUse[] = ['claim_1', 'dependent_claim', 'none']
const NUMBERING_VALUES: ScopeNumberingUse[] = ['number', 'do_not_number']
const FIGURE_VALUES: ScopeFiguresUse[] = ['include', 'optional', 'do_not_show']
const DESCRIPTION_VALUES: ScopeDescriptionUse[] = ['include', 'optional', 'exclude']

function clean(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  values.forEach((value) => {
    const normalized = clean(value)
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) return
    seen.add(key)
    out.push(normalized)
  })
  return out
}

function normalizePatentType(value: unknown): ScopePatentTypePrimary {
  const normalized = String(value || '').toUpperCase()
  if (normalized === 'PRODUCT' || normalized === 'SYSTEM' || normalized === 'PROCESS' || normalized === 'COMPOSITION') {
    return normalized
  }
  return 'SYSTEM'
}

function normalizeInventionTypes(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : []
  const normalized = unique(values.map(item => String(item || '').toUpperCase()).filter(Boolean))
  return normalized.length ? normalized : ['GENERAL']
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback
}

function normalizeSourceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return unique(value.map(item => clean(item)).filter(Boolean)).slice(0, 12)
}

export function scopeElementKey(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function makeElementId(label: string, sourceType: ScopeSourceType, index: number): string {
  const base = scopeElementKey(label).replace(/\s+/g, '_').slice(0, 48) || 'element'
  return `${sourceType}_${base}_${index + 1}`
}

function buildComponentLookup(normalizedComponents: any[]): Map<string, any> {
  const componentByLabel = new Map<string, any>()
  normalizedComponents.forEach((component) => {
    const keys = [
      component?.name,
      component?.label,
      component?.title,
      component?.id,
    ].map(scopeElementKey).filter(Boolean)

    keys.forEach((key) => {
      if (!componentByLabel.has(key)) componentByLabel.set(key, component)
    })
  })
  return componentByLabel
}

function findComponentBySourceRefs(sourceRefs: string[], normalizedComponents: any[]): any | undefined {
  for (const sourceRef of sourceRefs) {
    const match = sourceRef.match(/\bcomponents\[(\d+)\]/i)
    if (!match) continue
    const index = Number(match[1])
    if (Number.isInteger(index) && normalizedComponents[index]) {
      return normalizedComponents[index]
    }
  }
  return undefined
}

function componentsFromSourceRefs(sourceRefs: string[], normalizedComponents: any[]): any[] {
  const components: any[] = []
  const seen = new Set<number>()
  for (const sourceRef of sourceRefs) {
    const match = sourceRef.match(/\bcomponents\[(\d+)\]/i)
    if (!match) continue
    const index = Number(match[1])
    if (!Number.isInteger(index) || seen.has(index) || !normalizedComponents[index]) continue
    seen.add(index)
    components.push(normalizedComponents[index])
  }
  return components
}

function nameWithoutParenthetical(value: unknown): string {
  return clean(value).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

function meaningfulParentName(value: unknown): string {
  const normalized = clean(value)
  if (!normalized || /^not stated by source$/i.test(normalized) || /^(none|n\/a)$/i.test(normalized)) return ''
  return normalized
}

function sourceRefOverlap(component: any, element: ScopeRecommendationElement): number {
  const labelTokens = new Set(scopeElementKey(element.label).split(' ').filter(token => token.length > 2))
  const componentTokens = scopeElementKey(component?.name || component?.title || component?.label)
    .split(' ')
    .filter(token => token.length > 2)
  return componentTokens.filter(token => labelTokens.has(token)).length
}

function hasStrongSourceNameMatch(component: any, element: ScopeRecommendationElement): boolean {
  const labelKey = scopeElementKey(element.label)
  const idKey = scopeElementKey(element.id)
  const componentKey = scopeElementKey(nameWithoutParenthetical(component?.name || component?.title || component?.label))
  if (!componentKey) return false
  return labelKey.includes(componentKey) || idKey.includes(componentKey) || componentKey.includes(idKey)
}

function hasPrefixSourceNameMatch(component: any, element: ScopeRecommendationElement): boolean {
  const labelKey = scopeElementKey(element.label)
  const idKey = scopeElementKey(element.id)
  const componentKey = scopeElementKey(nameWithoutParenthetical(component?.name || component?.title || component?.label))
  if (!componentKey) return false
  return labelKey === componentKey
    || labelKey.startsWith(`${componentKey} `)
    || idKey === componentKey
    || idKey.startsWith(`${componentKey} `)
}

export function scopeTitleFromElement(element: ScopeRecommendationElement): string {
  const rawId = clean(element.id)
    .replace(/_[0-9]+$/g, '')
    .replace(/_/g, ' ')
  const title = clean(rawId)
  if (!title || title === element.sourceType) return element.label
  return title.charAt(0).toUpperCase() + title.slice(1)
}

export function sourceComponentForScopeElement(
  element: ScopeRecommendationElement,
  normalizedComponents: any[] = [],
  componentByLabel = buildComponentLookup(normalizedComponents)
): any | undefined {
  const sourceCandidates = componentsFromSourceRefs(element.sourceRefs, normalizedComponents)

  if (sourceCandidates.length >= 3) {
    const parentName = meaningfulParentName(sourceCandidates[0]?.parent)
    if (parentName && sourceCandidates.every(component => meaningfulParentName(component?.parent) === parentName)) {
      const parent = componentByLabel.get(scopeElementKey(parentName))
      if (parent) return parent
    }
  }

  if (sourceCandidates.length > 1) {
    const prefixCandidates = sourceCandidates.filter(component => hasPrefixSourceNameMatch(component, element))
    if (prefixCandidates.length === 1) return prefixCandidates[0]

    const overlappingCandidates = sourceCandidates.filter(component => sourceRefOverlap(component, element) >= 2)
    if (overlappingCandidates.length > 1) return undefined

    const matchedCandidates = sourceCandidates.filter(component => hasStrongSourceNameMatch(component, element))
    if (matchedCandidates.length === 1) return matchedCandidates[0]
  }

  return sourceCandidates[0]
    || findComponentBySourceRefs(element.sourceRefs, normalizedComponents)
    || componentByLabel.get(scopeElementKey(element.label))
    || componentByLabel.get(scopeElementKey(element.id))
}

function normalizeSelection(value: unknown): ScopeUseSelection {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    claim: pickEnum(record.claim, CLAIM_VALUES, 'none'),
    numbering: pickEnum(record.numbering, NUMBERING_VALUES, 'do_not_number'),
    figures: pickEnum(record.figures, FIGURE_VALUES, 'do_not_show'),
    description: pickEnum(record.description, DESCRIPTION_VALUES, 'optional'),
  }
}

function normalizeUserSelection(value: unknown): Partial<ScopeUseSelection> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const user: Partial<ScopeUseSelection> = {}
  if (CLAIM_VALUES.includes(record.claim as ScopeClaimUse)) user.claim = record.claim as ScopeClaimUse
  if (NUMBERING_VALUES.includes(record.numbering as ScopeNumberingUse)) user.numbering = record.numbering as ScopeNumberingUse
  if (FIGURE_VALUES.includes(record.figures as ScopeFiguresUse)) user.figures = record.figures as ScopeFiguresUse
  if (DESCRIPTION_VALUES.includes(record.description as ScopeDescriptionUse)) user.description = record.description as ScopeDescriptionUse
  return Object.keys(user).length ? user : undefined
}

export function coerceScopeRecommendations(
  value: unknown,
  normalizedData: Record<string, any> = {}
): ScopeRecommendations | undefined {
  const record = value && typeof value === 'object' ? value as Record<string, any> : null
  const rawElements = Array.isArray(record?.elements) ? record.elements : []
  if (!rawElements.length) return undefined

  const elements: ScopeRecommendationElement[] = []
  const seen = new Set<string>()

  rawElements.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const itemRecord = item as Record<string, any>
    const label = clean(itemRecord.label || itemRecord.name || itemRecord.title)
    if (!label || /^not stated by source$/i.test(label)) return
    const sourceType = pickEnum(itemRecord.sourceType, SOURCE_TYPES, 'other')
    const key = `${scopeElementKey(label)}::${sourceType}`
    if (seen.has(key)) return
    seen.add(key)

    const recommended = normalizeSelection(itemRecord.recommended)
    elements.push({
      id: clean(itemRecord.id) || makeElementId(label, sourceType, elements.length),
      label,
      sourceType,
      recommended,
      user: normalizeUserSelection(itemRecord.user),
      reason: clean(itemRecord.reason) || 'LLM-generated scope recommendation.',
      sourceRefs: normalizeSourceRefs(itemRecord.sourceRefs),
    })
  })

  if (!elements.length) return undefined

  const rawBasis = record?.basis && typeof record.basis === 'object' ? record.basis : {}
  return {
    version: 1,
    generatedAt: clean(record?.generatedAt) || new Date().toISOString(),
    basis: {
      patentTypePrimary: normalizePatentType(rawBasis.patentTypePrimary || normalizedData?.patentTypePrimary),
      inventionType: normalizeInventionTypes(rawBasis.inventionType || normalizedData?.inventionType),
      fieldOfRelevance: clean(rawBasis.fieldOfRelevance || normalizedData?.fieldOfRelevance) || undefined,
      subfield: clean(rawBasis.subfield || normalizedData?.subfield) || undefined,
    },
    elements,
  }
}

export function isScopeRecommendations(value: unknown): value is ScopeRecommendations {
  return !!value
    && typeof value === 'object'
    && (value as any).version === 1
    && Array.isArray((value as any).elements)
}

export function getEffectiveScopeUse(element: ScopeRecommendationElement): ScopeUseSelection {
  return {
    claim: element.user?.claim ?? element.recommended.claim,
    numbering: element.user?.numbering ?? element.recommended.numbering,
    figures: element.user?.figures ?? element.recommended.figures,
    description: element.user?.description ?? element.recommended.description,
  }
}

function elementLabelsBy<T extends keyof ScopeUseSelection>(
  scopeRecommendations: unknown,
  field: T,
  values: ScopeUseSelection[T][]
): string[] {
  if (!isScopeRecommendations(scopeRecommendations)) return []
  return scopeRecommendations.elements
    .filter(element => values.includes(getEffectiveScopeUse(element)[field]))
    .map(element => element.label)
    .filter(Boolean)
}

function matchScopeElement(component: any, scopeRecommendations: ScopeRecommendations): ScopeRecommendationElement | undefined {
  const componentKeys = [
    component?.scopeRecommendationId,
    component?.sourceScopeId,
  ].filter(Boolean).map(String)
  if (componentKeys.length) {
    const byId = scopeRecommendations.elements.find(element => componentKeys.includes(element.id))
    if (byId) return byId
  }

  const labels = [
    component?.name,
    component?.label,
    component?.title,
  ].map(scopeElementKey).filter(Boolean)

  return scopeRecommendations.elements.find((element) => labels.includes(scopeElementKey(element.label)))
}

export function componentsFromScopeRecommendations(
  scopeRecommendations: unknown,
  normalizedComponents: any[] = []
): any[] {
  if (!isScopeRecommendations(scopeRecommendations)) return []
  const componentByLabel = buildComponentLookup(normalizedComponents)

  return scopeRecommendations.elements
    .filter((element) => {
      const effective = getEffectiveScopeUse(element)
      return effective.numbering === 'number' && effective.description !== 'exclude'
    })
    .map((element, index) => {
      const existing = sourceComponentForScopeElement(element, normalizedComponents, componentByLabel) || {}
      return {
        ...existing,
        id: existing.id || element.id,
        name: existing.name || existing.title || existing.label || (
          element.sourceRefs.length > 1 ? scopeTitleFromElement(element) : element.label
        ),
        type: existing.type || 'OTHER',
        description: existing.description || element.reason,
        sequence: existing.sequence || index + 1,
        sourceType: element.sourceType,
        sourceScopeId: element.id,
        sourceRefs: element.sourceRefs,
        scopeLabel: element.label,
      }
    })
}

export function filterComponentsByScopeForNumbering<T = any>(
  components: T[],
  scopeRecommendations: unknown
): T[] {
  if (!Array.isArray(components) || !isScopeRecommendations(scopeRecommendations)) return Array.isArray(components) ? components : []
  return components.filter((component: any) => {
    const element = matchScopeElement(component, scopeRecommendations)
    if (!element) return true
    const effective = getEffectiveScopeUse(element)
    if (effective.description === 'exclude') return false
    if (element.sourceType === 'environment' || element.sourceType === 'use_case') return false
    return effective.numbering === 'number'
  })
}

export function filterComponentsByScopeForFigures<T = any>(
  components: T[],
  scopeRecommendations: unknown
): FigureScopeFilterResult<T> {
  const safeComponents = Array.isArray(components) ? components : []
  if (!isScopeRecommendations(scopeRecommendations)) {
    return {
      components: safeComponents,
      excludedLabels: [],
      includedLabels: [],
      optionalLabels: [],
    }
  }

  const includedLabels = elementLabelsBy(scopeRecommendations, 'figures', ['include'])
  const optionalLabels = elementLabelsBy(scopeRecommendations, 'figures', ['optional'])
  const excludedLabels = unique([
    ...elementLabelsBy(scopeRecommendations, 'figures', ['do_not_show']),
    ...scopeRecommendations.elements
      .filter(element => getEffectiveScopeUse(element).description === 'exclude')
      .map(element => element.label),
  ])

  const filtered = safeComponents.filter((component: any) => {
    const element = matchScopeElement(component, scopeRecommendations)
    if (!element) return true
    const effective = getEffectiveScopeUse(element)
    return effective.figures !== 'do_not_show' && effective.description !== 'exclude'
  })

  return {
    components: filtered,
    excludedLabels,
    includedLabels,
    optionalLabels,
  }
}

export function filterComponentsByScopeForDescription<T = any>(
  components: T[],
  scopeRecommendations: unknown
): T[] {
  if (!Array.isArray(components) || !isScopeRecommendations(scopeRecommendations)) return Array.isArray(components) ? components : []
  return components.filter((component: any) => {
    const element = matchScopeElement(component, scopeRecommendations)
    if (!element) return true
    return getEffectiveScopeUse(element).description !== 'exclude'
  })
}

function listLines(values: string[], fallback: string): string {
  const uniqueValues = unique(values).slice(0, 40)
  if (!uniqueValues.length) return `- ${fallback}`
  return uniqueValues.map(value => `- ${value}`).join('\n')
}

export function buildClaimScopePromptBlock(scopeRecommendations: unknown): string {
  if (!isScopeRecommendations(scopeRecommendations)) return ''
  const claimOne = elementLabelsBy(scopeRecommendations, 'claim', ['claim_1'])
  const dependent = elementLabelsBy(scopeRecommendations, 'claim', ['dependent_claim'])
  const excluded = elementLabelsBy(scopeRecommendations, 'claim', ['none'])

  return `USER-APPROVED CLAIM SCOPE (AUTHORITATIVE)
Effective selection is user override if present, otherwise the Stage 0 LLM recommendation.
Claim 1 may use ONLY the Claim 1 scope plus source-supported relationships required to connect those elements.

CLAIM 1 SCOPE:
${listLines(claimOne, 'No elements selected for Claim 1. Draft conservatively from the source and flag thin scope.')}

DEPENDENT-ONLY SCOPE:
${listLines(dependent, 'No dependent-only elements selected.')}

DO NOT PROMOTE INTO CLAIMS:
${listLines(excluded, 'No exclusions selected.')}

Rules:
- Elements marked dependent-only must not be placed in Claim 1.
- Elements marked do-not-promote must not appear in any claim unless the user later changes the selection.
- Do not introduce unselected components, figures, entities, or use-case context into the claims.`
}

export function buildFigureScopePromptBlock(scopeRecommendations: unknown): string {
  if (!isScopeRecommendations(scopeRecommendations)) return ''
  const included = elementLabelsBy(scopeRecommendations, 'figures', ['include'])
  const optional = elementLabelsBy(scopeRecommendations, 'figures', ['optional'])
  const excluded = unique([
    ...elementLabelsBy(scopeRecommendations, 'figures', ['do_not_show']),
    ...scopeRecommendations.elements
      .filter(element => getEffectiveScopeUse(element).description === 'exclude')
      .map(element => element.label),
  ])

  return `USER-APPROVED FIGURE SCOPE (AUTHORITATIVE)
Preferred figure content:
${listLines(included, 'No preferred figure elements selected.')}

Optional figure content:
${listLines(optional, 'No optional figure elements selected.')}

Do not show in figures:
${listLines(excluded, 'No figure exclusions selected.')}

Rules:
- Do not plan, draw, label, or imply any do-not-show element.
- Optional elements may be used only when needed for clarity.
- Do not invent components, entities, numerals, or figure labels beyond the approved component registry.`
}
