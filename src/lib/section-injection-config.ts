/**
 * Section Injection Configuration (Hard-coded)
 * 
 * This file defines the Universal Drafting Bundle (UDB) injection rules per section.
 * UDB = Normalized Data (ND) + Claim 1 (C1)
 * 
 * Key Principles:
 * - No empty placeholders are ever emitted
 * - Omission is safer than emptiness
 * - Claim 1 is the legal truth once available
 */

import {
  buildSourceFactLedgerEntries,
  buildSourceFactLedgerPromptBlock
} from '@/lib/source-fact-ledger'
import {
  buildSupportDataSourcePromptBlock,
  hasSupportDataSources
} from '@/lib/support-data-sources'
import { buildFigurelessDraftGuard } from '@/lib/figure-availability'
import { filterComponentsByScopeForDescription } from '@/lib/scope-recommendations'
import { migrateNormalizedData } from '@/lib/normalized-data'
import { buildSourceFidelityModeLine } from '@/lib/source-fidelity'
import {
  formatIndependentClaimsText,
  getAuthoritativeClaims,
  getIndependentClaims,
  getIndependentClaimsText,
} from '@/lib/claims-context'

export type Claim1Mode = 'bindingAnchor' | 'constraintOnly' | 'off'

export interface SectionInjectionConfig {
  injectNormalizedData: boolean
  injectClaim1: boolean
  claim1Mode: Claim1Mode
}

/**
 * Hard-coded injection matrix for all superset section keys.
 * This applies regardless of country mapping—country sections mapped to these
 * superset keys inherit these defaults.
 */
export const SECTION_INJECTION_CONFIG: Record<string, SectionInjectionConfig> = {
  // ND ON, C1 OFF sections
  title: { injectNormalizedData: true, injectClaim1: false, claim1Mode: 'off' },
  preamble: { injectNormalizedData: true, injectClaim1: false, claim1Mode: 'off' },
  fieldOfInvention: { injectNormalizedData: true, injectClaim1: false, claim1Mode: 'off' },
  background: { injectNormalizedData: true, injectClaim1: false, claim1Mode: 'off' },
  technicalProblem: { injectNormalizedData: true, injectClaim1: false, claim1Mode: 'off' },
  briefDescriptionOfDrawings: { injectNormalizedData: true, injectClaim1: false, claim1Mode: 'off' },

  // ND ON, C1 ON (bindingAnchor) sections
  objectsOfInvention: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },
  summary: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },
  technicalSolution: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },
  advantageousEffects: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },
  detailedDescription: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },
  bestMode: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },
  bestMethod: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' }, // Alias for bestMode
  industrialApplicability: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },
  abstract: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },

  // ND OFF, C1 OFF sections (these sections have their own specialized context)
  claims: { injectNormalizedData: false, injectClaim1: false, claim1Mode: 'off' },
  listOfNumerals: { injectNormalizedData: false, injectClaim1: false, claim1Mode: 'off' },
  crossReference: { injectNormalizedData: false, injectClaim1: false, claim1Mode: 'off' },
}

/**
 * Get injection config for a section key.
 * Falls back to safe defaults (ND ON, C1 OFF) for unknown keys.
 * Handles case-insensitive lookup.
 */
export function getSectionInjectionConfig(sectionKey: string): SectionInjectionConfig {
  if (!sectionKey) {
    console.warn(`[getSectionInjectionConfig] Empty section key, using safe defaults`)
    return {
      injectNormalizedData: true,
      injectClaim1: false,
      claim1Mode: 'off'
    }
  }

  // Try exact match first
  const config = SECTION_INJECTION_CONFIG[sectionKey]
  if (config) return config

  // Try lowercase match (handle case variations like "Abstract" vs "abstract")
  const lowerKey = sectionKey.toLowerCase()
  const lowerConfig = SECTION_INJECTION_CONFIG[lowerKey]
  if (lowerConfig) return lowerConfig

  // Try camelCase conversion (e.g., "field_of_invention" -> "fieldOfInvention")
  const camelKey = sectionKey.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  const camelConfig = SECTION_INJECTION_CONFIG[camelKey]
  if (camelConfig) return camelConfig

  const compactKey = sectionKey.replace(/[_\-\s.]/g, '').toLowerCase()
  if (compactKey === 'description' || compactKey === 'detaileddescription') {
    return SECTION_INJECTION_CONFIG.detailedDescription
  }

  // Safe fallback for unknown sections: ND ON, C1 OFF
  console.warn(`[getSectionInjectionConfig] Unknown section key "${sectionKey}", using safe defaults`)
  return {
    injectNormalizedData: true,
    injectClaim1: false,
    claim1Mode: 'off'
  }
}

/**
 * Sections that MUST have frozen Claim 1 available to generate.
 * If Claim 1 is required but missing/unfrozen, generation is BLOCKED.
 * 
 * RATIONALE: These are the "legally critical" sections that directly define
 * the scope of protection. Generating them without frozen Claim 1 could result
 * in inconsistent legal claims that harm the patent application.
 * 
 * Other sections (objectsOfInvention, technicalSolution, advantageousEffects,
 * industrialApplicability) CAN use Claim 1 when available but are NOT gated
 * because they can be revised later without legal risk.
 * 
 * NOTE: Keys are stored in lowercase for case-insensitive matching.
 */
export const SECTIONS_REQUIRING_CLAIM1_FOR_GENERATION = new Set([
  'abstract',           // Must align with Claim 1 scope per USPTO/EPO rules
  'summary',            // Must align with Claim 1 as it defines invention scope
  'detaileddescription', // Must provide basis for Claim 1 features (written description requirement)
  'bestmode',           // Binding Claim 1 anchor in injection config
  'bestmethod'          // Alias for bestMode
])

/**
 * Normalize a section key for consistent comparison.
 * Removes underscores, hyphens, spaces, and converts to lowercase.
 * This handles alias variations like 'detailed_description' → 'detaileddescription'
 */
function normalizeSectionKeyForGating(key: string): string {
  if (!key) return ''
  return key.toLowerCase().replace(/[_\-\s.]/g, '')
}

/**
 * Check if a section should be gated (blocked) because Claim 1 is missing.
 *
 * Freezing is an optional lock, not a prerequisite: the current saved claim set is
 * authoritative for drafting as soon as it exists. Only a total absence of claims
 * blocks generation, because those sections genuinely cannot be written without one.
 *
 * @param sectionKey - The section being generated
 * @param normalizedData - The normalized data containing claims
 * @returns true if generation should be blocked
 */
export function shouldGateSection(
  sectionKey: string,
  normalizedData: Record<string, any> | null | undefined
): boolean {
  // Normalize section key for case-insensitive lookup
  // Also remove underscores/hyphens to handle aliases like 'detailed_description' vs 'detailedDescription'
  const normalizedKey = normalizeSectionKeyForGating(sectionKey)
  
  const config = getSectionInjectionConfig(sectionKey)
  if (!config.injectClaim1) return false // Section doesn't need C1
  
  // Check if this is a critical section that requires frozen Claim 1
  // SECTIONS_REQUIRING_CLAIM1_FOR_GENERATION uses normalized lowercase keys without separators
  const isCriticalSection = SECTIONS_REQUIRING_CLAIM1_FOR_GENERATION.has(normalizedKey)
  
  if (!isCriticalSection) return false // Non-critical sections don't gate

  // For critical sections: require a usable Claim 1, frozen or not
  return !isClaim1AvailableForDrafting(normalizedData)
}

