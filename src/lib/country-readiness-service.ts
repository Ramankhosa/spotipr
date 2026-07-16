/**
 * Country Readiness Service
 *
 * Computes whether a country is actually draftable — mirroring the exact
 * throw-points in the drafting pipeline — plus non-blocking coverage warnings.
 *
 * Blocking checks (any 'fail' means drafting/export would throw):
 *   1. CountryProfile exists and its meta.code matches
 *   2. At least one enabled mapping with an applicable heading
 *   3. title + abstract mapped and enabled (export hard-requires them)
 *   4. Every enabled mapping's sectionKey exists in an active SupersetSection
 *   5. Every enabled section has a base instruction or an ACTIVE top-up prompt
 *
 * Warnings: missing CountryName / export config / diagram config / validations,
 * duplicate displayOrder, prompts without mappings, unknown language mapping.
 */

import { prisma } from './prisma'
import { isNonApplicableHeading, hasJurisdictionLanguage } from './multi-jurisdiction-service'

export interface ReadinessCheck {
  id: string
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail?: string
}

export interface CountryReadiness {
  countryCode: string
  ready: boolean
  profileStatus: string | null
  checks: ReadinessCheck[]
}

interface ReadinessData {
  profile: { countryCode: string; status: string; profileData: any } | null
  mappings: Array<{ sectionKey: string; heading: string; isEnabled: boolean; displayOrder: number | null }>
  supersetByKey: Map<string, { instruction: string }>
  activePromptKeys: Set<string>
  hasCountryName: boolean
  hasExportConfig: boolean
  hasDiagramConfig: boolean
  validationCount: number
}

async function loadReadinessData(countryCode: string): Promise<ReadinessData> {
  const [profile, mappings, supersetSections, prompts, countryName, exportConfig, diagramConfig, validationCount] =
    await Promise.all([
      prisma.countryProfile.findUnique({
        where: { countryCode },
        select: { countryCode: true, status: true, profileData: true }
      }),
      prisma.countrySectionMapping.findMany({
        where: { countryCode },
        select: { sectionKey: true, heading: true, isEnabled: true, displayOrder: true }
      }),
      prisma.supersetSection.findMany({
        where: { isActive: true },
        select: { sectionKey: true, instruction: true }
      }),
      prisma.countrySectionPrompt.findMany({
        where: { countryCode, status: 'ACTIVE' },
        select: { sectionKey: true }
      }),
      prisma.countryName.findUnique({ where: { code: countryCode }, select: { code: true } }),
      prisma.countryExportConfig.findFirst({ where: { countryCode }, select: { id: true } }),
      prisma.countryDiagramConfig.findUnique({ where: { countryCode }, select: { id: true } }),
      prisma.countrySectionValidation.count({ where: { countryCode } })
    ])

  return {
    profile: profile as ReadinessData['profile'],
    mappings,
    supersetByKey: new Map(supersetSections.map(s => [s.sectionKey, { instruction: s.instruction }])),
    activePromptKeys: new Set(prompts.map(p => p.sectionKey)),
    hasCountryName: Boolean(countryName),
    hasExportConfig: Boolean(exportConfig),
    hasDiagramConfig: Boolean(diagramConfig),
    validationCount
  }
}

