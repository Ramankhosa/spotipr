/**
 * Country Import Service — one-shot provisioning from country_profile.json
 *
 * Given a validated (and repaired) country profile JSON, derives and writes
 * EVERYTHING a country needs to become draftable:
 *   CountryProfile, CountryName, CountrySectionMapping, CountrySectionPrompt
 *   (+ history), and the style tables (via country-style-import-service).
 *
 * Two entry points:
 *   planCountryImport(profileData, options)  — pure read + diff, returns an ImportPlan
 *   applyCountryImport(profileData, actor, options) — recomputes the plan, then
 *     executes it in ONE interactive transaction and invalidates all caches.
 *
 * Mapping derivation follows the MasterSeed conventions:
 *   supersetCode = "NN. <SupersetSection.label>" (NN = zero-padded per-country order)
 *   heading      = structure section label (display heading; export decorations
 *                  live in CountryExportHeading instead)
 *   displayOrder = structure section order; isRequired = structure required
 *
 * Re-imports preserve admin tuning (isEnabled + requires*Override) unless
 * options.resetAdminState is set, and never delete mappings.
 */

import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { PROMPT_KEY_TO_SECTION_KEY } from './prompt-merger-service'
import { importCountryStyles, StyleImportCounts } from './country-style-import-service'
import { invalidateCountryProfileCache } from './country-profile-service'
import { invalidateSectionPromptCache } from './section-prompt-service'
import { invalidateSupersetSectionsCache } from './multi-jurisdiction-service'
import { invalidateAliasCache } from './section-alias-service'

// ============================================================================
// Types
// ============================================================================

export interface ImportOptions {
  /** When true, derived isEnabled/overrides overwrite admin-tuned values */
  resetAdminState?: boolean
  /** When true, existing mappings not present in the JSON are disabled */
  disableExtras?: boolean
  /** When true, activate the profile after import (only if readiness passes) */
  activate?: boolean
  /**
   * Structure section ids the admin explicitly acknowledged dropping.
   * Unresolved/duplicate sections are BLOCKING errors unless listed here —
   * a section may only be lost from the import when someone said so.
   */
  skipSections?: string[]
}

export interface ImportIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  sectionId?: string
  candidates?: string[]
  suggestion?: string
}

export interface DerivedMapping {
  countryCode: string
  /** The structure section id this mapping was derived from */
  structureId: string
  sectionKey: string
  supersetCode: string
  heading: string
  displayOrder: number
  isRequired: boolean
  isEnabled: boolean
}

export interface MappingUpdate {
  sectionKey: string
  before: Record<string, unknown>
  after: Record<string, unknown>
}

export interface ImportPlan {
  countryCode: string
  countryName: { op: 'create' | 'update' | 'unchanged'; name: string; continent: string }
  profile: { op: 'create' | 'update' | 'unchanged'; fromVersion?: number; toVersion: number; status: string }
  mappings: {
    create: DerivedMapping[]
    update: MappingUpdate[]
    unchanged: string[]
    extra: string[]
  }
  prompts: { create: string[]; update: string[]; unchanged: string[]; skipped: string[] }
  styles: {
    diagramConfig: 'create' | 'update' | 'skip'
    diagramHints: number
    exportConfigs: Array<{ documentTypeId: string; op: 'create' | 'update' }>
    exportHeadings: number
    sectionValidations: Array<{ sectionKey: string; op: 'create' | 'update' }>
    crossValidations: Array<{ checkId: string; op: 'create' | 'update' }>
  }
  issues: ImportIssue[]
}

export interface ImportResult {
  plan: ImportPlan
  summary: Record<string, number>
  styleCounts: StyleImportCounts
}

export interface SupersetIndex {
  aliasMap: Map<string, string>
  byKey: Map<string, { sectionKey: string; label: string; displayOrder: number; instruction: string }>
  /** All identifiers per section (key, label, aliases) — used for suggestion scoring */
  namesByKey: Map<string, string[]>
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Split camelCase humps before normalizing, so "summaryOfTheInvention" → "summary_of_the_invention" */
function camelToSnake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
}

function snakeNorm(key: string): string {
  return normalizeKey(camelToSnake(key))
}

/** Filler words that carry no meaning when comparing section identifiers */
const KEY_STOPWORDS = new Set([
  'the', 'of', 'a', 'an', 'to', 'for', 'is', 'are', 'be', 'by', 'we', 'and', 'in', 'on', 'out', 'what'
])

function tokensOf(key: string): string[] {
  return snakeNorm(key).split('_').filter(t => t && !KEY_STOPWORDS.has(t))
}

/** Stopword-stripped canonical form: "title_of_the_invention" → "title_invention" */
function strippedKey(key: string): string {
  return tokensOf(key).join('_')
}

