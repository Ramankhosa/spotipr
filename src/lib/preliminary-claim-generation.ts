import type {
  DraftClaim,
  DraftClaimSupportMatrixItem,
} from '@/lib/draft-claims-parser'
import {
  buildSourceFactLedgerEntries,
  buildSourceFactLedgerPromptBlock,
} from '@/lib/source-fact-ledger'
import { buildClaimScopePromptBlock } from '@/lib/scope-recommendations'
import {
  buildInventorTerminologyBlock,
  buildSourceFidelityPromptBlock,
  type SourceFidelityMode,
} from '@/lib/source-fidelity'
import {
  buildSupportDataSourceEntries,
  buildSupportDataSourcePromptBlock,
  hasSupportDataSources,
} from '@/lib/support-data-sources'

export type PreliminaryPatentType = 'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION'

export type PreliminaryClaimScopeStyle = 'broad' | 'default' | 'narrow'

export type PreliminaryClaimQualityStatus = 'source_supported' | 'needs_review' | 'thin_disclosure'

export const DEFAULT_PRELIMINARY_MAX_CLAIMS = 10

export type PreliminaryClaimQualityWarning = {
  code: string
  severity: 'info' | 'warning'
  message: string
  claimNumber?: number
  supportRefs?: string[]
}

export type PreliminaryClaimSupportMatrixItem = {
  claimNumber: number
  supportRefs: string[]
  supportSummary: string
  sourceFields: string[]
}

export type PreliminaryClaimGenerationQuality = {
  status: PreliminaryClaimQualityStatus
  warnings: PreliminaryClaimQualityWarning[]
  supportMatrix: PreliminaryClaimSupportMatrixItem[]
  analyzedAt: string
  source: 'static' | 'llm_and_static'
}

export const PRELIMINARY_CLAIM_RESET_KEYS = [
  'claims',
  'claimsStructured',
  'claimsProvisional',
  'claimsStructuredProvisional',
  'claimsFinal',
  'claimsStructuredFinal',
  'claimsApprovedAt',
  'claimsApprovedBy',
  'claimsGeneratedAt',
  'claimsLastSavedAt',
  'claimsJurisdiction',
  'claimGenerationQuality',
  'claimsRefinementPreview',
  'claimsRefinementApplied',
  'claimsRefinementNotes',
  'claimsRefinementSource',
] as const

export function resetPreliminaryClaimFields(normalizedData: Record<string, any> | null | undefined): Record<string, any> {
  const next = { ...(normalizedData || {}) }
  PRELIMINARY_CLAIM_RESET_KEYS.forEach((key) => {
    delete next[key]
  })
  return next
}

export type PreliminaryClaimResetBlockInput = {
  normalizedData?: Record<string, any> | null
  relatedArtRunCount?: number
  relatedArtSelectionCount?: number
  referenceMapCount?: number
  figurePlanCount?: number
  annexureDraftCount?: number
}

// Skipping prior art or claim refinement writes a claimsRefinementSource whose mode records
// the skip. Nothing was derived from the claims in that case — the stage only promoted them
// to final — so a skip must not block a reset the way an applied refinement does.
const SKIPPED_CLAIM_REFINEMENT_MODES = new Set(['SKIPPED', 'SKIPPED_REFINEMENT'])

function hasClaimRefinementWork(normalized: Record<string, any>): boolean {
  // Presence alone is not evidence of work: `claimsRefinementApplied: false` and an empty
  // notes string both mean nothing was applied.
  if (normalized.claimsRefinementApplied) return true
  if (typeof normalized.claimsRefinementNotes === 'string' && normalized.claimsRefinementNotes.trim()) return true

  const preview = normalized.claimsRefinementPreview
  if (preview && typeof preview === 'object' && Object.keys(preview).length > 0) return true

  const source = normalized.claimsRefinementSource
  if (source && typeof source === 'object') {
    const mode = String((source as any).mode || '').trim().toUpperCase()
    // An unrecognized or missing mode is treated as real refinement — fail closed.
    if (!SKIPPED_CLAIM_REFINEMENT_MODES.has(mode)) return true
  }

  return false
}