/**
 * Get the specific gating reason for a section.
 */
export function getGatingReason(
  sectionKey: string,
  normalizedData: Record<string, any> | null | undefined
): string | null {
  if (!shouldGateSection(sectionKey, normalizedData)) {
    return null
  }
  
  return `Section "${sectionKey}" requires Claim 1 but no claims are available yet. Please generate claims in the Preliminary Claims stage first.`
}

/**
 * Structured claim object from CLAIM_REFINEMENT stage
 */
export interface StructuredClaim {
  number: number
  type: 'independent' | 'dependent'
  dependsOn?: number
  category?: string
  text: string
}

/**
 * Decode HTML entities in text.
 */
function decodeHtmlEntities(text: string): string {
  if (!text) return ''
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
}

/**
 * Extract all LLM-classified independent claims from the authoritative claims snapshot.
 * This intentionally trusts stored claim.type metadata and does not reclassify from text.
 */
export function extractIndependentClaims(
  normalizedData: Record<string, any> | null | undefined,
  requireFrozen: boolean = false
): string | null {
  const text = getIndependentClaimsText(normalizedData, { requireFrozen })
  return text || null
}

export function countIndependentClaims(
  normalizedData: Record<string, any> | null | undefined,
  requireFrozen: boolean = false
): number {
  return getIndependentClaims(normalizedData, { requireFrozen }).length
}

/**
 * Extract Claim 1 from frozen/structured claims.
 * Returns null if Claim 1 is not available.
 * 
 * DATA SOURCE PRIORITY INVARIANT:
 * The function uses claims from the MOST FINALIZED source available:
 * 1. claimsStructuredFinal - User-approved/frozen claims (highest authority)
 * 2. claimsStructured - Working/refined claims (actively being edited)
 * 3. claimsStructuredProvisional - Initial AI-generated claims (lowest authority)
 * 
 * claimsStructuredFinal is populated once the claim set is settled for drafting; until
 * then the working or provisional claims are used. No drafting path requires a frozen
 * claim set — `requireFrozen` remains only for callers that want to inspect lock state.
 *
 * @param normalizedData - The normalized data object containing claims
 * @param requireFrozen - If true, only returns Claim 1 when the claims are locked (default: false)
 */
export function extractClaim1(
  normalizedData: Record<string, any> | null | undefined,
  requireFrozen: boolean = false
): string | null {
  return extractIndependentClaims(normalizedData, requireFrozen)
}

/**
 * Check if Claim 1 is available (regardless of frozen status).
 */
export function isClaim1Available(normalizedData: Record<string, any> | null | undefined): boolean {
  return extractIndependentClaims(normalizedData, false) !== null
}

export function areIndependentClaimsAvailable(normalizedData: Record<string, any> | null | undefined): boolean {
  return isClaim1Available(normalizedData)
}

/**
 * Check if Claim 1 is available AND frozen.
 * This is stricter - used for gating critical sections.
 * 
 * IMPORTANT: Returns true if claims exist in ANY form:
 * 1. Structured claims with extractable Claim 1 (preferred)
 * 2. HTML/text claims in claimsFinal or claims fields (fallback)
 *
 * This handles cases where claims were manually entered or imported
 * without being parsed into structured format. Freezing is NOT required —
 * the current saved claim set is what drafting builds on.
 */
export function isClaim1AvailableForDrafting(normalizedData: Record<string, any> | null | undefined): boolean {
  if (!normalizedData) return false

  // Try to extract Claim 1 from structured claims (preferred)
  const independentClaimsFromStructured = extractIndependentClaims(normalizedData)
  if (independentClaimsFromStructured !== null) return true

  // Fallback: structured claims are empty but HTML claims exist
  const htmlClaims = normalizedData.claimsFinal || normalizedData.claims || normalizedData.claimsProvisional || ''
  const hasHtmlClaims = typeof htmlClaims === 'string' && htmlClaims.trim().length > 0

  if (hasHtmlClaims) {
    console.warn('[isClaim1AvailableForDrafting] Claims exist as HTML but were never parsed into structured form. Generating with reduced precision.')
    return true
  }

  return false
}

/**
 * Check whether the user has explicitly locked the claim set. Informational only —
 * no drafting path requires it.
 */
export function areClaimsFrozen(normalizedData: Record<string, any> | null | undefined): boolean {
  return !!(normalizedData?.claimsApprovedAt)
}

interface DraftingContextOptions {
  patentTypePrimary?: unknown
  archetype?: unknown
  sectionKey?: string
  jurisdiction?: string
  suppressClaimInjection?: boolean
  suppressSupportDataSources?: boolean
  // Country-profile rules.global.allowTables — gates attorney-enabled table presentation
  tablesAllowed?: boolean
}