/**
 * Import-time synonym vocabulary: stopword-stripped identifier → canonical
 * superset sectionKey. Covers the names jurisdictions actually use for the
 * standard specification sections, so a hand-written country_profile.json
 * resolves without the author knowing the app's internal alias list.
 * Only consulted when the key exists in the live superset index (no blind
 * passthrough), so DB stays the source of truth for WHICH sections exist.
 */
const COMMON_SECTION_SYNONYMS: Record<string, string> = {
  // title
  title_invention: 'title', invention_title: 'title', name_invention: 'title',
  // claims
  patent_claims: 'claims', claimed: 'claims', claim: 'claims', claim_set: 'claims', claims_section: 'claims',
  // abstract
  abstract_disclosure: 'abstract', abstract_invention: 'abstract', abstract_specification: 'abstract',
  // summary
  summary_invention: 'summary', disclosure: 'summary', disclosure_invention: 'summary',
  brief_summary: 'summary', brief_summary_invention: 'summary', summary_disclosure: 'summary',
  // background
  background_invention: 'background', state_art: 'background', related_art: 'background',
  description_related_art: 'background', technical_background: 'background', background_technology: 'background',
  // field of invention
  technical_field_invention: 'fieldOfInvention', field_disclosure: 'fieldOfInvention',
  field_technology: 'fieldOfInvention', area_invention: 'fieldOfInvention',
  // brief description of drawings
  description_drawings: 'briefDescriptionOfDrawings', description_figures: 'briefDescriptionOfDrawings',
  brief_description_figures: 'briefDescriptionOfDrawings', list_drawings: 'briefDescriptionOfDrawings',
  list_figures: 'briefDescriptionOfDrawings', drawing_descriptions: 'briefDescriptionOfDrawings',
  // detailed description
  description: 'detailedDescription', description_embodiments: 'detailedDescription',
  modes_carrying_invention: 'detailedDescription', mode_carrying_invention: 'detailedDescription',
  modes_carrying: 'detailedDescription', mode_carrying: 'detailedDescription',
  detailed_description_embodiments: 'detailedDescription',
  detailed_description_preferred_embodiments: 'detailedDescription',
  description_preferred_embodiments: 'detailedDescription',
  description_exemplary_embodiments: 'detailedDescription',
  embodiments: 'detailedDescription', specific_embodiments: 'detailedDescription',
  // best mode
  best_mode_carrying_invention: 'bestMode', best_method_performing_invention: 'bestMode',
  best_mode_invention: 'bestMode', best_mode_performing_invention: 'bestMode',
  // industrial applicability
  utility: 'industrialApplicability', industrial_application: 'industrialApplicability',
  industrial_use: 'industrialApplicability', capable_industrial_application: 'industrialApplicability',
  industrial_applicability_statement: 'industrialApplicability',
  // list of reference numerals
  reference_signs: 'listOfNumerals', reference_signs_list: 'listOfNumerals',
  reference_numerals_list: 'listOfNumerals', list_reference_numerals: 'listOfNumerals',
  list_reference_signs: 'listOfNumerals', reference_sign_list: 'listOfNumerals',
  explanation_references: 'listOfNumerals', description_reference_numerals: 'listOfNumerals',
  // cross reference
  priority_claim: 'crossReference', cross_reference_related_applications: 'crossReference',
  priority_data: 'crossReference', priority_information: 'crossReference',
  related_application_data: 'crossReference', cross_references_related_applications: 'crossReference',
  // objects of invention
  objectives: 'objectsOfInvention', object_invention: 'objectsOfInvention',
  objectives_invention: 'objectsOfInvention', aims_invention: 'objectsOfInvention', aim_invention: 'objectsOfInvention',
  // technical problem
  problem_solved: 'technicalProblem', problem_solved_invention: 'technicalProblem',
  problem_statement: 'technicalProblem', problems_solved: 'technicalProblem', technical_problems: 'technicalProblem',
  // technical solution
  solution_problem: 'technicalSolution', means_solving_problem: 'technicalSolution',
  means_solve_problem: 'technicalSolution', technical_solutions: 'technicalSolution',
  solution_technical_problem: 'technicalSolution',
  // advantageous effects
  effects_invention: 'advantageousEffects', advantages: 'advantageousEffects',
  beneficial_effects: 'advantageousEffects', advantageous_effects_invention: 'advantageousEffects',
  advantages_invention: 'advantageousEffects', effect_invention: 'advantageousEffects'
}

/** Strip trailing qualifiers like "(optional)" from a display heading */
function cleanHeading(label: string): string {
  return label.replace(/\s*\((optional|conditional|if applicable)\)\s*$/i, '').trim()
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[n]
}

