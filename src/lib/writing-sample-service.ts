/**
 * Writing Sample Service
 * 
 * Fetches user's writing samples for example-based style mimicry.
 * 
 * Supports:
 * - Persona-based samples (CSE Patents, Bio Patents, etc.)
 * - Primary + Secondary personas for multidisciplinary patents
 * - Organization-shared personas
 * - Jurisdiction-specific > universal priority
 */

import { prisma } from './prisma'

// Cache for writing samples (5 minute TTL)
const sampleCache = new Map<string, { samples: Map<string, string>, timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export interface WritingSampleContext {
  sampleText: string
  jurisdiction: string
  isUniversal: boolean
  personaName?: string
  personaId?: string
  sampleId?: string
  sectionKey?: string
  source?: 'persona' | 'personal' | 'personal_fallback'
}

export interface PersonaSelection {
  primaryPersonaId?: string    // Main style - structure and tone
  primaryPersonaName?: string
  secondaryPersonaIds?: string[] // Additional styles - domain terminology
  secondaryPersonaNames?: string[]
}

export interface ResolvedPersonaSelection {
  primaryPersonaId?: string
  primaryPersonaName?: string
  secondaryPersonaIds: string[]
  secondaryPersonaNames: string[]
}

export interface PersonaCoverageWarning {
  sectionKey: string
  jurisdiction: string
  primaryPersonaId: string
  primaryPersonaName?: string
  fallback: 'personal_sample' | 'none'
  message: string
}

export class PersonaAccessError extends Error {
  status = 403
  code = 'PERSONA_ACCESS_DENIED'

  constructor(message = 'Persona not found or access denied') {
    super(message)
    this.name = 'PersonaAccessError'
  }
}

function uniqueIds(ids: Array<string | undefined | null>): string[] {
  return Array.from(new Set(
    ids
      .map(id => typeof id === 'string' ? id.trim() : '')
      .filter(Boolean)
  ))
}

export function normalizePersonaSelectionInput(selection?: PersonaSelection | null): PersonaSelection | undefined {
  if (!selection) return undefined
  const primaryPersonaId = typeof selection.primaryPersonaId === 'string'
    ? selection.primaryPersonaId.trim()
    : undefined
  const secondaryPersonaIds = uniqueIds(selection.secondaryPersonaIds || [])
    .filter(id => id !== primaryPersonaId)

  if (!primaryPersonaId && secondaryPersonaIds.length === 0) return undefined

  return {
    primaryPersonaId: primaryPersonaId || undefined,
    primaryPersonaName: selection.primaryPersonaName,
    secondaryPersonaIds,
    secondaryPersonaNames: Array.isArray(selection.secondaryPersonaNames) ? selection.secondaryPersonaNames : []
  }
}

export function getPersonaSelectionFromSession(session: any): PersonaSelection | undefined {
  const primaryPersonaId = typeof session?.primaryPersonaId === 'string' ? session.primaryPersonaId : undefined
  const secondaryPersonaIds = Array.isArray(session?.secondaryPersonaIds) ? session.secondaryPersonaIds : []
  return normalizePersonaSelectionInput({ primaryPersonaId, secondaryPersonaIds })
}

export async function validatePersonaSelectionForUser(
  userId: string,
  tenantId: string | null | undefined,
  selection?: PersonaSelection | null
): Promise<ResolvedPersonaSelection | undefined> {
  const normalized = normalizePersonaSelectionInput(selection)
  if (!normalized?.primaryPersonaId) return undefined

  const ids = uniqueIds([normalized.primaryPersonaId, ...(normalized.secondaryPersonaIds || [])])
  const accessConditions: any[] = [{ createdBy: userId }]
  if (tenantId) {
    accessConditions.push({ tenantId, visibility: 'ORGANIZATION' })
  }

  const personas = await prisma.writingPersona.findMany({
    where: {
      id: { in: ids },
      isActive: true,
      OR: accessConditions
    },
    select: { id: true, name: true }
  })

  const byId = new Map(personas.map(p => [p.id, p]))
  const missing = ids.filter(id => !byId.has(id))
  if (missing.length > 0) {
    throw new PersonaAccessError()
  }

  return {
    primaryPersonaId: normalized.primaryPersonaId,
    primaryPersonaName: byId.get(normalized.primaryPersonaId)?.name,
    secondaryPersonaIds: (normalized.secondaryPersonaIds || []).filter(id => id !== normalized.primaryPersonaId),
    secondaryPersonaNames: (normalized.secondaryPersonaIds || [])
      .filter(id => id !== normalized.primaryPersonaId)
      .map(id => byId.get(id)?.name)
      .filter(Boolean) as string[]
  }
}

export async function hydratePersonaSelectionForUser(
  userId: string,
  tenantId: string | null | undefined,
  selection?: PersonaSelection | null
): Promise<ResolvedPersonaSelection | undefined> {
  return validatePersonaSelectionForUser(userId, tenantId, selection)
}

async function findPrimaryPersonaSample(personaId: string, sectionKey: string, jurisdiction: string) {
  const samples = await prisma.writingSample.findMany({
    where: {
      personaId,
      sectionKey,
      jurisdiction: { in: [jurisdiction, '*'] },
      isActive: true
    },
    include: { persona: { select: { name: true, createdBy: true } } }
  })

  return samples.find(s => s.jurisdiction === jurisdiction) || samples.find(s => s.jurisdiction === '*') || null
}

async function findDirectUserSample(userId: string, sectionKey: string, jurisdiction: string) {
  const samples = await prisma.writingSample.findMany({
    where: {
      userId,
      sectionKey,
      personaId: null,
      jurisdiction: { in: [jurisdiction, '*'] },
      isActive: true
    },
    include: { persona: { select: { name: true } } }
  })

  return samples.find(s => s.jurisdiction === jurisdiction) || samples.find(s => s.jurisdiction === '*') || null
}

export async function getPersonaCoverageWarnings(
  userId: string,
  tenantId: string | null | undefined,
  sectionKeys: string[],
  jurisdiction: string,
  selection?: PersonaSelection | null
): Promise<PersonaCoverageWarning[]> {
  const resolved = await validatePersonaSelectionForUser(userId, tenantId, selection)
  if (!resolved?.primaryPersonaId) return []

  const normalizedJurisdiction = jurisdiction.toUpperCase()
  const uniqueSections = uniqueIds(sectionKeys)
  const warnings: PersonaCoverageWarning[] = []

  for (const sectionKey of uniqueSections) {
    const personaSample = await findPrimaryPersonaSample(resolved.primaryPersonaId, sectionKey, normalizedJurisdiction)
    if (personaSample) continue

    const fallbackSample = await findDirectUserSample(userId, sectionKey, normalizedJurisdiction)
    warnings.push({
      sectionKey,
      jurisdiction: normalizedJurisdiction,
      primaryPersonaId: resolved.primaryPersonaId,
      primaryPersonaName: resolved.primaryPersonaName,
      fallback: fallbackSample ? 'personal_sample' : 'none',
      message: fallbackSample
        ? `Selected persona has no "${sectionKey}" sample for ${normalizedJurisdiction}; personal non-persona sample will be used if you continue.`
        : `Selected persona has no "${sectionKey}" sample for ${normalizedJurisdiction}; this section will be generated without persona style if you continue.`
    })
  }

  return warnings
}

/**
 * Get writing sample for a specific section with persona support
 * 
 * Priority:
 * 1. Primary persona + jurisdiction-specific
 * 2. Primary persona + universal
 * 3. Any persona + jurisdiction-specific (backward compat)
 * 4. Any persona + universal (backward compat)
 * 
 * @param userId - User ID
 * @param sectionKey - Canonical section key (e.g., "claims", "detailedDescription")
 * @param jurisdiction - Target jurisdiction (e.g., "IN", "US")
 * @param personaSelection - Optional persona selection (primary + secondary)
 * @returns WritingSampleContext or null if no sample found
 */
export async function getWritingSample(
  userId: string,
  sectionKey: string,
  jurisdiction: string,
  personaSelection?: PersonaSelection,
  tenantId?: string | null
): Promise<WritingSampleContext | null> {
  const normalizedJurisdiction = jurisdiction.toUpperCase()
  
  // If persona selection provided, use persona-aware fetching
  if (personaSelection?.primaryPersonaId) {
    return getWritingSampleWithPersona(userId, sectionKey, normalizedJurisdiction, personaSelection, tenantId)
  }

  const cacheKey = `${userId}:${normalizedJurisdiction}`
  
  // Check cache (only for non-persona requests)
  const cached = sampleCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    // Try jurisdiction-specific first
    const jurisdictionSample = cached.samples.get(`${sectionKey}:${normalizedJurisdiction}`)
    if (jurisdictionSample) {
      return {
        sampleText: jurisdictionSample,
        jurisdiction: normalizedJurisdiction,
        isUniversal: false,
        sectionKey,
        source: 'personal'
      }
    }
    // Fall back to universal
    const universalSample = cached.samples.get(`${sectionKey}:*`)
    if (universalSample) {
      return {
        sampleText: universalSample,
        jurisdiction: '*',
        isUniversal: true,
        sectionKey,
        source: 'personal'
      }
    }
    return null
  }

  // Load from database
  try {
    // Try jurisdiction-specific first
    let sample = await prisma.writingSample.findFirst({
      where: {
        userId,
        sectionKey,
        jurisdiction: normalizedJurisdiction,
        personaId: null,
        isActive: true
      },
      include: { persona: { select: { name: true } } }
    })

    if (sample) {
      return {
        sampleText: sample.sampleText,
        jurisdiction: normalizedJurisdiction,
        isUniversal: false,
        personaName: sample.persona?.name || sample.personaName,
        personaId: sample.personaId || undefined,
        sampleId: sample.id,
        sectionKey,
        source: 'personal'
      }
    }

    // Fall back to universal
    sample = await prisma.writingSample.findFirst({
      where: {
        userId,
        sectionKey,
        jurisdiction: '*',
        personaId: null,
        isActive: true
      },
      include: { persona: { select: { name: true } } }
    })

    if (sample) {
      return {
        sampleText: sample.sampleText,
        jurisdiction: '*',
        isUniversal: true,
        personaName: sample.persona?.name || sample.personaName,
        personaId: sample.personaId || undefined,
        sampleId: sample.id,
        sectionKey,
        source: 'personal'
      }
    }
  } catch (error) {
    console.warn(`[WritingSampleService] Failed to get sample for ${userId}/${sectionKey}/${jurisdiction}:`, error)
  }

  return null
}

