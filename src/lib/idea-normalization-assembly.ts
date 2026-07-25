import { normalizeComponentDisplayName } from '@/lib/component-naming'
import { synthesizeScopeRecommendations } from '@/lib/scope-recommendation-synthesis'

/**
 * Assembly for the split-call Stage 0 normalization flow.
 *
 * Three parallel LLM calls each return a slice of the normalized-data object:
 *   core    — components, narrative fields, claim/scope seeds
 *   search  — prior-art search artifacts
 *   support — supportDataSources + sourceFactLedger
 *
 * assembleNormalizedData merges them with explicit field allowlists (a stray
 * field hallucinated by one call must never clobber another call's output) and
 * synthesizes scopeRecommendations from the core call's inline scope enums.
 * The merged object then flows through the same post-processing chain as the
 * legacy single-call path.
 */

// Fields owned by the search call — copied only from the search payload.
const SEARCH_FIELDS = [
  'searchQuery',
  'googlePatentKeywords',
  'epoTitleKeywords',
  'epoAbstractKeywords',
  'epoCombinedKeywords',
  'patentSearchConceptGroups',
  'cpcCodes',
  'ipcCodes',
] as const

// Fields owned by the support call.
const SUPPORT_FIELDS = ['supportDataSources', 'sourceFactLedger'] as const

// Fields the core call owns. Search/support fields are excluded so a core-call
// hallucination cannot shadow the dedicated calls' output.
const CORE_EXCLUDED_FIELDS = new Set<string>([
  ...SEARCH_FIELDS,
  ...SUPPORT_FIELDS,
  'scopeRecommendations', // always synthesized in code in the split flow
])

/**
 * Normalizes component hierarchy and display names.
 * Moved verbatim from the single-call parse block in DraftingService.normalizeIdea.
 */
export function normalizeCoreComponents(components: unknown): any[] {
  if (!Array.isArray(components)) return []
  const componentNameMap = new Map<string, string>()
  return components.map((c: any, idx: number) => {
    const originalName = typeof c?.name === 'string' ? c.name.trim() : ''
    const displayName = normalizeComponentDisplayName(originalName, c?.type) || originalName
    if (originalName && displayName) {
      componentNameMap.set(originalName.toLowerCase(), displayName)
    }
    return {
      ...c,
      name: displayName,
      level: typeof c?.level === 'number' && c.level >= 0 ? c.level : 0,
      sequence: typeof c?.sequence === 'number' && c.sequence > 0 ? c.sequence : (idx + 1),
    }
  }).map((c: any) => {
    const parent = typeof c?.parent === 'string' ? c.parent.trim() : ''
    if (!parent) return c
    return {
      ...c,
      parent: componentNameMap.get(parent.toLowerCase()) || normalizeComponentDisplayName(parent),
    }
  })
}

function warningsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((w) => String(w ?? '').trim()).filter(Boolean)
}

export function assembleNormalizedData(parts: {
  core: Record<string, any>
  search: Record<string, any>
  support: Record<string, any>
}): Record<string, any> {
  const core = parts.core && typeof parts.core === 'object' ? parts.core : {}
  const search = parts.search && typeof parts.search === 'object' ? parts.search : {}
  const support = parts.support && typeof parts.support === 'object' ? parts.support : {}

  const merged: Record<string, any> = {}

  for (const [key, value] of Object.entries(core)) {
    if (CORE_EXCLUDED_FIELDS.has(key)) continue
    merged[key] = value
  }

  for (const field of SEARCH_FIELDS) {
    if (search[field] !== undefined) merged[field] = search[field]
  }

  for (const field of SUPPORT_FIELDS) {
    if (support[field] !== undefined) merged[field] = support[field]
  }

  merged.normalizationReviewWarnings = Array.from(new Set([
    ...warningsFrom(core.normalizationReviewWarnings),
    ...warningsFrom(support.normalizationReviewWarnings),
  ]))

  // Project inline component/feature scope enums into scopeRecommendations,
  // and restore claimableFeatures to the plain string[] contract expected by
  // downstream post-processing (normalizeStringArray would mangle objects).
  const { scopeRecommendations, claimableFeatureTexts } = synthesizeScopeRecommendations(merged)
  merged.scopeRecommendations = scopeRecommendations
  merged.claimableFeatures = claimableFeatureTexts

  // Strip the inline scope off components: scopeRecommendations is the single
  // source of truth (users edit scope elements in the UI; a stale copy on the
  // persisted components would silently diverge).
  if (Array.isArray(merged.components)) {
    merged.components = merged.components.map((component: any) => {
      if (!component || typeof component !== 'object' || !('scope' in component)) return component
      const { scope: _scope, ...rest } = component
      return rest
    })
  }

  merged.schemaVersion = 2

  return merged
}