/**
 * Suggest the canonical superset key nearest to a candidate identifier.
 * Scores every superset section by comparing the candidate against its key,
 * label AND aliases using stopword-stripped token overlap (catches
 * "title_of_invention" → title) plus edit distance (catches typos like
 * "backgrund_art" → background). Only suggests a clear winner — a wrong
 * suggestion is worse than none, because accepting it writes a global alias.
 */
function nearestKey(candidate: string, index: SupersetIndex): string | undefined {
  const candTokens = tokensOf(candidate)
  const candStripped = candTokens.join('_')
  if (!candStripped) return undefined
  const candSet = new Set(candTokens)

  let bestKey: string | undefined
  let bestScore = 0
  let secondScore = 0

  index.namesByKey.forEach((names, sectionKey) => {
    let score = 0
    for (const name of names) {
      const nameTokens = tokensOf(name)
      const nameStripped = nameTokens.join('_')
      if (!nameStripped) continue
      if (nameStripped === candStripped) { score = 1; break }
      const nameSet = new Set(nameTokens)
      let overlap = 0
      candSet.forEach(t => { if (nameSet.has(t)) overlap++ })
      const jaccard = overlap / (candSet.size + nameSet.size - overlap)
      const dist = levenshtein(candStripped, nameStripped)
      const levSim = 1 - dist / Math.max(candStripped.length, nameStripped.length)
      score = Math.max(score, jaccard, levSim * 0.9)
    }
    if (score > bestScore) {
      secondScore = bestScore
      bestScore = score
      bestKey = sectionKey
    } else if (score > secondScore) {
      secondScore = score
    }
  })

  if (!bestKey) return undefined
  if (bestScore >= 0.8) return bestKey
  if (bestScore >= 0.55 && bestScore - secondScore >= 0.1) return bestKey
  return undefined
}

/**
 * Key-order-insensitive JSON equality. Postgres JSONB normalizes object key
 * order, so a byte-identical re-upload would otherwise read as "changed".
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b))
}

export interface SupersetSectionInput {
  sectionKey: string
  aliases: string[]
  label: string
  displayOrder: number
  instruction: string
}

/** Pure index builder — exported for unit testing with fixture data */
export function buildSupersetIndexFromSections(sections: SupersetSectionInput[]): SupersetIndex {
  const aliasMap = new Map<string, string>()
  const byKey = new Map<string, { sectionKey: string; label: string; displayOrder: number; instruction: string }>()
  const namesByKey = new Map<string, string[]>()

  // First-wins registration: if two sections ever declare the same identifier
  // (a data error), the lower displayOrder keeps it deterministically.
  const register = (name: string, canonical: string) => {
    for (const variant of [name, normalizeKey(name), snakeNorm(name), strippedKey(name)]) {
      if (variant && !aliasMap.has(variant)) aliasMap.set(variant, canonical)
    }
  }

  for (const section of sections) {
    register(section.sectionKey, section.sectionKey)
    for (const alias of section.aliases) register(alias, section.sectionKey)
    // Labels are resolvable too — profiles often use display names as ids
    // ("Title of the Invention" → title, also via its stripped form title_invention)
    if (section.label) register(section.label, section.sectionKey)
    byKey.set(section.sectionKey, {
      sectionKey: section.sectionKey,
      label: section.label,
      displayOrder: section.displayOrder,
      instruction: section.instruction
    })
    namesByKey.set(
      section.sectionKey,
      [section.sectionKey, section.label, ...section.aliases].filter(Boolean)
    )
  }

  return { aliasMap, byKey, namesByKey }
}

async function buildSupersetIndex(): Promise<SupersetIndex> {
  const sections = await prisma.supersetSection.findMany({
    where: { isActive: true },
    select: { sectionKey: true, aliases: true, label: true, displayOrder: true, instruction: true }
  })

  if (sections.length === 0) {
    throw new Error(
      '[CountryImport] No active SupersetSection rows found. Seed the superset catalog before importing countries.'
    )
  }

  return buildSupersetIndexFromSections(sections)
}

/**
 * Resolve a raw section identifier (structure id, canonical key, snake_case
 * alias, camelCase variant, display label, prompt key, or common synonym) to
 * a canonical SupersetSection.sectionKey.
 * Membership in the index is the test — no passthrough of unknown keys.
 */