function computeChecks(countryCode: string, data: ReadinessData): CountryReadiness {
  const checks: ReadinessCheck[] = []

  // 1. Profile exists + meta.code matches
  if (!data.profile) {
    checks.push({ id: 'profile', label: 'Country profile exists', status: 'fail', detail: 'No CountryProfile row found' })
  } else {
    const metaCode = String((data.profile.profileData as any)?.meta?.code || '').toUpperCase()
    if (metaCode && metaCode !== countryCode) {
      checks.push({ id: 'profile', label: 'Country profile exists', status: 'fail', detail: `profileData.meta.code "${metaCode}" does not match countryCode "${countryCode}"` })
    } else {
      checks.push({ id: 'profile', label: 'Country profile exists', status: 'pass' })
    }
  }

  const enabledMappings = data.mappings.filter(m => m.isEnabled && !isNonApplicableHeading(m.heading))

  // 2. Enabled mappings exist
  checks.push(
    enabledMappings.length > 0
      ? { id: 'mappings', label: 'Section mappings configured', status: 'pass', detail: `${enabledMappings.length} enabled sections` }
      : { id: 'mappings', label: 'Section mappings configured', status: 'fail', detail: 'No enabled section mappings — drafting resolvers will throw' }
  )

  // 3. title + abstract enabled
  const enabledKeys = new Set(enabledMappings.map(m => m.sectionKey))
  const missingCore = ['title', 'abstract'].filter(key => !enabledKeys.has(key))
  checks.push(
    missingCore.length === 0
      ? { id: 'core-sections', label: 'Title and abstract enabled', status: 'pass' }
      : { id: 'core-sections', label: 'Title and abstract enabled', status: 'fail', detail: `Missing: ${missingCore.join(', ')} — export requires both` }
  )

  // 4. Every enabled sectionKey exists in an active SupersetSection
  const unknownKeys = enabledMappings.filter(m => !data.supersetByKey.has(m.sectionKey)).map(m => m.sectionKey)
  checks.push(
    unknownKeys.length === 0
      ? { id: 'superset-keys', label: 'All sections exist in the superset catalog', status: 'pass' }
      : { id: 'superset-keys', label: 'All sections exist in the superset catalog', status: 'fail', detail: `Unknown or inactive superset keys: ${unknownKeys.join(', ')}` }
  )

  // 5. Every enabled section has a base instruction or an ACTIVE top-up prompt
  const promptless = enabledMappings.filter(m => {
    const base = data.supersetByKey.get(m.sectionKey)
    const hasBase = Boolean(base?.instruction?.trim())
    return !hasBase && !data.activePromptKeys.has(m.sectionKey)
  }).map(m => m.sectionKey)
  checks.push(
    promptless.length === 0
      ? { id: 'prompts', label: 'Every section has a drafting prompt', status: 'pass' }
      : { id: 'prompts', label: 'Every section has a drafting prompt', status: 'fail', detail: `No base or top-up prompt for: ${promptless.join(', ')}` }
  )

  // --- Warnings ---
  checks.push(
    data.hasCountryName
      ? { id: 'country-name', label: 'Country display name registered', status: 'pass' }
      : { id: 'country-name', label: 'Country display name registered', status: 'warn', detail: 'No CountryName row — the UI will fall back to the profile name' }
  )
  checks.push(
    data.hasExportConfig
      ? { id: 'export-config', label: 'Export configuration', status: 'pass' }
      : { id: 'export-config', label: 'Export configuration', status: 'warn', detail: 'No CountryExportConfig — export falls back to profile JSON / defaults' }
  )
  checks.push(
    data.hasDiagramConfig
      ? { id: 'diagram-config', label: 'Diagram configuration', status: 'pass' }
      : { id: 'diagram-config', label: 'Diagram configuration', status: 'warn', detail: 'No CountryDiagramConfig — diagram generation uses defaults' }
  )
  checks.push(
    data.validationCount > 0
      ? { id: 'validations', label: 'Section validation limits', status: 'pass', detail: `${data.validationCount} rules` }
      : { id: 'validations', label: 'Section validation limits', status: 'warn', detail: 'No validation rules — word/claim limits will not be checked' }
  )

  const orderCounts = new Map<number, string[]>()
  for (const m of enabledMappings) {
    if (m.displayOrder === null) continue
    const list = orderCounts.get(m.displayOrder) ?? []
    list.push(m.sectionKey)
    orderCounts.set(m.displayOrder, list)
  }
  const duplicateOrders = Array.from(orderCounts.entries()).filter(([, keys]) => keys.length > 1)
  checks.push(
    duplicateOrders.length === 0
      ? { id: 'display-order', label: 'Section sequence is unambiguous', status: 'pass' }
      : { id: 'display-order', label: 'Section sequence is unambiguous', status: 'warn', detail: duplicateOrders.map(([order, keys]) => `order ${order}: ${keys.join(', ')}`).join('; ') }
  )

  const orphanPrompts = Array.from(data.activePromptKeys).filter(key => !data.mappings.some(m => m.sectionKey === key))
  if (orphanPrompts.length > 0) {
    checks.push({ id: 'orphan-prompts', label: 'Prompts match mapped sections', status: 'warn', detail: `Prompts without mappings: ${orphanPrompts.join(', ')}` })
  }

  if (!hasJurisdictionLanguage(countryCode)) {
    checks.push({ id: 'language', label: 'Language mapping', status: 'warn', detail: 'No explicit language mapping — figure/translation language falls back to English or the profile languages' })
  }

  return {
    countryCode,
    ready: checks.every(c => c.status !== 'fail'),
    profileStatus: data.profile?.status ?? null,
    checks
  }
}