function formatContextScalar(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function determineDraftingArchetype(field: unknown): string {
  const f = formatContextScalar(field).toLowerCase()
  if (/(software|computer|internet|app|data|ai|algorithm|blockchain|network|platform|server|cloud|processor)/.test(f)) return 'SOFTWARE'
  if (/(chem|pharma|compound|composition|material|polymer|alloy|drug|molecule|synthesis)/.test(f)) return 'CHEMICAL'
  if (/(bio|gene|cell|protein|dna|rna|medical|diagnostic|therapeutic|antibody|sequence)/.test(f)) return 'BIO'
  if (/(electric|circuit|semiconductor|voltage|power|sensor|transistor|communication|wireless|signal)/.test(f)) return 'ELECTRICAL'
  if (/(mechanic|device|apparatus|tool|machine|engine|structure|fastener|assembly|housing)/.test(f)) return 'MECHANICAL'
  return 'GENERAL'
}

export function normalizeDraftingArchetypeList(input: unknown, fallbackField?: unknown): string[] {
  const set = new Set<string>()
  const add = (raw: unknown) => {
    const value = formatContextScalar(raw)
    if (!value) return
    value
      .split('+')
      .map((p) => p.trim().toUpperCase())
      .filter(Boolean)
      .forEach((p) => set.add(p))
  }

  if (Array.isArray(input)) input.forEach(add)
  else add(input)

  if (set.size === 0 && formatContextScalar(fallbackField)) add(determineDraftingArchetype(fallbackField))
  if (set.size === 0) set.add('GENERAL')
  if (set.size > 1 && set.has('GENERAL')) set.delete('GENERAL')
  return Array.from(set)
}

export function formatDraftingArchetype(input: unknown, fallbackField?: unknown): string {
  return normalizeDraftingArchetypeList(input, fallbackField).join('+') || 'GENERAL'
}

/**
 * Build the Normalized Data context block for injection into prompts.
 * Returns empty string if data is not available or injection is disabled.
 * 
 * CRITICAL: Never returns placeholder text like "Not available" or "None provided"
 */
export function buildNormalizedDataBlock(
  normalizedData: Record<string, any> | null | undefined,
  idea: Record<string, any> | null | undefined,
  existingSections?: Record<string, string> | null | undefined,
  options?: DraftingContextOptions
): string {
  if (!normalizedData && !idea) return ''

  const ideaData = idea || {}
  const hasObjectData = (value: unknown): value is Record<string, any> =>
    !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, any>).length > 0
  const rawNestedNormalizedData = hasObjectData(ideaData.normalizedData) ? ideaData.normalizedData : {}
  const nd = hasObjectData(normalizedData) ? migrateNormalizedData(normalizedData) as Record<string, any> : {}
  const nestedNormalizedData = hasObjectData(rawNestedNormalizedData)
    ? migrateNormalizedData(rawNestedNormalizedData) as Record<string, any>
    : {}
  const hasContextValue = (value: unknown) => {
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'string') return value.trim().length > 0
    return value !== undefined && value !== null
  }
  const pickContextValue = (...keys: string[]) => {
    for (const source of [nd, nestedNormalizedData, ideaData]) {
      for (const key of keys) {
        const value = source?.[key]
        if (hasContextValue(value)) return value
      }
    }
    return undefined
  }

  const parts: string[] = []

  const archetypeInput =
    options?.archetype ??
    pickContextValue('inventionType')
  const archetypeFallbackField =
    formatContextScalar(pickContextValue('fieldOfRelevance', 'field'))
  const archetype = formatDraftingArchetype(archetypeInput, archetypeFallbackField)
  const patentType =
    formatContextScalar(pickContextValue('patentTypePrimary')) ||
    formatContextScalar(options?.patentTypePrimary) ||
    'UNKNOWN'
  const domainField =
    formatContextScalar(pickContextValue('fieldOfRelevance', 'field')) ||
    'N/A'
  const domainSubfield =
    formatContextScalar(pickContextValue('subfield')) ||
    'N/A'

  parts.push(`DOMAIN / ARCHETYPE CONTEXT
- Invention Archetype: ${archetype}
- Patent Type: ${patentType}
- Technical Field: ${domainField}
- Subfield: ${domainSubfield}

Use this block only to adapt patent drafting vocabulary, disclosure units, and section emphasis. Do not use it to introduce unsupported components, steps, materials, values, algorithms, use cases, or embodiments.`)

  // The user's Stage-0 idea-handling choice, surfaced so DB-managed prompts can
  // condition on it (PRESERVE = "Keep exactly what I provided").
  const sourceHandlingMode = formatContextScalar(pickContextValue('sourceHandlingMode'))
  parts.push(buildSourceFidelityModeLine(sourceHandlingMode === 'PRESERVE' ? 'PRESERVE' : 'STRUCTURE_ONLY'))

  // Title - IMPORTANT: Use AI-generated title from existingSections if available,
  // as this is the drafting-stage refined title that should be used for consistency
  const aiGeneratedTitle = existingSections?.title?.trim()
  const title = aiGeneratedTitle || pickContextValue('title')
  if (title && typeof title === 'string' && title.trim()) {
    parts.push(`Title: ${title.trim()}`)
  }

  // Problem Statement
  const problem = pickContextValue('problem', 'problemStatement')
  if (problem && typeof problem === 'string' && problem.trim()) {
    parts.push(`Problem: ${problem.trim()}`)
  }

  // Objectives
  const objectives = pickContextValue('objectives')
  if (objectives && typeof objectives === 'string' && objectives.trim()) {
    parts.push(`Objectives: ${objectives.trim()}`)
  }

  // Solution
  const solution = pickContextValue('solution', 'description')
  if (solution && typeof solution === 'string' && solution.trim()) {
    parts.push(`Solution: ${solution.trim()}`)
  }

  // Field of Relevance
  const field = pickContextValue('fieldOfRelevance')
  if (field && typeof field === 'string' && field.trim()) {
    parts.push(`Technical Field: ${field.trim()}`)
  }

  // Subfield
  const subfield = pickContextValue('subfield')
  if (subfield && typeof subfield === 'string' && subfield.trim()) {
    parts.push(`Subfield: ${subfield.trim()}`)
  }

  // Components (if array)
  const components = pickContextValue('components')
  if (Array.isArray(components) && components.length > 0) {
    const componentLines = components
      .map((c: any) => {
        if (typeof c === 'string') return c.trim()
        if (!c || typeof c !== 'object') return ''
        const name = c.name || c.title || c.component
        if (!name || typeof name !== 'string') return ''
        const label = c.referenceLabel || c.numeral ? ` (${c.referenceLabel || c.numeral})` : ''
        const description = c.description ? `: ${c.description}` : ''
        const metadata = [
          c.parent ? `parent=${c.parent}` : '',
          typeof c.level === 'number' ? `level=${c.level}` : '',
          c.inputs ? `inputs=${c.inputs}` : '',
          c.outputs ? `outputs=${c.outputs}` : '',
          c.dependencies ? `dependencies=${c.dependencies}` : '',
          c.conditions ? `conditions=${c.conditions}` : '',
          c.alternatives ? `alternatives=${c.alternatives}` : '',
        ].filter(Boolean).join('; ')
        return `- ${name.trim()}${label}${description}${metadata ? ` [${metadata}]` : ''}`
      })
      .filter(Boolean)
    if (componentLines.length > 0) {
      parts.push(`Key Components:\n${componentLines.join('\n')}`)
    }
  }

  // Logic/Process Flow
  const logic = pickContextValue('logic')
  if (logic && typeof logic === 'string' && logic.trim()) {
    parts.push(`Process Logic: ${logic.trim()}`)
  }

  // Inputs
  const inputs = pickContextValue('inputs')
  if (inputs && typeof inputs === 'string' && inputs.trim()) {
    parts.push(`Inputs: ${inputs.trim()}`)
  }

  // Outputs
  const outputs = pickContextValue('outputs')
  if (outputs && typeof outputs === 'string' && outputs.trim()) {
    parts.push(`Outputs: ${outputs.trim()}`)
  }

  // Best Method (brief)
  const bestMethod = pickContextValue('bestMethod')
  if (bestMethod && typeof bestMethod === 'string' && bestMethod.trim()) {
    parts.push(`Best Method: ${bestMethod.trim()}`)
  }

  const supportDataSourceContainer = hasSupportDataSources(nd)
    ? nd
    : hasSupportDataSources(nestedNormalizedData)
      ? nestedNormalizedData
      : ideaData
  const supportDataBlock = options?.suppressSupportDataSources
    ? ''
    : buildSupportDataSourcePromptBlock(
        supportDataSourceContainer,
        options?.sectionKey || 'detailedDescription',
        'SUPPORT DATA SOURCES (READ-ONLY SOURCE SUPPORT)',
        { jurisdiction: options?.jurisdiction, tablesAllowed: options?.tablesAllowed }
      )
  if (supportDataBlock) {
    parts.push(supportDataBlock)
  } else if (
    !isDetailedDescriptionKey(options?.sectionKey || '') &&
    !hasSupportDataSources(nd) &&
    !hasSupportDataSources(nestedNormalizedData) &&
    !hasSupportDataSources(ideaData)
  ) {
    const sourceFactLedgerBlock = buildSourceFactLedgerPromptBlock(
      pickContextValue('sourceFactLedger'),
      'SOURCE FACT LEDGER (READ-ONLY SOURCE SUPPORT)'
    )
    if (sourceFactLedgerBlock) {
      parts.push(sourceFactLedgerBlock)
    }
  }

  // If no parts, return empty (no header, no placeholder)
  if (parts.length === 0) return ''

  // Build the block with header and instruction
  return `
════════════════════════════════════════════════════════════════════════════════
NORMALIZED DATA (READ-ONLY CONTEXT – DO NOT INVENT MISSING FIELDS)
════════════════════════════════════════════════════════════════════════════════
${parts.join('\n')}
`
}

