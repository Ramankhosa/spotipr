import {
  coerceSourceFactLedger,
  createEmptySourceFactLedger,
  type SourceFactLedger,
} from '@/lib/source-fact-ledger'
import {
  coerceScopeRecommendations,
  type ScopeRecommendations,
} from '@/lib/scope-recommendations'
import {
  coerceSupportDataSources,
  type SupportDataSource,
} from '@/lib/support-data-sources'
import type { PatentSearchConceptGroup } from '@/lib/patent-search/types'

export const NORMALIZED_DATA_SCHEMA_VERSION = 2

export type PatentTypePrimary = 'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION'
export type InventionArchetype = 'MECHANICAL' | 'ELECTRICAL' | 'SOFTWARE' | 'CHEMICAL' | 'BIO' | 'GENERAL'
export type SourceHandlingMode = 'PRESERVE' | 'STRUCTURE_ONLY'

export type SourceInputMeta = {
  originalFileName?: string
  mimeType?: string
  fileSize?: number
  detectedFormat?: string
  extractedCharCount?: number
  extractionHash?: string
  extractedAt?: string
  submittedCharCount?: number
  submittedHash?: string
  submittedAt?: string
  editedAfterExtraction?: boolean
}

export interface NormalizedComponent {
  name?: string
  type?: string
  description?: string
  inputs?: string
  outputs?: string
  dependencies?: string
  figureHint?: string
  parent?: string
  level?: number
  sequence?: number
  numberingHint?: string
  [key: string]: unknown
}

export interface NormalizedDataV2 {
  schemaVersion: 2
  extractionFailed?: boolean
  sourceInputMeta?: SourceInputMeta
  searchQuery?: string
  googlePatentKeywords?: string[]
  epoTitleKeywords?: string[]
  epoAbstractKeywords?: string[]
  epoCombinedKeywords?: string[]
  patentSearchConceptGroups?: PatentSearchConceptGroup[]
  problem?: string
  objectives?: string
  components: NormalizedComponent[]
  inventionType: InventionArchetype[]
  patentTypePrimary?: PatentTypePrimary
  logic?: string
  inputs?: string
  outputs?: string
  variants?: string
  bestMethod?: string
  fieldOfRelevance?: string
  subfield?: string
  recommendedFocus?: string
  complianceNotes?: string
  drawingsFocus?: string
  claimStrategy?: string
  coreInventiveConcept?: string
  claimableFeatures: string[]
  fallbackLimitations: string[]
  doNotClaim: string[]
  riskFlags?: string
  abstract?: string
  cpcCodes: string[]
  ipcCodes: string[]
  sourceFactLedger: SourceFactLedger
  supportDataSources: SupportDataSource[]
  scopeRecommendations?: ScopeRecommendations
  normalizationReviewWarnings: string[]
  sourceHandlingMode?: SourceHandlingMode
  [key: string]: unknown
}

export interface IdeaNormalizationExtractedFields {
  searchQuery?: string
  googlePatentKeywords?: string[]
  epoTitleKeywords?: string[]
  epoAbstractKeywords?: string[]
  epoCombinedKeywords?: string[]
  patentSearchConceptGroups?: PatentSearchConceptGroup[]
  problem?: string
  objectives?: string
  components?: NormalizedComponent[]
  logic?: string
  inputs?: string
  outputs?: string
  variants?: string
  inventionType?: InventionArchetype[]
  patentTypePrimary?: PatentTypePrimary
  bestMethod?: string
  fieldOfRelevance?: string
  subfield?: string
  recommendedFocus?: string
  complianceNotes?: string
  drawingsFocus?: string
  claimStrategy?: string
  coreInventiveConcept?: string
  claimableFeatures?: string[]
  fallbackLimitations?: string[]
  doNotClaim?: string[]
  riskFlags?: string
  abstract?: string
  cpcCodes?: string[]
  ipcCodes?: string[]
  sourceFactLedger?: SourceFactLedger
  normalizationReviewWarnings?: string[]
  scopeRecommendations?: ScopeRecommendations
  supportDataSources?: SupportDataSource[]
  sourceHandlingMode?: SourceHandlingMode
  extractionFailed?: boolean
  sourceInputMeta?: SourceInputMeta
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, any>) }
    : {}
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean)
  }
  if (typeof value === 'string' && value.trim() && !/^not stated by source$/i.test(value.trim())) {
    return [value.trim()]
  }
  return []
}