function resolveToSectionKey(index: SupersetIndex, rawKey: string): string | null {
  const raw = (rawKey || '').trim()
  if (!raw) return null

  // 1. Direct/normalized/camel-split/stopword-stripped lookup against DB keys, aliases and labels
  for (const candidate of [raw, normalizeKey(raw), snakeNorm(raw), strippedKey(raw)]) {
    if (!candidate) continue
    const direct = index.aliasMap.get(candidate)
    if (direct) return direct
  }

  // 2. Legacy prompt-key mapping (e.g. "field" → fieldOfInvention)
  const viaPromptKey =
    PROMPT_KEY_TO_SECTION_KEY[raw.toLowerCase()] ?? PROMPT_KEY_TO_SECTION_KEY[normalizeKey(raw)]
  if (viaPromptKey && index.byKey.has(viaPromptKey)) return viaPromptKey

  // 3. Common-vocabulary synonyms — only for sections that exist in the live index
  for (const candidate of [normalizeKey(raw), snakeNorm(raw), strippedKey(raw)]) {
    if (!candidate) continue
    const viaSynonym = COMMON_SECTION_SYNONYMS[candidate]
    if (viaSynonym && index.byKey.has(viaSynonym)) return viaSynonym
  }

  return null
}

function getDefaultVariant(profileData: any): { variant: any | null; issue: ImportIssue | null } {
  const variants = profileData?.structure?.variants
  if (!Array.isArray(variants) || variants.length === 0) {
    return {
      variant: null,
      issue: {
        severity: 'error',
        code: 'NO_VARIANTS',
        message: 'structure.variants is missing or empty'
      }
    }
  }
  const variant = variants.find((v: any) => v.id === profileData.structure.defaultVariant) ?? variants[0]
  return { variant, issue: null }
}

// ============================================================================
// Mapping derivation
// ============================================================================

export interface DeriveOptions {
  /** Structure section ids explicitly acknowledged as dropped by the admin */
  skipSections?: string[]
}

export function deriveCountryMappings(
  profileData: any,
  index: SupersetIndex,
  opts: DeriveOptions = {}
): { mappings: DerivedMapping[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = []
  const mappings: DerivedMapping[] = []
  const countryCode = String(profileData?.meta?.code || '').toUpperCase()

  const { variant, issue } = getDefaultVariant(profileData)
  if (issue) return { mappings, issues: [issue] }

  const skipSet = new Set((opts.skipSections || []).map(s => String(s).trim()).filter(Boolean))
  const seenSectionKeys = new Set<string>()
  const seenSupersetCodes = new Set<string>()
  const sections = [...(variant.sections || [])].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))

  for (const section of sections) {
    const candidates: string[] = [...(section.canonicalKeys || []), section.id].filter(Boolean)

    let sectionKey: string | null = null
    for (const candidate of candidates) {
      sectionKey = resolveToSectionKey(index, candidate)
      if (sectionKey) break
    }

    if (!sectionKey) {
      if (skipSet.has(section.id)) {
        issues.push({
          severity: 'warning',
          code: 'SECTION_SKIPPED',
          message: `Section "${section.id}" (${section.label}) has no superset counterpart and was explicitly skipped by the admin.`,
          sectionId: section.id,
          candidates
        })
        continue
      }
      // BLOCKING: a section silently disappearing from a patent specification
      // is legal data loss — the admin must alias it, create a superset
      // section for it, or explicitly acknowledge the drop.
      issues.push({
        severity: 'error',
        code: 'UNRESOLVED_SECTION',
        message: `Section "${section.id}" (${section.label}) could not be resolved to a superset section. Add one of its keys as an alias to an existing superset section, create a new superset section for it, or explicitly skip it.`,
        sectionId: section.id,
        candidates,
        suggestion: nearestKey(candidates[0] || section.id, index)
      })
      continue
    }

    if (seenSectionKeys.has(sectionKey)) {
      if (skipSet.has(section.id)) {
        issues.push({
          severity: 'warning',
          code: 'SECTION_SKIPPED',
          message: `Section "${section.id}" resolves to superset key "${sectionKey}" already mapped by an earlier section, and was explicitly skipped by the admin.`,
          sectionId: section.id
        })
        continue
      }
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_CANONICAL_KEY',
        message: `Section "${section.id}" resolves to superset key "${sectionKey}" which is already mapped by an earlier section. Give the two sections distinct canonical keys, or explicitly skip one of them.`,
        sectionId: section.id
      })
      continue
    }
    seenSectionKeys.add(sectionKey)

    const superset = index.byKey.get(sectionKey)!
    const order = Number(section.order) || mappings.length + 1
    const supersetCode = `${String(order).padStart(2, '0')}. ${superset.label}`

    if (seenSupersetCodes.has(supersetCode)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_SUPERSET_CODE',
        message: `Duplicate supersetCode "${supersetCode}" derived for ${countryCode} — two sections share order ${order}. Fix the structure section orders.`,
        sectionId: section.id
      })
      continue
    }
    seenSupersetCodes.add(supersetCode)

    mappings.push({
      countryCode,
      structureId: section.id,
      sectionKey,
      supersetCode,
      heading: cleanHeading(section.label),
      displayOrder: order,
      isRequired: Boolean(section.required),
      isEnabled: true
    })
  }

  if (mappings.length === 0) {
    issues.push({
      severity: 'error',
      code: 'NO_MAPPINGS_DERIVED',
      message: 'No section mappings could be derived from the profile structure — the country would not be draftable.'
    })
  }

  return { mappings, issues }
}