/**
 * Build the Claim 1 context block for injection into prompts.
 * Returns empty string if Claim 1 is not available or injection is disabled.
 * 
 * CRITICAL: Never returns placeholder text like "Not available" or "None provided"
 */
export function buildIndependentClaimsBlock(
  normalizedData: Record<string, any> | null | undefined,
  mode: Claim1Mode
): string {
  if (mode === 'off') return ''

  const independentClaims = getIndependentClaims(normalizedData)
  const claimsText = formatIndependentClaimsText(independentClaims)
  if (!claimsText) return ''

  // The saved claim set is the legal authority for drafting whether or not the user
  // has explicitly locked it, so the model is told to treat it as binding either way.
  const statusLabel = areClaimsFrozen(normalizedData) ? '(FROZEN - LEGAL AUTHORITY)' : '(LEGAL AUTHORITY)'
  const heading = independentClaims.length > 1 ? 'INDEPENDENT CLAIMS' : 'CLAIM 1'

  let modeInstruction = ''
  if (mode === 'bindingAnchor') {
    modeInstruction = `
${heading} BINDING INSTRUCTION:
- Do NOT add elements not supported by the independent claims
- Keep terminology EXACTLY consistent with the independent claims
- All features described must trace back to independent claim language`
  } else if (mode === 'constraintOnly') {
    modeInstruction = `
${heading} CONSTRAINT INSTRUCTION:
- Use independent claims ONLY for terminology consistency
- Do NOT enumerate or restate claim features
- Avoid contradiction with independent claim scope`
  }

  return `
════════════════════════════════════════════════════════════════════════════════
${heading} ${statusLabel}
════════════════════════════════════════════════════════════════════════════════
${claimsText}
${modeInstruction}
`
}

export function buildClaim1Block(
  normalizedData: Record<string, any> | null | undefined,
  mode: Claim1Mode
): string {
  return buildIndependentClaimsBlock(normalizedData, mode)
}