function normalizeKeywordPhrases(value: unknown, maxItems = 10): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[;\n|]/)
      : []
  return unique(raw
    .map(item => String(item || '').trim().replace(/\s+/g, ' '))
    .filter(item => item.length >= 3 && item.length <= 120)
    .filter(item => !/[()*?]/.test(item))
    .filter(item => item.split(/\s+/).length <= 10))
    .slice(0, maxItems)
}

function normalizePatentSearchConceptGroups(value: unknown): PatentSearchConceptGroup[] {
  if (!Array.isArray(value)) return []
  const groups: PatentSearchConceptGroup[] = []
  value.forEach((item, index) => {
      const record = asRecord(item)
      const terms = normalizeKeywordPhrases(record.terms || record.keywords || record.phrases, 8)
      if (terms.length === 0) return
      const rawKind = String(record.kind || '').trim().toLowerCase()
      const excluded = record.excluded === true || rawKind === 'excluded' || rawKind === 'exclude'
      groups.push({
        id: String(record.id || `concept_group_${index + 1}`).trim(),
        label: String(record.label || record.name || `Concept group ${index + 1}`).trim(),
        kind: rawKind || undefined,
        terms,
        required: record.required === false ? false : !excluded,
        excluded,
      })
    })
  return groups.slice(0, 6)
}

function normalizeInventionType(value: unknown): InventionArchetype[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,+/]/)
      : []
  const valid = new Set<InventionArchetype>(['MECHANICAL', 'ELECTRICAL', 'SOFTWARE', 'CHEMICAL', 'BIO', 'GENERAL'])
  const out = raw
    .map(item => String(item).trim().toUpperCase())
    .filter((item): item is InventionArchetype => valid.has(item as InventionArchetype))
  if (out.length === 0) return ['GENERAL']
  return Array.from(new Set(out.filter(item => item !== 'GENERAL' || out.length === 1)))
}

function normalizePatentType(value: unknown): PatentTypePrimary | undefined {
  const normalized = String(value || '').trim().toUpperCase()
  return ['PRODUCT', 'SYSTEM', 'PROCESS', 'COMPOSITION'].includes(normalized)
    ? normalized as PatentTypePrimary
    : undefined
}

function unique(values: string[]) {
  return Array.from(new Set(values.map(value => String(value).trim()).filter(Boolean)))
}

export function isLegacyExtractionFailure(value: unknown): boolean {
  const record = asRecord(value)
  const warningText = Array.isArray(record.normalizationReviewWarnings)
    ? record.normalizationReviewWarnings.join(' ')
    : ''
  return record.extractionFailed === true ||
    Object.values(record).some(item => typeof item === 'string' && item.includes('Extraction failed - review source text')) ||
    /LLM response could not be parsed/i.test(warningText)
}

