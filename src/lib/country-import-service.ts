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
 * Suggest the canonical superset key nearest to a candidate identifier,
 * searching canonical keys AND aliases (aliases often differ by one edit).
 */
function nearestKey(candidate: string, aliasMap: Map<string, string>): string | undefined {
  const normalized = normalizeKey(candidate)
  let best: string | undefined
  let bestDist = Infinity
  aliasMap.forEach((canonical, key) => {
    const dist = levenshtein(normalized, normalizeKey(key))
    if (dist < bestDist) {
      bestDist = dist
      best = canonical
    }
  })
  // Only suggest when reasonably close
  return bestDist <= Math.max(3, Math.floor(normalized.length / 3)) ? best : undefined
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

  for (const section of sections) {
    aliasMap.set(section.sectionKey, section.sectionKey)
    aliasMap.set(normalizeKey(section.sectionKey), section.sectionKey)
    for (const alias of section.aliases) {
      aliasMap.set(alias, section.sectionKey)
      aliasMap.set(normalizeKey(alias), section.sectionKey)
    }
    byKey.set(section.sectionKey, {
      sectionKey: section.sectionKey,
      label: section.label,
      displayOrder: section.displayOrder,
      instruction: section.instruction
    })
  }

  return { aliasMap, byKey }
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
 * alias, or prompt key) to a canonical SupersetSection.sectionKey.
 * Membership in the index is the test — no passthrough of unknown keys.
 */
function resolveToSectionKey(index: SupersetIndex, rawKey: string): string | null {
  const raw = (rawKey || '').trim()
  if (!raw) return null

  const direct = index.aliasMap.get(raw) ?? index.aliasMap.get(normalizeKey(raw))
  if (direct) return direct

  const viaPromptKey =
    PROMPT_KEY_TO_SECTION_KEY[raw.toLowerCase()] ?? PROMPT_KEY_TO_SECTION_KEY[normalizeKey(raw)]
  if (viaPromptKey && index.byKey.has(viaPromptKey)) return viaPromptKey

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

export function deriveCountryMappings(
  profileData: any,
  index: SupersetIndex
): { mappings: DerivedMapping[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = []
  const mappings: DerivedMapping[] = []
  const countryCode = String(profileData?.meta?.code || '').toUpperCase()

  const { variant, issue } = getDefaultVariant(profileData)
  if (issue) return { mappings, issues: [issue] }

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
      issues.push({
        severity: 'warning',
        code: 'UNRESOLVED_SECTION',
        message: `Section "${section.id}" (${section.label}) could not be resolved to a superset section — it will be skipped. Add one of its keys as an alias to an existing superset section, or create a new superset section.`,
        sectionId: section.id,
        candidates,
        suggestion: nearestKey(candidates[0] || section.id, index.aliasMap)
      })
      continue
    }

    if (seenSectionKeys.has(sectionKey)) {
      issues.push({
        severity: 'warning',
        code: 'DUPLICATE_CANONICAL_KEY',
        message: `Section "${section.id}" resolves to superset key "${sectionKey}" which is already mapped by an earlier section — keeping the first, skipping this one.`,
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
        suggestion: nearestKey(rawKey, index.aliasMap)
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
  const derived = deriveCountryMappings(profileData, index)
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
          sectionId: rawKey
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
  const derived = deriveCountryMappings(profileData, index)
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