function stripClaimMarkup(value: unknown): string {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function claimNumberForSort(claim: any, fallback: number): number {
  const parsed = Number(claim?.number)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getDetailedDescriptionAllClaimsText(
  normalizedData: Record<string, any> | null | undefined
): string {
  if (!normalizedData) return ''
  const snapshot = getAuthoritativeClaims(normalizedData)
  if (Array.isArray(snapshot.structured) && snapshot.structured.length > 0) {
    return [...snapshot.structured]
      .sort((a: any, b: any) => claimNumberForSort(a, Number.MAX_SAFE_INTEGER) - claimNumberForSort(b, Number.MAX_SAFE_INTEGER))
      .map((claim: any, index: number) => {
        const number = claimNumberForSort(claim, index + 1)
        const type = String(claim?.type || '').trim()
        const category = String(claim?.category || '').trim()
        const dependsOn = claim?.dependsOn || claim?.depends_on
        const metadata = [
          type ? type : '',
          category ? category : '',
          dependsOn ? `depends on claim ${dependsOn}` : '',
        ].filter(Boolean).join(', ')
        const text = stripClaimMarkup(claim?.text || claim?.claim || claim?.content)
        return text ? `Claim ${number}${metadata ? ` (${metadata})` : ''}: ${text}` : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return stripClaimMarkup(snapshot.html)
}

export function buildDetailedDescriptionClaimCoverageBlock(
  normalizedData: Record<string, any> | null | undefined
): string {
  const allClaimsText = getDetailedDescriptionAllClaimsText(normalizedData)
  if (!allClaimsText) return ''

  return `
DETAILED DESCRIPTION CLAIM COVERAGE CHECKLIST (FROZEN CLAIMS)
- Treat this checklist as mandatory coverage for the Detailed Description.
- Discuss each independent claim element and each dependent-claim added limitation at least once when source-supported.
- Dependent-claim limitations may be drafted as concise optional-variation paragraphs after the core Claim 1 disclosure.
- Use claim terminology consistently, but do NOT copy claim sentence structure or "wherein" phrasing.
- If a claim limitation conflicts with the Normalized Data or source guardrails, keep the safer supported wording and do not invent missing implementation detail.

${allClaimsText}
`.trim()
}

/**
 * Build complete Universal Drafting Bundle (UDB) for a section.
 * Combines Normalized Data and Claim 1 based on section config.
 * 
 * Returns { block: string, gated: boolean, gateReason?: string }
 */
export function buildUniversalDraftingBundle(
  sectionKey: string,
  normalizedData: Record<string, any> | null | undefined,
  idea: Record<string, any> | null | undefined,
  existingSections?: Record<string, string> | null | undefined,
  options?: DraftingContextOptions
): { block: string; gated: boolean; gateReason?: string } {
  // Validate inputs
  if (!sectionKey) {
    console.warn('[buildUniversalDraftingBundle] Empty sectionKey provided')
    return { block: '', gated: false }
  }

  const config = getSectionInjectionConfig(sectionKey)
  if (normalizedData && migrateNormalizedData(normalizedData).extractionFailed) {
    return {
      block: '',
      gated: true,
      gateReason: 'Stage 0 normalization failed. Regenerate the invention structure before drafting sections.',
    }
  }

  // Check gating first (uses the new function that checks normalizedData directly)
  if (shouldGateSection(sectionKey, normalizedData)) {
    const gateReason = getGatingReason(sectionKey, normalizedData)
    return {
      block: '',
      gated: true,
      gateReason: gateReason || `Section "${sectionKey}" cannot be generated due to missing Claim 1 context.`
    }
  }

  const parts: string[] = []

  // Add Normalized Data block if enabled
  // Pass existingSections to use AI-generated title if available
  if (config.injectNormalizedData) {
    const ndBlock = buildNormalizedDataBlock(normalizedData, idea, existingSections, { ...options, sectionKey })
    if (ndBlock && ndBlock.trim()) {
      parts.push(ndBlock)
    }
  }

  // Add Claim 1 block if enabled and available
  // Use non-frozen check here since we already passed gating (which checks frozen for critical sections)
  const claim1Available = isClaim1Available(normalizedData)
  if (config.injectClaim1 && claim1Available && !options?.suppressClaimInjection) {
    const c1Block = buildIndependentClaimsBlock(normalizedData, config.claim1Mode)
    if (c1Block && c1Block.trim()) {
      parts.push(c1Block)
    }
  }

  if (isDetailedDescriptionKey(sectionKey) && claim1Available) {
    const claimCoverageBlock = buildDetailedDescriptionClaimCoverageBlock(normalizedData)
    if (claimCoverageBlock && claimCoverageBlock.trim()) {
      parts.push(claimCoverageBlock)
    }
  }

  return {
    block: parts.join('\n'),
    gated: false
  }
}

/**
 * Anti-hallucination guards for missing optional data.
 * These are injected automatically and are NOT admin-controlled.
 */
export function buildAntiHallucinationGuards(
  hasFigures: boolean,
  hasPriorArt: boolean,
  hasComponents: boolean,
  options?: { figuresSkipped?: boolean }
): string {
  const guards: string[] = []

  if (options?.figuresSkipped) {
    guards.push(buildFigurelessDraftGuard())
  }

  if (!options?.figuresSkipped && !hasFigures) {
    guards.push('• Do NOT invent figure numbers or titles that are not provided.')
  }

  if (!hasPriorArt) {
    guards.push('• Do NOT cite patent documents or publications that are not provided.')
  }

  if (!hasComponents) {
    guards.push('• Do NOT invent component names or reference numerals that are not provided.')
  }

  if (guards.length === 0) return ''

  return `
════════════════════════════════════════════════════════════════════════════════
ANTI-HALLUCINATION GUARDS (MANDATORY)
════════════════════════════════════════════════════════════════════════════════
${guards.join('\n')}
`
}

function isDetailedDescriptionKey(sectionKey: string): boolean {
  const compact = String(sectionKey || '').toLowerCase().replace(/[_\-\s.]/g, '')
  return compact === 'detaileddescription' || compact === 'description'
}

const DETAILED_DESCRIPTION_UNSAFE_CONSTRAINTS = [
  /\bmultiple\s+embodiments?\b/i,
  /\banother\s+embodiment\b/i,
  /\bdescribe\s+best\s+mode\b/i,
  /\bbest\s+mode\b/i,
  /\bpreferred\s+embodiments?\b/i,
  /\bpreferred\s+mode\b/i,
  /\bspecific\s+parameters?\b/i,
  /\bexamples?\b/i,
  /\bsample\s+data\b/i,
  /\btest\s+(?:measurements?|results?|data)\b/i,
  /\bnumerical\s+(?:values?|ranges?)\b/i
]

/**
 * Detailed Description constraints are database/admin controlled, so filter only
 * the high-risk directives that invite unsupported subject matter. Other
 * sections remain fully admin-controlled.
 */
export function filterDetailedDescriptionConstraints(
  sectionKey: string,
  constraints: string[] | null | undefined
): string[] {
  return partitionDetailedDescriptionConstraints(sectionKey, constraints).kept
}

/**
 * Same filter, but returns what was removed as well.
 *
 * Admins author these constraints in Super Admin and used to get no signal at
 * all that one had been dropped — a jurisdiction constraint such as "Describe the
 * best mode contemplated by the inventor" was saved, silently deleted here, and
 * never reached the model. Callers should record `removed` on the debug trail so
 * the drop is visible rather than invisible.
 */
export function partitionDetailedDescriptionConstraints(
  sectionKey: string,
  constraints: string[] | null | undefined
): { kept: string[]; removed: string[] } {
  const list = Array.isArray(constraints) ? constraints.filter(Boolean) : []
  if (!isDetailedDescriptionKey(sectionKey)) return { kept: list, removed: [] }

  const kept: string[] = []
  const removed: string[] = []
  for (const constraint of list) {
    const text = String(constraint || '')
    if (DETAILED_DESCRIPTION_UNSAFE_CONSTRAINTS.some(pattern => pattern.test(text))) {
      removed.push(text)
    } else {
      kept.push(text)
    }
  }
  return { kept, removed }
}

export const DETAILED_DESCRIPTION_SOURCE_LOCK_BLOCK = `
DETAILED DESCRIPTION SOURCE LOCK (RUNTIME OVERRIDE - CRITICAL)
- The invention scope for detailedDescription is limited to the Frozen Claims, the Normalized Data, and the auto-selected Detailed Description source evidence.
- Frozen Claim 1 remains the core embodiment anchor, but dependent-claim limitations must also receive written-description support when they are present in the Frozen Claims.
- Auto-selected Detailed Description source data may be used as positive support only when it appears in the "AUTO-SELECTED DETAILED DESCRIPTION SOURCE DATA" block.
- Detailed Description source guardrails may be used only as exclusions or risk constraints.
- Figures, components, reference numerals, and injected DD user data are auxiliary context only.
- Auxiliary context may be used only to label, cite, or clarify subject matter already supported by the Frozen Claims, Normalized Data, or auto-selected Detailed Description source data.
- Auxiliary context MUST NOT be used as an independent source for adding components, structures, steps, use cases, environments, examples, values, materials, operating conditions, or results.
- Optional variations may be drafted only when each variation is expressly present in the Frozen Claims, Normalized Data, auto-selected Detailed Description source data, or an enabled jurisdictional requirement.
- Internal algorithms, control logic, formulas, weighting factors, thresholds, numerical ranges, materials, test values, and calculation steps may be drafted only when expressly present in the Frozen Claims, Normalized Data, or auto-selected Detailed Description source data.
- If a detail is not expressly present in the Frozen Claims, Normalized Data, or auto-selected Detailed Description source data, omit the detail.
- Do NOT fill gaps using technical assumptions, common implementations, field knowledge, or drafting conventions.
- Do NOT use generic phrases such as "in some embodiments" or "for example" to introduce unsupported subject matter.
- Each sentence must be traceable to the Frozen Claims, Normalized Data, or auto-selected Detailed Description source data, except for permitted reference labels and figure parentheticals.
`.trim()

const DETAILED_DESCRIPTION_PRESERVE_LOCK_ADDENDUM = `
PRESERVE MODE ADDITIONS (user chose "Keep exactly what I provided"):
- The Original Inventor Disclosure block, when present, is an additional authoritative source alongside the Frozen Claims and Normalized Data.
- A detail expressly present in the Original Inventor Disclosure may be described even if the Normalized Data omitted it.
- Use the inventor's own terminology as the canonical vocabulary; do not rename or generalize the inventor's terms.
- Do not omit features the inventor stated in the Original Inventor Disclosure unless the user's scope selections exclude them.`.trimEnd()

export function buildDetailedDescriptionSourceLockBlock(
  sectionKey: string,
  sourceFidelityMode?: 'PRESERVE' | 'STRUCTURE_ONLY'
): string {
  if (!isDetailedDescriptionKey(sectionKey)) return ''
  return sourceFidelityMode === 'PRESERVE'
    ? `${DETAILED_DESCRIPTION_SOURCE_LOCK_BLOCK}\n${DETAILED_DESCRIPTION_PRESERVE_LOCK_ADDENDUM}`
    : DETAILED_DESCRIPTION_SOURCE_LOCK_BLOCK
}

type DetailedDescriptionScopeOptions = {
  figuresSkipped?: boolean
}

export type DetailedDescriptionScopeContext = {
  guard: string
  scopeText: string
  scopedComponents: any[]
  scopedFigures: any[]
  allowedReferenceLabels: string[]
  allowedFigureNumbers: number[]
}

const SCOPE_STOPWORDS = new Set([
  'about',
  'above',
  'after',
  'also',
  'and',
  'are',
  'based',
  'being',
  'below',
  'between',
  'claim',
  'claims',
  'comprising',
  'configured',
  'data',
  'each',
  'from',
  'having',
  'include',
  'includes',
  'including',
  'into',
  'method',
  'module',
  'more',
  'one',
  'only',
  'or',
  'said',
  'system',
  'that',
  'the',
  'thereof',
  'through',
  'unit',
  'wherein',
  'with'
])

const GENERIC_FIGURE_TOKENS = new Set([
  'activity',
  'apparatus',
  'architecture',
  'arrangement',
  'block',
  'composition',
  'constituent',
  'diagram',
  'drawing',
  'embodiment',
  'figure',
  'flow',
  'formulation',
  'front',
  'method',
  'overview',
  'perspective',
  'process',
  'schematic',
  'sequence',
  'side',
  'system',
  'top',
  'view'
])

function normalizeScopeText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function padScopeText(value: unknown): string {
  const normalized = normalizeScopeText(value)
  return normalized ? ` ${normalized} ` : ''
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  values.forEach(value => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim()
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) return
    seen.add(key)
    out.push(normalized)
  })
  return out
}

function toScopeValues(value: unknown): string[] {
  if (!value) return []
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || /^not stated by source$/i.test(trimmed)) return []
    return [trimmed]
  }
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(item => toScopeValues(item))
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return [
      ...toScopeValues(record.name),
      ...toScopeValues(record.title),
      ...toScopeValues(record.component),
      ...toScopeValues(record.description),
      ...toScopeValues(record.inputs),
      ...toScopeValues(record.outputs),
      ...toScopeValues(record.dependencies),
      ...toScopeValues(record.conditions),
      ...toScopeValues(record.alternatives),
      ...toScopeValues(record.parent)
    ]
  }
  return []
}