/**
 * Get writing sample with persona selection support
 * Supports Primary + Secondary personas for multidisciplinary patents
 */
async function getWritingSampleWithPersona(
  userId: string,
  sectionKey: string,
  jurisdiction: string,
  personaSelection: PersonaSelection,
  tenantId?: string | null
): Promise<WritingSampleContext | null> {
  try {
    const resolved = await validatePersonaSelectionForUser(userId, tenantId, personaSelection)
    if (!resolved?.primaryPersonaId) return null
    const { primaryPersonaId, secondaryPersonaIds = [] } = resolved

    // Get primary persona sample (for structure and tone)
    let primarySample = await findPrimaryPersonaSample(primaryPersonaId, sectionKey, jurisdiction)

    // If no persona sample found, fall back to user's own samples (without persona linkage)
    // This provides a graceful degradation when personas don't have all sections populated
    if (!primarySample) {
      const userSample = await findDirectUserSample(userId, sectionKey, jurisdiction)

      if (userSample) {
        console.log(`[WritingSampleService] Persona sample not found for ${sectionKey}, falling back to user's own sample`)
        return {
          sampleText: userSample.sampleText,
          jurisdiction: userSample.jurisdiction,
          isUniversal: userSample.jurisdiction === '*',
          personaName: 'Personal Style (fallback)',
          personaId: undefined,
          sampleId: userSample.id,
          sectionKey,
          source: 'personal_fallback'
        }
      }

      return null
    }

    // Get secondary persona samples (for domain terminology)
    const secondarySamples: string[] = []
    
    if (secondaryPersonaIds.length > 0) {
      const secondaries = await prisma.writingSample.findMany({
        where: {
          personaId: { in: secondaryPersonaIds },
          sectionKey,
          jurisdiction: { in: [jurisdiction, '*'] },
          isActive: true
        },
        include: { persona: { select: { name: true } } }
      })

      // Group by persona and take jurisdiction-specific over universal
      const byPersona = new Map<string, typeof secondaries[0]>()
      for (const s of secondaries) {
        const existing = byPersona.get(s.personaId!)
        if (!existing || (s.jurisdiction !== '*' && existing.jurisdiction === '*')) {
          byPersona.set(s.personaId!, s)
        }
      }

      for (const s of Array.from(byPersona.values())) {
        secondarySamples.push(`[Additional style]: ${s.sampleText}`)
      }
    }

    // Build combined sample text
    let combinedText = primarySample.sampleText
    if (secondarySamples.length > 0) {
      combinedText += '\n\n--- ADDITIONAL DOMAIN STYLES ---\n' + secondarySamples.join('\n\n')
    }

    return {
      sampleText: combinedText,
      jurisdiction: primarySample.jurisdiction,
      isUniversal: primarySample.jurisdiction === '*',
      personaName: primarySample.persona?.name || primarySample.personaName,
      personaId: primarySample.personaId || undefined,
      sampleId: primarySample.id,
      sectionKey,
      source: 'persona'
    }

  } catch (error) {
    if (error instanceof PersonaAccessError) throw error
    console.warn('[WritingSampleService] Failed to get persona sample:', error)
    return null
  }
}

