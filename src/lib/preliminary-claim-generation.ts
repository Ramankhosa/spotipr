import type {
  DraftClaim,
  DraftClaimSupportMatrixItem,
} from '@/lib/draft-claims-parser'
import {
  buildSourceFactLedgerEntries,
  buildSourceFactLedgerPromptBlock,
} from '@/lib/source-fact-ledger'

export type PreliminaryPatentType = 'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION'

export type PreliminaryClaimQualityStatus = 'source_supported' | 'needs_review' | 'thin_disclosure'

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

type PreliminaryClaimContext = {
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
  normalizationReviewWarnings?: unknown
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
}

type AnalyzePreliminaryClaimQualityParams = {
  claims: DraftClaim[]
  patentTypePrimary: PreliminaryPatentType
  context: PreliminaryClaimContext
  llmSupportMatrix?: DraftClaimSupportMatrixItem[]
  llmQualityWarnings?: string[]
}

type SupportEntry = {
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
  } = params

  const sourceFactLedgerBlock = buildSourceFactLedgerPromptBlock(
    context.sourceFactLedger,
    'SOURCE FACT LEDGER FOR CLAIM SUPPORT'
  )

  const claimType = patentTypePrimary === 'PRODUCT'
    ? 'product, device, article, or apparatus'
    : patentTypePrimary === 'SYSTEM'
      ? 'system or apparatus'
      : patentTypePrimary === 'PROCESS'
        ? 'method or process'
        : 'composition or formulation'

  return `You are a senior patent attorney drafting preliminary patent claims for a ${countryName} patent specification handled by the ${officeName}.
- Jurisdiction: ${jurisdiction}
- Tone: ${tone}
- Voice: ${voice}
- Avoid: ${avoid}

${baseInstruction}

${rulesBlock || ''}

${constraintsBlock || ''}
${writingSampleBlock || ''}

ORIGINAL SOURCE EXCERPT:
${context.rawIdea || 'Not provided'}

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
${sourceFactLedgerBlock ? `\n${sourceFactLedgerBlock}` : ''}
${formatWarnings(context.normalizationReviewWarnings)}

PATENT TYPE ENFORCEMENT:
Detected patent type: ${patentTypePrimary}
Claim 1 must be a ${claimType} claim. Do not choose a different first independent claim category.

${userClaimRemarks ? `USER CLAIM REMARKS (scope/emphasis only; do not treat as new source facts unless supported above):\n${userClaimRemarks}` : ''}

PRELIMINARY CLAIM DRAFTING RULES:
1. Generate exactly one independent claim, Claim 1.
2. Claim 1 must recite the minimum source-supported inventive combination. It must not be a generic placeholder such as only a processor, controller, module, system, or method performing unspecified operations.
3. Dependent claims must each add a specific source-supported component, interaction, condition, fallback rule, embodiment, value, material, or composition detail.
4. Do not pad the set. If the source is thin, return fewer dependent claims and add a quality warning.
5. Do not invent unstated materials, values, steps, components, benefits, use cases, or advantages.
6. Do not convert optional features or alternatives into mandatory Claim 1 limitations unless the source states they are required.
7. Use source fact IDs, component names, and normalized fields in the supportMatrix so the user can review support.
8. Any concern about broadness, thin disclosure, or support must be reported in qualityWarnings. Do not auto-fix by inventing details.

OUTPUT FORMAT:
Return ONLY one JSON object:
{
  "claims": [
    {
      "number": 1,
      "type": "independent",
      "category": "method",
      "text": "A source-specific claim..."
    },
    {
      "number": 2,
      "type": "dependent",
      "dependsOn": 1,
      "category": "method",
      "text": "The method of claim 1, wherein..."
    }
  ],
  "supportMatrix": [
    {
      "claimNumber": 1,
      "supportRefs": ["SF-componentsAndSubcomponents-1", "normalized.logic"],
      "supportSummary": "Short explanation of source support.",
      "sourceFields": ["components", "logic"]
    }
  ],
  "qualityWarnings": [
    "Use only if the claim set needs user review."
  ]
}`
}

function distinctiveTokens(value: string) {
  return words(value)
    .filter(token => token.length > 3 && !STOPWORDS.has(token) && !/^\d+$/.test(token))
}

function entryMatchesClaim(claimText: string, entryValue: string) {
  const claim = normalizeText(claimText)
  const value = normalizeText(entryValue)
  if (!claim || !value) return false
  if (value.length >= 8 && claim.includes(value)) return true

  const tokens = unique(distinctiveTokens(value))
  if (tokens.length === 0) return false
  const hits = tokens.filter(token => claim.includes(token)).length
  return hits >= Math.min(2, tokens.length)
}

function supportEntriesFromContext(context: PreliminaryClaimContext): SupportEntry[] {
  const entries: SupportEntry[] = []

  buildSourceFactLedgerEntries(context.sourceFactLedger).forEach(entry => {
    entries.push({
      id: entry.id,
      value: entry.value,
      sourceField: `sourceFactLedger.${entry.category}`,
    })
  })

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
  if (independentClaims.length !== 1) {
    warnings.push({
      code: 'INDEPENDENT_CLAIM_COUNT',
      severity: 'warning',
      message: `Expected exactly one independent preliminary claim; found ${independentClaims.length}.`,
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