export function migrateNormalizedData(
  value: unknown,
  defaults: Partial<Pick<NormalizedDataV2, 'patentTypePrimary' | 'inventionType' | 'sourceHandlingMode' | 'sourceInputMeta'>> = {}
): NormalizedDataV2 {
  const record = asRecord(value)
  const extractionFailed = isLegacyExtractionFailure(record)
  const warnings = unique([
    ...(Array.isArray(record.normalizationReviewWarnings)
      ? record.normalizationReviewWarnings.map((warning: unknown) => String(warning))
      : []),
    ...(extractionFailed ? ['Normalization output is marked as failed. Regenerate Stage 0 before drafting.'] : []),
  ])

  return {
    ...record,
    schemaVersion: NORMALIZED_DATA_SCHEMA_VERSION,
    ...(extractionFailed ? { extractionFailed: true } : {}),
    components: Array.isArray(record.components) ? record.components : [],
    inventionType: normalizeInventionType(record.inventionType || defaults.inventionType),
    patentTypePrimary: normalizePatentType(record.patentTypePrimary || defaults.patentTypePrimary),
    claimableFeatures: normalizeStringArray(record.claimableFeatures),
    fallbackLimitations: normalizeStringArray(record.fallbackLimitations),
    doNotClaim: normalizeStringArray(record.doNotClaim),
    googlePatentKeywords: normalizeKeywordPhrases(record.googlePatentKeywords ?? record.google_patent_keywords, 10),
    epoTitleKeywords: normalizeKeywordPhrases(record.epoTitleKeywords ?? record.epo_title_keywords, 6),
    epoAbstractKeywords: normalizeKeywordPhrases(record.epoAbstractKeywords ?? record.epo_abstract_keywords, 8),
    epoCombinedKeywords: normalizeKeywordPhrases(record.epoCombinedKeywords ?? record.epo_combined_keywords, 8),
    patentSearchConceptGroups: normalizePatentSearchConceptGroups(record.patentSearchConceptGroups ?? record.patent_search_concept_groups),
    cpcCodes: normalizeStringArray(record.cpcCodes),
    ipcCodes: normalizeStringArray(record.ipcCodes),
    sourceFactLedger: record.sourceFactLedger
      ? coerceSourceFactLedger(record.sourceFactLedger)
      : createEmptySourceFactLedger(),
    supportDataSources: coerceSupportDataSources(record.supportDataSources),
    scopeRecommendations: coerceScopeRecommendations(record.scopeRecommendations, record),
    normalizationReviewWarnings: warnings,
    sourceHandlingMode: (record.sourceHandlingMode || defaults.sourceHandlingMode) as SourceHandlingMode | undefined,
    sourceInputMeta: asRecord(record.sourceInputMeta || defaults.sourceInputMeta) as SourceInputMeta,
  }
}

export function buildIdeaNormalizationExtractedFields(normalizedData: NormalizedDataV2): IdeaNormalizationExtractedFields {
  return {
    searchQuery: typeof normalizedData.searchQuery === 'string' ? normalizedData.searchQuery.trim() : undefined,
    problem: normalizedData.problem,
    objectives: normalizedData.objectives,
    components: normalizedData.components,
    logic: normalizedData.logic,
    inputs: normalizedData.inputs,
    outputs: normalizedData.outputs,
    variants: normalizedData.variants,
    inventionType: normalizedData.inventionType,
    patentTypePrimary: normalizedData.patentTypePrimary,
    bestMethod: normalizedData.bestMethod,
    fieldOfRelevance: normalizedData.fieldOfRelevance,
    subfield: normalizedData.subfield,
    recommendedFocus: normalizedData.recommendedFocus,
    complianceNotes: normalizedData.complianceNotes,
    drawingsFocus: normalizedData.drawingsFocus,
    claimStrategy: normalizedData.claimStrategy,
    coreInventiveConcept: normalizedData.coreInventiveConcept,
    claimableFeatures: normalizedData.claimableFeatures,
    fallbackLimitations: normalizedData.fallbackLimitations,
    doNotClaim: normalizedData.doNotClaim,
    riskFlags: normalizedData.riskFlags,
    abstract: normalizedData.abstract,
    cpcCodes: normalizedData.cpcCodes,
    ipcCodes: normalizedData.ipcCodes,
    sourceFactLedger: normalizedData.sourceFactLedger,
    normalizationReviewWarnings: normalizedData.normalizationReviewWarnings,
    scopeRecommendations: normalizedData.scopeRecommendations,
    supportDataSources: normalizedData.supportDataSources,
    sourceHandlingMode: normalizedData.sourceHandlingMode,
    extractionFailed: normalizedData.extractionFailed,
    sourceInputMeta: normalizedData.sourceInputMeta,
    googlePatentKeywords: normalizedData.googlePatentKeywords,
    epoTitleKeywords: normalizedData.epoTitleKeywords,
    epoAbstractKeywords: normalizedData.epoAbstractKeywords,
    epoCombinedKeywords: normalizedData.epoCombinedKeywords,
    patentSearchConceptGroups: normalizedData.patentSearchConceptGroups,
  }
}