/**
 * Get all active writing samples for a user
 * Used for caching and bulk operations
 */
export async function getAllWritingSamples(
  userId: string,
  jurisdiction?: string
): Promise<Map<string, WritingSampleContext>> {
  const result = new Map<string, WritingSampleContext>()

  try {
    const where: any = {
      userId,
      personaId: null,
      isActive: true
    }

    if (jurisdiction) {
      // Get both jurisdiction-specific and universal
      where.jurisdiction = { in: [jurisdiction.toUpperCase(), '*'] }
    }

    const samples = await prisma.writingSample.findMany({
      where,
      orderBy: { jurisdiction: 'desc' } // Universal (*) comes after specific jurisdictions
    })

    // Build map with jurisdiction-specific taking priority over universal
    for (const sample of samples) {
      const key = sample.sectionKey
      // Only add if not already present (jurisdiction-specific added first due to ordering)
      if (!result.has(key) || sample.jurisdiction !== '*') {
        result.set(key, {
          sampleText: sample.sampleText,
          jurisdiction: sample.jurisdiction,
          isUniversal: sample.jurisdiction === '*'
        })
      }
    }

    // Update cache
    const normalizedJurisdiction = jurisdiction?.toUpperCase() || 'ALL'
    const cacheKey = `${userId}:${normalizedJurisdiction}`
    const sampleMap = new Map<string, string>()
    for (const sample of samples) {
      sampleMap.set(`${sample.sectionKey}:${sample.jurisdiction}`, sample.sampleText)
    }
    sampleCache.set(cacheKey, { samples: sampleMap, timestamp: Date.now() })
  } catch (error) {
    console.error('[WritingSampleService] Failed to get all samples:', error)
  }

  return result
}

