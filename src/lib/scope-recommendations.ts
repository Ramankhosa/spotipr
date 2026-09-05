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

export type ClaimSupportMetadata = {
  source: 'frozen_claims'
  basis: 'stage0_component_claim_match' | 'stage0_scope_claim_match'
  matchedClaims: number[]
  claimRole: Extract<ScopeClaimUse, 'claim_1' | 'dependent_claim'>
  confidence: 'high' | 'medium' | 'low'
  matchedText: string
  reason: string
  stage0ComponentIndex?: number
  llmScope?: {
    source: 'stage0_scopeRecommendations'
    elementId: string
    label: string
    sourceType: ScopeSourceType
    recommended: ScopeUseSelection
    effective: ScopeUseSelection
    reason: string
    sourceRefs: string[]
    generatedAt?: string
  }
  llmReview?: {
    source: 'component_planning_llm'
    taskCode: 'LLM3_DIAGRAM'
    stageCode: 'DRAFT_DIAGRAM_GENERATION'
    reviewedAt: string
    reason: string
  }
}

export type ComponentPlannerSeedOptions = {
  normalizedComponents: any[]
  scopeRecommendations?: unknown
  claims?: unknown
  claimsText?: unknown
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

function stripHtml(value: unknown): string {
  return clean(String(value || '').replace(/<[^>]*>/g, ' '))
}

type NormalizedClaimRecord = {
  number: number
  text: string
  type?: string
}

function normalizeClaims(claims: unknown, claimsText: unknown): NormalizedClaimRecord[] {
  const records: NormalizedClaimRecord[] = []

  if (Array.isArray(claims)) {
    claims.forEach((claim, index) => {
      const record = claim && typeof claim === 'object' ? claim as Record<string, any> : {}
      const text = stripHtml(record.text || record.claim || record.content)
      if (!text) return
      const parsedNumber = Number(record.number)
      records.push({
        number: Number.isFinite(parsedNumber) && parsedNumber > 0 ? Math.floor(parsedNumber) : index + 1,
        text,
        type: typeof record.type === 'string' ? record.type : undefined,
      })
    })
  } else if (typeof claims === 'string') {
    return normalizeClaims(undefined, claims)
  }

  if (records.length) return records

  const plainText = stripHtml(claimsText)
  if (!plainText) return []

  const matches = Array.from(plainText.matchAll(/(?:^|\s)(\d+)\.\s+([\s\S]*?)(?=\s+\d+\.\s+|$)/g))
  if (matches.length) {
    return matches
      .map((match, index) => ({
        number: Number(match[1]) || index + 1,
        text: clean(match[2]),
      }))
      .filter(claim => claim.text)
  }

  return [{ number: 1, text: plainText }]
}

const GENERIC_MATCH_TOKENS = new Set([
  'configured', 'comprising', 'comprises', 'including', 'includes', 'having',
  'wherein', 'system', 'method', 'device', 'component', 'module', 'element',
  'apparatus', 'process', 'composition', 'plurality', 'least', 'first', 'second',
  'third', 'said', 'claim'
])

function claimContainsCandidate(claimText: string, candidate: unknown): { matched: boolean; confidence: 'high' | 'medium' } {
  const claimKey = scopeElementKey(claimText)
  const candidateKey = scopeElementKey(nameWithoutParenthetical(candidate))
  if (!claimKey || candidateKey.length < 3) return { matched: false, confidence: 'medium' }

  if (` ${claimKey} `.includes(` ${candidateKey} `)) {
    return { matched: true, confidence: 'high' }
  }

  const tokens = candidateKey
    .split(' ')
    .filter(token => token.length > 3 && !GENERIC_MATCH_TOKENS.has(token))
  if (tokens.length >= 2 && tokens.every(token => claimKey.includes(` ${token} `) || claimKey.startsWith(`${token} `) || claimKey.endsWith(` ${token}`))) {
    return { matched: true, confidence: 'medium' }
  }

  return { matched: false, confidence: 'medium' }
}

function mergeClaimNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter(value => Number.isFinite(value) && value > 0).map(value => Math.floor(value)))).sort((a, b) => a - b)
}