// ============================================================================
// Prompt derivation
// ============================================================================

interface DerivedPrompt {
  sectionKey: string
  instruction: string
  constraints: string[]
  additions: string[]
  importFiguresDirectly: boolean
}

function derivePrompts(
  profileData: any,
  index: SupersetIndex,
  structureKeyMap?: Map<string, string>
): { prompts: DerivedPrompt[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = []
  const prompts: DerivedPrompt[] = []
  const seen = new Set<string>()

  const sections = profileData?.prompts?.sections || {}
  for (const [rawKey, rawConfig] of Object.entries<any>(sections)) {
    const config = rawConfig?.topUp ?? rawConfig
    if (!config?.instruction || typeof config.instruction !== 'string') continue

    const sectionKey = structureKeyMap?.get(rawKey) ?? resolveToSectionKey(index, rawKey)
    if (!sectionKey) {
      issues.push({
        severity: 'warning',
        code: 'UNRESOLVED_PROMPT_KEY',
        message: `Prompt key "${rawKey}" could not be resolved to a superset section — its top-up prompt will be skipped.`,
        sectionId: rawKey,
        suggestion: nearestKey(rawKey, index)
      })
      continue
    }
    if (seen.has(sectionKey)) {
      issues.push({
        severity: 'warning',
        code: 'DUPLICATE_PROMPT_KEY',
        message: `Prompt key "${rawKey}" resolves to "${sectionKey}" which already has a prompt in this profile — keeping the first.`,
        sectionId: rawKey
      })
      continue
    }
    seen.add(sectionKey)

    prompts.push({
      sectionKey,
      instruction: config.instruction,
      constraints: Array.isArray(config.constraints) ? config.constraints : [],
      additions: Array.isArray(config.additions) ? config.additions : [],
      importFiguresDirectly: Boolean(config.importFiguresDirectly)
    })
  }

  return { prompts, issues }
}

// ============================================================================
// Plan
// ============================================================================

const MAPPING_STRUCTURAL_FIELDS = ['supersetCode', 'heading', 'displayOrder', 'isRequired'] as const

export async function planCountryImport(profileData: any, options: ImportOptions = {}): Promise<ImportPlan> {
  const countryCode = String(profileData?.meta?.code || '').toUpperCase()
  const issues: ImportIssue[] = []

  if (!countryCode || countryCode.length < 2 || countryCode.length > 3) {
    return {
      countryCode,
      countryName: { op: 'unchanged', name: '', continent: 'Unknown' },
      profile: { op: 'unchanged', toVersion: 0, status: 'DRAFT' },
      mappings: { create: [], update: [], unchanged: [], extra: [] },
      prompts: { create: [], update: [], unchanged: [], skipped: [] },
      styles: { diagramConfig: 'skip', diagramHints: 0, exportConfigs: [], exportHeadings: 0, sectionValidations: [], crossValidations: [] },
      issues: [{ severity: 'error', code: 'INVALID_COUNTRY_CODE', message: `meta.code "${profileData?.meta?.code}" is not a valid 2-3 letter country code` }]
    }
  }

  const index = await buildSupersetIndex()

  // --- Profile ---
  const existingProfile = await prisma.countryProfile.findUnique({ where: { countryCode } })
  const profileChanged = !existingProfile || !deepEqualJson(existingProfile.profileData, profileData)
  const profilePlan = {
    op: (!existingProfile ? 'create' : profileChanged ? 'update' : 'unchanged') as 'create' | 'update' | 'unchanged',
    fromVersion: existingProfile?.version,
    toVersion: existingProfile ? (profileChanged ? existingProfile.version + 1 : existingProfile.version) : 1,
    status: existingProfile?.status ?? 'DRAFT'
  }

  // --- Country name ---
  const metaName = String(profileData?.meta?.name || countryCode)
  const metaContinent = String(profileData?.meta?.continent || 'Unknown')
  const existingName = await prisma.countryName.findUnique({ where: { code: countryCode } })
  const countryNamePlan = {
    op: (!existingName
      ? 'create'
      : existingName.name !== metaName || existingName.continent !== metaContinent
        ? 'update'
        : 'unchanged') as 'create' | 'update' | 'unchanged',
    name: metaName,
    continent: metaContinent
  }

  // --- Mappings ---
  const derived = deriveCountryMappings(profileData, index, { skipSections: options.skipSections })
  issues.push(...derived.issues)

  const existingMappings = await prisma.countrySectionMapping.findMany({ where: { countryCode } })
  const existingBySectionKey = new Map(existingMappings.map(m => [m.sectionKey, m]))
  const derivedKeys = new Set(derived.mappings.map(m => m.sectionKey))

  const mappingsPlan: ImportPlan['mappings'] = { create: [], update: [], unchanged: [], extra: [] }
  for (const mapping of derived.mappings) {
    const existing = existingBySectionKey.get(mapping.sectionKey)
    if (!existing) {
      mappingsPlan.create.push(mapping)
      continue
    }
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const field of MAPPING_STRUCTURAL_FIELDS) {
      const existingValue = existing[field]
      const derivedValue = mapping[field]
      if (existingValue !== derivedValue) {
        before[field] = existingValue
        after[field] = derivedValue
      }
    }
    if (options.resetAdminState) {
      if (existing.isEnabled !== mapping.isEnabled) {
        before.isEnabled = existing.isEnabled
        after.isEnabled = mapping.isEnabled
      }
      for (const override of ['requiresPriorArtOverride', 'requiresFiguresOverride', 'requiresClaimsOverride', 'requiresComponentsOverride'] as const) {
        if (existing[override] !== null) {
          before[override] = existing[override]
          after[override] = null
        }
      }
    }
    if (Object.keys(after).length > 0) {
      mappingsPlan.update.push({ sectionKey: mapping.sectionKey, before, after })
    } else {
      mappingsPlan.unchanged.push(mapping.sectionKey)
    }
  }
  for (const existing of existingMappings) {
    if (!derivedKeys.has(existing.sectionKey)) {
      mappingsPlan.extra.push(existing.sectionKey)
    }
  }

  // --- Prompts ---
  const planStructureKeyMap = new Map(derived.mappings.map(m => [m.structureId, m.sectionKey]))
  const derivedPrompts = derivePrompts(profileData, index, planStructureKeyMap)
  issues.push(...derivedPrompts.issues)

  const existingPrompts = await prisma.countrySectionPrompt.findMany({
    where: { countryCode, status: 'ACTIVE' }
  })
  const existingPromptByKey = new Map(existingPrompts.map(p => [p.sectionKey, p]))

  const promptsPlan: ImportPlan['prompts'] = { create: [], update: [], unchanged: [], skipped: [] }
  for (const prompt of derivedPrompts.prompts) {
    const existing = existingPromptByKey.get(prompt.sectionKey)
    if (!existing) {
      promptsPlan.create.push(prompt.sectionKey)
    } else if (
      existing.instruction !== prompt.instruction ||
      !deepEqualJson(existing.constraints ?? [], prompt.constraints) ||
      !deepEqualJson(existing.additions ?? [], prompt.additions)
    ) {
      promptsPlan.update.push(prompt.sectionKey)
    } else {
      promptsPlan.unchanged.push(prompt.sectionKey)
    }
  }
  promptsPlan.skipped = derivedPrompts.issues
    .filter(i => i.code === 'UNRESOLVED_PROMPT_KEY')
    .map(i => i.sectionId || '')

  // --- Styles ---
  const stylesPlan: ImportPlan['styles'] = {
    diagramConfig: 'skip',
    diagramHints: 0,
    exportConfigs: [],
    exportHeadings: 0,
    sectionValidations: [],
    crossValidations: []
  }
  if (profileData.diagrams) {
    const existingDiagram = await prisma.countryDiagramConfig.findUnique({ where: { countryCode } })
    stylesPlan.diagramConfig = existingDiagram ? 'update' : 'create'
    stylesPlan.diagramHints = Object.keys(profileData.diagrams.diagramGenerationHints || {}).length
  }
  if (Array.isArray(profileData.export?.documentTypes)) {
    const existingExports = await prisma.countryExportConfig.findMany({ where: { countryCode }, select: { documentTypeId: true } })
    const existingDocTypes = new Set(existingExports.map(e => e.documentTypeId))
    for (const docType of profileData.export.documentTypes) {
      const documentTypeId = docType.id || 'spec_pdf'
      stylesPlan.exportConfigs.push({ documentTypeId, op: existingDocTypes.has(documentTypeId) ? 'update' : 'create' })
    }
    stylesPlan.exportHeadings = Object.keys(profileData.export.sectionHeadings || {}).length * stylesPlan.exportConfigs.length
  }
  if (profileData.validation?.sectionChecks) {
    // Structure section ids (e.g. JP "description_of_embodiments") resolve via
    // the derived mappings first, then via the superset alias index
    const structureKeyMap = new Map(derived.mappings.map(m => [m.structureId, m.sectionKey]))
    const existingValidations = await prisma.countrySectionValidation.findMany({ where: { countryCode }, select: { sectionKey: true } })
    const existingValidationKeys = new Set(existingValidations.map(v => v.sectionKey))
    for (const rawKey of Object.keys(profileData.validation.sectionChecks)) {
      const sectionKey = structureKeyMap.get(rawKey) ?? resolveToSectionKey(index, rawKey)
      if (!sectionKey) {
        issues.push({
          severity: 'warning',
          code: 'UNRESOLVED_VALIDATION_KEY',
          message: `validation.sectionChecks key "${rawKey}" could not be resolved to a superset section — its limits will be skipped.`,
          sectionId: rawKey,
          suggestion: nearestKey(rawKey, index)
        })
        continue
      }
      stylesPlan.sectionValidations.push({ sectionKey, op: existingValidationKeys.has(sectionKey) ? 'update' : 'create' })
    }
  }
  if (Array.isArray(profileData.validation?.crossSectionChecks)) {
    const existingCross = await prisma.countryCrossValidation.findMany({ where: { countryCode }, select: { checkId: true } })
    const existingCheckIds = new Set(existingCross.map(c => c.checkId))
    for (const check of profileData.validation.crossSectionChecks) {
      if (!check?.from || !check?.type) continue
      const checkId = check.id || `${check.type}_${check.from}`
      stylesPlan.crossValidations.push({ checkId, op: existingCheckIds.has(checkId) ? 'update' : 'create' })
    }
  }

  // Readiness-critical sanity checks surfaced at plan time
  const enabledDerivedKeys = new Set(derived.mappings.map(m => m.sectionKey))
  for (const requiredKey of ['title', 'abstract']) {
    const stillEnabled =
      enabledDerivedKeys.has(requiredKey) ||
      existingMappings.some(m => m.sectionKey === requiredKey && m.isEnabled)
    if (!stillEnabled) {
      issues.push({
        severity: 'error',
        code: 'MISSING_CORE_SECTION',
        message: `The "${requiredKey}" section is not mapped — export requires both title and abstract.`,
        sectionId: requiredKey
      })
    }
  }

  return {
    countryCode,
    countryName: countryNamePlan,
    profile: profilePlan,
    mappings: mappingsPlan,
    prompts: promptsPlan,
    styles: stylesPlan,
    issues
  }
}