/**
 * Claims may be reset until something downstream has been derived from them.
 *
 * This is deliberately judged by artifacts, never by the session's current stage: a user can
 * navigate backwards freely, so `status` describes where they are standing, not what work
 * exists. Every downstream stage leaves a row behind (related-art runs and selections,
 * reference maps, figure plans, annexure drafts) or applied-refinement metadata, so those
 * checks already cover the cases the stage check was standing in for — while the stage check
 * additionally rejected sessions that had produced nothing at all.
 */
export function shouldBlockPreliminaryClaimReset(input: PreliminaryClaimResetBlockInput): boolean {
  return (
    (input.relatedArtRunCount || 0) > 0 ||
    (input.relatedArtSelectionCount || 0) > 0 ||
    (input.referenceMapCount || 0) > 0 ||
    (input.figurePlanCount || 0) > 0 ||
    (input.annexureDraftCount || 0) > 0 ||
    hasClaimRefinementWork(input.normalizedData || {})
  )
}

export type PreliminaryClaimContext = {
  title?: string
  rawIdea?: string
  problem?: string
  objectives?: string
  logic?: string
  components?: any[]
  bestMethod?: string
  abstract?: string
  coreInventiveConcept?: string
  claimableFeatures?: unknown
  fallbackLimitations?: unknown
  doNotClaim?: unknown
  sourceFactLedger?: unknown
  scopeRecommendations?: unknown
  supportDataSources?: unknown
  normalizationReviewWarnings?: unknown
  inventionType?: unknown
  patentTypePrimary?: PreliminaryPatentType | string
  fieldOfRelevance?: unknown
  field?: unknown
  subfield?: unknown
}

type BuildPreliminaryClaimsPromptParams = {
  jurisdiction: string
  countryName: string
  officeName: string
  tone: string
  voice: string
  avoid: string
  baseInstruction: string
  rulesBlock?: string
  constraintsBlock?: string
  writingSampleBlock?: string
  context: PreliminaryClaimContext
  patentTypePrimary: PreliminaryPatentType
  userClaimRemarks?: string
  claimScopeStyle?: PreliminaryClaimScopeStyle
  maxClaims?: number | null
  /**
   * Claim-positioning guidance carried over from a completed novelty assessment
   * (DraftingSession.noveltyHandoff.claimGuidance). Empty string when the session did not
   * originate from one.
   */
  noveltyGuidanceBlock?: string
  /**
   * The user's Stage-0 idea-handling choice (normalizedData.sourceHandlingMode).
   * PRESERVE adds strict idea-scope guard rules; STRUCTURE_ONLY leaves the prompt unchanged.
   */
  sourceFidelityMode?: SourceFidelityMode
}

type AnalyzePreliminaryClaimQualityParams = {
  claims: DraftClaim[]
  patentTypePrimary: PreliminaryPatentType
  context: PreliminaryClaimContext
  llmSupportMatrix?: DraftClaimSupportMatrixItem[]
  llmQualityWarnings?: string[]
}

export type SupportEntry = {
  id: string
  value: string
  sourceField: string
}

const STOPWORDS = new Set([
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
  'wherein',
  'with',
])

const MATERIAL_TERMS = [
  'aluminium',
  'aluminum',
  'ceramic',
  'copper',
  'ethanol',
  'graphene',
  'lithium',
  'methanol',
  'polymer',
  'silicone',
  'steel',
  'titanium',
]

export function normalizePreliminaryClaimScopeStyle(value: unknown): PreliminaryClaimScopeStyle {
  const style = String(value || '').trim().toLowerCase()
  if (style === 'broad' || style === 'narrow') return style
  return 'default'
}

function normalizeText(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^a-z0-9.%/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function words(value: unknown) {
  return normalizeText(value)
    .split(' ')
    .filter(Boolean)
}

function unique(values: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  values.forEach((value) => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim()
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) return
    seen.add(key)
    out.push(normalized)
  })
  return out
}

function toStringArray(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .map(item => typeof item === 'string' ? item : JSON.stringify(item))
      .map(item => item.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || /^not stated by source$/i.test(trimmed)) return []
    return [trimmed]
  }
  return [JSON.stringify(value)]
}