/**
 * Invalidate cache for a user
 */
export function invalidateWritingSampleCache(userId: string): void {
  // Remove all cache entries for this user
  for (const key of Array.from(sampleCache.keys())) {
    if (key.startsWith(`${userId}:`)) {
      sampleCache.delete(key)
    }
  }
}

/**
 * Build the prompt block for writing sample injection
 * 
 * This creates a strong few-shot prompt that instructs the LLM to mimic the user's style
 * Supports multi-persona with primary (structure) + secondary (terminology)
 */
export function buildWritingSampleBlock(
  sample: WritingSampleContext,
  sectionKey: string
): string {
  if (!sample || !sample.sampleText) return ''

  const jurisdictionNote = sample.isUniversal 
    ? '(universal style, applies to all jurisdictions)'
    : `(${sample.jurisdiction}-specific style)`

  // Check if this is a multi-persona sample (contains secondary styles)
  const hasSecondaryStyles = sample.sampleText.includes('--- ADDITIONAL DOMAIN STYLES ---')

  const styleExplanation = hasSecondaryStyles
    ? `The user has selected a PRIMARY style for structure and tone, plus ADDITIONAL domain styles for terminology.
You MUST:
• Follow the PRIMARY style for overall structure, sentence patterns, and voice
• Incorporate terminology and domain-specific phrases from the ADDITIONAL styles`
    : `The user has provided an example of their preferred writing style for this section.
You MUST closely mimic their style, including:

• **Word choices and phrasing patterns** - Use similar vocabulary and expressions
• **Sentence length and structure** - Match their complexity level
• **Active/passive voice preference** - Mirror their voice usage
• **Technical terminology style** - Follow their terminology patterns
• **Punctuation and connectors** - Use similar punctuation and transition words
• **Opening patterns** - Start sections/paragraphs similarly`

  const styleOnlyBoundary = `STYLE-ONLY BOUNDARY:
- Use the sample only to learn drafting style, organization, sentence rhythm, terminology preference, and formatting habits.
- Any instruction to mimic the sample means mimic style only, never sample content.
- Do NOT copy or import the sample's invention substance, embodiments, components, materials, values, claim limitations, advantages, problem statements, examples, or legal conclusions.
- Draft all technical substance only from the current patent's source facts, normalized invention context, and user-provided instructions.
- If the sample content conflicts with source-grounding rules, ignore the sample content and follow the current patent context.`

  // Build visual box without truncating content - preserve full sample for style learning
  const lines = sample.sampleText.split('\n')
  // Don't truncate lines - long lines are important for capturing writing style patterns
  const formattedLines = lines.map(line => `│ ${line}`).join('\n')

  return `

╔═══════════════════════════════════════════════════════════════════════════╗
║  YOUR WRITING STYLE - MIMIC THIS EXACTLY                                  ║
║  ${jurisdictionNote.padEnd(69)}║
╚═══════════════════════════════════════════════════════════════════════════╝

${styleExplanation}

${styleOnlyBoundary}

USER'S STYLE EXAMPLE:
┌─────────────────────────────────────────────────────────────────────────────
${formattedLines}
└─────────────────────────────────────────────────────────────────────────────

⚠️ CRITICAL: Generate content that reads as if written by the SAME AUTHOR as the example above.
   Do NOT reuse sample-specific facts, claim elements, advantages, embodiments, examples, materials, or numeric values.
   Do NOT use generic patent language. Instead, mirror the specific style shown while grounding substance in the current patent.
`
}