/**
 * Crude English stem, enough to make singular/plural and the common verb endings
 * compare equal.
 *
 * Without this, the matcher was exact-substring only, and its failure mode was
 * silent deletion of real components: a component named "Temperature Sensors"
 * against a claim reciting "a temperature sensor" scored one token out of two,
 * missed the two-token threshold, and was dropped from the Detailed Description —
 * taking its reference numeral with it. Plurals are not a scope decision.
 */
function scopeStem(token: string): string {
  let stem = token
  if (stem.length > 4 && stem.endsWith('ies')) return `${stem.slice(0, -3)}y`
  if (stem.length > 4 && (stem.endsWith('ses') || stem.endsWith('xes') || stem.endsWith('zes') || stem.endsWith('ches') || stem.endsWith('shes'))) {
    return stem.slice(0, -2)
  }
  if (stem.length > 3 && stem.endsWith('s') && !stem.endsWith('ss')) stem = stem.slice(0, -1)
  if (stem.length > 5 && stem.endsWith('ing')) stem = stem.slice(0, -3)
  else if (stem.length > 4 && stem.endsWith('ed')) stem = stem.slice(0, -2)
  return stem
}

function distinctiveScopeTokens(value: unknown) {
  return uniqueStrings(
    normalizeScopeText(value)
      .split(' ')
      .filter(token => token.length > 2 && !/^\d+$/.test(token) && !SCOPE_STOPWORDS.has(token))
  )
}

/** Stemmed token set for a whole block of scope text, built once per comparison. */
function scopeStemSet(paddedScopeText: string): Set<string> {
  const set = new Set<string>()
  paddedScopeText.split(' ').forEach(token => {
    if (!token) return
    set.add(token)
    set.add(scopeStem(token))
  })
  return set
}

function scopeContainsCandidate(paddedScopeText: string, candidate: unknown): boolean {
  const normalizedCandidate = normalizeScopeText(candidate)
  if (!paddedScopeText || !normalizedCandidate || /^not stated by source$/i.test(normalizedCandidate)) {
    return false
  }

  if (normalizedCandidate.length >= 4 && paddedScopeText.includes(` ${normalizedCandidate} `)) {
    return true
  }

  const tokens = distinctiveScopeTokens(candidate)
  if (!tokens.length) return false

  const scopeTokens = scopeStemSet(paddedScopeText)
  const hits = tokens.filter(token => scopeTokens.has(token) || scopeTokens.has(scopeStem(token))).length

  // One- and two-token names need a single hit (with stemming, a plural mismatch
  // no longer costs the hit). Longer names need two, so "Power Supply Unit" does
  // not match a scope text that merely says "power" somewhere.
  return hits >= Math.min(2, Math.ceil(tokens.length / 2))
}

function formatReferenceLabel(label: unknown): string {
  const raw = String(label || '').trim()
  if (!raw) return ''
  return raw.replace(/^\((.*)\)$/, '$1')
}

function componentName(component: any): string {
  return String(component?.name || component?.title || component?.component || '').trim()
}

function componentReferenceLabel(component: any): string {
  return formatReferenceLabel(component?.referenceLabel || component?.numeral)
}

export function buildDetailedDescriptionScopeText(
  normalizedData: Record<string, any> | null | undefined,
  idea: Record<string, any> | null | undefined
): string {
  const nd = normalizedData || {}
  const ideaData = idea || {}
  const claims = getDetailedDescriptionAllClaimsText(nd) || extractIndependentClaims(nd) || ''

  const fields = [
    claims,
    ideaData.title,
    nd.title,
    ideaData.problem,
    ideaData.problemStatement,
    nd.problem,
    ideaData.objectives,
    nd.objectives,
    ideaData.solution,
    nd.solution,
    ideaData.description,
    nd.description,
    ideaData.fieldOfRelevance,
    nd.fieldOfRelevance,
    ideaData.subfield,
    nd.subfield,
    ideaData.logic,
    nd.logic,
    ideaData.inputs,
    nd.inputs,
    ideaData.outputs,
    nd.outputs,
    ideaData.variants,
    nd.variants,
    ideaData.bestMethod,
    nd.bestMethod,
    ideaData.coreInventiveConcept,
    nd.coreInventiveConcept,
    ideaData.drawingsFocus,
    nd.drawingsFocus,
    ideaData.claimStrategy,
    nd.claimStrategy,
    ...toScopeValues(ideaData.components),
    ...toScopeValues(nd.components),
    ...toScopeValues(ideaData.claimableFeatures),
    ...toScopeValues(nd.claimableFeatures),
    ...toScopeValues(ideaData.fallbackLimitations),
    ...toScopeValues(nd.fallbackLimitations),
    ...buildSourceFactLedgerEntries(ideaData.sourceFactLedger || nd.sourceFactLedger).map(entry => entry.value)
  ]

  return padScopeText(uniqueStrings(fields.filter(Boolean).map(String)).join(' '))
}