function formatContextScalar(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function formatInventionType(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim() || 'GENERAL'
  }

  if (Array.isArray(value)) {
    const items = value
      .map(item => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
    return items.length ? items.join(' + ') : 'GENERAL'
  }

  return 'GENERAL'
}

function formatListBlock(label: string, value: unknown) {
  const values = toStringArray(value)
  if (!values.length) return ''
  return `${label}:\n${values.map(item => `- ${item}`).join('\n')}`
}

function formatComponents(components: unknown) {
  if (!Array.isArray(components) || components.length === 0) return ''
  const lines = components
    .map((c: any) => {
      const label = (c.referenceLabel || c.numeral) ? ` (${c.referenceLabel || c.numeral})` : ''
      const desc = c.description ? `: ${c.description}` : ''
      const details = [
        c.inputs ? `inputs=${c.inputs}` : '',
        c.outputs ? `outputs=${c.outputs}` : '',
        c.dependencies ? `depends=${c.dependencies}` : '',
        c.parent ? `parent=${c.parent}` : '',
        c.conditions ? `conditions=${c.conditions}` : '',
        c.alternatives ? `alternatives=${c.alternatives}` : '',
      ].filter(Boolean).join('; ')
      return `- ${c.name || c.title || 'Unnamed component'}${label}${desc}${details ? ` [${details}]` : ''}`
    })
    .join('\n')
  return `Key Components:\n${lines}`
}

function formatWarnings(warnings: unknown) {
  const values = toStringArray(warnings).slice(0, 20)
  if (!values.length) return ''
  return `NORMALIZATION REVIEW WARNINGS (USER-REVIEW HINTS)\n${values.map(item => `- ${item}`).join('\n')}`
}

function buildClaimScopeStyleStrategyBlock(style: PreliminaryClaimScopeStyle) {
  const normalizedStyle = normalizePreliminaryClaimScopeStyle(style)
  if (normalizedStyle === 'broad') {
    return `CLAIM SCOPE STYLE STRATEGY
Selected style: Broad Style
- Draft Claim 1 at the broadest reasonable level that is still source-supported, enabled, and consistent with the disclosure.
- Claim 1 should recite the minimum source-supported inventive combination needed for patentable distinction and statutory category clarity.
- Do not add optional embodiments, examples, ranges, materials, use cases, performance results, or fallback details to Claim 1 unless they are required for source support or enablement.
- Put concrete embodiments, numeric values, materials, examples, alternatives, and fallback limitations into dependent claims when source-supported.
- Broad does not mean generic: avoid unsupported processor/module/results-only language and map every broad element to source support.`
  }
  if (normalizedStyle === 'narrow') {
    return `CLAIM SCOPE STYLE STRATEGY
Selected style: Narrow Claims
- Draft independent claims with more concrete source-supported differentiators for tighter initial coverage.
- Include central structural, operational, conditional, numeric, material, or relationship limitations in independent claims when they appear important to novelty, support, or enablement.
- Do not import every embodiment into Claim 1; keep dependent claims for additional fallbacks and alternatives.
- Do not include unsupported limitations merely to narrow the claim. Every narrowing limitation must map to SDS-ID, SF-ID, or normalized source context.
- Preserve jurisdiction rules, antecedent basis, and the machine-readable output contract.`
  }
  return `CLAIM SCOPE STYLE STRATEGY
Selected style: Default Style
- Use the current balanced strategy: source-supported independent claims with dependent fallback positions.
- Claim 1 should recite the source-supported inventive combination without unnecessary embodiment detail.
- Use dependent claims to add commercially valuable limitations, embodiments, ranges, materials, examples, and fallbacks.
- Keep the claim set neither obviously overbroad nor unnecessarily narrow, and preserve the source-support discipline.`
}

export function buildPreliminaryClaimsPrompt(params: BuildPreliminaryClaimsPromptParams): string {
  const {
    jurisdiction,
    countryName,
    officeName,
    tone,
    voice,
    avoid,
    baseInstruction,
    rulesBlock,
    constraintsBlock,
    writingSampleBlock,
    context,
    patentTypePrimary,
    userClaimRemarks,
    claimScopeStyle,
    maxClaims = DEFAULT_PRELIMINARY_MAX_CLAIMS,
    noveltyGuidanceBlock,
    sourceFidelityMode = 'STRUCTURE_ONLY',
  } = params
  const normalizedClaimScopeStyle = normalizePreliminaryClaimScopeStyle(claimScopeStyle)
  const sourceFidelityBlock = buildSourceFidelityPromptBlock(sourceFidelityMode, 'claims')
  const inventorTerminologyBlock = buildInventorTerminologyBlock(sourceFidelityMode, context.components)

  const sourceFactLedgerBlock = buildSourceFactLedgerPromptBlock(
    context.sourceFactLedger,
    'SOURCE FACT LEDGER FOR CLAIM SUPPORT'
  )
  const supportDataBlock = buildSupportDataSourcePromptBlock(
    context,
    'claims',
    'SUPPORT DATA SOURCES FOR CLAIM SUPPORT'
  )
  const claimScopeBlock = buildClaimScopePromptBlock(context.scopeRecommendations)

  const claimType = patentTypePrimary === 'PRODUCT'
    ? 'product, device, article, or apparatus'
    : patentTypePrimary === 'SYSTEM'
      ? 'system or apparatus'
      : patentTypePrimary === 'PROCESS'
        ? 'method or process'
        : 'composition or formulation'

  const primaryCategory = patentTypePrimary === 'PRODUCT'
    ? 'apparatus'
    : patentTypePrimary === 'SYSTEM'
      ? 'system'
      : patentTypePrimary === 'PROCESS'
        ? 'method'
        : 'composition'
  const primaryExampleSubject = primaryCategory === 'composition' ? 'constituents' : 'elements'

  const secondaryCategory = patentTypePrimary === 'PROCESS'
    ? 'system'
    : patentTypePrimary === 'COMPOSITION'
      ? 'method'
      : 'method'

  const inventionType = formatInventionType(context.inventionType)
  const renderedPatentType = patentTypePrimary || context.patentTypePrimary || 'UNKNOWN'
  const technicalField =
    formatContextScalar(context.fieldOfRelevance) ||
    formatContextScalar(context.field) ||
    'N/A'
  const subfield = formatContextScalar(context.subfield) || 'N/A'

  // Static per-jurisdiction blocks (preamble, base instruction, rules, constraints) must
  // stay ahead of any per-session content so provider prefix caching can engage on
  // regenerations. Only per-session blocks may appear after this prefix.
  return `You are a senior patent attorney drafting preliminary patent claims for a ${countryName} patent specification handled by the ${officeName}.
- Jurisdiction: ${jurisdiction}
- Tone: ${tone}
- Voice: ${voice}
- Avoid: ${avoid}

${baseInstruction}

${rulesBlock || ''}

${constraintsBlock || ''}

DOMAIN / ARCHETYPE CONTEXT
- Invention Archetype: ${inventionType}
- Patent Type: ${renderedPatentType}
- Technical Field: ${technicalField}
- Subfield: ${subfield}

Use this block only to adapt claim vocabulary, statutory claim category, and breadth strategy. Do not use it to introduce unsupported components, steps, materials, values, algorithms, use cases, therapeutic effects, or embodiments.
${writingSampleBlock || ''}

ORIGINAL SOURCE EXCERPT:
${context.rawIdea || 'Not provided'}

${claimScopeBlock ? `${claimScopeBlock}\n` : ''}
${noveltyGuidanceBlock ? `${noveltyGuidanceBlock}\n` : ''}

NORMALIZED INVENTION CONTEXT:
${context.title ? `Title: ${context.title}` : ''}
${context.problem ? `Problem: ${context.problem}` : ''}
${context.objectives ? `Objectives: ${context.objectives}` : ''}
${context.logic ? `Technical Logic: ${context.logic}` : ''}
${formatComponents(context.components)}
${context.bestMethod ? `Best Method: ${context.bestMethod}` : ''}
${context.abstract ? `Abstract: ${context.abstract}` : ''}
${context.coreInventiveConcept ? `Core Inventive Concept: ${context.coreInventiveConcept}` : ''}
${formatListBlock('Claimable Features', context.claimableFeatures)}
${formatListBlock('Fallback Limitations', context.fallbackLimitations)}
${formatListBlock('Do Not Claim / Missing Facts', context.doNotClaim)}
${supportDataBlock ? `\n${supportDataBlock}` : sourceFactLedgerBlock ? `\n${sourceFactLedgerBlock}` : ''}
${formatWarnings(context.normalizationReviewWarnings)}

SOURCE SUPPORT DISCIPLINE:
Every claim element MUST map to at least one source fact (SDS-ID, SF-ID, or normalized field).
If you cannot map a claim element to a source fact, do NOT include it in the claim.
Do not cite source-fact identifiers anywhere in your output, including inside claim text.

PATENT TYPE ENFORCEMENT:
Detected patent type: ${patentTypePrimary}
Expected Claim 1 category: ${claimType}.
Use the type-specific drafting rules from the database prompt for this detected category.

MULTI-INDEPENDENT CLAIM RUNTIME NOTE:
Use the Independent Claim Policy in the claims base prompt. The detected patent type is ${renderedPatentType}. The invention archetype is ${inventionType}. Additional independent claims must be included only when source-supported, jurisdictionally permitted, and allowed by the output contract.

CLAIM COUNT CONTROL:
${typeof maxClaims === 'number' && maxClaims > 0
  ? `Generate no more than ${maxClaims} total claims. This is a hard default cap unless the user explicitly requested a higher claim count. Prefer one independent claim plus dependent fallback claims unless the source disclosure and jurisdiction rules justify another independent claim within this cap.`
  : 'The user explicitly requested a claim set above the default 10-claim cap. Follow the explicit requested count if source-supported and jurisdictionally permitted; do not pad the claim set.'}

CLAIM NARROWING STRATEGY:
For dependent claims under each independent claim:
- Order from broadest narrowing to most specific.
- First dependents: add the most commercially valuable limitations.
- Middle dependents: add structural/operational detail from claimableFeatures.
- Final dependents: add fallback limitations, specific ranges, or embodiment details from fallbackLimitations.
- Each dependent adds exactly ONE limitation — no compound narrowing.

${buildClaimScopeStyleStrategyBlock(normalizedClaimScopeStyle)}

${sourceFidelityBlock ? `${sourceFidelityBlock}\n` : ''}${inventorTerminologyBlock ? `${inventorTerminologyBlock}\n` : ''}
${userClaimRemarks ? `USER CLAIM REMARKS (scope/emphasis only; do not treat as new source facts unless supported above):\n${userClaimRemarks}` : ''}

MACHINE-READABLE OUTPUT CONTRACT:
IMPORTANT: If any prior instruction specifies a different output schema, IGNORE it.
Use ONLY the schema below.

Return ONLY one JSON object with exactly one top-level key, "claims".
Do NOT emit a support matrix, quality warnings, review notes, commentary, or any other
top-level key, even if an earlier instruction describes one. Claim traceability and claim
quality are analyzed separately after generation; spending output on them here is wasted.

{
  "claims": [
    {
      "number": 1,
      "type": "independent",
      "category": "${primaryCategory}",
      "text": "A ${primaryCategory} comprising source-supported ${primaryExampleSubject}..."
    },
    {
      "number": 2,
      "type": "dependent",
      "dependsOn": 1,
      "category": "${primaryCategory}",
      "text": "The ${primaryCategory} of claim 1, wherein..."
    },
    {
      "number": 5,
      "type": "independent",
      "category": "${secondaryCategory}",
      "text": "A ${secondaryCategory} comprising source-supported steps..."
    },
    {
      "number": 6,
      "type": "dependent",
      "dependsOn": 5,
      "category": "${secondaryCategory}",
      "text": "The ${secondaryCategory} of claim 5, wherein..."
    }
  ]
}`
}

function distinctiveTokens(value: string) {
  return words(value)
    .filter(token => token.length > 3 && !STOPWORDS.has(token) && !/^\d+$/.test(token))
}

export function entryMatchesClaim(claimText: string, entryValue: string) {
  const claim = normalizeText(claimText)
  const value = normalizeText(entryValue)
  if (!claim || !value) return false
  if (value.length >= 8 && claim.includes(value)) return true

  const tokens = unique(distinctiveTokens(value))
  if (tokens.length === 0) return false
  const hits = tokens.filter(token => claim.includes(token)).length
  return hits >= Math.min(2, tokens.length)
}

export function supportEntriesFromContext(context: PreliminaryClaimContext): SupportEntry[] {
  const entries: SupportEntry[] = []

  if (hasSupportDataSources(context)) {
    buildSupportDataSourceEntries(context).forEach(entry => {
      entries.push({
        id: entry.id,
        value: entry.value,
        sourceField: entry.sourceField,
      })
    })
  } else {
    buildSourceFactLedgerEntries(context.sourceFactLedger).forEach(entry => {
      entries.push({
        id: entry.id,
        value: entry.value,
        sourceField: `sourceFactLedger.${entry.category}`,
      })
    })
  }

  if (Array.isArray(context.components)) {
    context.components.forEach((component: any, index) => {
      const value = [
        component?.name,
        component?.description,
        component?.inputs,
        component?.outputs,
        component?.dependencies,
        component?.conditions,
        component?.alternatives,
      ].filter(Boolean).join(' ')
      if (value.trim()) {
        entries.push({
          id: `normalized.components-${index + 1}`,
          value,
          sourceField: 'components',
        })
      }
    })
  }

  const normalizedFieldEntries: Array<[string, unknown]> = [
    ['normalized.problem', context.problem],
    ['normalized.objectives', context.objectives],
    ['normalized.logic', context.logic],
    ['normalized.coreInventiveConcept', context.coreInventiveConcept],
  ]
  normalizedFieldEntries.forEach(([id, value]) => {
    if (typeof value === 'string' && value.trim() && !/^not stated by source$/i.test(value.trim())) {
      entries.push({ id, value: value.trim(), sourceField: String(id).replace('normalized.', '') })
    }
  })

  toStringArray(context.claimableFeatures).forEach((value, index) => {
    entries.push({ id: `normalized.claimableFeatures-${index + 1}`, value, sourceField: 'claimableFeatures' })
  })
  toStringArray(context.fallbackLimitations).forEach((value, index) => {
    entries.push({ id: `normalized.fallbackLimitations-${index + 1}`, value, sourceField: 'fallbackLimitations' })
  })

  const scope = context.scopeRecommendations as any
  if (scope && Array.isArray(scope.elements)) {
    scope.elements.forEach((element: any, index: number) => {
      const effectiveClaim = element?.user?.claim ?? element?.recommended?.claim
      if ((effectiveClaim === 'claim_1' || effectiveClaim === 'dependent_claim') && typeof element?.label === 'string' && element.label.trim()) {
        entries.push({
          id: `scopeRecommendations.elements-${index + 1}`,
          value: element.label.trim(),
          sourceField: `scopeRecommendations.${effectiveClaim}`,
        })
      }
    })
  }

  return entries
}

function sourceTextFromContext(context: PreliminaryClaimContext, supportEntries: SupportEntry[]) {
  return [
    context.rawIdea,
    context.title,
    context.problem,
    context.objectives,
    context.logic,
    context.bestMethod,
    context.abstract,
    context.coreInventiveConcept,
    ...toStringArray(context.claimableFeatures),
    ...toStringArray(context.fallbackLimitations),
    ...supportEntries.map(entry => entry.value),
  ].filter(Boolean).join(' ')
}

function extractClaimNumbers(text: string) {
  const out: string[] = []
  const regex = /\b\d+(?:\.\d+)?\b/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - 12), match.index).toLowerCase()
    if (/\bclaims?\s+$/.test(before)) continue
    out.push(match[0])
  }
  return unique(out)
}