/**
 * Get section-specific style guidance based on sample analysis
 * This provides additional hints to the LLM about what to focus on
 */
export function getSectionStyleHints(sectionKey: string): string {
  const hints: Record<string, string> = {
    claims: 'Pay special attention to: preamble style, transition words, element numbering, and claim structure.',
    detailedDescription: 'Pay special attention to: figure references, embodiment introductions, technical detail level, and cross-linking style.',
    abstract: 'Pay special attention to: opening phrase, sentence structure, and how technical terms are introduced.',
    background: 'Pay special attention to: prior art discussion tone, problem statement style, and transition to invention.',
    summary: 'Pay special attention to: how advantages are described and how the invention is characterized.',
    briefDescriptionOfDrawings: 'Pay special attention to: figure caption format and consistency.',
    fieldOfInvention: 'Pay special attention to: technical field phrasing and scope indication.',
    objectsOfInvention: 'Pay special attention to: objective listing style and language patterns.'
  }

  return hints[sectionKey] || ''
}

/**
 * Get samples from an organization-shared persona
 * Used when user selects an org persona they don't own
 */
export async function getOrgPersonaSample(
  personaId: string,
  tenantId: string,
  sectionKey: string,
  jurisdiction: string
): Promise<WritingSampleContext | null> {
  try {
    // Verify persona is org-visible
    const persona = await prisma.writingPersona.findFirst({
      where: {
        id: personaId,
        tenantId,
        visibility: 'ORGANIZATION',
        isActive: true
      }
    })

    if (!persona) {
      return null
    }

    // Get sample
    let sample = await prisma.writingSample.findFirst({
      where: {
        personaId,
        sectionKey,
        jurisdiction: jurisdiction.toUpperCase(),
        isActive: true
      }
    })

    // Fall back to universal
    if (!sample) {
      sample = await prisma.writingSample.findFirst({
        where: {
          personaId,
          sectionKey,
          jurisdiction: '*',
          isActive: true
        }
      })
    }

    if (!sample) {
      return null
    }

    return {
      sampleText: sample.sampleText,
      jurisdiction: sample.jurisdiction,
      isUniversal: sample.jurisdiction === '*',
      personaName: persona.name,
      personaId: persona.id
    }

  } catch (error) {
    console.warn('[WritingSampleService] Failed to get org persona sample:', error)
    return null
  }
}