export function filterComponentsByInventionScope(
  components: any[] | null | undefined,
  normalizedData: Record<string, any> | null | undefined,
  idea: Record<string, any> | null | undefined
): any[] {
  const list = Array.isArray(components) ? components : []
  if (!list.length) return []

  const scopeText = buildDetailedDescriptionScopeText(normalizedData, idea)
  // With no scope text there is nothing to test against, and dropping every
  // component is the worst possible answer: it strips the entire reference-numeral
  // set out of the Detailed Description. Keep what the user actually entered.
  if (!scopeText) return list

  const kept = list.filter(component => {
    const name = componentName(component)
    if (!name) return false
    // Match on the component's description too, not just its name — a component
    // named for its role often shares no words with the claim wording that
    // describes what it does.
    return scopeContainsCandidate(scopeText, name)
      || scopeContainsCandidate(scopeText, (component as any)?.description)
  })

  // Never let the filter empty the list outright. If nothing matched, the scope
  // text is unrepresentative rather than the components being out of scope, and
  // an empty allowed list makes every reference label in the section illegal.
  return kept.length ? kept : list
}

function isFigureInInventionScope(
  figure: any,
  scopeText: string,
  scopedComponents: any[]
): boolean {
  const title = String(figure?.title || '').trim()
  const description = String(figure?.description || '').trim()
  const figureText = `${title} ${description}`.trim()
  if (!figureText) return false

  const paddedFigureText = padScopeText(figureText)
  const componentMatch = scopedComponents.some(component => {
    const name = componentName(component)
    return name && scopeContainsCandidate(paddedFigureText, name)
  })
  if (componentMatch) return true

  const tokens = distinctiveScopeTokens(figureText)
    .filter(token => !GENERIC_FIGURE_TOKENS.has(token))

  // No distinctive tokens means the figure title is entirely generic ("FIG. 2 is a
  // side view"), which says nothing either way — keep it. The component path makes
  // the same call now, so the two halves of this guard no longer bias in opposite
  // directions.
  if (!tokens.length) return true
  const scopeTokens = scopeStemSet(scopeText)
  const hits = tokens.filter(token => scopeTokens.has(token) || scopeTokens.has(scopeStem(token))).length
  return hits > 0
}

export function filterFiguresByInventionScope(
  figures: any[] | null | undefined,
  normalizedData: Record<string, any> | null | undefined,
  idea: Record<string, any> | null | undefined,
  scopedComponents: any[] | null | undefined,
  options?: DetailedDescriptionScopeOptions
): any[] {
  if (options?.figuresSkipped) return []
  const list = Array.isArray(figures) ? figures : []
  if (!list.length) return []

  const scopeText = buildDetailedDescriptionScopeText(normalizedData, idea)
  if (!scopeText) return []

  const components = Array.isArray(scopedComponents) ? scopedComponents : []
  return list.filter(figure => isFigureInInventionScope(figure, scopeText, components))
}

export function buildDetailedDescriptionScopeContext(
  normalizedData: Record<string, any> | null | undefined,
  idea: Record<string, any> | null | undefined,
  components: any[] | null | undefined,
  figures: any[] | null | undefined,
  options?: DetailedDescriptionScopeOptions
): DetailedDescriptionScopeContext {
  const scopeText = buildDetailedDescriptionScopeText(normalizedData, idea)
  const descriptionSelectedComponents = filterComponentsByScopeForDescription(
    Array.isArray(components) ? components : [],
    normalizedData?.scopeRecommendations
  )
  const scopedComponents = filterComponentsByInventionScope(descriptionSelectedComponents, normalizedData, idea)
  const scopedFigures = filterFiguresByInventionScope(figures, normalizedData, idea, scopedComponents, options)
  const allowedReferenceLabels = uniqueStrings(
    scopedComponents.map(componentReferenceLabel).filter(Boolean)
  )
  const allowedFigureNumbers = uniqueStrings(
    scopedFigures
      .map((figure: any) => String(figure?.figureNo || '').trim())
      .filter(Boolean)
  ).map(value => Number(value)).filter(Number.isFinite)

  const componentLine = scopedComponents.length
    ? scopedComponents
        .slice(0, 80)
        .map(component => {
          const name = componentName(component)
          const label = componentReferenceLabel(component)
          return label ? `${name} (${label})` : name
        })
        .filter(Boolean)
        .join('; ')
    : 'No component/reference-numeral entries are authorized beyond the Claim 1 and Normalized Data terminology.'

  const figureLine = allowedFigureNumbers.length
    ? allowedFigureNumbers.map(number => `FIG. ${number}`).join(', ')
    : 'No figure references are authorized for this section.'

  const guard = `
DETAILED DESCRIPTION INVENTION-SCOPE GUARD (CRITICAL)
- The allowed invention is limited to the Frozen Claims, Normalized Data, and auto-selected Detailed Description source evidence.
- Additional context supplies labels and citations only; it does not expand the invention.
- Ignore any supplied component, reference numeral, figure, person, organization, product, prior-art system, environment, use case, example, or named entity that is not supported by the Frozen Claims, Normalized Data, or auto-selected Detailed Description source evidence.
- Do NOT use figure titles, figure descriptions, sketches, or reference numerals as an independent source for adding entities to the invention.
- Use only the allowed component/reference context listed below when adding reference labels.
- Use only the allowed figure references listed below, and only as parentheticals.

Allowed component/reference context:
${componentLine}

Allowed figure references:
${figureLine}
`.trim()

  return {
    guard,
    scopeText,
    scopedComponents,
    scopedFigures,
    allowedReferenceLabels,
    allowedFigureNumbers
  }
}

/**
 * Validate that a prompt does not contain empty placeholders.
 * Used for testing/debugging.
 */