function claimMatchesPatentType(claim: DraftClaim | undefined, patentTypePrimary: PreliminaryPatentType) {
  if (!claim) return false
  const text = normalizeText(`${claim.category || ''} ${claim.text}`)
  if (patentTypePrimary === 'PROCESS') return /\b(method|process)\b/.test(text)
  if (patentTypePrimary === 'COMPOSITION') return /\b(composition|formulation|mixture)\b/.test(text)
  if (patentTypePrimary === 'PRODUCT') return /\b(product|device|apparatus|article|assembly)\b/.test(text)
  return /\b(system|apparatus)\b/.test(text)
}

function isGenericClaimOne(claim: DraftClaim | undefined, supportRefs: string[]) {
  if (!claim) return false
  const text = normalizeText(claim.text)
  const genericPhrase = /\b(configured to perform operations|performing operations|receiving data|processing data|generating an output|one or more processors|at least one processor)\b/.test(text)
  const genericTerms = (text.match(/\b(processor|memory|module|controller|unit|component|data|information|operation|output)\b/g) || []).length
  return supportRefs.length < 2 && (genericPhrase || genericTerms >= 4 || words(text).length < 24)
}

function mergeSupportMatrix(
  claims: DraftClaim[],
  supportEntries: SupportEntry[],
  llmSupportMatrix: DraftClaimSupportMatrixItem[] = []
): PreliminaryClaimSupportMatrixItem[] {
  const llmByClaim = new Map<number, DraftClaimSupportMatrixItem>()
  llmSupportMatrix.forEach(item => {
    if (item.claimNumber) llmByClaim.set(Number(item.claimNumber), item)
  })

  return claims.map((claim) => {
    const staticMatches = supportEntries.filter(entry => entryMatchesClaim(claim.text, entry.value))
    const llmItem = llmByClaim.get(claim.number)
    const supportRefs = unique([
      ...(llmItem?.supportRefs || []),
      ...staticMatches.map(entry => entry.id),
    ])
    const sourceFields = unique([
      ...(llmItem?.sourceFields || []),
      ...staticMatches.map(entry => entry.sourceField),
    ])

    return {
      claimNumber: claim.number,
      supportRefs,
      supportSummary: llmItem?.supportSummary || (supportRefs.length
        ? `Supported by ${supportRefs.slice(0, 4).join(', ')}${supportRefs.length > 4 ? '...' : ''}.`
        : 'No explicit support reference matched automatically.'),
      sourceFields,
    }
  })
}

function escapeForRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getClaimChainText(claim: DraftClaim, allClaims: DraftClaim[]): string {
  const chain: string[] = []
  let current: DraftClaim | undefined = claim
  const visited = new Set<number>()
  while (current && !visited.has(current.number)) {
    visited.add(current.number)
    chain.unshift(current.text)
    if (current.type === 'dependent' && current.dependsOn) {
      current = allClaims.find(c => c.number === current!.dependsOn)
    } else {
      break
    }
  }
  return chain.join(' ')
}

export function analyzePreliminaryClaimQuality(params: AnalyzePreliminaryClaimQualityParams): PreliminaryClaimGenerationQuality {
  const { claims, patentTypePrimary, context, llmSupportMatrix = [], llmQualityWarnings = [] } = params
  const supportEntries = supportEntriesFromContext(context)
  const supportMatrix = mergeSupportMatrix(claims, supportEntries, llmSupportMatrix)
  const sourceText = normalizeText(sourceTextFromContext(context, supportEntries))
  const warnings: PreliminaryClaimQualityWarning[] = []

  llmQualityWarnings.forEach((message) => {
    warnings.push({
      code: 'LLM_QUALITY_WARNING',
      severity: 'warning',
      message,
    })
  })

  const independentClaims = claims.filter(claim => claim.type === 'independent')
  if (independentClaims.length === 0) {
    warnings.push({
      code: 'INDEPENDENT_CLAIM_COUNT',
      severity: 'warning',
      message: 'Expected at least one independent claim; found none.',
    })
  }

  const claimOne = claims.find(claim => Number(claim.number) === 1)
  const claimOneSupport = supportMatrix.find(item => item.claimNumber === 1)?.supportRefs || []
  if (!claimMatchesPatentType(claimOne, patentTypePrimary)) {
    warnings.push({
      code: 'PATENT_TYPE_MISMATCH',
      severity: 'warning',
      claimNumber: 1,
      message: `Claim 1 may not clearly match the selected ${patentTypePrimary} patent type.`,
    })
  }

  if (isGenericClaimOne(claimOne, claimOneSupport)) {
    warnings.push({
      code: 'GENERIC_CLAIM_1',
      severity: 'warning',
      claimNumber: 1,
      supportRefs: claimOneSupport,
      message: 'Claim 1 appears broad or generic. Review whether it recites the source-supported inventive combination.',
    })
  }

  const claimNumbers = new Set(claims.map(claim => Number(claim.number)))
  claims.forEach((claim) => {
    if (claim.type === 'dependent') {
      if (!claim.dependsOn || !claimNumbers.has(Number(claim.dependsOn)) || Number(claim.dependsOn) >= Number(claim.number)) {
        warnings.push({
          code: 'DEPENDENCY_REVIEW',
          severity: 'warning',
          claimNumber: claim.number,
          message: `Claim ${claim.number} dependency should be reviewed.`,
        })
      }
    }

    const matrixItem = supportMatrix.find(item => item.claimNumber === claim.number)
    if (claim.number > 1 && (!matrixItem || matrixItem.supportRefs.length === 0)) {
      warnings.push({
        code: 'DEPENDENT_SUPPORT_REVIEW',
        severity: 'warning',
        claimNumber: claim.number,
        message: `Claim ${claim.number} did not automatically match a source support reference.`,
      })
    }

    extractClaimNumbers(claim.text).forEach((number) => {
      if (!sourceText.includes(number.toLowerCase())) {
        warnings.push({
          code: 'UNSUPPORTED_NUMERIC_VALUE',
          severity: 'warning',
          claimNumber: claim.number,
          message: `Claim ${claim.number} includes numeric value "${number}" that was not found in the source context.`,
        })
      }
    })

    MATERIAL_TERMS.forEach((material) => {
      if (normalizeText(claim.text).includes(material) && !sourceText.includes(material)) {
        warnings.push({
          code: 'UNSUPPORTED_MATERIAL',
          severity: 'warning',
          claimNumber: claim.number,
          message: `Claim ${claim.number} includes material "${material}" that was not found in the source context.`,
        })
      }
    })

    if (/\bmeans\s+for\b/i.test(claim.text)) {
      warnings.push({
        code: 'MEANS_PLUS_FUNCTION',
        severity: 'warning',
        claimNumber: claim.number,
        message: `Claim ${claim.number} uses "means for" language which may invoke 112(f) narrowing to disclosed structure + equivalents.`,
      })
    }

    const claimChainText = getClaimChainText(claim, claims)
    const theRefs = claim.text.match(/\bthe\s+([a-z]+(?:\s+[a-z]+)?)\b/gi) || []
    theRefs.forEach((ref) => {
      const noun = ref.replace(/^the\s+/i, '').toLowerCase()
      if (/^(invention|claim|method|system|apparatus|composition|device|step|present)$/.test(noun)) return
      if (new RegExp(`\\b(a|an)\\s+${escapeForRegex(noun)}\\b`, 'i').test(claimChainText)) return
      if (new RegExp(`\\b${escapeForRegex(noun)}\\b`, 'i').test(claimChainText.split(claim.text)[0] || '')) return
      warnings.push({
        code: 'ANTECEDENT_BASIS',
        severity: 'warning',
        claimNumber: claim.number,
        message: `Claim ${claim.number}: "the ${noun}" may lack antecedent basis (no prior "a/an ${noun}" found in claim chain).`,
      })
    })
  })

  const nonNotStatedEntries = supportEntries.filter(entry => !/^not stated by source$/i.test(entry.value.trim()))
  const rawWordCount = words(context.rawIdea || '').length
  const componentCount = Array.isArray(context.components) ? context.components.length : 0
  const isThinDisclosure = rawWordCount > 0 && rawWordCount < 40 && componentCount < 2 && nonNotStatedEntries.length < 4
  if (isThinDisclosure) {
    warnings.push({
      code: 'THIN_DISCLOSURE',
      severity: 'info',
      message: 'The source disclosure appears thin. The preliminary claims may need inventor review for technical specificity.',
    })
  }

  const dedupedWarnings = warnings.filter((warning, index, arr) => {
    const key = `${warning.code}:${warning.claimNumber || ''}:${warning.message}`
    return arr.findIndex(other => `${other.code}:${other.claimNumber || ''}:${other.message}` === key) === index
  })

  const status: PreliminaryClaimQualityStatus = isThinDisclosure
    ? 'thin_disclosure'
    : dedupedWarnings.some(warning => warning.severity === 'warning')
      ? 'needs_review'
      : 'source_supported'

  return {
    status,
    warnings: dedupedWarnings,
    supportMatrix,
    analyzedAt: new Date().toISOString(),
    source: llmSupportMatrix.length || llmQualityWarnings.length ? 'llm_and_static' : 'static',
  }
}