/**
 * Get all personas available to a user (own + org-shared)
 */
export async function getAvailablePersonas(
  userId: string,
  tenantId: string
): Promise<Array<{
  id: string
  name: string
  description: string | null
  isOwn: boolean
  isTemplate: boolean
  sampleCount: number
}>> {
  try {
    const personas = await prisma.writingPersona.findMany({
      where: {
        OR: [
          { createdBy: userId, isActive: true },
          { tenantId, visibility: 'ORGANIZATION', isActive: true }
        ]
      },
      include: {
        _count: { select: { samples: true } }
      },
      orderBy: [
        { isTemplate: 'desc' },
        { name: 'asc' }
      ]
    })

    return personas.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isOwn: p.createdBy === userId,
      isTemplate: p.isTemplate,
      sampleCount: p._count.samples
    }))

  } catch (error) {
    console.error('[WritingSampleService] Failed to get personas:', error)
    return []
  }
}

/**
 * Check if user has any active writing samples
 */
export async function hasActiveWritingSamples(userId: string): Promise<boolean> {
  try {
    const count = await prisma.writingSample.count({
      where: {
        userId,
        isActive: true
      }
    })
    return count > 0
  } catch (error) {
    console.warn('[WritingSampleService] Failed to check samples:', error)
    return false
  }
}

/**
 * Get sample coverage report for a user
 * Shows which sections have samples for which jurisdictions
 */
export async function getSampleCoverage(userId: string): Promise<{
  sections: string[]
  jurisdictions: string[]
  coverage: Record<string, string[]> // section -> jurisdictions that have samples
}> {
  try {
    const samples = await prisma.writingSample.findMany({
      where: { userId, isActive: true },
      select: { sectionKey: true, jurisdiction: true }
    })

    const coverage: Record<string, string[]> = {}
    const sections = new Set<string>()
    const jurisdictions = new Set<string>()

    for (const sample of samples) {
      sections.add(sample.sectionKey)
      jurisdictions.add(sample.jurisdiction)
      
      if (!coverage[sample.sectionKey]) {
        coverage[sample.sectionKey] = []
      }
      coverage[sample.sectionKey].push(sample.jurisdiction)
    }

    return {
      sections: Array.from(sections),
      jurisdictions: Array.from(jurisdictions),
      coverage
    }
  } catch (error) {
    console.error('[WritingSampleService] Failed to get coverage:', error)
    return { sections: [], jurisdictions: [], coverage: {} }
  }
}