// ============================================================================
// Apply
// ============================================================================

export async function applyCountryImport(
  profileData: any,
  actor: { userId: string; email: string },
  options: ImportOptions = {}
): Promise<ImportResult> {
  const plan = await planCountryImport(profileData, options)

  const errors = plan.issues.filter(i => i.severity === 'error')
  if (errors.length > 0) {
    const err = new Error(
      `Country import blocked by ${errors.length} error(s): ${errors.map(e => e.code).join(', ')}`
    ) as Error & { plan?: ImportPlan }
    err.plan = plan
    throw err
  }

  const countryCode = plan.countryCode
  const index = await buildSupersetIndex()
  const derived = deriveCountryMappings(profileData, index, { skipSections: options.skipSections })
  const applyStructureKeyMap = new Map(derived.mappings.map(m => [m.structureId, m.sectionKey]))
  const derivedPrompts = derivePrompts(profileData, index, applyStructureKeyMap)

  // Pre-read state needed inside the tx (keep reads outside where possible)
  const existingMappings = await prisma.countrySectionMapping.findMany({ where: { countryCode } })
  const existingBySectionKey = new Map(existingMappings.map(m => [m.sectionKey, m]))
  const existingPrompts = await prisma.countrySectionPrompt.findMany({ where: { countryCode, status: 'ACTIVE' } })
  const existingPromptByKey = new Map(existingPrompts.map(p => [p.sectionKey, p]))
  const derivedKeys = new Set(derived.mappings.map(m => m.sectionKey))

  let styleCounts: StyleImportCounts = {
    diagramConfig: 0, diagramHints: 0, exportConfigs: 0, exportHeadings: 0, sectionValidations: 0, crossValidations: 0
  }

  await prisma.$transaction(
    async (tx) => {
      // 1. CountryProfile
      await tx.countryProfile.upsert({
        where: { countryCode },
        create: {
          countryCode,
          name: plan.countryName.name,
          profileData,
          version: 1,
          status: options.activate ? 'ACTIVE' : 'DRAFT',
          createdBy: actor.userId,
          updatedBy: actor.userId
        },
        update: {
          name: plan.countryName.name,
          profileData,
          version: plan.profile.toVersion,
          ...(options.activate ? { status: 'ACTIVE' as const } : {}),
          updatedBy: actor.userId
        }
      })

      // 2. CountryName
      await tx.countryName.upsert({
        where: { code: countryCode },
        create: { code: countryCode, name: plan.countryName.name, continent: plan.countryName.continent },
        update: { name: plan.countryName.name, continent: plan.countryName.continent }
      })

      // 3. CountrySectionMapping — create/update, never delete
      for (const mapping of derived.mappings) {
        const existing = existingBySectionKey.get(mapping.sectionKey)
        if (!existing) {
          await tx.countrySectionMapping.create({
            data: {
              countryCode,
              sectionKey: mapping.sectionKey,
              supersetCode: mapping.supersetCode,
              heading: mapping.heading,
              displayOrder: mapping.displayOrder,
              isRequired: mapping.isRequired,
              isEnabled: true
            }
          })
        } else {
          const data: Prisma.CountrySectionMappingUpdateInput = {
            supersetCode: mapping.supersetCode,
            heading: mapping.heading,
            displayOrder: mapping.displayOrder,
            isRequired: mapping.isRequired
          }
          if (options.resetAdminState) {
            data.isEnabled = true
            data.requiresPriorArtOverride = null
            data.requiresFiguresOverride = null
            data.requiresClaimsOverride = null
            data.requiresComponentsOverride = null
          }
          await tx.countrySectionMapping.update({ where: { id: existing.id }, data })
        }
      }
      if (options.disableExtras) {
        for (const existing of existingMappings) {
          if (!derivedKeys.has(existing.sectionKey) && existing.isEnabled) {
            await tx.countrySectionMapping.update({
              where: { id: existing.id },
              data: { isEnabled: false }
            })
          }
        }
      }

      // 4. CountrySectionPrompt top-ups (+ history), version bump only on change
      for (const prompt of derivedPrompts.prompts) {
        const existing = existingPromptByKey.get(prompt.sectionKey)
        if (!existing) {
          const created = await tx.countrySectionPrompt.create({
            data: {
              countryCode,
              sectionKey: prompt.sectionKey,
              instruction: prompt.instruction,
              constraints: prompt.constraints,
              additions: prompt.additions,
              importFiguresDirectly: prompt.importFiguresDirectly,
              version: 1,
              status: 'ACTIVE',
              createdBy: actor.userId
            }
          })
          await tx.countrySectionPromptHistory.create({
            data: {
              promptId: created.id,
              countryCode,
              sectionKey: prompt.sectionKey,
              instruction: prompt.instruction,
              constraints: prompt.constraints,
              additions: prompt.additions,
              version: 1,
              changeType: 'CREATE',
              changeReason: 'country_profile.json import',
              changedBy: actor.userId
            }
          })
        } else {
          const changed =
            existing.instruction !== prompt.instruction ||
            !deepEqualJson(existing.constraints ?? [], prompt.constraints) ||
            !deepEqualJson(existing.additions ?? [], prompt.additions)
          if (!changed) continue

          const newVersion = existing.version + 1
          await tx.countrySectionPrompt.update({
            where: { id: existing.id },
            data: {
              instruction: prompt.instruction,
              constraints: prompt.constraints,
              additions: prompt.additions,
              version: newVersion,
              updatedBy: actor.userId
            }
          })
          await tx.countrySectionPromptHistory.create({
            data: {
              promptId: existing.id,
              countryCode,
              sectionKey: prompt.sectionKey,
              instruction: prompt.instruction,
              constraints: prompt.constraints,
              additions: prompt.additions,
              version: newVersion,
              changeType: 'UPDATE',
              changeReason: 'country_profile.json re-import',
              changedBy: actor.userId
            }
          })
        }
      }

      // 5. Style tables
      const structureKeyMap = new Map(derived.mappings.map(m => [m.structureId, m.sectionKey]))
      styleCounts = await importCountryStyles(tx, {
        countryCode,
        profileData,
        actorUserId: actor.userId,
        resolveSectionKey: (rawKey) => structureKeyMap.get(rawKey) ?? resolveToSectionKey(index, rawKey)
      })
    },
    { maxWait: 10_000, timeout: 60_000 }
  )

  // Invalidate every cache that reads country/section configuration
  invalidateCountryProfileCache()
  invalidateSectionPromptCache()
  invalidateSupersetSectionsCache()
  invalidateAliasCache()

  const summary: Record<string, number> = {
    mappingsCreated: plan.mappings.create.length,
    mappingsUpdated: plan.mappings.update.length,
    mappingsUnchanged: plan.mappings.unchanged.length,
    mappingsExtra: plan.mappings.extra.length,
    promptsCreated: plan.prompts.create.length,
    promptsUpdated: plan.prompts.update.length,
    promptsUnchanged: plan.prompts.unchanged.length,
    diagramConfigs: styleCounts.diagramConfig,
    diagramHints: styleCounts.diagramHints,
    exportConfigs: styleCounts.exportConfigs,
    exportHeadings: styleCounts.exportHeadings,
    sectionValidations: styleCounts.sectionValidations,
    crossValidations: styleCounts.crossValidations
  }

  return { plan, summary, styleCounts }
}