export function validateNoEmptyPlaceholders(prompt: string): { valid: boolean; violations: string[] } {
  const forbiddenPatterns = [
    /not available/i,
    /none provided/i,
    /no .* available/i,
    /no .* specified/i,
    /data not available/i,
    /claims data not available/i,
    /full draft not available/i,
    /\{\{[A-Z_]+\}\}/g, // Unreplaced template variables
  ]

  const violations: string[] = []

  for (const pattern of forbiddenPatterns) {
    const match = prompt.match(pattern)
    if (match) {
      violations.push(`Found forbidden placeholder: "${match[0]}"`)
    }
  }

  return {
    valid: violations.length === 0,
    violations
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CLAIMS INJECTION INVARIANTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Patterns that indicate full claims are being injected (not just Claim 1)
 */
const FULL_CLAIMS_PATTERNS = [
  /FROZEN CLAIMS/i,
  /FULL CLAIMS/i,
  /ALL CLAIMS/i,
  /claims?\s*\d+\s*[-–]\s*\d+/i, // "claims 1-20" or similar
  /dependent\s+claim/i, // Reference to dependent claims
]

/**
 * Patterns that indicate Claim 1 is being referenced (allowed)
 */
const CLAIM_1_PATTERNS = [
  /CLAIM 1/i,
  /claim\s*1\s*[.:,\s]/i,
  /first\s+independent\s+claim/i,
  /C1 Anchor/i,
]

/**
 * Validate claims injection invariants for a drafting prompt.
 * 
 * Invariants:
 * 1. Non-claims sections must never receive full/dependent claims
 * 2. Claim anchors and full/dependent claims must never appear together in a prompt
 * 3. Only the 'claims' section may contain full/dependent claims
 * 
 * @param prompt - The prompt to validate
 * @param sectionKey - The section this prompt is for
 * @returns Validation result with violations
 */
export function validateClaimsInjectionInvariants(
  prompt: string,
  sectionKey: string
): { valid: boolean; violations: string[] } {
  const violations: string[] = []
  const isClaimsSection = sectionKey === 'claims'
  
  // Check for full claims patterns
  const hasFullClaims = FULL_CLAIMS_PATTERNS.some(pattern => pattern.test(prompt))
  const hasClaim1 = CLAIM_1_PATTERNS.some(pattern => pattern.test(prompt))
  
  // Invariant 1: Non-claims sections must never receive full claims
  if (!isClaimsSection && hasFullClaims) {
    violations.push(
      `INVARIANT VIOLATION: Section "${sectionKey}" contains full claims. ` +
      `Only the 'claims' section may receive full claims. ` +
      `Non-claims sections should only use Claim 1 anchoring.`
    )
  }
  
  // Invariant 2: Claim 1 and full claims must never appear together
  if (hasClaim1 && hasFullClaims) {
    violations.push(
      `INVARIANT VIOLATION: Prompt contains both Claim 1 reference and full claims. ` +
      `These must not appear together. Use only Claim 1 for anchoring in drafting sections.`
    )
  }
  
  // Log violations for debugging
  if (violations.length > 0) {
    console.error(`[validateClaimsInjectionInvariants] ${violations.length} violation(s) for section "${sectionKey}":`)
    violations.forEach(v => console.error(`  - ${v}`))
  }
  
  return {
    valid: violations.length === 0,
    violations
  }
}

/**
 * Check if a prompt is safe for drafting (passes all invariants).
 * 
 * @param prompt - The prompt to validate
 * @param sectionKey - The section this prompt is for
 * @returns true if safe, false if invariants are violated
 */
export function isDraftingPromptSafe(prompt: string, sectionKey: string): boolean {
  const placeholderCheck = validateNoEmptyPlaceholders(prompt)
  const claimsCheck = validateClaimsInjectionInvariants(prompt, sectionKey)
  
  return placeholderCheck.valid && claimsCheck.valid
}

/**
 * Sanitize a prompt by removing any full claims that shouldn't be there.
 * This is a safety net - ideally invariants should prevent this from being needed.
 * 
 * @param prompt - The prompt to sanitize
 * @param sectionKey - The section this prompt is for
 * @returns Sanitized prompt with warnings logged
 */
export function sanitizeDraftingPrompt(prompt: string, sectionKey: string): string {
  if (sectionKey === 'claims') {
    // Claims section can have full claims
    return prompt
  }
  
  let sanitized = prompt
  let sanitizationApplied = false
  
  // Remove any "FROZEN CLAIMS" blocks if they appear
  const frozenClaimsBlockRegex = /FROZEN CLAIMS[\s\S]*?═{10,}/g
  if (frozenClaimsBlockRegex.test(sanitized)) {
    console.warn(`[sanitizeDraftingPrompt] Removing FROZEN CLAIMS block from "${sectionKey}" section`)
    // Reset regex lastIndex after test
    frozenClaimsBlockRegex.lastIndex = 0
    sanitized = sanitized.replace(frozenClaimsBlockRegex, '')
    sanitizationApplied = true
  }
  
  if (sanitizationApplied) {
    console.warn(`[sanitizeDraftingPrompt] Prompt for "${sectionKey}" was sanitized to remove full claims`)
  }
  
  return sanitized
}

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Validates the configuration for internal consistency.
 * Call this during startup or in tests to catch configuration issues early.
 * 
 * Checks:
 * 1. All gated sections must have injectClaim1 = true in config
 * 2. Config keys are consistent (no duplicate meanings)
 * 3. Mode settings are valid for injectClaim1 value
 */
export function validateConfiguration(): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  
  // Check 1: All gated sections must have injectClaim1 = true
  const gatedSectionsList = Array.from(SECTIONS_REQUIRING_CLAIM1_FOR_GENERATION)
  for (const gatedSection of gatedSectionsList) {
    // Find the config for this section using same normalization as shouldGateSection
    const normalizedGated = normalizeSectionKeyForGating(gatedSection)
    let foundConfig = false
    let hasC1Injection = false
    
    for (const [key, config] of Object.entries(SECTION_INJECTION_CONFIG)) {
      // Use same normalization to match keys consistently
      if (normalizeSectionKeyForGating(key) === normalizedGated) {
        foundConfig = true
        hasC1Injection = config.injectClaim1
        break
      }
    }
    
    if (!foundConfig) {
      errors.push(`Gated section "${gatedSection}" not found in SECTION_INJECTION_CONFIG`)
    } else if (!hasC1Injection) {
      errors.push(`Gated section "${gatedSection}" has injectClaim1=false but requires Claim 1 for generation`)
    }
  }
  
  // Check 2: Mode settings are valid for injectClaim1 value
  for (const [key, config] of Object.entries(SECTION_INJECTION_CONFIG)) {
    if (!config.injectClaim1 && config.claim1Mode !== 'off') {
      errors.push(`Section "${key}" has injectClaim1=false but claim1Mode="${config.claim1Mode}" (should be "off")`)
    }
    if (config.injectClaim1 && config.claim1Mode === 'off') {
      errors.push(`Section "${key}" has injectClaim1=true but claim1Mode="off" (should be "bindingAnchor" or "constraintOnly")`)
    }
  }
  
  // Log results
  if (errors.length > 0) {
    console.error(`[validateConfiguration] Found ${errors.length} configuration error(s):`)
    errors.forEach(e => console.error(`  - ${e}`))
  }
  
  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Test helper: Validates that extracted Claim 1 is correct for given test data.
 */
export function validateClaim1Extraction(
  testNormalizedData: Record<string, any>,
  expectedClaim1Text: string | null
): { valid: boolean; actual: string | null; expected: string | null } {
  const actual = extractClaim1(testNormalizedData)
  const valid = actual === expectedClaim1Text
  
  if (!valid) {
    console.error(`[validateClaim1Extraction] Mismatch:`)
    console.error(`  Expected: ${expectedClaim1Text}`)
    console.error(`  Actual: ${actual}`)
  }
  
  return { valid, actual, expected: expectedClaim1Text }
}