function isScopeExcludedFromComponentPlanning(element: ScopeRecommendationElement): boolean {
  const effective = getEffectiveScopeUse(element)
  return effective.description === 'exclude'
    || element.sourceType === 'environment'
    || element.sourceType === 'use_case'
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

/**
 * Coerce one recommendation's selections.
 *
 * The fallbacks matter more than they look. They used to be 'none' /
 * 'do_not_number' / 'do_not_show', so a scope element the model returned with a
 * real label but a missing or malformed `recommended` object was silently placed
 * on the "DO NOT PROMOTE INTO CLAIMS" list in the claim prompt AND dropped from
 * the Component Planner — a genuine inventor-stated feature excluded from the
 * claims because one JSON sub-object came back wrong.
 *
 * An explicit exclusion from the model is still honoured; only the ABSENCE of a
 * usable value now defaults permissively, so a parsing accident cannot narrow the
 * claim set. The user's own selections always override either way.
 */
function normalizeSelection(value: unknown): ScopeUseSelection {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}

  // The only way to exclude an element is to say so with a valid enum value.
  // A missing field, a missing object, or a value the model misspelled
  // ("claim1" for "claim_1") all fall to the permissive reading — a parsing
  // accident must never narrow the claim set or drop a component from the
  // planner. The user's own selections override these either way.
  return {
    claim: pickEnum(record.claim, CLAIM_VALUES, 'dependent_claim'),
    numbering: pickEnum(record.numbering, NUMBERING_VALUES, 'number'),
    figures: pickEnum(record.figures, FIGURE_VALUES, 'optional'),
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
    if (!label) return
    const reason = clean(itemRecord.reason)
    const sourceRefs = normalizeSourceRefs(itemRecord.sourceRefs)
    const isNotStatedLabel = /^not stated by source$/i.test(label)
    const hasMeaningfulGapContext = !!reason || sourceRefs.length > 0
    if (isNotStatedLabel && !hasMeaningfulGapContext) return
    const sourceType = pickEnum(itemRecord.sourceType, SOURCE_TYPES, 'other')
    const key = `${scopeElementKey(label)}::${sourceType}`
    if (seen.has(key)) return
    seen.add(key)

    const recommended = isNotStatedLabel
      ? {
          claim: 'none',
          numbering: 'do_not_number',
          figures: 'do_not_show',
          description: 'exclude',
        } as ScopeUseSelection
      : normalizeSelection(itemRecord.recommended)
    elements.push({
      id: clean(itemRecord.id) || makeElementId(label, sourceType, elements.length),
      label,
      sourceType,
      recommended,
      user: normalizeUserSelection(itemRecord.user),
      reason: reason || 'LLM-generated scope recommendation.',
      sourceRefs,
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

/**
 * Projects scope metadata onto the Stage 0 components each element resolves to.
 *
 * This is an enricher, never a source of components. An element that does not
 * resolve back to a Stage 0 component is skipped: elements synthesized from
 * claimableFeatures / fallbackLimitations / doNotClaim, and elements whose
 * positional `components[N]` refs have gone stale, used to be minted here as
 * brand-new components (named after the scope label, or after a slug of the
 * element id) and surfaced in the Component Planner as parts the user never
 * entered.
 */
export function componentsFromScopeRecommendations(
  scopeRecommendations: unknown,
  normalizedComponents: any[] = []
): any[] {
  if (!isScopeRecommendations(scopeRecommendations)) return []
  const componentByLabel = buildComponentLookup(normalizedComponents)

  return scopeRecommendations.elements.flatMap((element, index) => {
    if (isScopeExcludedFromComponentPlanning(element)) return []
    if (getEffectiveScopeUse(element).numbering !== 'number') return []

    const existing = sourceComponentForScopeElement(element, normalizedComponents, componentByLabel)
    if (!existing) return []

    return [{
      ...existing,
      id: existing.id || element.id,
      name: existing.name || existing.title || existing.label || element.label,
      type: existing.type || 'OTHER',
      description: existing.description || element.reason,
      sequence: existing.sequence || index + 1,
      sourceType: element.sourceType,
      sourceScopeId: element.id,
      sourceRefs: element.sourceRefs,
      scopeLabel: element.label,
    }]
  })
}

export function componentsFromFrozenClaimsAndStage0({
  normalizedComponents,
  scopeRecommendations,
  claims,
  claimsText,
}: ComponentPlannerSeedOptions): any[] {
  const stage0Components = Array.isArray(normalizedComponents) ? normalizedComponents : []
  const claimRecords = normalizeClaims(claims, claimsText)
  if (!stage0Components.length || !claimRecords.length) return []

  const hasScope = isScopeRecommendations(scopeRecommendations)
  const componentByLabel = buildComponentLookup(stage0Components)
  const scopeElementsByComponentIndex = new Map<number, ScopeRecommendationElement[]>()

  if (hasScope) {
    scopeRecommendations.elements.forEach((element) => {
      if (isScopeExcludedFromComponentPlanning(element)) return
      const sourceComponent = sourceComponentForScopeElement(element, stage0Components, componentByLabel)
      const sourceIndex = sourceComponent ? stage0Components.indexOf(sourceComponent) : -1
      if (sourceIndex < 0) return
      const entries = scopeElementsByComponentIndex.get(sourceIndex) || []
      entries.push(element)
      scopeElementsByComponentIndex.set(sourceIndex, entries)
    })
  }

  return stage0Components.flatMap((component, index) => {
    const candidateNames = unique([
      component?.name,
      component?.title,
      component?.label,
    ].map(value => clean(value)).filter(Boolean))

    const scopeElements = scopeElementsByComponentIndex.get(index) || []
    const matches: Array<{
      claimNumber: number
      matchedText: string
      confidence: 'high' | 'medium'
      basis: ClaimSupportMetadata['basis']
      scopeElement?: ScopeRecommendationElement
    }> = []

    claimRecords.forEach((claim) => {
      for (const name of candidateNames) {
        const result = claimContainsCandidate(claim.text, name)
        if (result.matched) {
          matches.push({
            claimNumber: claim.number,
            matchedText: name,
            confidence: result.confidence,
            basis: 'stage0_component_claim_match',
          })
          break
        }
      }

      scopeElements.forEach((element) => {
        const result = claimContainsCandidate(claim.text, element.label)
        if (!result.matched) return
        matches.push({
          claimNumber: claim.number,
          matchedText: element.label,
          confidence: result.confidence,
          basis: 'stage0_scope_claim_match',
          scopeElement: element,
        })
      })
    })

    if (!matches.length) return []

    const primaryMatch = matches.find(match => match.scopeElement) || matches[0]
    const primaryScope = primaryMatch.scopeElement || scopeElements.find(element => {
      const effective = getEffectiveScopeUse(element)
      return effective.claim !== 'none'
    }) || scopeElements[0]
    const matchedClaims = mergeClaimNumbers(matches.map(match => match.claimNumber))
    const scopeEffective = primaryScope ? getEffectiveScopeUse(primaryScope) : undefined
    const claimRole: ClaimSupportMetadata['claimRole'] = matchedClaims.includes(1) || scopeEffective?.claim === 'claim_1'
      ? 'claim_1'
      : 'dependent_claim'
    const confidence: ClaimSupportMetadata['confidence'] = primaryMatch.confidence === 'high'
      ? 'high'
      : primaryScope
        ? 'medium'
        : 'low'

    const claimSupport: ClaimSupportMetadata = {
      source: 'frozen_claims',
      basis: primaryMatch.basis,
      matchedClaims,
      claimRole,
      confidence,
      matchedText: primaryMatch.matchedText,
      reason: claimRole === 'claim_1'
        ? 'Stage 0 component maps to frozen Claim 1 terminology and is eligible for reference-label planning.'
        : 'Stage 0 component maps to frozen dependent-claim terminology and may need a reference label.',
      stage0ComponentIndex: index,
      llmScope: primaryScope ? {
        source: 'stage0_scopeRecommendations',
        elementId: primaryScope.id,
        label: primaryScope.label,
        sourceType: primaryScope.sourceType,
        recommended: primaryScope.recommended,
        effective: getEffectiveScopeUse(primaryScope),
        reason: primaryScope.reason,
        sourceRefs: primaryScope.sourceRefs,
        generatedAt: hasScope ? scopeRecommendations.generatedAt : undefined,
      } : undefined,
    }

    return [{
      ...component,
      sequence: typeof component?.sequence === 'number' ? component.sequence : index + 1,
      sourceType: component?.sourceType || primaryScope?.sourceType,
      sourceScopeId: component?.sourceScopeId || primaryScope?.id,
      sourceRefs: Array.isArray(component?.sourceRefs) && component.sourceRefs.length
        ? component.sourceRefs
        : primaryScope?.sourceRefs,
      scopeLabel: component?.scopeLabel || primaryScope?.label,
      claimSupport,
    }]
  })
}

function stage0IndexFromSourceRefs(sourceRefs: unknown): number | undefined {
  if (!Array.isArray(sourceRefs)) return undefined
  for (const sourceRef of sourceRefs) {
    if (typeof sourceRef !== 'string') continue
    const match = sourceRef.match(/\bcomponents\[(\d+)\]/i)
    if (!match) continue
    const index = Number(match[1])
    if (Number.isInteger(index) && index >= 0) return index
  }
  return undefined
}

/**
 * Rewrites the positional `components[N]` refs on scope elements after the
 * Stage 0 component list is edited or reordered.
 *
 * Scope elements cite components by index, so an edit silently repoints them at
 * the wrong component — or at nothing. Regenerating scope instead is not an
 * option: the inline `scope` enums the synthesizer reads are stripped off the
 * components once normalization has run (see idea-normalization-assembly), so a
 * regenerate would flatten every element back to defaults and discard user
 * selections. Remapping by name keeps all of that intact. Refs whose component
 * no longer exists are dropped rather than left dangling.
 */
export function remapScopeSourceRefsForComponents(
  scopeRecommendations: unknown,
  previousComponents: unknown,
  nextComponents: unknown
): ScopeRecommendations | undefined {
  if (!isScopeRecommendations(scopeRecommendations)) return undefined
  const previous = Array.isArray(previousComponents) ? previousComponents : []
  const next = Array.isArray(nextComponents) ? nextComponents : []
  if (!previous.length) return scopeRecommendations

  const nextIndexByName = new Map<string, number>()
  next.forEach((component: any, index: number) => {
    const key = scopeElementKey(component?.name || component?.title || component?.label)
    if (key && !nextIndexByName.has(key)) nextIndexByName.set(key, index)
  })

  let changed = false
  const elements = scopeRecommendations.elements.map((element) => {
    let elementChanged = false
    const sourceRefs: string[] = []

    element.sourceRefs.forEach((sourceRef) => {
      const match = typeof sourceRef === 'string' ? sourceRef.match(/^components\[(\d+)\]$/i) : null
      if (!match) {
        sourceRefs.push(sourceRef)
        return
      }
      const previousComponent: any = previous[Number(match[1])]
      const key = scopeElementKey(
        previousComponent?.name || previousComponent?.title || previousComponent?.label
      )
      const nextIndex = key ? nextIndexByName.get(key) : undefined
      if (nextIndex === undefined) {
        elementChanged = true
        return
      }
      const remapped = `components[${nextIndex}]`
      if (remapped !== sourceRef) elementChanged = true
      sourceRefs.push(remapped)
    })

    if (!elementChanged) return element
    changed = true
    return { ...element, sourceRefs }
  })

  return changed ? { ...scopeRecommendations, elements } : scopeRecommendations
}

function componentPlannerSeedKey(
  component: any,
  fallbackIndex: number,
  fallbackIsStage0 = false,
  stage0IndexByName?: Map<string, number>
): string {
  if (fallbackIsStage0 && fallbackIndex >= 0) return `stage0:${fallbackIndex}`

  const claimIndex = component?.claimSupport?.stage0ComponentIndex
  if (Number.isInteger(claimIndex) && claimIndex >= 0) return `stage0:${claimIndex}`

  const sourceRefIndex = stage0IndexFromSourceRefs(component?.sourceRefs)
  if (sourceRefIndex !== undefined) return `stage0:${sourceRefIndex}`

  // Scope-derived seeds always resolve to a real Stage 0 component, but legacy
  // scope elements cite `sourceFactLedger…` rather than `components[N]`, so the
  // positional lookup above misses. Fall back to the resolved name, otherwise
  // the same component is added twice under two different keys.
  const nameIndex = stage0IndexByName?.get(
    scopeElementKey(component?.name || component?.title || component?.label)
  )
  if (nameIndex !== undefined) return `stage0:${nameIndex}`

  const scopeId = clean(component?.sourceScopeId || component?.scopeRecommendationId)
  if (scopeId) return `scope:${scopeId}`

  const labelKey = scopeElementKey(component?.scopeLabel || component?.name || component?.title || component?.label || component?.id)
  return labelKey ? `label:${labelKey}` : `fallback:${fallbackIndex}`
}

export function componentPlannerSeedsFromStage0(options: ComponentPlannerSeedOptions): any[] {
  const stage0Components = Array.isArray(options.normalizedComponents)
    ? options.normalizedComponents
    : []
  if (!stage0Components.length) return []

  const claimSeededComponents = componentsFromFrozenClaimsAndStage0(options)
  const scopedComponents = componentsFromScopeRecommendations(
    options.scopeRecommendations,
    stage0Components
  )

  const stage0IndexByName = new Map<string, number>()
  stage0Components.forEach((component, index) => {
    const key = scopeElementKey(component?.name || component?.title || component?.label)
    if (key && !stage0IndexByName.has(key)) stage0IndexByName.set(key, index)
  })

  const merged: any[] = []
  const seen = new Set<string>()
  const add = (component: any, fallbackIndex: number, fallbackIsStage0 = false) => {
    const key = componentPlannerSeedKey(component, fallbackIndex, fallbackIsStage0, stage0IndexByName)
    if (seen.has(key)) return
    seen.add(key)
    merged.push(component)
  }

  claimSeededComponents.forEach((component, index) => add(component, index))
  scopedComponents.forEach((component, index) => add(component, index))
  stage0Components.forEach((component, index) => add(component, index, true))

  return merged
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