export async function computeCountryReadiness(countryCode: string): Promise<CountryReadiness> {
  const code = countryCode.toUpperCase()
  const data = await loadReadinessData(code)
  return computeChecks(code, data)
}

/**
 * Batched readiness for the admin list view — avoids N+1 queries.
 */
export async function computeAllCountriesReadiness(): Promise<CountryReadiness[]> {
  const [profiles, allMappings, supersetSections, allPrompts, countryNames, exportConfigs, diagramConfigs, validations] =
    await Promise.all([
      prisma.countryProfile.findMany({ select: { countryCode: true, status: true, profileData: true } }),
      prisma.countrySectionMapping.findMany({ select: { countryCode: true, sectionKey: true, heading: true, isEnabled: true, displayOrder: true } }),
      prisma.supersetSection.findMany({ where: { isActive: true }, select: { sectionKey: true, instruction: true } }),
      prisma.countrySectionPrompt.findMany({ where: { status: 'ACTIVE' }, select: { countryCode: true, sectionKey: true } }),
      prisma.countryName.findMany({ select: { code: true } }),
      prisma.countryExportConfig.findMany({ select: { countryCode: true } }),
      prisma.countryDiagramConfig.findMany({ select: { countryCode: true } }),
      prisma.countrySectionValidation.groupBy({ by: ['countryCode'], _count: { _all: true } })
    ])

  const supersetByKey = new Map(supersetSections.map(s => [s.sectionKey, { instruction: s.instruction }]))
  const nameSet = new Set(countryNames.map(n => n.code))
  const exportSet = new Set(exportConfigs.map(e => e.countryCode))
  const diagramSet = new Set(diagramConfigs.map(d => d.countryCode))
  const validationCounts = new Map(validations.map(v => [v.countryCode, v._count._all]))

  const mappingsByCountry = new Map<string, ReadinessData['mappings']>()
  for (const m of allMappings) {
    const list = mappingsByCountry.get(m.countryCode) ?? []
    list.push(m)
    mappingsByCountry.set(m.countryCode, list)
  }
  const promptsByCountry = new Map<string, Set<string>>()
  for (const p of allPrompts) {
    const set = promptsByCountry.get(p.countryCode) ?? new Set<string>()
    set.add(p.sectionKey)
    promptsByCountry.set(p.countryCode, set)
  }

  return profiles.map(profile =>
    computeChecks(profile.countryCode, {
      profile: profile as ReadinessData['profile'],
      mappings: mappingsByCountry.get(profile.countryCode) ?? [],
      supersetByKey,
      activePromptKeys: promptsByCountry.get(profile.countryCode) ?? new Set(),
      hasCountryName: nameSet.has(profile.countryCode),
      hasExportConfig: exportSet.has(profile.countryCode),
      hasDiagramConfig: diagramSet.has(profile.countryCode),
      validationCount: validationCounts.get(profile.countryCode) ?? 0
    })
  )
}
