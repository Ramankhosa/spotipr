import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Allow longer-running LLM operations (related_art_llm_review, draft generation) without platform timeouts
export const maxDuration = 300; // 5 minutes - matches novelty-search stage route
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { DraftingService, deriveNumberingStyle } from '@/lib/drafting-service';
import { MAX_DRAFTING_INPUT_CHARS } from '@/lib/drafting-constants';
import { migrateNormalizedData, type SourceInputMeta } from '@/lib/normalized-data';
import { IdeaBankService } from '@/lib/idea-bank-service';
import { ideaBankFunnel, isIdeaBankGenerationEnabled, type IdeaFunnelInput, type PriorArtAnalysisItem } from '@/lib/idea-bank-funnel';
import { llmGateway } from '@/lib/metering/gateway';
import {
  patentSearchOrchestrator,
  type NormalizedPatentResult,
  type PatentSearchProviderId,
  type PatentRetrievalQuery,
  type PatentSearchFilters,
  type PatentSearchQueryPlan,
  type PatentSearchSourceMode
} from '@/lib/patent-search';
// NOTE: Old document-based style learning (getGatedStyleInstructions) has been removed
// The new Writing Personas system uses writing samples directly in DraftingService
import { getDocumentTypeConfig, getSupportedCountryCodes, getCountryProfile, getDraftingPrompts, getSectionRules, getBaseStyle } from '@/lib/country-profile-service';
import {
  getWritingSample,
  buildWritingSampleBlock,
  getPersonaCoverageWarnings,
  getPersonaSelectionFromSession,
  hydratePersonaSelectionForUser,
  normalizePersonaSelectionInput,
  validatePersonaSelectionForUser,
  PersonaAccessError,
  type PersonaSelection
} from '@/lib/writing-sample-service';
import { resolveCanonicalKey, normalizeSectionKeys } from '@/lib/section-alias-service';
import { enforceServiceAccess } from '@/lib/service-access-middleware';
import { getDiagramConfig, generateDiagramPromptInstructions } from '@/lib/jurisdiction-style-service';
import { trackSectionDrafted, canDraftPatent, canTrackSectionDrafts } from '@/lib/patent-drafting-tracker';
import { resolveSourceOfTruth, computeJurisdictionStateOnDelete } from '@/lib/jurisdiction-state-service';
import { cloneInstructionsBetweenSessions } from '@/lib/user-instruction-service';
import { getSupersetSectionKeys, isNonApplicableHeading, getSectionContextRequirements } from '@/lib/multi-jurisdiction-service';
import { ANNEXURE_LEGACY_COLUMNS } from '@/lib/annexure-schema';
import {
  DraftClaimsParseError,
  formatDraftClaimsAsHtml,
  normalizeDraftClaimType,
  parseGeneratedClaimsPayloadFromLLMOutput,
  stripTrailingClaimDependencyLabel,
  stripTrailingClaimDependencyLabelsFromHtml,
} from '@/lib/draft-claims-parser';
import {
  getAuthoritativeClaims,
  getEditableClaims,
  normalizeClaimsForSession as normalizeClaimsForSessionShared,
} from '@/lib/claims-context';
import {
  analyzePreliminaryClaimQuality,
  buildPreliminaryClaimsPrompt,
  DEFAULT_PRELIMINARY_MAX_CLAIMS,
  normalizePreliminaryClaimScopeStyle,
  resetPreliminaryClaimFields,
  shouldBlockPreliminaryClaimReset,
} from '@/lib/preliminary-claim-generation';
import {
  generateSketch,
  detectExternalImageContent,
  listSketches,
  getSketch,
  deleteSketch,
  toggleSketchFavorite,
  updateSketchMetadata,
  retrySketchGeneration,
  type SketchMode,
  type SketchContextFlags,
  type SketchViewConfig
} from '@/lib/sketch-service';

// Interface for sketch records as stored in session
interface SessionSketchRecord {
  id: string;
  title: string;
  description?: string;
  status: string;
  isDeleted?: boolean;
}
import crypto from 'crypto';
import plantumlEncoder from 'plantuml-encoder';
import path from 'path';
import fs from 'fs/promises';
import { imageSize } from 'image-size';
import { appendFigureToSequence, normalizeFigureSequence } from '@/lib/figure-sequence'
import { buildSourceFactLedgerPromptBlock } from '@/lib/source-fact-ledger'
import {
  buildSupportDataSourcePromptBlock,
  coerceSupportDataSources
} from '@/lib/support-data-sources'
import { ensureDetailedDescriptionSourceSelection } from '@/lib/dd-source-selection-service'
import {
  buildFigureScopePromptBlock,
  coerceScopeRecommendations,
  componentsFromFrozenClaimsAndStage0,
  filterComponentsByScopeForFigures,
  scopeElementKey
} from '@/lib/scope-recommendations'
import {
  areFiguresSkipped,
  filterDrawingSections,
  filterDrawingSectionKeys,
  isDrawingSectionKey
} from '@/lib/figure-availability'
import {
  emptyRepairSummary,
  inferPlantUmlDiagramType,
  mergeRepairSummary,
  processGeneratedPlantUml,
  type PlantUmlValidationError as SharedPlantUmlValidationError,
  type RepairSummary
} from '@/lib/plantuml-diagram-processing'

const sanitizeFigureTitleInput = (title?: string | null): string => {
  const raw = typeof title === 'string' ? title : ''
  if (!raw.trim()) return ''
  const cpcIpcPattern = /\b(?:CPC|IPC)?\s*(?:class\s*)?[A-H][0-9]{1,2}[A-Z]\s*\d+\/\d+\b/gi
  let cleaned = raw.replace(cpcIpcPattern, '')
  cleaned = cleaned.replace(/\b(?:CPC|IPC)\b[:\-]?\s*/gi, '')
  cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1')
  cleaned = cleaned.replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, '')
  return cleaned.trim()
}

const sanitizeStage0TextInput = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\u0000/g, '')
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

const sanitizeStage0TitleInput = (value: unknown): string => {
  return sanitizeStage0TextInput(value).replace(/\s+/g, ' ').trim()
}

const hashStage0Text = (value: string): string =>
  crypto.createHash('sha256').update(value, 'utf8').digest('hex')

const coerceSourceInputMeta = (value: unknown): SourceInputMeta => {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const stringField = (key: string, max = 300) => {
    const raw = record[key]
    return typeof raw === 'string' && raw.trim()
      ? raw.trim().slice(0, max)
      : undefined
  }
  const numberField = (key: string) => {
    const raw = record[key]
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
      ? raw
      : undefined
  }
  return {
    originalFileName: stringField('originalFileName'),
    mimeType: stringField('mimeType', 120),
    fileSize: numberField('fileSize'),
    detectedFormat: stringField('detectedFormat', 40),
    extractedCharCount: numberField('extractedCharCount'),
    extractionHash: stringField('extractionHash', 128),
    extractedAt: stringField('extractedAt', 80),
  }
}

const buildSourceInputMeta = (rawIdea: string, sourceInputMeta: unknown): SourceInputMeta => {
  const submittedHash = hashStage0Text(rawIdea)
  const base = coerceSourceInputMeta(sourceInputMeta)
  return {
    ...base,
    submittedCharCount: rawIdea.length,
    submittedHash,
    submittedAt: new Date().toISOString(),
    ...(base.extractionHash ? { editedAfterExtraction: base.extractionHash !== submittedHash } : {}),
  }
}

// Update figure number in title to match actual assigned figure number
const updateFigureTitleNumber = (title: string, actualFigureNo: number): string => {
  // Replace patterns like "Fig.1", "Fig 1", "Figure 1", etc. with the correct number
  return title
    .replace(/\bFig\.?\s*\d+/gi, `Fig.${actualFigureNo}`)
    .replace(/\bFigure\s*\d+/gi, `Figure ${actualFigureNo}`)
}

function extractFilenameFromPathLike(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  // Support URLs like /api/projects/.../upload?filename=...
  try {
    const url = new URL(trimmed, 'http://local')
    const filename = url.searchParams.get('filename')
    if (filename) return filename
  } catch {}

  const withoutQuery = trimmed.split('?')[0]?.split('#')[0] || trimmed
  const normalized = withoutQuery.replace(/\\/g, '/')
  const base = path.posix.basename(normalized)
  return base && base !== '.' && base !== '/' ? base : null
}

function buildProjectUploadImageUrl(projectId: string, patentId: string, filename: string): string {
  return `/api/projects/${projectId}/patents/${patentId}/upload?filename=${encodeURIComponent(filename)}`
}

async function reactivateFiguresForSession(sessionId: string) {
  if (!sessionId) return
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      figuresSkipped: false,
      figuresSkippedAt: null
    } as any
  })
}

function personaCoverageResponse(warnings: any[]) {
  return NextResponse.json({
    error: 'Selected persona is missing writing samples for one or more requested sections.',
    code: 'PERSONA_COVERAGE_WARNING',
    personaWarnings: warnings
  }, { status: 409 })
}

function personaAccessResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Persona not found or access denied'
  return NextResponse.json({
    error: message,
    code: error instanceof PersonaAccessError ? error.code : 'PERSONA_ACCESS_DENIED'
  }, { status: error instanceof PersonaAccessError ? error.status : 403 })
}

async function persistPersonaConfig(sessionId: string, enabled: boolean, selection?: PersonaSelection) {
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      personaStyleEnabled: enabled,
      primaryPersonaId: selection?.primaryPersonaId || null,
      secondaryPersonaIds: selection?.secondaryPersonaIds || [],
      personaStyleUpdatedAt: new Date()
    } as any
  })
}

async function resolveEffectivePersonaConfig(user: any, session: any, data: any) {
  const hasRequestOverride = typeof data?.usePersonaStyle === 'boolean' || data?.personaSelection !== undefined
  const sessionEnabled = (session as any).personaStyleEnabled === true
  const sessionSelection = getPersonaSelectionFromSession(session)

  let enabled = sessionEnabled
  let selection = sessionSelection
  let requestSelection: PersonaSelection | undefined

  if (hasRequestOverride) {
    enabled = data?.usePersonaStyle === true
    requestSelection = normalizePersonaSelectionInput(data?.personaSelection)
    if (requestSelection?.primaryPersonaId) {
      selection = requestSelection
    }
  }

  if (!enabled || !selection?.primaryPersonaId) {
    if (hasRequestOverride) {
      if (requestSelection?.primaryPersonaId) {
        const resolved = await validatePersonaSelectionForUser(user.id, user.tenantId, requestSelection)
        const resolvedSelection = resolved ? {
          primaryPersonaId: resolved.primaryPersonaId,
          primaryPersonaName: resolved.primaryPersonaName,
          secondaryPersonaIds: resolved.secondaryPersonaIds,
          secondaryPersonaNames: resolved.secondaryPersonaNames
        } : undefined
        await persistPersonaConfig(session.id, false, resolvedSelection)
        return { enabled: false, selection: undefined as any }
      }
      await persistPersonaConfig(session.id, false, selection)
    }
    return { enabled: false, selection: undefined as any }
  }

  const resolved = await validatePersonaSelectionForUser(user.id, user.tenantId, selection)
  const resolvedSelection = resolved ? {
    primaryPersonaId: resolved.primaryPersonaId,
    primaryPersonaName: resolved.primaryPersonaName,
    secondaryPersonaIds: resolved.secondaryPersonaIds,
    secondaryPersonaNames: resolved.secondaryPersonaNames
  } : undefined

  if (!resolvedSelection?.primaryPersonaId) {
    if (hasRequestOverride) await persistPersonaConfig(session.id, false)
    return { enabled: false, selection: undefined as any }
  }

  if (hasRequestOverride) {
    await persistPersonaConfig(session.id, true, resolvedSelection)
  }

  return { enabled: true, selection: resolvedSelection }
}

async function hydrateSessionPersonaForResponse(user: any, session: any) {
  const enabled = (session as any).personaStyleEnabled === true
  const baseSelection = getPersonaSelectionFromSession(session)
  if (!baseSelection?.primaryPersonaId) {
    return {
      ...session,
      usePersonaStyle: false,
      personaSelection: undefined
    }
  }

  try {
    const hydrated = await hydratePersonaSelectionForUser(user.id, user.tenantId, baseSelection)
    return {
      ...session,
      usePersonaStyle: enabled && !!hydrated?.primaryPersonaId,
      personaSelection: hydrated
    }
  } catch {
    return {
      ...session,
      usePersonaStyle: false,
      personaSelection: undefined
    }
  }
}

function resolveSketchPublicImageUrl(
  sketchRecord: any,
  projectId: string | null | undefined,
  patentId: string
): string | null {
  const raw = typeof sketchRecord?.imagePath === 'string'
    ? sketchRecord.imagePath
    : typeof sketchRecord?.imageUrl === 'string'
      ? sketchRecord.imageUrl
      : null

  // If already an absolute URL or an API-served URL, keep it as-is.
  if (raw && (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/api/'))) {
    return raw
  }

  const filename = extractFilenameFromPathLike(sketchRecord?.imageFilename)
    || extractFilenameFromPathLike(raw)

  if (filename && projectId) {
    return buildProjectUploadImageUrl(projectId, patentId, filename)
  }

  return raw
}

function getPreferredLanguageForJurisdiction(session: any, jurisdictionCode: string): string | undefined {
  try {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const lang = status?.[jurisdictionCode]?.language
    if (typeof lang === 'string' && lang.trim()) return lang.trim()
  } catch {}
  return undefined
}

// Valid language modes for validation
const VALID_LANGUAGE_MODES = ['common', 'individual_english_figures'] as const
type LanguageModeType = typeof VALID_LANGUAGE_MODES[number]

/**
 * Get the primary language for figures/diagrams/sketches from session.
 * This is set by the user in Stage 0 (jurisdiction selector) and persisted
 * throughout the drafting session.
 * 
 * Language Modes:
 * - 'common': All content + figures in one language (uses __commonLanguage or __figuresLanguage)
 * - 'individual_english_figures': Per-jurisdiction content, figures always English
 * 
 * Resolution order:
 * 1. If mode is 'individual_english_figures' → always 'en'
 * 2. __figuresLanguage from jurisdictionDraftStatus (explicitly set in Stage 0)
 * 3. __commonLanguage (when using common mode)
 * 4. Language of active jurisdiction
 * 5. 'en' as fallback
 */
function getFiguresLanguage(session: any): string {
  try {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    
    // Check language mode first - validate it's a known mode
    const languageMode = status.__languageMode
    if (languageMode && !VALID_LANGUAGE_MODES.includes(languageMode)) {
      console.warn(`[getFiguresLanguage] Invalid language mode "${languageMode}", treating as common mode`)
    }
    
    if (languageMode === 'individual_english_figures') {
      // Individual mode: figures always in English
      return 'en'
    }
    
    // Check for explicit figures language set in Stage 0
    if (typeof status.__figuresLanguage === 'string' && status.__figuresLanguage.trim()) {
      return status.__figuresLanguage.trim().toLowerCase()
    }
    
    // Check for common language (when using common mode)
    if (typeof status.__commonLanguage === 'string' && status.__commonLanguage.trim()) {
      return status.__commonLanguage.trim().toLowerCase()
    }
    
    // Fallback to active jurisdiction's language
    const activeJurisdiction = ((session as any)?.activeJurisdiction || '').toUpperCase()
    if (activeJurisdiction && status?.[activeJurisdiction]?.language) {
      return status[activeJurisdiction].language
    }
    
    // Final fallback
    return 'en'
  } catch (err) {
    console.error('[getFiguresLanguage] Error:', err)
    return 'en'
  }
}

/**
 * Get the content language for a specific jurisdiction.
 * In 'common' mode, returns the common language.
 * In 'individual_english_figures' mode, returns per-jurisdiction language.
 */
function getContentLanguageForJurisdiction(session: any, jurisdictionCode: string): string {
  try {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const languageMode = status.__languageMode
    
    // Common mode: use common language for all
    if (languageMode === 'common' && status.__commonLanguage) {
      return status.__commonLanguage
    }
    
    // Individual mode or no mode set: use per-jurisdiction language
    const lang = status?.[jurisdictionCode]?.language
    if (typeof lang === 'string' && lang.trim()) {
      return lang.trim()
    }
    
    // Fallback
    return 'en'
  } catch {
    return 'en'
  }
}

function applyPreferredLanguage(profile: any, preferred?: string) {
  if (!preferred) return profile
  const langs: string[] = Array.isArray(profile?.profileData?.meta?.languages)
    ? profile.profileData.meta.languages
    : []
  const reordered = [preferred, ...langs.filter(l => l !== preferred)]
  return {
    ...profile,
    profileData: {
      ...(profile?.profileData || {}),
      meta: {
        ...(profile?.profileData?.meta || {}),
        languages: reordered
      }
    }
  }
}


type ExportSectionDef = { key: string; label: string; required?: boolean }

const canonicalSectionMap: Record<string, string> = {
  title: 'title',
  abstract: 'abstract',
  technical_field: 'fieldOfInvention',
  field_of_invention: 'fieldOfInvention',
  field: 'fieldOfInvention',
  background: 'background',
  background_art: 'background',
  summary_of_invention: 'summary',
  summary: 'summary',
  brief_drawings: 'briefDescriptionOfDrawings',
  brief_description_of_drawings: 'briefDescriptionOfDrawings',
  description: 'detailedDescription',
  detailed_description: 'detailedDescription',
  best_mode: 'bestMethod',
  best_method: 'bestMethod',
  industrial_applicability: 'industrialApplicability',
  utility: 'industrialApplicability',
  claims: 'claims',
  abstract_section: 'abstract',
  reference_numerals: 'listOfNumerals',
  reference_signs: 'listOfNumerals',
  list_of_numerals: 'listOfNumerals'
}

function normalizeSectionKeyLocal(key: unknown): string {
  const raw = String(key || '').trim()
  if (!raw) return ''
  const compact = raw.replace(/[\s.-]+/g, '_').toLowerCase()
  const noSeparators = raw.replace(/[_\-\s.]/g, '').toLowerCase()
  if (noSeparators === 'detaileddescription') return 'detailedDescription'
  return canonicalSectionMap[raw] || canonicalSectionMap[compact] || raw
}

async function normalizeRequestedSectionList(keys: unknown): Promise<string[]> {
  if (!Array.isArray(keys)) return []
  const out: string[] = []
  for (const key of keys) {
    const local = normalizeSectionKeyLocal(key)
    if (!local) continue
    let canonical = local
    try {
      canonical = await resolveCanonicalKey(local)
    } catch {
      canonical = local
    }
    if (!out.includes(canonical)) out.push(canonical)
  }
  return out
}

const defaultExportSections: ExportSectionDef[] = [
  { key: 'title', label: 'Title', required: true },
  { key: 'fieldOfInvention', label: 'Field of the Invention', required: true },
  { key: 'background', label: 'Background of the Invention', required: true },
  { key: 'summary', label: 'Summary of the Invention', required: true },
  { key: 'briefDescriptionOfDrawings', label: 'Brief Description of the Drawings', required: false },
  { key: 'detailedDescription', label: 'Detailed Description of the Invention', required: true },
  { key: 'bestMethod', label: 'Best Method of Performing the Invention', required: false },
  { key: 'claims', label: 'Claims', required: true },
  { key: 'abstract', label: 'Abstract', required: true },
  { key: 'industrialApplicability', label: 'Industrial Applicability', required: false },
  { key: 'listOfNumerals', label: 'List of Reference Numerals', required: false }
]

async function getExportSectionsForJurisdiction(jurisdiction: string): Promise<ExportSectionDef[]> {
  try {
    const { resolveDisplayOrder } = await import('@/lib/section-display-order')
    // Fetch section mappings from database - this is the ONLY source of truth for ordering
    const sectionMappings = await prisma.countrySectionMapping.findMany({
      where: { countryCode: jurisdiction.toUpperCase(), isEnabled: true },
      orderBy: { displayOrder: 'asc' }
    })
    
    // DATABASE IS THE SOURCE OF TRUTH - use section mappings directly for sections and ordering
    if (sectionMappings.length > 0) {
      // Get superset sections for fallback displayOrder values
      const supersetSections = await prisma.supersetSection.findMany({
        where: { sectionKey: { in: sectionMappings.map(m => m.sectionKey) } },
        select: { sectionKey: true, displayOrder: true }
      })
      const supersetOrderByKey = new Map(supersetSections.map(s => [s.sectionKey, s.displayOrder]))
      
      // Build sections with resolved displayOrder for proper sorting
      const sectionsWithOrder: Array<ExportSectionDef & { displayOrder: number }> = []
      
      for (const mapping of sectionMappings) {
        const sectionKey = mapping.sectionKey
        const heading = mapping.heading || ''
        
        // Skip N/A, Implicit, or other non-applicable sections
        if (isNonApplicableHeading(heading)) {
          continue
        }
        
        // Resolve displayOrder using country mapping -> superset fallback -> parse from supersetCode
        let displayOrder: number
        try {
          displayOrder = resolveDisplayOrder({
            countryDisplayOrder: mapping.displayOrder,
            supersetDisplayOrder: supersetOrderByKey.get(sectionKey),
            supersetCode: (mapping as any).supersetCode,
            context: `${jurisdiction}:${String(sectionKey)}`
          })
        } catch {
          // If displayOrder resolution fails, use a large fallback to push to end
          displayOrder = 9999
          console.warn(`[getExportSectionsForJurisdiction] Could not resolve displayOrder for ${sectionKey}, using fallback`)
        }
        
        sectionsWithOrder.push({
          key: sectionKey,
          label: heading || sectionKey,
          required: mapping.isRequired ?? true,
          displayOrder
        })
      }
      
      // Sort sections by resolved displayOrder to ensure correct sequence
      sectionsWithOrder.sort((a, b) => a.displayOrder - b.displayOrder)
      
      // Strip displayOrder from final result (not part of ExportSectionDef interface)
      const sections: ExportSectionDef[] = sectionsWithOrder.map(({ displayOrder, ...rest }) => rest)
      
      const keys = new Set(sections.map(s => s.key))
      if (!keys.has('title') || !keys.has('abstract')) {
        throw new Error(`Jurisdiction "${jurisdiction}" is missing required export sections (title/abstract). Configure them via /super-admin/jurisdiction-config.`)
      }
      
      console.log(`[getExportSectionsForJurisdiction] ${jurisdiction}: ${sections.length} sections in order: ${sections.map(s => s.key).join(', ')}`)
      
      return sections
    }
    
    // NO FALLBACK - Database is the ONLY source of truth
    console.error(`[getExportSectionsForJurisdiction] CRITICAL: No CountrySectionMapping entries found for jurisdiction "${jurisdiction}". Database must be configured via /super-admin/jurisdiction-config.`)
    throw new Error(`Jurisdiction "${jurisdiction}" is not configured in the database. Please add section mappings via /super-admin/jurisdiction-config.`)
  } catch (err) {
    console.error('[getExportSectionsForJurisdiction] Failed to load sections for jurisdiction', jurisdiction, err)
    throw err // Re-throw - no fallbacks allowed
  }
}

function getSectionHeadingDynamic(sectionName: string, sections?: ExportSectionDef[]): string {
  const found = sections?.find(s => s.key === sectionName)
  if (found) return String(found.label || sectionName).toUpperCase()
  const fallbackMap: Record<string, string> = {
    fieldOfInvention: 'FIELD OF THE INVENTION',
    background: 'BACKGROUND OF THE INVENTION',
    summary: 'SUMMARY OF THE INVENTION',
    briefDescriptionOfDrawings: 'BRIEF DESCRIPTION OF THE DRAWINGS',
    detailedDescription: 'DETAILED DESCRIPTION OF THE INVENTION',
    industrialApplicability: 'INDUSTRIAL APPLICABILITY',
    bestMethod: 'BEST METHOD OF PERFORMING THE INVENTION',
    claims: 'CLAIMS',
    listOfNumerals: 'LIST OF REFERENCE NUMERALS',
    abstract: 'ABSTRACT'
  }
  return fallbackMap[sectionName] || sectionName.toUpperCase()
}

export async function GET(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    // Serve figure image previews without requiring Authorization headers (browser <img> cannot send them)
    const url = new URL(request.url)
    const imageKind = url.searchParams.get('image')
    if (imageKind === 'figure') {
      const sessionId = url.searchParams.get('sessionId') || ''
      const figureNo = Number(url.searchParams.get('figureNo') || '0')
      if (!sessionId || !figureNo) return NextResponse.json({ error: 'sessionId and figureNo required' }, { status: 400 })

      const ds = await prisma.diagramSource.findFirst({ where: { sessionId, figureNo } })
      try {
        const fs = await import('fs/promises')
        const path = await import('path')
        // Build locations (support both patents/ and projects/ storages and common filename patterns)
        const pat = await prisma.patent.findUnique({ where: { id: params.patentId }, select: { projectId: true } })
        const basePat = path.join(process.cwd(), 'uploads', 'patents', params.patentId, 'figures')
        const baseProj = pat?.projectId ? path.join(process.cwd(), 'uploads', 'projects', pat.projectId, 'patents', params.patentId, 'figures') : ''
        const nameCandidates = [
          ds?.imageFilename,
          `figure-${figureNo}.png`,
          `figure_${figureNo}.png`,
          `${figureNo}.png`,
          `figure-${figureNo}.jpg`,
          `figure_${figureNo}.jpg`,
          `${figureNo}.jpg`
        ].filter(Boolean) as string[]
        const candidates: string[] = []
        if (ds?.imagePath) candidates.push(ds.imagePath)
        for (const n of nameCandidates) {
          candidates.push(path.join(basePat, n))
          if (baseProj) candidates.push(path.join(baseProj, n))
        }
        let fileBuf: Buffer | null = null
        let usedPath = ''
        for (const p of candidates) {
          try {
            const buf = await fs.readFile(p)
            fileBuf = buf
            usedPath = p
            break
          } catch {}
        }
        if (!fileBuf) return NextResponse.json({ error: 'Image file not found' }, { status: 404 })
        const ext = path.extname(usedPath).toLowerCase()
        const type = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream'
        return new NextResponse(fileBuf as any, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=60' } })
      } catch (e) {
        return NextResponse.json({ error: 'Failed to read image' }, { status: 500 })
      }
    }

    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const { patentId } = params;

    // Verify patent access and get projectId for building image URLs
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: authResult.user.id },
          {
            project: {
              OR: [
                { userId: authResult.user.id },
                { collaborators: { some: { userId: authResult.user.id } } }
              ]
            }
          }
        ]
      },
      select: {
        id: true,
        projectId: true
      }
    });

    if (!patent) {
      return NextResponse.json(
        { error: 'Patent not found or access denied' },
        { status: 404 }
      );
    }
    
    const projectIdForSketchUrls = patent.projectId

    // Get drafting sessions for this patent
    const rawSessions = await prisma.draftingSession.findMany({
      where: {
        patentId,
        userId: authResult.user.id,
        tenantId: authResult.user.tenantId
      },
      include: {
        ideaRecord: true,
        referenceMap: true,
        figurePlans: true,
        diagramSources: true,
        // Include sketches so drafting/arrangement views show sketches alongside diagrams
        sketchRecords: {
          where: { isDeleted: false, status: 'SUCCESS' }
        },
        annexureDrafts: {
          // Keep all versions so UI can select the latest per jurisdiction
          orderBy: { version: 'desc' }
        },
        relatedArtRuns: {
          orderBy: { ranAt: 'desc' },
          take: 5, // Keep last 5 runs for reference
          include: {
            ideaBankSuggestions: true
          }
        },
        relatedArtSelections: true,
        // Include AI reviews for sidebar completion tracking
        aiReviews: {
          orderBy: { reviewedAt: 'desc' },
          take: 5 // Keep last 5 reviews per session
        }
      } as any,
      orderBy: { createdAt: 'desc' }
    });

      // Normalize sketch paths and ensure sketch records are present; if relation is empty, fallback to patent-level sketches
      const sessions = await Promise.all(
        rawSessions.map(async (s: any) => {
          let sketches = Array.isArray(s.sketchRecords) ? s.sketchRecords : []
          if (sketches.length === 0) {
            const patentSketches = await prisma.sketchRecord.findMany({
              where: { patentId, isDeleted: false, status: 'SUCCESS' },
              orderBy: { createdAt: 'asc' }
            })
            if (patentSketches.length > 0) {
              console.log(`[GET sessions] Loaded ${patentSketches.length} sketches from patent for session ${s.id} (relation was empty)`)
              sketches = patentSketches
            }
          }
          const normalizedSketches = sketches.map((sr: any) => {
            // Use resolveSketchPublicImageUrl to get proper API-based URL for production
            const resolvedUrl = resolveSketchPublicImageUrl(sr, projectIdForSketchUrls, patentId)
            return { 
              ...sr, 
              imagePath: resolvedUrl,
              imageUrl: resolvedUrl
            }
          })
          return hydrateSessionPersonaForResponse(authResult.user, { ...s, sketchRecords: normalizedSketches })
        })
      )

    // Log priorArtConfig for debugging
    if (sessions.length > 0) {
      console.log('📋 GET sessions - priorArtConfig:', {
        sessionId: sessions[0].id,
        priorArtConfig: (sessions[0] as any).priorArtConfig,
        claimRefinementConfig: (sessions[0] as any).priorArtConfig?.claimRefinementConfig
      })
    }

    return NextResponse.json({ sessions });

  } catch (error) {
    console.error('GET /api/patents/[patentId]/drafting error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  let authResult: any = null;
  let body: any = null;
  let patentId: string = params.patentId;

  try {
    authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    // Check organizational service access (Tenant Admin controlled)
    if (authResult.user.tenantId) {
      const serviceCheck = await enforceServiceAccess(
        authResult.user.id,
        authResult.user.tenantId,
        'PATENT_DRAFTING'
      );
      if (!serviceCheck.allowed) {
        return serviceCheck.response;
      }
    }

    body = await request.json();
    const { action, ...data } = body;

    // Verify patent access
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: authResult.user.id },
          {
            project: {
              OR: [
                { userId: authResult.user.id },
                { collaborators: { some: { userId: authResult.user.id } } }
              ]
            }
          }
        ]
      }
    });

    if (!patent) {
      return NextResponse.json(
        { error: 'Patent not found or access denied' },
        { status: 404 }
      );
    }

    // Extract request headers for LLM calls
    const requestHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value
    })

    // Route to appropriate handler based on action
    switch (action) {
      case 'start_session':
        return await handleStartSession(authResult.user, patentId, data);

      case 'normalize_idea':
        return await handleNormalizeIdea(authResult.user, patentId, data, requestHeaders);

      case 'proceed_to_components':
        return await handleProceedToComponents(authResult.user, patentId, data);

      case 'update_component_map':
        return await handleUpdateComponentMap(authResult.user, patentId, data);

      case 'validate_component_plan_llm':
        return await handleValidateComponentPlanLLM(authResult.user, patentId, data, requestHeaders);

      case 'update_figure_plan':
        return await handleUpdateFigurePlan(authResult.user, patentId, data);

      case 'skip_figures':
        return await handleSkipFigures(authResult.user, patentId, data);

      case 'restore_figures':
        return await handleRestoreFigures(authResult.user, patentId, data);

      // Stage 3.5: Related Art search & selection
      case 'related_art_search':
        return await handleRelatedArtSearchFromProviders(authResult.user, patentId, data, requestHeaders);
      case 'test_pqai_key':
        return await handleTestPQAIKey();
      case 'mock_related_art_search':
        return await handleMockRelatedArtSearch();
      case 'related_art_select':
        return await handleRelatedArtSelect(authResult.user, patentId, data);
      case 'related_art_llm_review':
        return await handleRelatedArtLLMReview(authResult.user, patentId, data, requestHeaders);
      case 'related_art_llm_review_stream':
        return handleRelatedArtLLMReviewStream(authResult.user, patentId, data, requestHeaders);

      case 'clear_related_art_selections':
        return await handleClearRelatedArtSelections(authResult.user, patentId, data);

      case 'save_manual_prior_art':
        return await handleSaveManualPriorArt(authResult.user, patentId, data);

      case 'save_ai_analysis':
        return await handleSaveAIAnalysis(authResult.user, patentId, data);

      case 'save_prior_art_config':
        return await handleSavePriorArtConfig(authResult.user, patentId, data);

      case 'update_persona_config':
        return await handleUpdatePersonaConfig(authResult.user, patentId, data);

      case 'upload_diagram':
        return await handleUploadDiagram(authResult.user, patentId, data);

      case 'generate_draft':
      case 'generate_reference_draft':
      case 'generate_reference_section':
      case 'generate_sections':
      case 'save_sections':
      case 'autosave_sections': {
        // PRE-CHECK: Verify user has patent drafting quota before expensive operations
        // This provides early feedback and prevents wasted LLM calls
        const isClearOnlyAutosave = action === 'autosave_sections' &&
          data?.patch &&
          typeof data.patch === 'object' &&
          Object.values(data.patch).every(value => value == null || (typeof value === 'string' && !value.trim()))

        if (!isClearOnlyAutosave && authResult.user.tenantId && data.sessionId) {
          const quotaCheck = await canDraftPatent(authResult.user.tenantId, data.sessionId, patentId)
          if (!quotaCheck.allowed) {
            return NextResponse.json(
              {
                error: quotaCheck.reason || 'Patent drafting quota exceeded. Please upgrade your plan.',
                code: 'QUOTA_EXCEEDED',
                quota: {
                  daily: quotaCheck.quota?.dailyUsed + '/' + (quotaCheck.quota?.dailyLimit ?? '∞'),
                  monthly: quotaCheck.quota?.monthlyUsed + '/' + (quotaCheck.quota?.monthlyLimit ?? '∞'),
                }
              },
              { status: 403 }
            )
          }
        }
        
        // Dispatch to appropriate handler based on action
        switch (action) {
          case 'generate_draft':
            return await handleGenerateDraft(authResult.user, patentId, data, requestHeaders);
          case 'generate_reference_draft':
            return await handleGenerateReferenceDraft(authResult.user, patentId, data, requestHeaders);
          case 'generate_reference_section':
            return await handleGenerateReferenceSection(authResult.user, patentId, data, requestHeaders);
          case 'generate_sections':
            return await handleGenerateSections(authResult.user, patentId, data, requestHeaders);
          case 'save_sections':
            return await handleSaveSections(authResult.user, patentId, data);
          case 'autosave_sections':
            return await handleAutosaveSections(authResult.user, patentId, data);
        }
      }

      // Multi-jurisdiction: Get the list of sections needed for reference draft
      case 'get_reference_sections':
        return await handleGetReferenceSections(authResult.user, patentId, data);

      // Multi-jurisdiction: Translate reference draft to target jurisdiction
      case 'translate_to_jurisdiction':
        return await handleTranslateToJurisdiction(authResult.user, patentId, data, requestHeaders);

      // Check for warnings before auto-generation
      case 'check_warnings':
        return await handleCheckWarnings(authResult.user, patentId, data, requestHeaders);

      case 'delete_annexure_draft':
        return await handleDeleteAnnexureDraft(authResult.user, patentId, data);

      case 'plan_figures_llm':
        return await handlePlanFiguresLLM(authResult.user, patentId, data, requestHeaders);

      case 'generate_diagrams_llm':
        return await handleGenerateDiagramsLLM(authResult.user, patentId, data, requestHeaders);

      case 'plan_and_generate_diagrams_llm':
        // Combined action: Plan figures first, then generate code based on plan
        // This is the recommended approach for auto mode
        return await handlePlanAndGenerateDiagramsLLM(authResult.user, patentId, data, requestHeaders);

      case 'save_plantuml':
        return await handleSavePlantUML(authResult.user, patentId, data);

      case 'translate_plantuml':
        return await handleTranslatePlantUML(authResult.user, patentId, data, requestHeaders);

      case 'translate_all_diagrams':
        return await handleTranslateAllDiagrams(authResult.user, patentId, data, requestHeaders);

      case 'get_diagram_translations':
        return await handleGetDiagramTranslations(authResult.user, patentId, data);

      case 'regenerate_diagram_llm':
        return await handleRegenerateDiagramLLM(authResult.user, patentId, data, requestHeaders);

      case 'fix_plantuml_render':
        return await handleFixPlantUMLRender(authResult.user, patentId, data, requestHeaders);

      case 'add_figure_llm':
        return await handleAddFigureLLM(authResult.user, patentId, data, requestHeaders);

      case 'add_figures_llm':
        return await handleAddFiguresLLM(authResult.user, patentId, data, requestHeaders);

      case 'delete_figure':
        return await handleDeleteFigure(authResult.user, patentId, data);

      case 'create_manual_figure':
        return await handleCreateManualFigure(authResult.user, patentId, data);

      case 'detect_external_image_content':
        return await handleDetectExternalImageContent(authResult.user, patentId, data, requestHeaders);

      // === SKETCH GENERATION (Figure Planner - Sketch Tab) ===
      case 'generate_sketch':
        return await handleGenerateSketch(authResult.user, patentId, data);

      case 'generate_sketch_guided':
        return await handleGenerateSketchGuided(authResult.user, patentId, data);

      case 'refine_sketch':
        return await handleRefineSketch(authResult.user, patentId, data);

      case 'modify_sketch':
        return await handleModifySketch(authResult.user, patentId, data);

      case 'list_sketches':
        return await handleListSketches(authResult.user, patentId, data);

      case 'get_sketch':
        return await handleGetSketch(authResult.user, patentId, data);

      case 'delete_sketch':
        return await handleDeleteSketch(authResult.user, patentId, data);

      case 'toggle_sketch_favorite':
        return await handleToggleSketchFavorite(authResult.user, patentId, data);

      case 'update_sketch_metadata':
        return await handleUpdateSketchMetadata(authResult.user, patentId, data);

      case 'retry_sketch':
        return await handleRetrySketch(authResult.user, patentId, data);

      case 'generate_from_suggestion':
        return await handleGenerateFromSuggestion(authResult.user, patentId, data);

      case 'generate_sketch_suggestions':
        return await handleGenerateSketchSuggestions(authResult.user, patentId, data, requestHeaders);

      // === FIGURE SEQUENCE ARRANGEMENT ===
      case 'get_combined_figures':
        return await handleGetCombinedFigures(authResult.user, patentId, data);

      case 'save_figure_sequence':
        return await handleSaveFigureSequence(authResult.user, patentId, data);

      case 'ai_arrange_figures':
        return await handleAIArrangeFigures(authResult.user, patentId, data, requestHeaders);

      case 'finalize_figure_sequence':
        return await handleFinalizeFigureSequence(authResult.user, patentId, data);

      case 'unlock_figure_sequence':
        return await handleUnlockFigureSequence(authResult.user, patentId, data);

      // === IMAGE EDITOR (Edit diagrams/sketches) ===
      case 'update_image':
        return await handleUpdateImage(authResult.user, patentId, data);

      case 'restore_original_image':
        return await handleRestoreOriginalImage(authResult.user, patentId, data);

      // New actions for Stage 1 editing, navigation, and resume
      case 'update_idea_record':
        return await handleUpdateIdeaRecord(authResult.user, patentId, data);

      // Manual patent type override (Stage 1)
      case 'update_patent_type':
        return await handleUpdatePatentType(authResult.user, patentId, data);

      // Claims generation and management (Stage 1)
      case 'generate_claims':
        return await handleGenerateClaims(authResult.user, patentId, data, requestHeaders);

      case 'save_claims':
        return await handleSaveClaims(authResult.user, patentId, data);

      case 'reset_claims':
        return await handleResetClaims(authResult.user, patentId, data);

      case 'freeze_claims':
        return await handleFreezeClaims(authResult.user, patentId, data, requestHeaders);

      case 'unfreeze_claims':
        return await handleUnfreezeClaims(authResult.user, patentId, data);

      case 'claim_refinement_preview':
        return await handleClaimRefinementPreview(authResult.user, patentId, data, requestHeaders);

      case 'claim_refinement_apply':
        return await handleClaimRefinementApply(authResult.user, patentId, data);

      case 'add_component_numbers_to_claims':
        return await handleAddComponentNumbersToClaims(authResult.user, patentId, data, requestHeaders);

      case 'set_stage':
        return await handleSetStage(authResult.user, patentId, data, requestHeaders);

      case 'resume':
        return await handleResume(authResult.user, patentId);

      // Review (AI) & Validation
      case 'validate_draft':
        return await handleValidateDraft(authResult.user, patentId, data);

      case 'run_ai_review':
        return await handleRunAIReview(authResult.user, patentId, data, requestHeaders);

      case 'apply_ai_fix':
        return await handleApplyAIFix(authResult.user, patentId, data, requestHeaders);

      case 'get_ai_reviews':
        return await handleGetAIReviews(authResult.user, patentId, data);

      case 'ignore_ai_issue':
        return await handleIgnoreAIIssue(authResult.user, patentId, data);

      case 'revert_ai_fix':
        return await handleRevertAIFix(authResult.user, patentId, data);

      case 'export_docx':
        return await handleExportDOCX(authResult.user, patentId, data, request);

      case 'export_pdf':
        return await handleExportPDF(authResult.user, patentId, data, request);

      case 'get_draft_versions':
        return await handleGetDraftVersions(authResult.user, patentId, data);

      case 'get_draft_by_version':
        return await handleGetDraftByVersion(authResult.user, patentId, data);

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('POST /api/patents/[patentId]/drafting error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('Request body:', body || 'Not parsed yet');
    console.error('User ID:', authResult?.user?.id || 'Not authenticated yet');
    console.error('Patent ID:', patentId);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function handleClearRelatedArtSelections(user: any, patentId: string, data: any) {
  const { sessionId, runId } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Delete all related art selections for this session and run
  await (prisma as any).relatedArtSelection.deleteMany({
    where: {
      sessionId,
      runId: runId || null
    }
  })

  return NextResponse.json({ success: true })
}

async function handleSaveManualPriorArt(user: any, patentId: string, data: any) {
  const { sessionId, manualPriorArt } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const updated = await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { manualPriorArt: manualPriorArt || null } as any
  })

  return NextResponse.json({ session: updated })
}

async function handleSaveAIAnalysis(user: any, patentId: string, data: any) {
  const { sessionId, aiAnalysisData } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const updated = await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { aiAnalysisData: aiAnalysisData || null } as any
  })

  return NextResponse.json({ session: updated })
}

async function handleSavePriorArtConfig(user: any, patentId: string, data: any) {
  const { sessionId, priorArtConfig, claimRefConfig, skipClaimRefinement } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Merge with existing priorArtConfig
  const existingConfig = (session.priorArtConfig as any) || {}
  
  const updatedConfig = {
    ...existingConfig,
    // Prior Art for Drafting workflow
    priorArtForDrafting: priorArtConfig ? {
      mode: priorArtConfig.mode || 'ai',
      selectedPatents: priorArtConfig.selectedPatents || [],
      manualText: priorArtConfig.manualText || '',
      literatureReviewInstructions: priorArtConfig.literatureReviewInstructions || ''
    } : existingConfig.priorArtForDrafting,
    // Claim Refinement workflow
    claimRefinementConfig: claimRefConfig ? {
      mode: claimRefConfig.mode || 'ai',
      selectedPatents: claimRefConfig.selectedPatents || [],
      manualText: claimRefConfig.manualText || ''
    } : existingConfig.claimRefinementConfig,
    // Skip flag
    skippedClaimRefinement: skipClaimRefinement ?? existingConfig.skippedClaimRefinement
  }

  const updated = await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { priorArtConfig: updatedConfig } as any
  })

  console.log('💾 Saved prior art config:', {
    priorArtForDrafting: {
      mode: updatedConfig.priorArtForDrafting?.mode,
      patentsCount: updatedConfig.priorArtForDrafting?.selectedPatents?.length || 0
    },
    claimRefinementConfig: {
      mode: updatedConfig.claimRefinementConfig?.mode,
      patentsCount: updatedConfig.claimRefinementConfig?.selectedPatents?.length || 0,
      patents: updatedConfig.claimRefinementConfig?.selectedPatents?.map((p: any) => p.patentNumber)
    },
    skippedClaimRefinement: updatedConfig.skippedClaimRefinement
  })

  return NextResponse.json({ session: updated, priorArtConfig: updatedConfig })
}

async function handleUpdatePersonaConfig(user: any, patentId: string, data: any) {
  const { sessionId, enabled, primaryPersonaId, secondaryPersonaIds, personaSelection } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const shouldEnable = enabled === true
  const inputSelection = normalizePersonaSelectionInput(personaSelection || {
    primaryPersonaId,
    secondaryPersonaIds
  })

  if (!shouldEnable) {
    try {
      let selectionToPersist = inputSelection || getPersonaSelectionFromSession(session)
      if (inputSelection?.primaryPersonaId) {
        const resolved = await validatePersonaSelectionForUser(user.id, user.tenantId, inputSelection)
        selectionToPersist = resolved ? {
          primaryPersonaId: resolved.primaryPersonaId,
          primaryPersonaName: resolved.primaryPersonaName,
          secondaryPersonaIds: resolved.secondaryPersonaIds,
          secondaryPersonaNames: resolved.secondaryPersonaNames
        } : undefined
      }

      await persistPersonaConfig(sessionId, false, selectionToPersist)
      const updated = await prisma.draftingSession.findUnique({ where: { id: sessionId } })
      const hydrated = updated ? await hydrateSessionPersonaForResponse(user, updated) : updated
      return NextResponse.json({
        success: true,
        session: hydrated,
        usePersonaStyle: false,
        personaSelection: (hydrated as any)?.personaSelection
      })
    } catch (error) {
      return personaAccessResponse(error)
    }
  }

  if (!inputSelection?.primaryPersonaId) {
    return NextResponse.json({
      error: 'Select a primary persona before enabling persona style.',
      code: 'PERSONA_REQUIRED'
    }, { status: 400 })
  }

  try {
    const resolved = await validatePersonaSelectionForUser(user.id, user.tenantId, inputSelection)
    if (!resolved?.primaryPersonaId) {
      return NextResponse.json({
        error: 'Select a primary persona before enabling persona style.',
        code: 'PERSONA_REQUIRED'
      }, { status: 400 })
    }

    const selection = {
      primaryPersonaId: resolved.primaryPersonaId,
      primaryPersonaName: resolved.primaryPersonaName,
      secondaryPersonaIds: resolved.secondaryPersonaIds,
      secondaryPersonaNames: resolved.secondaryPersonaNames
    }

    await persistPersonaConfig(sessionId, true, selection)
    const updated = await prisma.draftingSession.findUnique({ where: { id: sessionId } })
    return NextResponse.json({
      success: true,
      session: updated ? await hydrateSessionPersonaForResponse(user, updated) : updated,
      usePersonaStyle: true,
      personaSelection: selection
    })
  } catch (error) {
    return personaAccessResponse(error)
  }
}

type RelatedArtReviewProgress = {
  type: 'start' | 'batch_started' | 'batch_completed' | 'saving' | 'saved'
  processed?: number
  total?: number
  batch?: number
  totalBatches?: number
  message?: string
}

type RelatedArtReviewProgressSink = (event: RelatedArtReviewProgress) => void | Promise<void>

async function emitRelatedArtReviewProgress(onProgress: RelatedArtReviewProgressSink | undefined, event: RelatedArtReviewProgress) {
  if (!onProgress) return
  try {
    await onProgress(event)
  } catch (error) {
    console.warn('[Related Art Review] Failed to emit progress event:', error)
  }
}

function relatedArtStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => relatedArtStringArray(item))
  }
  if (typeof value === 'string') {
    return value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean)
  }
  if (value === undefined || value === null) return []
  return [String(value).trim()].filter(Boolean)
}

function uniqueRelatedArtStrings(values: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  values.flatMap(value => relatedArtStringArray(value)).forEach(value => {
    const clean = value.replace(/\s+/g, ' ').trim()
    if (!clean) return
    const key = clean.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(clean)
  })
  return out
}

function normalizeRelatedArtSearchText(value: unknown, maxWords?: number): string {
  const text = String(value || '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
  if (!maxWords) return text
  return text.split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ')
}

function buildRelatedArtRetrievalQueries(searchQuery: string, inventionFeatures: string[]): PatentRetrievalQuery[] {
  const queries: PatentRetrievalQuery[] = []
  const seen = new Set<string>()
  const addQuery = (query: PatentRetrievalQuery) => {
    const text = normalizeRelatedArtSearchText(query.text, query.type === 'feature' ? 18 : 36)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) return
    seen.add(key)
    queries.push({ ...query, text })
  }

  if (searchQuery) {
    addQuery({
      id: 'concept',
      type: 'concept',
      text: searchQuery,
      weight: 1.25,
      label: 'Core concept',
    })
  }

  const features = inventionFeatures
    .map(feature => normalizeRelatedArtSearchText(feature, 18))
    .filter(Boolean)
    .slice(0, 8)

  features.forEach((feature, index) => {
    addQuery({
      id: `feature-${index + 1}`,
      type: 'feature',
      text: feature,
      weight: 1.1,
      featureIndex: index,
      featureIndexes: [index],
      label: feature,
    })
  })

  for (let index = 0; index < Math.min(features.length - 1, 3); index += 1) {
    addQuery({
      id: `feature-pair-${index + 1}`,
      type: 'feature_pair',
      text: `${features[index]} ${features[index + 1]}`,
      weight: 1.15,
      featureIndexes: [index, index + 1],
      label: `${features[index]} + ${features[index + 1]}`,
    })
  }

  return queries
}

function normalizeRelatedArtSourceMode(value: unknown): PatentSearchSourceMode {
  return value === 'INDIAN_ONLY' || value === 'PQAI_ONLY' || value === 'PQAI_PLUS_INDIAN'
    ? value
    : 'PQAI_PLUS_INDIAN'
}

function normalizeRelatedArtProviderIds(value: unknown): PatentSearchProviderId[] | undefined {
  if (!Array.isArray(value)) return undefined
  const providerIds = Array.from(new Set(
    value
      .map(item => String(item || '').trim())
      .filter(Boolean)
  )) as PatentSearchProviderId[]
  return providerIds.length ? providerIds : undefined
}

function normalizeRelatedArtDateText(value: unknown): string | undefined {
  if (!value) return undefined
  if (typeof value === 'number' && value >= 1000 && value <= 9999) return `${Math.trunc(value)}-01-01`
  const text = String(value).trim()
  if (!text) return undefined
  if (/^\d{4}$/.test(text)) return `${text}-01-01`
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const date = value instanceof Date ? value : new Date(text)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString().slice(0, 10)
}

function getRelatedArtPublicationDate(result: any): string | undefined {
  return normalizeRelatedArtDateText(result?.publicationDate || result?.publication_date || result?.pub_date || result?.date || result?.year)
}

function matchesRelatedArtAfterDate(result: any, afterDate?: string): boolean {
  if (!afterDate) return true
  const publicationDate = getRelatedArtPublicationDate(result)
  if (!publicationDate) return false
  return publicationDate >= afterDate
}

function firstRelatedArtScore(values: unknown[]): number | undefined {
  for (const value of values) {
    const score = typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN
    if (Number.isFinite(score)) return Math.max(0, Math.min(1, score > 1 ? score / 100 : score))
  }
  return undefined
}

function jsonSafeRelatedArtResult<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function toDraftingRelatedArtResult(result: NormalizedPatentResult): any {
  const publicationNumber = result.publicationNumber || result.publication_number || result.pn || 'Unknown'
  const publicationDate = normalizeRelatedArtDateText(result.publicationDate)
  const filingDate = normalizeRelatedArtDateText(result.filingDate)
  const score = firstRelatedArtScore([
    result.relevanceScore,
    result.retrievalScore,
    result.hybridScore,
    (result as any).score,
    (result as any).relevance,
  ])
  const classifications = Array.isArray(result.classifications) ? result.classifications : []
  const cpcCodes = Array.isArray(result.cpcCodes) && result.cpcCodes.length ? result.cpcCodes : classifications
  const ipcCodes = Array.isArray(result.ipcCodes) && result.ipcCodes.length ? result.ipcCodes : classifications

  return jsonSafeRelatedArtResult({
    ...result,
    publicationNumber,
    publication_number: result.publication_number || publicationNumber,
    patent_number: (result as any).patent_number || publicationNumber,
    pn: result.pn || publicationNumber,
    title: result.title || 'Untitled Patent',
    abstract: result.abstract || result.snippet || '',
    snippet: result.snippet || result.abstract || '',
    publicationDate,
    publication_date: publicationDate,
    filingDate,
    filing_date: filingDate,
    score,
    relevance: score,
    cpc_codes: cpcCodes,
    ipc_codes: ipcCodes,
    assignees: (result as any).assignees || result.applicants || [],
    provider: result.sourceProvider,
  })
}

function buildDraftingRelatedArtSearchPlan(idea: any, searchQuery: string, filters: PatentSearchFilters): Partial<PatentSearchQueryPlan> {
  const normalizedData = migrateNormalizedData(idea?.normalizedData || {})
  const components = Array.isArray(normalizedData.components) ? normalizedData.components : []
  const componentFeatures = components.flatMap(component => [
    component?.name,
    component?.description,
    component?.inputs,
    component?.outputs,
  ])
  const inventionFeatures = uniqueRelatedArtStrings([
    normalizedData.coreInventiveConcept,
    normalizedData.claimableFeatures,
    normalizedData.fallbackLimitations,
    componentFeatures,
  ]).slice(0, 12)
  const cpcCodes = uniqueRelatedArtStrings([normalizedData.cpcCodes, idea?.cpcCodes])
  const ipcCodes = uniqueRelatedArtStrings([normalizedData.ipcCodes, idea?.ipcCodes])
  const classificationHints = uniqueRelatedArtStrings([cpcCodes, ipcCodes])
  const abstract = normalizeRelatedArtSearchText(idea?.abstract || normalizedData.abstract || '', 160)
  const inventionText = normalizeRelatedArtSearchText([
    idea?.title,
    abstract,
    normalizedData.problem,
    normalizedData.objectives,
    normalizedData.logic,
    inventionFeatures.join(' '),
  ].filter(Boolean).join(' '), 500)
  const keywords = uniqueRelatedArtStrings(searchQuery.split(/\s+/).filter(word => word.length > 3)).slice(0, 20)

  return {
    originalQuery: searchQuery,
    normalizedQuery: searchQuery,
    searchQuery,
    semanticQuery: normalizeRelatedArtSearchText([searchQuery, abstract, inventionFeatures.join(' '), classificationHints.join(' ')].join(' '), 220),
    inventionFeatures,
    technicalKeywords: keywords,
    synonyms: [],
    mustHaveTerms: [],
    excludedTerms: [],
    cpcCodes,
    ipcCodes,
    classificationHints,
    fieldFilters: filters,
    explicitFilters: filters,
    searchVariants: searchQuery ? [searchQuery] : [],
    retrievalQueries: buildRelatedArtRetrievalQueries(searchQuery, inventionFeatures),
    llmExpanded: false,
    confidence: 0.85,
    warnings: ['Using drafting idea record query plan; LLM query expansion disabled.'],
    inventionText,
  } as Partial<PatentSearchQueryPlan> & { inventionText: string }
}

function getRelatedArtCandidatePatentNumber(result: any): string {
  return String(
    result?.pn ||
    result?.patent_number ||
    result?.publication_number ||
    result?.publicationNumber ||
    result?.publication_id ||
    result?.publicationId ||
    result?.patentId ||
    result?.patent_id ||
    result?.applicationNumber ||
    result?.applicationNumberRaw ||
    result?.id ||
    ''
  ).trim()
}

function compactRelatedArtCandidateNumber(value: unknown): string {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function getRelatedArtCandidateTitle(result: any): string {
  return normalizeRelatedArtSearchText(
    result?.title ||
    result?.invention_title ||
    result?.inventionTitle ||
    result?.raw?.title ||
    getRelatedArtCandidatePatentNumber(result) ||
    'Untitled patent',
    32
  )
}

function getRelatedArtCandidateAbstract(result: any): string {
  return normalizeRelatedArtSearchText(
    result?.abstract ||
    result?.snippet ||
    result?.summary ||
    result?.description ||
    result?.abstractOriginal ||
    result?.raw?.abstract ||
    result?.raw?.abstractOriginal ||
    result?.raw?.ragText ||
    result?.raw?.claimsText ||
    result?.matchReasons ||
    result?.retrievalMatches?.map((match: any) => match?.queryText).filter(Boolean).join('; ') ||
    '',
    220
  )
}

function getRelatedArtCandidateSource(result: any): string {
  const providers = [
    ...(Array.isArray(result?.sourceProviders) ? result.sourceProviders : []),
    result?.sourceProvider,
    result?.providerId,
    result?.provider,
  ].map(value => String(value || '').toLowerCase())
  if (providers.includes('indian-corpus')) return 'Indian Patent Corpus'
  if (providers.includes('pqai')) return 'PQAI International'
  const jurisdiction = String(result?.jurisdiction || result?.country || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
  if (jurisdiction === 'IN' || jurisdiction === 'IND' || jurisdiction === 'INDIA' || getRelatedArtCandidatePatentNumber(result).toUpperCase().startsWith('IN')) {
    return 'Indian Patent Corpus'
  }
  return 'International Patent Search'
}

function handleRelatedArtLLMReviewStream(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: any) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`))
      }

      try {
        const response = await handleRelatedArtLLMReview(user, patentId, data, requestHeaders, send)
        const text = await response.text()
        let payload: any = {}
        try {
          payload = text ? JSON.parse(text) : {}
        } catch {
          payload = { raw: text }
        }

        if (!response.ok) {
          send({ type: 'error', error: payload?.error || 'AI review failed. Please try again.' })
        } else {
          send({ type: 'complete', ...payload })
        }
      } catch (error) {
        console.error('[Related Art Review] Stream failed:', error)
        send({ type: 'error', error: error instanceof Error ? error.message : 'AI review failed. Please try again.' })
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    }
  })
}

async function handleRelatedArtLLMReview(user: any, patentId: string, data: any, requestHeaders: Record<string, string>, onProgress?: RelatedArtReviewProgressSink) {
  const { sessionId, runId, batchSize, claimsContext } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  let sessionData = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      ideaRecord: true,
      relatedArtRuns: {
        orderBy: { ranAt: 'desc' },
        take: 1,
        include: { ideaBankSuggestions: true }
      }
    }
  })
  if (!sessionData) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const session = sessionData

  const useRunId = runId || session.relatedArtRuns?.[0]?.id
  if (!useRunId) return NextResponse.json({ error: 'No related art run found. Run a search first.' }, { status: 400 })

  const run = await prisma.relatedArtRun.findUnique({ where: { id: useRunId as string } }) as any
  if (!run) return NextResponse.json({ error: 'Related art run not found' }, { status: 404 })

  const results: any[] = Array.isArray(run.resultsJson) ? run.resultsJson : []
  if (results.length === 0) return NextResponse.json({ error: 'No results to review' }, { status: 400 })

  const requestedPatentNumbers = Array.isArray(data?.candidatePatentNumbers)
    ? data.candidatePatentNumbers
    : Array.isArray(data?.reviewPatentNumbers)
      ? data.reviewPatentNumbers
      : []
  const requestedPatentNumberSet = new Set(
    requestedPatentNumbers
      .map((value: unknown) => compactRelatedArtCandidateNumber(value))
      .filter(Boolean)
  )
  const reviewResults = requestedPatentNumberSet.size > 0
    ? results.filter((result: any) => requestedPatentNumberSet.has(compactRelatedArtCandidateNumber(getRelatedArtCandidatePatentNumber(result))))
    : results

  if (requestedPatentNumberSet.size > 0 && reviewResults.length === 0) {
    return NextResponse.json({
      reviewed: 0,
      decisions: [],
      autoSelect: [],
      runId: useRunId,
      batches: 0,
      message: 'No matching patent candidates were found for re-analysis.'
    })
  }

  const title = session?.ideaRecord?.title || ''
  const query = (session?.ideaRecord as any)?.searchQuery || ''
  
  // Get frozen claims from session for claim-aware analysis
  const normalizedData = normalizeClaimsForSession((session?.ideaRecord?.normalizedData as any) || {})
  const authoritativeClaims = getAuthoritativeClaims(normalizedData)
  const frozenClaims = claimsContext?.claims || authoritativeClaims.structured
  const claimsText = authoritativeClaims.html
  const hasClaimsContext = claimsContext?.frozenAt || normalizedData.claimsApprovedAt || claimsText
  const manualPriorArtText = (session?.manualPriorArt as any)?.manualPriorArtText || (session?.manualPriorArt as any)?.text || ''
  const manualPriorArtSection = manualPriorArtText
    ? `\n\nUSER-SUPPLIED PRIOR ART & ANALYSIS (treat as highly relevant):\n${manualPriorArtText}`
    : ''
  
  // Build claims summary for the prompt
  let claimsSection = ''
  if (hasClaimsContext) {
    if (Array.isArray(frozenClaims) && frozenClaims.length > 0) {
      const claimsSummary = frozenClaims.slice(0, 8).map((c: any) => 
        `Claim ${c.number} (${c.type}): ${(c.text || '').substring(0, 200)}...`
      ).join('\n')
      const heading = normalizedData.claimsApprovedAt ? 'OUR FROZEN PATENT CLAIMS' : 'OUR CURRENT CLAIMS'
      claimsSection = `\n\n${heading} (analyze prior art against these specific claims):\n${claimsSummary}`
      if (frozenClaims.length > 8) {
        claimsSection += `\n(+ ${frozenClaims.length - 8} additional claims)`
      }
    } else if (typeof frozenClaims === 'string' && frozenClaims.trim()) {
      // Handle string claims (HTML)
      const plainClaims = frozenClaims.replace(/<[^>]*>/g, '').substring(0, 1000)
      const heading = normalizedData.claimsApprovedAt ? 'OUR FROZEN PATENT CLAIMS' : 'OUR CURRENT CLAIMS'
      claimsSection = `\n\n${heading} (analyze prior art against these specific claims):\n${plainClaims}...`
    } else if (claimsText) {
      const plainClaims = claimsText.replace(/<[^>]*>/g, '').substring(0, 1000)
      const heading = normalizedData.claimsApprovedAt ? 'OUR FROZEN PATENT CLAIMS' : 'OUR CURRENT CLAIMS'
      claimsSection = `\n\n${heading} (analyze prior art against these specific claims):\n${plainClaims}...`
    }
  }

  const candidates = reviewResults.map((r: any) => {
    const pn = getRelatedArtCandidatePatentNumber(r)
    return {
      pn,
      title: getRelatedArtCandidateTitle(r),
      abstract: getRelatedArtCandidateAbstract(r),
      source: getRelatedArtCandidateSource(r),
    }
  }).filter(x => x.pn && x.title)

  if (candidates.length === 0) {
    return NextResponse.json({ error: 'No reviewable patent candidates found in this related art run.' }, { status: 400 })
  }

  console.log('Related art AI review candidate sources:', {
    total: candidates.length,
    indian: candidates.filter(candidate => candidate.source === 'Indian Patent Corpus').length,
    international: candidates.filter(candidate => candidate.source !== 'Indian Patent Corpus').length,
    sample: candidates.slice(0, 5).map(candidate => ({ pn: candidate.pn, source: candidate.source })),
  })

  // Process all candidates at once instead of in batches
  const request = { headers: requestHeaders || {} }
  const allDecisions: Array<{
    pn: string;
    title: string;
    relevance: number;
    novelty_threat: 'anticipates'|'obvious'|'adjacent'|'remote';
    summary: string;
    detailedAnalysis: {
      summary: string;
      relevant_parts: string[];
      irrelevant_parts: string[];
      novelty_comparison: string;
    };
    noveltyInsights?: {
      differences?: string;
      improvementSuggestions?: string;
    }
  }> = []

  // Create candidate text for all patents
  const candidatesText = candidates.map((b, idx) => `#${idx+1}. PN:${b.pn||'N/A'}\nSource: ${b.source}\nTitle: ${b.title}\nAbstract: ${b.abstract || 'Not available'}`).join('\n\n')

  // STEP 1: Relevance Analysis (in batches to avoid token limits)
  console.log('Starting relevance analysis with Gemini 2.5 Flash-Lite...')
  const effectiveBatchSize = batchSize || 6 // Use provided batchSize or default to 6
  const totalBatches = Math.max(1, Math.ceil(candidates.length / effectiveBatchSize))
  let relevanceData: any[] = []

  await emitRelatedArtReviewProgress(onProgress, {
    type: 'start',
    processed: 0,
    total: candidates.length,
    totalBatches,
    message: `Starting AI analysis for ${candidates.length} patents`
  })

  for (let i = 0; i < candidates.length; i += effectiveBatchSize) {
    const batch = candidates.slice(i, i + effectiveBatchSize)
    const batchNumber = Math.floor(i / effectiveBatchSize) + 1
    const batchText = batch.map((b, idx) => `#${idx+1}. PN:${b.pn||'N/A'}\nSource: ${b.source}\nTitle: ${b.title}\nAbstract: ${b.abstract || 'Not available'}`).join('\n\n')

    await emitRelatedArtReviewProgress(onProgress, {
      type: 'batch_started',
      processed: i,
      total: candidates.length,
      batch: batchNumber,
      totalBatches,
      message: `Analyzing batch ${batchNumber} of ${totalBatches}`
    })

    const batchRelevancePrompt = `You are an expert patent attorney. Analyze these patent candidates for relevance to our invention and assess novelty threat to our specific claims.

INVENTION: ${title} | SEARCH: ${query}${claimsSection}${manualPriorArtSection}

For each patent candidate listed below, including Indian Patent Corpus candidates, provide exactly one result using the exact PN value shown:
- relevance: 0.0-1.0 score
- novelty_threat: "anticipates" | "obvious" | "adjacent" | "remote"
  * "anticipates" = This prior art discloses ALL elements of at least one of our claims
  * "obvious" = Combining this with common knowledge would render our claims obvious
  * "adjacent" = Related technology but doesn't threaten our specific claim scope
  * "remote" = Different field, minimal relevance to our claims
- summary: 1-2 sentence explanation of how this relates to our claims
- relevant_parts: List specific elements/claims/aspects of the patent that overlap with OUR claims
- irrelevant_parts: List specific elements/claims/aspects of the patent that DON'T overlap with our claims
- novelty_comparison: Explain what makes our claims novel compared to this patent (specific claim elements not disclosed)
${hasClaimsContext ? '\nIMPORTANT: Focus analysis on whether prior art anticipates or renders obvious our SPECIFIC CLAIMS listed above.' : ''}

Return ONLY JSON:
{
  "relevance_results": [
    {
      "pn": "patent_number",
      "title": "patent_title",
      "relevance": 0.8,
      "novelty_threat": "adjacent",
      "summary": "analysis",
      "relevant_parts": ["specific element 1", "specific element 2"],
      "irrelevant_parts": ["unrelated element 1", "different aspect 1"],
      "novelty_comparison": "detailed explanation of novelty differences"
    }
  ]
}

PATENTS:
${batchText}`

    const relevanceResult = await llmGateway.executeLLMOperation(request, {
      taskCode: 'LLM1_PRIOR_ART',
      stageCode: 'NOVELTY_RELEVANCE_SCORING', // Use stage config for admin-configured model/limits
      prompt: batchRelevancePrompt,
      idempotencyKey: crypto.randomUUID(),
      inputTokens: Math.ceil(batchRelevancePrompt.length / 4),
      parameters: { maxOutputTokens: 3000 },
      metadata: {
        patentId,
        sessionId,
        runId: useRunId,
        purpose: 'related_art_relevance_batch'
      }
    })

    console.log(`Relevance analysis batch ${batchNumber} model used:`, relevanceResult?.response?.modelClass || 'unknown')

    if (relevanceResult.success && relevanceResult.response) {
      try {
        const txt = (relevanceResult.response.output || '').trim()
        const start = txt.indexOf('{')
        const end = txt.lastIndexOf('}')
        const json = start !== -1 && end !== -1 && end > start ? txt.substring(start, end + 1) : txt

        const parsed = JSON.parse(json)
        const batchResults = Array.isArray(parsed?.relevance_results) ? parsed.relevance_results : []
        const returnedPns = new Set(
          batchResults
            .map((item: any) => compactRelatedArtCandidateNumber(item?.pn || item?.patent_number || item?.publicationNumber || item?.publication_number))
            .filter(Boolean)
        )
        const missingResults = batch
          .filter(candidate => !returnedPns.has(compactRelatedArtCandidateNumber(candidate.pn)))
          .map(candidate => ({
            pn: candidate.pn,
            title: candidate.title,
            relevance: 0.5,
            novelty_threat: 'adjacent',
            summary: `The AI relevance response did not include a separate result for this ${candidate.source} candidate; it is retained for user review because it was returned by the patent search stage.`,
            relevant_parts: [],
            irrelevant_parts: [],
            novelty_comparison: 'No candidate-specific AI comparison was returned for this reference.'
          }))
        relevanceData.push(...batchResults, ...missingResults)
        console.log(`Batch ${batchNumber} successful:`, batchResults.length, 'patents analyzed', missingResults.length ? `(${missingResults.length} retained from missing LLM output)` : '')
      } catch (e) {
        console.log(`Batch ${batchNumber} JSON parse failed:`, e instanceof Error ? e.message : String(e))
        // Fallback for this batch
        const fallbackResults = batch.map(c => ({
          pn: c.pn,
          title: c.title,
          relevance: 0.5,
          novelty_threat: 'adjacent',
          summary: 'Basic relevance analysis - detailed analysis failed'
        }))
        relevanceData.push(...fallbackResults)
      }
    } else {
      const fallbackResults = batch.map(c => ({
        pn: c.pn,
        title: c.title,
        relevance: 0.5,
        novelty_threat: 'adjacent',
        summary: 'Basic relevance analysis - AI response was unavailable for this batch'
      }))
      relevanceData.push(...fallbackResults)
    }

    await emitRelatedArtReviewProgress(onProgress, {
      type: 'batch_completed',
      processed: Math.min(i + batch.length, candidates.length),
      total: candidates.length,
      batch: batchNumber,
      totalBatches,
      message: `Analyzed ${Math.min(i + batch.length, candidates.length)} of ${candidates.length} patents`
    })
  }

  console.log('Total relevance analysis completed:', relevanceData.length, 'patents analyzed')

  // If no relevance data was collected, something went wrong with the LLM calls
  if (relevanceData.length === 0) {
    console.error('❌ No relevance data collected from LLM calls')
    return NextResponse.json({
      error: 'AI analysis failed: The AI service did not return any results. This may be due to API limits, network issues, or invalid API keys. Please try again in a few moments.'
    }, { status: 500 })
  }

  // Process relevance results
  for (const r of relevanceData) {
    if (!r || typeof r !== 'object') continue
    const pn = getRelatedArtCandidatePatentNumber(r)
    const t = String(r.title || '').trim()
    const rel = typeof r.relevance === 'number' ? Math.max(0, Math.min(1, r.relevance)) : 0
    const noveltyThreat = (String(r.novelty_threat||'').toLowerCase() as any) || 'remote'

    let sum = String(r.summary || '').trim()
    if (noveltyThreat === 'remote' && (!sum || sum.length === 0)) {
      sum = 'AI found this prior art poses no novelty threat to this invention'
    }
    sum = sum.slice(0, 500)

    // Store complete analysis as JSON in userNotes
    const detailedAnalysis = {
      summary: sum,
      relevant_parts: Array.isArray(r.relevant_parts) ? r.relevant_parts : [],
      irrelevant_parts: Array.isArray(r.irrelevant_parts) ? r.irrelevant_parts : [],
      novelty_comparison: String(r.novelty_comparison || '').trim()
    }

    allDecisions.push({
      pn,
      title: t,
      relevance: rel,
      novelty_threat: noveltyThreat,
      summary: sum,
      detailedAnalysis
    })
  }

  // STEP 2: Idea Generation moved to async Idea Bank Funnel
  // The funnel runs silently in the background after we return results to user
  // This prevents blocking the response and provides better idea quality with validation

  const autoUse: string[] = []
  const tagsFor = (d: typeof allDecisions[number]) => {
    const base = ['AI_REVIEWED']
    if (d.novelty_threat === 'anticipates') base.push('AI_ANTICIPATES')
    else if (d.novelty_threat === 'obvious') base.push('AI_OBVIOUS')
    else if (d.novelty_threat === 'adjacent') base.push('AI_ADJACENT')
    else base.push('AI_REMOTE')
    return base
  }

  await emitRelatedArtReviewProgress(onProgress, {
    type: 'saving',
    processed: candidates.length,
    total: candidates.length,
    batch: totalBatches,
    totalBatches,
    message: 'Saving AI analysis results'
  })

  for (const d of allDecisions) {
    if (!d.pn) continue
    try {
      await (prisma as any).relatedArtSelection.upsert({
        where: { sessionId_patentNumber_runId: { sessionId, patentNumber: d.pn, runId: useRunId } },
        update: { score: d.relevance, tags: tagsFor(d), userNotes: JSON.stringify(d.detailedAnalysis), title: d.title || undefined },
        create: { sessionId, runId: useRunId, patentNumber: d.pn, title: d.title || undefined, score: d.relevance, tags: tagsFor(d), userNotes: JSON.stringify(d.detailedAnalysis) }
      })
    } catch {}
    // Auto-select everything except those that anticipate the invention (very high threat)
    if (d.novelty_threat !== 'anticipates') autoUse.push(d.pn)
  }

  await emitRelatedArtReviewProgress(onProgress, {
    type: 'saved',
    processed: candidates.length,
    total: candidates.length,
    batch: totalBatches,
    totalBatches,
    message: 'AI analysis results saved'
  })

  // Build response - old synchronous idea bank persistence removed
  // Now handled asynchronously by unified Idea Bank Funnel (Stream A, B, C)
  const ideaFunnelEnabled = isIdeaBankGenerationEnabled()

  const response = {
    reviewed: allDecisions.length,
    decisions: allDecisions,
    autoSelect: autoUse,
    runId: useRunId,
    batches: totalBatches,
    // ideaBankSuggestions removed - now generated asynchronously via unified funnel
    ideaFunnelTriggered: ideaFunnelEnabled  // Indicates async idea generation is in progress
  }
  console.log('API Response structure:', {
    reviewed: response.reviewed,
    decisionsCount: response.decisions.length,
    autoSelectCount: response.autoSelect.length,
    runId: response.runId
  })

  if (ideaFunnelEnabled) {
    // Trigger Idea Bank Funnel asynchronously (fire and forget)
    // This runs in the background after returning response to user
    // Ideas are validated through Stream A (Cross-Domain), Stream B (Tech Combinations),
    // and Stream C (Validation Layer) before being persisted to the idea bank
    const funnelInput: IdeaFunnelInput = {
      source: 'drafting_pipeline',
      invention: {
        title: title || 'Untitled Invention',
        abstract: (session?.ideaRecord as any)?.abstract || '',
        claims: claimsText || '',
        features: Array.isArray(frozenClaims) ? frozenClaims.map((c: any) => c.text || '').filter(Boolean) : [],
        searchQuery: query || ''
      },
      priorArtAnalysis: allDecisions
        .filter(d => d.pn && d.relevance >= 0.3) // Only include relevant patents with valid PN
        .map(d => ({
          pn: d.pn || '',
          title: d.title || 'Untitled Patent',
          relevance: typeof d.relevance === 'number' ? d.relevance : 0.5,
          novelty_threat: d.novelty_threat || 'adjacent',
          summary: d.summary || '',
          detailedAnalysis: d.detailedAnalysis || {
            summary: d.summary || '',
            relevant_parts: [],
            irrelevant_parts: [],
            novelty_comparison: ''
          }
        } as PriorArtAnalysisItem)),
      userId: user.id,
      patentId,
      sessionId,
      runId: useRunId,
      requestHeaders
    }

    // Fire and forget - don't await
    console.log('[Prior Art Review] Triggering Idea Bank Funnel asynchronously...')
    ideaBankFunnel.processIdeasAsync(funnelInput).catch(err => {
      console.error('[Prior Art Review] Idea Bank Funnel failed:', err)
    })
  } else {
    console.log('[Prior Art Review] Idea Bank Funnel disabled; skipping idea generation.')
  }

  return NextResponse.json(response)
}
async function handleRunReview(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction: requestedJurisdiction } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' } }, referenceMap: true, figurePlans: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const effectiveJurisdiction = (requestedJurisdiction || session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()
  const preferredLanguage = getPreferredLanguageForJurisdiction(session, effectiveJurisdiction)
  const baseProfile = await getCountryProfile(effectiveJurisdiction)
  const profile = applyPreferredLanguage(baseProfile, preferredLanguage)

  const drafts = Array.isArray(session.annexureDrafts) ? session.annexureDrafts : []
  const last = drafts.find((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)
  if (!last) {
    return NextResponse.json({ error: `No draft found for jurisdiction ${effectiveJurisdiction}` }, { status: 400 })
  }

  const fullText = last?.fullDraftText || [
    last?.fieldOfInvention && `FIELD OF INVENTION\n\n${last.fieldOfInvention}`,
    last?.background && `BACKGROUND\n\n${last.background}`,
    last?.summary && `SUMMARY\n\n${last.summary}`,
    last?.briefDescriptionOfDrawings && `BRIEF DESCRIPTION OF DRAWINGS\n\n${last.briefDescriptionOfDrawings}`,
    last?.detailedDescription && `DETAILED DESCRIPTION\n\n${last.detailedDescription}`,
    last?.bestMethod && `BEST METHOD\n\n${last.bestMethod}`,
    last?.claims && `CLAIMS\n\n${last.claims}`,
    last?.abstract && `ABSTRACT\n\n${last.abstract}`,
    last?.industrialApplicability && `INDUSTRIAL APPLICABILITY\n\n${last.industrialApplicability}`,
    last?.listOfNumerals && `LIST OF REFERENCE NUMERALS\n\n${last.listOfNumerals}`
  ].filter(Boolean).join('\n\n')

  const validation = DraftingService.validateDraftConsistencyPublic({ fullText }, session as any)
  const extended = DraftingService.validateDraftExtended(last || {}, session, profile, effectiveJurisdiction)
  return NextResponse.json({
    validationReport: validation.report,
    isValid: validation.valid,
    extendedReport: extended.report,
    extendedValid: extended.valid
  })
}

// Pre-export normalizer: prepares content blocks with blank space control and color sanitization
function preExportNormalizer(
  content: Record<string, string>,
  sections?: ExportSectionDef[]
): { blocks: Array<{ type: string; section: string; subtype?: string; content: string; blockId: string }> } {
  const blocks: Array<{ type: string; section: string; subtype?: string; content: string; blockId: string }> = []
  let blockCounter = 0

  const order = (sections && sections.length ? sections : defaultExportSections).map(s => ({
    key: s.key,
    section: s.key,
    type: s.key === 'title' ? 'heading' : 'body'
  }))

  for (const { key, section, type } of order) {
    const rawContent = content[key] || ''
    const cleanedContent = sanitizeContent(rawContent)

    if (type === 'heading') {
      blocks.push({
        type: 'heading',
        section,
        content: cleanedContent,
        blockId: `block_${blockCounter++}`
      })
    } else {
      // Split into paragraphs and collapse empty ones
      const paragraphs = cleanedContent.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0)
      for (const para of paragraphs) {
        blocks.push({
          type: 'paragraph',
          section,
          content: para,
          blockId: `block_${blockCounter++}`
        })
      }
    }
  }

  return { blocks }
}

// Sanitize content: remove color styles, collapse whitespace, strip trailing empties
function sanitizeContent(text: string): string {
  if (!text) return ''

  // Remove any color/style markup (basic cleanup for now)
  let cleaned = text.replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI colors
  cleaned = cleaned.replace(/<[^>]*>/g, '') // Remove HTML tags (basic)

  // Normalize whitespace: collapse multiple spaces/newlines
  cleaned = cleaned.replace(/[ \t]+/g, ' ') // Multiple spaces to single
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines

  // Trim leading/trailing whitespace per line
  cleaned = cleaned.split('\n').map(line => line.trim()).join('\n')

  return cleaned.trim()
}

// Country-specific paragraph numbering formats
const PARAGRAPH_NUMBER_FORMATS: Record<string, { prefix: string; suffix: string; digits: number }> = {
  JP: { prefix: '【', suffix: '】', digits: 4 },    // Japan: 【0001】
  DEFAULT: { prefix: '[', suffix: ']', digits: 4 } // Others: [0001]
}

// Get paragraph number format for jurisdiction
function getParagraphNumberFormat(jurisdiction: string): { prefix: string; suffix: string; digits: number } {
  const code = (jurisdiction || 'US').toUpperCase()
  return PARAGRAPH_NUMBER_FORMATS[code] || PARAGRAPH_NUMBER_FORMATS.DEFAULT
}

// Format paragraph number according to jurisdiction
function formatParagraphNumber(num: number, jurisdiction: string): string {
  const format = getParagraphNumberFormat(jurisdiction)
  const paddedNum = num.toString().padStart(format.digits, '0')
  // Plain text numbering (no HTML) so it works for DOCX/PDF generation
  return `${format.prefix}${paddedNum}${format.suffix} `
}

// Paragraph numbering injector: adds jurisdiction-specific numbering to Description sections
// Japan: 【0001】, Others: [0001]
// Sections that should NOT receive paragraph numbering
const EXCLUDED_FROM_NUMBERING = new Set([
  'title',
  'abstract', 
  'claims',
  'listOfNumerals', 'list_of_numerals', 'reference_numerals', 'reference_signs'
])

function injectParagraphNumbering(
  blocks: Array<{ type: string; section: string; subtype?: string; content: string; blockId: string }>,
  jurisdiction: string = 'US',
  sections?: ExportSectionDef[]
): void {
  // Build set of description sections that should be numbered
  // Uses database-defined sections if provided, otherwise uses hardcoded fallback
  let descriptionSections: Set<string>
  
  if (sections && sections.length > 0) {
    // Use database-defined sections, excluding title/abstract/claims/listOfNumerals
    const sectionKeys = sections
      .map(s => s.key)
      .filter(k => !EXCLUDED_FROM_NUMBERING.has(k.toLowerCase()))
    descriptionSections = new Set(sectionKeys)
    console.log(`[injectParagraphNumbering] ${jurisdiction}: Numbering ${sectionKeys.length} sections from database config: ${sectionKeys.join(', ')}`)
  } else {
    // Fallback: hardcoded description sections
    descriptionSections = new Set([
      'fieldOfInvention', 'technical_field', 'field',
      'background', 'background_art',
      'summary', 'summary_of_invention',
      'briefDescriptionOfDrawings', 'brief_description_of_drawings',
      'detailedDescription', 'detailed_description', 'description',
      'bestMethod', 'best_mode',
      'industrialApplicability', 'industrial_applicability',
      'objectsOfInvention', 'objects_of_invention',
      'technicalProblem', 'technical_problem',
      'technicalSolution', 'technical_solution',
      'advantageousEffects', 'advantageous_effects',
      'modeOfCarryingOut', 'mode_of_carrying_out',
      'preamble', 'crossReference', 'cross_reference'
    ])
    console.log(`[injectParagraphNumbering] ${jurisdiction}: Using hardcoded fallback sections for numbering`)
  }

  let paragraphNumber = 1
  const format = getParagraphNumberFormat(jurisdiction)
  
  // Regex to strip existing numbering patterns (all formats)
  const existingNumberRegex = /^(?:\[|\【)\d{3,4}(?:\]|\】)\s*/

  for (const block of blocks) {
    // Only number paragraphs in description sections, exclude headings, captions, tables, equations
    if (block.type === 'paragraph' && descriptionSections.has(block.section) && !block.subtype) {
      // Strip any existing numbering pattern
      if (existingNumberRegex.test(block.content)) {
        block.content = block.content.replace(existingNumberRegex, '')
      }

      // Inject new numbering with appropriate format
      const formattedNumber = formatParagraphNumber(paragraphNumber, jurisdiction)
      block.content = formattedNumber + block.content
      paragraphNumber++
    }
  }
  
  console.log(`[injectParagraphNumbering] ${jurisdiction}: Numbered ${paragraphNumber - 1} paragraphs with format ${format.prefix}XXXX${format.suffix}`)
}

async function handleExportDOCX(user: any, patentId: string, data: any, request?: NextRequest) {
  const { sessionId, jurisdiction: requestedJurisdiction } = data
  // Note: autoNumberParagraphs may be explicitly provided or undefined - we'll use country config as default
  const requestAutoNumberParagraphs = data.autoNumberParagraphs
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  let sessionData = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { 
      annexureDrafts: { orderBy: { version: 'desc' } }, 
      figurePlans: true, 
      diagramSources: true,
      // Include sketches for unified figure sequence
      sketchRecords: {
        where: { isDeleted: false, status: 'SUCCESS' }
      }
    }
  })
  if (!sessionData) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Ensure frozen sequence metadata is present for ordered figures (diagrams + sketches)
  const sequenceMeta = await prisma.draftingSession.findUnique({
    where: { id: sessionId },
    select: { figureSequence: true, figureSequenceFinalized: true }
  })
  const session = {
    ...sessionData,
    figureSequence: sequenceMeta?.figureSequence ?? (sessionData as any).figureSequence,
    figureSequenceFinalized: sequenceMeta?.figureSequenceFinalized ?? (sessionData as any).figureSequenceFinalized
  }
  const figuresSkipped = areFiguresSkipped(session)

  // Determine the active jurisdiction for export (defaults to first selection)
  const fallbackJurisdiction = (session as any).activeJurisdiction || (session as any).draftingJurisdictions?.[0] || 'US'
  const effectiveJurisdiction = String(requestedJurisdiction || fallbackJurisdiction || 'US').toUpperCase()
  const sections = filterDrawingSections(session, await getExportSectionsForJurisdiction(effectiveJurisdiction), section => section.key)

  // Determine preferred figure language for export based on jurisdiction
  const jurisdictionStatus = (session as any).jurisdictionDraftStatus || {}
  const languageMode = jurisdictionStatus.__languageMode
  let preferredFigureLanguage = 'en' // Default
  
  if (languageMode === 'individual_english_figures') {
    preferredFigureLanguage = 'en'
  } else {
    // Check for jurisdiction-specific language, then common language
    const jurisdictionLang = jurisdictionStatus[effectiveJurisdiction]?.language
    if (jurisdictionLang) {
      preferredFigureLanguage = jurisdictionLang
    } else if (jurisdictionStatus.__figuresLanguage) {
      preferredFigureLanguage = jurisdictionStatus.__figuresLanguage
    } else if (jurisdictionStatus.__commonLanguage) {
      preferredFigureLanguage = jurisdictionStatus.__commonLanguage
    }
  }
  console.log(`[ExportDOCX] Using figure language: ${preferredFigureLanguage} for jurisdiction ${effectiveJurisdiction}`)

  // Helper to find best diagram source for a figureNo based on language preference
  const findBestDiagramSourceForExport = (figureNo: number): any => {
    const diagramSources = session.diagramSources || []
    // First try preferred language
    let source = diagramSources.find((d: any) => 
      d.figureNo === figureNo && d.language === preferredFigureLanguage
    )
    // Fallback to English
    if (!source) {
      source = diagramSources.find((d: any) => 
        d.figureNo === figureNo && (!d.language || d.language === 'en')
      )
    }
    // Ultimate fallback
    if (!source) {
      source = diagramSources.find((d: any) => d.figureNo === figureNo)
    }
    return source
  }

  // Load export config early to honor country-specific settings (e.g., addParagraphNumbers)
  const { getExportConfig } = await import('@/lib/jurisdiction-style-service')
  // Use DOCX-specific export config so margins/spacing/numbering follow country defaults
  const exportConfig = await getExportConfig(effectiveJurisdiction, 'spec_docx', user.id, sessionId)

  // Log country-specific export configuration being applied
  console.log(`[ExportDOCX] Jurisdiction ${effectiveJurisdiction} export config:`, {
    source: exportConfig.source,
    fontFamily: exportConfig.fontFamily,
    fontSizePt: exportConfig.fontSizePt,
    lineSpacing: exportConfig.lineSpacing,
    pageSize: exportConfig.pageSize,
    addParagraphNumbers: exportConfig.addParagraphNumbers,
    addPageNumbers: exportConfig.addPageNumbers,
    margins: `${exportConfig.marginTopCm}/${exportConfig.marginBottomCm}/${exportConfig.marginLeftCm}/${exportConfig.marginRightCm} cm`,
    sectionsCount: sections.length,
    sectionOrder: sections.map(s => s.key).join(' → ')
  })

  // Resolve paragraph numbering: use request value if explicitly provided, otherwise fall back to country config
  const autoNumberParagraphs = requestAutoNumberParagraphs !== undefined
    ? requestAutoNumberParagraphs
    : (exportConfig.addParagraphNumbers ?? false)

  const drafts = Array.isArray(session.annexureDrafts) ? session.annexureDrafts : []
  const last = drafts.find((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)
  if (!last) {
    return NextResponse.json({ error: `No draft to export for jurisdiction ${effectiveJurisdiction}` }, { status: 400 })
  }

  // Build figures list respecting frozen sequence order (includes both diagrams and sketches)
  let figuresSorted: Array<{ figureNo: number; title: string; imagePath: string; imageFilename: string; type?: string }> = []
  
  // Debug: Log sketch records loaded for export
  let loadedSketches = (session as any).sketchRecords || []
  console.log(`[ExportDOCX] Session ${sessionId} has ${loadedSketches.length} sketches loaded via session relation`)
  
  // Fallback: If no sketches via session relation, try loading from patent directly
  // This handles cases where sketches were created without sessionId or with a different sessionId
  if (loadedSketches.length === 0) {
    const patentSketches = await prisma.sketchRecord.findMany({
      where: { 
        patentId,
        isDeleted: false,
        status: 'SUCCESS'
      }
    })
    if (patentSketches.length > 0) {
      console.log(`[ExportDOCX] Loaded ${patentSketches.length} sketches from patent directly (session relation was empty)`)
      loadedSketches = patentSketches
    }
  }
  
  if (loadedSketches.length > 0) {
    console.log(`[ExportDOCX] Sketch IDs: ${loadedSketches.map((s: any) => s.id).join(', ')}`)
  }
  
  if ((session as any).figureSequenceFinalized && Array.isArray((session as any).figureSequence) && (session as any).figureSequence.length > 0) {
    // Use the finalized figure sequence
    const figureSequence = (session as any).figureSequence as Array<{ id: string; type: string; sourceId: string; finalFigNo: number }>
    const sequencedSourceIds = new Set(figureSequence.map(s => s.sourceId))

    console.log(`[ExportDOCX] Using finalized sequence with ${figureSequence.length} items`)
    const sketchItems = figureSequence.filter(s => s.type === 'sketch')
    if (sketchItems.length > 0) {
      console.log(`[ExportDOCX] Sequence has ${sketchItems.length} sketches: ${sketchItems.map(s => `sourceId=${s.sourceId}`).join(', ')}`)
    }

    for (const seqItem of figureSequence) {
      if (seqItem.type === 'diagram') {
        const plan = (session!.figurePlans || []).find((f: any) => f.id === seqItem.sourceId)
        // Use language-aware diagram source selection for export
        const ds = plan ? findBestDiagramSourceForExport(plan.figureNo) : null
        if (plan) {
          figuresSorted.push({
            figureNo: seqItem.finalFigNo,
            title: plan.title || `Figure ${seqItem.finalFigNo}`,
            imagePath: (ds?.imagePath as string) || '',
            imageFilename: (ds?.imageFilename as string) || '',
            type: 'diagram'
          })
          if (ds?.language && ds.language !== 'en') {
            console.log(`[ExportDOCX] Using ${ds.language} translation for Figure ${seqItem.finalFigNo}`)
          }
        }
      } else if (seqItem.type === 'sketch') {
        const sketch = loadedSketches.find((s: any) => s.id === seqItem.sourceId)
        console.log(`[ExportDOCX] Looking for sketch sourceId=${seqItem.sourceId}, found: ${!!sketch}, status: ${sketch?.status || 'N/A'}`)
        if (sketch && sketch.status === 'SUCCESS') {
          figuresSorted.push({
            figureNo: seqItem.finalFigNo,
            title: sketch.title || `Figure ${seqItem.finalFigNo}`,
            imagePath: sketch.imagePath || '',
            imageFilename: sketch.imageFilename || '',
            type: 'sketch'
          })
        } else if (!sketch) {
          console.warn(`[ExportDOCX] Sketch not found for sourceId=${seqItem.sourceId}. Available IDs: ${loadedSketches.map((s: any) => s.id).join(', ')}`)
        }
      }
    }
    
    // Auto-append figures added after sequence was finalized
    for (const plan of (session!.figurePlans || [])) {
      if (!sequencedSourceIds.has(plan.id)) {
        // Use language-aware diagram source selection
        const ds = findBestDiagramSourceForExport(plan.figureNo)
        figuresSorted.push({
          figureNo: figuresSorted.length + 1,
          title: plan.title || `Figure ${figuresSorted.length + 1}`,
          imagePath: (ds?.imagePath as string) || '',
          imageFilename: (ds?.imageFilename as string) || '',
          type: 'diagram'
        })
      }
    }
    for (const sketch of ((session as any).sketchRecords || []).filter((s: any) => s.status === 'SUCCESS')) {
      if (!sequencedSourceIds.has(sketch.id)) {
        figuresSorted.push({
          figureNo: figuresSorted.length + 1,
          title: sketch.title || `Figure ${figuresSorted.length + 1}`,
          imagePath: sketch.imagePath || '',
          imageFilename: sketch.imageFilename || '',
          type: 'sketch'
        })
      }
    }
  } else {
    // Fallback: use figurePlans sorted by figureNo (legacy behavior)
    // Also uses language-aware diagram source selection
    figuresSorted = [...(session!.figurePlans||[])].sort((a,b)=>a.figureNo-b.figureNo).map(f => {
      const ds = findBestDiagramSourceForExport(f.figureNo)
      return {
        figureNo: f.figureNo,
        title: f.title || `Figure ${f.figureNo}`,
        imagePath: (ds?.imagePath as string) || '',
        imageFilename: (ds?.imageFilename as string) || '',
        type: 'diagram'
      }
    })
    // Also include sketches in fallback mode
    const sketches = ((session as any).sketchRecords || []).filter((s: any) => s.status === 'SUCCESS')
    let nextFigNo = figuresSorted.length > 0 ? Math.max(...figuresSorted.map(f => f.figureNo)) + 1 : 1
    for (const sketch of sketches) {
      figuresSorted.push({
        figureNo: nextFigNo++,
        title: sketch.title || `Figure ${nextFigNo}`,
        imagePath: sketch.imagePath || '',
        imageFilename: sketch.imageFilename || '',
        type: 'sketch'
      })
    }
  }
  if (figuresSkipped) {
    figuresSorted = []
  }

  // Prepare content for normalization - read from legacy columns and extraSections JSON
  // Handle extraSections being either an object or a JSON string
  let extraSections: Record<string, any> = {}
  const rawExtraSections = (last as any).extraSections
  if (rawExtraSections) {
    if (typeof rawExtraSections === 'string') {
      try {
        extraSections = JSON.parse(rawExtraSections)
      } catch {
        console.warn('[handleExportDOCX] Failed to parse extraSections JSON string')
      }
    } else if (typeof rawExtraSections === 'object') {
      extraSections = rawExtraSections
    }
  }
  const rawContent: Record<string, string> = {}
  
  // Helper to get section content: check legacy column first, then extraSections JSON
  const getSectionContent = (key: string): string => {
    // Legacy columns have priority
    const legacyColumns: Record<string, string | null | undefined> = {
      title: last.title,
      fieldOfInvention: last.fieldOfInvention,
      background: last.background,
      summary: last.summary,
      briefDescriptionOfDrawings: last.briefDescriptionOfDrawings,
      detailedDescription: last.detailedDescription,
      bestMethod: last.bestMethod,
      claims: last.claims,
      abstract: last.abstract,
      industrialApplicability: (last as any).industrialApplicability,
      listOfNumerals: last.listOfNumerals
    }
    
    // Check legacy column first
    if (key in legacyColumns && legacyColumns[key]) {
      return legacyColumns[key] || ''
    }
    
    // Fall back to extraSections JSON for dynamic sections
    if (extraSections && typeof extraSections === 'object' && key in extraSections) {
      return String(extraSections[key] || '')
    }
    
    // Final fallback: try direct property access
    return String((last as any)?.[key] || '')
  }
  
  // Build rawContent in the exact order of sections (database displayOrder)
  for (const s of sections) {
    rawContent[s.key] = s.key === 'title' ? (getSectionContent(s.key) || 'Untitled') : getSectionContent(s.key)
  }

  // Run pre-export normalizer
  const { blocks } = preExportNormalizer(rawContent, sections)

  // Apply paragraph numbering if enabled (jurisdiction-specific format)
  // Pass sections to use database-defined section order for numbering
  if (autoNumberParagraphs) {
    injectParagraphNumbering(blocks, effectiveJurisdiction, sections)
  }

  // Helper to truncate caption to fit one line on A4 (approx 85 chars at 12pt)
  const truncateCaption = (caption: string, maxLen: number = 85): string => {
    // Remove any "Fig. X -" prefix from the caption if present
    let clean = caption.replace(/^(Fig\.?\s*\d+\s*[-:–]\s*)/i, '').trim()
    if (clean.length <= maxLen) return clean
    // Truncate with ellipsis
    return clean.substring(0, maxLen - 3).trim() + '...'
  }

  const exportInput: any = {
    figures: figuresSorted.map(f => {
      const rawCaption = f.title || `Figure ${f.figureNo}`
      return {
        figureNo: f.figureNo,
        caption: truncateCaption(rawCaption),
        imagePath: f.imagePath || '',
        imageFilename: f.imageFilename || '',
        type: f.type || 'diagram'
      }
    }),
    blocks, // Include normalized blocks
    exportOptions: { autoNumberParagraphs },
    sections
  }
  for (const s of sections) {
    exportInput[s.key] = rawContent[s.key] || ''
  }

  const guards = preExportGuards(exportInput, sections)
  // Note: Do not block export on pending issues; proceed regardless

  // Attempt rich DOCX export; fall back to plain text if library unavailable
  try {
    // Try to load docx at runtime without bundler resolution
    let docx: any
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const req = eval('require') as (m: string) => any
      docx = req('docx')
    } catch {
      throw new Error('DOCX_NOT_AVAILABLE')
    }

    const {
      Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType, Media, ImageRun,
      PageBreak, Footer, Header, PageNumber, NumberOfPages, SectionType
    } = docx as any

    // Get document type configuration from country profile with user overrides
    const documentTypeConfig = await getDocumentTypeConfig(effectiveJurisdiction, 'spec_pdf')
    
    // exportConfig was already loaded earlier for paragraph numbering settings

    // Convert cm to twips (1 inch = 1440 twips = 2.54 cm)
    const cmToTwips = (cm: number) => Math.round(cm * 1440 / 2.54)

    // Use export config margins (includes user overrides)
    const margins = {
      top: exportConfig.marginTopCm,
      bottom: exportConfig.marginBottomCm,
      left: exportConfig.marginLeftCm,
      right: exportConfig.marginRightCm
    }

    const pageMargin = {
      top: cmToTwips(margins.top),
      bottom: cmToTwips(margins.bottom),
      left: cmToTwips(margins.left),
      right: cmToTwips(margins.right)
    }

    // Determine page size (convert to twips: A4 = 595.28 x 841.89 pt, LETTER = 612 x 792 pt)
    let pageSize = { width: 595.28, height: 841.89 } // Default A4 in points
    const pageSizeStr = exportConfig.pageSize?.toUpperCase()
    if (pageSizeStr === 'LETTER') {
      pageSize = { width: 612, height: 792 }
    } else if (pageSizeStr === 'A4') {
      pageSize = { width: 595.28, height: 841.89 }
    }

    // Get typography settings from export config (with user overrides)
    const fontFamily = exportConfig.fontFamily || 'Times New Roman'
    const fontSizePt = exportConfig.fontSizePt || 12
    const fontSizeHalfPt = fontSizePt * 2 // docx uses half-points
    const lineSpacing = exportConfig.lineSpacing || 1.5
    const lineSpacingTwips = Math.round(240 * lineSpacing) // 240 twips = single spacing
    
    // Heading font settings (fall back to body font if not specified)
    const headingFontFamily = exportConfig.headingFontFamily || fontFamily
    const headingFontSizePt = exportConfig.headingFontSizePt || (fontSizePt + 2)
    const headingFontSizeHalfPt = headingFontSizePt * 2

    // Build page header/footer based on config
    let headerElement: any = undefined
    let footerElement: any = undefined
    
    // Only add page numbers if configured
    if (exportConfig.addPageNumbers) {
      // Parse page number format - replace {page} and {total} placeholders
      const pageNumberFormat = exportConfig.pageNumberFormat || 'Page {page} of {total}'
      const formatParts = pageNumberFormat.split(/(\{page\}|\{total\})/g)
      
      const pageNumberChildren: any[] = []
      for (const part of formatParts) {
        if (part === '{page}') {
          pageNumberChildren.push(new TextRun({ children: [PageNumber.CURRENT], size: fontSizeHalfPt }))
        } else if (part === '{total}') {
          pageNumberChildren.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], size: fontSizeHalfPt }))
        } else if (part) {
          pageNumberChildren.push(new TextRun({ text: part, size: fontSizeHalfPt, color: '000000' }))
        }
      }
      
      // Determine alignment based on position
      const position = exportConfig.pageNumberPosition || 'header-right'
      const alignment = position.includes('right') ? AlignmentType.RIGHT 
        : position.includes('center') ? AlignmentType.CENTER 
        : AlignmentType.LEFT
      
      const pageNumberParagraph = new Paragraph({
        alignment,
        children: pageNumberChildren
      })
      
      // Place in header or footer based on position
      if (position.startsWith('footer')) {
        footerElement = new Footer({ children: [pageNumberParagraph] })
      } else {
        headerElement = new Header({ children: [pageNumberParagraph] })
      }
    }

    const doc = new Document({
      sections: [],
      styles: {
        default: {
          document: {
            run: {
              size: fontSizeHalfPt,
              font: fontFamily
            }
          }
        },
        paragraphStyles: [
          {
            id: 'bodyStyle',
            name: 'Body',
            basedOn: 'Normal',
            next: 'Normal',
            run: {
              size: fontSizeHalfPt,
              color: '000000', // black
              font: fontFamily
            },
            paragraph: {
              alignment: AlignmentType.JUSTIFIED,
              spacing: {
                line: lineSpacingTwips,
                before: 0,
                after: 120 // 6pt after
              }
            }
          },
          {
            id: 'headingStyle',
            name: 'Heading',
            basedOn: 'Normal',
            next: 'Normal',
            run: {
              size: headingFontSizeHalfPt, // Use heading font size from config
              color: '000000', // black
              bold: true,
              font: headingFontFamily // Use heading font from config
            },
            paragraph: {
              alignment: AlignmentType.LEFT,
              spacing: {
                before: 240, // 12pt before
                after: 120 // 6pt after
              }
            }
          },
          {
            id: 'captionStyle',
            name: 'Caption',
            basedOn: 'Normal',
            next: 'Normal',
            run: {
              size: fontSizeHalfPt,
              color: '000000', // black
              font: fontFamily
            },
            paragraph: {
              alignment: AlignmentType.LEFT,
              spacing: {
                before: 120, // 6pt before
                after: 0
              }
            }
          }
        ]
      }
    })

    // Build document sections using normalized blocks
    const documentSections: any[] = []
    const { blocks, figures, exportOptions } = exportInput

    // Build section properties with dynamic header/footer
    const buildSectionProperties = () => {
      const props: any = {
        type: SectionType.NEXT_PAGE,
        page: {
          margin: pageMargin,
          size: {
            width: Math.round(pageSize.width * 20), // Convert points to twips (1 pt = 20 twips)
            height: Math.round(pageSize.height * 20),
            orientation: pageSize.width > pageSize.height ? docx.PageOrientation.LANDSCAPE : docx.PageOrientation.PORTRAIT
          }
        }
      }
      // Only add headers/footers if page numbers are enabled
      if (headerElement) props.headers = { default: headerElement }
      if (footerElement) props.footers = { default: footerElement }
      return props
    }

    // Section 1: Title
    const titleSection = {
      properties: buildSectionProperties(),
      children: []
    }

    // Add title
    const titleBlock = blocks.find((b: { type: string; section: string; subtype?: string; content: string; blockId: string }) => b.section === 'title')
    if (titleBlock) {
      ;(titleSection.children as any[]).push(
        new Paragraph({
          text: titleBlock.content.toUpperCase(),
          heading: HeadingLevel.HEADING_1,
          style: 'headingStyle'
        })
      )
    }

    // Add body sections in jurisdiction-specific sequence
    const bodySections = sections
      .map(s => s.key)
      .filter(k => k !== 'title' && k !== 'abstract')
    for (const sectionName of bodySections) {
      // Use section heading from export config if available, otherwise fall back to profile
      const sectionHeading = exportConfig.sectionHeadings?.[sectionName] || getSectionHeadingDynamic(sectionName, sections)
      const sectionBlocks = blocks.filter((b: { type: string; section: string; subtype?: string; content: string; blockId: string }) => b.section === sectionName)

      if (sectionBlocks.length > 0) {
        // Add section heading
        ;(titleSection.children as any[]).push(
          new Paragraph({
            text: sectionHeading,
            heading: HeadingLevel.HEADING_2,
            style: 'headingStyle'
          })
        )

        // Add content blocks
        for (const block of sectionBlocks) {
          if (block.type === 'paragraph') {
            let content = block.content


            ;(titleSection.children as any[]).push(
              new Paragraph({
                children: [new TextRun({
                  text: content,
                  size: fontSizeHalfPt, // Use configured font size
                  color: '000000',
                  font: fontFamily // Use configured font family
                })],
                style: 'bodyStyle'
              })
            )
          }
        }
      }
    }

    documentSections.push(titleSection)

    // Add figure sections (one per page)
    const pat = await prisma.patent.findUnique({ where: { id: patentId }, select: { projectId: true } })
    const fs = await import('fs/promises')
    const path = await import('path')

    for (const figure of figures) {
      const figureSection = {
        properties: buildSectionProperties(),
        children: []
      }

      // Try to load and size the image
      let imageElement: any = null
      const candidates: string[] = []
      if (figure.imagePath) {
        // Normalize imagePath (handles absolute paths and /uploads/* stored paths for sketches)
        const normalizedPath = path.isAbsolute(figure.imagePath)
          ? figure.imagePath
          : path.join(process.cwd(), figure.imagePath.replace(/^[/\\]+/, ''))
        candidates.push(normalizedPath)
        if (figure.imagePath.startsWith('/uploads/')) {
          candidates.push(path.join(process.cwd(), 'public', figure.imagePath.replace(/^[/\\]+/, '')))
        }
      }
      if (figure.imageFilename) {
        candidates.push(path.join(process.cwd(), 'uploads', 'patents', patentId, 'figures', figure.imageFilename))
        if (pat?.projectId) candidates.push(path.join(process.cwd(), 'uploads', 'projects', pat.projectId, 'patents', patentId, 'figures', figure.imageFilename))
        // Sketches are stored under public/uploads/sketches
        if (figure.type === 'sketch') {
          candidates.push(path.join(process.cwd(), 'public', 'uploads', 'sketches', figure.imageFilename))
        }
      }

      for (const candidatePath of candidates) {
        if (!candidatePath) continue
        try {
          const imgBuffer = await fs.readFile(candidatePath)

          // Calculate size: preserve aspect ratio
          const img = imgBuffer instanceof Buffer ? new Uint8Array(imgBuffer) : imgBuffer
          
          let width = 500 // default fallback
          let height = 400 // default fallback

          try {
            const dims = imageSize(imgBuffer)
            if (dims.width && dims.height) {
              width = dims.width
              height = dims.height

              // Calculate max width in pixels based on page settings
              // Page width (11906 TWIPS) - 2 * Margin (1440 TWIPS) = 9026 TWIPS available
              // 1440 TWIPS = 1 inch. 
              // Standard docx image resolution is often 96 DPI.
              // Max Width in Pixels = (Available TWIPS / 1440) * 96
              const availableTwips = 11906 - (pageMargin.left + pageMargin.right)
              const maxWidth = Math.floor(availableTwips / 1440 * 96)
              
              if (width > maxWidth) {
                const ratio = maxWidth / width
                width = maxWidth
                height = Math.round(height * ratio)
              }
            }
          } catch (e) {
            console.warn('Failed to calculate image dimensions', e)
          }

          imageElement = new ImageRun({
            data: img,
            transformation: {
              width: width,
              height: height
            }
          })
          break
        } catch (e) {
          // Continue to next candidate
        }
      }

      // Add image if available
      if (imageElement) {
        ;(figureSection.children as any[]).push(
          new Paragraph({
            children: [imageElement],
            alignment: AlignmentType.CENTER
          })
        )
      }

      // Add caption
      ;(figureSection.children as any[]).push(
        new Paragraph({
          children: [new TextRun({
            text: `Figure ${figure.figureNo}: ${figure.caption}`,
            size: fontSizeHalfPt, // Use configured font size
            color: '000000',
            font: fontFamily // Use configured font family
          })],
          style: 'captionStyle'
        })
      )

      documentSections.push(figureSection)
    }

    // Add abstract section at the end (last page) if applicable
    const hasAbstractSection = sections.some(s => s.key === 'abstract')
    if (hasAbstractSection) {
      const abstractSection = {
        properties: buildSectionProperties(),
        children: []
      }

      // Add patent title (repeated on abstract page)
      const titleBlockForAbstract = blocks.find((b: { type: string; section: string; subtype?: string; content: string; blockId: string }) => b.section === 'title')
      if (titleBlockForAbstract) {
        ;(abstractSection.children as any[]).push(
          new Paragraph({
            children: [new TextRun({
              text: titleBlockForAbstract.content,
              size: headingFontSizeHalfPt, // Use configured heading font size
              color: '000000',
              bold: true,
              font: headingFontFamily // Use configured heading font
            })],
            spacing: { after: 120 }
          })
        )
      }

      // Add ABSTRACT heading - use section headings from export config if available
      const abstractHeading = exportConfig.sectionHeadings?.['abstract'] || getSectionHeadingDynamic('abstract', sections)
      ;(abstractSection.children as any[]).push(
        new Paragraph({
          children: [new TextRun({
            text: abstractHeading,
            size: headingFontSizeHalfPt,
            color: '000000',
            bold: true,
            font: headingFontFamily
          })],
          spacing: { before: 120, after: 120 }
        })
      )

      // Add abstract content (no numbering for abstract)
      const abstractBlocks = blocks.filter((b: { type: string; section: string; subtype?: string; content: string; blockId: string }) => b.section === 'abstract')

      for (const block of abstractBlocks) {
        if (block.type === 'paragraph') {
          ;(abstractSection.children as any[]).push(
            new Paragraph({
              children: [new TextRun({
                text: block.content,
                size: fontSizeHalfPt, // Use configured font size
                color: '000000',
                font: fontFamily // Use configured font family
              })],
              style: 'bodyStyle'
            })
          )
        }
      }

      documentSections.push(abstractSection)
    }

    // Add all sections to document
    for (const section of documentSections) {
      doc.addSection(section)
    }

    const buffer = await Packer.toBuffer(doc)
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="annexure_${sessionId}.docx"`
      }
    })
  } catch (e) {
    console.error('DOCX export error:', e)
    // Fallback to plain text packaging when docx is unavailable
    const docContent = buildAnnexurePlainText(exportInput, sections)

    const fileBuffer = Buffer.from(docContent, 'utf8')
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="annexure_${sessionId}.txt"`
      }
    })
  }
}

// PDF Export Handler
async function handleExportPDF(user: any, patentId: string, data: any, request?: NextRequest) {
  const { sessionId, jurisdiction: requestedJurisdiction } = data
  // Note: autoNumberParagraphs may be explicitly provided or undefined - we'll use country config as default
  const requestAutoNumberParagraphs = data.autoNumberParagraphs
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  let session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      annexureDrafts: { orderBy: { version: 'desc' } },
      figurePlans: true,
      diagramSources: true,
      // Include sketches for unified figure sequence
      sketchRecords: {
        where: { isDeleted: false, status: 'SUCCESS' }
      }
    }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Ensure frozen sequence metadata is present for ordered figures (diagrams + sketches)
  const sequenceMeta = await prisma.draftingSession.findUnique({
    where: { id: sessionId },
    select: { figureSequence: true, figureSequenceFinalized: true }
  })
  session = {
    ...session,
    figureSequence: sequenceMeta?.figureSequence ?? (session as any).figureSequence,
    figureSequenceFinalized: sequenceMeta?.figureSequenceFinalized ?? (session as any).figureSequenceFinalized
  }

  // Determine the active jurisdiction for export (defaults to first selection)
  const fallbackJurisdiction = (session as any).activeJurisdiction || (session as any).draftingJurisdictions?.[0] || 'US'
  const effectiveJurisdiction = String(requestedJurisdiction || fallbackJurisdiction || 'US').toUpperCase()
  const sections = filterDrawingSections(session, await getExportSectionsForJurisdiction(effectiveJurisdiction), section => section.key)

  // Load export config early to honor country-specific settings (e.g., addParagraphNumbers)
  const { getExportConfig } = await import('@/lib/jurisdiction-style-service')
  // Use PDF-specific export config so margins/spacing/numbering follow country defaults
  const exportConfig = await getExportConfig(effectiveJurisdiction, 'spec_pdf', user.id, sessionId)

  // Resolve paragraph numbering: use request value if explicitly provided, otherwise fall back to country config
  const autoNumberParagraphs = requestAutoNumberParagraphs !== undefined
    ? requestAutoNumberParagraphs
    : (exportConfig.addParagraphNumbers ?? false)

  const drafts = Array.isArray(session.annexureDrafts) ? session.annexureDrafts : []

  // Fallback: If no sketches via session relation, load from patent directly
  let sessionWithSketches = session as any
  if (!sessionWithSketches.sketchRecords || sessionWithSketches.sketchRecords.length === 0) {
    const patentSketches = await prisma.sketchRecord.findMany({
      where: { 
        patentId,
        isDeleted: false,
        status: 'SUCCESS'
      }
    })
    if (patentSketches.length > 0) {
      console.log(`[ExportPDF] Loaded ${patentSketches.length} sketches from patent directly`)
      sessionWithSketches = { ...session, sketchRecords: patentSketches }
    }
  }

  const last = drafts.find((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)
  if (!last) {
    return NextResponse.json({ error: `No draft to export for jurisdiction ${effectiveJurisdiction}` }, { status: 400 })
  }

  // Prepare content - read from legacy columns and extraSections JSON
  // Handle extraSections being either an object or a JSON string
  let extraSectionsPdf: Record<string, any> = {}
  const rawExtraSectionsPdf = (last as any).extraSections
  if (rawExtraSectionsPdf) {
    if (typeof rawExtraSectionsPdf === 'string') {
      try {
        extraSectionsPdf = JSON.parse(rawExtraSectionsPdf)
      } catch {
        console.warn('[handleExportPDF] Failed to parse extraSections JSON string')
      }
    } else if (typeof rawExtraSectionsPdf === 'object') {
      extraSectionsPdf = rawExtraSectionsPdf
    }
  }
  const rawContent: Record<string, string> = {}
  
  // Helper to get section content: check legacy column first, then extraSections JSON
  const getSectionContent = (key: string): string => {
    const legacyColumns: Record<string, string | null | undefined> = {
      title: last.title,
      fieldOfInvention: last.fieldOfInvention,
      background: last.background,
      summary: last.summary,
      briefDescriptionOfDrawings: last.briefDescriptionOfDrawings,
      detailedDescription: last.detailedDescription,
      bestMethod: last.bestMethod,
      claims: last.claims,
      abstract: last.abstract,
      industrialApplicability: (last as any).industrialApplicability,
      listOfNumerals: last.listOfNumerals
    }
    
    // Check legacy column first
    if (key in legacyColumns && legacyColumns[key]) {
      return legacyColumns[key] || ''
    }
    
    // Fall back to extraSections JSON for dynamic sections
    if (extraSectionsPdf && typeof extraSectionsPdf === 'object' && key in extraSectionsPdf) {
      return String(extraSectionsPdf[key] || '')
    }
    
    // Final fallback: direct property access
    return String((last as any)?.[key] || '')
  }
  
  // Build rawContent in the exact order of sections (database displayOrder)
  for (const s of sections) {
    rawContent[s.key] = s.key === 'title' ? (getSectionContent(s.key) || 'Untitled') : getSectionContent(s.key)
  }

  // Run pre-export normalizer
  const { blocks } = preExportNormalizer(rawContent, sections)

  // Apply paragraph numbering if enabled (jurisdiction-specific format)
  // Pass sections to use database-defined section order for numbering
  if (autoNumberParagraphs) {
    injectParagraphNumbering(blocks, effectiveJurisdiction, sections)
  }

  // Build HTML for PDF (use sessionWithSketches to include fallback-loaded sketches)
  const pdfHtml = buildPDFHtml(rawContent, blocks, sections, effectiveJurisdiction, exportConfig, sessionWithSketches)

  // Try to generate PDF using puppeteer or fall back to HTML
  try {
    let puppeteer: any
    try {
      const req = eval('require') as (m: string) => any
      puppeteer = req('puppeteer')
    } catch {
      // Puppeteer not available - return HTML that can be printed to PDF
      return new NextResponse(pdfHtml, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="annexure_${sessionId}.html"`
        }
      })
    }

    // Launch browser and generate PDF
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    const page = await browser.newPage()
    await page.setContent(pdfHtml, { waitUntil: 'networkidle0' })

    // Get page size and margins from export config (with user overrides)
    const pageSize = exportConfig.pageSize?.toUpperCase() === 'LETTER' ? 'Letter' : 'A4'
    const margins = {
      top: exportConfig.marginTopCm,
      bottom: exportConfig.marginBottomCm,
      left: exportConfig.marginLeftCm,
      right: exportConfig.marginRightCm
    }

    // Build header/footer templates based on config
    const headerTemplate = '<div></div>'
    let footerTemplate = '<div></div>'
    
    // Only add page numbers if configured
    if (exportConfig.addPageNumbers) {
      const position = exportConfig.pageNumberPosition || 'footer-center'
      const format = (exportConfig.pageNumberFormat || 'Page {page} of {total}')
        .replace('{page}', '<span class="pageNumber"></span>')
        .replace('{total}', '<span class="totalPages"></span>')
      
      const alignment = position.includes('right') ? 'right' 
        : position.includes('left') ? 'left' 
        : 'center'
      
      footerTemplate = `
        <div style="font-size: 10px; text-align: ${alignment}; width: 100%; color: #666; padding: 0 20px;">
          ${format}
        </div>
      `
    }

    const pdfBuffer = await page.pdf({
      format: pageSize,
      margin: {
        top: `${margins.top}cm`,
        bottom: `${margins.bottom}cm`,
        left: `${margins.left}cm`,
        right: `${margins.right}cm`
      },
      printBackground: true,
      displayHeaderFooter: exportConfig.addPageNumbers,
      headerTemplate,
      footerTemplate
    })

    await browser.close()

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="annexure_${sessionId}.pdf"`
      }
    })
  } catch (e) {
    console.error('PDF export error:', e)
    // Fallback to HTML that can be printed to PDF
    return new NextResponse(pdfHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="annexure_${sessionId}.html"`
      }
    })
  }
}

// Build HTML for PDF export with country-specific formatting
function buildPDFHtml(
  content: Record<string, string>,
  blocks: Array<{ type: string; section: string; subtype?: string; content: string; blockId: string }>,
  sections: ExportSectionDef[],
  jurisdiction: string,
  exportConfig: any,
  session: any
): string {
  // Use export config settings (with user overrides)
  const margins = {
    top: exportConfig.marginTopCm || 2.5,
    bottom: exportConfig.marginBottomCm || 1.0,
    left: exportConfig.marginLeftCm || 2.5,
    right: exportConfig.marginRightCm || 1.5
  }
  const fontSize = exportConfig.fontSizePt || 12
  const fontFamily = exportConfig.fontFamily || 'Times New Roman, serif'
  const lineHeight = exportConfig.lineSpacing || 1.5
  
  // Heading font settings
  const headingFontFamily = exportConfig.headingFontFamily || fontFamily
  const headingFontSize = exportConfig.headingFontSizePt || (fontSize + 2)

  // Section heading styling based on export config
  const getSectionHeading = (sectionKey: string, label: string) => {
    // Use section heading from export config if available
    const headingText = exportConfig.sectionHeadings?.[sectionKey] || label
    return `<h2 style="font-family: ${headingFontFamily}; font-size: ${headingFontSize}pt; font-weight: bold; margin-top: 24pt; margin-bottom: 12pt; text-transform: uppercase;">${headingText}</h2>`
  }

  // Build body sections
  let bodyHtml = ''
  const orderedSections = sections.filter(s => s.key !== 'title' && s.key !== 'abstract')

  for (const sec of orderedSections) {
    const sectionBlocks = blocks.filter(b => b.section === sec.key)
    if (sectionBlocks.length === 0 && !content[sec.key]?.trim()) continue

    bodyHtml += getSectionHeading(sec.key, sec.label || sec.key)

    for (const block of sectionBlocks) {
      if (block.type === 'paragraph') {
        bodyHtml += `<p style="margin-bottom: 12pt; text-align: justify;">${escapeHtml(block.content)}</p>`
      }
    }
  }

  // Add figures section - use finalized sequence if available, includes both diagrams and sketches
  let figures: Array<{ figureNo: number; title: string }> = []
  
  if (session.figureSequenceFinalized && Array.isArray(session.figureSequence) && session.figureSequence.length > 0) {
    const figureSequence = session.figureSequence as Array<{ id: string; type: string; sourceId: string; finalFigNo: number }>
    for (const seqItem of figureSequence) {
      if (seqItem.type === 'diagram') {
        const plan = (session!.figurePlans || []).find((f: any) => f.id === seqItem.sourceId)
        if (plan) {
          figures.push({ figureNo: seqItem.finalFigNo, title: plan.title || `Figure ${seqItem.finalFigNo}` })
        }
      } else if (seqItem.type === 'sketch') {
        const sketch = (session.sketchRecords || []).find((s: any) => s.id === seqItem.sourceId)
        if (sketch) {
          figures.push({ figureNo: seqItem.finalFigNo, title: sketch.title || `Figure ${seqItem.finalFigNo}` })
        }
      }
    }
  } else {
    // Fallback: use figurePlans sorted by figureNo and append sketches
    figures = [...(session!.figurePlans || [])].sort((a: any, b: any) => a.figureNo - b.figureNo).map((f: any) => ({
      figureNo: f.figureNo,
      title: f.title || `Figure ${f.figureNo}`
    }))
    // Add sketches after diagrams
    const maxFigNo = figures.length > 0 ? Math.max(...figures.map(f => f.figureNo)) : 0
    const sketches = (session.sketchRecords || []).filter((s: any) => s.status === 'SUCCESS')
    for (let i = 0; i < sketches.length; i++) {
      const sketch = sketches[i]
      figures.push({ figureNo: maxFigNo + i + 1, title: sketch.title || `Figure ${maxFigNo + i + 1}` })
    }
  }
  if (areFiguresSkipped(session)) {
    figures = []
  }
  
  if (figures.length > 0) {
    bodyHtml += getSectionHeading('briefDescriptionOfDrawings', 'Drawings / Figures')
    for (const fig of figures) {
      bodyHtml += `<p style="margin-bottom: 6pt;"><strong>Fig. ${fig.figureNo}</strong> — ${escapeHtml(fig.title || '')}</p>`
    }
  }

  // Add abstract at end
  const abstractBlocks = blocks.filter(b => b.section === 'abstract')
  if (abstractBlocks.length > 0 || content.abstract?.trim()) {
    bodyHtml += `<div style="page-break-before: always;"></div>`
    bodyHtml += getSectionHeading('abstract', 'Abstract')
    for (const block of abstractBlocks) {
      if (block.type === 'paragraph') {
        bodyHtml += `<p style="margin-bottom: 12pt; text-align: justify;">${escapeHtml(block.content)}</p>`
      }
    }
  }

  // Full HTML document
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(content.title || 'Patent Annexure')}</title>
  <style>
    @page {
      size: ${exportConfig.pageSize || 'A4'};
      margin: ${margins.top}cm ${margins.right}cm ${margins.bottom}cm ${margins.left}cm;
    }
    body {
      font-family: ${fontFamily};
      font-size: ${fontSize}pt;
      line-height: ${lineHeight};
      color: #000;
      max-width: 100%;
    }
    h1 {
      font-family: ${headingFontFamily};
      font-size: ${headingFontSize + 2}pt;
      font-weight: bold;
      text-align: center;
      margin-bottom: 24pt;
      text-transform: uppercase;
    }
    h2 {
      font-family: ${headingFontFamily};
      font-size: ${headingFontSize}pt;
      font-weight: bold;
      margin-top: 24pt;
      margin-bottom: 12pt;
      text-transform: uppercase;
    }
    p {
      margin-bottom: 12pt;
      text-align: justify;
    }
    .title-block {
      text-align: center;
      margin-bottom: 36pt;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="title-block">
    <h1>${escapeHtml(content.title || 'UNTITLED')}</h1>
    <p style="text-align: center; font-style: italic;">Jurisdiction: ${jurisdiction}</p>
  </div>
  ${bodyHtml}
</body>
</html>`
}

// HTML escape helper
function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>')
}

// Preview export builder and guards
function buildAnnexurePlainText(doc: any, sections?: ExportSectionDef[]): string {
  const H = (s: string) => String(s||'').toUpperCase()
  const orderedSections = (sections && sections.length ? sections : defaultExportSections)
  const SECTIONS: Array<[string, string]> = orderedSections.map(s => [H(s.label || s.key), doc[s.key] || ''])
  const BODY = SECTIONS.filter(([_,v]) => String(v||'').trim()).map(([h,v]) => `${h}\n\n${String(v).trim()}`).join('\n\n')
  const PAGE_BREAK = '\n\n<<<PAGE_BREAK>>>\n\n'
  const DRAWINGS_HEADER = H('Drawings / Figures')
  const figureLines = (doc.figures || [])
    .sort((a:any,b:any)=>a.figureNo-b.figureNo)
    .map((f:any)=>`Fig. ${f.figureNo} - ${String(f.caption||'').replace(/^Fig\.\s*\d+\s*-\s*/i,'')}`)
  if (figureLines.length === 0) return BODY
  const FIGURE_PAGES = [`${DRAWINGS_HEADER}\n\n`, ...figureLines].join(PAGE_BREAK)
  return [BODY, FIGURE_PAGES].filter(Boolean).join(PAGE_BREAK)
}

function preExportGuards(doc: any, sections?: ExportSectionDef[]): { ok: boolean; issues: string[] } {
  const issues: string[] = []
  const orderedSections = (sections && sections.length ? sections : defaultExportSections)
  const req = (key: string, label: string, required?: boolean) => { if (required === false) return; if (!String(doc[key]||'').trim()) issues.push(`Missing: ${label}`) }
  for (const s of orderedSections) {
    req(s.key, s.label || s.key, s.required)
  }

  const hasAbstract = orderedSections.some(s => s.key === 'abstract')
  if (hasAbstract) {
    const absWords = String(doc.abstract||'').trim().split(/\s+/).filter(Boolean).length
    if (absWords>150) issues.push(`Abstract exceeds 150 words (${absWords})`)
  }

  const declared = (doc.figures||[]).map((f:any)=>f.figureNo).sort((a:number,b:number)=>a-b)
  const bdod = String(doc.briefDescriptionOfDrawings||'')
  const hasBDOD = orderedSections.some(s => s.key === 'briefDescriptionOfDrawings')
  if (hasBDOD) {
    if (bdod.trim()) {
      const bdodFigs = Array.from(bdod.matchAll(/\b(Fig\.?|Figure)\s*0*(\d+)\b/gi)).map(m=>Number(m[2])).sort((a,b)=>a-b)
      const missing = declared.filter((n:number)=>!bdodFigs.includes(n))
      if (missing.length) issues.push(`BDOD missing figure lines for: ${missing.join(', ')}`)
    } else if (declared.length) {
      issues.push('BDOD missing while figures are present')
    }
  }

  if (String(doc.listOfNumerals||'').trim()) {
    const nums = Array.from(String(doc.listOfNumerals).matchAll(/\((\d+)\)/g)).map(m=>Number(m[1]))
    const dup = nums.filter((n,i)=>nums.indexOf(n)!==i)
    if (dup.length) issues.push(`Duplicate numerals in list: ${Array.from(new Set(dup)).join(', ')}`)
  }
  return { ok: issues.length===0, issues }
}

async function handlePreviewExport(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction: requestedJurisdiction } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' } }, figurePlans: true, diagramSources: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const jurisdiction = requestedJurisdiction || (session as any).activeJurisdiction || (session as any).draftingJurisdictions?.[0] || 'US'
  const effectiveJurisdiction = String(jurisdiction || 'US').toUpperCase()
  const figuresSkipped = areFiguresSkipped(session)
  const sections = filterDrawingSections(session, await getExportSectionsForJurisdiction(effectiveJurisdiction), section => section.key)

  const drafts = Array.isArray(session.annexureDrafts) ? session.annexureDrafts : []
  const last = drafts.find((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)
  if (!last) {
    return NextResponse.json({ error: `No draft to export for jurisdiction ${effectiveJurisdiction}` }, { status: 400 })
  }

  // Helper to truncate caption to fit one line on A4 (approx 85 chars at 12pt)
  const truncateCaptionPreview = (caption: string, maxLen: number = 85): string => {
    let clean = caption.replace(/^(Fig\.?\s*\d+\s*[-:–]\s*)/i, '').trim()
    if (clean.length <= maxLen) return clean
    return clean.substring(0, maxLen - 3).trim() + '...'
  }

  const exportInput: any = {
    figures: figuresSkipped ? [] : [...(session!.figurePlans||[])].sort((a,b)=>a.figureNo-b.figureNo).map(f=>({
      figureNo: f.figureNo,
      caption: truncateCaptionPreview(f.title || `Figure ${f.figureNo}`),
      imagePathOrBuffer: (session!.diagramSources||[]).find((d:any)=>d.figureNo===f.figureNo)?.imagePath || ''
    })),
    sections
  }
  for (const s of sections) {
    exportInput[s.key] = (last as any)?.[s.key] || ''
  }

  const guards = preExportGuards(exportInput, sections)
  
  // Add word/character limit validation from country profile
  const wordLimitIssues = await validateSectionWordLimits(exportInput, effectiveJurisdiction, sections)
  const allIssues = [...guards.issues, ...wordLimitIssues]
  
  const plain = buildAnnexurePlainText(exportInput, sections)
  return NextResponse.json({ 
    ok: guards.ok && wordLimitIssues.length === 0, 
    issues: allIssues, 
    preview: plain, 
    input: exportInput, 
    sections,
    wordLimitIssues
  })
}

// Validate section word/character limits from country profile
async function validateSectionWordLimits(
  content: Record<string, string>,
  jurisdiction: string,
  sections: ExportSectionDef[]
): Promise<string[]> {
  const issues: string[] = []
  
  try {
    const profile = await getCountryProfile(jurisdiction)
    if (!profile?.profileData?.structure?.variants) return issues
    
    const variant = profile.profileData.structure.variants.find(
      (v: any) => v.id === profile.profileData.structure.defaultVariant
    ) || profile.profileData.structure.variants[0]
    
    if (!variant?.sections) return issues
    
    // Create a map of section limits
    const sectionLimits: Record<string, { maxWords?: number; maxChars?: number; label: string }> = {}
    for (const sec of variant.sections) {
      const keys = [sec.id, ...(sec.canonicalKeys || [])]
      const limits = {
        maxWords: sec.maxWords || sec.maxLengthWords,
        maxChars: sec.maxLengthChars || sec.maxChars,
        label: sec.label || sec.id
      }
      for (const key of keys) {
        sectionLimits[key.toLowerCase()] = limits
        // Also map to internal keys
        const internalKey = canonicalSectionMap[key.toLowerCase()]
        if (internalKey) {
          sectionLimits[internalKey] = limits
        }
      }
    }
    
    // Check each section
    for (const sec of sections) {
      const text = content[sec.key] || ''
      if (!text.trim()) continue
      
      const limits = sectionLimits[sec.key] || sectionLimits[sec.key.toLowerCase()]
      if (!limits) continue
      
      const wordCount = text.split(/\s+/).filter(w => w.length > 0).length
      const charCount = text.length
      
      if (limits.maxWords && wordCount > limits.maxWords) {
        issues.push(`${limits.label || sec.label}: ${wordCount} words exceeds ${limits.maxWords} word limit`)
      }
      
      if (limits.maxChars && charCount > limits.maxChars) {
        issues.push(`${limits.label || sec.label}: ${charCount} characters exceeds ${limits.maxChars} character limit`)
      }
    }
    
    // Special check for Abstract (common requirement: 150 words max)
    const abstractText = content.abstract || ''
    if (abstractText.trim()) {
      const abstractWords = abstractText.split(/\s+/).filter(w => w.length > 0).length
      const abstractLimit = sectionLimits.abstract?.maxWords || 150 // Default 150 for most jurisdictions
      if (abstractWords > abstractLimit) {
        // Only add if not already covered
        if (!issues.some(i => i.includes('Abstract'))) {
          issues.push(`Abstract: ${abstractWords} words exceeds ${abstractLimit} word limit`)
        }
      }
    }
    
  } catch (err) {
    console.warn('[ExportPreview] Word limit validation error:', err)
  }
  
  return issues
}

// Rich preview payload with figure data (for inline HTML preview)
async function handleGetExportPreview(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction: requestedJurisdiction } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { 
      annexureDrafts: { orderBy: { version: 'desc' } }, 
      figurePlans: true, 
      diagramSources: true,
      // Include sketches for unified figure sequence
      sketchRecords: {
        where: { isDeleted: false, status: 'SUCCESS' }
      }
    }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const jurisdiction = requestedJurisdiction || (session as any).activeJurisdiction || (session as any).draftingJurisdictions?.[0] || 'US'
  const effectiveJurisdiction = String(jurisdiction || 'US').toUpperCase()
  const figuresSkipped = areFiguresSkipped(session)
  const sections = filterDrawingSections(session, await getExportSectionsForJurisdiction(effectiveJurisdiction), section => section.key)

  const drafts = Array.isArray(session.annexureDrafts) ? session.annexureDrafts : []
  const last = drafts.find((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)
  if (!last) {
    return NextResponse.json({ error: `No draft to export for jurisdiction ${effectiveJurisdiction}` }, { status: 400 })
  }

  // Helper to truncate caption for export preview (one line max on A4)
  const truncateCaptionForPreview = (caption: string, maxLen: number = 85): string => {
    let clean = caption.replace(/^(Fig\.?\s*\d+\s*[-:–]\s*)/i, '').trim()
    if (clean.length <= maxLen) return clean
    return clean.substring(0, maxLen - 3).trim() + '...'
  }

  // Build figures list respecting frozen sequence order (includes both diagrams and sketches)
  let figures: Array<{ figureNo: number; caption: string; imageUrl: string | null; type?: string }> = []
  
  if ((session as any).figureSequenceFinalized && Array.isArray((session as any).figureSequence) && (session as any).figureSequence.length > 0) {
    // Use the finalized figure sequence (includes both diagrams and sketches in user-defined order)
    const figureSequence = (session as any).figureSequence as Array<{ id: string; type: string; sourceId: string; finalFigNo: number }>
    const sequencedSourceIds = new Set(figureSequence.map(s => s.sourceId))
    
    for (const seqItem of figureSequence) {
      if (seqItem.type === 'diagram') {
        const plan = (session!.figurePlans || []).find((f: any) => f.id === seqItem.sourceId)
        const ds = (session!.diagramSources || []).find((d: any) => d.figureNo === plan?.figureNo)
        if (plan) {
          const hasImage = !!(ds && (ds.imagePath || ds.imageFilename))
          figures.push({
            figureNo: seqItem.finalFigNo,
            caption: truncateCaptionForPreview(plan.title || `Figure ${seqItem.finalFigNo}`),
            imageUrl: hasImage ? `/api/patents/${patentId}/drafting?image=figure&sessionId=${sessionId}&figureNo=${plan.figureNo}` : null,
            type: 'diagram'
          })
        }
      } else if (seqItem.type === 'sketch') {
        const sketch = ((session as any).sketchRecords || []).find((s: any) => s.id === seqItem.sourceId)
        if (sketch && sketch.status === 'SUCCESS') {
          figures.push({
            figureNo: seqItem.finalFigNo,
            caption: truncateCaptionForPreview(sketch.title || `Figure ${seqItem.finalFigNo}`),
            imageUrl: sketch.imagePath || null,
            type: 'sketch'
          })
        }
      }
    }
    
    // Auto-append figures added after sequence was finalized
    for (const plan of (session!.figurePlans || [])) {
      if (!sequencedSourceIds.has(plan.id)) {
        const ds = (session!.diagramSources || []).find((d: any) => d.figureNo === plan.figureNo)
        const hasImage = !!(ds && (ds.imagePath || ds.imageFilename))
        figures.push({
          figureNo: figures.length + 1,
          caption: truncateCaptionForPreview(plan.title || `Figure ${figures.length + 1}`),
          imageUrl: hasImage ? `/api/patents/${patentId}/drafting?image=figure&sessionId=${sessionId}&figureNo=${plan.figureNo}` : null,
          type: 'diagram'
        })
      }
    }
    for (const sketch of ((session as any).sketchRecords || []).filter((s: any) => s.status === 'SUCCESS')) {
      if (!sequencedSourceIds.has(sketch.id)) {
        figures.push({
          figureNo: figures.length + 1,
          caption: truncateCaptionForPreview(sketch.title || `Figure ${figures.length + 1}`),
          imageUrl: sketch.imagePath || null,
          type: 'sketch'
        })
      }
    }
  } else {
    // Fallback: use figurePlans sorted by figureNo (legacy behavior)
    figures = [...(session!.figurePlans||[])].sort((a,b)=>a.figureNo-b.figureNo).map(f=>{
      const ds = (session!.diagramSources||[]).find((d:any)=>d.figureNo===f.figureNo)
      const hasImage = !!(ds && (ds.imagePath || ds.imageFilename))
      const url = hasImage ? `/api/patents/${patentId}/drafting?image=figure&sessionId=${sessionId}&figureNo=${f.figureNo}` : null
      return {
        figureNo: f.figureNo,
        caption: truncateCaptionForPreview(f.title || `Figure ${f.figureNo}`),
        imageUrl: url,
        type: 'diagram'
      }
    })
    // Also include sketches in fallback mode
    const sketches = ((session as any).sketchRecords || []).filter((s: any) => s.status === 'SUCCESS')
    let nextFigNo = figures.length > 0 ? Math.max(...figures.map(f => f.figureNo)) + 1 : 1
    for (const sketch of sketches) {
      figures.push({
        figureNo: nextFigNo++,
        caption: truncateCaptionForPreview(sketch.title || `Figure ${nextFigNo}`),
        imageUrl: sketch.imagePath || null,
        type: 'sketch'
      })
    }
  }
  if (figuresSkipped) {
    figures = []
  }
  
  // Load export config to include in preview response (so frontend can use country defaults)
  const { getExportConfig } = await import('@/lib/jurisdiction-style-service')
  const exportConfig = await getExportConfig(effectiveJurisdiction, 'spec_pdf', user.id, sessionId)
  
  // Build payload with section content - check legacy columns and extraSections JSON
  // Handle extraSections being either an object or a JSON string
  let extraSections: Record<string, any> = {}
  const rawExtraSections = (last as any).extraSections
  if (rawExtraSections) {
    if (typeof rawExtraSections === 'string') {
      try {
        extraSections = JSON.parse(rawExtraSections)
      } catch {
        console.warn('[handleGetExportPreview] Failed to parse extraSections JSON string')
      }
    } else if (typeof rawExtraSections === 'object') {
      extraSections = rawExtraSections
    }
  }
  
  // Helper to get section content: check legacy column first, then extraSections JSON
  const getSectionContent = (key: string): string => {
    const legacyColumns: Record<string, string | null | undefined> = {
      title: last.title,
      fieldOfInvention: last.fieldOfInvention,
      background: last.background,
      summary: last.summary,
      briefDescriptionOfDrawings: last.briefDescriptionOfDrawings,
      detailedDescription: last.detailedDescription,
      bestMethod: last.bestMethod,
      claims: last.claims,
      abstract: last.abstract,
      industrialApplicability: (last as any).industrialApplicability,
      listOfNumerals: last.listOfNumerals
    }
    
    // Check legacy column first
    if (key in legacyColumns && legacyColumns[key]) {
      return legacyColumns[key] || ''
    }
    
    // Fall back to extraSections JSON for dynamic sections
    if (extraSections && typeof extraSections === 'object' && key in extraSections) {
      return String(extraSections[key] || '')
    }
    
    // Final fallback: direct property access
    return String((last as any)?.[key] || '')
  }
  
  const payload: any = { 
    figures, 
    sections,
    // Include export config settings for frontend to use as defaults
    exportConfig: {
      addParagraphNumbers: exportConfig.addParagraphNumbers,
      addPageNumbers: exportConfig.addPageNumbers,
      fontFamily: exportConfig.fontFamily,
      fontSizePt: exportConfig.fontSizePt,
      lineSpacing: exportConfig.lineSpacing,
      marginTopCm: exportConfig.marginTopCm,
      marginBottomCm: exportConfig.marginBottomCm,
      marginLeftCm: exportConfig.marginLeftCm,
      marginRightCm: exportConfig.marginRightCm,
      pageSize: exportConfig.pageSize,
      pageNumberFormat: exportConfig.pageNumberFormat,
      pageNumberPosition: exportConfig.pageNumberPosition,
      source: exportConfig.source
    }
  }
  
  // Add section content to payload in database-defined order
  for (const s of sections) {
    payload[s.key] = getSectionContent(s.key)
  }
  return NextResponse.json(payload)
}

// Whitelist of allowed single-line skinparam keys
// Extended to support canonical patent diagram styles (nodesep, ranksep, thickness, padding, etc.)
// EXPLICITLY BANNED: BackgroundColor, FontColor, Style (except PackageTitleFontStyle), class/component/node skinparams
const ALLOWED_SKINPARAM_KEYS = /^skinparam\s+(monochrome|shadowing|roundcorner|defaultFontName|defaultFontSize|ArrowColor|BorderColor|linetype|nodesep|ranksep|BorderThickness|PackageBorderThickness|PackageTitleFontStyle|RectanglePadding|PackagePadding|ArrowThickness)\b/i

// Explicitly banned skinparam patterns (these are stripped even if they match other patterns)
const BANNED_SKINPARAM_PATTERNS = /^skinparam\s+(BackgroundColor|FontColor|.*Style(?!.*PackageTitleFontStyle))\b/i

// ═══════════════════════════════════════════════════════════════════════════════
// SKINPARAM BLOCK HANDLING - ATOMIC BLOCK PROCESSING
// ═══════════════════════════════════════════════════════════════════════════════
// CRITICAL: Skinparam blocks MUST be processed atomically.
// If a block header is removed, the ENTIRE block body must be removed.
// Partial block survival (orphan BorderStyle/BorderThickness lines) is a hard error.
//
// ALLOWED BLOCK TYPES (for clean patent diagram styling):
//   1. skinparam rectangle { ... }
//   2. skinparam sequence { ... }
//   3. skinparam activity { ... }
//   4. skinparam participant { ... }
//   5. skinparam package { ... }
//
// All other skinparam XXX { ... } blocks are FORBIDDEN and removed atomically.
// ═══════════════════════════════════════════════════════════════════════════════

// Allowed skinparam block types (STRICT):
// - rectangle, activity, participant, package, sequence are allowed for clean patent diagram styling
const ALLOWED_SKINPARAM_BLOCKS = /^skinparam\s+(sequence|activity|rectangle|participant|package)\s*\{/i

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTION-SAFE DIAGRAM GENERATION CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
// These constants enforce the "renderer, not explainer" philosophy.
// The planner's include[] controls generation, except required claim-linked coverage can add approved registry components.
// ═══════════════════════════════════════════════════════════════════════════════

// C3: FORBIDDEN KEYWORD GATE (Critical - triggers regeneration if ANY match)
// If any of these appear in generated PlantUML, the diagram is rejected and regenerated.
// This single gate eliminates most PlantUML failures.
const FORBIDDEN_PLANTUML_KEYWORDS = /\b(if|else|endif|alt|loop|fork|repeat|while|switch|note|box|title|caption)\b/i

// C2: HARD ELEMENT CAPS PER DIAGRAM TYPE (Programmatic enforcement)
// If exceeded: truncate silently. Do NOT repair. Do NOT explain.
const DIAGRAM_HARD_CAPS: Record<string, { maxElements: number; elementType: string }> = {
  BLOCK: { maxElements: 10, elementType: 'rectangles' },
  FLOW: { maxElements: 8, elementType: 'steps' },
  ACTIVITY: { maxElements: 8, elementType: 'actions' },
  SEQUENCE: { maxElements: 5, elementType: 'participants' },
  CONSTITUENT: { maxElements: 10, elementType: 'rectangles' }
}

function buildSupportOrSourceFactBlock(
  normalizedData: any,
  sourceFactLedger: any,
  sectionKey: string,
  supportHeading: string,
  ledgerHeading: string
) {
  return buildSupportDataSourcePromptBlock(normalizedData, sectionKey, supportHeading) ||
    buildSourceFactLedgerPromptBlock(sourceFactLedger, ledgerHeading)
}

// Additional cap for sequence diagram messages
const SEQUENCE_MAX_MESSAGES = 12

// F: FIXED SKINPARAM BLOCK (Pre-injected, LLM never generates skinparams)
// This removes an entire failure class where LLM generates invalid skinparams.
// Uses block-style skinparams for clean white backgrounds on all diagram elements.
const FIXED_SKINPARAM_BLOCK = `skinparam shadowing false
skinparam defaultFontName Arial
skinparam defaultFontSize 12
skinparam ArrowColor #000000
skinparam linetype ortho
skinparam nodesep 30
skinparam ranksep 30
skinparam rectangle {
  BackgroundColor #FFFFFF
  BorderColor #000000
}
skinparam package {
  BackgroundColor #F8F8F8
  BorderColor #000000
}
skinparam activity {
  BackgroundColor #FFFFFF
  BorderColor #000000
}
skinparam participant {
  BackgroundColor #FFFFFF
  BorderColor #000000
}`

// E: PLANTUML SAFE SUBSET - Only these constructs are allowed
// Allowed: @startuml, @enduml, skinparam, rectangle, package, participant, -->, ..>, start, stop, :action;
// Forbidden: note, box, alt, loop, fork, if, else, endif, repeat, while, switch, title, caption

/**
 * C4: Extract component labels from PlantUML code
 * Looks for patterns like "Name (XXX)" in rectangles, participants, AND activity diagram actions.
 * Returns array of normalized component names (e.g., ["Controller (100)", "Sensor (200)"])
 * 
 * Supports all numbering styles:
 * - NUMERIC_BUCKET: "Component (100)", "Component (200)"
 * - STEP_LABEL: "Action (S100)", "Action (S200)"
 * - CONSTITUENT_LABEL: "Ingredient (a)", "Ingredient (b)"
 */
function extractComponentLabels(plantuml: string): string[] {
  const labels: string[] = []
  
  // Universal reference label pattern supporting all numbering styles:
  // - Numeric: (100), (200), (300)
  // - Step labels: (S100), (S200), (S300)
  // - Constituent labels: (a), (b), (c)
  const refLabelPattern = /\((?:\d+|S\d+|[a-z])\)/i
  
  // Match patterns in rectangle, participant, actor definitions (quoted format)
  // Pattern: "Component Name (label)" where label is any valid reference format
  const quotedLabelPattern = /"([^"]+\s*\((?:\d+|S\d+|[a-z])\))"/gi
  let match
  
  while ((match = quotedLabelPattern.exec(plantuml)) !== null) {
    labels.push(match[1].trim())
  }
  
  // Match patterns in activity diagram actions
  // Pattern: :Action text with component (label);
  // This captures the component name and label within the action text
  const activityActionPattern = /:([^;]*\((?:\d+|S\d+|[a-z])\)[^;]*);/gi
  while ((match = activityActionPattern.exec(plantuml)) !== null) {
    // Extract all "word(s) (label)" patterns from the action text
    const actionText = match[1]
    // Match component names followed by any valid reference label format
    const componentPattern = /([A-Za-z][A-Za-z0-9\s]*\s*\((?:\d+|S\d+|[a-z])\))/gi
    let componentMatch
    while ((componentMatch = componentPattern.exec(actionText)) !== null) {
      labels.push(componentMatch[1].trim())
    }
  }
  
  return Array.from(new Set(labels)) // Deduplicate
}

/**
 * C5: Validate that generated diagram uses only components from include[] list
 * Returns validation result with any hallucinated (invented) components.
 */
function validateIncludeList(
  plantuml: string, 
  includeList: string[] | undefined
): { valid: boolean; hallucinated: string[] } {
  // If no include list provided, skip validation
  if (!includeList || includeList.length === 0) {
    return { valid: true, hallucinated: [] }
  }
  
  // Extract actual labels from the generated PlantUML
  const usedLabels = extractComponentLabels(plantuml)
  
  // Normalize include list for comparison (case-insensitive, trim whitespace)
  const normalizedInclude = new Set(
    includeList.map(item => item.trim().toLowerCase())
  )
  
  // Find labels that weren't in the include list (hallucinated components)
  const hallucinated = usedLabels.filter(label => {
    const normalized = label.trim().toLowerCase()
    return !normalizedInclude.has(normalized)
  })
  
  return {
    valid: hallucinated.length === 0,
    hallucinated
  }
}

/**
 * C6: Validate that activity diagrams have reference labels in action steps
 * Supports all numbering styles:
 * - NUMERIC_BUCKET: (100), (200), (300)...
 * - STEP_LABEL: (S100), (S200), (S300)...
 * - CONSTITUENT_LABEL: (a), (b), (c)...
 * Returns validation result with any actions missing reference labels.
 */
function validateActivityNumerals(plantuml: string): { valid: boolean; missingNumerals: string[] } {
  const missingNumerals: string[] = []
  
  // Check if this is an activity diagram (has start/stop or action syntax)
  const isActivityDiagram = /\bstart\b|\bstop\b|^:.*;$/m.test(plantuml)
  if (!isActivityDiagram) {
    return { valid: true, missingNumerals: [] }
  }
  
  // Pattern to match any valid reference label format:
  // - Numeric: (100), (200), (300)...
  // - Step labels: (S100), (S200), (S300)...
  // - Constituent labels: (a), (b), (c)...
  const validReferenceLabelPattern = /\((\d+|S\d+|[a-z])\)/i
  
  // Extract all action lines (lines starting with : and ending with ;)
  const lines = plantuml.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    // Match activity action lines: :Action text;
    if (/^:.*;\s*$/.test(trimmed)) {
      // Check if action has at least one valid reference label in parentheses
      if (!validReferenceLabelPattern.test(trimmed)) {
        // Extract the action text (without : and ;)
        const actionText = trimmed.replace(/^:/, '').replace(/;\s*$/, '').trim()
        missingNumerals.push(actionText)
      }
    }
  }
  
  return {
    valid: missingNumerals.length === 0,
    missingNumerals
  }
}

/**
 * C3: Check if PlantUML contains forbidden keywords
 * This is the critical post-generation gate that triggers regeneration.
 * 
 * IMPORTANT: Only matches keywords used as PlantUML SYNTAX, not inside quoted strings.
 * Words like "loop" and "switch" can appear in component names/labels.
 */
function containsForbiddenKeywords(plantuml: string): { hasForbidden: boolean; matches: string[] } {
  const matches: string[] = []
  const lines = plantuml.split(/\r?\n/)
  
  for (const line of lines) {
    const trimmed = line.trim()
    // Skip comments
    if (trimmed.startsWith("'") || trimmed.startsWith('//')) continue
    
    // Remove all quoted strings from the line before checking for keywords
    // This prevents matching "Feedback Loop" or "Power Switch" in labels
    const lineWithoutQuotes = trimmed
      .replace(/"[^"]*"/g, '""')  // Remove double-quoted strings
      .replace(/'[^']*'/g, "''")  // Remove single-quoted strings (PlantUML notes)
    
    // Check for forbidden keywords only in non-quoted parts
    const match = lineWithoutQuotes.match(FORBIDDEN_PLANTUML_KEYWORDS)
    if (match) {
      matches.push(match[0])
    }
  }
  
  return { hasForbidden: matches.length > 0, matches: Array.from(new Set(matches)) }
}

/**
 * C2: Enforce diagram element caps by truncating
 * Returns truncated PlantUML if over cap, original otherwise.
 * 
 * BRACE-AWARE: When skipping a rectangle with an opening brace,
 * we skip all lines until the matching closing brace to prevent
 * unbalanced braces in the output.
 */
function enforceDiagramCaps(plantuml: string, diagramType: string): string {
  const caps = DIAGRAM_HARD_CAPS[diagramType.toUpperCase()]
  if (!caps) return plantuml
  
  const lines = plantuml.split(/\r?\n/)
  const result: string[] = []
  let elementCount = 0
  let messageCount = 0
  let participantCount = 0
  
  // Brace-aware skipping state for BLOCK/FLOW diagrams
  let skipBraceDepth = 0  // > 0 means we're skipping a braced block
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    // ─────────────────────────────────────────────────────────────────────────
    // BRACE-AWARE SKIPPING: If we're inside a skipped block, track depth
    // ─────────────────────────────────────────────────────────────────────────
    if (skipBraceDepth > 0) {
      // Count brace changes in this line
      for (const char of trimmed) {
        if (char === '{') skipBraceDepth++
        else if (char === '}') skipBraceDepth--
      }
      continue // Skip this line - we're inside a skipped block
    }
    
    // Count and potentially skip elements based on type
    if (diagramType.toUpperCase() === 'BLOCK' || diagramType.toUpperCase() === 'FLOW' || diagramType.toUpperCase() === 'CONSTITUENT') {
      // Count rectangles
      if (/^\s*rectangle\b/i.test(trimmed)) {
        elementCount++
        if (elementCount > caps.maxElements) {
          // Check if this rectangle opens a brace block
          const braceChange = countBraceDepthChange(trimmed)
          if (braceChange > 0) {
            // This rectangle has an opening brace - enter skip mode
            skipBraceDepth = braceChange
          }
          continue // Skip this rectangle line
        }
      }
    } else if (diagramType.toUpperCase() === 'ACTIVITY') {
      // Count actions (lines like :Something;)
      if (/^\s*:.*;\s*$/.test(trimmed)) {
        elementCount++
        if (elementCount > caps.maxElements) continue // Skip excess
      }
    } else if (diagramType.toUpperCase() === 'SEQUENCE') {
      // Count participants
      if (/^\s*(participant|actor)\b/i.test(trimmed)) {
        participantCount++
        if (participantCount > caps.maxElements) continue // Skip excess
      }
      // Count messages
      if (/->|-->|<-|<--/.test(trimmed) && !/^\s*(participant|actor)\b/i.test(trimmed)) {
        messageCount++
        if (messageCount > SEQUENCE_MAX_MESSAGES) continue // Skip excess
      }
    }
    
    result.push(line)
  }
  
  return result.join('\n')
}

/**
 * F: Inject fixed skinparam block into PlantUML code
 * Removes any existing skinparam lines and injects the fixed block.
 */
function injectFixedSkinparams(plantuml: string): string {
  const lines = plantuml.split(/\r?\n/)
  const result: string[] = []
  let skinparamInjected = false
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    // Skip any existing skinparam lines
    if (/^\s*skinparam\b/i.test(trimmed)) continue
    
    // Inject fixed skinparams right after @startuml
    if (trimmed.toLowerCase() === '@startuml' && !skinparamInjected) {
      result.push(line)
      result.push(FIXED_SKINPARAM_BLOCK)
      result.push('')
      skinparamInjected = true
      continue
    }
    
    result.push(line)
  }
  
  return result.join('\n')
}

// Detection pattern for ANY skinparam block start
const SKINPARAM_BLOCK_START = /^skinparam\s+\w+\s*(<<\w+>>)?\s*\{/i

// Helper to count brace depth change for a line
function countBraceDepthChange(line: string): number {
  let delta = 0
  for (const char of line) {
    if (char === '{') delta++
    else if (char === '}') delta--
  }
  return delta
}

// ORPHAN LINE PATTERNS - These lines MUST NOT appear outside a valid skinparam block
// If found after sanitization, it indicates block parsing failure
const ORPHAN_SKINPARAM_BODY_PATTERNS = /^\s*(BorderStyle|BorderThickness|BorderColor|BackgroundColor|FontColor|FontSize|FontStyle|FontName|RoundCorner|Shadowing)\b/i

// Final safety validator - catches any orphan skinparam body lines that leaked through
function validateNoOrphanSkinparamLines(code: string): { valid: boolean; orphanLines: string[] } {
  const lines = code.split(/\r?\n/)
  const orphans: string[] = []
  
  let inValidBlock = false
  let braceDepth = 0
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    // Check for valid skinparam block start
    if (ALLOWED_SKINPARAM_BLOCKS.test(trimmed)) {
      inValidBlock = true
      braceDepth = countBraceDepthChange(trimmed)
      continue
    }
    
    // Track block depth
    if (inValidBlock) {
      braceDepth += countBraceDepthChange(trimmed)
      if (braceDepth <= 0) {
        inValidBlock = false
        braceDepth = 0
      }
      continue
    }
    
    // OUTSIDE any valid block - check for orphan lines
    if (ORPHAN_SKINPARAM_BODY_PATTERNS.test(trimmed)) {
      orphans.push(trimmed)
    }
    
    // Also catch stray closing braces that might indicate block parse failure
    if (/^\s*\}\s*$/.test(trimmed) && !inValidBlock) {
      // Stray closing brace outside any block context - suspicious but not always an error
      // (could be from rectangle definitions, etc.)
    }
  }
  
  return { valid: orphans.length === 0, orphanLines: orphans }
}

// ═══════════════════════════════════════════════════════════════════════════════
// cleanForRendering - Pre-render cleaning with ATOMIC block processing
// ═══════════════════════════════════════════════════════════════════════════════
// CRITICAL: Uses block-level skipping with depth tracking.
// Once a forbidden skinparam block is detected:
//   1. Enter skipBlock mode
//   2. Track { / } depth
//   3. DROP EVERY LINE until matching closing } is consumed
//   4. Do NOT run whitelist logic on inner lines
//   5. Do NOT allow orphan lines like BorderStyle or BorderThickness
// ═══════════════════════════════════════════════════════════════════════════════
function cleanForRendering(code: string): string {
  const lines = code.split(/\r?\n/)
  const result: string[] = []
  
  // Block tracking state
  let inAllowedBlock = false      // Inside an allowed skinparam block
  let skipBlock = false           // SKIP MODE: Inside a forbidden block - drop ALL lines
  let braceDepth = 0              // Current brace nesting depth
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    // ───────────────────────────────────────────────────────────────────────────
    // PRIORITY 1: If we're in SKIP MODE, drop everything until block closes
    // This MUST be checked FIRST to prevent any inner lines from leaking through
    // ───────────────────────────────────────────────────────────────────────────
    if (skipBlock) {
      braceDepth += countBraceDepthChange(trimmed)
      if (braceDepth <= 0) {
        // Block is closed - exit skip mode
        skipBlock = false
        braceDepth = 0
      }
      continue // DROP this line - do not process further, do not add to result
    }
    
    // ───────────────────────────────────────────────────────────────────────────
    // PRIORITY 2: Handle allowed block content
    // ───────────────────────────────────────────────────────────────────────────
    if (inAllowedBlock) {
      braceDepth += countBraceDepthChange(trimmed)
      
      // Allow BackgroundColor and BorderColor inside allowed blocks for clean patent styling
      // Only filter FontColor and other banned patterns
      if (!BANNED_SKINPARAM_PATTERNS.test(trimmed) && 
          !/^\s*(FontColor)\b/i.test(trimmed)) {
        result.push(line)
      }
      
      if (braceDepth <= 0) {
        inAllowedBlock = false
        braceDepth = 0
      }
      continue
    }
    
    // ───────────────────────────────────────────────────────────────────────────
    // Not inside any block - process line normally
    // ───────────────────────────────────────────────────────────────────────────
    
    // Remove title/caption
    if (/^\s*(title|caption)\b/i.test(trimmed)) continue
    
    // Remove forbidden directives
    if (/^\s*!\s*(theme|include|import|pragma)\b/i.test(trimmed)) continue
    
    // ───────────────────────────────────────────────────────────────────────────
    // Handle skinparam block START - ATOMIC processing decision point
    // ───────────────────────────────────────────────────────────────────────────
    if (SKINPARAM_BLOCK_START.test(trimmed)) {
      // Count braces on this header line (not just assume 1)
      const headerBraceChange = countBraceDepthChange(trimmed)
      
      // Check if it's an ALLOWED block type
      if (ALLOWED_SKINPARAM_BLOCKS.test(trimmed)) {
        inAllowedBlock = true
        braceDepth = headerBraceChange
        result.push(line)
        
        // Handle edge case: block opens and closes on same line
        if (braceDepth <= 0) {
          inAllowedBlock = false
          braceDepth = 0
        }
      } else {
        // NOT ALLOWED = FORBIDDEN - enter skip mode and drop ENTIRE block atomically
        skipBlock = true
        braceDepth = headerBraceChange
        
        // Handle edge case: block opens and closes on same line
        if (braceDepth <= 0) {
          skipBlock = false
          braceDepth = 0
        }
        // Do NOT push the header line - it's forbidden
      }
      continue
    }
    
    // Handle single-line skinparam - keep only allowed ones, reject banned ones
    if (/^\s*skinparam\b/i.test(trimmed)) {
      // First check if it's explicitly banned
      if (BANNED_SKINPARAM_PATTERNS.test(trimmed)) {
        continue // Strip banned skinparams
      }
      // Then check if it's in the allowed whitelist
      if (ALLOWED_SKINPARAM_KEYS.test(trimmed)) {
        result.push(line)
      }
      continue
    }
    
    // Keep all other lines
    result.push(line)
  }
  
  // ───────────────────────────────────────────────────────────────────────────
  // FINAL SAFETY CHECK: Verify no orphan skinparam body lines leaked through
  // ───────────────────────────────────────────────────────────────────────────
  const sanitizedOutput = result.join('\n')
  const validation = validateNoOrphanSkinparamLines(sanitizedOutput)
  
  if (!validation.valid) {
    console.error('[cleanForRendering] CRITICAL: Orphan skinparam body lines detected after sanitization:', validation.orphanLines)
    // Filter out orphan lines as emergency fallback
    return result.filter(line => !ORPHAN_SKINPARAM_BODY_PATTERNS.test(line.trim())).join('\n')
  }
  
  return sanitizedOutput
}

// ═══════════════════════════════════════════════════════════════════════════════
// stripFigureCaptionAndBoundary - Remove figure numbers, captions, and outer boundaries
// ═══════════════════════════════════════════════════════════════════════════════
// DETERMINISTIC STRIPPING:
// 1. Removes `title` and `caption` lines (ALL diagram types)
// 2. Removes outermost `rectangle "..." { ... }` boundary wrapper (BLOCK diagrams only)
//    - This catches both "Fig. X Title" and general title wrappers like "Iron Apparatus"
//    - SAFETY: Only removes if the rectangle has NO connections (arrows) to/from it
// 3. Preserves all inner diagram content (nested rectangles, packages, etc.)
// ═══════════════════════════════════════════════════════════════════════════════
function stripFigureCaptionAndBoundary(input: string): string {
  const lines = input.split(/\r?\n/)
  const result: string[] = []
  
  // Pattern to detect outer boundary rectangle wrapper (BLOCK DIAGRAMS)
  // Matches ANY rectangle with a quoted label that opens a block:
  // - rectangle "Fig. 1 Title" {
  // - rectangle "Iron Apparatus" {
  // - rectangle "System Overview" {
  // Does NOT match rectangles with content on same line (those are inline elements)
  const outerBoundaryStartPattern = /^\s*rectangle\s+["']([^"']+)["']\s*\{?\s*$/i
  
  // Detect diagram type to apply correct stripping rules
  const isBlockDiagram = lines.some(line => /^\s*rectangle\b/i.test(line.trim()))
  const isSequenceDiagram = lines.some(line => /^\s*(participant|actor)\b/i.test(line.trim()))
  const isActivityDiagram = lines.some(line => /^\s*(start|stop|:.*;\s*)$/i.test(line.trim()))
  
  // Track if we're inside the outer figure boundary (BLOCK DIAGRAMS ONLY)
  let inOuterBoundary = false
  let outerBoundaryDepth = 0
  let outerBoundaryStartLine = -1
  let outerBoundaryBraceLine = -1  // Track the line with opening brace if separate
  let outerBoundaryLabel = ''      // Store the label to check for connections
  
  // First pass: detect if there's an outer boundary wrapper (BLOCK DIAGRAMS ONLY)
  // We only strip the FIRST/OUTERMOST rectangle that wraps everything
  if (isBlockDiagram && !isSequenceDiagram && !isActivityDiagram) {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      
      // Skip @startuml line
      if (/^@startuml/i.test(trimmed)) continue
      // Skip empty lines
      if (!trimmed) continue
      // Skip skinparam lines
      if (/^\s*skinparam\b/i.test(trimmed)) continue
      // Skip title/caption lines
      if (/^\s*(title|caption)\b/i.test(trimmed)) continue
      
      // First non-trivial line - check if it's an outer boundary wrapper
      const boundaryMatch = trimmed.match(outerBoundaryStartPattern)
      if (boundaryMatch) {
        outerBoundaryLabel = boundaryMatch[1] // Extract the label text
        
        // SAFETY CHECK: Verify this rectangle is NOT connected to any other nodes
        // If it has arrows to/from it, it's part of the diagram design - don't strip
        const labelEscaped = outerBoundaryLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const connectionPattern = new RegExp(
          `(["']${labelEscaped}["']|\\b${labelEscaped}\\b)\\s*(--|->|<-|-->|<--|~>|<~|\\.\\.>|<\\.\\.)|` +
          `(--|->|<-|-->|<--|~>|<~|\\.\\.>|<\\.\\.)\\s*(["']${labelEscaped}["']|\\b${labelEscaped}\\b)`,
          'i'
        )
        
        const hasConnections = lines.some(line => connectionPattern.test(line))
        
        if (hasConnections) {
          // This rectangle is connected to other nodes - it's part of the design, don't strip
          console.log(`[stripFigureCaptionAndBoundary] Keeping outer rectangle "${outerBoundaryLabel}" - has connections`)
          break
        }
        
        outerBoundaryStartLine = i
        // Check if brace is on this line or next line
        if (!trimmed.includes('{')) {
          // Look ahead for the opening brace
          for (let j = i + 1; j < lines.length; j++) {
            const nextTrimmed = lines[j].trim()
            if (nextTrimmed === '{') {
              outerBoundaryBraceLine = j
              break
            }
            if (nextTrimmed) break // Non-empty line that's not {
          }
        }
      }
      break
    }
  }
  
  // Second pass: process lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 1: Strip title/caption lines (ALL diagram types)
    // ─────────────────────────────────────────────────────────────────────────
    if (/^\s*(title|caption)\b/i.test(trimmed)) {
      // Always strip title/caption - they're forbidden anyway
      continue
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // RULE 2: Handle outer boundary rectangle (BLOCK DIAGRAMS ONLY)
    // ─────────────────────────────────────────────────────────────────────────
    if (outerBoundaryStartLine >= 0 && i === outerBoundaryStartLine) {
      // This is the outer boundary start line - skip it
      inOuterBoundary = true
      outerBoundaryDepth = trimmed.includes('{') ? 1 : 0
      continue
    }
    
    // Skip the separate brace line if it exists
    if (outerBoundaryBraceLine >= 0 && i === outerBoundaryBraceLine) {
      outerBoundaryDepth = 1
      continue
    }
    
    // Track brace depth when inside outer boundary
    if (inOuterBoundary) {
      const openBraces = (trimmed.match(/\{/g) || []).length
      const closeBraces = (trimmed.match(/\}/g) || []).length
      outerBoundaryDepth += openBraces - closeBraces
      
      // Check if this is the closing brace of the outer boundary
      if (outerBoundaryDepth <= 0) {
        inOuterBoundary = false
        // If line is ONLY the closing brace, skip it
        if (trimmed === '}') {
          continue
        }
        // Otherwise keep the line (content + brace on same line edge case)
      }
    }
    
    // Keep the line
    result.push(line)
  }
  
  return result.join('\n')
}

// ═══════════════════════════════════════════════════════════════════════════════
// sanitizePlantUML - PRODUCTION-SAFE Sanitization
// ═══════════════════════════════════════════════════════════════════════════════
// CRITICAL CHANGE (Rule F): LLM NEVER generates skinparams anymore.
// We STRIP ALL skinparams here, then inject fixed skinparams via injectFixedSkinparams().
// This eliminates an entire failure class where LLM-generated skinparams cause issues.
//
// Also strips:
// - Forbidden directives: !theme, !include, !import, !pragma
// - title/caption (forbidden per Rule B)
// - note/box (forbidden per Rule B)
// - Incomplete connection lines
// - Figure captions and outer boundaries (via stripFigureCaptionAndBoundary)
// ═══════════════════════════════════════════════════════════════════════════════
function sanitizePlantUML(input: string): string {
  const match = input.match(/@startuml[\s\S]*?@enduml/)
  const block = match ? match[0] : input
  
  // STEP 0: Strip figure captions and outer boundaries FIRST (deterministic)
  const strippedBlock = stripFigureCaptionAndBoundary(block)
  
  const lines = strippedBlock.split(/\r?\n/)
  const result: string[] = []
  
  // Block tracking state for skinparam blocks
  let skipBlock = false           // SKIP MODE: Inside a skinparam block - drop ALL lines
  let braceDepth = 0              // Current brace nesting depth
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    // ───────────────────────────────────────────────────────────────────────────
    // PRIORITY 1: If we're inside a skinparam block, drop everything until block closes
    // ───────────────────────────────────────────────────────────────────────────
    if (skipBlock) {
      braceDepth += countBraceDepthChange(trimmed)
      if (braceDepth <= 0) {
        // Block is closed - exit skip mode
        skipBlock = false
        braceDepth = 0
      }
      continue // DROP this line - do not process further, do not add to result
    }
    
    // ───────────────────────────────────────────────────────────────────────────
    // FORBIDDEN DIRECTIVES (Rule B) - Drop these lines
    // ───────────────────────────────────────────────────────────────────────────
    
    // Skip all skinparam lines (we inject fixed skinparams via injectFixedSkinparams)
    if (/^\s*skinparam\b/i.test(trimmed)) {
      // Check if it's a block start
      if (SKINPARAM_BLOCK_START.test(trimmed)) {
        skipBlock = true
        braceDepth = countBraceDepthChange(trimmed)
        if (braceDepth <= 0) {
          skipBlock = false
          braceDepth = 0
        }
      }
      continue // Drop all skinparam lines
    }
    
    // Skip forbidden directives
    if (/^\s*!\s*(theme|include|import|pragma)\b/i.test(trimmed)) continue
    
    // Skip title/caption (Rule B)
    if (/^\s*(title|caption)\b/i.test(trimmed)) continue
    
    // Skip note/box (Rule B - forbidden constructs)
    if (/^\s*(note|box)\b/i.test(trimmed)) continue
    
    // Skip obviously incomplete connection lines like "500 --"
    if (/^\s*\d+\s*--\s*$/.test(trimmed)) continue
    
    // ───────────────────────────────────────────────────────────────────────────
    // Handle skinparam block START - ALL skinparam blocks are now stripped
    // ───────────────────────────────────────────────────────────────────────────
    if (SKINPARAM_BLOCK_START.test(trimmed)) {
      // Enter skip mode and drop ENTIRE block atomically
      skipBlock = true
      const headerBraceChange = countBraceDepthChange(trimmed)
      braceDepth = headerBraceChange
      
      // Handle edge case: block opens and closes on same line
      if (braceDepth <= 0) {
        skipBlock = false
        braceDepth = 0
      }
      continue // Don't add this line - it's a skinparam block start
    }
    
    // Keep all other lines (non-skinparam, non-forbidden)
    result.push(line)
  }
  
  // ───────────────────────────────────────────────────────────────────────────
  // FINAL SAFETY CHECK: Verify no orphan skinparam body lines leaked through
  // ───────────────────────────────────────────────────────────────────────────
  const sanitizedOutput = result.join('\n')
  const validation = validateNoOrphanSkinparamLines(sanitizedOutput)
  
  if (!validation.valid) {
    console.error('[sanitizePlantUML] CRITICAL: Orphan skinparam body lines detected after sanitization:', validation.orphanLines)
    // Filter out orphan lines as emergency fallback
    return result.filter(line => !ORPHAN_SKINPARAM_BODY_PATTERNS.test(line.trim())).join('\n')
  }
  
  return sanitizedOutput
}

type PlantUmlValidationError = { type: string; message: string; line?: number }

// Lightweight structural/syntax checks that run before hitting PlantUML
function validatePlantUmlStructure(code: string): { ok: boolean; errors: PlantUmlValidationError[] } {
  const errors: PlantUmlValidationError[] = []
  const startCount = (code.match(/@startuml/gi) || []).length
  const endCount = (code.match(/@enduml/gi) || []).length
  if (startCount !== 1 || endCount !== 1) {
    errors.push({ type: 'bounds', message: 'Diagram must contain exactly one @startuml and one @enduml' })
  }

  const lines = code.split(/\r?\n/)
  
  // Detect diagram type for context-aware validation
  const isActivityDiagram = lines.some(line => /^\s*(start|stop|:.*;\s*)$/.test(line))
  const isSequenceDiagram = lines.some(line => /^\s*(participant|actor)\b/i.test(line))
  const isStateDiagram = lines.some(line => /^\s*\[\*\]|state\s+"/i.test(line))
  const isBlockDiagram = lines.some(line => /^\s*rectangle\b/i.test(line))
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // MINIMUM VIABLE CONTENT CHECKS
  // Ensures diagrams have enough substance to be meaningful (prevents blank/tiny diagrams)
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (isBlockDiagram && !isSequenceDiagram && !isActivityDiagram) {
    // Block/pipeline diagram: require at least 3 rectangles and 1 arrow
    // Note: Nested block diagrams (STYLE 1) may have minimal arrows since containment implies relationships
    const rectangleCount = lines.filter(line => /^\s*rectangle\b/i.test(line)).length
    const arrowCount = lines.filter(line => /-->|->|<--|<-|--/.test(line)).length  // Also count undirected '--' edges
    
    if (rectangleCount < 3) {
      errors.push({ type: 'min_content', message: `Block diagram needs at least 3 rectangles (found ${rectangleCount})` })
    }
    if (arrowCount < 1) {
      errors.push({ type: 'min_content', message: `Block diagram needs at least 1 connection (found ${arrowCount})` })
    }
  }
  
  if (isSequenceDiagram) {
    // Sequence diagram: require at least 2 participants/actors and 2 messages
    const participantCount = lines.filter(line => /^\s*(participant|actor)\b/i.test(line)).length
    const messageCount = lines.filter(line => /->|-->|<-|<--/.test(line) && !/^\s*(participant|actor)\b/i.test(line)).length
    
    if (participantCount < 2) {
      errors.push({ type: 'min_content', message: `Sequence diagram needs at least 2 participants/actors (found ${participantCount})` })
    }
    if (messageCount < 2) {
      errors.push({ type: 'min_content', message: `Sequence diagram needs at least 2 messages (found ${messageCount})` })
    }
  }
  
  if (isActivityDiagram) {
    // Activity diagram: require start, stop, and at least 3 action lines
    // Note: This replaces the separate activity_flow checks below to avoid duplicate errors
    const hasStart = lines.some(line => /^\s*start\s*$/i.test(line))
    const hasStop = lines.some(line => /^\s*(stop|end)\s*$/i.test(line))
    const actionCount = lines.filter(line => /^:.*;\s*$/.test(line.trim())).length
    
    if (!hasStart) {
      errors.push({ type: 'min_content', message: 'Activity diagram must have "start"' })
    }
    if (!hasStop) {
      errors.push({ type: 'min_content', message: 'Activity diagram must have "stop" or "end"' })
    }
    if (actionCount < 3) {
      errors.push({ type: 'min_content', message: `Activity diagram needs at least 3 action steps (found ${actionCount})` })
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // Dangling connectors like "A --" or "B -->"
  lines.forEach((line, idx) => {
    const trimmed = line.trim()
    
    // Skip activity diagram action lines (":action;")
    if (/^:.*;\s*$/.test(trimmed)) return
    
    // Check for dangling connectors (but not in activity diagrams where lines may end differently)
    if (!isActivityDiagram) {
      if (/--\s*$/.test(trimmed) || /<[-.]*\s*$/.test(trimmed) || /[-.]*>\s*$/.test(trimmed)) {
        errors.push({ type: 'dangling_connector', message: 'Dangling connector without target', line: idx + 1 })
      }
    }
    
    // Forbidden mix of hidden + direction (applies to all diagram types)
    if (/-\s*\[hidden\][^-]*(?:down|up|left|right)/i.test(trimmed)) {
      errors.push({ type: 'arrow_style', message: 'Do not mix "[hidden]" with directional arrows', line: idx + 1 })
    }
  })

  // Basic block balance checks
  const blockPairs = [
    { start: /^\s*if\s*\(/i, end: /^\s*endif\b/i, name: 'if' },
    { start: /^\s*alt\b/i, end: /^\s*end\s+alt\b/i, name: 'alt' },
    { start: /^\s*loop\b/i, end: /^\s*end\s+loop\b/i, name: 'loop' },
    { start: /^\s*group\b/i, end: /^\s*end\s+group\b/i, name: 'group' },
    { start: /^\s*fork\b/i, end: /^\s*(fork\s+again|end\s+fork)\b/i, name: 'fork', endIncludesForkAgain: true },
    { start: /^\s*note\b(?!\s+(?:left|right|top|bottom)\s+of)/i, end: /^\s*end\s+note\b/i, name: 'note' },
    { start: /^\s*while\s*\(/i, end: /^\s*endwhile\b/i, name: 'while' },
    { start: /^\s*repeat\b/i, end: /^\s*repeat\s+while\b/i, name: 'repeat' },
    { start: /^\s*split\b/i, end: /^\s*end\s+split\b/i, name: 'split' }
  ]
  
  const stack: Array<{ name: string; line: number }> = []
  lines.forEach((line, idx) => {
    const ln = idx + 1
    for (const pair of blockPairs) {
      if (pair.start.test(line)) {
        stack.push({ name: pair.name, line: ln })
      }
      if (pair.end.test(line)) {
        // Handle fork/fork again specially
        if (pair.name === 'fork' && /^\s*fork\s+again\b/i.test(line)) {
          // fork again doesn't close the fork, just continues it
          continue
        }
        const last = stack.pop()
        if (!last || last.name !== pair.name) {
          errors.push({ type: 'block_balance', message: `Unexpected "${line.trim()}"`, line: ln })
          if (last) stack.push(last) // Put it back if we popped wrong one
        }
      }
    }
  })
  
  if (stack.length > 0) {
    for (const unclosed of stack) {
      errors.push({ type: 'block_balance', message: `Unclosed block "${unclosed.name}"`, line: unclosed.line })
    }
  }

  // Activity diagram start/stop balance is checked in min_content section above
  // (consolidated to avoid duplicate error messages)

  // Sequence diagram specific: Check participant definitions
  if (isSequenceDiagram) {
    // Basic check - ensure arrows have valid participants
    const participants = new Set<string>()
    lines.forEach(line => {
      const participantMatch = line.match(/^\s*(?:participant|actor)\s+"?([^"]+)"?\s+as\s+(\w+)/i)
      if (participantMatch) {
        participants.add(participantMatch[2])
      }
      const simpleParticipant = line.match(/^\s*(?:participant|actor)\s+(\w+)/i)
      if (simpleParticipant && !simpleParticipant[0].includes(' as ')) {
        participants.add(simpleParticipant[1])
      }
    })
    // Note: We don't validate all arrow participants since they can be auto-created
  }

  return { ok: errors.length === 0, errors }
}

const extractPlantUmlBlock = (text: string): string => {
  const match = text.match(/@startuml[\s\S]*?@enduml/)
  return match ? match[0] : ''
}

async function attemptRepairPlantUml(
  code: string,
  validationErrors: PlantUmlValidationError[],
  opts: {
    figureTitle?: string
    description?: string
    numerals?: string[]
    plantumlErrorText?: string
    requestHeaders?: Record<string, string>
  } = {}
): Promise<{ ok: boolean; code?: string; repaired: boolean; errors?: PlantUmlValidationError[] }> {
  const errorsText = validationErrors
    .map(e => `${e.type}${e.line ? `@${e.line}` : ''}: ${e.message}`)
    .join('\n')
  const prompt = `You are a PlantUML syntax and patent-policy fixer.
Fix syntax/structure errors and remove forbidden PlantUML logic constructs with the smallest safe edit.
When forbidden logic is present, rewrite it as a simple linear patent-safe diagram.
Do NOT change meaning: no renaming labels, no reordering nodes, no adding/removing components or arrows unless required to make the diagram valid and linear.

STRICT RULES:
- Preserve diagram type (block/sequence/activity/state/constituent). Do NOT convert it.
- Do NOT add !include/!theme/!pragma/title/caption.
- Do NOT add, remove, or modify any skinparam lines.
- Keep all component names and reference numerals exactly as-is.
- Do NOT use if/else/endif, alt, loop, fork, repeat, while, switch, note, or box.
- Do NOT use arrow labels. Use plain arrows only.
- For activity diagrams, use start, at least three :action; lines, and stop.

FIGURE: ${opts.figureTitle || 'Untitled'}
DESCRIPTION: ${opts.description || 'n/a'}
ALLOWED NUMERALS: ${Array.isArray(opts.numerals) && opts.numerals.length ? opts.numerals.join(', ') : 'keep existing numerals; do not invent new ones'}

CURRENT CODE:
${code}

VALIDATION ERRORS:
${errorsText || 'none'}

${opts.plantumlErrorText ? `DIAGRAM SERVER ERROR:\n${opts.plantumlErrorText}` : ''}

Return ONLY corrected diagram code between @startuml and @enduml. No explanations, no extra text.`

  try {
    const request = { headers: opts.requestHeaders || {} }
    const result = await llmGateway.executeLLMOperation(request, {
      taskCode: 'LLM3_DIAGRAM',
      stageCode: 'DRAFT_DIAGRAM_GENERATION', // Reuse diagram generation model configured via central LLM control
      prompt,
      idempotencyKey: crypto.randomUUID(),
      inputTokens: Math.ceil(prompt.length / 4),
      metadata: { purpose: 'plantuml_repair' }
    })
    if (!result.success || !result.response) return { ok: false, repaired: false, errors: validationErrors }
    const repairedBlock = extractPlantUmlBlock(result.response.output || '')
    if (!repairedBlock) return { ok: false, repaired: false, errors: validationErrors }
    const sanitizedRepair = sanitizePlantUML(repairedBlock)
    const forbiddenCheck = containsForbiddenKeywords(sanitizedRepair)
    if (forbiddenCheck.hasForbidden) {
      return {
        ok: false,
        repaired: true,
        errors: forbiddenCheck.matches.map(match => ({
          type: 'forbidden_construct',
          message: `Repair still contains forbidden construct "${match}"`
        }))
      }
    }
    const validation = validatePlantUmlStructure(sanitizedRepair)
    if (!validation.ok) return { ok: false, repaired: true, errors: validation.errors }
    return { ok: true, code: sanitizedRepair, repaired: true }
  } catch (e) {
    console.warn('PlantUML repair attempt failed', e)
    return { ok: false, repaired: false, errors: validationErrors }
  }
}

async function fetchPlantUmlErrorText(baseUrl: string, encoded: string): Promise<string | null> {
  try {
    const resp = await fetch(`${baseUrl}/txt/${encoded}`, { method: 'GET', cache: 'no-store' })
    if (!resp.ok) return null
    const txt = await resp.text()
    const lowered = txt.toLowerCase()
    if (lowered.includes('error') || lowered.includes('syntax')) return txt.slice(0, 2000)
  } catch (e) {
    console.warn('Failed to fetch PlantUML /txt diagnostics', e)
  }
  return null
}

type DiagramProcessingFailure = {
  index?: number
  title?: string
  reason: string
}

function plantUmlErrorsToReason(errors?: PlantUmlValidationError[] | SharedPlantUmlValidationError[]): string {
  if (!errors || errors.length === 0) return 'Unknown PlantUML validation failure'
  return errors.map(e => `${e.type}${e.line ? `@${e.line}` : ''}: ${e.message}`).join('; ')
}

function shouldExposeRepairSummary(summary: RepairSummary): boolean {
  return summary.attempted > 0 || summary.repaired > 0 || summary.failed > 0
}

async function processDiagramWithRepair(
  rawCode: string,
  opts: {
    diagramType?: string
    figureTitle?: string
    description?: string
    numerals?: string[]
    plantumlErrorText?: string
    requestHeaders?: Record<string, string>
    forceRepair?: boolean
  }
) {
  return processGeneratedPlantUml({
    rawCode,
    diagramType: opts.diagramType,
    figureTitle: opts.figureTitle,
    description: opts.description,
    numerals: opts.numerals,
    plantumlErrorText: opts.plantumlErrorText,
    requestHeaders: opts.requestHeaders,
    forceRepair: opts.forceRepair,
    repair: async ({ code, validationErrors, figureTitle, description, numerals, plantumlErrorText, requestHeaders }) => {
      return attemptRepairPlantUml(
        code,
        validationErrors as PlantUmlValidationError[],
        {
          figureTitle,
          description,
          numerals,
          plantumlErrorText,
          requestHeaders
        }
      )
    }
  })
}

function buildDiagramFailureResponse(failedFigures: DiagramProcessingFailure[], repairSummary: RepairSummary) {
  return NextResponse.json({
    error: 'The AI generated invalid diagram code and repair failed. Please simplify the request or remove branching/looping language.',
    failedFigures,
    repairSummary: shouldExposeRepairSummary(repairSummary) ? repairSummary : undefined
  }, { status: 400 })
}

async function handleStartSession(user: any, patentId: string, data: any) {
  // Check if a session already exists
  const existingSession = await prisma.draftingSession.findFirst({
    where: {
      patentId,
      userId: user.id,
      status: { not: 'COMPLETED' }
    }
  });

  if (existingSession) {
    return NextResponse.json({
      session: existingSession,
      message: 'Existing session found'
    });
  }

  // Create new drafting session without preselecting a jurisdiction.
  const session = await prisma.draftingSession.create({
    data: {
      patentId,
      userId: user.id,
      tenantId: user.tenantId
    }
  });

  // If the user had prior sessions for this patent, copy their custom instructions forward
  // so a session reset does not wipe previously saved guidance.
  const priorSession = await prisma.draftingSession.findFirst({
    where: {
      patentId,
      userId: user.id,
      NOT: { id: session.id }
    },
    orderBy: { createdAt: 'desc' }
  })
  if (priorSession) {
    const copied = await cloneInstructionsBetweenSessions(priorSession.id, session.id, user.id)
    if (copied > 0) {
      console.log(`[StartSession] Cloned ${copied} user instructions from session ${priorSession.id} to ${session.id}`)
    }
  }

  return NextResponse.json({ session }, { status: 201 });
}

async function handleUpdateIdeaRecord(user: any, patentId: string, data: any) {
  const { sessionId, patch } = data

  if (!sessionId || !patch || typeof patch !== 'object') {
    return NextResponse.json(
      { error: 'Session ID and patch object are required' },
      { status: 400 }
    )
  }

  // Verify ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true }
  })

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    )
  }

  // Build safe update payload (partial updates allowed)
  const allowedKeys = [
    'problem','objectives','components','logic','inputs','outputs','variants','bestMethod','normalizedData',
    'fieldOfRelevance','subfield','recommendedFocus','complianceNotes','drawingsFocus','claimStrategy','riskFlags','title',
    'rawInput','abstract','cpcCodes','ipcCodes'
  ] as const

  const updateData: Record<string, any> = {}
  for (const key of allowedKeys) {
    if (key in patch) updateData[key] = patch[key]
  }

  // Fetch existing to preserve required fields and normalized JSON
  const existing = await prisma.ideaRecord.findUnique({ where: { sessionId } })

  // Merge edits into normalizedData to keep a single source of truth
  const normalizedMergeKeys = [
    'problem','objectives','components','logic','inputs','outputs','variants','bestMethod',
    'fieldOfRelevance','subfield','recommendedFocus','complianceNotes','drawingsFocus','claimStrategy','riskFlags',
    'abstract','cpcCodes','ipcCodes','scopeRecommendations','supportDataSources','schemaVersion','sourceInputMeta',
    'claimScopeStyle'
  ] as const

  const baseNormalized = (existing?.normalizedData as any) || {}
  const normalizedPatch: Record<string, any> = {}
  normalizedMergeKeys.forEach((k) => {
    if (k in patch) normalizedPatch[k] = (patch as any)[k]
  })
  if (Object.keys(updateData).length === 0 && Object.keys(normalizedPatch).length === 0) {
    return NextResponse.json(
      { error: 'Nothing to update' },
      { status: 400 }
    )
  }
  if ('scopeRecommendations' in normalizedPatch) {
    const coercedScopeRecommendations = coerceScopeRecommendations(
      normalizedPatch.scopeRecommendations,
      { ...baseNormalized, ...normalizedPatch }
    )
    if (coercedScopeRecommendations) {
      normalizedPatch.scopeRecommendations = coercedScopeRecommendations
    } else {
      delete normalizedPatch.scopeRecommendations
    }
  }
  if ('supportDataSources' in normalizedPatch) {
    normalizedPatch.supportDataSources = coerceSupportDataSources(normalizedPatch.supportDataSources)
    normalizedPatch.schemaVersion = 2
  }
  if ('claimScopeStyle' in normalizedPatch) {
    normalizedPatch.claimScopeStyle = normalizePreliminaryClaimScopeStyle(normalizedPatch.claimScopeStyle)
  }
  if ('schemaVersion' in normalizedPatch) {
    normalizedPatch.schemaVersion = 2
  }
  const mergedNormalized = { ...baseNormalized, ...normalizedPatch }

  const ideaRecord = await prisma.ideaRecord.upsert({
    where: { sessionId },
    update: { ...updateData, normalizedData: mergedNormalized },
    create: {
      sessionId,
      title: updateData.title || 'Untitled',
      rawInput: '',
      normalizedData: Object.keys(mergedNormalized).length ? mergedNormalized : {},
      ...updateData
    }
  })

  if ('components' in normalizedPatch || 'scopeRecommendations' in normalizedPatch) {
    await invalidateReferenceMapForStage0Change(
      sessionId,
      'Stage 0 components or scope recommendations changed. Re-save the component plan before using figures.'
    )
  }

  // Persist raw input to disk if provided
  try {
    if (typeof updateData.rawInput === 'string') {
      const fs = await import('fs/promises')
      const path = await import('path')
      const baseDir = path.join(process.cwd(), 'uploads', 'patents', patentId)
      await fs.mkdir(baseDir, { recursive: true })
      const filePath = path.join(baseDir, 'raw-idea.txt')
      await fs.writeFile(filePath, updateData.rawInput, 'utf8')
    }
  } catch (e) {
    console.warn('Failed to persist raw idea to disk:', e)
  }

  return NextResponse.json({ ideaRecord })
}

// ============================================================================
// HELPER: Extract components array from referenceMap
// ============================================================================
// The referenceMap.components field stores { components: [...], numberingStyle: '...' }
// This helper safely extracts the actual components array
function extractComponentsArray(referenceMap: any): any[] {
  if (!referenceMap?.components) return []
  // Handle nested structure: { components: { components: [...], numberingStyle: '...' } }
  if (referenceMap.components.components && Array.isArray(referenceMap.components.components)) {
    return referenceMap.components.components
  }
  // Handle direct array structure: { components: [...] }
  if (Array.isArray(referenceMap.components)) {
    return referenceMap.components
  }
  return []
}

async function invalidateReferenceMapForStage0Change(sessionId: string, reason: string) {
  if (!sessionId) return
  await prisma.referenceMap.updateMany({
    where: { sessionId },
    data: {
      isValid: false,
      validationErrors: [reason] as any
    }
  })
}

// ============================================================================
// PATENT TYPE MANUAL OVERRIDE (Stage 1)
// ============================================================================

/**
 * Handler for manual patent type override.
 * Allows users to correct the LLM-classified invention type (PRODUCT, SYSTEM, PROCESS, COMPOSITION).
 * The patent type is stored on the DraftingSession, not in normalizedData.
 */
async function handleUpdatePatentType(user: any, patentId: string, data: any) {
  const { sessionId, patentType } = data;

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Session ID is required' },
      { status: 400 }
    );
  }

  // Validate patent type
  const validTypes = ['PRODUCT', 'SYSTEM', 'PROCESS', 'COMPOSITION'] as const;
  if (!patentType || !validTypes.includes(patentType)) {
    return NextResponse.json(
      { error: `Invalid patent type. Must be one of: ${validTypes.join(', ')}` },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId.trim(),
      patentId,
      userId: user.id
    },
    include: { ideaRecord: true }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  // Update the patent type on the session
  // Mark as manually overridden so we don't re-classify on component changes
  const existingNormalized = (session.ideaRecord?.normalizedData as any) || {};
  const components = existingNormalized.components || [];
  const logic = existingNormalized.logic || '';
  
  const updatedSession = await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      patentTypePrimary: patentType,
      patentTypeDecidedAt: new Date(),
      // Store current context hash - manual override should persist even if components change
      patentTypeComponentsHash: DraftingService.generatePatentTypeContextHash(components, logic),
      // Mark as manually overridden (store in metadata or a flag field if available)
      // For now, we just update the type - the fact that it's manually set is implied
    }
  });

  console.log(`[handleUpdatePatentType] Patent type manually updated to: ${patentType} for session: ${sessionId}`);

  return NextResponse.json({
    success: true,
    patentTypePrimary: patentType,
    message: `Patent type updated to ${patentType}`
  });
}

// ============================================================================
// CLAIMS GENERATION AND MANAGEMENT HANDLERS (Stage 1)
// ============================================================================

const structuredClaimsToHtml = (claims: any[] | undefined | null): string => {
  if (!Array.isArray(claims)) return ''
  return claims.map((c: any) => {
    const num = typeof c.number === 'number' || typeof c.number === 'string' ? c.number : ''
    return `<p><strong>${num}.</strong> ${stripTrailingClaimDependencyLabel(c.text || '')}</p>`
  }).join('\n')
}

const sanitizeClaimsHtml = (claims?: string | null): string => {
  if (!claims) return ''
  return stripTrailingClaimDependencyLabelsFromHtml(String(claims))
}

const htmlToPlainText = (html?: string | null): string => {
  if (!html) return ''
  try {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  } catch {
    return String(html)
  }
}

const normalizeClaimsForSession = (normalized: Record<string, any> = {}) => {
  return normalizeClaimsForSessionShared(normalized)
}

const getWorkingClaims = (normalized: Record<string, any> = {}) => {
  const snapshot = getEditableClaims(normalized)
  const structured = snapshot.structured
  const html = sanitizeClaimsHtml(snapshot.html) || structuredClaimsToHtml(structured)
  return { structured, html }
}

const CLAIMS_RESET_BLOCKED_DOWNSTREAM_ERROR = 'Claims cannot be reset after downstream stages have started. You can unfreeze or edit claims instead.'
const DEFAULT_GENERATED_CLAIM_LIMIT = DEFAULT_PRELIMINARY_MAX_CLAIMS

function extractExplicitClaimCount(value: unknown): number | null {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return null

  const patterns = [
    /\b(?:generate|draft|prepare|create|write|include|provide|need|want|requires?|limit(?:ed)? to|maximum of|max(?:imum)?|up to|at least|around|approximately|about)\s+(\d{1,3})\s+(?:total\s+)?claims?\b/i,
    /\b(\d{1,3})\s+(?:total\s+)?claims?\b/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const count = Number(match[1])
      if (Number.isInteger(count) && count > 0 && count <= 200) return count
    }
  }

  const numberedClaims = Array.from(text.matchAll(/(?:^|\n|\s)(\d{1,3})\.\s+(?:A|An|The)\b/g))
    .map(match => Number(match[1]))
    .filter(count => Number.isInteger(count) && count > 0 && count <= 200)
  return numberedClaims.length ? Math.max(...numberedClaims) : null
}

function resolveGeneratedClaimLimit(data: any, userInstructions: unknown, userClaimRemarks: unknown) {
  const requested = Number(data?.maxClaims ?? data?.claimCount ?? data?.claimsCount)
  if (Number.isInteger(requested) && requested > 0 && requested <= 200) return requested

  const explicitFromInstructions = extractExplicitClaimCount([
    userInstructions,
    userClaimRemarks,
  ].filter(Boolean).join('\n\n'))
  if (explicitFromInstructions) return explicitFromInstructions

  return DEFAULT_GENERATED_CLAIM_LIMIT
}

function applyGeneratedClaimLimit(params: {
  claims: any[]
  supportMatrix: any[]
  qualityWarnings: string[]
  maxClaims: number | null
}) {
  const { claims, supportMatrix, qualityWarnings, maxClaims } = params
  if (!maxClaims || claims.length <= maxClaims) {
    return { claims, supportMatrix, qualityWarnings, capped: false }
  }

  const limitedClaims = claims.slice(0, maxClaims)
  const keptNumbers = new Set(limitedClaims.map(claim => Number(claim.number)).filter(Number.isFinite))
  return {
    claims: limitedClaims,
    supportMatrix: supportMatrix.filter(item => keptNumbers.has(Number(item?.claimNumber))),
    qualityWarnings: [
      ...qualityWarnings,
      `Generated claim set was capped to ${maxClaims} claims because no higher explicit claim count was requested.`,
    ],
    capped: true,
  }
}

async function handleGenerateClaims(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { 
    sessionId, 
    jurisdiction, 
    ideaContext, 
    userInstructions, 
    usePersonaStyle: usePersonaStyleFromData, 
    personaSelection: personaSelectionFromData,
    acceptPersonaWarnings,
    userClaimRemarks,  // User remarks for claim generation (influences drafting, not patent type)
    claimScopeStyle
  } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  // Verify ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  // Check if claims are already frozen
  const existingNormalized = (session.ideaRecord?.normalizedData as any) || {}
  if (existingNormalized.claimsApprovedAt) {
    return NextResponse.json({ error: 'Claims are frozen. Unfreeze to regenerate.' }, { status: 400 })
  }
  const normalizedClaimScopeStyle = normalizePreliminaryClaimScopeStyle(claimScopeStyle ?? existingNormalized.claimScopeStyle)
  const maxClaims = resolveGeneratedClaimLimit(data, userInstructions, userClaimRemarks)

  // ═══════════════════════════════════════════════════════════════════════════════
  // PATENT TYPE DECISION - from Stage 0 normalization or user override
  // ═══════════════════════════════════════════════════════════════════════════════
  const components = existingNormalized.components || []
  const logic = existingNormalized.logic || ''
  const currentContextHash = DraftingService.generatePatentTypeContextHash(components, logic)
  
  let patentTypePrimary = DraftingService.normalizePatentTypePrimary((session as any).patentTypePrimary)
    || DraftingService.normalizePatentTypePrimary(existingNormalized.patentTypePrimary)
    || DraftingService.patentTypeFallbackFromText(
      session.ideaRecord?.rawInput || `${existingNormalized.problem || ''} ${existingNormalized.logic || ''}`,
      session.ideaRecord?.title || ''
    ).primary
  
  if (!(session as any).patentTypePrimary || !(session as any).patentTypeComponentsHash) {
    await prisma.draftingSession.update({
      where: { id: sessionId },
      data: {
        patentTypePrimary,
        patentTypeDecidedAt: new Date(),
        patentTypeComponentsHash: currentContextHash
      }
    })
  }
  console.log(`[handleGenerateClaims] Using stored patent type: ${patentTypePrimary}`)

  const preferencePatch: Record<string, any> = {}
  if (userClaimRemarks !== undefined) {
    preferencePatch.userClaimRemarks = (userClaimRemarks || '').trim()
  }
  if (claimScopeStyle !== undefined || existingNormalized.claimScopeStyle !== normalizedClaimScopeStyle) {
    preferencePatch.claimScopeStyle = normalizedClaimScopeStyle
  }
  // Save claim-generation preferences if provided. These are descriptive controls, not source facts.
  if (Object.keys(preferencePatch).length > 0) {
    await prisma.ideaRecord.update({
      where: { sessionId },
      data: {
        normalizedData: {
          ...existingNormalized,
          ...preferencePatch
        }
      }
    })
    Object.assign(existingNormalized, preferencePatch)
  }

  try {
    // Get country profile for jurisdiction-specific claim rules
    let requestedJurisdiction = (jurisdiction || session.activeJurisdiction || 'US').toUpperCase()
    let finalJurisdiction = requestedJurisdiction
    
    // Check if the requested jurisdiction has a country profile
    // If not, try to find a fallback jurisdiction from the session's drafting jurisdictions
    const initialProfile = await getCountryProfile(requestedJurisdiction)
    
    if (!initialProfile) {
      console.warn(`[handleGenerateClaims] No profile found for ${requestedJurisdiction}, attempting fallback...`)
      
      const allJurisdictions: string[] = Array.isArray(session.draftingJurisdictions) 
        ? session.draftingJurisdictions.map((j: string) => j.toUpperCase())
        : []
      
      // Find the first jurisdiction that has a valid profile (excluding the failed one)
      for (const j of allJurisdictions) {
        if (j !== requestedJurisdiction) {
          const profile = await getCountryProfile(j)
          if (profile) {
            finalJurisdiction = j
            console.log(`[handleGenerateClaims] Using fallback jurisdiction: ${finalJurisdiction} for claim generation.`)
            break
          }
        }
      }
      
      // If still no valid profile, default to US
      if (finalJurisdiction === requestedJurisdiction) {
        finalJurisdiction = 'US'
        console.log(`[handleGenerateClaims] No valid jurisdiction found. Defaulting to US rules.`)
      }
    }
    
    const activeJurisdiction = finalJurisdiction
    
    // Fetch all profile data in parallel for better performance
    const [countryProfile, mergedClaimsPrompt, baseStyle, claimRulesRaw] = await Promise.all([
      getCountryProfile(activeJurisdiction),
      getDraftingPrompts(activeJurisdiction, 'claims', sessionId),
      getBaseStyle(activeJurisdiction),
      getSectionRules(activeJurisdiction, 'claims')
    ])
    
    // Validate jurisdiction is supported
    if (!countryProfile) {
      console.warn(`[handleGenerateClaims] Unsupported jurisdiction: ${activeJurisdiction}`)
      return NextResponse.json({ 
        error: `Unsupported jurisdiction: ${activeJurisdiction}. Please select a valid jurisdiction.` 
      }, { status: 400 })
    }
    
    // Validate merged prompt is available
    if (!mergedClaimsPrompt?.instruction) {
      console.warn(`[handleGenerateClaims] No claims prompt found for jurisdiction: ${activeJurisdiction}`)
      return NextResponse.json({ 
        error: `Claims drafting configuration not available for ${activeJurisdiction}. Please contact support.` 
      }, { status: 500 })
    }
    
    const claimRules = claimRulesRaw || {}

    const personaConfig = await resolveEffectivePersonaConfig(user, session, {
      usePersonaStyle: usePersonaStyleFromData,
      personaSelection: personaSelectionFromData
    })
    const usePersonaStyle = personaConfig.enabled
    const personaSelection = personaConfig.selection
    if (usePersonaStyle && personaSelection?.primaryPersonaId && !acceptPersonaWarnings) {
      const personaWarnings = await getPersonaCoverageWarnings(user.id, user.tenantId, ['claims'], activeJurisdiction, personaSelection)
      if (personaWarnings.length > 0) return personaCoverageResponse(personaWarnings)
    }

    let writingSampleBlock = ''
    let personaProvenance: Record<string, any> = {
      claims: {
        styleEnabled: usePersonaStyle,
        applied: false,
        source: usePersonaStyle ? 'none' : 'disabled'
      }
    }
    if (usePersonaStyle && user?.id) {
      try {
        const writingSample = await getWritingSample(user.id, 'claims', activeJurisdiction, personaSelection, user.tenantId)
        if (writingSample) {
          writingSampleBlock = buildWritingSampleBlock(writingSample, 'claims')
          personaProvenance.claims = {
            styleEnabled: true,
            applied: true,
            source: writingSample.source || 'persona',
            personaId: writingSample.personaId,
            personaName: writingSample.personaName,
            sampleId: writingSample.sampleId,
            sampleJurisdiction: writingSample.jurisdiction,
            isUniversal: writingSample.isUniversal
          }
          console.log(`[handleGenerateClaims] Writing sample found for claims (persona: ${writingSample.personaName || 'default'})`)
        } else if (personaSelection?.primaryPersonaId) {
          personaProvenance.claims = {
            styleEnabled: true,
            applied: false,
            source: 'none',
            personaId: personaSelection.primaryPersonaId,
            message: 'No claims writing sample found for selected persona.'
          }
          console.warn(`[handleGenerateClaims] Persona style enabled but no sample found for claims (jurisdiction: ${activeJurisdiction})`)
        }
      } catch (err) {
        if (err instanceof PersonaAccessError) return personaAccessResponse(err)
        console.warn('[handleGenerateClaims] Failed to get writing sample:', err)
      }
    }

    // Build context from idea record or provided context. UI edits from Stage 1
    // are preferred, while claim-support fields stay anchored to normalization.
    const idea = session.ideaRecord || {} as any
    const context = {
      title: ideaContext?.title ?? idea.title,
      rawIdea: ideaContext?.rawIdea ?? idea.rawInput ?? '',
      problem: ideaContext?.problem ?? idea.problem ?? existingNormalized.problem,
      objectives: ideaContext?.objectives ?? idea.objectives ?? existingNormalized.objectives,
      logic: ideaContext?.logic ?? idea.logic ?? existingNormalized.logic,
      components: ideaContext?.components ?? idea.components ?? existingNormalized.components,
      bestMethod: ideaContext?.bestMethod ?? idea.bestMethod ?? existingNormalized.bestMethod,
      abstract: ideaContext?.abstract ?? idea.abstract ?? existingNormalized.abstract,
      coreInventiveConcept: ideaContext?.coreInventiveConcept ?? existingNormalized.coreInventiveConcept,
      claimableFeatures: ideaContext?.claimableFeatures ?? existingNormalized.claimableFeatures,
      fallbackLimitations: ideaContext?.fallbackLimitations ?? existingNormalized.fallbackLimitations,
      doNotClaim: ideaContext?.doNotClaim ?? existingNormalized.doNotClaim,
      sourceFactLedger: ideaContext?.sourceFactLedger ?? existingNormalized.sourceFactLedger,
      scopeRecommendations: ideaContext?.scopeRecommendations ?? existingNormalized.scopeRecommendations,
      supportDataSources: ideaContext?.supportDataSources ?? existingNormalized.supportDataSources,
      normalizationReviewWarnings: ideaContext?.normalizationReviewWarnings ?? existingNormalized.normalizationReviewWarnings,
      inventionType: existingNormalized.inventionType,
      patentTypePrimary,
      fieldOfRelevance: ideaContext?.fieldOfRelevance ?? idea.fieldOfRelevance ?? existingNormalized.fieldOfRelevance ?? existingNormalized.field,
      field: ideaContext?.field ?? idea.field ?? existingNormalized.field,
      subfield: ideaContext?.subfield ?? idea.subfield ?? existingNormalized.subfield
    }

    // Build jurisdiction-specific rules block (same logic as buildSectionPrompt in drafting-service)
    const ruleLines: string[] = []
    
    if (claimRules.twoPartFormPreferred === true) {
      ruleLines.push('- Use two-part claim format: preamble + "characterized in that" + characterizing portion')
    } else if (claimRules.twoPartFormPreferred === false) {
      ruleLines.push('- Use single-part claims (avoid two-part "characterized in that" format)')
    }
    
    if (claimRules.allowMultipleDependent === false) {
      ruleLines.push('- Each dependent claim must reference a single prior claim (no multiple dependency)')
    } else if (claimRules.allowMultipleDependent === true) {
      ruleLines.push('- Multiple dependent claims are allowed (can reference multiple prior claims)')
    }
    
    if (Array.isArray(claimRules.preferredConnectors) && claimRules.preferredConnectors.length) {
      ruleLines.push(`- Preferred connectors: ${claimRules.preferredConnectors.join(', ')}`)
    }
    
    if (Array.isArray(claimRules.discouragedConnectors) && claimRules.discouragedConnectors.length) {
      ruleLines.push(`- Discouraged connectors: ${claimRules.discouragedConnectors.join(', ')}`)
    }
    
    if (Array.isArray(claimRules.forbiddenPhrases) && claimRules.forbiddenPhrases.length) {
      ruleLines.push(`- Forbidden phrases: ${claimRules.forbiddenPhrases.join(', ')}`)
    }
    
    if (typeof claimRules.maxIndependentClaimsBeforeExtraFee === 'number') {
      ruleLines.push(`- Keep independent claims ≤ ${claimRules.maxIndependentClaimsBeforeExtraFee} before extra fees`)
    }
    
    if (typeof claimRules.maxTotalClaimsRecommended === 'number') {
      ruleLines.push(`- Recommended total claims ≤ ${claimRules.maxTotalClaimsRecommended}`)
    }
    
    if (claimRules.requireSupportInDescription) {
      ruleLines.push('- Every claim element must be supported in the Detailed Description')
    }
    
    if (claimRules.allowReferenceNumeralsInClaims === false) {
      ruleLines.push('- Do not use reference numerals inside claims')
    } else if (claimRules.allowReferenceNumeralsInClaims === true) {
      ruleLines.push('- You may include reference numerals where helpful')
    }
    
    const rulesBlock = ruleLines.length > 0 ? `JURISDICTION RULES (${activeJurisdiction}):\n${ruleLines.join('\n')}` : ''

    // Build style header
    const countryName = countryProfile?.profileData?.meta?.name || activeJurisdiction
    const officeName = countryProfile?.profileData?.meta?.office || 'Patent Office'
    const tone = baseStyle?.tone || 'technical, neutral, precise'
    const voice = baseStyle?.voice || 'impersonal third person'
    const avoid = Array.isArray(baseStyle?.avoid) ? baseStyle.avoid.join(', ') : 'marketing language, unsupported advantages'

    // Build the merged prompt instruction block
    // The merged prompt already includes any stored user instructions from the DB
    // We only add request-level userInstructions if provided (for regeneration scenarios)
    let baseInstruction = mergedClaimsPrompt.instruction
    if (userInstructions) {
      baseInstruction += `\n\n**User Instructions (Session):**\n${userInstructions}`
    }
    
    const mergedConstraints = mergedClaimsPrompt.constraints || []
    const constraintsBlock = mergedConstraints.length > 0 ? `CONSTRAINTS:\n${mergedConstraints.map(c => `- ${c}`).join('\n')}` : ''

    // Build final prompt from database-managed drafting policy plus runtime context/schema.
    const prompt = buildPreliminaryClaimsPrompt({
      jurisdiction: activeJurisdiction,
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
      userClaimRemarks: existingNormalized.userClaimRemarks,
      claimScopeStyle: normalizedClaimScopeStyle,
      maxClaims,
    })

    // Call LLM to generate claims using the proper gateway API
    const request = { headers: requestHeaders || {} }
    const llmResult = await llmGateway.executeLLMOperation(request, {
      taskCode: 'LLM2_DRAFT',
      stageCode: 'DRAFT_CLAIM_GENERATION', // Use admin-configured model/limits
      prompt,
      idempotencyKey: crypto.randomUUID(),
      inputTokens: Math.ceil(prompt.length / 4),
      metadata: {
        purpose: 'claims_generation',
        jurisdiction: activeJurisdiction,
        sessionId,
        claimScopeStyle: normalizedClaimScopeStyle
      }
    })

    if (!llmResult.success || !llmResult.response) {
      console.error('Claims generation LLM error:', llmResult.error)
      return NextResponse.json({ 
        error: 'Failed to generate claims', 
        details: llmResult.error?.message || 'LLM operation failed' 
      }, { status: 500 })
    }

    // Parse the LLM response. Do not silently save an empty claim set:
    // LLMs sometimes wrap valid claims in markdown/prose or return numbered text instead of JSON.
    let generatedClaims: any[] = []
    let generatedSupportMatrix: any[] = []
    let generatedQualityWarnings: string[] = []
    try {
      const parsedClaimsPayload = parseGeneratedClaimsPayloadFromLLMOutput(llmResult.response.output)
      generatedClaims = parsedClaimsPayload.claims
      generatedSupportMatrix = parsedClaimsPayload.supportMatrix
      generatedQualityWarnings = parsedClaimsPayload.qualityWarnings
    } catch (parseErr) {
      console.error('Failed to parse generated claims:', parseErr)
      console.error('Claims LLM raw output preview:', (llmResult.response.output || '').slice(0, 1200))
      const message = parseErr instanceof DraftClaimsParseError
        ? parseErr.message
        : 'Could not parse generated claims from the LLM response.'
      return NextResponse.json({
        error: message,
        code: 'CLAIMS_PARSE_FAILED'
      }, { status: 502 })
    }

    const limitedClaimsPayload = applyGeneratedClaimLimit({
      claims: generatedClaims,
      supportMatrix: generatedSupportMatrix,
      qualityWarnings: generatedQualityWarnings,
      maxClaims,
    })
    generatedClaims = limitedClaimsPayload.claims
    generatedSupportMatrix = limitedClaimsPayload.supportMatrix
    generatedQualityWarnings = limitedClaimsPayload.qualityWarnings

    // Format claims as HTML for the editor
    const claimsHtml = formatDraftClaimsAsHtml(generatedClaims)
    const claimGenerationQuality = analyzePreliminaryClaimQuality({
      claims: generatedClaims,
      patentTypePrimary,
      context,
      llmSupportMatrix: generatedSupportMatrix,
      llmQualityWarnings: generatedQualityWarnings
    })

    // Save to ideaRecord normalizedData
    const updatedNormalized = {
      ...existingNormalized,
      claims: claimsHtml,
      claimsStructured: generatedClaims,
      claimsProvisional: claimsHtml,
      claimsStructuredProvisional: generatedClaims,
      claimGenerationQuality,
      claimScopeStyle: normalizedClaimScopeStyle,
      maxClaimsRequested: maxClaims,
      claimsCappedToDefault: limitedClaimsPayload.capped,
      claimsJurisdiction: activeJurisdiction,
      claimsGeneratedAt: new Date().toISOString()
    }

    await prisma.ideaRecord.update({
      where: { sessionId },
      data: { normalizedData: updatedNormalized }
    })

    return NextResponse.json({
      claims: generatedClaims,
      claimsHtml,
      claimGenerationQuality,
      jurisdiction: activeJurisdiction,
      claimScopeStyle: normalizedClaimScopeStyle,
      maxClaims,
      claimsCappedToDefault: limitedClaimsPayload.capped,
      patentType: patentTypePrimary, // Return patent type for UI display
      personaStyleApplied: Object.values(personaProvenance).some((p: any) => p?.applied),
      personaProvenance,
      personaWarnings: [],
      tokensUsed: (llmResult.response?.outputTokens || 0) + Math.ceil(prompt.length / 4)
    })

  } catch (error) {
    if (error instanceof PersonaAccessError) return personaAccessResponse(error)
    console.error('Claims generation error:', error)
    return NextResponse.json({ error: 'Failed to generate claims' }, { status: 500 })
  }
}

async function handleSaveClaims(user: any, patentId: string, data: any) {
  const { sessionId, claims, claimsStructured } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  // Verify ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  // Check if claims are frozen
  const existingNormalized = (session.ideaRecord?.normalizedData as any) || {}
  if (existingNormalized.claimsApprovedAt) {
    return NextResponse.json({ error: 'Claims are frozen. Unfreeze to edit.' }, { status: 400 })
  }

  // Update claims in normalizedData
  const nextClaims = sanitizeClaimsHtml(claims || existingNormalized.claims)
  const nextStructured = claimsStructured || existingNormalized.claimsStructured
  const updatedNormalized: Record<string, any> = {
    ...existingNormalized,
    claims: nextClaims,
    claimsStructured: nextStructured,
    claimsLastSavedAt: new Date().toISOString()
  }

  // Keep provisional copy in sync until claims are frozen
  if (!existingNormalized.claimsApprovedAt) {
    updatedNormalized.claimsProvisional = nextClaims
    updatedNormalized.claimsStructuredProvisional = nextStructured
  }

  await prisma.ideaRecord.update({
    where: { sessionId },
    data: { normalizedData: updatedNormalized }
  })

  return NextResponse.json({ success: true, savedAt: updatedNormalized.claimsLastSavedAt })
}

async function handleResetClaims(user: any, patentId: string, data: any) {
  const { sessionId } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  if (!session.ideaRecord) {
    return NextResponse.json({ error: 'Idea record not found for this session' }, { status: 404 })
  }

  const existingNormalized = (session.ideaRecord.normalizedData as any) || {}
  const [
    relatedArtRunCount,
    relatedArtSelectionCount,
    referenceMapCount,
    figurePlanCount,
    annexureDraftCount,
  ] = await Promise.all([
    prisma.relatedArtRun.count({ where: { sessionId } }),
    prisma.relatedArtSelection.count({ where: { sessionId } }),
    prisma.referenceMap.count({ where: { sessionId } }),
    prisma.figurePlan.count({ where: { sessionId } }),
    prisma.annexureDraft.count({ where: { sessionId } }),
  ])

  const downstreamStarted = shouldBlockPreliminaryClaimReset({
    status: session.status,
    normalizedData: existingNormalized,
    relatedArtRunCount,
    relatedArtSelectionCount,
    referenceMapCount,
    figurePlanCount,
    annexureDraftCount,
  })

  if (downstreamStarted) {
    return NextResponse.json({
      error: CLAIMS_RESET_BLOCKED_DOWNSTREAM_ERROR,
      code: 'CLAIMS_RESET_BLOCKED_DOWNSTREAM'
    }, { status: 400 })
  }

  const resetAt = new Date().toISOString()
  const resetNormalized = resetPreliminaryClaimFields(existingNormalized)

  await prisma.$transaction([
    prisma.ideaRecord.update({
      where: { sessionId },
      data: { normalizedData: resetNormalized }
    }),
    prisma.draftingSession.update({
      where: { id: sessionId },
      data: { patentTypeFrozenAt: null } as any
    })
  ])

  return NextResponse.json({ success: true, resetAt })
}

async function loadSessionForDDEvidenceSelection(sessionId: string, patentId: string, userId: string) {
  const sessionData = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true,
      diagramSources: true,
      sketchRecords: {
        where: { isDeleted: false, status: 'SUCCESS' }
      }
    }
  })
  if (!sessionData) return null
  const sequenceMeta = await prisma.draftingSession.findUnique({
    where: { id: sessionId },
    select: { figureSequence: true, figureSequenceFinalized: true }
  })
  return {
    ...sessionData,
    figureSequence: sequenceMeta?.figureSequence ?? (sessionData as any).figureSequence,
    figureSequenceFinalized: sequenceMeta?.figureSequenceFinalized ?? (sessionData as any).figureSequenceFinalized
  }
}

async function ensureDDEvidenceSelectionBestEffort(
  sessionId: string,
  patentId: string,
  user: any,
  requestHeaders: Record<string, string>,
  jurisdiction?: string,
  force = false
) {
  try {
    const session = await loadSessionForDDEvidenceSelection(sessionId, patentId, user.id)
    if (!session) return null
    return await ensureDetailedDescriptionSourceSelection({
      session,
      jurisdiction,
      requestHeaders,
      tenantId: user.tenantId,
      force,
    })
  } catch (error) {
    console.warn('[DD Evidence] Best-effort source selection failed:', error)
    return null
  }
}

function queueDDEvidenceSelectionBestEffort(
  sessionId: string,
  patentId: string,
  user: any,
  requestHeaders: Record<string, string>,
  jurisdiction?: string,
  force = false
) {
  const run = async () => {
    const result = await ensureDDEvidenceSelectionBestEffort(
      sessionId,
      patentId,
      user,
      requestHeaders,
      jurisdiction,
      force
    )
    if (result?.selection) {
      console.log('[DD Evidence] Background source selection completed:', {
        sessionId,
        jurisdiction: result.selection.jurisdiction,
        status: result.selection.status,
        selectedCount: result.selection.selectedSources?.length || 0,
        guardrailCount: result.selection.guardrailSources?.length || 0,
        usedCache: result.usedCache
      })
    }
  }

  setTimeout(() => {
    void run().catch(error => {
      console.warn('[DD Evidence] Background source selection failed:', error)
    })
  }, 0)
}

async function handleFreezeClaims(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, claims, claimsStructured, jurisdiction, skipPriorArt, useInitialClaimsForDrafting } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  // Verify ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const existingNormalized = (session.ideaRecord?.normalizedData as any) || {}
  
  // Get current patent type from session (will be frozen alongside claims)
  const patentTypePrimary = (session as any).patentTypePrimary
  
  // Validate claims content
  const claimsContent = sanitizeClaimsHtml(claims || existingNormalized.claims || existingNormalized.claimsFinal || existingNormalized.claimsProvisional)
  if (!claimsContent || (typeof claimsContent === 'string' && claimsContent.trim() === '')) {
    return NextResponse.json({ error: 'Cannot freeze empty claims' }, { status: 400 })
  }

  // Freeze claims
  const now = new Date().toISOString()
  const effectiveStructured = claimsStructured || existingNormalized.claimsStructured || existingNormalized.claimsStructuredFinal || existingNormalized.claimsStructuredProvisional
  const updatedNormalized: Record<string, any> = {
    ...existingNormalized,
    claims: claimsContent,
    claimsStructured: effectiveStructured,
    claimsApprovedAt: now,
    claimsApprovedBy: user.id,
    claimsJurisdiction: jurisdiction || existingNormalized.claimsJurisdiction || session.activeJurisdiction || 'US'
  }

  // Preserve provisional copies
  if (!existingNormalized.claimsProvisional) {
    updatedNormalized.claimsProvisional = claimsContent
  }
  if (!existingNormalized.claimsStructuredProvisional && effectiveStructured) {
    updatedNormalized.claimsStructuredProvisional = effectiveStructured
  }

  // Always store finals from current working version
  updatedNormalized.claimsFinal = claimsContent
  updatedNormalized.claimsStructuredFinal = effectiveStructured

  // Track refinement source when skipping prior art to signal downstream that no references exist
  if (skipPriorArt || useInitialClaimsForDrafting) {
    updatedNormalized.claimsRefinementSource = {
      mode: 'SKIPPED',
      usedManualPriorArt: false,
      autoRunId: null,
      skipPriorArt: true,
      finalizedAt: now
    }
  }

  await prisma.ideaRecord.update({
    where: { sessionId },
    data: { normalizedData: updatedNormalized }
  })

  // Freeze patent type alongside claims (locked together)
  if (patentTypePrimary) {
    await prisma.draftingSession.update({
      where: { id: sessionId },
      data: {
        patentTypeFrozenAt: new Date()
      }
    })
  }

  queueDDEvidenceSelectionBestEffort(
    sessionId,
    patentId,
    user,
    requestHeaders,
    updatedNormalized.claimsJurisdiction,
    true
  )

  return NextResponse.json({
    success: true,
    frozenAt: updatedNormalized.claimsApprovedAt,
    jurisdiction: updatedNormalized.claimsJurisdiction,
    patentType: patentTypePrimary, // Return frozen patent type
    ddEvidenceSelection: {
      status: 'queued',
      background: true
    }
  })
}

async function handleUnfreezeClaims(user: any, patentId: string, data: any) {
  const { sessionId } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  // Verify ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const existingNormalized = (session.ideaRecord?.normalizedData as any) || {}

  // Remove freeze flags but keep the claims content
  const { claimsApprovedAt, claimsApprovedBy, ...restNormalized } = existingNormalized

  await prisma.ideaRecord.update({
    where: { sessionId },
    data: { normalizedData: restNormalized }
  })

  return NextResponse.json({ success: true, unfrozenAt: new Date().toISOString() })
}

async function handleClaimRefinementPreview(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const {
    sessionId,
    useAuto = true,
    useManual = false,
    selectedPatents = [],
    runId,
    additionalInstructions,
    usePersonaStyle: usePersonaStyleFromData,
    personaSelection: personaSelectionFromData,
    acceptPersonaWarnings
  } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      ideaRecord: true,
      relatedArtRuns: { orderBy: { ranAt: 'desc' }, take: 1 },
      relatedArtSelections: true,
      referenceMap: true
    }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const normalized = normalizeClaimsForSession((session.ideaRecord?.normalizedData as any) || {})
  const working = getWorkingClaims(normalized)
  const provisionalHtml = normalized.claimsProvisional || working.html
  const provisionalStructured = normalized.claimsStructuredProvisional || working.structured

  if (!provisionalHtml || provisionalHtml.trim() === '') {
    return NextResponse.json({ error: 'No claims available for refinement. Provide or generate claims first.' }, { status: 400 })
  }

  const claimRefinementConfig = (session.priorArtConfig as any)?.claimRefinementConfig || {}
  const claimRefSelected = Array.isArray(claimRefinementConfig?.selectedPatents) ? claimRefinementConfig.selectedPatents : []

  // Auto prior art references (obvious/anticipates)
  const selections: any[] = Array.isArray(session.relatedArtSelections) ? session.relatedArtSelections : []
  const selectionMap = new Map<string, any>()
  selections.forEach((s: any) => {
    const pn = typeof s?.patentNumber === 'string' ? s.patentNumber.trim() : ''
    if (pn) selectionMap.set(pn, s)
  })
  const mergedClaimRefSelections = claimRefSelected
    .map((p: any) => {
      const pn = String(p?.patentNumber || p?.pn || p?.publication_number || p?.publicationNumber || p?.id || '').trim()
      if (!pn) return null
      const mapped = selectionMap.get(pn) || {}
      return { ...mapped, ...p, patentNumber: pn, title: p?.title || mapped?.title || 'Untitled' }
    })
    .filter(Boolean) as any[]

  const preferredAuto = new Set(
    (Array.isArray(selectedPatents) ? selectedPatents : [])
      .map((p: any) => typeof p === 'string' ? p : p?.patentNumber)
      .filter(Boolean)
  )
  const ideaBasics = {
    title: session.ideaRecord?.title || 'Untitled',
    problem: session.ideaRecord?.problem || '',
    objectives: session.ideaRecord?.objectives || '',
    abstract: session.ideaRecord?.abstract || ''
  }

  const componentsFromReference = extractComponentsArray(session.referenceMap)
  const componentsFromIdea = Array.isArray(session.ideaRecord?.components) ? session.ideaRecord.components : []
  const componentList = (componentsFromReference.length > 0 ? componentsFromReference : componentsFromIdea)
    .map((c: any, idx: number) => {
      const name = c?.name || c?.title || c?.component || `Component ${idx + 1}`
      // Use referenceLabel (universal) or numeral (legacy) - supports 100/200, S100/S200, (a)/(b) formats
      const label = c?.referenceLabel || c?.numeral
      const numeral = label ? ` (#${label})` : ''
      const desc = c?.description ? `: ${c.description}` : ''
      return `- ${name}${numeral}${desc}`
    })
    .join('\n')
  const sourceFactLedgerBlock = buildSupportOrSourceFactBlock(
    normalized,
    normalized.sourceFactLedger,
    'claims',
    'SUPPORT DATA SOURCES FOR CLAIM REFINEMENT SUPPORT',
    'SOURCE FACT LEDGER FOR CLAIM REFINEMENT SUPPORT'
  )

  const threatFor = (r: any) => {
    if (r?.noveltyThreat) return String(r.noveltyThreat)
    const tags: string[] = Array.isArray(r?.tags) ? r.tags : []
    if (tags.includes('AI_ANTICIPATES')) return 'anticipates'
    if (tags.includes('AI_OBVIOUS')) return 'obvious'
    if (tags.includes('AI_ADJACENT')) return 'adjacent'
    if (tags.includes('AI_REMOTE')) return 'remote'
    return ''
  }

  // ONLY use patents from claim refinement config - do NOT fall back to relatedArtSelections
  // as those are meant for prior art drafting (background sections), not claim refinement
  const baseAutoRefs = mergedClaimRefSelections
  const autoRefs = useAuto
    ? baseAutoRefs.filter((s: any) => {
        const pn = s.patentNumber || s.publication_number || ''
        if (!pn) return false
        // If user specifically selected patents, only use those
        if (preferredAuto.size > 0) return preferredAuto.has(pn)
        // Otherwise use all claim refinement patents (they were already selected for this purpose)
        return true
      })
    : []

  const autoRunId = runId || session.relatedArtRuns?.[0]?.id || null
  const claimRefManualText = typeof claimRefinementConfig?.manualText === 'string' ? claimRefinementConfig.manualText : ''
  const manualText = useManual
    ? (claimRefManualText ||
      (session.manualPriorArt as any)?.manualPriorArtText ||
      (session.manualPriorArt as any)?.text ||
      '')
    : ''
  const userDirectives = typeof additionalInstructions === 'string' ? additionalInstructions.trim() : ''

  const autoRefBlocks = autoRefs.map((r, idx) => {
      const notes = (() => {
        try {
          const isJsonish = typeof r.userNotes === 'string' && /^[\s]*[{\[]/.test(r.userNotes)
          const parsed = isJsonish ? JSON.parse(r.userNotes as string) : r.userNotes
          return parsed?.summary || r.userNotes || ''
        } catch {
          // If parsing fails, fall back to the raw notes to avoid breaking the pipeline
          return r.userNotes || ''
        }
      })()
    return `AUTO#${idx + 1} :: ${r.patentNumber || 'UNKNOWN'} :: ${r.title || ''}\nTHREAT: ${threatFor(r) || 'unknown'}\nSUMMARY: ${notes || r.snippet || ''}`
  }).join('\n\n')

  const manualBlock = manualText
    ? `MANUAL#1 :: USER-SUPPLIED CLAIM-REFINEMENT NOTES (treat as highly relevant and mandatory)\n${manualText}`
    : ''

  const criticalInstructionsBlock = userDirectives
    ? `\n\n====================================================================================
CRITICAL USER INSTRUCTIONS (MANDATORY - OUTPUT WILL FAIL WITHOUT FOLLOWING THESE):
====================================================================================
${userDirectives}

*** YOU MUST FOLLOW THE ABOVE INSTRUCTIONS. If you cannot satisfy them, explain why in your response and mark the refinement as FAILED. ***
====================================================================================`
    : ''

  const claimLines = Array.isArray(provisionalStructured) && provisionalStructured.length > 0
    ? provisionalStructured.map((c: any) => `${c.number || ''}. ${c.text || ''} [${c.type || c.category || 'claim'}]`).join('\n')
    : htmlToPlainText(provisionalHtml)

  const mode: 'AUTO' | 'MANUAL' | 'HYBRID' = useAuto && useManual ? 'HYBRID' : useAuto ? 'AUTO' : 'MANUAL'
  const activeJurisdiction = (session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()
  let writingSampleBlock = ''
  let personaProvenance: Record<string, any> = {
    claims: {
      styleEnabled: false,
      applied: false,
      source: 'disabled'
    }
  }
  try {
    const personaConfig = await resolveEffectivePersonaConfig(user, session, {
      usePersonaStyle: usePersonaStyleFromData,
      personaSelection: personaSelectionFromData
    })
    if (personaConfig.enabled && personaConfig.selection?.primaryPersonaId) {
      if (!acceptPersonaWarnings) {
        const personaWarnings = await getPersonaCoverageWarnings(user.id, user.tenantId, ['claims'], activeJurisdiction, personaConfig.selection)
        if (personaWarnings.length > 0) return personaCoverageResponse(personaWarnings)
      }

      const writingSample = await getWritingSample(user.id, 'claims', activeJurisdiction, personaConfig.selection, user.tenantId)
      personaProvenance.claims = {
        styleEnabled: true,
        applied: false,
        source: 'none',
        personaId: personaConfig.selection.primaryPersonaId
      }
      if (writingSample) {
        writingSampleBlock = buildWritingSampleBlock(writingSample, 'claims')
        personaProvenance.claims = {
          styleEnabled: true,
          applied: true,
          source: writingSample.source || 'persona',
          personaId: writingSample.personaId,
          personaName: writingSample.personaName,
          sampleId: writingSample.sampleId,
          sampleJurisdiction: writingSample.jurisdiction,
          isUniversal: writingSample.isUniversal
        }
      }
    }
  } catch (error) {
    if (error instanceof PersonaAccessError) return personaAccessResponse(error)
    throw error
  }

  const prompt = `You are an expert patent attorney refining claims to preserve the broadest defensible scope while addressing cited prior art.

INVENTION BASICS:
${ideaBasics.title ? `- Title: ${ideaBasics.title}` : ''}
${ideaBasics.problem ? `- Problem: ${ideaBasics.problem}` : ''}
${ideaBasics.objectives ? `- Objectives: ${ideaBasics.objectives}` : ''}
${ideaBasics.abstract ? `- Abstract: ${ideaBasics.abstract}` : ''}
${componentList ? `- Key components: ${componentList}` : ''}
${sourceFactLedgerBlock ? `\n${sourceFactLedgerBlock}` : ''}

CURRENT CLAIMS (treat as provisional unless already frozen):
${claimLines}

${writingSampleBlock}

${autoRefBlocks ? `PATENTS SELECTED FOR CLAIM REFINEMENT (user-selected, claims must be novel over ALL of these):\n${autoRefBlocks}\n\n*** CRITICAL: Novelty must be explicitly established over EACH reference above. These are NOT general prior art - they are specifically selected references that the user wants their claims to be distinguished from. ***` : ''}

${manualBlock || ''}
${criticalInstructionsBlock}

Guidelines:
- For each claim, either KEEP_AS_IS or provide a refined_text that avoids anticipation/obviousness over the selected patents.
- Only narrow when justified by specific references from the selected patents list. Cite them via IDs (AUTO#1, MANUAL#1, etc.).
- Use the support data/source fact context only as available source support for fallback narrowing; do not introduce limitations that are absent from the original idea context.
- Preserve jurisdictional style loosely; maintain numbering.
- Prefer concise edits over full rewrites when possible.
- Each refined claim must clearly distinguish from ALL selected patents above.
- If user provided additional instructions above (CRITICAL USER INSTRUCTIONS), those MUST be followed or the output is considered FAILED.
- If refinement cannot be achieved while maintaining patentable scope, explain why in the change_reason.

Return ONLY valid JSON:
{
  "refined_claims": [
    {
      "number": 1,
      "original_text": "text of original claim",
      "refined_text": "revised text or null if unchanged",
      "keep_as_is": true,
      "change_reason": "why refined or why kept",
      "prior_art_refs": ["AUTO#1","MANUAL#1"]
    }
  ]
}`

  const request = { headers: requestHeaders || {} }
  const llmResult = await llmGateway.executeLLMOperation(request, {
    taskCode: 'LLM1_CLAIM_REFINEMENT',
    stageCode: 'DRAFT_CLAIM_REFINEMENT', // Use stage config for admin-configured model/limits
    prompt,
    idempotencyKey: crypto.randomUUID(),
    inputTokens: Math.ceil(prompt.length / 4),
    metadata: {
      patentId,
      sessionId,
      runId: autoRunId,
      purpose: 'claim_refinement_preview',
      mode
    }
  })

  let refinedClaims: any[] = []
  try {
    const raw = (llmResult.response?.output || '').trim()
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    const json = start !== -1 && end !== -1 ? raw.substring(start, end + 1) : raw
    const parsed = JSON.parse(json)
    refinedClaims = Array.isArray(parsed?.refined_claims) ? parsed.refined_claims : Array.isArray(parsed) ? parsed : []
  } catch (e) {
    console.error('Failed to parse claim refinement preview JSON', e)
  }

  const previewPayload = {
    refinedClaims,
    generatedAt: new Date().toISOString(),
    mode,
    usedManualPriorArt: !!useManual,
    autoRunId,
    selectedPatents: Array.from(preferredAuto),
    manualIncluded: !!manualText,
    additionalInstructions: userDirectives || undefined,
    claimRefSources: mergedClaimRefSelections.length,
    personaStyleApplied: Object.values(personaProvenance).some((p: any) => p?.applied),
    personaProvenance,
    personaWarnings: []
  }

  const mergedNormalized = {
    ...normalized,
    claimsRefinementPreview: previewPayload
  }

  await prisma.ideaRecord.update({
    where: { sessionId },
    data: { normalizedData: mergedNormalized }
  })

  console.log(`[claim_refinement_preview] mode=${mode}, autoRefs=${autoRefs.length}, manualIncluded=${!!manualText}`)
  return NextResponse.json({
    success: true,
    preview: previewPayload,
    personaStyleApplied: previewPayload.personaStyleApplied,
    personaProvenance: previewPayload.personaProvenance,
    personaWarnings: previewPayload.personaWarnings
  })
}

async function handleClaimRefinementApply(user: any, patentId: string, data: any) {
  const { sessionId, acceptedClaimNumbers, acceptAll: requestedAcceptAll } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const normalized = normalizeClaimsForSession((session.ideaRecord?.normalizedData as any) || {})
  const preview = normalized.claimsRefinementPreview
  if (!preview || !Array.isArray(preview.refinedClaims)) {
    return NextResponse.json({ error: 'No refinement preview found. Generate a preview first.' }, { status: 400 })
  }

  const baseStructured: any[] =
    normalized.claimsStructured ||
    normalized.claimsStructuredProvisional ||
    normalized.claimsStructuredFinal ||
    []

  const baseByNumber = new Map<number, any>()
  for (const claim of Array.isArray(baseStructured) ? baseStructured : []) {
    const claimNumber = Number(claim?.number)
    if (Number.isFinite(claimNumber)) baseByNumber.set(claimNumber, claim)
  }
  const fallbackFromPreview = preview.refinedClaims.map((c: any, idx: number) => {
    const number = Number(c.number || idx + 1)
    const baseClaim = baseByNumber.get(number)
    const type = normalizeDraftClaimType(c.type ?? c.claimType ?? c.claim_type) ||
      normalizeDraftClaimType(baseClaim?.type) ||
      (number === 1 ? 'independent' : 'dependent')
    const dependsOn = Number(c.dependsOn ?? c.depends_on ?? c.parentClaim ?? baseClaim?.dependsOn)
    return {
      number,
      text: c.original_text || c.refined_text || '',
      type,
      ...(type === 'dependent' && Number.isFinite(dependsOn) && dependsOn > 0 ? { dependsOn } : {}),
      ...(c.category || baseClaim?.category ? { category: c.category || baseClaim?.category } : {})
    }
  })

  const workingStructured = Array.isArray(baseStructured) && baseStructured.length > 0 ? baseStructured : fallbackFromPreview
  const acceptedSet = new Set(
    Array.isArray(acceptedClaimNumbers)
      ? acceptedClaimNumbers.map((n: any) => Number(n))
      : []
  )
  const acceptAll = requestedAcceptAll === true || !Array.isArray(acceptedClaimNumbers)

  const merged = workingStructured.map((c: any) => {
    const match = preview.refinedClaims.find((r: any) => Number(r.number) === Number(c.number))
    const accepted = acceptAll || acceptedSet.has(Number(c.number))
    if (match && accepted && match.refined_text) {
      return { ...c, text: match.refined_text }
    }
    return { ...c }
  })

  const changedClaims = preview.refinedClaims.filter((r: any) => r.refined_text && (acceptAll || acceptedSet.has(Number(r.number))))
  const changeNotes = changedClaims.map((r: any) => {
    const refs = Array.isArray(r.prior_art_refs) ? r.prior_art_refs.join(', ') : ''
    const reason = r.change_reason || r.changeReason || 'refined'
    return `Claim ${r.number}: ${reason}${refs ? ` [refs: ${refs}]` : ''}`
  }).join('\n')

  const mergedHtml = structuredClaimsToHtml(merged)
  const now = new Date().toISOString()
  const mode: 'AUTO' | 'MANUAL' | 'HYBRID' = preview.mode || (preview.usedManualPriorArt ? (preview.autoRunId ? 'HYBRID' : 'MANUAL') : 'AUTO')

  const updatedNormalized: Record<string, any> = {
    ...normalized,
    claimsStructured: merged,
    claims: mergedHtml,
    claimsLastSavedAt: now,
    claimsRefinementNotes: changeNotes,
    claimsRefinementSource: {
      autoRunId: preview.autoRunId || null,
      usedManualPriorArt: !!preview.usedManualPriorArt,
      mode,
      selectedPatents: preview.selectedPatents || [],
      appliedAt: now
    }
  }

  if (!updatedNormalized.claimsProvisional) {
    updatedNormalized.claimsProvisional = normalized.claimsProvisional || mergedHtml
    updatedNormalized.claimsStructuredProvisional = normalized.claimsStructuredProvisional || workingStructured
  }

  await prisma.ideaRecord.update({
    where: { sessionId },
    data: { normalizedData: updatedNormalized }
  })

  console.log(`[claim_refinement_apply] applied=${changedClaims.length}, acceptedAll=${acceptAll}`)
  return NextResponse.json({
    success: true,
    claims: merged,
    claimsHtml: mergedHtml,
    notes: changeNotes
  })
}

/**
 * Add component numbers (reference numerals) to claims
 * This surgically inserts component numbers at appropriate places in the claim text
 * without changing the claim substance or structure
 * 
 * CLAIMS SOURCE PRIORITY (robust handling):
 * 1. Uses claims content passed from Annexure Draft UI (generated.claims) - PREFERRED
 *    This is whatever claims are currently displayed in the draft:
 *    - Refined claims (if user went through claim refinement stage)
 *    - Preliminary claims (if user skipped refinement)
 * 2. Falls back to frozen/source claims from ideaRecord if UI content is empty
 * 
 * IMPORTANT: This modifies the draft claims only (AnnexureDraft.claims)
 * NOT the source claims in ideaRecord.normalizedData
 * 
 * LLM Configuration: Uses DRAFT_CLAIM_GENERATION stage for super admin control
 * (same as claim generation for consistency)
 */
async function handleAddComponentNumbersToClaims(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, jurisdiction, claimsContent } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  // Verify ownership and get session with referenceMap and ideaRecord
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { 
      ideaRecord: true,
      referenceMap: true
    }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  // Get component numbers from referenceMap (handles nested { components, numberingStyle })
  const referenceMap = session.referenceMap as any
  const components = extractComponentsArray(referenceMap)
  if (components.length === 0) {
    return NextResponse.json({
      error: 'No component numbers available. Please finalize components in the Component Planner stage first.'
    }, { status: 400 })
  }
  const numberingStyle =
    (referenceMap?.components as any)?.numberingStyle ||
    (referenceMap as any)?.numberingStyle ||
    null
  const patentTypePrimary = (session as any)?.patentTypePrimary || null

  // ROBUST CLAIMS SOURCING:
  // Priority 1: Use claims passed from UI (whatever is displayed in Annexure Draft)
  // Priority 2: Fall back to frozen/refined claims from ideaRecord
  let claimsHtml = (claimsContent || '').trim()
  let claimsSource = 'ui'
  
  if (!claimsHtml) {
    // Fallback: try to get claims from ideaRecord (frozen/refined claims)
    const normalizedData = normalizeClaimsForSession((session.ideaRecord?.normalizedData as any) || {})
    claimsHtml = (
      normalizedData.claimsFinal || 
      normalizedData.claims || 
      normalizedData.claimsProvisional || 
      ''
    ).trim()
    claimsSource = 'ideaRecord'
    
    console.log(`[addComponentNumbersToClaims] UI claims empty, falling back to ideaRecord (${claimsHtml ? 'found' : 'not found'})`)
  }
  
  if (!claimsHtml) {
    return NextResponse.json({ 
      error: 'No claims text available. Please ensure claims are generated and populated in the draft before adding component numbers.' 
    }, { status: 400 })
  }
  
  console.log(`[addComponentNumbersToClaims] Using claims from: ${claimsSource}, length: ${claimsHtml.length} chars`)

  // Build component reference list for the LLM (supports all numbering styles: 100/200, S100/S200, (a)/(b))
  const formatLabel = (label: string): string => {
    const raw = String(label || '').trim()
    if (!raw) return ''
    // Avoid double-wrapping constituent labels like "(a)"
    if (/^\(.*\)$/.test(raw) || (numberingStyle && String(numberingStyle).toUpperCase() === 'CONSTITUENT_LABEL')) {
      return raw
    }
    return `(${raw})`
  }

  const componentList = components
    .filter((c: any) => c.name && (c.referenceLabel || c.numeral))
    .map((c: any) => `- ${c.name}: ${formatLabel(c.referenceLabel || c.numeral)}`)
    .join('\n')

  // Get effective jurisdiction
  const effectiveJurisdiction = (jurisdiction || session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()

  try {
    // Build the LLM prompt for adding component numbers
    const prompt = `You are a patent claim editor specializing in adding reference numerals to patent claims.

Your task is to SURGICALLY add component reference numbers to patent claims WITHOUT changing the claim substance, wording, or structure.

RULES:
1. Add reference numerals in parentheses immediately after the FIRST occurrence of each component name in each claim, using the numbering style for this patent type: ${numberingStyle || 'NUMERIC_BUCKET'}.
2. Do NOT change any claim wording, structure, or substance
3. Do NOT add numbers to components that don't exist in the provided component list
4. Match component names intelligently (e.g., "controller" matches "main controller", "control unit" matches "controller")
5. Reference numerals format by style:
   - NUMERIC_BUCKET: component name (assigned numeric label as provided)
   - STEP_LABEL (PROCESS): component name (S100, S200...) as provided; do NOT convert to plain numbers
   - CONSTITUENT_LABEL (COMPOSITION): component name ((a), (b), (c)...) as provided
6. For dependent claims, only add numerals to new components not already numbered in the referenced claim
7. Preserve all HTML formatting, paragraph tags, and claim numbering exactly as provided
8. If a component is mentioned multiple times in the same claim, only add the numeral on the FIRST occurrence

COMPONENT REFERENCE LIST:
${componentList}

CLAIMS TEXT TO MODIFY:
${claimsHtml}

OUTPUT FORMAT:
Return ONLY the modified claims text with reference numerals added. No explanations, no JSON wrapping.
Preserve all HTML tags and formatting exactly as in the input.`

    // Call LLM using the gateway
    // Uses DRAFT_CLAIM_GENERATION stage (same as claim generation) for super admin LLM control
    // This ensures component number addition uses the same model as claim generation
    const request = { headers: requestHeaders || {} }
    const llmResult = await llmGateway.executeLLMOperation(request, {
      taskCode: 'LLM2_DRAFT',
      stageCode: 'DRAFT_CLAIM_GENERATION', // Same as claim generation for super admin control
      prompt,
      idempotencyKey: crypto.randomUUID(),
      inputTokens: Math.ceil(prompt.length / 4),
      metadata: { patentId, sessionId, purpose: 'add_component_numbers_to_claims', numberingStyle, patentTypePrimary }
    })

    if (!llmResult.success || !llmResult.response?.output) {
      console.error('[addComponentNumbersToClaims] LLM call failed:', llmResult.error)
      return NextResponse.json({ 
        error: 'Failed to process claims with component numbers' 
      }, { status: 500 })
    }

    const updatedClaims = llmResult.response.output.trim()

    // Get effective jurisdiction for saving
    const effectiveJur = effectiveJurisdiction

    // Update the AnnexureDraft (draft claims) NOT the ideaRecord (source claims)
    // This ensures the source claims (frozen/refined) remain unchanged
    // Only the draft version gets the component numbers added
    const existingDraft = await prisma.annexureDraft.findFirst({
      where: { sessionId, jurisdiction: effectiveJur },
      orderBy: { updatedAt: 'desc' }
    })

    if (existingDraft) {
      // Update existing draft with new claims containing component numbers
      await prisma.annexureDraft.update({
        where: { id: existingDraft.id },
        data: { 
          claims: updatedClaims,
          updatedAt: new Date()
        }
      })
      console.log(`[addComponentNumbersToClaims] Updated AnnexureDraft ${existingDraft.id} with component-numbered claims`)
    } else {
      // No draft exists - create one with just the claims
      console.log(`[addComponentNumbersToClaims] No existing draft for ${effectiveJur}, claims will be returned to UI only`)
    }

    // Also track that component numbers were added (metadata only, not modifying source claims)
    const existingNormalized = (session.ideaRecord?.normalizedData as any) || {}
    if (!existingNormalized.componentNumbersAddedToClaims) {
      await prisma.ideaRecord.update({
        where: { sessionId },
        data: { 
          normalizedData: {
            ...existingNormalized,
            componentNumbersAddedToClaims: {
              addedAt: new Date().toISOString(),
              jurisdiction: effectiveJur,
              componentsUsed: components.length
            }
          }
        }
      })
    }

    console.log(`[addComponentNumbersToClaims] Successfully added component numbers to claims for session ${sessionId}, jurisdiction: ${effectiveJur}`)

    return NextResponse.json({
      success: true,
      claims: updatedClaims,
      componentsUsed: components.length,
      tokensUsed: llmResult.response?.outputTokens || 0,
      claimsSource, // 'ui' or 'ideaRecord' - for debugging
      jurisdiction: effectiveJur,
      draftUpdated: !!existingDraft
    })

  } catch (error) {
    console.error('[addComponentNumbersToClaims] Error:', error)
    return NextResponse.json({ 
      error: 'Failed to add component numbers to claims' 
    }, { status: 500 })
  }
}

// Helper function to parse claims from HTML (used by addComponentNumbersToClaims)
function parseClaimsFromHtml(html: string): Array<{ number: number; text: string; type: string; category: string }> {
  if (!html || html.trim() === '') return []
  
  const claims: Array<{ number: number; text: string; type: string; category: string }> = []
  const blocks = html.split(/<\/p>/i)
  
  blocks.forEach((block) => {
    const plain = block.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!plain) return
    
    const match = plain.match(/^(\d+)\.?\s*(.+)$/)
    if (match) {
      const number = Number(match[1])
      const text = match[2].trim()
      const depMatch = text.match(/(?:claim|claims?)\s+(\d+)/i)
      const isDependent = number > 1 && depMatch !== null
      
      claims.push({
        number,
        text,
        type: isDependent ? 'dependent' : 'independent',
        category: isDependent ? 'dependent' : 'independent'
      })
    }
  })
  
  return claims
}

async function handleSetStage(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const {
    sessionId,
    stage,
    manualPriorArt,
    selectedPatents,
    draftingJurisdictions,
    activeJurisdiction,
    // Language configuration (from Stage 0)
    languageMode, // 'common' | 'individual_english_figures'
    languageByJurisdiction,
    figuresLanguage, // Primary language for diagrams/sketches
    commonLanguage, // Used when mode='common'
    sourceOfTruth,
    isMultiJurisdiction,
    skipPriorArt,
    useInitialClaimsForDrafting,
    priorArtConfig,
    claimRefinementConfig,
    priorArtForDrafting
  } = data

  console.log('handleSetStage called with:', { sessionId, stage, patentId, userId: user.id, manualPriorArt: !!manualPriorArt, selectedPatentsCount: selectedPatents?.length || 0 })

  // COUNTRY_WISE_DRAFTING kept for backward compatibility with existing sessions
  const allowedStages = [
    'IDEA_ENTRY',
    'PRELIMINARY_CLAIMS',
    'RELATED_ART',
    'CLAIM_REFINEMENT',
    'COMPONENT_PLANNER',
    'FIGURE_PLANNER',
    'COUNTRY_WISE_DRAFTING', // Legacy - jurisdiction now selected in Stage 0
    'ANNEXURE_DRAFT',
    'COMPLETED'
  ]

  if (!sessionId || !allowedStages.includes(stage)) {
    console.log('Invalid sessionId or stage:', { sessionId, stage })
    return NextResponse.json(
      { error: 'Valid sessionId and stage are required' },
      { status: 400 }
    )
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true }
  })

  console.log('Session lookup result:', session ? 'found' : 'not found')

  if (!session) {
    // Try to find the session without patentId constraint to debug
    const sessionWithoutPatent = await prisma.draftingSession.findFirst({
      where: { id: sessionId, userId: user.id }
    })
    console.log('Session exists but wrong patent?', sessionWithoutPatent ? `belongs to patent: ${sessionWithoutPatent.patentId}` : 'session not found at all')

    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    )
  }

  // Prepare update data
  const updateData: any = { status: stage }

  const stageFlow = ['IDEA_ENTRY', 'PRELIMINARY_CLAIMS', 'RELATED_ART', 'CLAIM_REFINEMENT', 'COMPONENT_PLANNER', 'FIGURE_PLANNER', 'ANNEXURE_DRAFT', 'COMPLETED']
  const legacyStageMap: Record<string, (typeof stageFlow)[number]> = {
    REVIEW_FIX: 'ANNEXURE_DRAFT',
    EXPORT_READY: 'ANNEXURE_DRAFT'
  }
  const currentStage = legacyStageMap[session.status] || session.status
  let allowed = true
  const sessionPriorArtConfig = (session.priorArtConfig as any) || {}
  const priorArtSkipped = !!sessionPriorArtConfig.skipped
  const claimRefinementSkipped = !!sessionPriorArtConfig.skippedClaimRefinement
  
  // Check if claim refinement is being skipped in THIS request
  const isSkippingPriorArt = !!(skipPriorArt || useInitialClaimsForDrafting || priorArtSkipped)
  const isSkippingClaimRefinement = !!(data.claimRefinementSkipped || data.priorArtConfig?.skippedClaimRefinement || claimRefinementSkipped)
  const currentIdx = stageFlow.indexOf(currentStage)
  const targetIdx = stageFlow.indexOf(stage)
  const isKnownStagePair = currentIdx !== -1 && targetIdx !== -1
  const isBackwardNavigation = isKnownStagePair && targetIdx < currentIdx

  if (stage === currentStage) {
    allowed = true
  } else if (isBackwardNavigation) {
    allowed = true
  } else if (currentStage === 'IDEA_ENTRY') {
    if (stage === 'PRELIMINARY_CLAIMS') {
      allowed = true
    } else if (stage === 'RELATED_ART') {
      allowed = true
    } else if (stage === 'COMPONENT_PLANNER' && isSkippingPriorArt) {
      allowed = true
    } else {
      allowed = false
    }
  } else if (currentStage === 'PRELIMINARY_CLAIMS') {
    if (stage === 'RELATED_ART') {
      allowed = true
    } else if (stage === 'COMPONENT_PLANNER' && isSkippingPriorArt) {
      allowed = true
    } else {
      allowed = false
    }
  } else if (currentStage === 'RELATED_ART') {
    // Allow going to CLAIM_REFINEMENT or directly to COMPONENT_PLANNER (if skipping claim refinement)
    if (stage === 'CLAIM_REFINEMENT') {
      allowed = true
    } else if (stage === 'COMPONENT_PLANNER' && isSkippingClaimRefinement) {
      allowed = true
    } else if (stage === 'IDEA_ENTRY') {
      // Allow going back to idea entry from related art
      allowed = true
    } else {
      allowed = false
    }
  } else if (currentStage === 'CLAIM_REFINEMENT') {
    if (stage === 'COMPONENT_PLANNER') {
      allowed = true
    } else if (stage === 'RELATED_ART') {
      // Allow going back to related art from claim refinement
      allowed = true
    } else {
      allowed = false
    }
  } else if (currentStage === 'COMPONENT_PLANNER') {
    // Allow backward navigation depending on which stages were skipped
    if (stage === 'CLAIM_REFINEMENT' && !claimRefinementSkipped && !priorArtSkipped) {
      allowed = true
    } else if (stage === 'RELATED_ART' && !priorArtSkipped) {
      allowed = true
    } else if (stage === 'IDEA_ENTRY') {
      // Always allow going back to IDEA_ENTRY (first stage)
      allowed = true
    } else if (stage === 'FIGURE_PLANNER' || stage === 'ANNEXURE_DRAFT') {
      // Always allow forward progression
      allowed = true
    } else {
      allowed = currentIdx !== -1 && targetIdx !== -1
    }
  } else if (currentStage === 'FIGURE_PLANNER') {
    // From FIGURE_PLANNER: allow back to any previous stage or forward to ANNEXURE_DRAFT
    // Allow any valid stage transition (forward or backward)
    allowed = currentIdx !== -1 && targetIdx !== -1
  } else if (currentStage === 'ANNEXURE_DRAFT') {
    // From ANNEXURE_DRAFT: allow back to any previous stage or forward to COMPLETED
    // Allow any valid stage transition (forward or backward)
    allowed = currentIdx !== -1 && targetIdx !== -1
  } else {
    // Allow any valid stage transition
    allowed = currentIdx !== -1 && targetIdx !== -1
  }

  if (!allowed) {
    return NextResponse.json({ error: 'Stage transition not allowed for this flow' }, { status: 400 })
  }

  // Normalize and persist jurisdiction choices (Stage 3.7a)
  try {
    const statusMap: Record<string, any> = { ...(session!.jurisdictionDraftStatus as any) || {} }
    const languagePrefs: Record<string, string> = {}
    const hasJurisdictionPayload = Array.isArray(draftingJurisdictions)
    let normalizedJurisdictions: string[] | undefined
    if (hasJurisdictionPayload) {
      normalizedJurisdictions = Array.from(new Set(
        draftingJurisdictions
          .map((c: string) => (c || '').toUpperCase())
          .filter(Boolean)
      ))
      updateData.draftingJurisdictions = normalizedJurisdictions
    }

    const requestedActive = (activeJurisdiction || '').toUpperCase()

    let chosenListAll = Array.from(new Set(
      ((updateData.draftingJurisdictions as string[] | undefined) || session.draftingJurisdictions || [])
        .map((c: string) => (c || '').toUpperCase())
        .filter(Boolean)
    ))
    if (requestedActive && requestedActive === 'REFERENCE' && !chosenListAll.includes('REFERENCE')) {
      chosenListAll = [...chosenListAll, 'REFERENCE']
    }
    if (!updateData.draftingJurisdictions && chosenListAll.length > 0) {
      updateData.draftingJurisdictions = chosenListAll
    }

    // AUTO-SET isMultiJurisdiction based on number of actual jurisdictions selected
    // This is crucial for reference draft generation to work correctly
    const actualJurisdictions = chosenListAll.filter((c: string) => c !== 'REFERENCE')
    const actualJurisdictionCount = actualJurisdictions.length
    if (actualJurisdictionCount > 1) {
      updateData.isMultiJurisdiction = true
      console.log(`[handleSetStage] Auto-enabled multi-jurisdiction mode for ${actualJurisdictionCount} jurisdictions: ${actualJurisdictions.join(', ')}`)
    } else if (typeof isMultiJurisdiction === 'boolean') {
      // Allow explicit override
      updateData.isMultiJurisdiction = isMultiJurisdiction
      // Reset reference draft status when switching to single mode
      if (!isMultiJurisdiction) {
        updateData.referenceDraftComplete = false
        updateData.referenceDraftId = null
      }
    }

    // Resolve active jurisdiction - allow REFERENCE to stay active
    const validRequestedActive = (requestedActive === 'REFERENCE' || chosenListAll.includes(requestedActive)) ? requestedActive : null
    const savedActive = session.activeJurisdiction ? session.activeJurisdiction.toUpperCase() : null
    const validSavedActive = savedActive && (chosenListAll.length === 0 || savedActive === 'REFERENCE' || chosenListAll.includes(savedActive))
      ? savedActive
      : null
    const resolvedActive = validRequestedActive 
      || chosenListAll[0] 
      || (hasJurisdictionPayload ? null : validSavedActive)

    if (resolvedActive) {
      updateData.activeJurisdiction = resolvedActive
    } else if (hasJurisdictionPayload) {
      updateData.activeJurisdiction = null
    }
    
    // Log for debugging
    console.log(`[handleSetStage] Jurisdictions: ${chosenListAll.join(', ') || 'none'}, Active: ${resolvedActive || 'none'}, MultiJurisdiction: ${updateData.isMultiJurisdiction ?? session.isMultiJurisdiction}`)

    // Resolve preferred languages per jurisdiction (if provided)
    for (const code of chosenListAll) {
      try {
        const profile = await getCountryProfile(code)
        const langs: string[] = Array.isArray((profile as any)?.profileData?.meta?.languages)
          ? (profile as any).profileData.meta.languages
          : []
        if (!langs.length) continue
        const requestedLang = (languageByJurisdiction && typeof languageByJurisdiction[code] === 'string')
          ? String(languageByJurisdiction[code]).trim()
          : ''
        const normalized = requestedLang && langs.includes(requestedLang) ? requestedLang : langs[0]
        if (normalized) languagePrefs[code] = normalized
      } catch (err) {
        console.warn('Failed to resolve languages for', code, err)
      }
    }

    if (Object.keys(languagePrefs).length > 0) {
      for (const [code, lang] of Object.entries(languagePrefs)) {
        statusMap[code] = { ...(statusMap?.[code] || {}), language: lang }
      }
    }

    // Resolve and persist source-of-truth jurisdiction (order drives reference draft selection)
    const requestedSource = typeof sourceOfTruth === 'string' ? sourceOfTruth.toUpperCase() : undefined
    let resolvedSource = (requestedSource && actualJurisdictions.includes(requestedSource))
      ? requestedSource
      : (typeof statusMap.__sourceOfTruth === 'string' && actualJurisdictions.includes(String(statusMap.__sourceOfTruth).toUpperCase())
        ? String(statusMap.__sourceOfTruth).toUpperCase()
        : undefined)
    if (!resolvedSource && actualJurisdictions.length > 0) resolvedSource = actualJurisdictions[0]
    if (resolvedSource) {
      statusMap.__sourceOfTruth = resolvedSource
      const orderedActual = [resolvedSource, ...actualJurisdictions.filter(c => c !== resolvedSource)]
      const referenceEntries = chosenListAll.filter(c => c === 'REFERENCE')
      updateData.draftingJurisdictions = [...orderedActual, ...referenceEntries.filter(c => !orderedActual.includes(c))]
    }

    // =========================================================================
    // LANGUAGE CONFIGURATION PERSISTENCE (with validation)
    // =========================================================================
    // Language Mode: 'common' | 'individual_english_figures'
    // - common: All content + figures in one language
    // - individual_english_figures: Per-jurisdiction content, English figures
    
    // Validate and set language mode
    let resolvedLanguageMode = languageMode
    
    // CRITICAL: Force 'common' mode for single jurisdiction (no choice allowed)
    if (actualJurisdictionCount === 1) {
      if (languageMode !== 'common') {
        console.log(`[handleSetStage] Forcing common mode for single jurisdiction (requested: ${languageMode})`)
      }
      resolvedLanguageMode = 'common'
    }
    
    // Validate mode is one of the allowed values
    if (typeof resolvedLanguageMode === 'string' && VALID_LANGUAGE_MODES.includes(resolvedLanguageMode as LanguageModeType)) {
      statusMap.__languageMode = resolvedLanguageMode
      console.log(`[handleSetStage] Persisted language mode: ${resolvedLanguageMode}`)
    } else if (resolvedLanguageMode) {
      console.warn(`[handleSetStage] Invalid language mode "${resolvedLanguageMode}", defaulting to 'common'`)
      statusMap.__languageMode = 'common'
    }

    // Common language validation & persistence
    if (typeof commonLanguage === 'string' && commonLanguage.trim()) {
      const normalizedCommon = commonLanguage.trim().toLowerCase()
      
      // Validate that common language is supported by all jurisdictions
      let isValidCommon = true
      if (resolvedLanguageMode === 'common' && actualJurisdictions.length > 1) {
        for (const code of actualJurisdictions) {
          const profile = await getCountryProfile(code)
          const supported: string[] = Array.isArray((profile as any)?.profileData?.meta?.languages)
            ? (profile as any).profileData.meta.languages
            : []
          if (supported.length > 0 && !supported.includes(normalizedCommon)) {
            console.warn(`[handleSetStage] Common language "${normalizedCommon}" not supported by ${code}. Supported: ${supported.join(', ')}`)
            isValidCommon = false
            break
          }
        }
      }
      
      if (isValidCommon) {
        statusMap.__commonLanguage = normalizedCommon
        console.log(`[handleSetStage] Persisted common language: ${statusMap.__commonLanguage}`)
      } else {
        // Fallback: Use English if supported, otherwise first jurisdiction's first language
        const firstJurisdiction = actualJurisdictions[0]
        const firstProfile = await getCountryProfile(firstJurisdiction)
        const firstLangs: string[] = Array.isArray((firstProfile as any)?.profileData?.meta?.languages)
          ? (firstProfile as any).profileData.meta.languages
          : []
        const fallbackLang = firstLangs.includes('en') ? 'en' : (firstLangs[0] || 'en')
        statusMap.__commonLanguage = fallbackLang
        console.log(`[handleSetStage] Common language fallback to: ${fallbackLang}`)
      }
    }

    // Figures language (primary language for diagrams/sketches)
    // In 'individual_english_figures' mode, this is ALWAYS 'en' (enforced)
    if (resolvedLanguageMode === 'individual_english_figures') {
      // Force English for figures in individual mode - no exceptions
      statusMap.__figuresLanguage = 'en'
      console.log(`[handleSetStage] Figures language forced to 'en' (individual mode)`)
    } else if (typeof figuresLanguage === 'string' && figuresLanguage.trim()) {
      statusMap.__figuresLanguage = figuresLanguage.trim().toLowerCase()
      console.log(`[handleSetStage] Persisted figures language: ${statusMap.__figuresLanguage}`)
    } else if (statusMap.__commonLanguage) {
      // In common mode, figures use common language
      statusMap.__figuresLanguage = statusMap.__commonLanguage
    } else {
      // Ultimate fallback
      statusMap.__figuresLanguage = 'en'
    }

    updateData.jurisdictionDraftStatus = statusMap
  } catch (e) {
    console.warn('Failed to persist drafting jurisdictions; continuing with defaults.', e)
  }

  if (manualPriorArt !== undefined) {
    updateData.manualPriorArt = manualPriorArt
  }

  // Merge priorArtConfig with claimRefinementConfig and priorArtForDrafting
  // This ensures claim refinement selections are properly persisted across stage transitions
  if (priorArtConfig || claimRefinementConfig || priorArtForDrafting) {
    const mergedConfig = {
      ...(sessionPriorArtConfig || {}),
      ...(priorArtConfig || {})
    }
    
    // Merge claimRefinementConfig into the priorArtConfig structure
    if (claimRefinementConfig) {
      mergedConfig.claimRefinementConfig = {
        mode: claimRefinementConfig.mode || 'ai',
        selectedPatents: claimRefinementConfig.selectedPatents || [],
        manualText: claimRefinementConfig.manualText || ''
      }
    }
    
    // Merge priorArtForDrafting into the priorArtConfig structure
    if (priorArtForDrafting) {
      mergedConfig.priorArtForDrafting = {
        mode: priorArtForDrafting.mode || 'ai',
        selectedPatents: priorArtForDrafting.selectedPatents || [],
        manualText: priorArtForDrafting.manualText || ''
      }
    }
    
    updateData.priorArtConfig = mergedConfig
  }

  // Store claimRefinementSkipped flag in priorArtConfig JSON field
  if (data.claimRefinementSkipped) {
    updateData.priorArtConfig = {
      ...(updateData.priorArtConfig || sessionPriorArtConfig || {}),
      skippedClaimRefinement: true
    }
  }

  // Freeze preliminary claims as final when skipping claim refinement
  // This ensures preliminary claims are locked as the final claims for drafting
  if (stage === 'COMPONENT_PLANNER' && data.freezePreliminaryClaims && data.claimRefinementSkipped) {
    const normalized = normalizeClaimsForSession((session.ideaRecord?.normalizedData as any) || {})
    const claimsSnapshot = getWorkingClaims(normalized)
    if (claimsSnapshot.html) {
      const now = new Date().toISOString()
      const normalizedUpdate: Record<string, any> = {
        ...normalized,
        claims: claimsSnapshot.html,
        claimsStructured: claimsSnapshot.structured,
        claimsFinal: claimsSnapshot.html,
        claimsStructuredFinal: claimsSnapshot.structured,
        claimsApprovedAt: now,
        claimsApprovedBy: user.id,
        claimsJurisdiction: normalized.claimsJurisdiction || session.activeJurisdiction || 'US',
        claimsRefinementSource: {
          mode: 'SKIPPED_REFINEMENT',
          usedManualPriorArt: false,
          autoRunId: null,
          skipClaimRefinement: true,
          appliedAt: now
        }
      }

      await prisma.ideaRecord.update({
        where: { sessionId },
        data: { normalizedData: normalizedUpdate }
      })
      queueDDEvidenceSelectionBestEffort(
        sessionId,
        patentId,
        user,
        requestHeaders,
        normalizedUpdate.claimsJurisdiction,
        true
      )
      
      console.log('[handleSetStage] Froze preliminary claims as final (skipped claim refinement)')
    }
  }

  // If user opted to skip prior art/refinement, freeze provisional claims as final and mark config
  if (stage === 'COMPONENT_PLANNER' && (skipPriorArt || useInitialClaimsForDrafting)) {
    const normalized = normalizeClaimsForSession((session.ideaRecord?.normalizedData as any) || {})
    const claimsSnapshot = getWorkingClaims(normalized)
    if (!claimsSnapshot.html) {
      return NextResponse.json({ error: 'Cannot skip without initial claims. Please add claims first.' }, { status: 400 })
    }
    const now = new Date().toISOString()
    const normalizedUpdate: Record<string, any> = {
      ...normalized,
      claims: claimsSnapshot.html,
      claimsStructured: claimsSnapshot.structured,
      claimsProvisional: normalized.claimsProvisional || claimsSnapshot.html,
      claimsStructuredProvisional: normalized.claimsStructuredProvisional || claimsSnapshot.structured,
      claimsFinal: claimsSnapshot.html,
      claimsStructuredFinal: claimsSnapshot.structured,
      claimsApprovedAt: now,
      claimsApprovedBy: user.id,
      claimsJurisdiction: normalized.claimsJurisdiction || session.activeJurisdiction || 'US',
      claimsRefinementSource: {
        mode: 'SKIPPED',
        usedManualPriorArt: false,
        autoRunId: null,
        skipPriorArt: true,
        appliedAt: now
      }
    }

    await prisma.ideaRecord.update({
      where: { sessionId },
      data: { normalizedData: normalizedUpdate }
    })
    queueDDEvidenceSelectionBestEffort(
      sessionId,
      patentId,
      user,
      requestHeaders,
      normalizedUpdate.claimsJurisdiction,
      true
    )

    updateData.priorArtConfig = {
      skipped: true,
      useInitialClaimsForDrafting: !!useInitialClaimsForDrafting,
      useAuto: false,
      useManual: false
    }
  }

  const updated = await prisma.draftingSession.update({
    where: { id: sessionId },
    data: updateData as any
  })

  return NextResponse.json({ session: updated })
}

async function handleResume(user: any, patentId: string) {
  // Try to find most recent session for this patent
  const existing = await prisma.draftingSession.findFirst({
    where: { patentId, userId: user.id },
    orderBy: { createdAt: 'desc' }
  })

  if (existing) {
    // Normalize legacy stages (REVIEW_FIX/EXPORT_READY) to ANNEXURE_DRAFT now that review/export are merged
    const legacyStatuses = ['REVIEW_FIX', 'EXPORT_READY']
    if (legacyStatuses.includes(existing.status)) {
      const normalized = await prisma.draftingSession.update({
        where: { id: existing.id },
        data: { status: 'ANNEXURE_DRAFT' }
      })
      return NextResponse.json({ session: normalized })
    }

    return NextResponse.json({ session: existing })
  }

  // Create new session without preselecting a jurisdiction.
  const session = await prisma.draftingSession.create({
    data: {
      patentId,
      userId: user.id,
      tenantId: user.tenantId
    }
  })

  return NextResponse.json({ session }, { status: 201 })
}

async function handleProceedToComponents(user: any, patentId: string, data: any) {
  const { sessionId } = data;

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Session ID is required' },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId.trim(),
      patentId,
      userId: user.id
    },
    include: { ideaRecord: true }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  // Update session status to COMPONENT_PLANNER
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { status: 'COMPONENT_PLANNER' }
  });

  return NextResponse.json({ message: 'Proceeded to component planning' });
}

async function handleNormalizeIdea(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, areaOfInvention, allowRefine, sourceInputMeta } = data;
  const rawIdea = sanitizeStage0TextInput(data?.rawIdea)
  const title = sanitizeStage0TitleInput(data?.title)

  if (typeof sessionId !== 'string' || !sessionId.trim() || !rawIdea || !title) {
    return NextResponse.json(
      { error: 'Session ID, raw idea, and title are required' },
      { status: 400 }
    );
  }

  // Validate title length (ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¤ 15 words)
  if (title.length > 300) {
    return NextResponse.json(
      { error: 'Title must be 300 characters or less' },
      { status: 400 }
    );
  }

  const titleWords = title.trim().split(/\s+/).length;
  if (titleWords > 15) {
    return NextResponse.json(
      { error: 'Title must be 15 words or less' },
      { status: 400 }
    );
  }

  if (rawIdea.length > MAX_DRAFTING_INPUT_CHARS) {
    return NextResponse.json(
      { error: `Idea text exceeds maximum length of ${MAX_DRAFTING_INPUT_CHARS.toLocaleString()} characters. Please shorten your description.` },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId.trim(),
      patentId,
      userId: user.id
    },
    include: { ideaRecord: true }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  const normalizationRequestId = crypto.randomUUID()
  const staleLockCutoff = new Date(Date.now() - 60_000)
  const lockResult = await prisma.draftingSession.updateMany({
    where: ({
      id: session.id,
      patentId,
      userId: user.id,
      OR: [
        { normalizationInProgressAt: null },
        { normalizationInProgressAt: { lt: staleLockCutoff } },
      ],
    } as any),
    data: ({
      normalizationInProgressAt: new Date(),
      normalizationRequestId,
    } as any),
  })

  if (lockResult.count === 0) {
    return NextResponse.json(
      { error: 'Idea normalization is already in progress for this session. Please wait for it to finish.' },
      { status: 409 }
    )
  }

  try {
  // Use LLM to normalize the idea
  console.log('Starting idea normalization for patent:', patentId, 'session:', sessionId);

  // Stage 0 normalization now returns the broad primary patent claim type.
  // No separate patent-type LLM call is needed.
  const existingMode = (session.ideaRecord?.normalizedData as any)?.sourceHandlingMode
  const effectiveAllowRefine = typeof allowRefine === 'boolean'
    ? allowRefine
    : existingMode === 'PRESERVE'
      ? false
      : true

  const result = await DraftingService.normalizeIdea(
    rawIdea,
    title,
    user.tenantId,
    requestHeaders,
    areaOfInvention,
    effectiveAllowRefine,
    { patentId, sessionId: session.id }
  );

  if (!result.success) {
    console.error('Idea normalization failed:', result.error);
    return NextResponse.json(
      { error: `Failed to normalize idea: ${result.error}` },
      { status: 400 }
    );
  }

  console.log('Idea normalization successful');

  const patentTypePrimary = DraftingService.normalizePatentTypePrimary(
    result.extractedFields?.patentTypePrimary || result.normalizedData?.patentTypePrimary
  ) || DraftingService.patentTypeFallbackFromText(rawIdea, title).primary;
  console.log(`[handleNormalizeIdea] Patent type from normalization: ${patentTypePrimary}`);

  const normalizedData = migrateNormalizedData(
    {
      ...(result.normalizedData || {}),
      sourceInputMeta: buildSourceInputMeta(rawIdea, sourceInputMeta),
    },
    {
      patentTypePrimary: patentTypePrimary as any,
      sourceHandlingMode: effectiveAllowRefine ? 'STRUCTURE_ONLY' : 'PRESERVE',
    }
  )
  const extractedFields = {
    ...(result.extractedFields || {}),
    sourceInputMeta: normalizedData.sourceInputMeta,
    extractionFailed: normalizedData.extractionFailed,
  }
  const ideaFields = {
    title,
    rawInput: rawIdea,
    normalizedData,
    searchQuery: extractedFields.searchQuery || null,
    problem: extractedFields.problem,
    objectives: extractedFields.objectives,
    components: extractedFields.components,
    logic: extractedFields.logic,
    inputs: extractedFields.inputs,
    outputs: extractedFields.outputs,
    variants: extractedFields.variants,
    bestMethod: extractedFields.bestMethod,
    abstract: extractedFields.abstract,
    cpcCodes: extractedFields.cpcCodes || [],
    ipcCodes: extractedFields.ipcCodes || [],
    llmPromptUsed: result.llmPrompt,
    llmResponse: result.llmResponse,
    tokensUsed: result.tokensUsed
  };

  // Create or update idea record
  const ideaRecord = await prisma.ideaRecord.upsert({
    where: { sessionId: session.id },
    update: (ideaFields as any),
    create: ({
      sessionId: session.id,
      ...ideaFields,
    } as any)
  });

  // Keep session status as IDEA_ENTRY so user sees Stage 1 first
  // Status will be updated to COMPONENT_PLANNER when they proceed from Stage 1
  const components = extractedFields.components || [];
  const logic = extractedFields.logic || '';
  const nextPatentTypeComponentsHash = DraftingService.generatePatentTypeContextHash(components, logic);
  const previousPatentTypeComponentsHash = (session as any).patentTypeComponentsHash;
  const stage0ComponentContextChanged = previousPatentTypeComponentsHash !== nextPatentTypeComponentsHash;
  const sessionUpdateData: any = {
    status: 'IDEA_ENTRY',
    patentTypePrimary,
    patentTypeDecidedAt: new Date(),
    patentTypeComponentsHash: nextPatentTypeComponentsHash
  };
  
  await prisma.draftingSession.update({
    where: { id: session.id },
    data: sessionUpdateData
  });

  if (stage0ComponentContextChanged) {
    await invalidateReferenceMapForStage0Change(
      session.id,
      'Stage 0 normalization changed components or logic. Re-save the component plan before using figures.'
    )
  }

  return NextResponse.json({
    ideaRecord,
    normalizedData,
    extractedFields,
    patentTypePrimary // Include in response so UI can show it immediately
  });
  } finally {
    await prisma.draftingSession.updateMany({
      where: ({
        id: session.id,
        normalizationRequestId,
      } as any),
      data: ({
        normalizationInProgressAt: null,
        normalizationRequestId: null,
      } as any),
    })
  }
}

async function handleUpdateComponentMap(user: any, patentId: string, data: any) {
  const { sessionId, components, numberingStyleOverride, autoAssign } = data;

  if (!sessionId || !components) {
    return NextResponse.json(
      { error: 'Session ID and components are required' },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  // Get patent type from session for numbering style derivation
  const patentTypePrimary = (session as any).patentTypePrimary as 'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION' | null;

  // Check for existing referenceMap to detect numbering style mismatch
  const existingRefMap = await prisma.referenceMap.findUnique({
    where: { sessionId }
  });
  
  // Detect style mismatch: if patent type changed but components still have old-style labels
  let styleChangeWarning: string | null = null;
  if (existingRefMap && !numberingStyleOverride) {
    const existingMapData = existingRefMap.components as any;
    const existingStyle = existingMapData?.numberingStyle;
    const derivedStyle = deriveNumberingStyle(patentTypePrimary);
    
    if (existingStyle && existingStyle !== derivedStyle) {
      // Check if incoming components have labels in the OLD style (not auto-re-assigning)
      const hasOldStyleLabels = (components || []).some((c: any) => {
        const label = c.referenceLabel || '';
        if (existingStyle === 'NUMERIC_BUCKET' && /^\d+$/.test(label)) return true;
        if (existingStyle === 'STEP_LABEL' && /^S\d+$/i.test(label)) return true;
        if (existingStyle === 'CONSTITUENT_LABEL' && /^\([a-z]\)$/i.test(label)) return true;
        return false;
      });
      
      if (hasOldStyleLabels) {
        styleChangeWarning = `Patent type changed to ${patentTypePrimary} (requires ${derivedStyle} labels) but components have ${existingStyle} labels. Labels will be automatically re-assigned to match the new patent type.`;
        console.warn(`[ComponentMap] ${styleChangeWarning}`);
      }
    }
  }

  // Pre-process components to normalize before validation
  const normalizedComponents = (components || []).map((comp: any) => {
    const validTypes = ['MAIN_CONTROLLER', 'SUBSYSTEM', 'MODULE', 'INTERFACE', 'SENSOR', 'ACTUATOR', 'PROCESSOR', 'MEMORY', 'DISPLAY', 'COMMUNICATION', 'POWER_SUPPLY', 'OTHER'];
    return {
      ...comp,
      type: validTypes.includes(comp?.type) ? comp.type : 'OTHER',
      description: typeof comp?.description === 'string' ? comp.description : '',
      name: typeof comp?.name === 'string' ? comp.name : '',
      id: typeof comp?.id === 'string' ? comp.id : `comp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ...(autoAssign ? { numeral: undefined, referenceLabel: undefined } : {})
    };
  });

  // Validate components and assign reference labels based on patent type + user override
  const validation = DraftingService.validateComponentMap(
    normalizedComponents,
    patentTypePrimary,
    numberingStyleOverride // User override (if provided)
  );

  if (!validation.valid) {
    console.error('Component map validation failed:', validation.errors);
    console.error('Components received (original):', JSON.stringify(components, null, 2));
    console.error('Components received (normalized):', JSON.stringify(normalizedComponents, null, 2));
    return NextResponse.json(
      {
        error: 'Component validation failed. Please check that all components have valid names and the hierarchy is correct.',
        details: validation.errors,
        code: 'INVALID_COMPONENT_MAP'
      },
      { status: 400 }
    );
  }

  // Create or update reference map with numbering style
  // Store numberingStyle alongside components in the JSON field (Prisma Json type)
  const referenceMapJson = {
    components: validation.components || [],
    numberingStyle: validation.numberingStyle || 'NUMERIC_BUCKET'
  };
  
  const referenceMap = await prisma.referenceMap.upsert({
    where: { sessionId },
    update: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      components: referenceMapJson as any,
      isValid: true,
      validationErrors: undefined
    },
    create: {
      sessionId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      components: referenceMapJson as any,
      isValid: true
    }
  });

  // Note: We don't automatically advance to FIGURE_PLANNER here
  // The user should manually proceed when ready

  return NextResponse.json({ 
    referenceMap: {
      ...referenceMap,
      components: validation.components, // Return the actual components array
      numberingStyle: validation.numberingStyle // Include in response for UI
    },
    // Include warning if numbering style changed due to patent type change
    ...(styleChangeWarning ? { 
      styleChangeWarning,
      previousStyle: (existingRefMap?.components as any)?.numberingStyle,
      newStyle: validation.numberingStyle
    } : {})
  });
}

async function handleValidateComponentPlanLLM(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, components = [] } = data
  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true, referenceMap: true }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const normalized = normalizeClaimsForSession((session.ideaRecord?.normalizedData as any) || {})
  const stage0Components = Array.isArray(normalized.components)
    ? normalized.components
    : Array.isArray((session.ideaRecord as any)?.components)
      ? (session.ideaRecord as any).components
      : []

  if (!stage0Components.length) {
    return NextResponse.json({ error: 'No Stage 0 components are available to review.' }, { status: 400 })
  }

  const claimsSnapshot = getAuthoritativeClaims(normalized)
  const claimsStructured = claimsSnapshot.structured
  const claimsHtml = sanitizeClaimsHtml(claimsSnapshot.html) || structuredClaimsToHtml(claimsStructured)
  const claimsPlain = htmlToPlainText(claimsHtml)

  if (!claimsPlain) {
    return NextResponse.json({ error: 'Claims are required before AI component validation.' }, { status: 400 })
  }

  const currentComponents = Array.isArray(components) && components.length
    ? components
    : extractComponentsArray(session.referenceMap)
  const currentKeys = new Set(
    (Array.isArray(currentComponents) ? currentComponents : [])
      .map((component: any) => scopeElementKey(component?.name || component?.title || component?.label))
      .filter(Boolean)
  )

  const deterministicSeeds = componentsFromFrozenClaimsAndStage0({
    normalizedComponents: stage0Components,
    scopeRecommendations: normalized.scopeRecommendations,
    claims: claimsStructured,
    claimsText: claimsHtml,
  })
  const deterministicSupportByIndex = new Map<number, any>()
  deterministicSeeds.forEach((component: any) => {
    const index = component?.claimSupport?.stage0ComponentIndex
    if (Number.isInteger(index)) deterministicSupportByIndex.set(index, component.claimSupport)
  })

  const stage0List = stage0Components
    .map((component: any, index: number) => {
      const fields = [
        `index=${index}`,
        `name=${component?.name || component?.title || component?.label || 'Untitled component'}`,
        component?.description ? `description=${String(component.description).slice(0, 300)}` : '',
        component?.parent ? `parent=${component.parent}` : '',
        component?.type ? `type=${component.type}` : '',
      ].filter(Boolean)
      return `- ${fields.join(' | ')}`
    })
    .join('\n')

  const currentList = currentComponents.length
    ? currentComponents
        .map((component: any, index: number) => `- currentIndex=${index} | name=${component?.name || component?.title || component?.label || 'Untitled component'}${component?.referenceLabel || component?.numeral ? ` | ref=${component.referenceLabel || component.numeral}` : ''}`)
        .join('\n')
    : '- No current planner components.'

  const prompt = `You are a patent component-planning reviewer.
Use ONLY the Stage 0 component list below as the source of components. Do not invent components.
Compare the frozen/current claims with the current Component Planning list.
Return JSON only.

TASK:
1. Identify Stage 0 components that are relevant to the claims but missing from the current Component Planning list.
2. Flag claim terms that appear to need a component but cannot be mapped to any Stage 0 component.
3. Do not suggest ranges, conditions, use cases, environments, pure data fields, or unsupported abstractions as components.
4. If a currently missing item is not in Stage 0, put it in missingClaimTerms instead of creating a component.

OUTPUT JSON SHAPE:
{
  "summary": "short review summary",
  "addStage0ComponentIndexes": [
    {
      "index": 0,
      "matchedClaims": [1],
      "claimRole": "claim_1",
      "confidence": "high",
      "matchedText": "claim phrase or component name",
      "reason": "why this Stage 0 component should be added"
    }
  ],
  "missingClaimTerms": [
    {
      "term": "claim term not found in Stage 0 components",
      "claimNumbers": [1],
      "reason": "why manual review may be needed"
    }
  ],
  "warnings": []
}

Allowed claimRole values: claim_1, dependent_claim.
Allowed confidence values: high, medium, low.
Use zero-based Stage 0 indexes exactly as listed. If no additions are needed, return an empty addStage0ComponentIndexes array.

CLAIMS:
${claimsStructured.length ? JSON.stringify(claimsStructured, null, 2).slice(0, 6000) : claimsPlain.slice(0, 6000)}

CURRENT COMPONENT PLANNING LIST:
${currentList}

STAGE 0 COMPONENT LIST:
${stage0List}`

  const result = await llmGateway.executeLLMOperation({ headers: requestHeaders || {} }, {
    taskCode: 'LLM3_DIAGRAM',
    stageCode: 'DRAFT_DIAGRAM_GENERATION',
    prompt,
    idempotencyKey: crypto.randomUUID(),
    inputTokens: 6000,
    parameters: {
      maxOutputTokens: 3000
    },
    metadata: {
      patentId,
      sessionId,
      purpose: 'validate_component_plan_llm'
    }
  })

  if (!result.success || !result.response) {
    return NextResponse.json({ error: result.error?.message || 'AI component validation failed' }, { status: 400 })
  }

  let review: any
  try {
    const text = String(result.response.output || '').trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object found')
    review = JSON.parse(text.substring(start, end + 1))
  } catch (error) {
    console.error('[ComponentPlanLLM] Failed to parse response:', error)
    return NextResponse.json({ error: 'AI component validation returned an invalid format.' }, { status: 400 })
  }

  const reviewedAt = new Date().toISOString()
  const suggestions = (Array.isArray(review?.addStage0ComponentIndexes) ? review.addStage0ComponentIndexes : [])
    .map((item: any) => ({
      ...item,
      index: Number.isInteger(item?.index) ? item.index : Number.isInteger(item?.stage0Index) ? item.stage0Index : Number(item?.index)
    }))
    .filter((item: any) => Number.isInteger(item.index) && item.index >= 0 && item.index < stage0Components.length)
    .filter((item: any) => {
      const component = stage0Components[item.index]
      const key = scopeElementKey(component?.name || component?.title || component?.label)
      return key && !currentKeys.has(key)
    })
    .map((item: any) => {
      const component = stage0Components[item.index]
      const matchedClaims = Array.isArray(item.matchedClaims)
        ? item.matchedClaims.map((value: any) => Number(value)).filter((value: number) => Number.isFinite(value) && value > 0)
        : []
      const baseSupport = deterministicSupportByIndex.get(item.index) || {}
      return {
        ...component,
        sequence: typeof component?.sequence === 'number' ? component.sequence : item.index + 1,
        claimSupport: {
          ...baseSupport,
          source: 'frozen_claims',
          basis: baseSupport.basis || 'stage0_component_claim_match',
          matchedClaims: matchedClaims.length ? matchedClaims : baseSupport.matchedClaims || [],
          claimRole: item.claimRole === 'claim_1' ? 'claim_1' : 'dependent_claim',
          confidence: ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : baseSupport.confidence || 'medium',
          matchedText: String(item.matchedText || baseSupport.matchedText || component?.name || component?.title || component?.label || ''),
          reason: String(item.reason || baseSupport.reason || 'AI review found this Stage 0 component relevant to the claims.'),
          stage0ComponentIndex: item.index,
          llmScope: baseSupport.llmScope,
          llmReview: {
            source: 'component_planning_llm',
            taskCode: 'LLM3_DIAGRAM',
            stageCode: 'DRAFT_DIAGRAM_GENERATION',
            reviewedAt,
            reason: String(item.reason || 'AI component-plan validation suggested this Stage 0 component.')
          }
        }
      }
    })

  const missingClaimTerms = Array.isArray(review?.missingClaimTerms)
    ? review.missingClaimTerms.slice(0, 20).map((item: any) => ({
        term: String(item?.term || '').trim(),
        claimNumbers: Array.isArray(item?.claimNumbers)
          ? item.claimNumbers.map((value: any) => Number(value)).filter((value: number) => Number.isFinite(value) && value > 0)
          : [],
        reason: String(item?.reason || '').trim()
      })).filter((item: any) => item.term)
    : []

  const warnings = Array.isArray(review?.warnings)
    ? review.warnings.map((warning: any) => String(warning || '').trim()).filter(Boolean).slice(0, 20)
    : []

  return NextResponse.json({
    summary: String(review?.summary || '').trim(),
    suggestedComponents: suggestions,
    missingClaimTerms,
    warnings,
    llmControl: {
      taskCode: 'LLM3_DIAGRAM',
      stageCode: 'DRAFT_DIAGRAM_GENERATION'
    }
  })
}

async function handleSkipFigures(user: any, patentId: string, data: any) {
  const { sessionId } = data
  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const updated = await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      status: 'ANNEXURE_DRAFT',
      figuresSkipped: true,
      figuresSkippedAt: new Date(),
      figureSequence: [],
      figureSequenceFinalized: false
    } as any
  })

  return NextResponse.json({ success: true, session: updated })
}

async function handleRestoreFigures(user: any, patentId: string, data: any) {
  const { sessionId } = data
  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const updated = await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      figuresSkipped: false,
      figuresSkippedAt: null
    } as any
  })

  return NextResponse.json({ success: true, session: updated })
}

async function handleUpdateFigurePlan(user: any, patentId: string, data: any) {
  const { sessionId, figureNo, title, nodes, edges, description } = data;

  if (!sessionId || !figureNo || !title) {
    return NextResponse.json(
      { error: 'Session ID, figure number, and title are required' },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  const cleanedTitle = sanitizeFigureTitleInput(title) || `Figure ${figureNo}`

  // Create or update figure plan
  const figurePlan = await prisma.figurePlan.upsert({
    where: {
      sessionId_figureNo: {
        sessionId,
        figureNo
      }
    },
    update: {
      title: cleanedTitle,
      nodes,
      edges,
      description
    },
    create: {
      sessionId,
      figureNo,
      title: cleanedTitle,
      nodes,
      edges,
      description
    }
  });

  await reactivateFiguresForSession(sessionId)

  // Update session status if this is the first figure
  const figureCount = await prisma.figurePlan.count({ where: { sessionId } });
  if (figureCount === 1) {
    await prisma.draftingSession.update({
      where: { id: sessionId },
      data: { status: 'FIGURE_PLANNER' }
    });
  }

  return NextResponse.json({ figurePlan });
}

async function handleTestPQAIKey() {
  // Direct patent search service only
  const token = process.env.PQAI_API_TOKEN || process.env.PQAI_TOKEN || ''
  if (!token) {
    return NextResponse.json({ keyPresent: false, message: 'No Patent Search Service token configured.' })
  }

  const baseUrl = 'https://api.projectpq.ai/search/102'
  const params = new URLSearchParams({ q: 'drone navigation system', n: '1', type: 'patent', snip: '1', token })
  const url = `${baseUrl}?${params.toString()}`

  console.log('Testing Patent Search Service:', { url, hasToken: !!token, tokenLength: token.length })

  try {
    const controller = new AbortController()
    const to = setTimeout(() => controller.abort(), 8000)
    const resp = await fetch(url, { method: 'GET', signal: controller.signal })
    clearTimeout(to)
    const text = await resp.text()
    console.log('Patent Search Service test response:', { status: resp.status, statusText: resp.statusText, bodyPreview: text.substring(0, 200) })
    return NextResponse.json({
      keyPresent: true,
      usingDirect: true,
      testStatus: resp.status,
      testOk: resp.ok,
      method: 'GET',
      url,
      responseText: text.substring(0, 300),
      message: resp.ok ? 'Patent Search Service call succeeded' : `Patent Search Service call returned ${resp.status}: ${resp.statusText}`
    })
  } catch (e) {
    console.log('Patent Search Service test network error:', e)
    return NextResponse.json({ keyPresent: true, usingDirect: true, testStatus: 'error', error: 'Network error', message: 'Network error calling Patent Search Service test endpoint' })
  }
}

async function handleMockRelatedArtSearch() {
  // Mock response for testing UI functionality
  const mockResults = [
    {
      title: "Autonomous drone navigation system with landmark recognition",
      pn: "US20210012345A1",
      snippet: "A system for autonomous navigation of unmanned aerial vehicles using computer vision to identify and track visual landmarks in real-time.",
      publication_date: "2021-01-15",
      score: 0.89
    },
    {
      title: "Machine learning-based object detection for UAV applications",
      pn: "US20200098765A1",
      snippet: "Method and apparatus for detecting objects in aerial imagery using convolutional neural networks trained on diverse datasets.",
      publication_date: "2020-03-22",
      score: 0.76
    },
    {
      title: "Wireless communication protocol for drone swarms",
      pn: "US20190087654A1",
      snippet: "Communication system enabling coordinated operation of multiple unmanned aerial vehicles through mesh networking protocols.",
      publication_date: "2019-11-08",
      score: 0.65
    },
    {
      title: "Battery management system for extended flight duration",
      pn: "US20180076543A1",
      snippet: "Power management apparatus that optimizes battery usage in drones through predictive algorithms and thermal regulation.",
      publication_date: "2018-07-14",
      score: 0.58
    }
  ]

  // Mock run creation
  const mockRunId = `mock_${Date.now()}`
  console.log('Returning mock related art search results for UI testing')

  return NextResponse.json({ runId: mockRunId, results: mockResults })
}

async function handleRelatedArtSearchFromProviders(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, limit = 15, queryOverride, afterDate } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true },
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const idea = session.ideaRecord as any
  const searchQueryFromDB = (idea?.searchQuery || '').toString().trim()
  const baseQuery = (queryOverride && String(queryOverride).trim().length > 0)
    ? String(queryOverride).trim()
    : searchQueryFromDB

  if (!baseQuery) {
    return NextResponse.json({
      error: 'No search query available. Please complete Stage 1 first to generate a search query.',
      showMockOption: true,
    }, { status: 400 })
  }

  const safeQuery = normalizeRelatedArtSearchText(baseQuery)
  const safeLimit = Math.min(Math.max(10, Number(limit) || 15), 100)
  const sourceMode = normalizeRelatedArtSourceMode((data as any)?.sourceMode)
  const requestedProviderIds = normalizeRelatedArtProviderIds((data as any)?.providerIds)
  const skipTrigramSearch = (data as any)?.skipTrigramSearch === true
  const publicationDateFrom = normalizeRelatedArtDateText(afterDate)
  const filters: PatentSearchFilters = publicationDateFrom ? { publicationDateFrom } : {}
  const searchContext = buildDraftingRelatedArtSearchPlan(idea, safeQuery, filters) as Partial<PatentSearchQueryPlan> & { inventionText?: string }
  const { inventionText, ...queryPlan } = searchContext
  const jurisdiction = String((session as any).activeJurisdiction || (session as any).draftingJurisdictions?.[0] || 'IN').toUpperCase()

  console.log('Drafting related art provider search:', {
    sourceMode,
    requestedProviderIds,
    skipTrigramSearch,
    queryPreview: safeQuery.substring(0, 120),
    limit: safeLimit,
    after: publicationDateFrom,
    jurisdiction,
    featureQueries: Array.isArray(queryPlan.retrievalQueries) ? queryPlan.retrievalQueries.length : 0,
  })

  let searchResponse
  try {
    searchResponse = await patentSearchOrchestrator.search({
      searchMode: 'intelligent',
      query: safeQuery,
      title: idea?.title || '',
      inventionText: inventionText || idea?.rawInput || idea?.abstract || '',
      filters,
      jurisdictions: [jurisdiction],
      sourceMode,
      providerIds: requestedProviderIds,
      llmExpansion: false,
      queryPlan,
      limit: safeLimit,
      requestHeaders,
      skipTrigramSearch,
    })
  } catch (error) {
    console.error('Drafting related art provider search failed:', error)
    return NextResponse.json({
      error: 'Patent search failed. Please retry the search later.',
      details: error instanceof Error ? error.message : String(error),
      showMockOption: true,
    }, { status: 502 })
  }

  const results = searchResponse.results
    .map(toDraftingRelatedArtResult)
    .filter(result => matchesRelatedArtAfterDate(result, publicationDateFrom))
    .slice(0, safeLimit)

  const patentNumbers = results
    .map((r: any) => r.publication_number || r.patent_number || r.pn || r.publicationNumber || r.id || 'N/A')
    .filter((pn: any) => pn !== 'N/A')
  const uniquePatentNumbers = Array.from(new Set(patentNumbers))

  console.log('Drafting related art provider search completed:', {
    resultCount: results.length,
    uniquePatentNumbers: uniquePatentNumbers.length,
    providerStats: searchResponse.providerStats,
    warnings: searchResponse.warnings,
  })

  const paramsJson = {
    endpoint: 'patent-search-orchestrator',
    sourceMode,
    requestedProviderIds,
    providerIds: searchResponse.providerStats.map(stat => stat.providerId),
    providerStats: searchResponse.providerStats,
    warnings: searchResponse.warnings,
    limit: safeLimit,
    after: publicationDateFrom,
    skipTrigramSearch,
    queryPlan: searchResponse.queryPlan,
  }

  const run = await (prisma as any).relatedArtRun.create({
    data: {
      sessionId,
      queryText: safeQuery,
      paramsJson,
      resultsJson: results,
      ranBy: user.id,
    },
  })

  return NextResponse.json({
    runId: run.id,
    results,
    providerStats: searchResponse.providerStats,
    searchWarnings: searchResponse.warnings,
    queryPlan: searchResponse.queryPlan,
    searchSource: {
      mode: sourceMode,
      requestedProviderIds,
      providerIds: searchResponse.providerStats.map(stat => stat.providerId),
      searchMode: 'intelligent',
    },
  })
}

async function handleRelatedArtSearch(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, limit = 15, queryOverride, afterDate } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id }, include: { ideaRecord: true } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Use only the searchQuery field from Stage 1 (compact, optimized for patent search)
  const idea = session.ideaRecord as any
  const searchQueryFromDB = (idea?.searchQuery || '').toString().trim()

  // Use provided queryOverride if given, otherwise use the stored searchQuery
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â API Query Debug:')
  console.log('  - queryOverride received:', queryOverride)
  console.log('  - queryOverride type:', typeof queryOverride)
  console.log('  - queryOverride trimmed:', queryOverride ? String(queryOverride).trim() : 'null')
  console.log('  - searchQueryFromDB:', searchQueryFromDB)

  const baseQuery = (queryOverride && String(queryOverride).trim().length>0)
    ? String(queryOverride).trim()
    : searchQueryFromDB

  console.log('  - Final baseQuery:', baseQuery)
  console.log('  - Using queryOverride?', queryOverride && String(queryOverride).trim().length>0)

  // If no query available, return error
  if (!baseQuery) {
    return NextResponse.json({
      error: 'No search query available. Please complete Stage 1 first to generate a search query.',
      showMockOption: true
    }, { status: 400 })
  }

  // Simple normalization for the patent search service (keep it compact as per Stage 1 design)
  // - remove most punctuation except hyphens
  // - collapse whitespace
  // - keep it short to avoid server errors
  let safeQuery = baseQuery
    .replace(/[\u2013\u2014]/g, '-')       // en/em dash ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ hyphen
    .replace(/[\u2018\u2019\u201C\u201D]/g, '"') // curly quotes ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ plain
    .replace(/[^\w\s-]/g, ' ')             // strip punctuation except hyphen
    .replace(/-/g, ' ')                      // turn hyphens into spaces to avoid tokenization issues
    .replace(/\s+/g, ' ')                   // collapse whitespace
    .trim()
  // Constrain to first 20 words (keep it compact per Stage 1 design and avoid service errors)
  const words = safeQuery.split(/\s+/)
  if (words.length > 20) safeQuery = words.slice(0, 20).join(' ')

  // Direct patent search service only
  const token = process.env.PQAI_API_TOKEN || process.env.PQAI_TOKEN || ''
  if (!token) return NextResponse.json({ error: 'No Patent Search Service token configured.' }, { status: 500 })

  // Patent search service endpoint: GET /search/102 with query parameters
  const baseUrl = 'https://api.projectpq.ai/search/102'

  const params = new URLSearchParams({
    q: safeQuery,
    n: String(Math.min(Math.max(10, limit), 50)),
    type: 'patent' // Only return patents, not research papers (NPL)
  })

  // Optional date filter - only add if user specifies
  if (afterDate && typeof afterDate === 'string' && afterDate.trim()) {
    params.set('after', afterDate.trim())
  }

  // Add token as query parameter for direct API
  params.set('token', token)

  const url = `${baseUrl}?${params.toString()}`

  // Debug: Log the final URL components
  console.log('Patent Search Service request debug:', {
    baseUrl,
    queryLength: safeQuery.length,
    originalQueryLength: baseQuery.length,
    paramsCount: Array.from(params.entries()).length,
    hasToken: !!token,
    finalUrlLength: url.length,
    filters: 'type=patent' // Confirm patent-only filtering
  })

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }

  console.log('Patent Search Service search:', {
    url,
    queryPreview: safeQuery.substring(0, 100) + '...',
    limit,
    hasToken: !!token,
    tokenLength: token.length
  })

  // Single API call per search (one API credit usage) with fetch + tighter headers and timeout
  let resp: Response | null = null
  try {
    const controller = new AbortController()
    const to = setTimeout(() => controller.abort(), 15000)
    resp = await fetch(url, { method: 'GET', headers, signal: controller.signal, cache: 'no-store' })
    clearTimeout(to)
    console.log('Patent Search Service search result:', { status: resp.status, url: url.substring(0, 120) + '...' })
  } catch (e) {
    console.log('Patent Search Service network error:', e)
    return NextResponse.json({ error: 'Network error contacting Patent Search Service', details: 'Network request failed' }, { status: 502 })
  }

  if (!resp || !resp.ok) {
    let errorMsg = 'Patent Search Service request failed'
    let details: string | undefined
    let shouldShowMockOption = false

    if (resp) {
      errorMsg += ` (HTTP ${resp.status})`

      if (resp.status === 500) {
        errorMsg = 'Patent Search Service server error - the service may be temporarily unavailable'
        shouldShowMockOption = true
      } else if (resp.status === 401 || resp.status === 403) {
        errorMsg = 'Patent Search Service authentication failed'
      } else if (resp.status === 429) {
        errorMsg = 'Patent Search Service rate limit exceeded - please try again later'
      }
      try {
        const errorText = await resp.text()
        details = errorText
          ? errorText
              .replace(/PQAI API/gi, 'Patent Search Service')
              .replace(/PQAI/gi, 'Patent Search Service')
          : undefined
        if (errorText.includes('Server error while handling request')) {
          errorMsg = 'Patent Search Service is currently experiencing server issues. Please try again later.'
          shouldShowMockOption = true
        }
      } catch {}
    }

    console.log('Patent Search Service error:', { status: resp?.status, error: errorMsg, details })

    return NextResponse.json({
      error: errorMsg,
      details,
      showMockOption: shouldShowMockOption,
      apiStatus: resp?.status || 'unknown'
    }, { status: 502 })
  }

  let dataJson: any = {}
  try { dataJson = await resp.json() } catch (e) { console.log('Failed to parse JSON response:', e) }

  console.log('Patent Search Service full response:', JSON.stringify(dataJson, null, 2))

  // Try multiple possible result locations
  let results = []
  if (Array.isArray(dataJson?.results)) {
    results = dataJson.results
  } else if (Array.isArray(dataJson?.data)) {
    results = dataJson.data
  } else if (Array.isArray(dataJson)) {
    results = dataJson
  }

  console.log('Patent Search Service success - results count:', results.length, 'response keys:', Object.keys(dataJson))
  console.log('First result sample:', results[0] ? Object.keys(results[0]) : 'No results')
  if (results[0]) {
    console.log('First result data:', JSON.stringify(results[0], null, 2))
    console.log('Patent number fields in first result:', {
      pn: results[0].pn,
      patent_number: results[0].patent_number,
      publication_number: results[0].publication_number,
      publication_id: results[0].publication_id,
      publicationId: results[0].publicationId,
      patentId: results[0].patentId,
      patent_id: results[0].patent_id,
      id: results[0].id
    })
  }

  // Check for unique patent numbers
  const patentNumbers = results.map((r: any) => r.publication_number || r.patent_number || r.pn || r.publication_id || r.publicationId || r.patentId || r.patent_id || r.id || 'N/A').filter((pn: any) => pn !== 'N/A')
  const uniquePatentNumbers = Array.from(new Set(patentNumbers))
  console.log('Patent numbers found:', patentNumbers.length, 'unique:', uniquePatentNumbers.length)
  if (patentNumbers.length !== uniquePatentNumbers.length) {
    console.log('WARNING: Duplicate patent numbers detected!')
  }

  // Persist run
  const run = await (prisma as any).relatedArtRun.create({ data: { sessionId, queryText: safeQuery, paramsJson: { endpoint: baseUrl, limit: Math.min(Math.max(10, limit), 50), after: afterDate || undefined }, resultsJson: results, ranBy: user.id } })

  return NextResponse.json({ runId: run.id, results })
}

async function handleRelatedArtSelect(user: any, patentId: string, data: any) {
  const { sessionId, runId, selections } = data
  if (!sessionId || !Array.isArray(selections)) return NextResponse.json({ error: 'sessionId and selections[] required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const created: any[] = []
  for (const sel of selections) {
    try {
      const rec = await (prisma as any).relatedArtSelection.upsert({
        where: {
          sessionId_patentNumber_runId: {
            sessionId,
            patentNumber: String(sel.patent_number || sel.pn || '').trim(),
            runId: runId || null
          }
        },
        update: {
          title: sel.title || undefined,
          snippet: sel.snippet || undefined,
          score: typeof sel.score === 'number' ? sel.score : undefined,
          tags: Array.isArray(sel.tags) ? sel.tags : [],
          userNotes: sel.user_notes || undefined,
          publicationDate: sel.publication_date || undefined,
          cpcCodes: sel.cpc_codes || undefined,
          ipcCodes: sel.ipc_codes || undefined,
          inventors: sel.inventors || undefined,
          assignees: sel.assignees || undefined
        },
        create: {
          sessionId,
          runId: runId || null,
          patentNumber: String(sel.patent_number || sel.pn || '').trim(),
          title: sel.title || undefined,
          snippet: sel.snippet || undefined,
          score: typeof sel.score === 'number' ? sel.score : undefined,
          tags: Array.isArray(sel.tags) ? sel.tags : [],
          userNotes: sel.user_notes || undefined,
          publicationDate: sel.publication_date || undefined,
          cpcCodes: sel.cpc_codes || undefined,
          ipcCodes: sel.ipc_codes || undefined,
          inventors: sel.inventors || undefined,
          assignees: sel.assignees || undefined
        }
      })
      created.push(rec)
    } catch (e) {
      // ignore duplicates errors due to constraint race
    }
  }

  return NextResponse.json({ saved: created.length })
}

/**
 * Diagram type definitions with syntax guides
 */
type DiagramType = 'block' | 'activity' | 'sequence' | 'state' | 'constituent'
type PatentTypePrimary = 'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION'
type InventionArchetype = 'MECHANICAL' | 'ELECTRICAL' | 'SOFTWARE' | 'CHEMICAL' | 'BIO' | 'GENERAL'

interface DiagramTypeInfo {
  type: DiagramType
  name: string
  description: string
  syntaxGuide: string
  exampleCode: string
}

/**
 * Figure plan output from planDiagramTypes
 */
interface FigurePlanEntry {
  figureNo: number
  type: DiagramType
  purpose: string
  reason: string  // Why this diagram type was selected
}

const DIAGRAM_TYPES: Record<DiagramType, DiagramTypeInfo> = {
  block: {
    type: 'block',
    name: 'Block/Component Diagram',
    description: 'Shows system architecture with components and their relationships',
    syntaxGuide: `Use rectangle, component, or package elements connected with arrows.
- Define components: rectangle "Name (numeral)" as Alias or component "Name (numeral)" as Alias
- IMPORTANT: Numerals MUST be in parentheses, e.g., "Controller (100)" not "Controller 100"
- Connect components: A --> B or A -down-> B (NO labels on arrows - labels cause visual clutter)
- Group related items: package "Group" { ... }
- FORBIDDEN: Do NOT add labels/text after arrows (e.g., NO "A --> B : label")`,
    exampleCode: `@startuml
rectangle "Controller (100)" as C100
rectangle "Processor (200)" as P200
rectangle "Memory (300)" as M300

C100 -down-> P200
P200 -right-> M300
@enduml`
  },
  activity: {
    type: 'activity',
    name: 'Activity/Flowchart Diagram',
    description: 'Shows linear method steps and process flow',
    syntaxGuide: `Use activity diagram syntax for method/process claims.
- CRITICAL: Do NOT use rectangles for flow/method diagrams. Use ONLY activity syntax (:action;).
- Do NOT wrap flow steps in rectangle blocks - this causes rendering issues.
- Start: start
- End: stop
- Actions: :Action description (ref);
- Reference format depends on patent type:
  * SYSTEM/PRODUCT: use numeric refs e.g., "processor (200)"
  * PROCESS: use step labels e.g., "receive data (S100)"
- IMPORTANT: References MUST be in parentheses
- Flow arrows are automatic between actions - do NOT add explicit arrows between steps
- Notes: Do NOT use "note" elements, "rectangle", or "package" in activity diagrams`,
    exampleCode: `@startuml
start
:Receive input data via sensor (110);
:Process data in processor (200);
:Store in memory (300);
:Generate output via display (400);
stop
@enduml`
  },
  sequence: {
    type: 'sequence',
    name: 'Sequence Diagram',
    description: 'Shows message ordering and timing between components',
    syntaxGuide: `Use sequence diagram syntax for communication protocols.
- Participants: participant "Name (numeral)" as Alias
- IMPORTANT: Numerals MUST be in parentheses, e.g., "Client (100)" not "Client 100"
- Messages: A -> B or A --> B (NO labels on arrows)
- Return: A <-- B
- FORBIDDEN: Arrow labels that cause visual overlap`,
    exampleCode: `@startuml
participant "Client (100)" as C
participant "Server (200)" as S
participant "Database (300)" as D

C -> S
S -> D
D --> S
S --> C
@enduml`
  },
  state: {
    type: 'state',
    name: 'State Diagram',
    description: 'Shows states and transitions for state machines',
    syntaxGuide: `Use state diagram syntax for state machines and control logic.
- Initial state: [*] --> StateName
- Final state: StateName --> [*]
- States: state "Description (numeral)" as StateName
- IMPORTANT: Numerals MUST be in parentheses, e.g., "Idle State (100)" not "Idle State 100"
- Transitions: StateA --> StateB (NO labels - labels cause visual clutter and overlap)`,
    exampleCode: `@startuml
[*] --> Idle

state "Idle State (100)" as Idle
state "Processing (200)" as Proc
state "Complete (300)" as Done

Idle --> Proc
Proc --> Done
Proc --> Idle
Done --> [*]
@enduml`
  },
  constituent: {
    type: 'constituent',
    name: 'Constituent/Formulation Diagram',
    description: 'Shows composition constituents and their relationships/proportions',
    syntaxGuide: `Use structured layout for composition/formulation claims.
- Use packages/rectangles to show constituent groups
- Show relationships between constituents (not physical connections)
- Reference labels use (a), (b), (c) format for COMPOSITION patents
- IMPORTANT: Labels MUST be in parentheses format, e.g., "Active Agent (a)" not "Active Agent a"
- Show proportions/ratios only if specified in claims
- FORBIDDEN: Do NOT add labels/text after arrows (e.g., NO "A --> B : label")`,
    exampleCode: `@startuml
package "Formulation" {
  rectangle "Active Agent (a)" as A
  rectangle "Carrier (b)" as B
  rectangle "Stabilizer (c)" as C
  rectangle "Excipient (d)" as D
}

A -down-> B
B -right-> C
C -down-> D
@enduml`
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATENT-TYPE-FIRST DIAGRAM PLANNING (SRS v2)
// ═══════════════════════════════════════════════════════════════════════════════
// Priority Order:
// 1. Patent Type → decides diagram family (block vs activity vs constituent)
// 2. Archetype → refines diagram subtype + naming (ONLY for SYSTEM/PRODUCT)
// ═══════════════════════════════════════════════════════════════════════════════

interface ClaimSignals {
  hasMethodClaims: boolean
  hasSystemClaims: boolean
  hasSequenceConcepts: boolean
  hasStateConcepts: boolean
  hasPreparationSteps: boolean  // For COMPOSITION
}

/**
 * Extract claim signals from claims for diagram planning
 */
function extractClaimSignals(
  claims: Array<{ number: number; type: string; text: string; category?: string }> | null,
  claimsText: string | null
): ClaimSignals {
  const signals: ClaimSignals = {
    hasMethodClaims: false,
    hasSystemClaims: false,
    hasSequenceConcepts: false,
    hasStateConcepts: false,
    hasPreparationSteps: false
  }
  
  const methodKeywords = /\b(method|process|step|receiving|transmitting|generating|determining|calculating|storing|retrieving|sending|comparing|validating|executing|performing|operating)\b/i
  const sequenceKeywords = /\b(sequence|order|first|then|next|subsequently|before|after|prior to|following|response to|in response|message|signal|request|reply|handshake|protocol)\b/i
  const stateKeywords = /\b(state|mode|transition|idle|active|standby|sleep|wake|on|off|enabled|disabled|triggered|condition)\b/i
  const preparationKeywords = /\b(preparing|mixing|combining|dissolving|heating|cooling|incubating|reacting|formulating|compounding)\b/i
  
  if (claims && claims.length > 0) {
    for (const claim of claims) {
      const claimType = (claim.type || '').toLowerCase()
      const claimCategory = (claim.category || '').toLowerCase()
      const claimText = claim.text || ''
      
      if (claimType === 'method' || claimCategory === 'method' || claimType === 'process') {
        signals.hasMethodClaims = true
      }
      if (claimType === 'system' || claimType === 'apparatus' || claimType === 'device' || claimCategory === 'system') {
        signals.hasSystemClaims = true
      }
      if (sequenceKeywords.test(claimText)) signals.hasSequenceConcepts = true
      if (stateKeywords.test(claimText)) signals.hasStateConcepts = true
      if (preparationKeywords.test(claimText)) signals.hasPreparationSteps = true
    }
  } else if (claimsText) {
    signals.hasMethodClaims = methodKeywords.test(claimsText)
    signals.hasSystemClaims = /\b(system|apparatus|device|comprising|includes|configured to)\b/i.test(claimsText)
    signals.hasSequenceConcepts = sequenceKeywords.test(claimsText)
    signals.hasStateConcepts = stateKeywords.test(claimsText)
    signals.hasPreparationSteps = preparationKeywords.test(claimsText)
  }
  
  return signals
}

/**
 * MAIN DIAGRAM PLANNER: Patent-Type-First, Archetype-Enhanced
 * 
 * @param patentTypePrimary - Primary patent type (PRODUCT|SYSTEM|PROCESS|COMPOSITION)
 * @param archetype - Technical archetype (MECHANICAL|ELECTRICAL|SOFTWARE|CHEMICAL|BIO|GENERAL)
 * @param claimSignals - Extracted signals from claims
 * @param diagramCount - Number of diagrams to plan (default 5)
 */
function planDiagramTypes(
  patentTypePrimary: PatentTypePrimary | null | undefined,
  archetype: string,
  claimSignals: ClaimSignals,
  diagramCount: number = 5
): FigurePlanEntry[] {
  const plans: FigurePlanEntry[] = []
  
  // Normalize patent type (default to SYSTEM if not specified)
  const patentType = patentTypePrimary || 'SYSTEM'
  
  // ═══════════════════════════════════════════════════════════════════════════
  // BASE PLANS BY PATENT TYPE (PRIMARY DRIVER)
  // ═══════════════════════════════════════════════════════════════════════════
  
  if (patentType === 'PROCESS') {
    // PROCESS: Activity diagrams primary, block diagram optional for apparatus
    plans.push({
      figureNo: 1,
      type: 'activity',
      purpose: 'End-to-end method flowchart showing all process steps',
      reason: 'PROCESS patent type → Activity diagram as primary figure'
    })
    
    if (diagramCount >= 2) {
      plans.push({
        figureNo: 2,
        type: claimSignals.hasSystemClaims ? 'block' : 'activity',
        purpose: claimSignals.hasSystemClaims 
          ? 'Apparatus/system used in the method'
          : 'Expanded sub-flow showing detailed steps',
        reason: claimSignals.hasSystemClaims 
          ? 'PROCESS with system claims → Block diagram for apparatus'
          : 'PROCESS → Additional activity diagram for sub-flow'
      })
    }
    
    // Fill remaining with activity diagrams
    for (let i = plans.length; i < diagramCount; i++) {
      plans.push({
        figureNo: i + 1,
        type: 'activity',
        purpose: `Additional process flow or sub-method detail`,
        reason: 'PROCESS → Activity diagram baseline'
      })
    }
    
  } else if (patentType === 'COMPOSITION') {
    // COMPOSITION: Constituent diagram primary, activity only if preparation steps exist
    plans.push({
      figureNo: 1,
      type: 'constituent',
      purpose: 'Constituent/formulation diagram showing composition structure',
      reason: 'COMPOSITION patent type → Constituent diagram as primary figure'
    })
    
    if (diagramCount >= 2 && claimSignals.hasPreparationSteps) {
      plans.push({
        figureNo: 2,
        type: 'activity',
        purpose: 'Preparation/formulation process flow',
        reason: 'COMPOSITION with preparation steps → Activity diagram for preparation method'
      })
    } else if (diagramCount >= 2) {
      plans.push({
        figureNo: 2,
        type: 'constituent',
        purpose: 'Detailed constituent relationship or variant formulation',
        reason: 'COMPOSITION → Additional constituent diagram'
      })
    }
    
    // Fill remaining with constituent diagrams
    for (let i = plans.length; i < diagramCount; i++) {
      plans.push({
        figureNo: i + 1,
        type: 'constituent',
        purpose: `Additional formulation variant or constituent detail`,
        reason: 'COMPOSITION → Constituent diagram baseline'
      })
    }
    
  } else {
    // SYSTEM / PRODUCT: Block diagrams primary, enhanced by archetype
    plans.push({
      figureNo: 1,
      type: 'block',
      purpose: 'System/product architecture overview',
      reason: `${patentType} patent type → Block diagram as primary figure`
    })
    
    if (diagramCount >= 2) {
      plans.push({
        figureNo: 2,
        type: 'block',
        purpose: 'Subsystem or internal component layout',
        reason: `${patentType} → Block diagram for subsystem detail`
      })
    }
    
    // ═════════════════════════════════════════════════════════════════════════
    // ARCHETYPE ENHANCEMENT (ONLY FOR SYSTEM/PRODUCT)
    // ═════════════════════════════════════════════════════════════════════════
    
    if (diagramCount >= 3) {
      // Fig 3: Activity diagram ONLY if method-heavy signals exist
      if (claimSignals.hasMethodClaims) {
        plans.push({
          figureNo: 3,
          type: 'activity',
          purpose: 'Method/process flow for system operation',
          reason: `${patentType} with method claims → Activity diagram for operational flow`
        })
      } else {
        plans.push({
          figureNo: 3,
          type: 'block',
          purpose: 'Component deep-dive or subsystem detail',
          reason: `${patentType} → Block diagram for component detail`
        })
      }
    }
    
    if (diagramCount >= 4) {
      // Fig 4: Sequence diagram ONLY if SOFTWARE archetype + interaction signals
      if (archetype.includes('SOFTWARE') && claimSignals.hasSequenceConcepts) {
        plans.push({
          figureNo: 4,
          type: 'sequence',
          purpose: 'Message sequence showing component interactions',
          reason: `${patentType}+SOFTWARE archetype with sequence signals → Sequence diagram`
        })
      } else if ((archetype.includes('ELECTRICAL') || archetype.includes('SOFTWARE')) && claimSignals.hasStateConcepts) {
        plans.push({
          figureNo: 4,
          type: 'block',
          purpose: 'Operational mode component layout without state-machine transitions',
          reason: `${patentType}+${archetype} with state signals → Flattened to block diagram for patent-safe auto planning`
        })
      } else if (claimSignals.hasMethodClaims && plans.filter(p => p.type === 'activity').length < 2) {
        plans.push({
          figureNo: 4,
          type: 'activity',
          purpose: 'Additional method flow or operation sequence',
          reason: `${patentType} with method claims → Activity diagram`
        })
      } else {
        plans.push({
          figureNo: 4,
          type: 'block',
          purpose: 'Additional component or subsystem detail',
          reason: `${patentType} → Block diagram baseline`
        })
      }
    }
    
    // Fill remaining with block diagrams (PRODUCT+MECHANICAL preference)
    for (let i = plans.length; i < diagramCount; i++) {
      plans.push({
        figureNo: i + 1,
        type: 'block',
        purpose: 'Additional component detail or assembly breakdown',
        reason: `${patentType} → Block diagram baseline (no flowchart spam)`
      })
    }
  }
  
  return plans
}

/**
 * Get archetype-specific nomenclature tuning (SYSTEM/PRODUCT only)
 */
function getArchetypeNomenclature(archetype: string): { styleGuide: string; nomenclature: string } {
  let styleGuide = 'Use standard UML blocks.'
  let nomenclature = 'Use standard technical terms.'
  
  if (archetype.includes('SOFTWARE')) {
    styleGuide += ' Use Flowcharts (activity diagrams) or System Blocks (component diagrams).'
    nomenclature += ' Use: Module, Engine, Database, API, Interface, Server, Client (and similar logical units).'
  }
  if (archetype.includes('MECHANICAL')) {
    styleGuide += ' Use Block Definition Diagrams or Internal Block Diagrams (SysML style) to show physical parts.'
    nomenclature += ' Use: Housing, Shaft, Assembly, Coupler, Mechanism, Actuator (and similar physical components).'
  }
  if (archetype.includes('ELECTRICAL')) {
    styleGuide += ' Use high-level circuit blocks or signal flow diagrams.'
    nomenclature += ' Use: Circuit, Terminal, Bus, Transceiver, Node, Sensor (and similar electronic parts).'
  }
  if (archetype.includes('BIO') || archetype.includes('CHEMICAL')) {
    styleGuide += ' Use process flows or reaction schemas.'
    nomenclature += ' Use: Reagent, Compound, Stage, Phase, Catalyst, Reactor (and similar domain entities).'
  }
  
  return { styleGuide, nomenclature }
}

/**
 * Analyze claims to determine the best diagram type for each figure
 * Returns an array of recommended diagram types based on claim analysis
 */
function analyzeClaimsForDiagramTypes(
  claims: Array<{ number: number; type: string; text: string; category?: string }> | null,
  claimsText: string | null,
  diagramCount: number,
  archetype: string
): DiagramType[] {
  const recommendations: DiagramType[] = []
  
  // Keywords that suggest different diagram types
  const methodKeywords = /\b(method|process|step|receiving|transmitting|generating|determining|calculating|storing|retrieving|sending|comparing|validating|executing|performing|operating)\b/i
  const sequenceKeywords = /\b(sequence|order|first|then|next|subsequently|before|after|prior to|following|response to|in response|message|signal|request|reply|handshake|protocol)\b/i
  const stateKeywords = /\b(state|mode|transition|idle|active|standby|sleep|wake|on|off|enabled|disabled|triggered|condition)\b/i
  
  // Analyze structured claims if available
  let hasMethodClaims = false
  let hasSystemClaims = false
  let hasSequenceConcepts = false
  let hasStateConcepts = false
  
  if (claims && claims.length > 0) {
    for (const claim of claims) {
      const claimType = (claim.type || '').toLowerCase()
      const claimCategory = (claim.category || '').toLowerCase()
      const claimText = claim.text || ''
      
      if (claimType === 'method' || claimCategory === 'method' || claimType === 'process') {
        hasMethodClaims = true
      }
      if (claimType === 'system' || claimType === 'apparatus' || claimType === 'device' || claimCategory === 'system') {
        hasSystemClaims = true
      }
      if (sequenceKeywords.test(claimText)) {
        hasSequenceConcepts = true
      }
      if (stateKeywords.test(claimText)) {
        hasStateConcepts = true
      }
    }
  } else if (claimsText) {
    // Analyze plain text claims
    hasMethodClaims = methodKeywords.test(claimsText)
    hasSystemClaims = /\b(system|apparatus|device|comprising|includes|configured to)\b/i.test(claimsText)
    hasSequenceConcepts = sequenceKeywords.test(claimsText)
    hasStateConcepts = stateKeywords.test(claimsText)
  }
  
  // Build recommendations based on analysis
  // Fig 1: Always start with system overview (block diagram)
  recommendations.push('block')
  
  if (diagramCount >= 2) {
    // Fig 2: Primary subsystem or method flow
    if (hasMethodClaims) {
      recommendations.push('activity')
    } else {
      recommendations.push('block')
    }
  }
  
  if (diagramCount >= 3) {
    // Fig 3: Data/control flow or sequence
    if (hasSequenceConcepts && archetype.includes('SOFTWARE')) {
      recommendations.push('sequence')
    } else if (hasMethodClaims) {
      recommendations.push('activity')
    } else {
      recommendations.push('block')
    }
  }
  
  if (diagramCount >= 4) {
    // Fig 4: State diagram if relevant, otherwise continue pattern
    if (hasStateConcepts && (archetype.includes('ELECTRICAL') || archetype.includes('SOFTWARE'))) {
      recommendations.push('state')
    } else if (hasMethodClaims && recommendations.filter(r => r === 'activity').length < 2) {
      recommendations.push('activity')
    } else {
      recommendations.push('block')
    }
  }
  
  // Fill remaining with block diagrams (component deep-dives)
  while (recommendations.length < diagramCount) {
    recommendations.push('block')
  }
  
  return recommendations
}

/**
 * Build diagram-type specific instructions for the LLM prompt
 */
function buildDiagramTypeInstructions(diagramTypes: DiagramType[]): string {
  const uniqueTypes = Array.from(new Set(diagramTypes)) as DiagramType[]
  const lines: string[] = []
  
  lines.push('═══════════════════════════════════════════════════════════════════════════════')
  lines.push('DIAGRAM TYPE ASSIGNMENTS (Follow these for each figure)')
  lines.push('═══════════════════════════════════════════════════════════════════════════════')
  
  // Show assignment for each figure
  diagramTypes.forEach((type, idx) => {
    const info = DIAGRAM_TYPES[type]
    lines.push(`Fig.${idx + 1}: ${info.name} - ${info.description}`)
  })
  
  lines.push('')
  lines.push('═══════════════════════════════════════════════════════════════════════════════')
  lines.push('SYNTAX GUIDES FOR EACH DIAGRAM TYPE')
  lines.push('═══════════════════════════════════════════════════════════════════════════════')
  
  // Add syntax guide for each unique type used
  for (let i = 0; i < uniqueTypes.length; i++) {
    const type = uniqueTypes[i]
    const info = DIAGRAM_TYPES[type]
    lines.push('')
    lines.push(`--- ${info.name.toUpperCase()} ---`)
    lines.push(info.syntaxGuide)
    lines.push('')
    lines.push('Example:')
    lines.push(info.exampleCode)
  }
  
  return lines.join('\n')
}

/**
 * Build diagram-type instructions with planning reasons (Patent-Type-First SRS v2)
 * Shows why each diagram type was selected for transparency and debugging
 */
function buildDiagramTypeInstructionsWithReasons(figurePlans: FigurePlanEntry[]): string {
  const uniqueTypes = Array.from(new Set(figurePlans.map(fp => fp.type)))
  const lines: string[] = []
  
  lines.push('═══════════════════════════════════════════════════════════════════════════════')
  lines.push('DIAGRAM TYPE ASSIGNMENTS (Patent-Type-First Planning)')
  lines.push('═══════════════════════════════════════════════════════════════════════════════')
  
  // Show assignment for each figure with purpose and reason
  figurePlans.forEach((plan) => {
    const info = DIAGRAM_TYPES[plan.type]
    lines.push(`Fig.${plan.figureNo}: ${info.name}`)
    lines.push(`  Purpose: ${plan.purpose}`)
    lines.push(`  Reason: ${plan.reason}`)
  })
  
  lines.push('')
  lines.push('═══════════════════════════════════════════════════════════════════════════════')
  lines.push('SYNTAX GUIDES FOR EACH DIAGRAM TYPE')
  lines.push('═══════════════════════════════════════════════════════════════════════════════')
  
  // Add syntax guide for each unique type used
  for (const type of uniqueTypes) {
    const info = DIAGRAM_TYPES[type]
    lines.push('')
    lines.push(`--- ${info.name.toUpperCase()} ---`)
    lines.push(info.syntaxGuide)
    lines.push('')
    lines.push('Example:')
    lines.push(info.exampleCode)
  }
  
  return lines.join('\n')
}

/**
 * Build jurisdiction-specific diagram instructions from database config
 * This creates LLM-friendly instructions that honor patent office requirements
 */
async function buildJurisdictionDiagramInstructions(
  jurisdiction: string,
  config: any,
  diagramType: string = 'block'
): Promise<string> {
  const lines: string[] = []

  // Jurisdiction identification
  lines.push(`Target Jurisdiction: ${jurisdiction}`)
  
  // Figure labeling format
  if (config.figureLabelFormat) {
    lines.push(`Figure Label Format: Use "${config.figureLabelFormat}" format (e.g., ${config.figureLabelFormat.replace('{number}', '1')})`)
  }

  // Color requirements
  if (config.colorAllowed) {
    lines.push(`Color: Color diagrams ARE permitted for ${jurisdiction}`)
    if (config.colorUsageNote) {
      lines.push(`Color Note: ${config.colorUsageNote}`)
    }
  } else {
    lines.push(`Color: BLACK AND WHITE ONLY - No color, grayscale, or shading. Use solid black lines on white background.`)
  }

  // Line style
  if (config.lineStyle) {
    const styleMap: Record<string, string> = {
      'black_and_white_solid': 'Use solid black lines only (no dashed, dotted, or colored lines)',
      'solid': 'Use solid lines only',
      'dashed_allowed': 'Dashed lines are permitted where appropriate'
    }
    lines.push(`Line Style: ${styleMap[config.lineStyle] || config.lineStyle}`)
  }

  // Reference numerals
  if (config.referenceNumeralsMandatory) {
    lines.push(`Reference Numerals: MANDATORY - Every component must have a reference numeral (e.g., "Processor 100", "Memory 200")`)
  }

  // Text size requirements
  if (config.minReferenceTextSizePt) {
    lines.push(`Minimum Text Size: ${config.minReferenceTextSizePt}pt (ensure all labels are clearly readable)`)
  }

  // Paper size for context
  if (config.paperSize) {
    lines.push(`Target Paper Size: ${config.paperSize} (design diagrams to fit within standard margins)`)
  }

  // Add diagram-type specific hints from database
  if (config.hints && config.hints[diagramType]) {
    lines.push('')
    lines.push(`DIAGRAM TYPE INSTRUCTIONS (${diagramType}):`)
    lines.push(config.hints[diagramType])
  }

  // Add hints for other supported diagram types as fallback context
  if (config.hints && Object.keys(config.hints).length > 0) {
    const otherTypes = Object.entries(config.hints)
      .filter(([type]) => type !== diagramType)
      .slice(0, 2) // Limit to 2 other types
    
    if (otherTypes.length > 0) {
      lines.push('')
      lines.push('OTHER DIAGRAM STYLES (for reference):')
      for (const [type, hint] of otherTypes) {
        lines.push(`• ${type}: ${hint}`)
      }
    }
  }

  // Add supported diagram types
  if (config.supportedDiagramTypes && config.supportedDiagramTypes.length > 0) {
    lines.push('')
    lines.push(`Supported Diagram Types for ${jurisdiction}: ${config.supportedDiagramTypes.join(', ')}`)
  }

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 1: FIGURE PLANNING LLM
// ═══════════════════════════════════════════════════════════════════════════════
// This function analyzes the invention and creates a structured plan for figures.
// It decides: How many figures, what type each should be, and what content/perspective.
// The plan is then passed to Stage 2 (Generation) for PlantUML code creation.

// ═══════════════════════════════════════════════════════════════════════════════
// FIGURE PLANNING TYPES (Production-safe, zero diagram logic)
// ═══════════════════════════════════════════════════════════════════════════════

// Allowed diagram types for planning (whitelist - uppercase)
// Note: These map to generator DiagramType (lowercase) during code generation
// CONSTITUENT is for COMPOSITION patents (ingredients/formulations with (a), (b), (c) labels)
type PlanDiagramType = 'BLOCK' | 'FLOW' | 'SEQUENCE' | 'ACTIVITY' | 'CONSTITUENT'

// Single diagram plan item
interface FigurePlanItem {
  figure: string         // "FIG. 1", "FIG. 2", etc.
  type: PlanDiagramType  // One of the whitelisted types
  title: string          // Short, patent-style, non-logical
  include: string[]      // Components with numerals e.g., "Controller (100)", "Process in sensor (200)"
}

// Complete figure plan result
interface FigurePlanResult {
  diagrams: FigurePlanItem[]
  count: number
}

// Sketch suggestion (for separate sketch generation)
interface SketchSuggestion {
  title: string
  description: string
  sketchType: 'physical_device' | 'user_interaction' | 'exploded_view' | 'cross_section' | 'environment_context' | 'comparative'
}

/**
 * Parses and validates the LLM response into a FigurePlanResult.
 * Returns null if the response is invalid.
 */
function parseFigurePlan(rawPlan: any): FigurePlanResult | null {
  if (!rawPlan || !Array.isArray(rawPlan.diagrams) || rawPlan.diagrams.length === 0) {
    return null
  }

  const validTypes: PlanDiagramType[] = ['BLOCK', 'FLOW', 'SEQUENCE', 'ACTIVITY', 'CONSTITUENT']

  const diagrams: FigurePlanItem[] = rawPlan.diagrams.map((d: any, idx: number) => {
    const rawType = (d.type || 'BLOCK').toUpperCase() as PlanDiagramType
    const type: PlanDiagramType = validTypes.includes(rawType) ? rawType : 'BLOCK'
    
    return {
      figure: d.figure || `FIG. ${idx + 1}`,
      type,
      title: d.title || 'Untitled',
      include: Array.isArray(d.include) ? d.include : []
    }
  })

  return {
    diagrams,
    count: rawPlan.count || diagrams.length
  }
}

async function handlePlanFiguresLLM(
  user: any, 
  patentId: string, 
  data: any, 
  requestHeaders: Record<string, string>
): Promise<NextResponse> {
  const { sessionId, figureCount, figureRemarks } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  // Optional: User can override the AI's figure count decision
  // If figureCount is provided and valid (1-10), AI will plan exactly that many figures
  const userRequestedCount = typeof figureCount === 'number' && figureCount >= 1 && figureCount <= 10 
    ? figureCount 
    : null

  // Verify session
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { referenceMap: true, ideaRecord: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  await reactivateFiguresForSession(sessionId)

  // Get active jurisdiction
  const activeJurisdiction = (session as any).activeJurisdiction || 
    ((session as any).draftingJurisdictions?.[0]) || 'US'

  // Extract invention context
  const idea = normalizeClaimsForSession((session.ideaRecord?.normalizedData as any) || {})
  const figureScope = filterComponentsByScopeForFigures(
    extractComponentsArray(session.referenceMap),
    idea?.scopeRecommendations
  )
  const components = figureScope.components
  const figureScopeBlock = buildFigureScopePromptBlock(idea?.scopeRecommendations)
  const claimsSnapshot = getAuthoritativeClaims(idea)
  const claims = claimsSnapshot.structured
  const claimsText = claimsSnapshot.html
  const sourceFactLedgerBlock = buildSupportOrSourceFactBlock(
    idea,
    idea?.sourceFactLedger,
    'briefDescriptionOfDrawings',
    'SUPPORT DATA SOURCES FOR FIGURE PLANNING',
    'SOURCE FACT LEDGER FOR FIGURE PLANNING'
  )
  
  // Determine invention archetype
  const types = Array.isArray(idea?.inventionType) ? idea.inventionType : (idea?.inventionType ? [idea.inventionType] : [])
  const archetype = types.length > 0 ? types.join(' + ') : 'GENERAL'

  // Get patent type for diagram type selection
  const patentTypePrimary = (session as any).patentTypePrimary as 'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION' | null

  // Build components context with referenceLabel (universal across patent types)
  const componentsContext = components.length > 0
    ? components.map((c: any) => `- ${c.name} [ref=${c.referenceLabel || c.numeral || '?'}]${c.description ? ': ' + c.description : ''}`).join('\n')
    : 'No components defined yet.'
  const userFigureRemarksBlock = typeof figureRemarks === 'string' && figureRemarks.trim()
    ? `USER FIGURE REMARKS (MANDATORY):\n${figureRemarks.trim()}\n`
    : ''
  const claimLinkedComponentsContext = components
    .filter((c: any) => c?.claimSupport?.source === 'frozen_claims' && c?.claimSupport?.claimRole === 'claim_1')
    .map((c: any) => `- ${c.name} (${c.referenceLabel || c.numeral || '?'})`)
    .join('\n') || '- No claim-linked components identified for mandatory figure coverage.'

  // Build claims context
  let claimsContext = ''
  if (claims.length > 0) {
    claimsContext = claims.slice(0, 10).map((c: any) => 
      `Claim ${c.number} (${c.type || 'unknown'}): ${(c.text || '').substring(0, 300)}...`
    ).join('\n')
  } else if (claimsText) {
    claimsContext = claimsText.substring(0, 2000) + '...'
  } else {
    claimsContext = 'No claims available yet.'
  }

  // Build the planning prompt (PlantUML diagrams only - sketch suggestions are separate)
  // OPTIMIZED: Zero diagram logic, minimum entropy, maximum downstream reliability
  const planningPrompt = `═══════════════════════════════════════════════════════════════════════════════
PATENT FIGURE PLANNER
═══════════════════════════════════════════════════════════════════════════════

You are a PATENT FIGURE PLANNER, not a designer or illustrator.
Your job is to decide WHICH simple, patent-orthodox figures should exist,
NOT to design them, NOT to specify connections, and NOT to express logic.

The planner specifies WHAT appears together in a figure, not HOW they are connected.
Connections are the generator's job, not yours.

═══════════════════════════════════════════════════════════════════════════════
INVENTION CONTEXT
═══════════════════════════════════════════════════════════════════════════════
TITLE: ${idea?.title || 'Untitled Invention'}
PATENT TYPE: ${patentTypePrimary || 'SYSTEM'}
ARCHETYPE: ${archetype}
JURISDICTION: ${activeJurisdiction}

CRITICAL: The PATENT TYPE determines diagram type selection:
- COMPOSITION → Use CONSTITUENT diagrams (not BLOCK)
- PROCESS → Use FLOW or ACTIVITY diagrams
- SYSTEM/PRODUCT → Use BLOCK or SEQUENCE diagrams

PROBLEM SOLVED:
${idea?.problem || 'Not specified'}

TECHNICAL SOLUTION:
${idea?.logic || idea?.objectives || 'Not specified'}

${sourceFactLedgerBlock ? `${sourceFactLedgerBlock}\n` : ''}
${figureScopeBlock ? `${figureScopeBlock}\n` : ''}

COMPONENTS (with reference labels):
${componentsContext}

${userFigureRemarksBlock}
REQUIRED CLAIM-LINKED FIGURE COMPONENTS:
${claimLinkedComponentsContext}

NOTE: Reference labels vary by patent type:
- SYSTEM/PRODUCT: assigned numeric labels
- PROCESS: step labels (S100, S200, S300...)
- COMPOSITION: constituent labels ((a), (b), (c)...)

PATENT CLAIMS:
${claimsContext}

═══════════════════════════════════════════════════════════════════════════════
ALLOWED DIAGRAM TYPES (WHITELIST - Use ONLY these)
═══════════════════════════════════════════════════════════════════════════════

You may plan ONLY the following diagram types:

1. BLOCK — System-level architecture (components + subsystems). Use for SYSTEM/PRODUCT patents.
2. FLOW — Method overview using rectangles + arrows only. Use for PROCESS patents.
3. SEQUENCE — Flat interaction between major subsystems. Use for SYSTEM patents with interactions.
4. ACTIVITY — Linear activity steps (no decisions). Use for PROCESS patents.
5. CONSTITUENT — Formulation/composition diagram showing ingredients/constituents with (a), (b), (c) labels. MANDATORY for COMPOSITION patents.

PATENT TYPE → DIAGRAM TYPE MAPPING:
- COMPOSITION patents: Use CONSTITUENT type (not BLOCK)
- PROCESS patents: Use FLOW or ACTIVITY type
- SYSTEM/PRODUCT patents: Use BLOCK or SEQUENCE type

YOU MUST NOT PLAN:
- State diagrams
- Decision trees
- Error/fault diagrams
- Power-mode diagrams
- Any diagram requiring branching, looping, or concurrency

═══════════════════════════════════════════════════════════════════════════════
NO-COMPLEX-LOGIC RULE (MANDATORY - ABSOLUTE CONSTRAINT)
═══════════════════════════════════════════════════════════════════════════════

Planned diagrams must NOT include or imply:
- if / else logic
- decision points
- alternative paths
- loops, retries, or iterations
- concurrency or parallelism
- error, fault, or exception handling
- power or battery conditions

If an aspect of the invention requires such logic, it must be described in the
written specification, NOT in figures.

═══════════════════════════════════════════════════════════════════════════════
PLANNING RULES (DETERMINISTIC)
═══════════════════════════════════════════════════════════════════════════════

${userRequestedCount 
  ? `The user has requested EXACTLY ${userRequestedCount} diagrams. Plan exactly ${userRequestedCount} diagrams.` 
  : `DEFAULT DIAGRAM PLANNING (based on patent type):

FOR COMPOSITION/FORMULATION PATENTS (archetype includes CHEMICAL, BIO, or "composition"/"formulation" in claims):
1. FIG. 1 — CONSTITUENT (composition/formulation overview with ingredients)
2. FIG. 2 — ACTIVITY (preparation method if described in claims)
3. FIG. 3 — CONSTITUENT (variant or detailed ingredient relationship)
   Use (a), (b), (c) reference labels for constituents.

FOR PROCESS/METHOD PATENTS:
1. FIG. 1 — FLOW (method overview)
2. FIG. 2 — ACTIVITY (detailed steps)
3. FIG. 3 — SEQUENCE (if interaction between components exists)

FOR SYSTEM/PRODUCT PATENTS (default):
1. FIG. 1 — BLOCK (system architecture)
2. FIG. 2 — FLOW (method overview)
3. FIG. 3 — SEQUENCE (subsystem interaction)
4. FIG. 4 — ACTIVITY (linear steps)

If the invention is very simple, reduce to 3 diagrams.
Never plan more than 4 diagrams unless user explicitly requests more.`}

KEEP DIAGRAMS SMALL:
- BLOCK: 6–10 major components max
- SEQUENCE: 3–5 participants max
- FLOW / ACTIVITY: 5–8 steps max

═══════════════════════════════════════════════════════════════════════════════
COMPONENT SELECTION DISCIPLINE
═══════════════════════════════════════════════════════════════════════════════

When selecting items for "include", choose ONLY top-level functional components.
OMIT: diagnostics, logging, calibration, error handling, and optional features.

Across the full figure set, every required claim-linked component listed above MUST appear in at least one include[] list unless explicitly excluded from figures by USER-APPROVED FIGURE SCOPE.
After required claim-linked coverage is satisfied, keep diagrams simple.
Unclaimed approved registry components may also appear when useful for clarity.
If unsure whether a non-required element belongs in a diagram, OMIT IT.

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (MANDATORY - Return valid JSON only)
═══════════════════════════════════════════════════════════════════════════════

{
  "diagrams": [
    {
      "figure": "FIG. 1",
      "type": "BLOCK",
      "title": "System Architecture",
      "include": ["Controller (100)", "Processor (200)", "Memory (300)"]
    },
    {
      "figure": "FIG. 2",
      "type": "FLOW",
      "title": "Method Overview",
      "include": ["Receive via sensor (110)", "Process in controller (200)", "Output to actuator (300)"]
    }
  ],
  "count": 2
}

SCHEMA RULES:
- figure → sequential, starting at FIG. 1
- type → one of: BLOCK, FLOW, SEQUENCE, ACTIVITY, CONSTITUENT
- title → short, patent-style, non-logical
- include → list of components WITH NUMERALS (e.g., "Controller (100)" or "Active Agent (a)") for ALL diagram types
- count → total number of diagrams
- CRITICAL: ALL include items MUST have component numerals/labels in parentheses
- CRITICAL: For COMPOSITION patents, use (a), (b), (c) labels, not numeric labels
- CRITICAL: For FLOW/ACTIVITY, include items describe ACTIONS performed BY registered components

DO NOT INVENT NEW REFERENCE LABELS:
- Use ONLY the reference labels that EXIST in the COMPONENTS list above
- Every label you use MUST appear in the COMPONENTS list
- Reference label formats vary by patent type:
  * SYSTEM/PRODUCT: assigned numeric labels
  * PROCESS: step labels (S100, S200, S300...)
  * COMPOSITION: constituent labels ((a), (b), (c)...)
- Activity/Flow diagrams reference components that perform actions, not abstract steps
- If the COMPONENTS list has labels S100, S200, S300 - use ONLY those labels (not numeric)

NO OTHER KEYS. NO NESTING. NO EXPLANATIONS.

Return ONLY the JSON object. No markdown, no commentary.`

  // Call LLM for planning
  // Uses same stage code as generation so only ONE admin config is needed
  console.log('[PlanFiguresLLM] Preparing LLM call for session:', sessionId)
  console.log('[PlanFiguresLLM] Task code: LLM3_DIAGRAM, Stage: DRAFT_DIAGRAM_GENERATION')
  console.log('[PlanFiguresLLM] Prompt length:', planningPrompt.length, 'chars')
  
  const request = { headers: requestHeaders || {} }
  
  console.log('[PlanFiguresLLM] Calling llmGateway.executeLLMOperation...')
  const result = await llmGateway.executeLLMOperation(request, {
    taskCode: 'LLM3_DIAGRAM',
    stageCode: 'DRAFT_DIAGRAM_GENERATION', // Same stage as generation - single admin config
    prompt: planningPrompt,
    idempotencyKey: crypto.randomUUID(),
    inputTokens: 8000, // Increased for complex prompts with components/claims
    parameters: {
      maxOutputTokens: 12000 // Large output for detailed figure plans
    },
    metadata: {
      patentId,
      sessionId,
      purpose: 'plan_figures_llm'
    }
  })

  console.log('[PlanFiguresLLM] LLM call completed. Success:', result.success)
  if (!result.success) {
    console.error('[PlanFiguresLLM] LLM call FAILED:', result.error?.message || 'Unknown error')
    console.error('[PlanFiguresLLM] Error code:', (result.error as any)?.code)
    console.error('[PlanFiguresLLM] Full error:', JSON.stringify(result.error, null, 2))
  }

  if (!result.success || !result.response) {
    return NextResponse.json({ error: result.error?.message || 'LLM planning failed' }, { status: 400 })
  }
  
  console.log('[PlanFiguresLLM] LLM response received, output length:', (result.response.output || '').length, 'chars')

  // Parse the planning response
  let plan: FigurePlanResult | null = null
  try {
    const text = (result.response.output || '').trim()
    // Try to extract JSON
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end !== -1) {
      const json = text.substring(start, end + 1)
      const rawPlan = JSON.parse(json)
      // Parse and validate the plan
      plan = parseFigurePlan(rawPlan)
    }
  } catch (e) {
    console.error('Failed to parse figure plan:', e)
    return NextResponse.json({ error: 'Invalid planning response format' }, { status: 400 })
  }

  if (!plan || !Array.isArray(plan.diagrams) || plan.diagrams.length === 0) {
    return NextResponse.json({ error: 'Planning did not produce valid figure plan' }, { status: 400 })
  }

  if (figureScope.excludedLabels.length > 0) {
    const excluded = figureScope.excludedLabels.map((label) => String(label || '').toLowerCase())
    plan = {
      ...plan,
      diagrams: plan.diagrams.map((diagram) => ({
        ...diagram,
        include: (diagram.include || []).filter((item) => {
          const normalizedItem = String(item || '').toLowerCase()
          return !excluded.some(label => label && normalizedItem.includes(label))
        })
      }))
    }
  }

  // Store the plan in session for use by generation stage
  // We use aiAnalysisData field to store the plan temporarily (it's a Json field)
  // Note: Sketch suggestions are generated separately via 'generate_sketch_suggestions' action
  const existingAiData = (session as any).aiAnalysisData || {}
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      aiAnalysisData: {
        ...existingAiData,
        figurePlan: plan
      }
    }
  })

  // Log diagram types for debugging
  const diagramTypes = plan.diagrams.map((d: FigurePlanItem) => d.type)
  const uniqueTypes = Array.from(new Set(diagramTypes))
  console.log(`[FigurePlanning] Planned ${plan.count} diagrams with types: ${uniqueTypes.join(', ')}`)

  return NextResponse.json({
    success: true,
    plan,
    message: `Planned ${plan.count} diagrams (${uniqueTypes.join(', ')})`
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMBINED: PLAN + GENERATE (Recommended for Auto Mode)
// ═══════════════════════════════════════════════════════════════════════════════
// This function combines Stage 1 (Planning) and Stage 2 (Generation) into one call.
// It first plans the figures, then immediately generates the PlantUML code.
// This is the recommended approach for automatic figure generation.

async function handlePlanAndGenerateDiagramsLLM(
  user: any,
  patentId: string,
  data: any,
  requestHeaders: Record<string, string>
): Promise<NextResponse> {
  const { sessionId, replaceExisting, figureCount, figureRemarks, skipSketchSuggestions } = data

  if (!sessionId) {
    console.error('[PlanAndGenerate] ERROR: No sessionId provided')
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  console.log('[PlanAndGenerate] ========== STARTING FIGURE GENERATION ==========')
  console.log('[PlanAndGenerate] Session ID:', sessionId)
  console.log('[PlanAndGenerate] Patent ID:', patentId)
  console.log('[PlanAndGenerate] User ID:', user?.id)
  console.log('[PlanAndGenerate] Tenant ID:', user?.tenantId)
  console.log('[PlanAndGenerate] Figure count requested:', figureCount || 'AI decides')
  console.log('[PlanAndGenerate] Headers present:', Object.keys(requestHeaders || {}).length > 0 ? 'yes' : 'NO HEADERS!')

  // Stage 1: Plan the figures
  // Pass figureCount if user wants to override AI's decision
  console.log('[PlanAndGenerate] Stage 1: Calling handlePlanFiguresLLM...')
  const planResponse = await handlePlanFiguresLLM(user, patentId, { sessionId, figureCount, figureRemarks }, requestHeaders)
  
  // Check if planning succeeded
  if (!planResponse.ok) {
    const errorData = await planResponse.json()
    console.error('[PlanAndGenerate] Planning stage failed:', errorData)
    return NextResponse.json({ 
      error: `Planning failed: ${errorData.error || 'Unknown error'}`,
      stage: 'planning'
    }, { status: planResponse.status })
  }

  const planResult = await planResponse.json()
  console.log('[PlanAndGenerate] Planning complete:', planResult.plan?.figures?.length, 'figures planned')

  // Stage 2: Generate code based on the plan
  // We pass usePlan=true so it uses the plan we just saved
  const generateResponse = await handleGenerateDiagramsLLM(
    user, 
    patentId, 
    { 
      sessionId, 
      usePlan: true,  // Use the plan from Stage 1
      replaceExisting: replaceExisting !== false,
      figureRemarks,
      skipSketchSuggestions: skipSketchSuggestions === true
    }, 
    requestHeaders
  )

  // Check if generation succeeded
  if (!generateResponse.ok) {
    const errorData = await generateResponse.json()
    console.error('[PlanAndGenerate] Generation stage failed:', errorData)
    return NextResponse.json({ 
      error: `Generation failed: ${errorData.error || 'Unknown error'}`,
      stage: 'generation',
      plan: planResult.plan  // Include the plan so user can see what was planned
    }, { status: generateResponse.status })
  }

  const generateResult = await generateResponse.json()
  console.log('[PlanAndGenerate] Generation complete:', generateResult.figures?.length, 'figures generated')

  // Return combined result (sketch suggestions are generated separately via 'generate_sketch_suggestions')
  return NextResponse.json({
    success: true,
    plan: planResult.plan,
    figures: generateResult.figures,
    warnings: generateResult.warnings,
    repairSummary: generateResult.repairSummary,
    failedFigures: generateResult.failedFigures,
    sketchSuggestionsGenerating: generateResult.sketchSuggestionsGenerating,
    message: `Successfully planned and generated ${generateResult.figures?.length || 0} diagrams`
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 2: FIGURE GENERATION LLM
// ═══════════════════════════════════════════════════════════════════════════════
// This function takes a figure plan (from Stage 1) and generates PlantUML code.
// It focuses ONLY on code quality, rule compliance, and syntax correctness.

async function handleGenerateDiagramsLLM(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, prompt, replaceExisting, usePlan, figureRemarks } = data

  // When using plan, prompt is optional (we build it from plan)
  if (!sessionId || (!prompt && !usePlan)) {
    return NextResponse.json({ error: 'Session ID and prompt are required' }, { status: 400 })
  }

  // Verify session
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { referenceMap: true, ideaRecord: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  await reactivateFiguresForSession(sessionId)
  const normalizedIdea = session.ideaRecord?.normalizedData as any
  const sourceFactLedgerBlock = buildSupportOrSourceFactBlock(
    normalizedIdea,
    normalizedIdea?.sourceFactLedger,
    'briefDescriptionOfDrawings',
    'SUPPORT DATA SOURCES FOR DIAGRAM GENERATION',
    'SOURCE FACT LEDGER FOR DIAGRAM GENERATION'
  )
  const generationFigureScopeBlock = buildFigureScopePromptBlock(normalizedIdea?.scopeRecommendations)

  // ═══════════════════════════════════════════════════════════════════════════════
  // PLAN-BASED GENERATION (Stage 2 of two-stage approach)
  // ═══════════════════════════════════════════════════════════════════════════════
  // If usePlan is true, we use the pre-computed figure plan to guide generation.
  // This separates "what to draw" (Stage 1) from "how to draw it" (Stage 2).
  
  let effectivePrompt = prompt
  let figurePlan: FigurePlanResult | null = null
  
  if (usePlan) {
    // Fetch the plan from session (stored in aiAnalysisData.figurePlan)
    const aiData = (session as any).aiAnalysisData || {}
    const rawPlan = aiData.figurePlan
    
    // Parse and validate the plan
    figurePlan = parseFigurePlan(rawPlan)
    
    if (!figurePlan || !Array.isArray(figurePlan.diagrams) || figurePlan.diagrams.length === 0) {
      return NextResponse.json({ 
        error: 'No figure plan found. Call plan_figures_llm first or set usePlan=false.' 
      }, { status: 400 })
    }

    // Build components context with referenceLabel
    const figureScope = filterComponentsByScopeForFigures(
      extractComponentsArray(session.referenceMap),
      normalizedIdea?.scopeRecommendations
    )
    const components = figureScope.components
    const figureScopeBlock = buildFigureScopePromptBlock(normalizedIdea?.scopeRecommendations)
    const componentsContext = components.length > 0
      ? components.map((c: any) => `- ${c.name} [ref=${c.referenceLabel || c.numeral || '?'}]`).join('\n')
      : 'No components defined.'
    const claimLinkedComponentsContext = components
      .filter((c: any) => c?.claimSupport?.source === 'frozen_claims' && c?.claimSupport?.claimRole === 'claim_1')
      .map((c: any) => `- ${c.name} (${c.referenceLabel || c.numeral || '?'})`)
      .join('\n') || '- No claim-linked components identified for mandatory figure coverage.'
    const userFigureRemarksBlock = typeof figureRemarks === 'string' && figureRemarks.trim()
      ? `USER FIGURE REMARKS (MANDATORY):\n${figureRemarks.trim()}\n`
      : ''

    // Map diagram types to PlantUML diagram types
    const typeToPlantUML: Record<string, string> = {
      'BLOCK': 'block/component diagram',
      'FLOW': 'activity diagram (linear flow, no decisions)',
      'SEQUENCE': 'sequence diagram',
      'ACTIVITY': 'activity diagram (linear steps only)',
      'CONSTITUENT': 'constituent/formulation diagram (packages + rectangles for COMPOSITION patents)'
    }

    // Build plan-based prompt using PRODUCTION-SAFE template
    // CRITICAL: Generator is a RENDERER, not an explainer.
    // The plan controls generation, except required claim-linked coverage may add an approved registry component.
    effectivePrompt = `═══════════════════════════════════════════════════════════════════════════════
PATENT DIAGRAM GENERATOR — PRODUCTION SAFE (PLANTUML)
═══════════════════════════════════════════════════════════════════════════════

You generate PATENT-READY diagrams in PlantUML.
Your goal is MAXIMUM RELIABILITY and CLARITY.
You are a RENDERER, not an explainer.

INPUTS (SOURCE OF TRUTH):
- Planner suggestions (JSON): See FIGURE PLAN below
- Component registry (use verbatim; do not invent): See COMPONENTS below
- Support data/source context (read-only): use only to avoid omissions of source-stated details; numbered figures still use only approved numbered components

═══════════════════════════════════════════════════════════════════════════════
GLOBAL RULES (NON-NEGOTIABLE)
═══════════════════════════════════════════════════════════════════════════════
1) Generate ALL diagrams in ONE response.
2) Each diagram must be a complete PlantUML block with exactly ONE @startuml and ONE @enduml.
3) Use ONLY the diagram type specified in the planner.
4) ABSOLUTELY FORBIDDEN:
   - if / else / endif
   - alt, loop, fork, repeat, while, switch
   - error handling, fault handling, power modes
   - note, box, title, caption
5) Do NOT invent components, steps, or interactions.
6) Across the generated figure set, every required claim-linked component listed below MUST be rendered at least once unless explicitly excluded from figures by USER-APPROVED FIGURE SCOPE.
7) If a required claim-linked component is absent from all FIGURE PLAN include[] lists, place it in the most appropriate planned figure using its approved registry name and reference label.
8) If unsure about a non-required element, OMIT rather than add.

═══════════════════════════════════════════════════════════════════════════════
AVAILABLE COMPONENTS (Use ONLY these - do not invent new ones)
═══════════════════════════════════════════════════════════════════════════════
${componentsContext}

${userFigureRemarksBlock}
REQUIRED CLAIM-LINKED FIGURE COMPONENTS:
${claimLinkedComponentsContext}

${figureScopeBlock ? `\n${figureScopeBlock}` : ''}
${sourceFactLedgerBlock ? `\n${sourceFactLedgerBlock}` : ''}

═══════════════════════════════════════════════════════════════════════════════
FIGURE PLAN (MANDATORY - Generate exactly these figures)
═══════════════════════════════════════════════════════════════════════════════
${figurePlan.diagrams.map(d => `
${d.figure}: ${d.title}
  Type: ${d.type}
  Include: ${d.include.join(', ')}
`).join('\n')}

═══════════════════════════════════════════════════════════════════════════════
DIAGRAM TYPES — STRICT BEHAVIOR
═══════════════════════════════════════════════════════════════════════════════

CRITICAL: NO ARROW LABELS - Do NOT add text/labels after arrows (e.g., NO "A --> B : label").
Arrow labels cause visual clutter and overlap. The diagram structure shows relationships.

REFERENCE LABEL FORMAT (varies by patent type - use EXACTLY as provided in component list):
- SYSTEM/PRODUCT patents: numeric labels (100), (200), (300)...
- PROCESS patents: step labels (S100), (S200), (S300)...
- COMPOSITION patents: constituent labels (a), (b), (c)...
Use the EXACT referenceLabel from each component in the COMPONENTS list above.

BLOCK:
- Use rectangle + optional package only
- Max 10 components
- Simple arrows only (-->, ..>) with NO labels
- No cycles unless physically obvious
- Label format: "Component Name (ref)" where ref matches the component's referenceLabel

FLOW/ACTIVITY (Method/Process diagrams):
- CRITICAL: Use activity syntax ONLY (:action;), NOT rectangles
- Do NOT use rectangle blocks for flow steps - this causes rendering failures
- Format: start → :action (ref); → :action (ref); → stop
- For PROCESS patents, ref will be S100, S200, etc. (use exactly as in component list)
- Max 8 action steps
- No conditions, forks, or branching
- Arrows are automatic between actions - do NOT add explicit --> between steps

SEQUENCE:
- participant + messages only
- Max 5 participants, 12 messages
- Flat only (no box, no alt, no loop)
- NO arrow labels - just A -> B, not A -> B : message

CONSTITUENT (Composition/Formulation diagrams):
- Use rectangles with package/grouping for ingredient categories
- Reference labels MUST be in parentheses format: "Active Agent (a)", "Carrier (b)"
- Use EXACTLY the (a), (b), (c) labels from the COMPONENTS list
- Show relationships between constituents using simple arrows (-->, ..)
- Max 10 constituents per diagram
- Do NOT include proportions/percentages unless explicitly in the claims
- Use vertical or horizontal layouts for clarity
- Example format:
  package "Formulation" {
    rectangle "Active Agent (a)" as A
    rectangle "Carrier (b)" as B
  }
  A --> B

═══════════════════════════════════════════════════════════════════════════════
STYLE (APPLIED TO EVERY DIAGRAM — DO NOT GENERATE SKINPARAMS)
═══════════════════════════════════════════════════════════════════════════════
The system will inject skinparams automatically. Do NOT include any skinparam lines.
Just start with @startuml, add content, end with @enduml.

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (MANDATORY)
═══════════════════════════════════════════════════════════════════════════════
Return a JSON array of exactly ${figurePlan.diagrams.length} objects.
Each object must be:
{
  "title": "<figure number> - <title from plan>",
  "purpose": "<one sentence describing what the figure shows>",
  "plantuml": "<PlantUML code from @startuml to @enduml>"
}

Return JSON only. No markdown. No commentary.
`
  }

  // Get active jurisdiction for this session
  const activeJurisdiction = (session as any).activeJurisdiction || 
    ((session as any).draftingJurisdictions?.[0]) || 'US'

  // Check if multi-jurisdiction mode - if so, get compatibility rules
  const isMultiJurisdiction = (session as any).isMultiJurisdiction === true
  const allJurisdictions = Array.isArray((session as any).draftingJurisdictions) && (session as any).draftingJurisdictions.length > 0
    ? (session as any).draftingJurisdictions
    : [activeJurisdiction]

  // Fetch jurisdiction-specific diagram configuration from database
  const diagramConfig = await getDiagramConfig(activeJurisdiction, user.id, sessionId)
  
  // Get multi-jurisdiction compatibility if applicable
  let multiJurisdictionInstructions = ''
  if (isMultiJurisdiction && allJurisdictions.length > 1) {
    const { getDiagramCompatibility, buildMultiJurisdictionDiagramPrompt } = await import('@/lib/multi-jurisdiction-service')
    const compatibility = await getDiagramCompatibility(allJurisdictions)
    
    if (compatibility.compatibilityNotes.length > 0) {
      multiJurisdictionInstructions = `
═══════════════════════════════════════════════════════════════════════════════
MULTI-JURISDICTION COMPATIBILITY (${allJurisdictions.join(', ')})
═══════════════════════════════════════════════════════════════════════════════
These diagrams must be compatible with ALL target jurisdictions.
Most restrictive rules apply:
- Color allowed: ${compatibility.mostRestrictiveRules.colorAllowed ? 'Yes' : 'NO - BLACK AND WHITE ONLY'}
- Paper size: ${compatibility.mostRestrictiveRules.paperSize}
- Minimum text size: ${compatibility.mostRestrictiveRules.minReferenceTextSizePt}pt
- Line style: ${compatibility.mostRestrictiveRules.lineStyle}

${compatibility.compatibilityNotes.map(n => `⚠️ ${n}`).join('\n')}
`
    }
  }

  // Build jurisdiction-specific instructions
  const jurisdictionInstructions = await buildJurisdictionDiagramInstructions(
    activeJurisdiction, 
    diagramConfig,
    'block' // Default to block diagram for multi-diagram generation
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // PATENT-TYPE-FIRST DIAGRAM PLANNING (SRS v2)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Get patent type from session (PRIMARY driver)
  const patentTypePrimary = (session as any).patentTypePrimary as PatentTypePrimary | null
  
  // Determine Diagram Archetype from invention type (SECONDARY enhancer)
  const idea = normalizedIdea
  const types = Array.isArray(idea?.inventionType) ? idea.inventionType : (idea?.inventionType ? [idea.inventionType] : [])
  const archetype = types.length > 0 ? types.join('+') : 'GENERAL'

  // Extract diagram count: from figure plan (if using plan) or from prompt
  let diagramCount = 5 // Default
  if (figurePlan && Array.isArray(figurePlan.diagrams)) {
    // When using plan, get count from the plan itself
    diagramCount = figurePlan.diagrams.length
  } else if (prompt) {
    // Legacy mode: extract from prompt text
    const diagramCountMatch = prompt.match(/exactly\s+(\d+)\s+(?:items|diagrams|figures)/i)
    diagramCount = diagramCountMatch ? parseInt(diagramCountMatch[1], 10) : 5
  }

  // Extract claims for intelligent diagram type selection
  const claimsSnapshot = getAuthoritativeClaims(normalizeClaimsForSession(idea || {}))
  const frozenClaims = claimsSnapshot.structured
  const claimsText = claimsSnapshot.html
  
  // Extract claim signals for diagram planning
  const claimSignals = extractClaimSignals(
    frozenClaims.length > 0 ? frozenClaims : null,
    claimsText || null
  )
  
  // Use new patent-type-first diagram planner
  const figurePlans = planDiagramTypes(
    patentTypePrimary,
    archetype,
    claimSignals,
    diagramCount
  )
  
  // Extract diagram types from plans for backward compatibility
  const recommendedDiagramTypes: DiagramType[] = figurePlans.map(fp => fp.type)
  
  // Build diagram type instructions with reasoning
  const diagramTypeInstructions = buildDiagramTypeInstructionsWithReasons(figurePlans)

  // Get the primary language for figures/diagrams from session (set in Stage 0)
  const diagramLanguage = getFiguresLanguage(session)
  const languageLabels: Record<string, string> = {
    en: 'English',
    hi: 'Hindi',
    ja: 'Japanese',
    zh: 'Chinese',
    ko: 'Korean',
    de: 'German',
    fr: 'French',
    es: 'Spanish',
    pt: 'Portuguese',
    ru: 'Russian',
    ar: 'Arabic',
    it: 'Italian',
    nl: 'Dutch',
    sv: 'Swedish',
  }
  const diagramLanguageLabel = languageLabels[diagramLanguage] || diagramLanguage.toUpperCase()

  // Get archetype-specific styling (ONLY for SYSTEM/PRODUCT)
  let styleGuide = 'Use standard UML blocks.'
  let nomenclature = 'Use standard technical terms.'
  
  // Archetype enhancement ONLY for SYSTEM/PRODUCT patent types
  if (patentTypePrimary === 'SYSTEM' || patentTypePrimary === 'PRODUCT' || !patentTypePrimary) {
    const archetypeStyles = getArchetypeNomenclature(archetype)
    styleGuide = archetypeStyles.styleGuide
    nomenclature = archetypeStyles.nomenclature
  } else if (patentTypePrimary === 'PROCESS') {
    styleGuide = 'Use activity diagram syntax for method/process flows.'
    nomenclature = 'Use: Step, Stage, Operation, Input, Output, Decision (and similar process terms).'
  } else if (patentTypePrimary === 'COMPOSITION') {
    styleGuide = 'Use structured constituent diagrams for formulation layouts.'
    nomenclature = 'Use: Constituent, Agent, Carrier, Excipient, Component, Mixture (and similar composition terms).'
  }
  if (archetype.includes('BIO') || archetype.includes('CHEMICAL')) {
    styleGuide += ' Use process flows or reaction schemas.'
    nomenclature += ' Use: Reagent, Compound, Stage, Phase, Catalyst, Reactor (and similar domain entities).'
  }

  if (!usePlan && (sourceFactLedgerBlock || generationFigureScopeBlock)) {
    effectivePrompt = [
      effectivePrompt,
      generationFigureScopeBlock,
      sourceFactLedgerBlock,
    ].filter(Boolean).join('\n\n')
  }

  const finalPrompt = `${effectivePrompt}
${multiJurisdictionInstructions}
═══════════════════════════════════════════════════════════════════════════════
JURISDICTION-SPECIFIC REQUIREMENTS (${activeJurisdiction})
═══════════════════════════════════════════════════════════════════════════════
${jurisdictionInstructions}

═══════════════════════════════════════════════════════════════════════════════
LANGUAGE REQUIREMENT
═══════════════════════════════════════════════════════════════════════════════
PRIMARY LANGUAGE: ${diagramLanguageLabel} (${diagramLanguage})
All labels, descriptions, component names, and annotations in the diagrams MUST be in ${diagramLanguageLabel}.
${diagramLanguage !== 'en' ? `Note: Use proper ${diagramLanguageLabel} characters and terminology. Do not use English unless it is a standard technical term that has no ${diagramLanguageLabel} equivalent.` : ''}

═══════════════════════════════════════════════════════════════════════════════
INVENTION TYPE GUIDE
═══════════════════════════════════════════════════════════════════════════════
DIAGRAM STYLE GUIDE: This is a ${archetype} invention. ${styleGuide}
NOMENCLATURE GUIDE: ${nomenclature}

${diagramTypeInstructions}

═══════════════════════════════════════════════════════════════════════════════
PRODUCTION-SAFE DIAGRAM RULES (MANDATORY)
═══════════════════════════════════════════════════════════════════════════════
You are a RENDERER, not an explainer. Apply these rules without exception.

─────────────────────────────────────────────────────────────────────────────────
ABSOLUTELY FORBIDDEN (Will cause regeneration)
─────────────────────────────────────────────────────────────────────────────────
Do NOT use ANY of the following constructs:
- if / else / endif (NO decision logic)
- alt, loop, fork, repeat, while, switch
- note, box, title, caption
- Error handling, fault paths, power modes
- Any component outside the approved component registry. Components outside include[] are allowed only when they are required claim-linked components listed above and needed for claim coverage.

─────────────────────────────────────────────────────────────────────────────────
ALLOWED CONSTRUCTS ONLY
─────────────────────────────────────────────────────────────────────────────────
@startuml / @enduml
rectangle "Name (XXX)" as ALIAS
package "Group Name" { }
participant "Name (XXX)" as ALIAS
--> (solid arrow for data/control)
..> (dashed arrow for power/utility)
start / stop (ACTIVITY only)
:Action text; (ACTIVITY only)

─────────────────────────────────────────────────────────────────────────────────
SKINPARAM HANDLING (CRITICAL)
─────────────────────────────────────────────────────────────────────────────────
Do NOT generate ANY skinparam lines. The system injects them automatically.

─────────────────────────────────────────────────────────────────────────────────
STRUCTURAL RULES (TYPE-SPECIFIC)
─────────────────────────────────────────────────────────────────────────────────
UNIVERSAL RULES (ALL DIAGRAM TYPES):
1. ORIENTATION: Use "top to bottom direction" as DEFAULT.
2. REFERENCE NUMERALS: Always use parentheses: "Controller (100)"
3. ARROWS: Simple connections only. 1-3 word labels max.
4. ONE @startuml, ONE @enduml per diagram.

BLOCK/FLOW DIAGRAMS ONLY:
5. SYSTEM BOUNDARY: Wrap all components in one outer rectangle.
6. SUBSYSTEM GROUPING: Use max 3 packages for logical grouping.

SEQUENCE DIAGRAMS:
- NO system boundary rectangle (use participant declarations only)
- NO packages (flat participant list)

ACTIVITY DIAGRAMS:
- NO system boundary rectangle (just start → actions → stop)
- NO packages
- CRITICAL: Each action step MUST reference a component from the AVAILABLE COMPONENTS list above
- CRITICAL: Use ONLY numerals that EXIST in the AVAILABLE COMPONENTS list - do NOT invent new ones
- Each action describes what a REGISTERED component does, not an abstract method step

═══════════════════════════════════════════════════════════════════════════════
REFERENCE EXAMPLES (LINEAR ONLY - NO LOGIC)
═══════════════════════════════════════════════════════════════════════════════
⚠️ Use ONLY the components and numerals from the AVAILABLE COMPONENTS list above.
⚠️ Do NOT invent numerals that don't exist in the component registry.

─────────────────────────────────────────────────────────────────────────────────
EXAMPLE: Block Diagram (Correct - Linear, No Logic)
─────────────────────────────────────────────────────────────────────────────────
@startuml
top to bottom direction

rectangle "System (100)" as SYS {
  package "Input" {
    rectangle "Sensor (110)" as SENS
  }
  package "Processing" {
    rectangle "Controller (200)" as CTRL
  }
  package "Output" {
    rectangle "Actuator (300)" as ACT
  }
  SENS --> CTRL
  CTRL --> ACT
}
@enduml

─────────────────────────────────────────────────────────────────────────────────
EXAMPLE: Activity Diagram (Correct - Uses ONLY registered component numerals)
─────────────────────────────────────────────────────────────────────────────────
@startuml
start
:Receive input via Sensor (110);
:Process data in Controller (200);
:Output result via Actuator (300);
stop
@enduml

⚠️ WRONG APPROACH (Do NOT do this - inventing numerals not in the component list):
If your AVAILABLE COMPONENTS list shows: Sensor (110), Controller (200), Actuator (300)
Then do NOT use numerals like (1000), (1010), (999) that are NOT in that list.
Every numeral in your activity diagram MUST exist in the AVAILABLE COMPONENTS list above.

─────────────────────────────────────────────────────────────────────────────────
EXAMPLE: Sequence Diagram (Correct - Flat, No Labels)
─────────────────────────────────────────────────────────────────────────────────
@startuml
participant "User (900)" as U
participant "Controller (200)" as C
participant "Sensor (110)" as S

U -> C
C -> S
S --> C
C --> U
@enduml

═══════════════════════════════════════════════════════════════════════════════
FINAL CHECK (Before Output)
═══════════════════════════════════════════════════════════════════════════════
✓ No if/else/endif, alt, loop, fork, repeat, while, switch
✓ No note, box, title, caption
✓ No skinparam lines (system injects them)
✓ No arrow labels (NO "A --> B : label" - just "A --> B")
✓ Uses components from include[] list, plus required claim-linked components only when needed for claim coverage
✓ One @startuml and one @enduml
✓ Linear flow only - no branching

If in doubt about a non-required element, OMIT rather than add.
`

  console.log(`[DiagramsLLM] Starting diagram generation for session ${sessionId}, using plan: ${usePlan ? 'yes' : 'no'}`)
  
  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, {
    taskCode: 'LLM3_DIAGRAM',
    stageCode: 'DRAFT_DIAGRAM_GENERATION', // Use admin-configured model/limits
    prompt: finalPrompt,
    idempotencyKey: crypto.randomUUID(),
    inputTokens: 8000, // Increased for comprehensive prompts with templates/rules
    parameters: {
      maxOutputTokens: 12000 // Large output for multiple PlantUML diagrams
    },
    metadata: {
      patentId,
      sessionId,
      purpose: 'generate_diagrams_llm'
    }
  })
  
  if (!result.success || !result.response) {
    console.error(`[DiagramsLLM] LLM call failed for session ${sessionId}:`, result.error?.message || 'Unknown error')
    return NextResponse.json({ error: result.error?.message || 'LLM failed' }, { status: 400 })
  }
  
  console.log(`[DiagramsLLM] LLM call succeeded for session ${sessionId}, response length: ${(result.response.output || '').length} chars`)

  // Parse JSON array of figures
  let figures: any[] = []
  try {
    const text = (result.response.output || '').trim()
    // First try: parse JSON array
    try {
      const start = text.indexOf('[')
      const end = text.lastIndexOf(']')
      const json = start !== -1 && end !== -1 ? text.substring(start, end + 1) : text
      const parsed = JSON.parse(json)
      if (Array.isArray(parsed)) figures = parsed
    } catch {}
    // Second try: extract PlantUML code blocks directly
    if (!Array.isArray(figures) || figures.length === 0) {
  const blocks = Array.from(text.matchAll(/@startuml[\s\S]*?@enduml/g)).map(m => sanitizePlantUML(m[0]))
      if (blocks.length > 0) {
        figures = blocks.map((code, i) => ({ title: `Fig.${i + 1}`, purpose: 'Auto-extracted diagram', plantuml: code }))
      }
    }
    // Third try: if response is object with figures key
    if ((!Array.isArray(figures) || figures.length === 0)) {
      try {
        const obj = JSON.parse(text)
        if (Array.isArray(obj?.figures)) figures = obj.figures
      } catch {}
    }
    
    // CRITICAL: If no figures were extracted from LLM response, return an error
    if (!Array.isArray(figures) || figures.length === 0) {
      console.error('[DiagramsLLM] No valid figures found in LLM response. Raw text (first 500 chars):', text.substring(0, 500))
      return NextResponse.json({ 
        error: 'No valid diagrams found in LLM response',
        details: 'The AI did not return any valid PlantUML diagrams. Please try again.'
      }, { status: 400 })
    }
    
    console.log(`[DiagramsLLM] Successfully parsed ${figures.length} figures from LLM response`)
  } catch (e) {
    console.error('[DiagramsLLM] Error parsing LLM response:', e)
    return NextResponse.json({ error: 'Invalid LLM response format' }, { status: 400 })
  }

  const shouldReplace = replaceExisting !== false

  // Optionally clear existing figures before generating new ones
  if (shouldReplace) {
    try {
      await prisma.figurePlan.deleteMany({ where: { sessionId } })
      await prisma.diagramSource.deleteMany({ where: { sessionId } })
      // Also reset the frozen figure sequence since we're replacing all diagrams
      await prisma.draftingSession.update({
        where: { id: sessionId },
        data: { 
          figureSequence: [],
          figureSequenceFinalized: false
        }
      })
    } catch (clearErr) {
      console.error('Error clearing old figures:', clearErr)
      // Continue with generation even if clearing fails
    }
  }

  // Persist immediately: assign figure numbers and save PlantUML + titles
  try {
    const saved: Array<{ figureNo: number; title: string; plantuml: string; purpose: string; diagramType: string; hasValidationWarnings: boolean }> = []
    const warnings: string[] = []
    const failedFigures: DiagramProcessingFailure[] = []
    const repairSummary = emptyRepairSummary()
    const availableNumerals = extractComponentsArray(session.referenceMap)
      .map((c: any) => `${c.name} (${c.referenceLabel || c.numeral || '?'})`)

    // When appending, continue numbering after existing figures; when replacing, start fresh
    const existingPlans = await prisma.figurePlan.findMany({ where: { sessionId } })
    const used = new Set(existingPlans.map(fp => fp.figureNo))
    let figureNoCounter = 1
    const nextNo = () => {
      while (used.has(figureNoCounter)) figureNoCounter++
      const n = figureNoCounter
      used.add(n)
      figureNoCounter++
      return n
    }

    for (let i = 0; i < figures.length; i++) {
      const fig = figures[i]
      const title = typeof fig?.title === 'string' ? fig.title : 'Figure'
      const description = typeof fig?.purpose === 'string' ? fig.purpose : undefined
      const codeRaw = typeof fig?.plantuml === 'string' ? fig.plantuml : ''
      
      // Determine diagram type from figure plan or title
      const figureType = fig?.type?.toUpperCase() || 
        (figurePlan?.diagrams?.[i]?.type?.toUpperCase()) || 
        'BLOCK'
      
      // ═══════════════════════════════════════════════════════════════════════════
      // PRODUCTION-SAFE DIAGRAM PROCESSING PIPELINE
      // Step 1: Sanitize (remove unsafe constructs)
      // Step 2: Check forbidden keywords (C3 gate)
      // Step 2.5: Validate include[] list (C5 - catches hallucinations)
      // Step 3: Inject fixed skinparams (F)
      // Step 4: Enforce element caps (C2)
      // Step 5: Validate structure
      // ═══════════════════════════════════════════════════════════════════════════
      
      const plannedFigure = figurePlan?.diagrams?.[i]
      const includeList = plannedFigure?.include
      const processed = await processDiagramWithRepair(codeRaw, {
        diagramType: figureType,
        figureTitle: title,
        description,
        numerals: includeList && includeList.length > 0 ? includeList : availableNumerals,
        requestHeaders
      })
      mergeRepairSummary(repairSummary, processed.repairSummary)
      if (processed.warnings.length > 0) {
        warnings.push(...processed.warnings.map(w => `${title}: ${w}`))
      }
      if (!processed.ok || !processed.code) {
        const reason = plantUmlErrorsToReason(processed.errors)
        console.warn(`[DiagramsLLM] Figure "${title}" failed after repair processing: ${reason}`)
        failedFigures.push({ index: i + 1, title, reason })
        continue
      }

      const code = processed.code
      const includeValidation = validateIncludeList(code, includeList)
      if (!includeValidation.valid) {
        const warning = `Figure "${title}" contains components not in include[] list: ${includeValidation.hallucinated.join(', ')}`
        console.warn(`[DiagramsLLM] ${warning}`)
        warnings.push(warning)
      }

      const activityValidation = validateActivityNumerals(code)
      if (!activityValidation.valid) {
        const warning = `Figure "${title}" has activity actions without numerals: ${activityValidation.missingNumerals.join(', ')}`
        console.warn(`[DiagramsLLM] ${warning}`)
        warnings.push(warning)
      }
      const hasValidationErrors = processed.repaired || !includeValidation.valid || !activityValidation.valid

      const figureNo = nextNo()
      const checksum = crypto.createHash('sha256').update(code).digest('hex')
      const cleanedTitle = sanitizeFigureTitleInput(title)
      const safeTitle = updateFigureTitleNumber(cleanedTitle, figureNo) || `Figure ${figureNo}`

      await prisma.figurePlan.upsert({
        where: { sessionId_figureNo: { sessionId, figureNo } },
        update: { title: safeTitle, ...(description ? { description } : {}) },
        create: { sessionId, figureNo, title: safeTitle, ...(description ? { description } : {}), nodes: [], edges: [] }
      })

      await prisma.diagramSource.upsert({
        where: { sessionId_figureNo_language: { sessionId, figureNo, language: 'en' } },
        update: { plantumlCode: code, checksum },
        create: { sessionId, figureNo, plantumlCode: code, checksum, language: 'en' }
      })

      saved.push({ 
        figureNo, 
        title: safeTitle, 
        plantuml: code,
        purpose: description || '',
        diagramType: figureType,
        hasValidationWarnings: hasValidationErrors
      })
    }

    if (saved.length === 0) {
      return buildDiagramFailureResponse(failedFigures, repairSummary)
    }
    if (failedFigures.length > 0) {
      warnings.push(`${failedFigures.length} diagram(s) could not be repaired and were skipped.`)
    }

    // Build response with processed code
    const responseFigures = saved.map((s: any) => ({
      title: s.title,
      figureNo: s.figureNo,
      plantuml: s.plantuml,
      purpose: s.purpose,
      diagramType: s.diagramType,
      hasValidationWarnings: s.hasValidationWarnings || false
    }))

    // === GENERATE SKETCH SUGGESTIONS IN BACKGROUND ===
    // Fire-and-forget for the interactive UI. Batch mode passes skipSketchSuggestions
    // so it remains diagram-only and does not create sketch suggestion records.
    const existingDiagramTitles = saved.map((s: any) => 
      `Figure ${s.figureNo}: ${s.title}${s.purpose ? ` - ${s.purpose}` : ''}`
    )
    
    const sketchSuggestionsEnabled = data?.skipSketchSuggestions !== true
    if (sketchSuggestionsEnabled) {
      // Start background sketch suggestion generation (do not await)
      generateSketchSuggestionsInBackground(
        session,
        patentId,
        sessionId,
        existingDiagramTitles,
        requestHeaders
      ).catch(err => {
        console.warn('[DiagramsLLM] Background sketch suggestion generation failed:', err)
      })
    }

    // Return diagrams immediately without waiting for sketch suggestions
    return NextResponse.json({ 
      figures: responseFigures, 
      saved,
      warnings: warnings.length > 0 ? warnings : undefined,
      repairSummary: shouldExposeRepairSummary(repairSummary) ? repairSummary : undefined,
      failedFigures: failedFigures.length > 0 ? failedFigures : undefined,
      sketchSuggestionsGenerating: sketchSuggestionsEnabled
    })
  } catch (persistErr) {
    console.error('Persist diagrams error:', persistErr)
    // Even if persistence fails, return figures so UI shows codes
    return NextResponse.json({ figures, warning: 'Figures generated but could not be saved.' })
  }
}

/**
 * Generates sketch suggestions in the background without blocking the main response.
 * This function is called after PlantUML diagrams are generated and returned to the user.
 * The suggestions are saved to the database and can be fetched by the UI later.
 * 
 * IMPORTANT: This function will SKIP generation if sketch suggestions already exist.
 * Users can manually regenerate suggestions via the Sketch UI which uses a separate action.
 * 
 * @param session - The drafting session object
 * @param patentId - The patent ID
 * @param sessionId - The session ID
 * @param existingDiagramTitles - List of existing diagram titles to avoid duplication
 * @param requestHeaders - Request headers for LLM gateway authentication
 */
async function generateSketchSuggestionsInBackground(
  session: any,
  patentId: string,
  sessionId: string,
  existingDiagramTitles: string[],
  requestHeaders: Record<string, string>
): Promise<void> {
  console.log(`[SketchSuggestions] Checking for existing suggestions for session: ${sessionId}`)
  
  try {
    // Check if sketch suggestions already exist for this session
    // If they do, skip auto-generation to avoid unnecessary LLM calls
    // Users can manually regenerate via the Sketch UI if needed
    const existingSuggestions = await prisma.sketchRecord.findMany({
      where: {
        sessionId,
        status: 'SUGGESTED',
        isDeleted: false
      },
      select: { id: true }
    })
    
    if (existingSuggestions.length > 0) {
      console.log(`[SketchSuggestions] Skipping auto-generation: ${existingSuggestions.length} suggestions already exist for session: ${sessionId}`)
      return // Silently skip - user can manually regenerate from Sketch UI if needed
    }
    
    console.log(`[SketchSuggestions] No existing suggestions found, starting background generation for session: ${sessionId}`)
    
    const sketchSuggestPrompt = buildSketchSuggestionsPrompt(session, existingDiagramTitles)
    
    const request = { headers: requestHeaders || {} }
    const sketchResult = await llmGateway.executeLLMOperation(request, {
      taskCode: 'LLM3_DIAGRAM',
      stageCode: 'DRAFT_FIGURE_PLANNER', // Use Figure Planning tag
      prompt: sketchSuggestPrompt,
      idempotencyKey: crypto.randomUUID(),
      inputTokens: Math.ceil(sketchSuggestPrompt.length / 4),
      metadata: {
        patentId,
        sessionId,
        purpose: 'generate_sketch_suggestions_background'
      }
    })

    if (!sketchResult.success || !sketchResult.response?.output) {
      console.warn(`[SketchSuggestions] LLM call failed for session: ${sessionId}`)
      return
    }

    // Parse sketch suggestions from response
    const suggestionText = sketchResult.response.output.trim()
    let sketchSuggestions: any[] = []
    
    try {
      // Try to parse as JSON array
      const start = suggestionText.indexOf('[')
      const end = suggestionText.lastIndexOf(']')
      if (start !== -1 && end !== -1) {
        const jsonStr = suggestionText.substring(start, end + 1)
        const parsed = JSON.parse(jsonStr)
        if (Array.isArray(parsed)) {
          sketchSuggestions = parsed.filter(s => s.title && s.description)
        }
      }
    } catch {
      // Fallback: try to extract from structured text using exec loop
      const regex = /(?:TITLE|Title):\s*(.+?)(?:\n|$)[\s\S]*?(?:DESCRIPTION|Description):\s*([\s\S]+?)(?=(?:TITLE|Title):|$)/gi
      let match: RegExpExecArray | null
      while ((match = regex.exec(suggestionText)) !== null) {
        if (match[1] && match[2]) {
          sketchSuggestions.push({
            title: match[1].trim(),
            description: match[2].trim().split('\n')[0] // Take first paragraph
          })
        }
      }
    }

    // Create SUGGESTED sketch records if we got suggestions
    if (sketchSuggestions.length > 0) {
      const { createSketchSuggestions, clearSketchSuggestions } = await import('@/lib/sketch-service')
      
      // Clear old suggestions before creating new ones
      await clearSketchSuggestions(sessionId)
      
      // Create new suggestion records
      await createSketchSuggestions(patentId, sessionId, sketchSuggestions)
      
      console.log(`[SketchSuggestions] Background generation complete: Created ${sketchSuggestions.length} suggestions for session: ${sessionId}`)
    } else {
      console.log(`[SketchSuggestions] Background generation complete: No suggestions generated for session: ${sessionId}`)
    }
  } catch (err) {
    console.error(`[SketchSuggestions] Background generation error for session ${sessionId}:`, err)
    // Silent failure - this is a background task
  }
}

/**
 * Builds prompt for generating sketch suggestions based on invention context.
 * These suggestions will be shown in the Sketch tab for user to generate.
 * 
 * STRICT PATENT-DRAFTING MODE:
 * - PlantUML diagrams are the controlling source of truth
 * - No invention of new components, functions, or relationships
 * - All suggestions must be internally consistent with existing figures
 * - No creative "filling in" of missing details
 */
function buildSketchSuggestionsPrompt(session: any, existingDiagrams?: string[], referenceFigures?: { title: string; description?: string }[], existingSketches?: string[]): string {
  const idea = session.ideaRecord?.normalizedData as any
  const figureScope = filterComponentsByScopeForFigures(
    extractComponentsArray(session.referenceMap),
    idea?.scopeRecommendations
  )
  const components = figureScope.components
  const figureScopeBlock = buildFigureScopePromptBlock(idea?.scopeRecommendations)
  
  // Extract invention type for intelligent decision making
  const inventionTypes = Array.isArray(idea?.inventionType) 
    ? idea.inventionType 
    : (idea?.inventionType ? [idea.inventionType] : [])
  const inventionTypeStr = inventionTypes.join(', ') || 'GENERAL'
  
  const inventionSummary = [
    idea?.title && `Title: ${idea.title}`,
    idea?.problem && `Problem: ${idea.problem}`,
    idea?.objectives && `Objectives: ${idea.objectives}`,
    idea?.logic && `Core Logic: ${idea.logic}`,
    idea?.inputs && `Inputs: ${idea.inputs}`,
    idea?.outputs && `Outputs: ${idea.outputs}`
  ].filter(Boolean).join('\n')

  // Build detailed component list with descriptions (supports all numbering styles: 100/200, S100/S200, (a)/(b))
  const componentList = components.map((c: any) => {
    const parts = [`${c.referenceLabel || c.numeral || '?'}: ${c.name}`]
    if (c.description) parts.push(`   Description: ${c.description}`)
    if (c.parent) parts.push(`   Parent: ${c.parent}`)
    return parts.join('\n')
  }).join('\n')

  // Build reference figures section if provided
  let referenceFiguresSection = ''
  if (referenceFigures && referenceFigures.length > 0) {
    referenceFiguresSection = `
═══════════════════════════════════════════════════════════════════════════════
USER-SELECTED REFERENCE FIGURES (Maintain consistency with these)
═══════════════════════════════════════════════════════════════════════════════
${referenceFigures.map((f, i) => `${i + 1}. ${f.title}${f.description ? `: ${f.description}` : ''}`).join('\n')}

New sketches MUST:
- Show different perspectives/views NOT already covered
- Use IDENTICAL component names, numerals, and relationships as shown in these figures
- Maintain visual and logical consistency across all figures
`
  }

  // Build existing diagrams section - this is the SOURCE OF TRUTH
  let existingDiagramsSection = ''
  if (existingDiagrams && existingDiagrams.length > 0) {
    existingDiagramsSection = `
═══════════════════════════════════════════════════════════════════════════════
CONTROLLING SOURCE OF TRUTH: EXISTING PLANTUML DIAGRAMS
═══════════════════════════════════════════════════════════════════════════════
${existingDiagrams.join('\n')}

CRITICAL: These diagrams define the AUTHORITATIVE structure of the invention.
- Every entity, label, and explicitly defined physical relationship is CANON
- Logical or signal interactions in PlantUML do NOT imply physical attachment unless stated
- Sketches must NOT contradict or extend what is shown
- Do NOT suggest flowcharts/sequence diagrams (already handled by PlantUML)
`
  }

  // Build existing sketches section - AVOID DUPLICATES
  let existingSketchesSection = ''
  if (existingSketches && existingSketches.length > 0) {
    existingSketchesSection = `
═══════════════════════════════════════════════════════════════════════════════
ALREADY GENERATED SKETCHES (DO NOT DUPLICATE)
═══════════════════════════════════════════════════════════════════════════════
${existingSketches.map((s, i) => `${i + 1}. ${s}`).join('\n')}

CRITICAL: Do NOT suggest sketches that are already covered above.
- Suggest DIFFERENT views, perspectives, or aspects of the invention
- Focus on what is MISSING, not what already exists
- If all meaningful sketch types are covered, return an empty array []
`
  }

  return `You are a patent illustration expert operating under STRICT patent-drafting conventions.

═══════════════════════════════════════════════════════════════════════════════
STRICT PATENT-DRAFTING CONSTRAINTS (NO EXCEPTIONS)
═══════════════════════════════════════════════════════════════════════════════
1. DO NOT INVENT: Never add components, functions, sub-systems, or relationships
   that are not explicitly described in the invention facts below.

2. SOURCE OF TRUTH: The PlantUML diagrams (if any) are the controlling authority.
   Preserve EXACTLY: every entity, label, and explicitly defined physical relationship.
   Logical or signal interactions in PlantUML do not imply physical attachment unless stated.
   Do not reinterpret or extend.

3. NO CREATIVE FILL-IN: If details are missing or ambiguous, do NOT guess or
   extrapolate. Simply omit that aspect from the sketch suggestion.

4. INTERNAL CONSISTENCY: All suggested sketches must be fully consistent with
   existing figures and the described embodiment(s). No contradictions allowed.

5. PATENT NORMS: Output must adhere to USPTO/EPO/WIPO drawing conventions.
   Physical representations only - no flowcharts, process diagrams, or UML.

═══════════════════════════════════════════════════════════════════════════════
SKETCHES vs DIAGRAMS - CRITICAL DISTINCTION
═══════════════════════════════════════════════════════════════════════════════
ALREADY HANDLED BY PLANTUML (DO NOT SUGGEST):
❌ Process flows, flowcharts, activity diagrams
❌ Sequence diagrams, state machines
❌ System architecture block diagrams
❌ Data flow diagrams
❌ Any UML diagram type

VALID SKETCH TYPES (Physical/Visual only):
✓ Device/apparatus physical appearance (exterior views)
✓ Component assembly views, exploded views
✓ Cross-sections, cutaway views (internal physical arrangement)
✓ Spatial arrangements, physical layouts
✓ User interface mockups (for software with UI - screens only)
✓ Hardware/circuit board physical layouts
✓ Mechanical part detail views
✓ Physical connection views (only when attachment mechanism is explicitly described)
✓ Perspective drawings, isometric views
✓ Installation/deployment physical arrangements

═══════════════════════════════════════════════════════════════════════════════
INVENTION FACTS (Authoritative - Do not extend or modify)
═══════════════════════════════════════════════════════════════════════════════
${inventionSummary}

INVENTION TYPE: ${inventionTypeStr}

OFFICIAL COMPONENT REGISTRY (Use ONLY these - no additions):
${componentList || 'No components defined yet'}
${figureScopeBlock ? `\n${figureScopeBlock}` : ''}
${existingDiagramsSection}${existingSketchesSection}${referenceFiguresSection}
═══════════════════════════════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════════════════════════════
Analyze the invention type and facts. Then:

1. IF the invention has PHYSICAL/VISUAL aspects that can be meaningfully sketched
   using ONLY the provided components and relationships:
   → Suggest 1-3 patent-style SKETCHES with detailed specifications

2. IF the invention is PURELY ABSTRACT (algorithm, method, business process,
   pure software logic with no UI):
   → Return an empty array: []
   → These are best represented by PlantUML diagrams, not sketches.

INVENTION TYPE GUIDANCE:
- MECHANICAL/HARDWARE: High potential - device views, assemblies, cross-sections
- ELECTRICAL/ELECTRONICS: Medium-high - board layouts, housings, physical wiring
- SOFTWARE WITH UI: Medium - interface mockups, screen layouts (UI components only)
- SOFTWARE (backend/logic): Very low - return [] unless physical deployment relevant
- ALGORITHM/METHOD: Return [] - no meaningful physical sketch possible
- BUSINESS METHOD: Return [] - no meaningful physical sketch possible
- BIO/CHEMICAL: Medium - apparatus views, equipment layouts, vessels

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT - COMPREHENSIVE SKETCH SUGGESTIONS
═══════════════════════════════════════════════════════════════════════════════
Return a JSON array with 0-3 sketch suggestions.

CRITICAL: The "description" field must be COMPREHENSIVE and include ALL drawing
instructions. This description is passed directly to the image generator.

FORMAT:
[
  {
    "title": "Concise title with view type (e.g., 'Device Assembly - Front Isometric View')",
    "description": "COMPREHENSIVE drawing instructions including: VIEW TYPE AND ANGLE (e.g., front-right isometric at 30° elevation), COMPONENTS TO SHOW (list all numerals), PRIMARY FOCUS (main component), PHYSICAL RELATIONSHIPS (only from invention facts), SECONDARY VIEW (if applicable), DETAIL LEVEL (schematic/simplified/medium). All in one detailed paragraph."
  }
]

EXAMPLE OF GOOD SUGGESTION:
{
  "title": "Housing Assembly - Front-Right Isometric View",
  "description": "VIEW: Front-right isometric view at approximately 30° elevation showing the complete assembled device. COMPONENTS: Show housing (100), controller unit (200), sensor array (300), and power module (400). PRIMARY FOCUS: Housing assembly (100) as the main structural element containing all other components. PHYSICAL RELATIONSHIPS: Controller (200) mounted on internal bracket within housing (100); sensor array (300) attached to front panel of housing; power module (400) connected to controller via internal wiring channel. SECONDARY VIEW: Include partial cutaway revealing controller (200) position inside housing. DETAIL LEVEL: Medium - show external features clearly, use dashed lines for internal components visible through cutaway. Use ONLY the listed components, no additional sub-parts or invented details."
}

IF no meaningful sketch is possible (abstract invention):
[]

═══════════════════════════════════════════════════════════════════════════════
VALIDATION RULES (Self-check before output)
═══════════════════════════════════════════════════════════════════════════════
✓ Every component numeral referenced exists in the OFFICIAL COMPONENT REGISTRY
✓ Every physical relationship is explicitly stated in invention facts or PlantUML
✓ No new components, sub-components, or connections invented
✓ View type is a valid physical representation (NOT a flowchart/diagram)
✓ Suggestion is fully consistent with all existing PlantUML diagrams
✓ No speculation or creative interpretation of missing details
✓ Description is comprehensive enough for image generation
✓ Return [] if invention is purely abstract with no physical aspects

Return ONLY the JSON array, no other text.`
}

async function handleSavePlantUML(user: any, patentId: string, data: any) {
  const { sessionId, figureNo, title, plantumlCode, description } = data
  if (!sessionId || !figureNo || !plantumlCode) {
    return NextResponse.json({ error: 'Session ID, figure number and code are required' }, { status: 400 })
  }

  // Verify session
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { referenceMap: true, figurePlans: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // ═══════════════════════════════════════════════════════════════════════════
  // PRODUCTION-SAFE DIAGRAM PROCESSING (handleSavePlantUML)
  // PHILOSOPHY: Regenerate, don't repair. No LLM repair attempts.
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Step 1: Sanitize (removes all skinparams, forbidden constructs)
  let workingCode = sanitizePlantUML(plantumlCode)
  
  // Step 2: C3 FORBIDDEN KEYWORD GATE
  const forbiddenCheck = containsForbiddenKeywords(workingCode)
  if (forbiddenCheck.hasForbidden) {
    return NextResponse.json(
      { 
        error: 'Diagram contains forbidden constructs', 
        details: `Detected: ${forbiddenCheck.matches.join(', ')}. These are not allowed in patent diagrams.`,
        action: 'Please edit the PlantUML code to remove if/else, loops, or decision logic.'
      },
      { status: 400 }
    )
  }
  
  // Step 3: Inject fixed skinparams
  workingCode = injectFixedSkinparams(workingCode)
  
  // Step 4: Validate structure (no repair - just validate)
  const validation = validatePlantUmlStructure(workingCode)
  if (!validation.ok) {
    return NextResponse.json(
      { 
        error: 'PlantUML validation failed', 
        details: validation.errors,
        action: 'Please edit the code to fix structural issues.'
      }, 
      { status: 400 }
    )
  }

  // Upsert diagram source and figure plan title
  const diagramSource = await prisma.diagramSource.upsert({
    where: { sessionId_figureNo_language: { sessionId, figureNo, language: 'en' } },
    update: { plantumlCode: workingCode, checksum: crypto.createHash('sha256').update(workingCode).digest('hex') },
    create: { sessionId, figureNo, plantumlCode: workingCode, checksum: crypto.createHash('sha256').update(workingCode).digest('hex'), language: 'en' }
  })

  const cleanedTitle = sanitizeFigureTitleInput(title) || `Figure ${figureNo}`

  // Include description in both update and create operations
  await prisma.figurePlan.upsert({
    where: { sessionId_figureNo: { sessionId, figureNo } },
    update: { title: cleanedTitle, ...(description ? { description } : {}) },
    create: { sessionId, figureNo, title: cleanedTitle, ...(description ? { description } : {}), nodes: [], edges: [] }
  })

  // Generate and save image from PlantUML code
  // NOTE: REGENERATE-NOT-REPAIR - No LLM repair attempts. If render fails, return error.
  try {
    // Clean the PlantUML code for rendering
    const cleaned = cleanForRendering(workingCode)

    const base = process.env.PLANTUML_BASE_URL || 'https://www.plantuml.com/plantuml'
    const encoded = plantumlEncoder.encode(cleaned)

    const resp = await fetch(`${base}/png/${encoded}`, {
      cache: 'no-store',
      method: 'GET',
      headers: { 'Accept': 'image/png' }
    })

    // REGENERATE-NOT-REPAIR: If render fails, return error immediately (no retry)
    if (!resp.ok) {
      const failureText = await resp.text().catch(() => '')
      const txtError = await fetchPlantUmlErrorText(base, encoded)
      return NextResponse.json(
        {
          error: 'Diagram render failed',
          details: txtError || failureText || `HTTP ${resp.status}`,
          action: 'Please edit the PlantUML code to fix syntax issues, then save again.',
          figureTitle: cleanedTitle,
          figureDescription: description || 'No description available'
        },
        { status: 502 }
      )
    }

    const buf = Buffer.from(await resp.arrayBuffer())
    const imageChecksum = crypto.createHash('sha256').update(buf).digest('hex')

    // Save image to disk
    const baseDir = path.join(process.cwd(), 'uploads', 'patents', patentId, 'figures')
    await fs.mkdir(baseDir, { recursive: true })
    const filename = `figure_${figureNo}_${Date.now()}.png`
    const imagePath = path.join(baseDir, filename)
    await fs.writeFile(imagePath, buf)

    // Update diagram source with image path
    await prisma.diagramSource.update({
      where: { sessionId_figureNo_language: { sessionId, figureNo, language: 'en' } },
      data: {
        imageFilename: filename,
        imagePath: imagePath,
        imageChecksum: imageChecksum,
        imageUploadedAt: new Date()
      }
    })
  } catch (imageError) {
    console.warn('Failed to generate/save PlantUML image:', imageError)
    // Don't fail the whole operation if image generation fails
  }

  return NextResponse.json({ diagramSource })
}

// ============================================================================
// PLANTUML DIAGRAM TRANSLATION (Multi-Jurisdiction Support)
// ============================================================================

/**
 * Language labels for translation prompts
 */
const DIAGRAM_LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  ja: 'Japanese',
  zh: 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
  ko: 'Korean',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
  it: 'Italian',
  ru: 'Russian',
  ar: 'Arabic',
  nl: 'Dutch',
  sv: 'Swedish',
  da: 'Danish',
  fi: 'Finnish',
  no: 'Norwegian',
  pl: 'Polish',
  tr: 'Turkish',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ms: 'Malay'
}

/**
 * Translate a single PlantUML diagram to target language
 * Preserves structure, reference numerals, and PlantUML syntax
 * Stores as separate language variant (does not overwrite original)
 */
async function handleTranslatePlantUML(
  user: any,
  patentId: string,
  data: any,
  requestHeaders: Record<string, string>
) {
  const { sessionId, figureNo, targetLanguage, sourceLanguage = 'en' } = data

  if (!sessionId || figureNo === undefined || !targetLanguage) {
    return NextResponse.json(
      { error: 'Session ID, figure number, and target language are required' },
      { status: 400 }
    )
  }

  // Validate target language is supported
  if (!DIAGRAM_LANGUAGE_LABELS[targetLanguage]) {
    return NextResponse.json(
      { error: `Unsupported target language: ${targetLanguage}. Supported: ${Object.keys(DIAGRAM_LANGUAGE_LABELS).join(', ')}` },
      { status: 400 }
    )
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { 
      diagramSources: true,
      figurePlans: true,
      referenceMap: true
    }
  })

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    )
  }

  // Find source diagram (original language version)
  const sourceDiagram = session.diagramSources?.find(
    (d: any) => d.figureNo === figureNo && d.language === sourceLanguage
  )

  if (!sourceDiagram || !sourceDiagram.plantumlCode) {
    return NextResponse.json(
      { error: `Source diagram not found for figure ${figureNo} in ${sourceLanguage}` },
      { status: 404 }
    )
  }

  // Check if translation already exists
  const existingTranslation = session.diagramSources?.find(
    (d: any) => d.figureNo === figureNo && d.language === targetLanguage
  )

  // Get language labels
  const sourceLabel = DIAGRAM_LANGUAGE_LABELS[sourceLanguage] || sourceLanguage.toUpperCase()
  const targetLabel = DIAGRAM_LANGUAGE_LABELS[targetLanguage] || targetLanguage.toUpperCase()

  // Get reference labels for context (supports all numbering styles: 100/200, S100/S200, (a)/(b))
  const components = extractComponentsArray(session.referenceMap)
  const numeralsList = components.map((c: any) => `${c.referenceLabel || c.numeral || '?'}: ${c.name}`).join('\n')

  // Build translation prompt
  const prompt = `You are a technical translator specializing in patent documentation.

TASK: Translate all human-readable text in this PlantUML diagram from ${sourceLabel} to ${targetLabel}.

CRITICAL RULES:
1. PRESERVE ALL PLANTUML SYNTAX EXACTLY - @startuml, @enduml, arrows (-->), blocks, etc.
2. PRESERVE ALL REFERENCE NUMERALS exactly as assigned - these are patent reference numbers
3. PRESERVE ALL ALIAS NAMES (as xxx) - only translate the display text in quotes
4. DO NOT translate technical PlantUML keywords (rectangle, component, node, etc.)
5. Translate ONLY the text content inside quotes and labels
6. Maintain the exact same diagram structure and flow
7. Use proper ${targetLabel} technical terminology for patent documentation

REFERENCE NUMERALS (DO NOT CHANGE THESE):
${numeralsList || 'None specified'}

ORIGINAL PLANTUML CODE (${sourceLabel}):
\`\`\`plantuml
${sourceDiagram.plantumlCode}
\`\`\`

Return ONLY the translated PlantUML code. No explanations, no markdown formatting, just the raw PlantUML code starting with @startuml and ending with @enduml.`

  try {
    // Call LLM with temperature 0 for consistency using the gateway
    const request = { headers: requestHeaders || {} }
    const llmResult = await llmGateway.executeLLMOperation(request, {
      taskCode: 'LLM3_DIAGRAM',
      stageCode: 'DRAFT_DIAGRAM_GENERATION', // Reuse diagram generation model configured via central LLM control
      prompt,
      idempotencyKey: crypto.randomUUID(),
      inputTokens: Math.ceil(prompt.length / 4),
      parameters: { 
        temperature: 0,
        maxOutputTokens: 4000,
        tenantId: (session as any).tenantId || undefined
      },
      metadata: { 
        patentId, 
        sessionId, 
        purpose: 'translate_plantuml',
        targetLanguage,
        figureNo
      }
    })

    if (!llmResult.success || !llmResult.response?.output) {
      return NextResponse.json(
        { error: 'Translation failed - no response from LLM' },
        { status: 500 }
      )
    }

    // Extract PlantUML code from response
    let translatedCode = (llmResult.response.output || '').trim()
    
    // Remove markdown code blocks if present
    if (translatedCode.startsWith('```')) {
      translatedCode = translatedCode
        .replace(/^```(?:plantuml)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim()
    }

    // Ensure it starts and ends correctly
    if (!translatedCode.includes('@startuml')) {
      translatedCode = '@startuml\n' + translatedCode
    }
    if (!translatedCode.includes('@enduml')) {
      translatedCode = translatedCode + '\n@enduml'
    }

    // Light validation: check that translated code has basic PlantUML structure
    // (arrows, blocks, or activity keywords - signs of valid diagram content)
    const hasValidStructure = 
      /-->|->|<--|<-|--|\.\.>|rectangle|component|node|database|:.*[;|]/.test(translatedCode)
    
    if (!hasValidStructure) {
      console.warn(`[TranslatePlantUML] Translated code may be invalid for figure ${figureNo}`)
      // Still proceed - the user can review, but log for debugging
    }

    // Generate checksum
    const checksum = crypto.createHash('sha256').update(translatedCode).digest('hex')

    // Upsert the translated diagram (create or update)
    const translatedDiagram = await prisma.diagramSource.upsert({
      where: {
        sessionId_figureNo_language: {
          sessionId,
          figureNo,
          language: targetLanguage
        }
      },
      update: {
        plantumlCode: translatedCode,
        checksum,
        translatedFromDiagramId: sourceDiagram.id,
        updatedAt: new Date()
      },
      create: {
        sessionId,
        figureNo,
        language: targetLanguage,
        plantumlCode: translatedCode,
        checksum,
        translatedFromDiagramId: sourceDiagram.id
      }
    })

    // Generate and save rendered image for the translated diagram
    try {
      // Clean the PlantUML code for rendering (preserves allowed skinparams)
      let cleaned = cleanForRendering(translatedCode)

      const encoded = plantumlEncoder.encode(cleaned)
      const base = process.env.PLANTUML_BASE_URL || 'https://www.plantuml.com/plantuml'
      const imgUrl = `${base}/png/${encoded}`
      
      const imgRes = await fetch(imgUrl)
      if (imgRes.ok) {
        const arrayBuffer = await imgRes.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const imageChecksum = crypto.createHash('sha256').update(buffer).digest('hex')
        const filename = `figure_${figureNo}_${targetLanguage}_${Date.now()}.png`
        // Store alongside other figure images so the UI can serve it via the same endpoint
        const patent = await prisma.patent.findUnique({
          where: { id: patentId },
          select: { projectId: true }
        })
        const uploadDir = patent?.projectId
          ? path.join(process.cwd(), 'uploads', 'projects', patent.projectId, 'patents', patentId, 'figures')
          : path.join(process.cwd(), 'uploads', 'patents', patentId, 'figures')
        const imagePath = path.join(uploadDir, filename)

        await fs.mkdir(uploadDir, { recursive: true })
        await fs.writeFile(imagePath, buffer)

        await prisma.diagramSource.update({
          where: { id: translatedDiagram.id },
          data: {
            imageFilename: filename,
            imagePath: imagePath,
            imageChecksum: imageChecksum,
            imageUploadedAt: new Date()
          }
        })
      }
    } catch (imageError) {
      console.warn('Failed to generate image for translated diagram:', imageError)
      // Non-fatal - translation still succeeded
    }

    return NextResponse.json({
      success: true,
      translatedDiagram: {
        id: translatedDiagram.id,
        figureNo,
        language: targetLanguage,
        translatedFromId: sourceDiagram.id,
        plantumlCode: translatedCode
      },
      isUpdate: !!existingTranslation,
      message: `Diagram translated to ${targetLabel} successfully`
    })
  } catch (error) {
    console.error('PlantUML translation error:', error)
    return NextResponse.json(
      { error: `Translation failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    )
  }
}

/**
 * Translate all diagrams in a session to target language (one by one to avoid errors)
 * Returns progress info and results for each diagram
 */
async function handleTranslateAllDiagrams(
  user: any,
  patentId: string,
  data: any,
  requestHeaders: Record<string, string>
) {
  const { sessionId, targetLanguage, sourceLanguage = 'en' } = data

  if (!sessionId || !targetLanguage) {
    return NextResponse.json(
      { error: 'Session ID and target language are required' },
      { status: 400 }
    )
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { 
      diagramSources: true,
      figurePlans: true,
      referenceMap: true
    }
  })

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    )
  }

  // Find all source diagrams (original language)
  const sourceDiagrams = session.diagramSources?.filter(
    (d: any) => d.language === sourceLanguage && d.plantumlCode
  ) || []

  if (sourceDiagrams.length === 0) {
    return NextResponse.json(
      { error: `No diagrams found in ${sourceLanguage} to translate` },
      { status: 404 }
    )
  }

  const targetLabel = DIAGRAM_LANGUAGE_LABELS[targetLanguage] || targetLanguage.toUpperCase()
  const results: Array<{
    figureNo: number
    success: boolean
    translatedDiagramId?: string
    error?: string
  }> = []

  // Process one by one to avoid overwhelming LLM and ensure reliability
  for (const sourceDiagram of sourceDiagrams) {
    try {
      // Call single translation handler for each
      const translationResult = await handleTranslatePlantUML(
        user,
        patentId,
        {
          sessionId,
          figureNo: sourceDiagram.figureNo,
          targetLanguage,
          sourceLanguage
        },
        requestHeaders
      )

      const resultData = await translationResult.json()
      
      results.push({
        figureNo: sourceDiagram.figureNo,
        success: resultData.success || false,
        translatedDiagramId: resultData.translatedDiagram?.id,
        error: resultData.error
      })
    } catch (err) {
      results.push({
        figureNo: sourceDiagram.figureNo,
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      })
    }
  }

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length

  return NextResponse.json({
    success: failCount === 0,
    totalDiagrams: sourceDiagrams.length,
    translated: successCount,
    failed: failCount,
    results,
    message: `Translated ${successCount}/${sourceDiagrams.length} diagrams to ${targetLabel}`
  })
}

/**
 * Get all diagram translations for a session (organized by figureNo and language)
 */
async function handleGetDiagramTranslations(
  user: any,
  patentId: string,
  data: any
) {
  const { sessionId, figureNo } = data

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Session ID is required' },
      { status: 400 }
    )
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { diagramSources: true }
  })

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    )
  }

  // Filter by figureNo if provided
  let diagrams = session.diagramSources || []
  if (figureNo !== undefined) {
    diagrams = diagrams.filter((d: any) => d.figureNo === figureNo)
  }

  // Group by figureNo
  const byFigure: Record<number, Array<{
    id: string
    language: string
    hasImage: boolean
    translatedFromId: string | null
    updatedAt: Date
  }>> = {}

  for (const d of diagrams) {
    const figNo = (d as any).figureNo
    if (!byFigure[figNo]) {
      byFigure[figNo] = []
    }
    byFigure[figNo].push({
      id: d.id,
      language: (d as any).language || 'en',
      hasImage: !!(d as any).imageFilename,
      translatedFromId: (d as any).translatedFromDiagramId || null,
      updatedAt: d.updatedAt
    })
  }

  // Get unique languages across all diagrams
  const allLanguages = Array.from(new Set(diagrams.map((d: any) => d.language || 'en')))

  return NextResponse.json({
    translations: byFigure,
    availableLanguages: allLanguages,
    languageLabels: DIAGRAM_LANGUAGE_LABELS
  })
}

/**
 * Auto-fix PlantUML render errors via LLM
 * Called when diagram rendering fails - attempts to fix syntax and return corrected code
 */
async function handleFixPlantUMLRender(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, figureNo, plantumlCode, renderError } = data
  
  if (!sessionId || !figureNo || !plantumlCode) {
    return NextResponse.json({ error: 'Session ID, figure number, and PlantUML code are required' }, { status: 400 })
  }

  // Verify session
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { referenceMap: true, figurePlans: true }
  })
  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  // Get figure info
  const figurePlan = session.figurePlans?.find((f: any) => f.figureNo === figureNo)
  const title = figurePlan?.title || `Figure ${figureNo}`
  const description = (figurePlan as any)?.description || ''

  // Get component reference labels for context (supports all numbering styles: 100/200, S100/S200, (a)/(b))
  const components = extractComponentsArray(session.referenceMap)
  const numerals = components.map((c: any) => `${c.name} (${c.referenceLabel || c.numeral || '?'})`)

  const processed = await processDiagramWithRepair(plantumlCode, {
    diagramType: inferPlantUmlDiagramType(plantumlCode),
    figureTitle: title,
    description,
    numerals,
    plantumlErrorText: renderError,
    requestHeaders,
    forceRepair: true
  })

  if (processed.ok && processed.code) {
    // Save the fixed code to the diagram source
    const checksum = crypto.createHash('sha256').update(processed.code).digest('hex')
    
    await prisma.diagramSource.upsert({
      where: { sessionId_figureNo_language: { sessionId, figureNo, language: 'en' } },
      update: { 
        plantumlCode: processed.code,
        checksum,
        imageUploadedAt: null, // Clear image since code changed
        imageFilename: null,
        imagePath: null
      },
      create: { 
        sessionId, 
        figureNo, 
        plantumlCode: processed.code,
        checksum,
        language: 'en'
      }
    })

    return NextResponse.json({ 
      success: true, 
      fixedCode: processed.code,
      warnings: processed.warnings.length > 0 ? processed.warnings : undefined,
      repairSummary: shouldExposeRepairSummary(processed.repairSummary) ? processed.repairSummary : undefined,
      message: 'Code fixed successfully - ready for re-render'
    })
  }

  return NextResponse.json({ 
    success: false, 
    error: 'Could not auto-fix the PlantUML code. Please review and fix manually.',
    details: plantUmlErrorsToReason(processed.errors),
    failedFigures: [{ index: 1, title, reason: plantUmlErrorsToReason(processed.errors) }],
    repairSummary: shouldExposeRepairSummary(processed.repairSummary) ? processed.repairSummary : undefined
  }, { status: 400 })
}

async function handleRegenerateDiagramLLM(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, figureNo, instructions, diagramType: requestedType } = data
  if (!sessionId || !figureNo) return NextResponse.json({ error: 'Session ID and figure number required' }, { status: 400 })

  // Verify session and pull numerals
  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id }, include: { referenceMap: true, figurePlans: true, diagramSources: true, ideaRecord: true } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  await reactivateFiguresForSession(sessionId)

  // Get active jurisdiction
  const activeJurisdiction = (session as any).activeJurisdiction || 
    ((session as any).draftingJurisdictions?.[0]) || 'US'

  // Fetch jurisdiction-specific diagram configuration
  const diagramConfig = await getDiagramConfig(activeJurisdiction, user.id, sessionId)
  const jurisdictionInstructions = await buildJurisdictionDiagramInstructions(activeJurisdiction, diagramConfig, 'block')

  const components = extractComponentsArray(session.referenceMap)
  const numeralsPreview = components.map((c: any) => `${c.name} (${c.referenceLabel || c.numeral || '?'})`).join(', ')
  const title = session!.figurePlans?.find((f: any) => f.figureNo === figureNo)?.title || `Figure ${figureNo}`

  // Determine Diagram Archetype
  const idea = session.ideaRecord?.normalizedData as any
  const sourceFactLedgerBlock = buildSupportOrSourceFactBlock(
    idea,
    idea?.sourceFactLedger,
    'briefDescriptionOfDrawings',
    'SUPPORT DATA SOURCES FOR DIAGRAM REGENERATION',
    'SOURCE FACT LEDGER FOR DIAGRAM REGENERATION'
  )
  const types = Array.isArray(idea?.inventionType) ? idea.inventionType : (idea?.inventionType ? [idea.inventionType] : [])
  const archetype = types.length > 0 ? types.join('+') : 'GENERAL'

  // Get existing diagram source for modification context
  const existingSource = session.diagramSources?.find((d: any) => d.figureNo === figureNo)
  const existingDiagramCode = existingSource?.plantumlCode || ''

  // Determine diagram type - use requested type, or detect from existing code, or default to block
  let diagramType: DiagramType = 'block'
  if (requestedType && ['block', 'activity', 'sequence', 'state', 'constituent'].includes(requestedType)) {
    diagramType = requestedType as DiagramType
  } else if (existingDiagramCode) {
    // Detect from existing diagram source
    if (/^\s*(start|stop|:.*;\s*$)/m.test(existingDiagramCode)) {
      diagramType = 'activity'
    } else if (/^\s*(participant|actor)\b/mi.test(existingDiagramCode)) {
      diagramType = 'sequence'
    } else if (/^\s*(\[\*\]|state\s+")/mi.test(existingDiagramCode)) {
      diagramType = 'state'
    }
  }

  const diagramInfo = DIAGRAM_TYPES[diagramType]

  // Build prompt - if existing diagram exists, emphasize MODIFICATION; otherwise generate fresh
  const hasExistingDiagram = existingDiagramCode && existingDiagramCode.includes('@startuml')

  const prompt = hasExistingDiagram 
    ? `You are MODIFYING an existing ${diagramInfo.name.toLowerCase()} for a patent figure.

═══════════════════════════════════════════════════════════════════════════════
USER'S MODIFICATION REQUEST (HIGHEST PRIORITY)
═══════════════════════════════════════════════════════════════════════════════
${instructions || 'No specific instructions provided'}

THE USER'S REQUEST ABOVE TAKES ABSOLUTE PRIORITY. Follow it exactly.
If user explicitly requests different styles, layouts, or overrides, FOLLOW THE USER'S INSTRUCTIONS.

═══════════════════════════════════════════════════════════════════════════════
MODIFICATION GUIDELINES
═══════════════════════════════════════════════════════════════════════════════
1. USER INSTRUCTIONS COME FIRST: Always prioritize what the user explicitly asks for.

2. WHAT USERS CAN REQUEST (honor all of these):
   - LAYOUT CHANGES: "make it vertical", "horizontal", "rearrange", "reorder" → Change structure as requested
   - SMALL CORRECTIONS: "fix typo", "rename X to Y", "change label" → Preserve structure, fix targeted item
   - ADD/REMOVE: "add component", "remove X", "add arrow" → Apply change, preserve rest
   - SIMPLIFY: "simplify", "remove clutter", "show only main flow" → Reduce complexity as requested
   - EXPAND: "add more detail", "show sub-steps", "elaborate" → Add detail as requested
   - DIAGRAM TYPE CONVERSION: "convert to sequence diagram", "make it an activity diagram" → Convert type as requested
   - RESTRUCTURE: "reorganize", "change the flow", "flip direction" → Restructure as requested
   - STYLE REQUESTS: Honor layout/content style requests, but do NOT emit skinparam lines
   
   NOTE: Do NOT add colors unless user explicitly requests. Patent diagrams use black borders on white backgrounds by default.

3. DEFAULT BEHAVIOR (when user does NOT specify style/layout changes):
   - Let the system inject canonical style settings
   - Preserve existing structure while applying the specific change

═══════════════════════════════════════════════════════════════════════════════
STYLE RULES (SKINPARAMS AUTO-INJECTED)
═══════════════════════════════════════════════════════════════════════════════
Do NOT generate any skinparam lines. The system injects them automatically.
Just focus on the diagram content.

Default direction: top to bottom direction (use left to right only for very simple diagrams ≤3 components)

**PATENT FIGURE SEMANTICS:**
- All connectors are orthogonal (handled by system skinparams).
- Avoid arrow crossings. Use hidden links (-[hidden]->) to avoid crossings.
- Solid arrows (-->) = data/control paths.
- Dashed arrows (..>) = power/utility ONLY.
- NO ARROW LABELS: Do not add text after arrows (e.g., NO "A --> B : label") - labels cause overlap and clutter.
- Nesting depth max = 2 levels.

**HELPER NODES ALLOWED:**
- Un-numbered helper nodes ("Power bus", "Comms bus", "Data bus") are allowed for routing clarity.
- Helper nodes MUST NOT contain numerals.

═══════════════════════════════════════════════════════════════════════════════
EXISTING DIAGRAM TO MODIFY
═══════════════════════════════════════════════════════════════════════════════
${existingDiagramCode}

═══════════════════════════════════════════════════════════════════════════════
AVAILABLE COMPONENTS/NUMERALS
═══════════════════════════════════════════════════════════════════════════════
${numeralsPreview}
${sourceFactLedgerBlock ? `\n${sourceFactLedgerBlock}` : ''}
CRITICAL: All reference numerals MUST be wrapped in parentheses, e.g., "Controller (100)" NOT "Controller 100".

═══════════════════════════════════════════════════════════════════════════════
DIAGRAM TYPE: ${diagramInfo.name}
═══════════════════════════════════════════════════════════════════════════════
${diagramInfo.syntaxGuide}

═══════════════════════════════════════════════════════════════════════════════
JURISDICTION-SPECIFIC REQUIREMENTS (${activeJurisdiction})
═══════════════════════════════════════════════════════════════════════════════
${jurisdictionInstructions}

═══════════════════════════════════════════════════════════════════════════════
TECHNICAL REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════
1. ARROW DIRECTIONS: Use "-down->", "-up->", "-left->", "-right->" for layout control.
2. CONNECTIONS: Always specify both endpoints.
3. BLOCKS: Close all braces properly (every { must have matching }).
4. STRUCTURE: Exactly ONE @startuml and ONE @enduml per diagram. NO notes.
5. CONTENT: Use ONLY provided numbered components/numerals. Un-numbered helper nodes (buses) are allowed.
6. FORBIDDEN: Do NOT use if/else/endif, alt, loop, fork, repeat, while, switch, note, or box.

Figure title: ${title}
Output ONLY the modified diagram code (@startuml..@enduml).`
    : `You are creating a ${diagramInfo.name.toLowerCase()} for a patent figure.
Keep the diagram simple and valid.
CRITICAL: All reference numerals MUST be wrapped in parentheses, e.g., "Controller (100)" NOT "Controller 100".
Invention Type: ${archetype}

═══════════════════════════════════════════════════════════════════════════════
AVAILABLE COMPONENTS/NUMERALS
═══════════════════════════════════════════════════════════════════════════════
${numeralsPreview}
${sourceFactLedgerBlock ? `\n${sourceFactLedgerBlock}` : ''}

**NUMBERED ELEMENT RULE (STRICT):**
- Use ONLY the provided numbered components and their numerals listed above.
- Do NOT invent any additional numbered components or numerals.

**HELPER NODES ALLOWED:**
- You MAY add un-numbered helper nodes ONLY for routing clarity: "Power bus", "Comms bus", "Data bus", "Interface bus"
- Helper nodes MUST NOT contain numerals.

═══════════════════════════════════════════════════════════════════════════════
STYLE RULES (SKINPARAMS AUTO-INJECTED)
═══════════════════════════════════════════════════════════════════════════════
Do NOT generate any skinparam lines. The system injects them automatically.
Just focus on the diagram content.

Default direction: top to bottom direction (produces cleaner patent figures)

═══════════════════════════════════════════════════════════════════════════════
PATENT FIGURE SEMANTICS (STRICT)
═══════════════════════════════════════════════════════════════════════════════
- All connectors are orthogonal (handled by system skinparams).
- No arrow crossings. Use hidden links (-[hidden]->) to avoid crossings.
- Solid arrows (-->) = data/control paths.
- Dashed arrows (..>) = power/utility ONLY.
- NO ARROW LABELS: Do not add text after arrows (e.g., NO "A --> B : label") - labels cause overlap and clutter.
- Nesting depth max = 2 levels (System → Subsystem → Components).

═══════════════════════════════════════════════════════════════════════════════
DIAGRAM TYPE: ${diagramInfo.name}
═══════════════════════════════════════════════════════════════════════════════
${diagramInfo.description}

${diagramInfo.syntaxGuide}

═══════════════════════════════════════════════════════════════════════════════
JURISDICTION-SPECIFIC REQUIREMENTS (${activeJurisdiction})
═══════════════════════════════════════════════════════════════════════════════
${jurisdictionInstructions}

═══════════════════════════════════════════════════════════════════════════════
NOMENCLATURE GUIDE (Apply based on Invention Type)
═══════════════════════════════════════════════════════════════════════════════
- MECHANICAL: Housing, Shaft, Assembly, Coupler, Actuator (and similar physical components).
- SOFTWARE: Module, Engine, Database, API, Interface (and similar logical units).
- ELECTRICAL: Circuit, Terminal, Bus, Transceiver, Sensor (and similar electronic parts).
- BIO: Reagent, Cell, Sequence, Assay, Vector (and similar biological entities).
- CHEMICAL: Compound, Catalyst, Phase, Solution, Reactor (and similar chemical substances).

═══════════════════════════════════════════════════════════════════════════════
DIAGRAM TECHNICAL REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════
1. ARROW DIRECTIONS: Use "-down->", "-up->", "-left->", "-right->" for layout control.
   - CORRECT: A -down-> B
   - Use hidden links (-[hidden]->) to control layout without visible arrows.

2. CONNECTIONS: Always specify both endpoints.
   - CORRECT: 500 --> 600
   - INCORRECT: 500 -- (Dangling connection)

3. BLOCKS: Close all braces properly (every { must have matching }).

4. STRUCTURE:
   - Exactly ONE @startuml and ONE @enduml per diagram.
   - NO "note" elements (they create visual clutter).

5. CONTENT:
   - Use ONLY provided numbered components/numerals.
   - Un-numbered helper nodes (buses) are allowed for routing.
   - NUMERALS MUST be wrapped in parentheses, e.g., "Controller (100)" NOT "Controller 100".

6. FORBIDDEN: Do NOT use if/else/endif, alt, loop, fork, repeat, while, switch, note, or box.

Existing title: ${title}
User instructions: ${instructions || 'none'}
Output ONLY the diagram code (@startuml..@enduml).`

  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, {
    taskCode: 'LLM3_DIAGRAM',
    stageCode: 'DRAFT_DIAGRAM_GENERATION', // Use admin-configured model/limits
    prompt,
    idempotencyKey: crypto.randomUUID(),
    inputTokens: Math.ceil(prompt.length / 4),
    metadata: {
      patentId,
      sessionId,
      figureNo,
      purpose: 'regenerate_diagram_llm'
    }
  })
  if (!result.success || !result.response) return NextResponse.json({ error: result.error?.message || 'LLM failed' }, { status: 400 })

  const text = (result.response.output || '').trim()
  if (!text.includes('@startuml')) return NextResponse.json({ error: 'No diagram code found in response' }, { status: 400 })

  const processed = await processDiagramWithRepair(text, {
    diagramType,
    figureTitle: title,
    description: instructions || '',
    numerals: components.map((c: any) => `${c.name} (${c.referenceLabel || c.numeral || '?'})`),
    requestHeaders
  })
  if (!processed.ok || !processed.code) {
    return buildDiagramFailureResponse([
      { index: 1, title, reason: plantUmlErrorsToReason(processed.errors) }
    ], processed.repairSummary)
  }

  let code = processed.code
  const warnings = [...processed.warnings]

  // ═══════════════════════════════════════════════════════════════════════════
  // POST-REPAIR WARNING CHECKS
  // ═══════════════════════════════════════════════════════════════════════════
  
  // C6: Validate activity diagrams have numerals (warning only)
  const activityValidation = validateActivityNumerals(code)
  if (!activityValidation.valid) {
    const warning = `Figure ${figureNo} has activity actions without numerals: ${activityValidation.missingNumerals.join(', ')}`
    console.warn(`[RegenerateDiagramLLM] ${warning}`)
    warnings.push(warning)
  }

  const checksum = crypto.createHash('sha256').update(code).digest('hex')

  // IMPORTANT: When code changes, clear image data so frontend triggers re-render
  const diagramSource = await prisma.diagramSource.upsert({
    where: { sessionId_figureNo_language: { sessionId, figureNo, language: 'en' } },
    update: { 
      plantumlCode: code, 
      checksum,
      // Clear cached image data to force re-rendering
      imageFilename: null,
      imagePath: null,
      imageChecksum: null,
      imageUploadedAt: null
    },
    create: { sessionId, figureNo, plantumlCode: code, checksum, language: 'en' }
  })

  return NextResponse.json({ diagramSource })
}

async function handleAddFigureLLM(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, instructions, diagramType: requestedType } = data
  if (!sessionId) return NextResponse.json({ error: 'Session ID required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id }, include: { referenceMap: true, figurePlans: true, ideaRecord: true } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  await reactivateFiguresForSession(sessionId)

  // Get active jurisdiction
  const activeJurisdiction = (session as any).activeJurisdiction || 
    ((session as any).draftingJurisdictions?.[0]) || 'US'

  // Fetch jurisdiction-specific diagram configuration
  const diagramConfig = await getDiagramConfig(activeJurisdiction, user.id, sessionId)
  const jurisdictionInstructions = await buildJurisdictionDiagramInstructions(activeJurisdiction, diagramConfig, 'block')

  const components2 = extractComponentsArray(session.referenceMap)
  const numeralsPreview = components2.map((c: any) => `${c.name} (${c.referenceLabel || c.numeral || '?'})`).join(', ')

  // Determine Diagram Archetype
  const idea = session.ideaRecord?.normalizedData as any
  const sourceFactLedgerBlock = buildSupportOrSourceFactBlock(
    idea,
    idea?.sourceFactLedger,
    'briefDescriptionOfDrawings',
    'SUPPORT DATA SOURCES FOR NEW FIGURE',
    'SOURCE FACT LEDGER FOR NEW FIGURE'
  )
  const types = Array.isArray(idea?.inventionType) ? idea.inventionType : (idea?.inventionType ? [idea.inventionType] : [])
  const archetype = types.length > 0 ? types.join('+') : 'GENERAL'

  // Determine diagram type - use requested type or default to block
  const diagramType: DiagramType = (requestedType && ['block', 'activity', 'sequence', 'state', 'constituent'].includes(requestedType))
    ? requestedType as DiagramType 
    : 'block'
  const diagramInfo = DIAGRAM_TYPES[diagramType]

  const prompt = `Add one new ${diagramInfo.name.toLowerCase()} figure for a patent.
CRITICAL: All reference numerals MUST be wrapped in parentheses, e.g., "Controller (100)" NOT "Controller 100".
Invention Type: ${archetype}

═══════════════════════════════════════════════════════════════════════════════
AVAILABLE COMPONENTS/NUMERALS
═══════════════════════════════════════════════════════════════════════════════
${numeralsPreview}
${sourceFactLedgerBlock ? `\n${sourceFactLedgerBlock}` : ''}

**NUMBERED ELEMENT RULE (STRICT):**
- Use ONLY the provided numbered components and their numerals listed above.
- Do NOT invent any additional numbered components or numerals.

**HELPER NODES ALLOWED:**
- You MAY add un-numbered helper nodes ONLY for routing clarity: "Power bus", "Comms bus", "Data bus", "Interface bus"
- Helper nodes MUST NOT contain numerals.

═══════════════════════════════════════════════════════════════════════════════
STYLE RULES (SKINPARAMS AUTO-INJECTED)
═══════════════════════════════════════════════════════════════════════════════
Do NOT generate any skinparam lines. The system injects them automatically.
Just focus on the diagram content.

Default direction: top to bottom direction (produces cleaner patent figures)

═══════════════════════════════════════════════════════════════════════════════
PATENT FIGURE SEMANTICS (STRICT)
═══════════════════════════════════════════════════════════════════════════════
- All connectors are orthogonal (handled by system skinparams).
- No arrow crossings. Use hidden links (-[hidden]->) to avoid crossings.
- Solid arrows (-->) = data/control paths.
- Dashed arrows (..>) = power/utility ONLY.
- NO ARROW LABELS: Do not add text after arrows (e.g., NO "A --> B : label") - labels cause overlap and clutter.
- Nesting depth max = 2 levels (System → Subsystem → Components).

═══════════════════════════════════════════════════════════════════════════════
DIAGRAM TYPE: ${diagramInfo.name}
═══════════════════════════════════════════════════════════════════════════════
${diagramInfo.description}

${diagramInfo.syntaxGuide}

═══════════════════════════════════════════════════════════════════════════════
JURISDICTION-SPECIFIC REQUIREMENTS (${activeJurisdiction})
═══════════════════════════════════════════════════════════════════════════════
${jurisdictionInstructions}

═══════════════════════════════════════════════════════════════════════════════
NOMENCLATURE GUIDE (Apply based on Invention Type)
═══════════════════════════════════════════════════════════════════════════════
- MECHANICAL: Housing, Shaft, Assembly, Coupler, Actuator (and similar physical components).
- SOFTWARE: Module, Engine, Database, API, Interface (and similar logical units).
- ELECTRICAL: Circuit, Terminal, Bus, Transceiver, Sensor (and similar electronic parts).
- BIO: Reagent, Cell, Sequence, Assay, Vector (and similar biological entities).
- CHEMICAL: Compound, Catalyst, Phase, Solution, Reactor (and similar chemical substances).

═══════════════════════════════════════════════════════════════════════════════
DIAGRAM TECHNICAL REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════
1. ARROW DIRECTIONS: Use "-down->", "-up->", "-left->", "-right->" for layout control.
   - Use hidden links (-[hidden]->) to control layout without visible arrows.

2. CONNECTIONS: Always specify both endpoints.
   - CORRECT: 500 --> 600
   - INCORRECT: 500 -- (Dangling connection)

3. BLOCKS: Close all blocks properly.

4. STRUCTURE:
   - Exactly ONE @startuml and ONE @enduml per diagram.
   - NO "note" elements (they create visual clutter).

5. CONTENT:
   - Use ONLY provided numbered components/numerals.
   - Un-numbered helper nodes (buses) are allowed for routing.
   - NUMERALS MUST be wrapped in parentheses, e.g., "Controller (100)" NOT "Controller 100".

User instructions: ${instructions || 'none'}
Return ONLY diagram code.`

  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, {
    taskCode: 'LLM3_DIAGRAM',
    stageCode: 'DRAFT_DIAGRAM_GENERATION', // Use admin-configured model/limits
    prompt,
    idempotencyKey: crypto.randomUUID(),
    inputTokens: Math.ceil(prompt.length / 4),
    metadata: {
      patentId,
      sessionId,
      purpose: 'add_figure_llm'
    }
  })
  if (!result.success || !result.response) return NextResponse.json({ error: result.error?.message || 'LLM failed' }, { status: 400 })

  const text = (result.response.output || '').trim()
  if (!text.includes('@startuml')) return NextResponse.json({ error: 'No diagram code found in response' }, { status: 400 })

  const processed = await processDiagramWithRepair(text, {
    diagramType,
    figureTitle: 'New figure',
    description: instructions || '',
    numerals: components2.map((c: any) => `${c.name} (${c.referenceLabel || c.numeral || '?'})`),
    requestHeaders
  })
  if (!processed.ok || !processed.code) {
    return buildDiagramFailureResponse([
      { index: 1, title: 'New figure', reason: plantUmlErrorsToReason(processed.errors) }
    ], processed.repairSummary)
  }

  const code = processed.code
  const warnings = [...processed.warnings]

  // ═══════════════════════════════════════════════════════════════════════════
  // POST-REPAIR WARNING CHECKS
  // ═══════════════════════════════════════════════════════════════════════════
  
  // C6: Validate activity diagrams have numerals (warning only)
  const activityValidation = validateActivityNumerals(code)
  if (!activityValidation.valid) {
    const warning = `New figure has activity actions without numerals: ${activityValidation.missingNumerals.join(', ')}`
    console.warn(`[AddFigureLLM] ${warning}`)
    warnings.push(warning)
  }

  // Assign next figure number
  const existingPlans = await prisma.figurePlan.findMany({ where: { sessionId } })
  const used = new Set(existingPlans.map(fp => fp.figureNo))
  let figureNo = 1
  while (used.has(figureNo)) figureNo++

  const title = `Figure ${figureNo}`
  const checksum = crypto.createHash('sha256').update(code).digest('hex')

  await prisma.figurePlan.upsert({ where: { sessionId_figureNo: { sessionId, figureNo } }, update: { title }, create: { sessionId, figureNo, title, nodes: [], edges: [] } })
  const diagramSource = await prisma.diagramSource.upsert({ where: { sessionId_figureNo_language: { sessionId, figureNo, language: 'en' } }, update: { plantumlCode: code, checksum }, create: { sessionId, figureNo, plantumlCode: code, checksum, language: 'en' } })

  return NextResponse.json({
    diagramSource,
    warnings: warnings.length > 0 ? warnings : undefined,
    repairSummary: shouldExposeRepairSummary(processed.repairSummary) ? processed.repairSummary : undefined
  })
}

async function handleAddFiguresLLM(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, instructionsList } = data
  if (!sessionId || !Array.isArray(instructionsList) || instructionsList.length === 0) return NextResponse.json({ error: 'Session ID and instructions list required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { referenceMap: true, figurePlans: true, diagramSources: true, ideaRecord: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  await reactivateFiguresForSession(sessionId)

  // Get active jurisdiction
  const activeJurisdiction = (session as any).activeJurisdiction || 
    ((session as any).draftingJurisdictions?.[0]) || 'US'

  // Fetch jurisdiction-specific diagram configuration
  const diagramConfig = await getDiagramConfig(activeJurisdiction, user.id, sessionId)
  const jurisdictionInstructions = await buildJurisdictionDiagramInstructions(activeJurisdiction, diagramConfig, 'block')

  const components3 = extractComponentsArray(session.referenceMap)
  const numeralsPreview = components3.map((c: any) => `${c.name} (${c.referenceLabel || c.numeral || '?'})`).join(', ')
  const existingNames = session!.figurePlans?.map((f: any) => {
    const clean = sanitizeFigureTitleInput(f.title) || `Figure ${f.figureNo}`
    return `Fig.${f.figureNo}: ${clean}`
  }).join('; ')
  const inventionTitle = session.ideaRecord?.title || ''
  const idea = session.ideaRecord?.normalizedData as any
  const sourceFactLedgerBlock = buildSupportOrSourceFactBlock(
    idea,
    idea?.sourceFactLedger,
    'briefDescriptionOfDrawings',
    'SUPPORT DATA SOURCES FOR NEW FIGURES',
    'SOURCE FACT LEDGER FOR NEW FIGURES'
  )
  const types = Array.isArray(idea?.inventionType) ? idea.inventionType : (idea?.inventionType ? [idea.inventionType] : [])
  const archetype = types.length > 0 ? types.join('+') : 'GENERAL'

  const aggregatePrompt = `You are adding ${instructionsList.length} new simple block diagram figures to a patent.
Invention: ${inventionTitle}
CRITICAL: All reference numerals MUST be wrapped in parentheses, e.g., "Controller (100)" NOT "Controller 100".
Existing figures: ${existingNames || 'none'}
Invention Type: ${archetype}

═══════════════════════════════════════════════════════════════════════════════
AVAILABLE COMPONENTS/NUMERALS
═══════════════════════════════════════════════════════════════════════════════
${numeralsPreview}
${sourceFactLedgerBlock ? `\n${sourceFactLedgerBlock}` : ''}

**NUMBERED ELEMENT RULE (STRICT):**
- Use ONLY the provided numbered components and their numerals listed above.
- Do NOT invent any additional numbered components or numerals.

**HELPER NODES ALLOWED:**
- You MAY add un-numbered helper nodes ONLY for routing clarity: "Power bus", "Comms bus", "Data bus", "Interface bus"
- Helper nodes MUST NOT contain numerals.

═══════════════════════════════════════════════════════════════════════════════
CANONICAL STYLE (HANDLED AUTOMATICALLY)
═══════════════════════════════════════════════════════════════════════════════
Do NOT include any skinparam settings in your PlantUML code.
The system will automatically inject the correct skinparams for clean patent-style diagrams
with white backgrounds, black borders, and proper spacing.

Default direction: top to bottom direction (produces cleaner patent figures)

═══════════════════════════════════════════════════════════════════════════════
PATENT FIGURE SEMANTICS (STRICT)
═══════════════════════════════════════════════════════════════════════════════
- All connectors must be orthogonal (applied automatically via skinparam injection).
- No arrow crossings. Use hidden links (-[hidden]->) to avoid crossings.
- Solid arrows (-->) = data/control paths.
- Dashed arrows (..>) = power/utility ONLY.
- NO ARROW LABELS: Do not add text after arrows (e.g., NO "A --> B : label") - labels cause overlap and clutter.
- Nesting depth max = 2 levels.

═══════════════════════════════════════════════════════════════════════════════
JURISDICTION-SPECIFIC REQUIREMENTS (${activeJurisdiction})
═══════════════════════════════════════════════════════════════════════════════
${jurisdictionInstructions}

═══════════════════════════════════════════════════════════════════════════════
NOMENCLATURE GUIDE (Apply based on Invention Type)
═══════════════════════════════════════════════════════════════════════════════
- MECHANICAL: Housing, Shaft, Assembly, Coupler, Actuator (and similar physical components).
- SOFTWARE: Module, Engine, Database, API, Interface (and similar logical units).
- ELECTRICAL: Circuit, Terminal, Bus, Transceiver, Sensor (and similar electronic parts).
- BIO: Reagent, Cell, Sequence, Assay, Vector (and similar biological entities).
- CHEMICAL: Compound, Catalyst, Phase, Solution, Reactor (and similar chemical substances).

═══════════════════════════════════════════════════════════════════════════════
DIAGRAM TECHNICAL REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════
1. ARROW DIRECTIONS: Use "-down->", "-up->", "-left->", "-right->" for layout control.
   - Use hidden links (-[hidden]->) to control layout without visible arrows.

2. CONNECTIONS: Always specify both endpoints.

3. BLOCKS: Close all blocks properly.

4. STRUCTURE:
   - Exactly ONE @startuml and ONE @enduml per diagram.
   - NO "note" elements (they create visual clutter).

5. CONTENT:
   - Use ONLY provided numbered components/numerals.
   - Un-numbered helper nodes (buses) are allowed for routing.
   - NUMERALS MUST be wrapped in parentheses, e.g., "Controller (100)" NOT "Controller 100".

Generate ${instructionsList.length} SEPARATE DIAGRAMS. Each must be complete and valid.
For each item below, return ONLY PlantUML (@startuml..@enduml), one block per item, in the same order.
Items:\n- ${instructionsList.join('\n- ')}`

  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, {
    taskCode: 'LLM3_DIAGRAM',
    stageCode: 'DRAFT_DIAGRAM_GENERATION', // Use admin-configured model/limits
    prompt: aggregatePrompt,
    idempotencyKey: crypto.randomUUID(),
    inputTokens: Math.ceil(aggregatePrompt.length / 4),
    metadata: {
      patentId,
      sessionId,
      purpose: 'add_figures_llm'
    }
  })
  if (!result.success || !result.response) return NextResponse.json({ error: result.error?.message || 'LLM failed' }, { status: 400 })

  const text = (result.response.output || '').trim()
  let blocks = Array.from(text.matchAll(/@startuml[\s\S]*?@enduml/g)).map(m => m[0])
  if (blocks.length === 0) {
    // Try JSON array
    try {
      const json = JSON.parse(text)
      const arr = Array.isArray(json?.figures) ? json.figures : (Array.isArray(json) ? json : [])
      blocks = arr
        .map((it: any) => (typeof it?.plantuml === 'string' ? it.plantuml : null))
        .filter((it: any) => typeof it === 'string' && it.includes('@startuml'))
    } catch {}
  }
  if (blocks.length === 0 && text.includes('@startuml')) {
    blocks = [text]
  }
  if (blocks.length === 0) return NextResponse.json({ error: 'No diagram blocks found' }, { status: 400 })

  const existingPlans = await prisma.figurePlan.findMany({ where: { sessionId } })
  const used = new Set(existingPlans.map(fp => fp.figureNo))
  let figureNoCounter = 1
  const nextNo = () => {
    while (used.has(figureNoCounter)) figureNoCounter++
    const n = figureNoCounter
    used.add(n)
    figureNoCounter++
    return n
  }

  const created: any[] = []
  const skipped: number[] = []
  const warnings: string[] = []
  const failedFigures: DiagramProcessingFailure[] = []
  const repairSummary = emptyRepairSummary()
  const availableNumerals = components3.map((c: any) => `${c.name} (${c.referenceLabel || c.numeral || '?'})`)
  
  for (let i = 0; i < blocks.length; i++) {
    const rawCode = blocks[i]
    const requestedTitle = `Requested figure ${i + 1}`
    const processed = await processDiagramWithRepair(rawCode, {
      diagramType: inferPlantUmlDiagramType(rawCode),
      figureTitle: requestedTitle,
      description: String(instructionsList[i] || ''),
      numerals: availableNumerals,
      requestHeaders
    })
    mergeRepairSummary(repairSummary, processed.repairSummary)
    if (processed.warnings.length > 0) {
      warnings.push(...processed.warnings.map(w => `${requestedTitle}: ${w}`))
    }

    if (!processed.ok || !processed.code) {
      const reason = plantUmlErrorsToReason(processed.errors)
      console.warn(`[AddFiguresLLM] Block ${i + 1} failed after repair processing: ${reason}`)
      skipped.push(i + 1)
      failedFigures.push({ index: i + 1, title: requestedTitle, reason })
      continue
    }

    const code = processed.code
    
    // ═══════════════════════════════════════════════════════════════════════════
    // POST-REPAIR WARNING CHECKS
    // ═══════════════════════════════════════════════════════════════════════════
    
    const activityValidation = validateActivityNumerals(code)
    if (!activityValidation.valid) {
      const warning = `${requestedTitle} has activity actions without numerals: ${activityValidation.missingNumerals.join(', ')}`
      console.warn(`[AddFiguresLLM] ${warning}`)
      warnings.push(warning)
    }
    
    const no = nextNo()
    const title = `Figure ${no}`
    const safeTitle = sanitizeFigureTitleInput(title) || title
    const checksum = crypto.createHash('sha256').update(code).digest('hex')
    await prisma.figurePlan.upsert({ where: { sessionId_figureNo: { sessionId, figureNo: no } }, update: { title: safeTitle }, create: { sessionId, figureNo: no, title: safeTitle, nodes: [], edges: [] } })
    const diagramSource = await prisma.diagramSource.upsert({ where: { sessionId_figureNo_language: { sessionId, figureNo: no, language: 'en' } }, update: { plantumlCode: code, checksum }, create: { sessionId, figureNo: no, plantumlCode: code, checksum, language: 'en' } })
    created.push({ figureNo: no, diagramSource })
  }

  if (created.length === 0) {
    return buildDiagramFailureResponse(failedFigures, repairSummary)
  }
  if (failedFigures.length > 0) {
    warnings.push(`${failedFigures.length} diagram(s) could not be repaired and were skipped.`)
  }

  return NextResponse.json({
    created,
    skippedBlocks: skipped.length > 0 ? skipped : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    repairSummary: shouldExposeRepairSummary(repairSummary) ? repairSummary : undefined,
    failedFigures: failedFigures.length > 0 ? failedFigures : undefined
  })
}

async function handleDeleteFigure(user: any, patentId: string, data: any) {
  const { sessionId, figureNo, language } = data
  if (!sessionId || !figureNo) return NextResponse.json({ error: 'Session ID and figure number required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ 
    where: { id: sessionId, patentId, userId: user.id },
    select: { id: true, figureSequence: true, figureSequenceFinalized: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Get the figurePlan ID before deletion (needed to clean up sequence)
  const figurePlan = await prisma.figurePlan.findUnique({
    where: { sessionId_figureNo: { sessionId, figureNo } },
    select: { id: true }
  })

  // Delete only the requested language variant (default to English)
  const targetLang = (language || 'en').toLowerCase()
  await prisma.diagramSource.deleteMany({ where: { sessionId, figureNo, language: targetLang } })

  // If no diagram sources remain for this figure, clean up the plan as well
  const remainingSources = await prisma.diagramSource.count({ where: { sessionId, figureNo } })
  if (remainingSources === 0) {
    await prisma.figurePlan.deleteMany({ where: { sessionId, figureNo } })
    
    // Also remove this figure from the frozen figureSequence if it exists
    if (figurePlan && Array.isArray(session.figureSequence)) {
      const currentSequence = session.figureSequence as Array<{ id: string; type: string; sourceId: string; finalFigNo: number }>
      const updatedSequence = currentSequence
        .filter(item => !(item.type === 'diagram' && item.sourceId === figurePlan.id))
        .map((item, index) => ({ ...item, finalFigNo: index + 1 })) // Re-number figures
      
      await prisma.draftingSession.update({
        where: { id: sessionId },
        data: { figureSequence: updatedSequence }
      })
    }
  }

  return NextResponse.json({ deleted: true, remainingSources })
}

async function handleCreateManualFigure(user: any, patentId: string, data: any) {
  const { sessionId, title, description, figureNo } = data
  if (!sessionId || !description || (description as string).trim().split(/\s+/).length < 20) {
    return NextResponse.json({ error: 'At least 20 words description required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({ 
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      figurePlans: {
        select: { id: true, figureNo: true },
        orderBy: { figureNo: 'asc' }
      },
      sketchRecords: {
        where: { isDeleted: false, status: 'SUCCESS' },
        select: { id: true },
        orderBy: { createdAt: 'asc' }
      }
    }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  await reactivateFiguresForSession(sessionId)

  let loadedSketches = session.sketchRecords || []
  if (loadedSketches.length === 0) {
    loadedSketches = await prisma.sketchRecord.findMany({
      where: {
        patentId,
        isDeleted: false,
        status: 'SUCCESS'
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' }
    })
  }

  // Assign number if not provided
  let no = Number(figureNo)
  if (!Number.isInteger(no) || no <= 0) no = 0
  if (!no) {
    const maxExistingFigureNo = (session.figurePlans || []).reduce(
      (max, plan) => Math.max(max, plan.figureNo || 0),
      0
    )
    no = maxExistingFigureNo + 1
  }
  const wasExistingFigure = (session.figurePlans || []).some(plan => plan.figureNo === no)

  const cleanedTitle = sanitizeFigureTitleInput(title) || `Figure ${no}`

  const figurePlan = await prisma.figurePlan.upsert({
    where: { sessionId_figureNo: { sessionId, figureNo: no } },
    update: { title: cleanedTitle, description },
    create: { sessionId, figureNo: no, title: cleanedTitle, description, nodes: [], edges: [] }
  })

  // Create empty source to allow upload linkage later
  await prisma.diagramSource.upsert({
    where: { sessionId_figureNo_language: { sessionId, figureNo: no, language: 'en' } },
    update: {},
    create: { sessionId, figureNo: no, plantumlCode: '', checksum: '', language: 'en' }
  })

  // Add new figure to figureSequence if not finalized
  if (!session.figureSequenceFinalized) {
    const newId = `diagram-${no}`
    const existingDiagramPlans = (session.figurePlans || [])
      .filter(plan => plan.figureNo !== no)
    const allDiagramFigures = [
      ...existingDiagramPlans,
      { id: figurePlan.id, figureNo: no }
    ]
      .sort((a, b) => a.figureNo - b.figureNo)
      .map(plan => ({
        id: `diagram-${plan.figureNo}`,
        type: 'diagram' as const,
        sourceId: plan.id
      }))
    const existingSketchFigures = loadedSketches.map(sketch => ({
      id: `sketch-${sketch.id}`,
      type: 'sketch' as const,
      sourceId: sketch.id
    }))
    const newFigure = {
      id: newId,
      type: 'diagram' as const,
      sourceId: figurePlan.id
    }
    const currentSequence = (session.figureSequence as Array<{ id: string; type: string; sourceId: string; finalFigNo: number }>) || []
    const { normalized: updatedSequence } = wasExistingFigure
      ? normalizeFigureSequence(currentSequence, [...allDiagramFigures, ...existingSketchFigures])
      : appendFigureToSequence(currentSequence, [...allDiagramFigures.filter(figure => figure.id !== newId), ...existingSketchFigures], newFigure)

    await prisma.draftingSession.update({
      where: { id: sessionId },
      data: { figureSequence: updatedSequence }
    })
  }

  return NextResponse.json({ created: { figureNo: no } })
}

// === SKETCH GENERATION HANDLERS ===

/**
 * Helper to check DIAGRAM_GENERATION feature access for sketch operations
 * Sketches are part of the DIAGRAM_GENERATION feature for plan tier control
 */
async function checkSketchAccess(user: any): Promise<NextResponse | null> {
  if (user.tenantId) {
    const diagramCheck = await enforceServiceAccess(
      user.id,
      user.tenantId,
      'DIAGRAM_GENERATION'
    )
    if (!diagramCheck.allowed) {
      return diagramCheck.response
    }
  }
  return null // Access allowed
}

/**
 * Detect visible content in a user-uploaded external figure image.
 */
async function handleDetectExternalImageContent(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, uploadedImageBase64, uploadedImageMimeType, title } = data

  const accessDenied = await checkSketchAccess(user)
  if (accessDenied) return accessDenied

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  if (!uploadedImageBase64 || !uploadedImageMimeType) {
    return NextResponse.json({ error: 'Uploaded image is required for AI detection' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })
  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  try {
    const result = await detectExternalImageContent({
      patentId,
      sessionId,
      uploadedImageBase64,
      uploadedImageMimeType,
      title,
      requestHeaders
    })

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: result.error || 'AI image content detection failed',
        imageWidth: result.imageWidth,
        imageHeight: result.imageHeight
      }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[ExternalImageDetection] Error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'AI image content detection failed'
    }, { status: 500 })
  }
}

/**
 * Generate sketch in AUTO mode - uses invention context only
 */
async function handleGenerateSketch(user: any, patentId: string, data: any) {
  const { sessionId, title, viewsRequested, contextFlags, referenceSketchIds } = data

  // Check DIAGRAM_GENERATION feature access (plan tier control)
  const accessDenied = await checkSketchAccess(user)
  if (accessDenied) return accessDenied

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })
  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }
  await reactivateFiguresForSession(sessionId)

  try {
    const result = await generateSketch({
      patentId,
      sessionId,
      mode: 'AUTO',
      title: title || 'Auto-generated Sketch',
      contextFlags: contextFlags as SketchContextFlags,
      viewsRequested: viewsRequested as SketchViewConfig,
      referenceSketchIds: Array.isArray(referenceSketchIds) ? referenceSketchIds : undefined
    }, user.id, (session as any).tenantId)

    if (result.success) {
      return NextResponse.json({
        success: true,
        sketchId: result.sketchId,
        imagePath: result.imagePath,
        imageUrl: result.imageUrl
      })
    } else {
      return NextResponse.json({
        success: false,
        error: result.error,
        sketchId: result.sketchId
      }, { status: 400 })
    }
  } catch (error) {
    console.error('[Sketch] Generation error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Sketch generation failed'
    }, { status: 500 })
  }
}

/**
 * Generate sketch in GUIDED mode - uses context + user instructions
 */
async function handleGenerateSketchGuided(user: any, patentId: string, data: any) {
  const { sessionId, title, userPrompt, viewsRequested, contextFlags, referenceSketchIds } = data

  // Check DIAGRAM_GENERATION feature access (plan tier control)
  const accessDenied = await checkSketchAccess(user)
  if (accessDenied) return accessDenied

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  if (!userPrompt || (userPrompt as string).trim().length < 10) {
    return NextResponse.json({ error: 'User prompt must be at least 10 characters' }, { status: 400 })
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })
  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }
  await reactivateFiguresForSession(sessionId)

  try {
    const result = await generateSketch({
      patentId,
      sessionId,
      mode: 'GUIDED',
      title: title || 'Guided Sketch',
      userPrompt,
      contextFlags: contextFlags as SketchContextFlags,
      viewsRequested: viewsRequested as SketchViewConfig,
      referenceSketchIds: Array.isArray(referenceSketchIds) ? referenceSketchIds : undefined
    }, user.id, (session as any).tenantId)

    if (result.success) {
      return NextResponse.json({
        success: true,
        sketchId: result.sketchId,
        imagePath: result.imagePath,
        imageUrl: result.imageUrl
      })
    } else {
      return NextResponse.json({
        success: false,
        error: result.error,
        sketchId: result.sketchId
      }, { status: 400 })
    }
  } catch (error) {
    console.error('[Sketch] Guided generation error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Sketch generation failed'
    }, { status: 500 })
  }
}

/**
 * Refine an uploaded sketch - REFINE mode
 */
async function handleRefineSketch(user: any, patentId: string, data: any) {
  const { sessionId, title, userPrompt, uploadedImageBase64, uploadedImageMimeType, contextFlags } = data

  // Check DIAGRAM_GENERATION feature access (plan tier control)
  const accessDenied = await checkSketchAccess(user)
  if (accessDenied) return accessDenied

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  if (!uploadedImageBase64 || !uploadedImageMimeType) {
    return NextResponse.json({ error: 'Uploaded image is required for REFINE mode' }, { status: 400 })
  }

  // Validate mime type
  const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
  if (!allowedMimeTypes.includes(uploadedImageMimeType)) {
    return NextResponse.json({ 
      error: `Invalid image type. Allowed: ${allowedMimeTypes.join(', ')}` 
    }, { status: 400 })
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })
  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }
  await reactivateFiguresForSession(sessionId)

  try {
    const result = await generateSketch({
      patentId,
      sessionId,
      mode: 'REFINE',
      title: title || 'Refined Sketch',
      userPrompt,
      uploadedImageBase64,
      uploadedImageMimeType,
      contextFlags: contextFlags as SketchContextFlags
    }, user.id, (session as any).tenantId)

    if (result.success) {
      return NextResponse.json({
        success: true,
        sketchId: result.sketchId,
        imagePath: result.imagePath,
        imageUrl: result.imageUrl
      })
    } else {
      return NextResponse.json({
        success: false,
        error: result.error,
        sketchId: result.sketchId
      }, { status: 400 })
    }
  } catch (error) {
    console.error('[Sketch] Refine error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Sketch refinement failed'
    }, { status: 500 })
  }
}

/**
 * Modify an existing sketch
 */
async function handleModifySketch(user: any, patentId: string, data: any) {
  const { sessionId, sourceSketchId, userPrompt, title } = data

  // Check DIAGRAM_GENERATION feature access (plan tier control)
  const accessDenied = await checkSketchAccess(user)
  if (accessDenied) return accessDenied

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  if (!sourceSketchId) {
    return NextResponse.json({ error: 'Source sketch ID is required for modification' }, { status: 400 })
  }

  if (!userPrompt || (userPrompt as string).trim().length < 5) {
    return NextResponse.json({ error: 'Modification instructions required' }, { status: 400 })
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })
  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }
  await reactivateFiguresForSession(sessionId)

  // Verify source sketch exists and belongs to this patent
  const sourceSketch = await prisma.sketchRecord.findFirst({
    where: { id: sourceSketchId, patentId }
  })
  if (!sourceSketch) {
    return NextResponse.json({ error: 'Source sketch not found' }, { status: 404 })
  }

  try {
    const result = await generateSketch({
      patentId,
      sessionId,
      mode: 'GUIDED', // Modifications are essentially guided generations
      title: title || `Modified: ${sourceSketch.title}`,
      userPrompt,
      sourceSketchId
    }, user.id, (session as any).tenantId)

    if (result.success) {
      return NextResponse.json({
        success: true,
        sketchId: result.sketchId,
        imagePath: result.imagePath,
        imageUrl: result.imageUrl,
        sourceSketchId
      })
    } else {
      return NextResponse.json({
        success: false,
        error: result.error,
        sketchId: result.sketchId
      }, { status: 400 })
    }
  } catch (error) {
    console.error('[Sketch] Modify error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Sketch modification failed'
    }, { status: 500 })
  }
}

/**
 * List all sketches for a patent/session
 */
async function handleListSketches(user: any, patentId: string, data: any) {
  const { sessionId, includeDeleted, favoritesOnly, limit, offset } = data

  try {
    const sketches = await listSketches(patentId, sessionId, {
      includeDeleted: includeDeleted === true,
      favoritesOnly: favoritesOnly === true,
      limit: typeof limit === 'number' ? limit : 50,
      offset: typeof offset === 'number' ? offset : 0
    })

    return NextResponse.json({ sketches })
  } catch (error) {
    console.error('[Sketch] List error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to list sketches'
    }, { status: 500 })
  }
}

/**
 * Get a single sketch by ID
 */
async function handleGetSketch(user: any, patentId: string, data: any) {
  const { sketchId } = data

  if (!sketchId) {
    return NextResponse.json({ error: 'Sketch ID is required' }, { status: 400 })
  }

  try {
    const sketch = await getSketch(sketchId)
    
    if (!sketch || sketch.patentId !== patentId) {
      return NextResponse.json({ error: 'Sketch not found' }, { status: 404 })
    }

    return NextResponse.json({ sketch })
  } catch (error) {
    console.error('[Sketch] Get error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to get sketch'
    }, { status: 500 })
  }
}

/**
 * Delete a sketch (soft delete)
 */
async function handleDeleteSketch(user: any, patentId: string, data: any) {
  const { sketchId, sessionId } = data

  if (!sketchId) {
    return NextResponse.json({ error: 'Sketch ID is required' }, { status: 400 })
  }

  try {
    const result = await deleteSketch(sketchId, user.id)
    
    if (result.success) {
      // Clean up figureSequence if sessionId is provided
      if (sessionId) {
        const session = await prisma.draftingSession.findFirst({
          where: { id: sessionId, patentId, userId: user.id },
          select: { id: true, figureSequence: true }
        })
        
        if (session && Array.isArray(session.figureSequence)) {
          const currentSequence = session.figureSequence as Array<{ id: string; type: string; sourceId: string; finalFigNo: number }>
          const updatedSequence = currentSequence
            .filter(item => !(item.type === 'sketch' && item.sourceId === sketchId))
            .map((item, index) => ({ ...item, finalFigNo: index + 1 })) // Re-number figures
          
          await prisma.draftingSession.update({
            where: { id: sessionId },
            data: { figureSequence: updatedSequence }
          })
        }
      }
      
      return NextResponse.json({ success: true, deleted: true })
    } else {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
  } catch (error) {
    console.error('[Sketch] Delete error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to delete sketch'
    }, { status: 500 })
  }
}

/**
 * Toggle sketch favorite status
 */
async function handleToggleSketchFavorite(user: any, patentId: string, data: any) {
  const { sketchId } = data

  if (!sketchId) {
    return NextResponse.json({ error: 'Sketch ID is required' }, { status: 400 })
  }

  try {
    // Verify sketch belongs to this patent
    const sketch = await prisma.sketchRecord.findFirst({
      where: { id: sketchId, patentId }
    })
    if (!sketch) {
      return NextResponse.json({ error: 'Sketch not found' }, { status: 404 })
    }

    const result = await toggleSketchFavorite(sketchId)
    
    return NextResponse.json({
      success: result.success,
      isFavorite: result.isFavorite
    })
  } catch (error) {
    console.error('[Sketch] Toggle favorite error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to toggle favorite'
    }, { status: 500 })
  }
}

/**
 * Update sketch metadata (title, description)
 */
async function handleUpdateSketchMetadata(user: any, patentId: string, data: any) {
  const { sketchId, title, description } = data

  if (!sketchId) {
    return NextResponse.json({ error: 'Sketch ID is required' }, { status: 400 })
  }

  try {
    // Verify sketch belongs to this patent
    const sketch = await prisma.sketchRecord.findFirst({
      where: { id: sketchId, patentId }
    })
    if (!sketch) {
      return NextResponse.json({ error: 'Sketch not found' }, { status: 404 })
    }

    const result = await updateSketchMetadata(sketchId, {
      ...(title && { title }),
      ...(description !== undefined && { description })
    })
    
    return NextResponse.json({ success: result.success })
  } catch (error) {
    console.error('[Sketch] Update metadata error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to update sketch'
    }, { status: 500 })
  }
}

/**
 * Retry a failed sketch generation
 */
async function handleRetrySketch(user: any, patentId: string, data: any) {
  const { sketchId } = data

  // Check DIAGRAM_GENERATION feature access (plan tier control)
  const accessDenied = await checkSketchAccess(user)
  if (accessDenied) return accessDenied

  if (!sketchId) {
    return NextResponse.json({ error: 'Sketch ID is required' }, { status: 400 })
  }

  try {
    // Verify sketch belongs to this patent
    const sketch = await prisma.sketchRecord.findFirst({
      where: { id: sketchId, patentId }
    })
    if (!sketch) {
      return NextResponse.json({ error: 'Sketch not found' }, { status: 404 })
    }

    const session = sketch.sessionId ? await prisma.draftingSession.findFirst({
      where: { id: sketch.sessionId, userId: user.id }
    }) : null
    if (session?.id) {
      await reactivateFiguresForSession(session.id)
    }

    const result = await retrySketchGeneration(
      sketchId, 
      user.id, 
      (session as any)?.tenantId
    )

    if (result.success) {
      return NextResponse.json({
        success: true,
        sketchId: result.sketchId,
        imagePath: result.imagePath,
        imageUrl: result.imageUrl
      })
    } else {
      return NextResponse.json({
        success: false,
        error: result.error
      }, { status: 400 })
    }
  } catch (error) {
    console.error('[Sketch] Retry error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to retry sketch'
    }, { status: 500 })
  }
}

/**
 * Generate image from a SUGGESTED sketch record.
 * This uses the pre-defined title and description for focused image generation.
 */
async function handleGenerateFromSuggestion(user: any, patentId: string, data: any) {
  const { sketchId } = data

  // Check DIAGRAM_GENERATION feature access (plan tier control)
  const accessDenied = await checkSketchAccess(user)
  if (accessDenied) return accessDenied

  if (!sketchId) {
    return NextResponse.json({ error: 'Sketch ID is required' }, { status: 400 })
  }

  try {
    // Verify sketch belongs to this patent and is SUGGESTED or FAILED
    const sketch = await prisma.sketchRecord.findFirst({
      where: { id: sketchId, patentId }
    })
    
    if (!sketch) {
      return NextResponse.json({ error: 'Sketch not found' }, { status: 404 })
    }

    if (sketch.status !== 'SUGGESTED' && sketch.status !== 'FAILED') {
      return NextResponse.json({ 
        error: 'Can only generate from SUGGESTED or FAILED sketches' 
      }, { status: 400 })
    }

    // Verify session ownership if session exists
    if (sketch.sessionId) {
      const session = await prisma.draftingSession.findFirst({
        where: { id: sketch.sessionId, userId: user.id }
      })
      if (!session) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
      await reactivateFiguresForSession(sketch.sessionId)
    }

    // Import and call the generation function
    const { generateFromSuggestion } = await import('@/lib/sketch-service')
    
    const result = await generateFromSuggestion(
      sketchId,
      user.id,
      user.tenantId
    )

    if (result.success) {
      return NextResponse.json({
        success: true,
        sketchId: result.sketchId,
        imagePath: result.imagePath,
        imageUrl: result.imageUrl
      })
    } else {
      return NextResponse.json({
        success: false,
        error: result.error,
        sketchId: result.sketchId
      }, { status: 400 })
    }
  } catch (error) {
    console.error('[Sketch] Generate from suggestion error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to generate sketch'
    }, { status: 500 })
  }
}

/**
 * Generate sketch suggestions using AI for the Sketch tab.
 * Uses the DRAFT_FIGURE_PLANNER LLM tag for proper routing.
 */
async function handleGenerateSketchSuggestions(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, referenceFigureIds } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  try {
    const session = await prisma.draftingSession.findFirst({
      where: { id: sessionId, patentId, userId: user.id },
      include: {
        ideaRecord: true,
        referenceMap: true,
        figurePlans: true,
        diagramSources: true,
        sketchRecords: {
          where: { isDeleted: false, status: 'SUCCESS' }
        }
      }
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
    }

    // Build list of existing PlantUML diagram titles (to avoid duplicating as sketches)
    const existingDiagrams = (session.figurePlans || []).map((fp: any) => 
      `Figure ${fp.figureNo}: ${fp.title}${fp.description ? ` - ${fp.description}` : ''}`
    )

    // Build list of existing sketches (to avoid duplicating suggestions)
    const existingSketches = (session.sketchRecords || [])
      .filter((sk: any) => sk.status === 'SUCCESS' && !sk.isDeleted)
      .map((sk: any) => 
        `${sk.title || 'Untitled Sketch'}${sk.description ? `: ${sk.description}` : ''}`
      )

    // Build reference figures if user selected any
    let referenceFigures: { title: string; description?: string }[] = []
    if (referenceFigureIds && Array.isArray(referenceFigureIds) && referenceFigureIds.length > 0) {
      // Fetch selected diagrams
      const selectedDiagrams = (session.figurePlans || []).filter((fp: any) => 
        referenceFigureIds.includes(fp.id) || referenceFigureIds.includes(fp.figureNo?.toString())
      )
      // Fetch selected sketches
      const selectedSketches = (session.sketchRecords || []).filter((sk: any) =>
        referenceFigureIds.includes(sk.id)
      )
      
      referenceFigures = [
        ...selectedDiagrams.map((fp: any) => ({ 
          title: fp.title, 
          description: fp.description 
        })),
        ...selectedSketches.map((sk: any) => ({ 
          title: sk.title, 
          description: sk.description 
        }))
      ]
    }

    // Build the sketch suggestions prompt with context (including existing sketches)
    const prompt = buildSketchSuggestionsPrompt(session, existingDiagrams, referenceFigures, existingSketches)

    // Use LLM gateway with the correct tag for Figure Planning
    const { llmGateway } = await import('@/lib/metering/gateway')
    const result = await llmGateway.executeLLMOperation(
      { headers: requestHeaders || {} },
      {
        taskCode: 'LLM3_DIAGRAM',
        stageCode: 'DRAFT_FIGURE_PLANNER', // Updated to use Figure Planning tag
        prompt,
        idempotencyKey: crypto.randomUUID(),
        parameters: { tenantId: session.tenantId || undefined },
        metadata: {
          patentId,
          sessionId,
          purpose: 'generate_sketch_suggestions'
        }
      }
    )

    if (!result.success || !result.response?.output) {
      return NextResponse.json({
        error: 'Failed to generate sketch suggestions'
      }, { status: 500 })
    }

    // Parse AI response
    const suggestionText = result.response.output.trim()
    let suggestions: any[] = []

    try {
      // Try to parse as JSON array
      const start = suggestionText.indexOf('[')
      const end = suggestionText.lastIndexOf(']')
      if (start !== -1 && end !== -1) {
        const jsonStr = suggestionText.substring(start, end + 1)
        const parsed = JSON.parse(jsonStr)
        if (Array.isArray(parsed)) {
          suggestions = parsed.filter(s => s.title && s.description)
        }
      }
    } catch {
      // Fallback: try to extract from structured text
      const regex = /(?:TITLE|Title):\s*(.+?)(?:\n|$)[\s\S]*?(?:DESCRIPTION|Description):\s*([\s\S]+?)(?=(?:TITLE|Title):|$)/gi
      let match: RegExpExecArray | null
      while ((match = regex.exec(suggestionText)) !== null) {
        if (match[1] && match[2]) {
          suggestions.push({
            title: match[1].trim(),
            description: match[2].trim().split('\n')[0] // Take first paragraph
          })
        }
      }
    }

    return NextResponse.json({
      suggestions: suggestions.length > 0 ? suggestions : []
    })

  } catch (error) {
    console.error('[Sketch Suggestions] Error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to generate sketch suggestions'
    }, { status: 500 })
  }
}

// === FIGURE SEQUENCE ARRANGEMENT HANDLERS ===

/**
 * Get all diagrams and sketches combined for the arrangement view.
 * Returns them with current sequence or generates initial sequence if none exists.
 */
async function handleGetCombinedFigures(user: any, patentId: string, data: any) {
  const { sessionId } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  try {
    const session = await prisma.draftingSession.findFirst({
      where: { id: sessionId, patentId, userId: user.id },
      include: {
        patent: { select: { projectId: true } },
        figurePlans: {
          orderBy: { figureNo: 'asc' }
        },
        diagramSources: {
          orderBy: { figureNo: 'asc' }
        },
        sketchRecords: {
          where: {
            isDeleted: false,
            status: 'SUCCESS' // Only include successfully generated sketches
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
    }

    // Debug: Log sketch records loaded via session relation
    let loadedSketches = session.sketchRecords || []
    console.log(`[GetCombinedFigures] Session ${sessionId} has ${loadedSketches.length} sketches via session relation`)
    
    // Fallback: If no sketches via session relation, load from patent directly
    if (loadedSketches.length === 0) {
      const patentSketches = await prisma.sketchRecord.findMany({
        where: { 
          patentId,
          isDeleted: false,
          status: 'SUCCESS'
        },
        orderBy: { createdAt: 'asc' }
      })
      if (patentSketches.length > 0) {
        console.log(`[GetCombinedFigures] Loaded ${patentSketches.length} sketches from patent directly (session relation was empty)`)
        loadedSketches = patentSketches
      }
    }

    const projectId = session.patent?.projectId

    // Build combined figures list
    const diagrams = (session!.figurePlans || []).map((fp: any) => {
      const source = (session!.diagramSources || []).find((ds: any) => ds.figureNo === fp.figureNo)
      const imageFilename = source?.imageFilename || (source?.imagePath ? path.basename(source.imagePath) : null)
      const publicImagePath = imageFilename && projectId
        ? `/api/projects/${projectId}/patents/${patentId}/upload?filename=${encodeURIComponent(imageFilename)}`
        : (source?.imagePath || null)

      return {
        id: `diagram-${fp.figureNo}`,
        type: 'diagram' as const,
        sourceId: fp.id,
        figureNo: fp.figureNo,
        title: fp.title || `Diagram ${fp.figureNo}`,
        description: fp.description || '',
        imageFilename: imageFilename || null,
        imagePath: publicImagePath,
        rawImagePath: source?.imagePath || null,
        createdAt: fp.createdAt
      }
    })

  const sketches = loadedSketches.map((sr: any, index: number) => ({
    id: `sketch-${sr.id}`,
    type: 'sketch' as const,
    sourceId: sr.id,
    figureNo: index + 1, // Will be reassigned
    title: sr.title || `Sketch ${index + 1}`,
    description: sr.description || '',
    imagePath: resolveSketchPublicImageUrl(sr, projectId, patentId),
    imageFilename: sr.imageFilename || extractFilenameFromPathLike(sr.imagePath) || null,
    createdAt: sr.createdAt
  }))

    // If sequence exists, use it; otherwise generate initial sequence
    let sequence: any[] = session.figureSequence as any[] || []
    let generatedInitialSequence = false
    const allFigures = [...diagrams, ...sketches]

    if (sequence.length === 0 && allFigures.length > 0) {
      // Generate initial sequence: diagrams first, then sketches
      sequence = allFigures.map((fig, index) => ({
        id: fig.id,
        type: fig.type,
        sourceId: fig.sourceId,
        finalFigNo: index + 1
      }))
      generatedInitialSequence = true
    }

    // Build ordered result - filter out deleted figures and track if sequence changed
    let sequenceNeedsUpdate = false
    const orderedFigures: any[] = []
    const existingIds = new Set(allFigures.map(f => f.id))
    
    for (const seqItem of sequence) {
      const figure = allFigures.find(f => f.id === seqItem.id)
      if (!figure) {
        // Figure was deleted - mark sequence as needing update
        sequenceNeedsUpdate = true
        continue
      }
      orderedFigures.push({
        ...figure,
        finalFigNo: orderedFigures.length + 1
      })
    }

    // Add any figures not in sequence (newly added)
    const sequenceIds = new Set(sequence.map(s => s.id))
    const unsequenced = allFigures.filter(f => !sequenceIds.has(f.id))
    if (unsequenced.length > 0) {
      sequenceNeedsUpdate = true
    }
    unsequenced.forEach((fig) => {
      orderedFigures.push({
        ...fig,
        finalFigNo: orderedFigures.length + 1
      })
    })

    // Persist the cleaned/updated sequence if it changed (deletions or additions)
    // Also persist the initial sequence we just generated (so finalize has data even before any drag)
    if ((sequenceNeedsUpdate || generatedInitialSequence) && !session.figureSequenceFinalized) {
      const normalizedSequence = orderedFigures.map((f, idx) => ({
        id: f.id,
        type: f.type,
        sourceId: f.sourceId,
        finalFigNo: idx + 1
      }))
      
      await prisma.draftingSession.update({
        where: { id: sessionId },
        data: { figureSequence: normalizedSequence }
      })
    }

    return NextResponse.json({
      figures: orderedFigures,
      isFinalized: session.figureSequenceFinalized || false,
      totalDiagrams: diagrams.length,
      totalSketches: sketches.length
    })
  } catch (error) {
    console.error('[FigureSequence] Get combined figures error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to get figures'
    }, { status: 500 })
  }
}

/**
 * Save the user's figure sequence arrangement.
 */
async function handleSaveFigureSequence(user: any, patentId: string, data: any) {
  const { sessionId, sequence } = data

  if (!sessionId || !Array.isArray(sequence)) {
    return NextResponse.json({ error: 'Session ID and sequence array are required' }, { status: 400 })
  }

  try {
    const session = await prisma.draftingSession.findFirst({
      where: { id: sessionId, patentId, userId: user.id },
      include: {
        figurePlans: { select: { id: true, figureNo: true } },
        sketchRecords: {
          where: { isDeleted: false, status: 'SUCCESS' },
          select: { id: true }
        }
      } as any
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
    }
    await reactivateFiguresForSession(sessionId)

    if (session.figureSequenceFinalized) {
      return NextResponse.json({ error: 'Sequence is finalized. Unlock to make changes.' }, { status: 400 })
    }

    // Fallback: If session relation does not include sketches (legacy), allow patent-level sketches
    let allowedSketchIds = new Set<string>(((session as any).sketchRecords || []).map((s: any) => s.id))
    if (allowedSketchIds.size === 0) {
      const patentSketches = await prisma.sketchRecord.findMany({
        where: {
          patentId,
          isDeleted: false,
          status: 'SUCCESS'
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' }
      })
      allowedSketchIds = new Set<string>(patentSketches.map(s => s.id))
    }

    const availableFigures = [
      ...(((session as any).figurePlans || []) as any[]).map((fp: any) => ({
        id: `diagram-${fp.figureNo}`,
        type: 'diagram' as const,
        sourceId: fp.id
      })),
      ...Array.from(allowedSketchIds).map((sketchId) => ({
        id: `sketch-${sketchId}`,
        type: 'sketch' as const,
        sourceId: sketchId
      }))
    ]

    const { normalized: validatedSequence, meta } = normalizeFigureSequence(sequence, availableFigures)

    await prisma.draftingSession.update({
      where: { id: sessionId },
      data: { figureSequence: validatedSequence }
    })

    if (
      meta.droppedUnknownCount ||
      meta.droppedTypeMismatchCount ||
      meta.droppedSourceMismatchCount ||
      meta.dedupedCount ||
      meta.appendedMissingCount
    ) {
      console.log('[FigureSequence] Normalized input sequence', { sessionId, ...meta })
    }

    return NextResponse.json({ success: true, sequence: validatedSequence, normalized: meta })
  } catch (error) {
    console.error('[FigureSequence] Save sequence error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to save sequence'
    }, { status: 500 })
  }
}

/**
 * AI-powered suggestion for optimal figure ordering.
 * Analyzes content and suggests best narrative flow.
 */
async function handleAIArrangeFigures(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  try {
    const session = await prisma.draftingSession.findFirst({
      where: { id: sessionId, patentId, userId: user.id },
      include: {
        ideaRecord: true,
        referenceMap: true,
        patent: { select: { projectId: true } },
        figurePlans: { orderBy: { figureNo: 'asc' } },
        diagramSources: { orderBy: { figureNo: 'asc' } },
        sketchRecords: {
          where: { isDeleted: false, status: 'SUCCESS' },
          orderBy: { createdAt: 'asc' }
        }
      }
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
    }
    await reactivateFiguresForSession(sessionId)

    // Fallback: If no sketches via session relation, load from patent directly
    let loadedSketches = session.sketchRecords || []
    if (loadedSketches.length === 0) {
      const patentSketches = await prisma.sketchRecord.findMany({
        where: { 
          patentId,
          isDeleted: false,
          status: 'SUCCESS'
        },
        orderBy: { createdAt: 'asc' }
      })
      if (patentSketches.length > 0) {
        console.log(`[AIArrangeFigures] Loaded ${patentSketches.length} sketches from patent directly`)
        loadedSketches = patentSketches
      }
    }

    // Build figure descriptions for AI analysis
    const projectId = session.patent?.projectId

    const diagrams = (session!.figurePlans || []).map((fp: any) => {
      const source = (session!.diagramSources || []).find((ds: any) => ds.figureNo === fp.figureNo)
      const imageFilename = source?.imageFilename || (source?.imagePath ? path.basename(source.imagePath) : null)
      const publicImagePath = imageFilename && projectId
        ? `/api/projects/${projectId}/patents/${patentId}/upload?filename=${encodeURIComponent(imageFilename)}`
        : (source?.imagePath || null)
      return {
        id: `diagram-${fp.figureNo}`,
        type: 'diagram',
        sourceId: fp.id,
        figureNo: fp.figureNo,
        title: fp.title || `Diagram ${fp.figureNo}`,
        description: fp.description || '',
        imagePath: publicImagePath,
        imageFilename: imageFilename || null,
        rawImagePath: source?.imagePath || null
      }
    })

    const sketches = loadedSketches.map((sr: any, idx: number) => ({
      id: `sketch-${sr.id}`,
      type: 'sketch',
      sourceId: sr.id,
      figureNo: idx + 1,
      title: sr.title || `Sketch ${idx + 1}`,
      description: sr.description || '',
      imagePath: resolveSketchPublicImageUrl(sr, projectId, patentId)
    }))

    const allFigures = [...diagrams, ...sketches]

    if (allFigures.length <= 1) {
      // Nothing to arrange
      return NextResponse.json({
        sequence: allFigures.map((f, i) => ({ ...f, finalFigNo: i + 1 })),
        insight: 'Only one figure - no arrangement needed.'
      })
    }

    // Build context for AI
    const ideaData = session.ideaRecord?.normalizedData as any
    const components = extractComponentsArray(session.referenceMap)

    const figuresList = allFigures.map((f, i) => 
      `${i + 1}. [${f.type.toUpperCase()}] "${f.title}"${f.description ? ` - ${f.description.substring(0, 100)}` : ''}`
    ).join('\n')

const prompt = `You are a patent documentation expert. Arrange these figures in the optimal order for a patent specification.

INVENTION CONTEXT:
${ideaData?.title ? `Title: ${ideaData.title}` : ''}
${ideaData?.problem ? `Problem: ${ideaData.problem}` : ''}
${components.length > 0 ? `Key Components: ${components.slice(0, 5).map((c: any) => `${c.referenceLabel || c.numeral || '?'}: ${c.name}`).join(', ')}` : ''}

FIGURES TO ARRANGE:
${figuresList}

ORDERING PRINCIPLES:
1. System overview/architecture diagrams should come first
2. Introduce components before showing their details
3. Process flows should follow component introductions
4. Sketches showing physical layout can complement block diagrams
5. Detailed views should follow general views

Return a JSON object with:
{
  "order": [1, 3, 2, 4, ...],  // Array of original indices (1-based) in suggested order
  "insight": "Brief explanation of why this order works well (1-2 sentences)",
  "reasons": [
    { "figureIndex": 1, "reason": "Why figure 1 should appear at this position" },
    { "figureIndex": 2, "reason": "Why figure 2 should appear at this position" }
  ] // Reasons should align to the same order you return; keep them concise (one sentence each).
}

Return ONLY the JSON object.`

    // Use LLM to get suggestion - use headers format for auth bridge to resolve context
    const { llmGateway } = await import('@/lib/metering/gateway')
    const result = await llmGateway.executeLLMOperation(
      { headers: requestHeaders || {} },
      {
        taskCode: 'LLM3_DIAGRAM',
        stageCode: 'DRAFT_FIGURE_PLANNER', // Use admin-configured model/limits
        prompt,
        idempotencyKey: crypto.randomUUID(),
        parameters: { tenantId: session.tenantId || undefined },
        metadata: { patentId, sessionId, purpose: 'ai_arrange_figures' }
      }
    )

    if (!result.success || !result.response?.output) {
      // Fallback: return current order with generic insight
      return NextResponse.json({
        sequence: allFigures.map((f, i) => ({ ...f, finalFigNo: i + 1 })),
        insight: 'Could not analyze figures. Showing default order.'
      })
    }

    // Parse AI response
    let aiResponse: { order: number[], insight: string, reasons?: Array<{ figureIndex: number, reason: string }> | Record<string, string> }
    try {
      const output = result.response.output.trim()
      const jsonStart = output.indexOf('{')
      const jsonEnd = output.lastIndexOf('}')
      if (jsonStart !== -1 && jsonEnd !== -1) {
        aiResponse = JSON.parse(output.substring(jsonStart, jsonEnd + 1))
      } else {
        throw new Error('No JSON found')
      }
    } catch {
      return NextResponse.json({
        sequence: allFigures.map((f, i) => ({ ...f, finalFigNo: i + 1 })),
        insight: 'Could not parse AI suggestion. Showing default order.'
      })
    }

    // Reorder figures based on AI suggestion
    const reorderedSequence: any[] = []
    const usedIndices = new Set<number>()

    for (const idx of aiResponse.order) {
      const figureIndex = idx - 1 // Convert to 0-based
      if (figureIndex >= 0 && figureIndex < allFigures.length && !usedIndices.has(figureIndex)) {
        reorderedSequence.push({
          ...allFigures[figureIndex],
          finalFigNo: reorderedSequence.length + 1
        })
        usedIndices.add(figureIndex)
      }
    }

    // Add any missing figures at the end
    allFigures.forEach((fig, idx) => {
      if (!usedIndices.has(idx)) {
        reorderedSequence.push({
          ...fig,
          finalFigNo: reorderedSequence.length + 1
        })
      }
    })

    // Build per-figure reasons if provided (aligned to final order)
    const normalizedReasons: Array<{ id: string, title: string, reason: string, finalFigNo: number }> = []
    const reasonsInput = aiResponse.reasons
    const reasonEntries: Array<{ figureIndex: number, reason: string }> = Array.isArray(reasonsInput)
      ? reasonsInput
      : typeof reasonsInput === 'object' && reasonsInput !== null
        ? Object.entries(reasonsInput).map(([k, v]) => ({
            figureIndex: Number(k),
            reason: typeof v === 'string' ? v : ''
          }))
        : []

    const reasonMap = new Map<number, string>()
    reasonEntries.forEach((r) => {
      const idx = r.figureIndex - 1
      if (Number.isFinite(idx) && idx >= 0 && idx < allFigures.length && r.reason) {
        reasonMap.set(idx, r.reason)
      }
    })

    reorderedSequence.forEach((fig) => {
      const originalIdx = allFigures.findIndex((f) => f.id === fig.id)
      const reason = reasonMap.get(originalIdx)
      if (reason) {
        normalizedReasons.push({
          id: fig.id,
          title: fig.title || `Figure ${fig.figureNo || fig.finalFigNo || ''}`.trim(),
          reason,
          finalFigNo: fig.finalFigNo
        })
      }
    })

    return NextResponse.json({
      sequence: reorderedSequence,
      insight: aiResponse.insight || 'Figures arranged for optimal narrative flow.',
      reasons: normalizedReasons
    })
  } catch (error) {
    console.error('[FigureSequence] AI arrange error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to arrange figures'
    }, { status: 500 })
  }
}

/**
 * Finalize the figure sequence - locks it for drafting and updates source record figureNo values.
 * 
 * This function pushes the arranged sequence back to the source records:
 * - Updates FigurePlan.figureNo to match the finalFigNo in the sequence
 * - Updates DiagramSource.figureNo to match the finalFigNo in the sequence
 * - Updates SketchRecord.figureNo for sketches in the sequence
 * - Updates FigurePlan.title to reflect the new figure number
 * 
 * This ensures that when the patent draft is generated, the figure numbers in the
 * PlantUML code and image references match the arranged sequence.
 */
async function handleFinalizeFigureSequence(user: any, patentId: string, data: any) {
  const { sessionId } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  try {
    const session = await prisma.draftingSession.findFirst({
      where: { id: sessionId, patentId, userId: user.id },
      include: {
        figurePlans: true,
        diagramSources: true,
        sketchRecords: {
          where: { isDeleted: false, status: 'SUCCESS' }
        }
      }
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
    }
    await reactivateFiguresForSession(sessionId)

    const sequence = session.figureSequence as Array<{ id: string; type: string; sourceId: string; finalFigNo: number }>
    if (!sequence || sequence.length === 0) {
      return NextResponse.json({ error: 'No figure sequence to finalize' }, { status: 400 })
    }

    // Guard: Check if already finalized
    if (session.figureSequenceFinalized) {
      console.log(`[FigureSequence] Sequence already finalized for session ${sessionId}, skipping re-finalization`)
      return NextResponse.json({ 
        success: true, 
        message: 'Figure sequence is already finalized',
        alreadyFinalized: true
      })
    }

    // Validate that all figures in the sequence exist in the session
    const sequenceDiagramSourceIds = new Set(
      sequence.filter(s => s.type === 'diagram').map(s => s.sourceId)
    )
    const sequenceSketchSourceIds = new Set(
      sequence.filter(s => s.type === 'sketch').map(s => s.sourceId)
    )
    const existingPlanIds = new Set(session.figurePlans.map(p => p.id))
    // Validate sketches against the exact IDs referenced in the sequence.
    // This covers legacy sessions where sketchRecords relation may be empty even though sketches exist on the patent.
    const sketchIdsInSequence = Array.from(sequenceSketchSourceIds)
    const sketchesBySequence = sketchIdsInSequence.length > 0
      ? await prisma.sketchRecord.findMany({
          where: {
            id: { in: sketchIdsInSequence },
            patentId,
            isDeleted: false,
            status: 'SUCCESS'
          }
        })
      : []
    const existingSketchIds = new Set(sketchesBySequence.map(s => s.id))

    // Warn about orphaned sequence entries (entries that reference non-existent figures)
    const orphanedDiagrams = Array.from(sequenceDiagramSourceIds).filter(id => !existingPlanIds.has(id))
    const orphanedSketches = Array.from(sequenceSketchSourceIds).filter(id => !existingSketchIds.has(id))
    if (orphanedDiagrams.length > 0 || orphanedSketches.length > 0) {
      console.warn(`[FigureSequence] Orphaned entries in sequence: diagrams=${orphanedDiagrams.length}, sketches=${orphanedSketches.length}`)
    }

    // Check for potential figureNo conflicts from figures NOT in the sequence
    // These figures will keep their original figureNo values
    const figuresInSequence = new Set(sequence.map(s => s.sourceId))
    const excludedPlans = session.figurePlans.filter(p => !figuresInSequence.has(p.id))
    const excludedFigureNos = new Set(excludedPlans.map(p => p.figureNo))
    const finalFigNos = new Set(sequence.map(s => s.finalFigNo))
    const conflictingNos = Array.from(finalFigNos).filter(no => excludedFigureNos.has(no))
    
    if (conflictingNos.length > 0) {
      console.warn(`[FigureSequence] Potential figureNo conflicts with excluded figures: ${conflictingNos.join(', ')}. Excluded figures will be renumbered to avoid conflicts.`)
      
      // Reassign excluded figures to numbers beyond the sequence range
      let nextAvailableNo = sequence.length + 1
      for (const plan of excludedPlans) {
        if (conflictingNos.includes(plan.figureNo)) {
          // We'll handle this in the transaction
        }
      }
    }

    // Build mapping: sourceId -> finalFigNo for quick lookup
    const sourceIdToFinalFigNo = new Map<string, number>()
    for (const item of sequence) {
      sourceIdToFinalFigNo.set(item.sourceId, item.finalFigNo)
    }

    // Build mapping: original figureNo -> plan.id (for linking DiagramSources to FigurePlans)
    // This uses snapshot values which remain constant throughout the transaction
    const originalFigNoToPlanId = new Map<number, string>()
    for (const plan of session.figurePlans) {
      originalFigNoToPlanId.set(plan.figureNo, plan.id)
    }

    // Handle excluded figures that would conflict with the new numbering
    // These will be assigned numbers beyond the sequence range
    const excludedPlanReassignments = new Map<string, number>()
    if (excludedPlans.length > 0 && conflictingNos.length > 0) {
      let nextAvailableNo = sequence.length + 1
      for (const plan of excludedPlans) {
        if (finalFigNos.has(plan.figureNo)) {
          excludedPlanReassignments.set(plan.id, nextAvailableNo)
          nextAvailableNo++
        }
      }
    }

    // Use a transaction to update all records atomically
    // We use a two-phase approach to avoid unique constraint violations:
    // Phase 1: Set all figureNo to negative (temporary) values
    // Phase 2: Set all figureNo to their final values
    await prisma.$transaction(async (tx) => {
      // ============================================
      // PHASE 1: Set figureNo to negative temporary values
      // This clears the way for reassigning final numbers without constraint violations
      // ============================================
      
      // Update ALL FigurePlans to temporary negative numbers (including excluded ones with conflicts)
      for (const plan of session.figurePlans) {
        const inSequence = sourceIdToFinalFigNo.has(plan.id)
        const needsReassignment = excludedPlanReassignments.has(plan.id)
        
        if (inSequence || needsReassignment) {
          await tx.figurePlan.update({
            where: { id: plan.id },
            data: { figureNo: -plan.figureNo - 1000 } // Use offset to ensure unique negative values
          })
        }
      }

      // Update DiagramSources to temporary negative numbers
      // DiagramSources are linked to FigurePlans by matching figureNo
      for (const source of session.diagramSources) {
        const planId = originalFigNoToPlanId.get(source.figureNo)
        if (planId) {
          const inSequence = sourceIdToFinalFigNo.has(planId)
          const needsReassignment = excludedPlanReassignments.has(planId)
          
          if (inSequence || needsReassignment) {
            await tx.diagramSource.update({
              where: { id: source.id },
              data: { figureNo: -source.figureNo - 1000 }
            })
          }
        }
      }

      // ============================================
      // PHASE 2: Set figureNo to final values and update titles
      // ============================================
      
      // Update FigurePlans with final figure numbers and updated titles
      for (const plan of session.figurePlans) {
        // Check if in sequence (priority) or needs reassignment due to conflict
        const finalNo = sourceIdToFinalFigNo.get(plan.id) ?? excludedPlanReassignments.get(plan.id)
        
        if (finalNo !== undefined) {
          // Update title to reflect new figure number
          const updatedTitle = updateFigureTitleNumber(plan.title, finalNo)
          
          await tx.figurePlan.update({
            where: { id: plan.id },
            data: { 
              figureNo: finalNo,
              title: updatedTitle
            }
          })
        }
      }

      // Update DiagramSources with final figure numbers
      // Use the pre-built mapping to find the corresponding plan
      for (const source of session.diagramSources) {
        const planId = originalFigNoToPlanId.get(source.figureNo)
        if (planId) {
          const finalNo = sourceIdToFinalFigNo.get(planId) ?? excludedPlanReassignments.get(planId)
          if (finalNo !== undefined) {
            await tx.diagramSource.update({
              where: { id: source.id },
              data: { figureNo: finalNo }
            })
          }
        }
      }

      // Update SketchRecords with final figure numbers
      // For sketches, the sourceId in the sequence IS the sketch.id
      for (const sketchId of sketchIdsInSequence) {
        const finalNo = sourceIdToFinalFigNo.get(sketchId)
        if (finalNo === undefined) continue
        const sketch = sketchesBySequence.find(s => s.id === sketchId)
        const updatedTitle = updateFigureTitleNumber(sketch?.title || '', finalNo)
        await tx.sketchRecord.update({
          where: { id: sketchId },
          data: {
            figureNo: finalNo,
            ...(sketch?.title ? { title: updatedTitle } : {})
          }
        })
      }

      // Mark sequence as finalized
      await tx.draftingSession.update({
        where: { id: sessionId },
        data: { figureSequenceFinalized: true }
      })
    })

    const reassignedCount = excludedPlanReassignments.size
    console.log(`[FigureSequence] Finalized sequence for session ${sessionId} with ${sequence.length} figures. Figure numbers updated in source records.${reassignedCount > 0 ? ` ${reassignedCount} excluded figures reassigned to avoid conflicts.` : ''}`)

    return NextResponse.json({ 
      success: true, 
      message: 'Figure sequence finalized and source records updated',
      updatedCount: sequence.length,
      ...(reassignedCount > 0 && { 
        reassignedExcludedCount: reassignedCount,
        note: `${reassignedCount} figure(s) not in sequence were reassigned to avoid number conflicts`
      })
    })
  } catch (error) {
    console.error('[FigureSequence] Finalize error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to finalize sequence'
    }, { status: 500 })
  }
}

/**
 * Unlock a finalized sequence to allow re-editing.
 */
async function handleUnlockFigureSequence(user: any, patentId: string, data: any) {
  const { sessionId } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  try {
    const session = await prisma.draftingSession.findFirst({
      where: { id: sessionId, patentId, userId: user.id }
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
    }

    await prisma.draftingSession.update({
      where: { id: sessionId },
      data: { figureSequenceFinalized: false }
    })

    return NextResponse.json({ success: true, message: 'Figure sequence unlocked for editing' })
  } catch (error) {
    console.error('[FigureSequence] Unlock error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to unlock sequence'
    }, { status: 500 })
  }
}

// ============================================================================
// Image Editor Handlers
// ============================================================================

async function handleUpdateImage(user: any, patentId: string, data: any) {
  const { sessionId, type, id, imageBase64, filename, preserveOriginal } = data

  if (!sessionId || !type || !id || !imageBase64) {
    return NextResponse.json({ 
      error: 'sessionId, type, id, and imageBase64 are required' 
    }, { status: 400 })
  }

  if (!['diagram', 'sketch'].includes(type)) {
    return NextResponse.json({ error: 'Invalid type. Must be "diagram" or "sketch"' }, { status: 400 })
  }

  // Validate base64 format and size
  const MAX_IMAGE_SIZE_MB = 10
  const MAX_BASE64_LENGTH = MAX_IMAGE_SIZE_MB * 1024 * 1024 * 1.37 // base64 is ~37% larger than binary
  
  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
    return NextResponse.json({ error: 'Invalid image data' }, { status: 400 })
  }
  
  if (imageBase64.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ 
      error: `Image too large. Maximum size is ${MAX_IMAGE_SIZE_MB}MB` 
    }, { status: 400 })
  }

  // Basic base64 format validation (should only contain valid base64 chars)
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/
  if (!base64Regex.test(imageBase64)) {
    return NextResponse.json({ error: 'Invalid base64 image data' }, { status: 400 })
  }

  try {
    // Verify session access
    const session = await prisma.draftingSession.findFirst({
      where: { id: sessionId, patentId, userId: user.id }
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
    }

    // Get project for consistent storage path under /uploads/projects/{projectId}/patents/{patentId}/figures
    const patent = await prisma.patent.findUnique({
      where: { id: patentId },
      select: { projectId: true }
    })
    if (!patent?.projectId) {
      return NextResponse.json({ error: 'Patent not found or missing project reference' }, { status: 404 })
    }

    // Decode base64 image
    let imageBuffer: Buffer
    try {
      imageBuffer = Buffer.from(imageBase64, 'base64')
      if (imageBuffer.length === 0) {
        throw new Error('Empty image buffer')
      }
    } catch (decodeErr) {
      return NextResponse.json({ error: 'Failed to decode image data' }, { status: 400 })
    }
    const ext = filename?.split('.').pop()?.toLowerCase() || 'png'
    const sanitizedFilename = `edited_${Date.now()}.${ext}`
    
    // Determine save path (same folder the image-serving route reads from)
    const uploadDir = path.join(process.cwd(), 'uploads', 'projects', patent.projectId, 'patents', patentId, 'figures')
    await fs.mkdir(uploadDir, { recursive: true })
    
    const filePath = path.join(uploadDir, sanitizedFilename)
    const publicServeUrl = `/api/projects/${patent.projectId}/patents/${patentId}/upload?filename=${encodeURIComponent(sanitizedFilename)}`

    if (type === 'diagram') {
      // Get current diagram
      const diagram = await prisma.diagramSource.findFirst({
        where: { sessionId, figureNo: Number(id) }
      })

      if (!diagram) {
        return NextResponse.json({ error: 'Diagram not found' }, { status: 404 })
      }

      // Backup original if requested and not already backed up
      let originalPath = diagram.originalImagePath
      let originalFilename = diagram.originalImageFilename
      
      if (preserveOriginal && diagram.imagePath && !diagram.originalImagePath) {
        originalPath = diagram.imagePath
        originalFilename = diagram.imageFilename
      }

      // Save new image
      await fs.writeFile(filePath, imageBuffer)

      // Update database
      await prisma.diagramSource.update({
        where: { id: diagram.id },
        data: {
          // Keep filename for API-based serving; imagePath remains a filesystem reference for exports
          imagePath: filePath,
          imageFilename: sanitizedFilename,
          imageUploadedAt: new Date(),
          originalImagePath: originalPath,
          originalImageFilename: originalFilename
        }
      })

      return NextResponse.json({ 
        success: true, 
        message: 'Diagram image updated',
        imagePath: publicServeUrl,
        hasOriginal: !!originalPath
      })

    } else {
      // type === 'sketch'
      const sketch = await prisma.sketchRecord.findFirst({
        where: { id: String(id), sessionId, patentId }
      })

      if (!sketch) {
        return NextResponse.json({ error: 'Sketch not found' }, { status: 404 })
      }

      // Backup original if requested and not already backed up
      let originalPath = sketch.originalImagePath
      let originalFilename = sketch.originalImageFilename
      
      if (preserveOriginal && sketch.imagePath && !sketch.originalImagePath) {
        originalPath = sketch.imagePath
        originalFilename = sketch.imageFilename
      }

      // Save new image
      await fs.writeFile(filePath, imageBuffer)

      // Update database
      await prisma.sketchRecord.update({
        where: { id: sketch.id },
        data: {
          // For sketches we store the API-served URL so UI thumbnails keep working
          imagePath: publicServeUrl,
          imageFilename: sanitizedFilename,
          originalImagePath: originalPath,
          originalImageFilename: originalFilename
        }
      })

      return NextResponse.json({ 
        success: true, 
        message: 'Sketch image updated',
        imagePath: publicServeUrl,
        hasOriginal: !!originalPath
      })
    }
  } catch (error) {
    console.error('[ImageEditor] Update error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to update image'
    }, { status: 500 })
  }
}

async function handleRestoreOriginalImage(user: any, patentId: string, data: any) {
  const { sessionId, type, id } = data

  if (!sessionId || !type || !id) {
    return NextResponse.json({ 
      error: 'sessionId, type, and id are required' 
    }, { status: 400 })
  }

  if (!['diagram', 'sketch'].includes(type)) {
    return NextResponse.json({ error: 'Invalid type. Must be "diagram" or "sketch"' }, { status: 400 })
  }

  try {
    // Verify session access
    const session = await prisma.draftingSession.findFirst({
      where: { id: sessionId, patentId, userId: user.id }
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
    }

    if (type === 'diagram') {
      const diagram = await prisma.diagramSource.findFirst({
        where: { sessionId, figureNo: Number(id) }
      })

      if (!diagram) {
        return NextResponse.json({ error: 'Diagram not found' }, { status: 404 })
      }

      if (!diagram.originalImagePath) {
        return NextResponse.json({ error: 'No original image to restore' }, { status: 400 })
      }

      // Restore original
      await prisma.diagramSource.update({
        where: { id: diagram.id },
        data: {
          imagePath: diagram.originalImagePath,
          imageFilename: diagram.originalImageFilename,
          originalImagePath: null,
          originalImageFilename: null
        }
      })

      return NextResponse.json({ 
        success: true, 
        message: 'Original diagram restored',
        imagePath: diagram.originalImagePath
      })

    } else {
      // type === 'sketch'
      const sketch = await prisma.sketchRecord.findFirst({
        where: { id: String(id), sessionId, patentId }
      })

      if (!sketch) {
        return NextResponse.json({ error: 'Sketch not found' }, { status: 404 })
      }

      if (!sketch.originalImagePath) {
        return NextResponse.json({ error: 'No original image to restore' }, { status: 400 })
      }

      // Restore original
      await prisma.sketchRecord.update({
        where: { id: sketch.id },
        data: {
          imagePath: sketch.originalImagePath,
          imageFilename: sketch.originalImageFilename,
          originalImagePath: null,
          originalImageFilename: null
        }
      })

      return NextResponse.json({ 
        success: true, 
        message: 'Original sketch restored',
        imagePath: sketch.originalImagePath
      })
    }
  } catch (error) {
    console.error('[ImageEditor] Restore error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to restore original image'
    }, { status: 500 })
  }
}

async function handleUploadDiagram(user: any, patentId: string, data: any) {
  const { sessionId, figureNo, filename, checksum, imagePath, language = 'en' } = data;
  const normalizedLanguage = typeof language === 'string' && language.trim() ? language.trim().toLowerCase() : 'en';

  if (!sessionId || !figureNo || !filename || !checksum) {
    return NextResponse.json(
      { error: 'Session ID, figure number, filename, and checksum are required' },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    },
    select: {
      id: true,
      figureSequence: true,
      figureSequenceFinalized: true
    }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }
  await reactivateFiguresForSession(sessionId)

  // Ensure a figurePlan exists for this figure number (some uploads may come first)
  let figurePlanId: string | null = null
  const existingPlan = await prisma.figurePlan.findUnique({ where: { sessionId_figureNo: { sessionId, figureNo } } })
  if (!existingPlan) {
    const newPlan = await prisma.figurePlan.create({ data: { sessionId, figureNo, title: `Figure ${figureNo}`, nodes: [], edges: [] } })
    figurePlanId = newPlan.id
    
    // Add new figure to figureSequence if not finalized
    if (!session.figureSequenceFinalized) {
      const existingDiagramFigures = (await prisma.figurePlan.findMany({
        where: { sessionId, NOT: { figureNo } },
        select: { id: true, figureNo: true },
        orderBy: { figureNo: 'asc' }
      })).map(plan => ({
        id: `diagram-${plan.figureNo}`,
        type: 'diagram' as const,
        sourceId: plan.id
      }))
      let loadedSketches = await prisma.sketchRecord.findMany({
        where: { sessionId, isDeleted: false, status: 'SUCCESS' },
        select: { id: true },
        orderBy: { createdAt: 'asc' }
      })
      if (loadedSketches.length === 0) {
        loadedSketches = await prisma.sketchRecord.findMany({
          where: { patentId, isDeleted: false, status: 'SUCCESS' },
          select: { id: true },
          orderBy: { createdAt: 'asc' }
        })
      }
      const existingSketchFigures = loadedSketches.map(sketch => ({
        id: `sketch-${sketch.id}`,
        type: 'sketch' as const,
        sourceId: sketch.id
      }))
      const currentSequence = (session.figureSequence as Array<{ id: string; type: string; sourceId: string; finalFigNo: number }>) || []
      const newId = `diagram-${figureNo}`
      const newFigure = {
        id: newId,
        type: 'diagram' as const,
        sourceId: newPlan.id
      }
      const { normalized: updatedSequence } = appendFigureToSequence(
        currentSequence,
        [...existingDiagramFigures, ...existingSketchFigures],
        newFigure
      )

      await prisma.draftingSession.update({
        where: { id: sessionId },
        data: { figureSequence: updatedSequence }
      })
    }
  } else {
    figurePlanId = existingPlan.id
  }

  // Upsert diagram source and set upload metadata
  await prisma.diagramSource.upsert({
    where: { sessionId_figureNo_language: { sessionId, figureNo, language: normalizedLanguage } },
    update: {
      imageFilename: filename,
      imageChecksum: checksum,
      imagePath: imagePath,
      imageUploadedAt: new Date()
    },
    create: {
      sessionId,
      figureNo,
      language: normalizedLanguage,
      plantumlCode: '',
      checksum: '',
      imageFilename: filename,
      imageChecksum: checksum,
      imagePath: imagePath,
      imageUploadedAt: new Date()
    }
  })

  // Return success with counts; do not auto-advance stage
  const totalFigures = await prisma.figurePlan.count({ where: { sessionId } });
  const uploadedFigures = await prisma.diagramSource.findMany({
    where: { sessionId, imageUploadedAt: { not: null } },
    select: { figureNo: true },
    distinct: ['figureNo']
  }).then(results => results.length);

  return NextResponse.json({
    message: 'Diagram uploaded successfully',
    uploadedFigures,
    totalFigures,
    allUploaded: uploadedFigures === totalFigures
  });
}

async function handleGenerateDraft(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, jurisdiction = 'US', filingType = 'utility' } = data;

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Session ID is required' },
      { status: 400 }
    );
  }

  // Verify session ownership and get all required data
  const baseSession = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true,
      diagramSources: true,
      annexureDrafts: {
        orderBy: { version: 'desc' },
        take: 1
      },
      // Include sketches for unified figure sequence (diagrams + sketches)
      sketchRecords: {
        where: { isDeleted: false, status: 'SUCCESS' }
      },
      // Include related art selections for prior art in drafting
      relatedArtSelections: true
    }
  });

  // Fetch frozen figure sequence metadata explicitly to ensure finalized order is available
  const sequenceMeta = await prisma.draftingSession.findUnique({
    where: { id: sessionId },
    select: { figureSequence: true, figureSequenceFinalized: true }
  })

  if (!baseSession) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  // Fallback: If no sketches via session relation, load from patent directly
  let sessionWithSketches = baseSession
  if (!baseSession.sketchRecords || baseSession.sketchRecords.length === 0) {
    const patentSketches = await prisma.sketchRecord.findMany({
      where: { 
        patentId,
        isDeleted: false,
        status: 'SUCCESS'
      }
    })
    if (patentSketches.length > 0) {
      console.log(`[GenerateDraft] Loaded ${patentSketches.length} sketches from patent directly`)
      sessionWithSketches = { ...baseSession, sketchRecords: patentSketches }
    }
  }

  const session = {
    ...sessionWithSketches,
    figureSequence: sequenceMeta?.figureSequence ?? (sessionWithSketches as any).figureSequence,
    figureSequenceFinalized: sequenceMeta?.figureSequenceFinalized ?? (sessionWithSketches as any).figureSequenceFinalized
  }
  const figuresSkipped = areFiguresSkipped(session)
  // Determine effective jurisdiction (Stage 3.7b)
  const effectiveJurisdiction = (jurisdiction || session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()
  const preferredLanguage = getPreferredLanguageForJurisdiction(session, effectiveJurisdiction)
  const sourceJurisdiction = resolveSourceOfTruth(session, effectiveJurisdiction)

  // Load reference draft for source-of-truth jurisdiction (first selection or user override) when generating other jurisdictions
  let referenceDraft = effectiveJurisdiction === sourceJurisdiction
    ? null
    : await prisma.annexureDraft.findFirst({
        where: { sessionId, jurisdiction: sourceJurisdiction },
        orderBy: { version: 'desc' }
      })
  if (!referenceDraft && effectiveJurisdiction !== sourceJurisdiction) {
    // Fallback to any other available draft (excluding the active one) so users can add jurisdictions later
    referenceDraft = await prisma.annexureDraft.findFirst({
      where: { sessionId, NOT: { jurisdiction: effectiveJurisdiction } },
      orderBy: { version: 'desc' }
    }) || null
  }

  // Generate draft
  const result = await DraftingService.generateAnnexureDraft(
    session,
    effectiveJurisdiction,
    filingType,
    user.tenantId,
    requestHeaders,
    referenceDraft || undefined,
    preferredLanguage,
    sourceJurisdiction
  );

  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: 400 }
    );
  }

  if (session.tenantId) {
    const generatedSectionKeys = [
      result.draft?.detailedDescription?.trim() ? 'detailedDescription' : null,
      result.draft?.claims?.trim() ? 'claims' : null
    ].filter(Boolean) as string[]
    const quotaCheck = await canTrackSectionDrafts(session.tenantId, sessionId, patentId, generatedSectionKeys)
    if (!quotaCheck.allowed) {
      return NextResponse.json(
        {
          error: quotaCheck.reason || 'Patent drafting quota exceeded. Please upgrade your plan to continue.',
          code: 'QUOTA_EXCEEDED',
          quotaExceeded: true,
          quota: {
            daily: quotaCheck.quota.dailyUsed + '/' + (quotaCheck.quota.dailyLimit ?? '∞'),
            monthly: quotaCheck.quota.monthlyUsed + '/' + (quotaCheck.quota.monthlyLimit ?? '∞')
          }
        },
        { status: 403 }
      )
    }
  }

  // Create new draft version
  const extraSections = { ...(result.validationReport?.extraSections || {}) }
  if (result.draft?.crossReference) {
    extraSections.crossReference = result.draft.crossReference
  }
  const lastForJurisdiction = await prisma.annexureDraft.findFirst({
    where: { sessionId, jurisdiction: effectiveJurisdiction },
    orderBy: { version: 'desc' }
  })
  const version = ((lastForJurisdiction?.version) || 0) + 1;
  const draft = await prisma.annexureDraft.create({
    data: {
      sessionId,
      version,
      jurisdiction: effectiveJurisdiction,
      title: result.draft?.title || session.ideaRecord?.title || 'Untitled',
      fieldOfInvention: result.draft?.fieldOfInvention || '',
      background: result.draft?.background || '',
      summary: result.draft?.summary || '',
      briefDescriptionOfDrawings: figuresSkipped ? '' : (result.draft?.briefDescriptionOfDrawings || ''),
      detailedDescription: result.draft?.detailedDescription || '',
      bestMethod: result.draft?.bestMethod || '',
      claims: result.draft?.claims || '',
      abstract: result.draft?.abstract || '',
      listOfNumerals: result.draft?.listOfNumerals || '',
      fullDraftText: result.draft?.fullText || '',
      isValid: !!result.isValid,
      validationReport: {
        ...(result.validationReport || {}),
        ...(Object.keys(extraSections).length ? { extraSections } : {})
      },
      llmPromptUsed: result.llmPrompt || '',
      llmResponse: result.llmResponse || {},
      tokensUsed: result.tokensUsed || 0
    }
  });

  // Update session status
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      status: 'ANNEXURE_DRAFT',
      jurisdictionDraftStatus: {
        ...(session!.jurisdictionDraftStatus as any || {}),
        [effectiveJurisdiction]: {
          status: 'done',
          latestVersion: version,
          updatedAt: new Date().toISOString()
        }
      }
    }
  });

  // QUOTA TRACKING: Track essential sections for patent-based quota counting
  // A patent counts toward quota when both detailedDescription AND claims are drafted
  // This ensures generateDraft properly counts toward tenant quota limits
  if (session.tenantId) {
    const hasDraftedDescription = !!(result.draft?.detailedDescription && result.draft.detailedDescription.trim())
    const hasDraftedClaims = !!(result.draft?.claims && result.draft.claims.trim())
    
    if (hasDraftedDescription) {
      const descTrackResult = await trackSectionDrafted(
        session.tenantId,
        sessionId,
        patentId,
        user.id,
        'detailedDescription'
      )
      if (descTrackResult.quotaExceeded) {
        // Return the draft but include quota warning
        return NextResponse.json({ 
          draft,
          quotaWarning: 'Patent drafting quota exceeded. Further drafting may be limited.',
          quotaExceeded: true
        })
      }
    }
    
    if (hasDraftedClaims) {
      const claimsTrackResult = await trackSectionDrafted(
        session.tenantId,
        sessionId,
        patentId,
        user.id,
        'claims'
      )
      if (claimsTrackResult.quotaExceeded) {
        // Return the draft but include quota warning
        return NextResponse.json({ 
          draft,
          quotaWarning: 'Patent drafting quota exceeded. Further drafting may be limited.',
          quotaExceeded: true
        })
      }
    }
  }

  return NextResponse.json({ draft });
}

// New: Autosave unapproved sections to a working draft version (does not advance stage)
async function handleAutosaveSections(user: any, patentId: string, data: any) {
  const { sessionId, patch } = data
  if (!sessionId || !patch || typeof patch !== 'object') {
    return NextResponse.json({ error: 'sessionId and patch object required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' } }, ideaRecord: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const effectiveJurisdiction = (session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()
  const drafts = Array.isArray(session.annexureDrafts) ? session.annexureDrafts : []
  const last = drafts.find((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)

  // Normalize patch keys to canonical keys (DB-driven aliases)
  const normalizedPatch = await normalizeSectionKeys(patch as Record<string, any>)

  // Use shared constant for legacy columns
  const legacyFields = ANNEXURE_LEGACY_COLUMNS as readonly string[]

  const parseObject = (value: unknown): Record<string, string> => {
    if (!value) return {}
    if (typeof value === 'object') return value as Record<string, string>
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
      } catch {
        return {}
      }
    }
    return {}
  }

  const prevExtraSections = parseObject((last as any)?.extraSections)
  const extraSections: Record<string, any> = { ...prevExtraSections }
  const updateData: Record<string, any> = {}
  const clearedSections: string[] = []
  let hasSetSections = false

  for (const [canonicalKey, raw] of Object.entries(normalizedPatch)) {
    const shouldClear = raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())

    if (shouldClear) {
      clearedSections.push(canonicalKey)
      if (legacyFields.includes(canonicalKey)) {
        updateData[canonicalKey] = canonicalKey === 'title' ? '' : null
      } else {
        delete extraSections[canonicalKey]
      }
      continue
    }

    if (typeof raw !== 'string') continue
    const value = raw.trim()
    hasSetSections = true

    if (legacyFields.includes(canonicalKey)) {
      updateData[canonicalKey] = value
    } else {
      extraSections[canonicalKey] = value
    }
  }

  if (!last && clearedSections.length > 0 && !hasSetSections) {
    return NextResponse.json({ draft: null, clearedSections })
  }

  const savedSectionKeys = Object.keys(normalizedPatch).filter(k => normalizedPatch[k] && typeof normalizedPatch[k] === 'string' && (normalizedPatch[k] as string).trim())
  if (session.tenantId) {
    const quotaCheck = await canTrackSectionDrafts(session.tenantId, sessionId, patentId, savedSectionKeys)
    if (!quotaCheck.allowed) {
      return NextResponse.json(
        {
          error: quotaCheck.reason || 'Patent drafting quota exceeded. Please upgrade your plan to continue.',
          code: 'QUOTA_EXCEEDED',
          quotaExceeded: true,
          quota: {
            daily: quotaCheck.quota.dailyUsed + '/' + (quotaCheck.quota.dailyLimit ?? '∞'),
            monthly: quotaCheck.quota.monthlyUsed + '/' + (quotaCheck.quota.monthlyLimit ?? '∞')
          }
        },
        { status: 403 }
      )
    }
  }

  // Create or update a working draft in place: if last exists, update it; else create version 1
  let draft
  if (last) {
    draft = await prisma.annexureDraft.update({
      where: { id: last.id },
      data: {
        ...(Object.keys(updateData).length ? updateData : {}),
        extraSections
      }
    })
  } else {
    const title = typeof updateData.title === 'string' && updateData.title.trim()
      ? updateData.title.trim()
      : (session as any)?.ideaRecord?.title || 'Untitled'

    const createData: any = {
      session: { connect: { id: sessionId } },
      version: 1,
      jurisdiction: effectiveJurisdiction,
      title,
      fullDraftText: '',
      isValid: false
    }

    for (const field of legacyFields) {
      if (field === 'title') continue
      if (typeof updateData[field] === 'string' && updateData[field].trim()) {
        createData[field] = updateData[field].trim()
      }
    }

    if (Object.keys(extraSections).length > 0) {
      createData.extraSections = extraSections
    }

    draft = await prisma.annexureDraft.create({
      data: createData
    })
  }

  // Track essential sections for patent-based quota counting
  // A patent counts toward quota when both detailedDescription AND claims are drafted
  if (session.tenantId) {
    for (const sectionKey of savedSectionKeys) {
      if (sectionKey === 'detailedDescription' || sectionKey === 'description' || sectionKey === 'claims') {
        const trackResult = await trackSectionDrafted(
          session.tenantId,
          sessionId,
          patentId,
          user.id,
          sectionKey
        )
        
        // ENFORCEMENT: If quota is exceeded, return error to block autosave
        // This prevents users from exceeding their plan's patent drafting limits
        if (trackResult.quotaExceeded) {
          return NextResponse.json(
            { 
              error: 'Patent drafting quota exceeded. Please upgrade your plan to continue.',
              code: 'QUOTA_EXCEEDED',
              quotaExceeded: true,
              draft // Return partial draft for UX
            },
            { status: 403 }
          )
        }
      }
    }
  }

  return NextResponse.json({ draft, clearedSections })
}



// Allow users to reset/delete a jurisdiction-specific draft (without removing the jurisdiction unless explicitly asked)
async function handleDeleteAnnexureDraft(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction, removeFromList } = data
  if (!sessionId || !jurisdiction) {
    return NextResponse.json({ error: 'sessionId and jurisdiction are required' }, { status: 400 })
  }
  const normalized = String(jurisdiction).toUpperCase()

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const existingStatus = (session!.jurisdictionDraftStatus as any) || {}
  const retainedLanguage = existingStatus?.[normalized]?.language

  await prisma.annexureDraft.deleteMany({ where: { sessionId, jurisdiction: normalized } })

  const statusMap: Record<string, any> = { ...existingStatus }
  delete statusMap[normalized]
  if (retainedLanguage) statusMap[normalized] = { language: retainedLanguage }

  const shouldRemove = Boolean(removeFromList)
  const initialJurisdictions = Array.isArray(session.draftingJurisdictions)
    ? Array.from(new Set(session.draftingJurisdictions.map((c: string) => (c || '').toUpperCase())))
    : []

  const { jurisdictions, statusMap: nextStatusMap, nextActive } = computeJurisdictionStateOnDelete({
    session,
    statusMap,
    jurisdictions: initialJurisdictions,
    normalized,
    shouldRemove
  })

  const updatedSession = await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      draftingJurisdictions: jurisdictions,
      activeJurisdiction: nextActive,
      jurisdictionDraftStatus: nextStatusMap
    }
  })

  return NextResponse.json({ success: true, session: updatedSession })
}

// New: Generate specific annexure sections without persisting (e.g., ["title","abstract"]) with backend debug steps
async function handleGenerateSections(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const {
    sessionId,
    sections: rawSections,
    instructions,
    selectedPatents,
    jurisdiction,
    usePersonaStyle: usePersonaStyleFromData,
    personaSelection: personaSelectionFromData,
    acceptPersonaWarnings
  } = data
  const sections = await normalizeRequestedSectionList(rawSections)

  if (!sessionId || sections.length === 0) {
    return NextResponse.json({ error: 'sessionId and sections[] are required' }, { status: 400 })
  }

  const baseSession = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true,
      diagramSources: true, // Needed for figure merging in DraftingService
      // Needed for prior-art selection logic in DraftingService
      relatedArtSelections: true,
      // Needed for unified figure sequence (diagrams + sketches)
      sketchRecords: {
        where: { isDeleted: false, status: 'SUCCESS' }
      }
    }
  })
  if (!baseSession) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  
  // Ensure figure sequence metadata is present (needed for frozen ordering with sketches)
  const sequenceMeta = await prisma.draftingSession.findUnique({
    where: { id: sessionId },
    select: { figureSequence: true, figureSequenceFinalized: true }
  })

  // Fallback: If no sketches via session relation, load from patent directly
  let session = baseSession as any
  if (!baseSession.sketchRecords || baseSession.sketchRecords.length === 0) {
    const patentSketches = await prisma.sketchRecord.findMany({
      where: { 
        patentId,
        isDeleted: false,
        status: 'SUCCESS'
      }
    })
    if (patentSketches.length > 0) {
      console.log(`[GenerateSections] Loaded ${patentSketches.length} sketches from patent directly`)
      session = { ...baseSession, sketchRecords: patentSketches }
    }
  }
  session = {
    ...session,
    figureSequence: sequenceMeta?.figureSequence ?? (session as any).figureSequence,
    figureSequenceFinalized: sequenceMeta?.figureSequenceFinalized ?? (session as any).figureSequenceFinalized
  }

  // Use provided instructions directly (no legacy style injection)
  const mergedInstructions: Record<string, string> = { ...(instructions || {}) }

  const effectiveJurisdiction = (jurisdiction || session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()
  const effectiveSections = filterDrawingSectionKeys(session, sections)
  const skippedDrawingSections = sections.filter((section: string) => !effectiveSections.includes(section))

  // Check for frozen claims - use them instead of regenerating
  const normalizedData = normalizeClaimsForSession((session.ideaRecord?.normalizedData as any) || {})
  const frozenClaimsSnapshot = getAuthoritativeClaims(normalizedData)
  const frozenClaimsText = frozenClaimsSnapshot.html
  const frozenClaimsStructured = frozenClaimsSnapshot.structured
  const claimsFrozen = !!(normalizedData.claimsApprovedAt || normalizedData.claimsFinal)
  const claimsJurisdiction = normalizedData.claimsJurisdiction || effectiveJurisdiction
  
  // If claims are frozen and user is trying to generate claims, use frozen claims instead
  let sectionsToGenerate = [...effectiveSections]
  let frozenClaimsUsed = false
  
  if (claimsFrozen && effectiveSections.includes('claims')) {
    // Remove 'claims' from sections to generate - we'll use frozen claims
    sectionsToGenerate = effectiveSections.filter((s: string) => s !== 'claims')
    frozenClaimsUsed = true
    console.log(`[generateSections] Using frozen claims from Stage 1 (frozen at: ${normalizedData.claimsApprovedAt})`)
  }

  let personaConfig: { enabled: boolean; selection?: PersonaSelection } = { enabled: false, selection: undefined }
  try {
    personaConfig = await resolveEffectivePersonaConfig(user, session, {
      usePersonaStyle: usePersonaStyleFromData,
      personaSelection: personaSelectionFromData
    })

    if (personaConfig.enabled && personaConfig.selection?.primaryPersonaId && sectionsToGenerate.length > 0 && !acceptPersonaWarnings) {
      const personaWarnings = await getPersonaCoverageWarnings(
        user.id,
        user.tenantId,
        sectionsToGenerate,
        effectiveJurisdiction,
        personaConfig.selection
      )
      if (personaWarnings.length > 0) return personaCoverageResponse(personaWarnings)
    }
  } catch (error) {
    if (error instanceof PersonaAccessError) return personaAccessResponse(error)
    throw error
  }

  const usePersonaStyle = personaConfig.enabled
  const personaSelection = personaConfig.selection

  // Load latest draft for this jurisdiction (if any) and inject into session for context
  const lastDraftForJurisdiction = await prisma.annexureDraft.findFirst({
    where: { sessionId, jurisdiction: effectiveJurisdiction },
    orderBy: { version: 'desc' }
  })
  
  // Extend session with user context for writing sample-based style mimicry
  const sessionWithDrafts: any = { 
    ...session, 
    annexureDrafts: lastDraftForJurisdiction ? [lastDraftForJurisdiction] : [],
    usePersonaStyle, // Pass to DraftingService for writing sample injection
    personaSelection, // Pass persona selection for multi-persona support (primary + secondary)
    userId: user.id  // Required for fetching user's writing samples
  }

  const preferredLanguage = getPreferredLanguageForJurisdiction(session, effectiveJurisdiction)

  // Only generate sections that aren't using frozen claims
  let result: any = { success: true, generated: {}, debugSteps: [] }
  if (skippedDrawingSections.length > 0) {
    result.debugSteps.push({
      step: 'figureless_sections_skipped',
      status: 'ok',
      meta: { skippedSections: skippedDrawingSections }
    })
  }
  
  if (sectionsToGenerate.length > 0) {
    const initialDebugSteps = result.debugSteps || []
    result = await DraftingService.generateSections(
      sessionWithDrafts,
      sectionsToGenerate,
      mergedInstructions,
      user.tenantId,
      requestHeaders,
      selectedPatents,
      effectiveJurisdiction,
      preferredLanguage
    )
    result.debugSteps = [...initialDebugSteps, ...(result.debugSteps || [])]
    if (!result.success) {
      const statusCode = result.retryAfter ? 429 : 400
      const headers = result.retryAfter ? { 'Retry-After': result.retryAfter.toString() } : undefined
      return NextResponse.json({
        error: result.error,
        debugSteps: result.debugSteps,
        personaStyleApplied: result.personaStyleApplied || false,
        personaProvenance: result.personaProvenance || {},
        personaWarnings: result.personaWarnings || []
      }, { status: statusCode, headers })
    }
  }
  
  // Add frozen claims to the result if they were used
  if (frozenClaimsUsed) {
    // Convert HTML claims to plain text format suitable for patent draft
    let claimsForDraft = frozenClaimsText
    
    // If we have structured claims, format them properly
    if (Array.isArray(frozenClaimsStructured) && frozenClaimsStructured.length > 0) {
      claimsForDraft = frozenClaimsStructured.map((c: any) => {
        return `${c.number}. ${c.text}`
      }).join('\n\n')
    } else if (frozenClaimsText) {
      // Strip HTML tags for plain text format
      claimsForDraft = frozenClaimsText
        .replace(/<p>/gi, '')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<strong>/gi, '')
        .replace(/<\/strong>/gi, '')
        .replace(/<[^>]*>/g, '')
        .trim()
    }
    
    result.generated = result.generated || {}
    result.generated.claims = claimsForDraft
    result.personaProvenance = {
      ...(result.personaProvenance || {}),
      claims: {
        styleEnabled: usePersonaStyle,
        applied: false,
        source: 'frozen_claims',
        personaId: personaSelection?.primaryPersonaId,
        message: 'Frozen claims were reused unchanged; persona style was not applied to claims.'
      }
    }
    result.personaStyleApplied = Object.values(result.personaProvenance).some((p: any) => p?.applied)
    result.debugSteps = result.debugSteps || []
    result.debugSteps.push({ 
      step: 'frozen_claims_used', 
      status: 'ok', 
      meta: { 
        frozenAt: normalizedData.claimsApprovedAt,
        jurisdiction: claimsJurisdiction,
        claimCount: Array.isArray(frozenClaimsStructured) ? frozenClaimsStructured.length : 'unknown'
      } 
    })
  }

  // Autosave generated sections into latest draft without bumping version
  try {
    const last = lastDraftForJurisdiction
    
    // Legacy columns (backward compatible) - these are dedicated DB columns
    // Use shared constant from annexure-schema.ts
    const legacyFields = ANNEXURE_LEGACY_COLUMNS as readonly string[]
    
    // Normalize all generated keys using database-driven alias resolution
    const normalizedGenerated = result.generated ? await normalizeSectionKeys(result.generated as Record<string, any>) : {}
    if (areFiguresSkipped(session)) {
      delete (normalizedGenerated as Record<string, any>).briefDescriptionOfDrawings
    }

    const generatedSectionKeys = Object.keys(normalizedGenerated).filter(k => normalizedGenerated[k] && typeof normalizedGenerated[k] === 'string' && (normalizedGenerated[k] as string).trim())
    if (session.tenantId) {
      const quotaCheck = await canTrackSectionDrafts(session.tenantId, sessionId, patentId, generatedSectionKeys)
      if (!quotaCheck.allowed) {
        return NextResponse.json(
          {
            error: quotaCheck.reason || 'Patent drafting quota exceeded. Please upgrade your plan to continue.',
            code: 'QUOTA_EXCEEDED',
            quotaExceeded: true,
            quota: {
              daily: quotaCheck.quota.dailyUsed + '/' + (quotaCheck.quota.dailyLimit ?? '∞'),
              monthly: quotaCheck.quota.monthlyUsed + '/' + (quotaCheck.quota.monthlyLimit ?? '∞')
            }
          },
          { status: 403 }
        )
      }
    }
    
    if (last && Object.keys(normalizedGenerated).length > 0) {
      const updateData: any = {}
      // extraSections is a JSON column for scalable section storage
      const extraSections: Record<string, string> = { ...(((last as any).extraSections) || {}) }

      for (const [canonicalKey, v] of Object.entries(normalizedGenerated)) {
        if (typeof v === 'string' && v.trim()) {
          if (legacyFields.includes(canonicalKey)) {
            // Store in legacy column
            updateData[canonicalKey] = v.trim()
          } else {
            // Store in extraSections JSON - key is already canonical
            extraSections[canonicalKey] = v.trim()
          }
        }
      }
      
      // Save extra sections if any were updated
      if (Object.keys(extraSections).length > 0) {
        updateData.extraSections = extraSections
      }
      
      console.log('Autosave updateData keys:', Object.keys(updateData))
      console.log('Extra sections keys:', Object.keys(extraSections))
      console.log('Last draft ID:', last.id)
      if (Object.keys(updateData).length > 0) {
        await prisma.annexureDraft.update({ where: { id: last.id }, data: updateData })
      }
    } else if (Object.keys(normalizedGenerated).length > 0) {
      // Create initial draft if none present
      const createData: any = { sessionId, version: 1, jurisdiction: effectiveJurisdiction, fullDraftText: '' }
      const extraSections: Record<string, string> = {}

      // Set title
      createData.title = normalizedGenerated.title || session.ideaRecord?.title || 'Untitled'

      for (const [canonicalKey, v] of Object.entries(normalizedGenerated)) {
        if (canonicalKey === 'title') continue // Already handled
        if (typeof v === 'string' && v.trim()) {
          if (legacyFields.includes(canonicalKey)) {
            // Store in legacy column
            createData[canonicalKey] = v.trim()
          } else {
            // Store in extraSections JSON - key is already canonical
            extraSections[canonicalKey] = v.trim()
        }
      }
      }
      
      // Save extra sections if any exist
      if (Object.keys(extraSections).length > 0) {
        createData.extraSections = extraSections
      }

      console.log('Creating new draft with keys:', Object.keys(createData))
      console.log('Extra sections keys:', Object.keys(extraSections))
      await prisma.annexureDraft.create({ data: createData })
    }
    
    // QUOTA TRACKING: Track essential sections for patent-based quota counting
    // A patent counts toward quota when both detailedDescription AND claims are drafted
    // This ensures generateSections properly counts toward tenant quota limits
    if (session.tenantId && normalizedGenerated) {
      const hasDraftedDescription = !!(
        (normalizedGenerated.detailedDescription && (normalizedGenerated.detailedDescription as string).trim()) ||
        (normalizedGenerated.description && (normalizedGenerated.description as string).trim())
      )
      const hasDraftedClaims = !!(normalizedGenerated.claims && (normalizedGenerated.claims as string).trim())
      
      let quotaExceeded = false
      
      if (hasDraftedDescription) {
        const descTrackResult = await trackSectionDrafted(
          session.tenantId,
          sessionId,
          patentId,
          user.id,
          'detailedDescription'
        )
        if (descTrackResult.quotaExceeded) {
          quotaExceeded = true
        }
      }
      
      if (hasDraftedClaims) {
        const claimsTrackResult = await trackSectionDrafted(
          session.tenantId,
          sessionId,
          patentId,
          user.id,
          'claims'
        )
        if (claimsTrackResult.quotaExceeded) {
          quotaExceeded = true
        }
      }
      
      if (quotaExceeded) {
        // Return the generated content but include quota warning
        return NextResponse.json({ 
          generated: result.generated, 
          debugSteps: result.debugSteps, 
          llmMeta: result.llmMeta,
          warnings: result.warnings,
          personaStyleApplied: result.personaStyleApplied || false,
          personaProvenance: result.personaProvenance || {},
          personaWarnings: result.personaWarnings || [],
          quotaWarning: 'Patent drafting quota exceeded. Further drafting may be limited.',
          quotaExceeded: true
        })
      }
    }
  } catch (e) {
    console.error('Autosave after generation failed:', e)
    console.error('Error details:', e instanceof Error ? e.message : 'Unknown error')
  }

  // Include warnings in the response so the UI can display them
  return NextResponse.json({ 
    generated: result.generated, 
    debugSteps: result.debugSteps, 
    llmMeta: result.llmMeta,
    warnings: result.warnings, // Context warnings (prior art, figures, components missing)
    personaStyleApplied: result.personaStyleApplied || false,
    personaProvenance: result.personaProvenance || {},
    personaWarnings: result.personaWarnings || []
  })
}

// Check for warnings before auto-generation starts
async function handleCheckWarnings(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, sections: rawSections, jurisdiction } = data
  const sections = await normalizeRequestedSectionList(rawSections)

  if (!sessionId || sections.length === 0) {
    return NextResponse.json({ error: 'sessionId and sections[] are required' }, { status: 400 })
  }

  const baseSession = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true,
      diagramSources: true,
      relatedArtSelections: true,
      sketchRecords: {
        where: { isDeleted: false, status: 'SUCCESS' }
      }
    }
  })
  if (!baseSession) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Use the same logic as generateSections to set up context
  const effectiveJurisdiction = (jurisdiction || baseSession.activeJurisdiction || baseSession.draftingJurisdictions?.[0] || 'IN').toUpperCase()

  // Check context availability warnings (similar to generateSections but without actual generation)
  const warnings: Array<{ section: string; type: 'priorArt' | 'figures' | 'components'; message: string; impact: string }> = []

  // Check prior art availability - must match the logic in DraftingService.generateSections()
  // Sources checked (in priority order):
  // 1. priorArtConfig.priorArtForDrafting.selectedPatents (Stage 3.5 workflow - PRIMARY)
  // 2. Manual prior art text
  // 3. USER_SELECTED tagged patents from relatedArtSelections
  const manualPriorArt = baseSession.manualPriorArt as any
  const priorArtConfig = (baseSession as any).priorArtConfig || {}
  const priorArtForDraftingConfig = priorArtConfig.priorArtForDrafting || {}
  const configSelectedPatents = Array.isArray(priorArtForDraftingConfig.selectedPatents) 
    ? priorArtForDraftingConfig.selectedPatents 
    : []
  
  // Check if user has selected patents via the Prior Art for Drafting tab (Stage 3.5)
  const hasConfigSelectedPatents = configSelectedPatents.length > 0
  
  // Check if user has manual prior art text
  const hasManualPriorArt = !!((manualPriorArt && typeof manualPriorArt === 'object' && manualPriorArt.manualPriorArtText) ||
                               (typeof manualPriorArt === 'string' && manualPriorArt?.trim()))
  
  // Check if user has USER_SELECTED tagged patents in relatedArtSelections
  const userSelectedPatents = (baseSession.relatedArtSelections || []).filter(
    (sel: any) => Array.isArray(sel.tags) && sel.tags.includes('USER_SELECTED')
  )
  const hasUserSelectedPatents = userSelectedPatents.length > 0
  
  // Has prior art if ANY of the sources have data
  const hasPriorArt = hasConfigSelectedPatents || hasManualPriorArt || hasUserSelectedPatents

  // Check figures availability
  const figuresSkipped = areFiguresSkipped(baseSession)
  const hasFigures = !figuresSkipped && !!((baseSession.figurePlans && baseSession.figurePlans.length > 0) ||
                       (baseSession.sketchRecords && baseSession.sketchRecords.length > 0))

  // Check components availability
  const referenceMap = baseSession.referenceMap as any
  const components = extractComponentsArray(referenceMap)
  const hasComponents = components.length > 0

  // Get context requirements for each section
  for (const section of sections) {
    try {
      const contextReq = await getSectionContextRequirements(section, effectiveJurisdiction)

      if (contextReq.requiresPriorArt && !hasPriorArt) {
        warnings.push({
          section,
          type: 'priorArt',
          message: `Section "${section}" requires prior art references for best results. Consider adding prior art in the Prior Art Selection stage.`,
          impact: 'Section will be generated with generic background. Quality may be reduced.'
        })
      }

      if (!figuresSkipped && contextReq.requiresFigures && !hasFigures) {
        warnings.push({
          section,
          type: 'figures',
          message: `Section "${section}" requires figures/drawings for best results. Consider adding figures in the Figures & Sketches stage.`,
          impact: 'Section will be generated without figure references. Quality may be reduced.'
        })
      }

      if (contextReq.requiresComponents && !hasComponents) {
        warnings.push({
          section,
          type: 'components',
          message: `Section "${section}" requires component reference numerals for best results. Consider adding components in the Reference Numerals stage.`,
          impact: 'Section will be generated without reference numerals. Quality may be reduced.'
        })
      }
    } catch (err) {
      console.warn(`Failed to get context requirements for ${section}:`, err)
    }
  }

  return NextResponse.json({ warnings })
}

// New: Persist approved sections and run consistency validation
async function handleSaveSections(user: any, patentId: string, data: any) {
  const { sessionId, patch } = data
  if (!sessionId || !patch || typeof patch !== 'object') {
    return NextResponse.json({ error: 'sessionId and patch object required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' } }, referenceMap: true, figurePlans: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const effectiveJurisdiction = (session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()
  const drafts = Array.isArray(session.annexureDrafts) ? session.annexureDrafts : []
  const last = drafts.find((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)
  const nextVersion = (last?.version || 0) + 1

  // Legacy columns (backward compatible) - use shared constant
  const legacyFields = ANNEXURE_LEGACY_COLUMNS as readonly string[]
  
  // Normalize patch keys using database-driven alias resolution
  const normalizedPatch = await normalizeSectionKeys(patch as Record<string, any>)
  if (areFiguresSkipped(session)) {
    delete (normalizedPatch as Record<string, any>).briefDescriptionOfDrawings
  }

  // Get previous extra sections (extraSections is a JSON column for scalable section storage)
  const prevExtraSections = ((last as any)?.extraSections as Record<string, string>) || {}

  // Merge normalized patch into latest (or start new)
  const merged: any = {
    title: last?.title || '',
    fieldOfInvention: last?.fieldOfInvention || null,
    background: last?.background || null,
    summary: last?.summary || null,
    briefDescriptionOfDrawings: areFiguresSkipped(session) ? null : (last?.briefDescriptionOfDrawings || null),
    detailedDescription: last?.detailedDescription || null,
    bestMethod: last?.bestMethod || null,
    claims: last?.claims || null,
    abstract: last?.abstract || null,
    industrialApplicability: last?.industrialApplicability || null,
    listOfNumerals: last?.listOfNumerals || null,
    ...normalizedPatch
  }

  // Build extra sections from previous + normalized patch
  const extraSections: Record<string, string> = { ...prevExtraSections }
  for (const [canonicalKey, patchValue] of Object.entries(normalizedPatch)) {
    // If key is not a legacy field, it goes to extraSections
    if (!legacyFields.includes(canonicalKey) && typeof patchValue === 'string' && patchValue.trim()) {
      extraSections[canonicalKey] = patchValue.trim()
    }
  }

  // Assemble full text for validation (including extra sections)
  const fullDraftText = [
    extraSections.crossReference ? `CROSS-REFERENCE TO RELATED APPLICATIONS\n\n${extraSections.crossReference}` : '',
    extraSections.preamble ? `PREAMBLE\n\n${extraSections.preamble}` : '',
    merged.fieldOfInvention ? `FIELD OF INVENTION\n\n${merged.fieldOfInvention}` : '',
    merged.background ? `BACKGROUND\n\n${merged.background}` : '',
    extraSections.objectsOfInvention ? `OBJECT(S) OF THE INVENTION\n\n${extraSections.objectsOfInvention}` : '',
    extraSections.technicalProblem ? `TECHNICAL PROBLEM\n\n${extraSections.technicalProblem}` : '',
    extraSections.technicalSolution ? `TECHNICAL SOLUTION\n\n${extraSections.technicalSolution}` : '',
    extraSections.advantageousEffects ? `ADVANTAGEOUS EFFECTS\n\n${extraSections.advantageousEffects}` : '',
    merged.summary ? `SUMMARY\n\n${merged.summary}` : '',
    !areFiguresSkipped(session) && merged.briefDescriptionOfDrawings ? `BRIEF DESCRIPTION OF DRAWINGS\n\n${merged.briefDescriptionOfDrawings}` : '',
    merged.detailedDescription ? `DETAILED DESCRIPTION\n\n${merged.detailedDescription}` : '',
    extraSections.modeOfCarryingOut ? `MODE(S) FOR CARRYING OUT THE INVENTION\n\n${extraSections.modeOfCarryingOut}` : '',
    merged.bestMethod ? `BEST METHOD\n\n${merged.bestMethod}` : '',
    merged.claims ? `CLAIMS\n\n${merged.claims}` : '',
    merged.abstract ? `ABSTRACT\n\n${merged.abstract}` : '',
    merged.industrialApplicability ? `INDUSTRIAL APPLICABILITY\n\n${merged.industrialApplicability}` : '',
    merged.listOfNumerals ? `LIST OF REFERENCE NUMERALS\n\n${merged.listOfNumerals}` : ''
  ].filter(Boolean).join('\n\n')

  // Lightweight consistency validation using service
  const validation = DraftingService.validateDraftConsistencyPublic({ fullText: fullDraftText }, session as any)
  const validationReport = {
    ...(validation.report || {})
  }

  const savedSectionKeys = Object.keys(normalizedPatch).filter(k => normalizedPatch[k] && typeof normalizedPatch[k] === 'string' && (normalizedPatch[k] as string).trim())
  if (session.tenantId) {
    const quotaCheck = await canTrackSectionDrafts(session.tenantId, sessionId, patentId, savedSectionKeys)
    if (!quotaCheck.allowed) {
      return NextResponse.json(
        {
          error: quotaCheck.reason || 'Patent drafting quota exceeded. Please upgrade your plan to continue.',
          code: 'QUOTA_EXCEEDED',
          quotaExceeded: true,
          quota: {
            daily: quotaCheck.quota.dailyUsed + '/' + (quotaCheck.quota.dailyLimit ?? '∞'),
            monthly: quotaCheck.quota.monthlyUsed + '/' + (quotaCheck.quota.monthlyLimit ?? '∞')
          },
          validationReport
        },
        { status: 403 }
      )
    }
  }

  // Note: extraSections is a JSON column added for scalability - TypeScript types may need IDE restart to update
  const draftData: any = {
      sessionId,
      version: nextVersion,
      jurisdiction: effectiveJurisdiction,
      title: merged.title || last?.title || 'Untitled',
      fieldOfInvention: merged.fieldOfInvention || undefined,
      background: merged.background || undefined,
      summary: merged.summary || undefined,
      briefDescriptionOfDrawings: areFiguresSkipped(session) ? undefined : (merged.briefDescriptionOfDrawings || undefined),
      detailedDescription: merged.detailedDescription || undefined,
      bestMethod: merged.bestMethod || undefined,
      claims: merged.claims || undefined,
      abstract: merged.abstract || undefined,
      industrialApplicability: merged.industrialApplicability || undefined,
      listOfNumerals: merged.listOfNumerals || undefined,
    extraSections: Object.keys(extraSections).length > 0 ? extraSections : undefined,
      fullDraftText,
      isValid: !!validation.valid,
      validationReport
    }
  const draft = await prisma.annexureDraft.create({ data: draftData })

  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      jurisdictionDraftStatus: {
        ...(session!.jurisdictionDraftStatus as any || {}),
        [effectiveJurisdiction]: {
          status: 'done',
          latestVersion: nextVersion,
          updatedAt: new Date().toISOString()
        }
      }
    }
  })

  // Ensure session is at ANNEXURE_DRAFT stage
  if (session.status !== 'ANNEXURE_DRAFT') {
    await prisma.draftingSession.update({ where: { id: sessionId }, data: { status: 'ANNEXURE_DRAFT' } })
  }

  // Track essential sections for patent-based quota counting
  // A patent counts toward quota when both detailedDescription AND claims are drafted
  if (session.tenantId) {
    for (const sectionKey of savedSectionKeys) {
      if (sectionKey === 'detailedDescription' || sectionKey === 'description' || sectionKey === 'claims') {
        const trackResult = await trackSectionDrafted(
          session.tenantId,
          sessionId,
          patentId,
          user.id,
          sectionKey
        )
        
        // ENFORCEMENT: If quota is exceeded, return error to block saving
        // This prevents users from exceeding their plan's patent drafting limits
        if (trackResult.quotaExceeded) {
          return NextResponse.json(
            { 
              error: 'Patent drafting quota exceeded. Please upgrade your plan to continue.',
              code: 'QUOTA_EXCEEDED',
              quotaExceeded: true,
              // Still return the draft so UI can show what was attempted
              draft,
              validationReport
            },
            { status: 403 }
          )
        }
      }
    }
  }

  return NextResponse.json({ draft, validationReport })
}

// Get all draft versions for a session/jurisdiction - enables version history and comparison
async function handleGetDraftVersions(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction } = data
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      annexureDrafts: {
        orderBy: { version: 'desc' }
      }
    }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const effectiveJurisdiction = (jurisdiction || session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()
  
  // Filter drafts by jurisdiction and return version summary
  const drafts = (session.annexureDrafts || [])
    .filter((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)
    .map((d: any) => ({
      id: d.id,
      version: d.version,
      jurisdiction: d.jurisdiction,
      title: d.title,
      isValid: d.isValid,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      // Include section keys that have content (for quick overview)
      sectionsWithContent: [
        d.title && 'title',
        d.fieldOfInvention && 'fieldOfInvention',
        d.background && 'background',
        d.summary && 'summary',
        d.briefDescriptionOfDrawings && 'briefDescriptionOfDrawings',
        d.detailedDescription && 'detailedDescription',
        d.bestMethod && 'bestMethod',
        d.claims && 'claims',
        d.abstract && 'abstract',
        d.industrialApplicability && 'industrialApplicability',
        d.listOfNumerals && 'listOfNumerals',
        // Extra sections from JSON column
        ...Object.keys((d as any).extraSections || {})
      ].filter(Boolean),
      // Include extra sections keys
      extraSectionsKeys: Object.keys((d as any).extraSections || {})
    }))

  return NextResponse.json({
    versions: drafts,
    totalVersions: drafts.length,
    latestVersion: drafts[0]?.version || 0,
    jurisdiction: effectiveJurisdiction
  })
}

// Get a specific draft version by ID or version number - for viewing/comparing old versions
async function handleGetDraftByVersion(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction, version, draftId } = data
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  let draft: any = null

  if (draftId) {
    // Get by specific draft ID
    draft = await prisma.annexureDraft.findFirst({
      where: { id: draftId, sessionId }
    })
  } else if (version !== undefined) {
    // Get by version number and jurisdiction
    const effectiveJurisdiction = (jurisdiction || session.activeJurisdiction || (session as any).draftingJurisdictions?.[0] || 'US').toUpperCase()
    draft = await prisma.annexureDraft.findFirst({
      where: {
        sessionId,
        version: parseInt(version, 10),
        jurisdiction: effectiveJurisdiction
      }
    })
  }

  if (!draft) {
    return NextResponse.json({ error: 'Draft version not found' }, { status: 404 })
  }

  // Return full draft content including extra sections
  return NextResponse.json({
    draft: {
      id: draft.id,
      version: draft.version,
      jurisdiction: draft.jurisdiction,
      title: draft.title,
      fieldOfInvention: draft.fieldOfInvention,
      background: draft.background,
      summary: draft.summary,
      briefDescriptionOfDrawings: draft.briefDescriptionOfDrawings,
      detailedDescription: draft.detailedDescription,
      bestMethod: draft.bestMethod,
      claims: draft.claims,
      abstract: draft.abstract,
      industrialApplicability: draft.industrialApplicability,
      listOfNumerals: draft.listOfNumerals,
      // Include extra sections from JSON column
      extraSections: (draft as any).extraSections || {},
      // Metadata
      fullDraftText: draft.fullDraftText,
      isValid: draft.isValid,
      validationReport: draft.validationReport,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt
    }
  })
}

// ============================================================================
// Multi-Jurisdiction Filing Handlers
// ============================================================================

import { 
  generateReferenceDraft, 
  translateReferenceDraft, 
  getSectionMapping,
  validateDraft
  // Note: getSupersetSectionKeys, isNonApplicableHeading imported at top of file
} from '@/lib/multi-jurisdiction-service'

/**
 * Generate Reference Draft (dynamic superset sections based on selected jurisdictions)
 * Required as first step in multi-jurisdiction filing
 * 
 * Optimization: Only generates sections that are actually needed by the selected jurisdictions,
 * reducing cost, complexity, and generation time.
 */
async function handleGenerateReferenceDraft(
  user: any, 
  patentId: string, 
  data: any, 
  requestHeaders: Record<string, string>
) {
  const { sessionId } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  let sessionData = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true,
      diagramSources: true,
      // Include sketches for unified figure sequence
      sketchRecords: {
        where: { isDeleted: false, status: 'SUCCESS' }
      },
      // Include related art selections for prior art in background/crossReference sections
      relatedArtSelections: true
    }
  })

  if (!sessionData) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  // Ensure sequence metadata is available for reference draft generation
  const sequenceMeta = await prisma.draftingSession.findUnique({
    where: { id: sessionId },
    select: { figureSequence: true, figureSequenceFinalized: true }
  })
  const session = {
    ...sessionData,
    figureSequence: sequenceMeta?.figureSequence ?? (sessionData as any).figureSequence,
    figureSequenceFinalized: sequenceMeta?.figureSequenceFinalized ?? (sessionData as any).figureSequenceFinalized
  }
  const figuresSkipped = areFiguresSkipped(session)

  // Get the selected jurisdictions (filter out 'REFERENCE' pseudo-jurisdiction)
  const selectedJurisdictions = (Array.isArray(session!.draftingJurisdictions) ? session!.draftingJurisdictions : [])
    .filter((j: string) => j && j.toUpperCase() !== 'REFERENCE')

  // Check if multi-jurisdiction mode is enabled OR if multiple jurisdictions are actually selected
  // This allows reference draft generation even if isMultiJurisdiction wasn't explicitly set
  const hasMultipleJurisdictions = selectedJurisdictions.length > 1
  const isMultiMode = session!.isMultiJurisdiction === true || hasMultipleJurisdictions

  if (!isMultiMode) {
    return NextResponse.json({ 
      error: 'Reference draft only applicable for multi-jurisdiction mode. Select 2+ jurisdictions first.',
      hint: 'To enable multi-jurisdiction mode, select multiple countries in the jurisdiction selection step.'
    }, { status: 400 })
  }

  // If multi-mode but flag not set, auto-enable it
  if (hasMultipleJurisdictions && !session!.isMultiJurisdiction) {
    console.log(`[handleGenerateReferenceDraft] Auto-enabling multi-jurisdiction mode for ${selectedJurisdictions.length} jurisdictions`)
    await prisma.draftingSession.update({
      where: { id: sessionId },
      data: { isMultiJurisdiction: true }
    })
  }

  // Ensure we have jurisdictions to work with
  const jurisdictionsToUse = selectedJurisdictions.length > 0 ? selectedJurisdictions : ['US']

  console.log(`[handleGenerateReferenceDraft] Generating reference draft for jurisdictions: ${jurisdictionsToUse.join(', ')}`)

  // Use frozen claims from Stage 1 as the authoritative claims for the reference draft
  const normalizedData = normalizeClaimsForSession((session!.ideaRecord?.normalizedData as any) || {})
  const frozenClaimsSnapshot = getAuthoritativeClaims(normalizedData)
  const frozenClaimsStructured = frozenClaimsSnapshot.structured
  const frozenClaimsHtml = frozenClaimsSnapshot.html
  let frozenClaimsForDraft = ''
  if (Array.isArray(frozenClaimsStructured) && frozenClaimsStructured.length > 0) {
    frozenClaimsForDraft = frozenClaimsStructured.map((c: any) => `${c.number}. ${c.text}`).join('\n\n')
  } else if (frozenClaimsHtml) {
    frozenClaimsForDraft = htmlToPlainText(frozenClaimsHtml)
  }
  const hasFrozenClaims = !!frozenClaimsForDraft

  if (hasFrozenClaims) {
    try {
      const ddEvidenceResult = await ensureDetailedDescriptionSourceSelection({
        session,
        jurisdiction: 'REFERENCE',
        requestHeaders,
        tenantId: user.tenantId,
      })
      ;(session.ideaRecord as any).normalizedData = ddEvidenceResult.normalizedData
    } catch (error) {
      console.warn('[handleGenerateReferenceDraft] DD evidence selection failed:', error)
    }
  }

  // Generate reference draft with ONLY the sections needed by selected jurisdictions
  const result = await generateReferenceDraft(session, jurisdictionsToUse, user.tenantId, requestHeaders, hasFrozenClaims ? frozenClaimsForDraft : undefined)

  if (!result.success || !result.draft) {
    return NextResponse.json({ error: result.error || 'Failed to generate reference draft' }, { status: 500 })
  }

  // Enforce frozen claims into the reference draft (no regeneration)
  if (hasFrozenClaims) {
    result.draft.claims = frozenClaimsForDraft
  }

  // Build full text for storage (only include generated sections)
  const fullDraftText = Object.entries(result.draft)
    .filter(([key, value]) => (!figuresSkipped || !isDrawingSectionKey(key)) && value && value.trim()) // Only include non-empty sections
    .map(([key, value]) => `## ${key}\n\n${value}`)
    .join('\n\n---\n\n')

  // Store as AnnexureDraft with jurisdiction='REFERENCE'
  const lastReferenceDraft = await prisma.annexureDraft.findFirst({
    where: { sessionId, jurisdiction: 'REFERENCE' },
    orderBy: { version: 'desc' }
  })
  const version = (lastReferenceDraft?.version || 0) + 1

  const referenceDraft = await prisma.annexureDraft.create({
    data: {
      sessionId,
      version,
      jurisdiction: 'REFERENCE',
      // Map superset keys to AnnexureDraft schema fields (use empty string if not in dynamic superset)
      title: result.draft.title || '',
      fieldOfInvention: result.draft.fieldOfInvention || '',
      background: result.draft.background || '',
      summary: result.draft.summary || '',
      briefDescriptionOfDrawings: figuresSkipped ? '' : (result.draft.briefDescriptionOfDrawings || ''),
      detailedDescription: result.draft.detailedDescription || '',
      bestMethod: result.draft.bestMethod || result.draft.bestMode || '',
      claims: result.draft.claims || '',
      abstract: result.draft.abstract || '',
      industrialApplicability: result.draft.industrialApplicability || '',
      listOfNumerals: result.draft.listOfNumerals || '',
      fullDraftText,
      extraSections: {
        // Store extended superset sections
        preamble: result.draft.preamble || '',
        objectsOfInvention: result.draft.objectsOfInvention || '',
        technicalProblem: result.draft.technicalProblem || '',
        technicalSolution: result.draft.technicalSolution || '',
        advantageousEffects: result.draft.advantageousEffects || '',
        crossReference: result.draft.crossReference || '',
        // Store metadata about the dynamic superset
        _dynamicSections: result.dynamicSections, // The sections that were actually generated
        _sectionDetails: result.sectionDetails, // Which jurisdictions needed which sections
        _selectedJurisdictions: selectedJurisdictions,
        _rawDraft: result.draft
      },
      isValid: true
    }
  })

  // Update session to mark reference draft as complete
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      referenceDraftComplete: true,
      referenceDraftId: referenceDraft.id,
      jurisdictionDraftStatus: {
        ...(session!.jurisdictionDraftStatus as any || {}),
        REFERENCE: {
          status: 'done',
          latestVersion: version,
          sectionsGenerated: result.dynamicSections?.length || 0,
          updatedAt: new Date().toISOString()
        }
      }
    }
  })

  // Get full superset size from database for optimization metrics
  const allSupersetKeys = await getSupersetSectionKeys()
  const fullSupersetSize = allSupersetKeys.length
  const sectionsGenerated = result.dynamicSections?.length || 0

  return NextResponse.json({
    success: true,
    draft: result.draft,
    draftId: referenceDraft.id,
    version,
    tokensUsed: result.tokensUsed,
    // Include metadata about optimization
    optimization: {
      sectionsGenerated,
      fullSupersetSize,
      sectionsSaved: fullSupersetSize - sectionsGenerated,
      selectedJurisdictions: jurisdictionsToUse,
      dynamicSections: result.dynamicSections
    },
    // Include warnings about missing context (prior art, figures, components)
    warnings: result.warnings
  })
}

/**
 * Get the list of sections needed for the reference draft
 * Based on selected jurisdictions (dynamic superset calculation)
 */
async function handleGetReferenceSections(
  user: any,
  patentId: string,
  data: any
) {
  const { sessionId } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const selectedJurisdictions = (Array.isArray(session.draftingJurisdictions) ? session.draftingJurisdictions : [])
    .filter((j: string) => j && j.toUpperCase() !== 'REFERENCE')

  if (selectedJurisdictions.length === 0) {
    return NextResponse.json({ error: 'No jurisdictions selected' }, { status: 400 })
  }

  // Import and use getReferenceDraftSections
  const { getReferenceDraftSections } = await import('@/lib/multi-jurisdiction-service')
  const referenceSections = await getReferenceDraftSections(selectedJurisdictions)
  const sections = filterDrawingSectionKeys(session, referenceSections.sections)
  const sectionDetails = Object.fromEntries(
    Object.entries(referenceSections.sectionDetails || {}).filter(([key]) => !isDrawingSectionKey(key))
  )

  // Get existing reference draft sections (if any)
  const existingDraft = await prisma.annexureDraft.findFirst({
    where: { sessionId, jurisdiction: 'REFERENCE' },
    orderBy: { version: 'desc' }
  })

  // Build status for each section
  const sectionStatus: Record<string, { generated: boolean; content?: string }> = {}
  const extraSections = (existingDraft?.extraSections as any) || {}
  const rawDraft = extraSections._rawDraft || {}

  for (const sectionKey of sections) {
    // Check if section has content in existing draft
    let content: string | undefined
    
    // Check in raw draft first (for extended sections)
    if (rawDraft[sectionKey]) {
      content = rawDraft[sectionKey]
    }
    // Then check standard fields
      else if (existingDraft) {
      const fieldMap: Record<string, keyof typeof existingDraft> = {
        title: 'title',
        fieldOfInvention: 'fieldOfInvention',
        background: 'background',
        summary: 'summary',
        briefDescriptionOfDrawings: 'briefDescriptionOfDrawings',
        detailedDescription: 'detailedDescription',
        bestMethod: 'bestMethod',
        claims: 'claims',
        abstract: 'abstract',
        industrialApplicability: 'industrialApplicability',
        listOfNumerals: 'listOfNumerals'
      }
      const field = fieldMap[sectionKey]
      if (field && existingDraft[field]) {
        content = existingDraft[field] as string
      }
    }

    sectionStatus[sectionKey] = {
      generated: !!(content && content.trim()),
      content: content || undefined
    }
  }

  return NextResponse.json({
    success: true,
    sections,
    sectionDetails,
    sectionStatus,
    jurisdictions: selectedJurisdictions,
    hasExistingDraft: !!existingDraft
  })
}

/**
 * Generate a SINGLE section of the reference draft
 * Allows section-by-section generation with user approval
 */
async function handleGenerateReferenceSection(
  user: any,
  patentId: string,
  data: any,
  requestHeaders: Record<string, string>
) {
  const { sessionId, sectionKey: rawSectionKey } = data
  const sectionKey = (await normalizeRequestedSectionList([rawSectionKey]))[0] || normalizeSectionKeyLocal(rawSectionKey)

  if (!sessionId || !sectionKey) {
    return NextResponse.json({ error: 'Session ID and sectionKey are required' }, { status: 400 })
  }

  const sessionData = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true,
      diagramSources: true,
      sketchRecords: {
        where: { isDeleted: false, status: 'SUCCESS' }
      }
    }
  })

  if (!sessionData) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  // Get figure sequence metadata
  const sequenceMeta = await prisma.draftingSession.findUnique({
    where: { id: sessionId },
    select: { figureSequence: true, figureSequenceFinalized: true }
  })
  const session = {
    ...sessionData,
    figureSequence: sequenceMeta?.figureSequence ?? (sessionData as any).figureSequence,
    figureSequenceFinalized: sequenceMeta?.figureSequenceFinalized ?? (sessionData as any).figureSequenceFinalized
  }
  const figuresSkipped = areFiguresSkipped(session)
  if (figuresSkipped && isDrawingSectionKey(sectionKey)) {
    return NextResponse.json({
      success: true,
      sectionKey,
      content: '',
      skipped: true,
      allSectionsComplete: false,
      completedCount: 0,
      requiredCount: 0
    })
  }

  const selectedJurisdictions = (Array.isArray(session.draftingJurisdictions) ? session.draftingJurisdictions : [])
    .filter((j: string) => j && j.toUpperCase() !== 'REFERENCE')

  // Get existing sections from current draft (for context)
  const existingDraft = await prisma.annexureDraft.findFirst({
    where: { sessionId, jurisdiction: 'REFERENCE' },
    orderBy: { version: 'desc' }
  })

  let existingSections: Record<string, string> = {}
  if (existingDraft) {
    const extraSections = (existingDraft.extraSections as any) || {}
    const rawDraft = extraSections._rawDraft || {}
    
    // Collect all existing section content
    existingSections = {
      ...(existingDraft.title ? { title: existingDraft.title } : {}),
      ...(existingDraft.fieldOfInvention ? { fieldOfInvention: existingDraft.fieldOfInvention } : {}),
      ...(existingDraft.background ? { background: existingDraft.background } : {}),
      ...(existingDraft.summary ? { summary: existingDraft.summary } : {}),
      ...(!figuresSkipped && existingDraft.briefDescriptionOfDrawings ? { briefDescriptionOfDrawings: existingDraft.briefDescriptionOfDrawings } : {}),
      ...(existingDraft.detailedDescription ? { detailedDescription: existingDraft.detailedDescription } : {}),
      ...(existingDraft.bestMethod ? { bestMethod: existingDraft.bestMethod, bestMode: existingDraft.bestMethod } : {}),
      ...(existingDraft.claims ? { claims: existingDraft.claims } : {}),
      ...(existingDraft.abstract ? { abstract: existingDraft.abstract } : {}),
      ...(existingDraft.industrialApplicability ? { industrialApplicability: existingDraft.industrialApplicability } : {}),
      ...rawDraft
    }
  }

  // Check for frozen claims (for claims section)
  const normalizedData = normalizeClaimsForSession((session.ideaRecord?.normalizedData as any) || {})
  const frozenClaimsSnapshot = getAuthoritativeClaims(normalizedData)
  const frozenClaimsStructured = frozenClaimsSnapshot.structured
  const frozenClaimsHtml = frozenClaimsSnapshot.html
  let frozenClaimsForDraft = ''
  if (Array.isArray(frozenClaimsStructured) && frozenClaimsStructured.length > 0) {
    frozenClaimsForDraft = frozenClaimsStructured.map((c: any) => `${c.number}. ${c.text}`).join('\n\n')
  } else if (frozenClaimsHtml) {
    frozenClaimsForDraft = htmlToPlainText(frozenClaimsHtml)
  }

  if (sectionKey === 'detailedDescription' && frozenClaimsForDraft) {
    try {
      const ddEvidenceResult = await ensureDetailedDescriptionSourceSelection({
        session,
        jurisdiction: 'REFERENCE',
        requestHeaders,
        tenantId: user.tenantId,
      })
      ;(session.ideaRecord as any).normalizedData = ddEvidenceResult.normalizedData
    } catch (error) {
      console.warn('[handleGenerateReferenceSection] DD evidence selection failed:', error)
    }
  }

  // Import and use generateReferenceDraftSection
  const { generateReferenceDraftSection } = await import('@/lib/multi-jurisdiction-service')
  
  const result = await generateReferenceDraftSection(
    session,
    sectionKey,
    selectedJurisdictions,
    existingSections,
    user.tenantId,
    requestHeaders,
    frozenClaimsForDraft || undefined
  )

  if (!result.success || !result.content) {
    return NextResponse.json({ error: result.error || 'Failed to generate section' }, { status: 500 })
  }

  // Update or create reference draft with this section
  const fieldMap: Record<string, string> = {
    title: 'title',
    fieldOfInvention: 'fieldOfInvention',
    background: 'background',
    summary: 'summary',
    briefDescriptionOfDrawings: 'briefDescriptionOfDrawings',
    detailedDescription: 'detailedDescription',
    bestMethod: 'bestMethod',
    claims: 'claims',
    abstract: 'abstract',
    industrialApplicability: 'industrialApplicability',
    listOfNumerals: 'listOfNumerals'
  }

  // Prepare update data
  const updateData: any = {}
  const isStandardField = fieldMap[sectionKey]
  
  if (isStandardField) {
    updateData[fieldMap[sectionKey]] = result.content
  }

  // Update extraSections with the new content
  const currentExtra = existingDraft?.extraSections as any || {}
  const currentRawDraft = currentExtra._rawDraft || {}
  const newRawDraft = { ...currentRawDraft, [sectionKey]: result.content }

  let referenceDraftId: string
  
  if (existingDraft) {
    // Update existing draft
    await prisma.annexureDraft.update({
      where: { id: existingDraft.id },
      data: {
        ...updateData,
        extraSections: {
          ...currentExtra,
          _rawDraft: newRawDraft
        }
      }
    })
    referenceDraftId = existingDraft.id
  } else {
    // Create new draft
    const newDraft = await prisma.annexureDraft.create({
      data: {
        sessionId,
        version: 1,
        jurisdiction: 'REFERENCE',
        ...updateData,
        title: sectionKey === 'title' ? result.content : '',
        fieldOfInvention: '',
        background: '',
        summary: '',
        briefDescriptionOfDrawings: '',
        detailedDescription: '',
        bestMethod: '',
        claims: '',
        abstract: '',
        industrialApplicability: '',
        listOfNumerals: '',
        fullDraftText: '',
        extraSections: {
          _rawDraft: newRawDraft,
          _selectedJurisdictions: selectedJurisdictions
        },
        isValid: false // Not complete yet
      }
    })
    referenceDraftId = newDraft.id
  }

  // Check if all required sections are now complete
  // Get the list of required sections for the selected jurisdictions
  const { getReferenceDraftSections } = await import('@/lib/multi-jurisdiction-service')
  const { sections: rawRequiredSections } = await getReferenceDraftSections(selectedJurisdictions)
  const requiredSections = filterDrawingSectionKeys(session, rawRequiredSections)
  
  // Check if all required sections have content in newRawDraft
  const completedSections = Object.keys(newRawDraft).filter(k => 
    !k.startsWith('_') && newRawDraft[k] && String(newRawDraft[k]).trim()
  )
  
  const allSectionsComplete = requiredSections.every(section => 
    completedSections.includes(section)
  )
  
  console.log(`[generateReferenceSection] Completed: ${completedSections.length}/${requiredSections.length} sections. All complete: ${allSectionsComplete}`)
  console.log(`[generateReferenceSection] Required: ${requiredSections.join(', ')}`)
  console.log(`[generateReferenceSection] Completed: ${completedSections.join(', ')}`)
  
  // If all sections are complete, mark the reference draft as complete
  if (allSectionsComplete) {
    console.log(`[generateReferenceSection] All sections complete! Marking reference draft as complete.`)
    
    // Update the annexure draft to mark it as valid
    await prisma.annexureDraft.update({
      where: { id: referenceDraftId },
      data: { isValid: true }
    })
    
    // Update the session to mark reference draft as complete
    await prisma.draftingSession.update({
      where: { id: sessionId },
      data: {
        referenceDraftComplete: true,
        referenceDraftId: referenceDraftId,
        jurisdictionDraftStatus: {
          ...(session!.jurisdictionDraftStatus as any || {}),
          REFERENCE: {
            status: 'done',
            latestVersion: existingDraft?.version || 1,
            sectionsGenerated: completedSections.length,
            updatedAt: new Date().toISOString()
          }
        }
      }
    })
  }

  return NextResponse.json({
    success: true,
    sectionKey,
    content: result.content,
    allSectionsComplete,
    completedCount: completedSections.length,
    requiredCount: requiredSections.length
  })
}

/**
 * Translate Reference Draft to a target jurisdiction
 * Uses section mapping and temp=0 for consistency
 * Supports language selection for jurisdictions with multiple languages
 */
async function handleTranslateToJurisdiction(
  user: any,
  patentId: string,
  data: any,
  requestHeaders: Record<string, string>
) {
  const { sessionId, targetJurisdiction, targetLanguage } = data

  if (!sessionId || !targetJurisdiction) {
    return NextResponse.json({ error: 'Session ID and target jurisdiction required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      annexureDrafts: { orderBy: { version: 'desc' } },
      ideaRecord: true
    }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }
  const figuresSkipped = areFiguresSkipped(session)

  // Verify reference draft exists
  if (!session.referenceDraftComplete || !session.referenceDraftId) {
    return NextResponse.json({ error: 'Reference draft must be generated first' }, { status: 400 })
  }

  // Get reference draft
  const referenceDraft = await prisma.annexureDraft.findUnique({
    where: { id: session.referenceDraftId }
  })

  if (!referenceDraft) {
    return NextResponse.json({ error: 'Reference draft not found' }, { status: 404 })
  }
  const normalizedData = normalizeClaimsForSession((session.ideaRecord?.normalizedData as any) || {})
  const finalClaimsText = normalizedData.claimsFinal || normalizedData.claimsProvisional || normalizedData.claims || referenceDraft.claims || ''

  // Resolve target language - from request, session status, or profile default
  const targetCode = targetJurisdiction.toUpperCase()
  let resolvedLanguage = targetLanguage
  if (!resolvedLanguage) {
    // Try to get from session's jurisdiction draft status
    const jurisdictionStatus = (session!.jurisdictionDraftStatus as any)?.[targetCode]
    resolvedLanguage = jurisdictionStatus?.language
  }
  // Language will be further resolved by translateReferenceDraft if still undefined

  // Extract raw draft from extra sections - include all superset sections
  const extraSections = referenceDraft.extraSections as any || {}
  const rawDraft = extraSections._rawDraft || {
    // Core sections from AnnexureDraft fields
    title: referenceDraft.title,
    fieldOfInvention: referenceDraft.fieldOfInvention,
    background: referenceDraft.background,
    summary: referenceDraft.summary,
    briefDescriptionOfDrawings: referenceDraft.briefDescriptionOfDrawings,
    detailedDescription: referenceDraft.detailedDescription,
    bestMethod: referenceDraft.bestMethod, // Canonical key
    bestMode: referenceDraft.bestMethod, // Backward-compatible alias for older reference drafts/prompts
    claims: finalClaimsText,
    abstract: referenceDraft.abstract,
    industrialApplicability: referenceDraft.industrialApplicability,
    // Extended superset sections from extraSections
    preamble: extraSections.preamble || '',
    crossReference: extraSections.crossReference || '', // Cross-reference to related applications
    objectsOfInvention: extraSections.objectsOfInvention || '',
    technicalProblem: extraSections.technicalProblem || '',
    technicalSolution: extraSections.technicalSolution || '',
    advantageousEffects: extraSections.advantageousEffects || '',
    // Additional optional superset sections (EP/DE)
    listOfNumerals: extraSections.listOfNumerals || referenceDraft.listOfNumerals || ''
  }
  if (figuresSkipped) {
    delete (rawDraft as Record<string, any>).briefDescriptionOfDrawings
  }

  // Translate to target jurisdiction with language support
  const result = await translateReferenceDraft(rawDraft, targetCode, resolvedLanguage, user.tenantId, requestHeaders)

  if (!result.success || !result.draft) {
    return NextResponse.json({ 
      error: 'Translation failed',
      details: result.errors 
    }, { status: 500 })
  }

  // Validate the translated draft
  if (figuresSkipped) {
    delete (result.draft as Record<string, any>).briefDescriptionOfDrawings
  }
  const validationIssues = await validateDraft(result.draft, targetCode)
  const hasErrors = validationIssues.some(i => i.type === 'error')

  // Build full text
  const fullDraftText = Object.entries(result.draft)
    .filter(([key]) => !figuresSkipped || !isDrawingSectionKey(key))
    .map(([key, value]) => `## ${key}\n\n${value}`)
    .join('\n\n---\n\n')

  // Get section mapping for proper field assignment
  const mappings = await getSectionMapping(targetCode)
  const mappedDraft: Record<string, string> = {}
  for (const m of mappings) {
    mappedDraft[m.countryKey] = result.draft[m.countryKey] || ''
  }

  // Store translated draft
  const lastDraft = await prisma.annexureDraft.findFirst({
    where: { sessionId, jurisdiction: targetCode },
    orderBy: { version: 'desc' }
  })
  const version = (lastDraft?.version || 0) + 1

  const translatedDraft = await prisma.annexureDraft.create({
    data: {
      sessionId,
      version,
      jurisdiction: targetCode,
      title: mappedDraft.title || result.draft.title || '',
      fieldOfInvention: mappedDraft.fieldOfInvention || mappedDraft.field || result.draft.field || '',
      background: mappedDraft.background || result.draft.background || '',
      summary: mappedDraft.summary || result.draft.summary || '',
      briefDescriptionOfDrawings: figuresSkipped ? '' : (mappedDraft.briefDescriptionOfDrawings || result.draft.briefDescriptionOfDrawings || ''),
      detailedDescription: mappedDraft.detailedDescription || result.draft.detailedDescription || '',
      bestMethod: mappedDraft.bestMethod || result.draft.bestMethod || '',
      claims: mappedDraft.claims || result.draft.claims || '',
      abstract: mappedDraft.abstract || result.draft.abstract || '',
      industrialApplicability: mappedDraft.industrialApplicability || result.draft.industrialApplicability || '',
      listOfNumerals: mappedDraft.listOfNumerals || '',
      fullDraftText,
      extraSections: {
        ...result.draft,
        _translatedFrom: 'REFERENCE',
        _translationErrors: result.errors,
        _language: result.language || resolvedLanguage // Store the language used for this draft
      },
      isValid: !hasErrors,
      validationReport: {
        issues: validationIssues as any,
        hasErrors,
        checkedAt: new Date().toISOString()
      }
    }
  })

  // Update session status with language used
  const usedLanguage = result.language || resolvedLanguage
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      jurisdictionDraftStatus: {
        ...(session!.jurisdictionDraftStatus as any || {}),
        [targetCode]: {
          status: hasErrors ? 'needs_review' : 'done',
          latestVersion: version,
          translatedFrom: 'REFERENCE',
          language: usedLanguage, // Persist the language used
          updatedAt: new Date().toISOString()
        }
      }
    }
  })

  return NextResponse.json({
    success: true,
    draft: result.draft,
    draftId: translatedDraft.id,
    version,
    jurisdiction: targetCode,
    language: usedLanguage, // Return the language used
    validation: {
      issues: validationIssues,
      hasErrors
    },
    errors: result.errors,
    warning: result.warning, // Include fallback warning if applicable
    stats: result.stats // Include translation stats for debugging
  })
}

/**
 * Validate a draft against jurisdiction-specific rules
 */
async function handleValidateDraft(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction, draft } = data

  if (!sessionId || !jurisdiction) {
    return NextResponse.json({ error: 'Session ID and jurisdiction required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  // Get draft to validate
  let draftToValidate: Record<string, string> = draft || {}
  
  // If no draft provided, get latest from database
  if (!draft || Object.keys(draft).length === 0) {
    const latestDraft = await prisma.annexureDraft.findFirst({
      where: { sessionId, jurisdiction: jurisdiction.toUpperCase() },
      orderBy: { version: 'desc' }
    })
    
    if (latestDraft) {
      draftToValidate = {
        title: latestDraft.title || '',
        fieldOfInvention: latestDraft.fieldOfInvention || '',
        background: latestDraft.background || '',
        summary: latestDraft.summary || '',
        briefDescriptionOfDrawings: latestDraft.briefDescriptionOfDrawings || '',
        detailedDescription: latestDraft.detailedDescription || '',
        bestMethod: latestDraft.bestMethod || '',
        claims: latestDraft.claims || '',
        abstract: latestDraft.abstract || '',
        industrialApplicability: latestDraft.industrialApplicability || '',
        ...(latestDraft.extraSections as Record<string, string> || {})
      }
    }
  }

  const figuresSkipped = areFiguresSkipped(session)
  const draftForValidation = { ...draftToValidate }
  if (figuresSkipped) {
    delete draftForValidation.briefDescriptionOfDrawings
  }

  // Run validation
  const issues = await validateDraft(draftForValidation, jurisdiction.toUpperCase())
  if (figuresSkipped) {
    const disabledFigureRef = /\b(?:FIG\.?\s*\d+|Figure\s+\d+|drawings?|diagrams?|sketches?)\b/i
    for (const [sectionKey, content] of Object.entries(draftToValidate)) {
      if (sectionKey === 'briefDescriptionOfDrawings') continue
      if (disabledFigureRef.test(String(content || ''))) {
        issues.push({
          sectionKey,
          type: 'error',
          rule: 'figurelessReferences',
          message: 'Figureless draft mode is enabled, but this section references figures, drawings, diagrams, or sketches.'
        })
      }
    }
  }
  
  return NextResponse.json({
    success: true,
    jurisdiction: jurisdiction.toUpperCase(),
    issues,
    hasErrors: issues.some(i => i.type === 'error'),
    hasWarnings: issues.some(i => i.type === 'warning'),
    checkedAt: new Date().toISOString()
  })
}

// ============================================================================
// AI Review Handlers
// ============================================================================

import { runAIReview, buildFixPrompt, type AIReviewIssue, type FixContext } from '@/lib/ai-review-service'
import { filterProtectedAIReviewIssues, isProtectedAIReviewIssue } from '@/lib/ai-review-protection'

/**
 * Run comprehensive AI review on draft
 * Analyzes cross-section consistency, diagram alignment, claims support
 * NOTE: This is a premium feature - requires PATENT_REVIEW service access (Pro tier)
 */
async function handleRunAIReview(
  user: any,
  patentId: string,
  data: any,
  requestHeaders: Record<string, string>
) {
  const { sessionId, jurisdiction, draft: providedDraft } = data

  if (!sessionId || !jurisdiction) {
    return NextResponse.json({ error: 'Session ID and jurisdiction required' }, { status: 400 })
  }

  // Check if user has access to PATENT_REVIEW service (Pro tier feature)
  if (user.tenantId) {
    const serviceCheck = await enforceServiceAccess(
      user.id,
      user.tenantId,
      'PATENT_REVIEW'
    )
    if (!serviceCheck.allowed) {
      return NextResponse.json({
        error: 'AI Review is a Pro feature',
        reason: serviceCheck.response?.statusText || 'Upgrade to Pro plan to access AI-powered patent review',
        code: 'SERVICE_ACCESS_DENIED',
        upgradeRequired: true
      }, { status: 403 })
    }
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true,
      diagramSources: true,
      sketchRecords: true, // Include sketches for AI review context
      annexureDrafts: { orderBy: { version: 'desc' } }
    }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }
  const figuresSkipped = areFiguresSkipped(session)

  const code = jurisdiction.toUpperCase()

  // Get draft content - prefer provided, then latest from DB
  let draftContent: Record<string, string> = providedDraft || {}
  
  if (!providedDraft || Object.keys(providedDraft).length === 0) {
    const latestDraft = session.annexureDrafts.find(
      (d: any) => (d.jurisdiction || '').toUpperCase() === code
    )
    
    if (latestDraft) {
      draftContent = {
        title: latestDraft.title || '',
        fieldOfInvention: latestDraft.fieldOfInvention || '',
        background: latestDraft.background || '',
        summary: latestDraft.summary || '',
        briefDescriptionOfDrawings: latestDraft.briefDescriptionOfDrawings || '',
        detailedDescription: latestDraft.detailedDescription || '',
        bestMethod: latestDraft.bestMethod || '',
        claims: latestDraft.claims || '',
        abstract: latestDraft.abstract || '',
        industrialApplicability: latestDraft.industrialApplicability || '',
        ...(latestDraft.extraSections as Record<string, string> || {})
      }
    }
  }

  if (Object.keys(draftContent).length === 0) {
    return NextResponse.json({ error: 'No draft content available for review' }, { status: 400 })
  }
  if (figuresSkipped) {
    draftContent = {
      ...draftContent,
      briefDescriptionOfDrawings: ''
    }
  }

  // ============================================================================
  // BUILD FIGURES IN USER-ARRANGED SEQUENCE ORDER
  // The figureSequence contains the user's preferred order of diagrams + sketches
  // ============================================================================
  const figureSequence = figuresSkipped ? [] : (session.figureSequence as any[] || [])
  const figurePlans = figuresSkipped ? [] : (session!.figurePlans || [])
  const diagramSources = figuresSkipped ? [] : (session!.diagramSources || [])
  const sketchRecords: SessionSketchRecord[] = figuresSkipped ? [] : ((session as any).sketchRecords || []).filter((s: any) => s.status === 'SUCCESS' && !s.isDeleted)

  // Build maps for quick lookup
  const figurePlanMap = new Map(figurePlans.map((fp: any) => [fp.id, fp]))
  const diagramSourceMap = new Map(diagramSources.map((ds: any) => [ds.figureNo, ds]))
  const sketchMap = new Map<string, SessionSketchRecord>(sketchRecords.map((sr) => [sr.id, sr]))
  
  // Build figures array in user-arranged sequence order
  const figures: Array<{ figureNo: number; title: string; plantuml: string }> = []
  const sketches: Array<{ figureNo: number; title: string; description: string; isIncluded: boolean }> = []
  
  if (figureSequence.length > 0) {
    // Use user-arranged sequence
    figureSequence.forEach((seqItem: any) => {
      const finalFigNo = seqItem.finalFigNo || seqItem.figureNo || 0
      
      if (seqItem.type === 'diagram') {
        // Find the diagram source by sourceId (which is the figurePlan id)
        const figurePlan = figurePlanMap.get(seqItem.sourceId)
        if (figurePlan) {
          const diagramSource = diagramSourceMap.get(figurePlan.figureNo)
          if (diagramSource?.plantumlCode) {
            figures.push({
              figureNo: finalFigNo,
              title: figurePlan.title || `Figure ${finalFigNo}`,
              plantuml: diagramSource.plantumlCode
            })
          }
        }
      } else if (seqItem.type === 'sketch') {
        // Find the sketch by sourceId
        const sketch = sketchMap.get(seqItem.sourceId)
        if (sketch) {
          // Sketches don't have PlantUML - include as sketch context for AI
          sketches.push({
            figureNo: finalFigNo,
            title: sketch.title || `Sketch ${finalFigNo}`,
            description: sketch.description || sketch.title || '',
            isIncluded: true // It's in the sequence, so it's included
          })
        }
      }
    })
  } else {
    // Fallback: No sequence set - use diagrams in their original order
    figurePlans.forEach((plan: any) => {
      const source = diagramSourceMap.get(plan.figureNo)
      if (source?.plantumlCode) {
        figures.push({
          figureNo: plan.figureNo,
          title: plan.title || `Figure ${plan.figureNo}`,
          plantuml: source.plantumlCode
        })
      }
    })
    
    // Include sketches without sequence info
    sketchRecords.forEach((sr: any, idx: number) => {
      sketches.push({
        figureNo: figurePlans.length + idx + 1, // After diagrams
        title: sr.title || `Sketch ${idx + 1}`,
        description: sr.description || sr.instructions || sr.title || '',
        isIncluded: true
      })
    })
  }
  
  console.log(`[AI Review] Figures: ${figures.length} diagrams (with PlantUML), ${sketches.length} sketches (metadata only)`)

  // Get components from reference map
  const referenceMapData = session.referenceMap as any
  const componentsRaw = extractComponentsArray(referenceMapData)
  const components = componentsRaw.map((c: any) => ({
    name: c.name || '',
    numeral: c.referenceLabel || c.numeral || '' // Use referenceLabel for universal support (100/200, S100/S200, (a)/(b))
  }))
  const numberingStyle =
    (referenceMapData?.components as any)?.numberingStyle ||
    (referenceMapData as any)?.numberingStyle ||
    null
  const patentTypePrimary = (session as any)?.patentTypePrimary || null

  // Get invention title
  // Prefer the AI-generated draft title; fall back to the original idea title
  const inventionTitle = draftContent.title || (session.ideaRecord as any)?.title || ''

  // Fetch section validation limits from database (skip for REFERENCE which has no country-specific limits)
  let sectionLimits: any[] = []
  let crossValidations: any[] = []
  
  if (code !== 'REFERENCE') {
    try {
      // Get section limits from CountrySectionValidation
      const validationRules = await prisma.countrySectionValidation.findMany({
        where: {
          countryCode: code,
          status: 'ACTIVE'
        }
      })
      
      sectionLimits = validationRules.map((r: any) => ({
        sectionKey: r.sectionKey,
        maxWords: r.maxWords,
        minWords: r.minWords,
        recommendedWords: r.recommendedWords,
        maxChars: r.maxChars,
        maxCount: r.maxCount,
        maxIndependent: r.maxIndependent,
        wordLimitMessage: r.wordLimitMessage,
        charLimitMessage: r.charLimitMessage,
        legalReference: r.legalReference
      })).filter((r: any) => r.maxWords || r.maxChars || r.maxCount || r.maxIndependent)
      
      // Get cross-validation rules from CountryCrossValidation
      const crossRules = await prisma.countryCrossValidation.findMany({
        where: {
          countryCode: code,
          isEnabled: true
        }
      })
      
      crossValidations = crossRules.map((r: any) => ({
        ruleKey: r.ruleKey,
        sourceSection: r.sourceSection,
        targetSection: r.targetSection,
        ruleName: r.ruleName,
        description: r.description,
        severity: r.severity,
        validationLogic: r.validationLogic
      }))
    } catch (err) {
      // Non-critical: If validation rules can't be fetched, proceed with AI review without them
      console.warn(`[AI Review] Could not fetch validation rules for ${code}:`, err)
    }
  }

  // Run AI review with full context
  const reviewResult = await runAIReview(
    {
      draft: draftContent,
      figuresSkipped,
      figures,
      sketches,
      jurisdiction: code,
      inventionTitle,
      components,
      sectionLimits,
      crossValidations,
      numberingStyle,
      patentTypePrimary
    },
    user.tenantId,
    requestHeaders
  )

  // Get the latest draft ID for linking
  const latestDraft = session.annexureDrafts.find(
    (d: any) => (d.jurisdiction || '').toUpperCase() === code
  )

  // Persist the full review result to database
  const savedReview = await prisma.aIReviewResult.create({
    data: {
      sessionId,
      draftId: latestDraft?.id || null,
      jurisdiction: code,
      issues: reviewResult.issues as any || [],
      summary: reviewResult.summary || {},
      tokensUsed: reviewResult.tokensUsed,
      reviewedAt: new Date(reviewResult.reviewedAt)
    }
  })

  // Also update session status for quick reference
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      jurisdictionDraftStatus: {
        ...(session!.jurisdictionDraftStatus as any || {}),
        [code]: {
          ...(session!.jurisdictionDraftStatus as any)?.[code],
          lastAIReview: {
            reviewId: savedReview.id,
            reviewedAt: reviewResult.reviewedAt,
            issueCount: reviewResult.summary.totalIssues,
            overallScore: reviewResult.summary.overallScore
          }
        }
      }
    }
  })

  return NextResponse.json({
    reviewId: savedReview.id,
    ...reviewResult
  })
}

// ============================================================================
// Post-Fix Validation
// ============================================================================

interface FixValidationResult {
  hasProblems: boolean
  problems: Array<{
    type: 'error' | 'warning'
    code: string
    message: string
  }>
  metrics: {
    originalWordCount: number
    fixedWordCount: number
    changeRatio: number
  }
}

/**
 * Lightweight validation - only catches critical issues that would break the draft
 * Keeps checks minimal to avoid overwhelming users with warnings
 */
async function validateFixedContent(
  originalContent: string,
  fixedContent: string,
  sectionKey: string,
  jurisdiction: string,
  issue: any
): Promise<FixValidationResult> {
  const problems: FixValidationResult['problems'] = []
  
  const originalWords = originalContent.trim().split(/\s+/).filter(w => w.length > 0).length
  const fixedWords = fixedContent.trim().split(/\s+/).filter(w => w.length > 0).length
  const changeRatio = originalWords > 0 ? Math.abs(fixedWords - originalWords) / originalWords : 0
  
  // Only check for critical issues that would truly break the draft
  
  // 1. Empty content - this is a real problem that needs attention
  if (!fixedContent || fixedContent.trim().length < 10) {
    problems.push({
      type: 'error',
      code: 'EMPTY_CONTENT',
      message: 'Fix resulted in empty content. Please try again.'
    })
  }
  
  return {
    hasProblems: problems.length > 0,
    problems,
    metrics: {
      originalWordCount: originalWords,
      fixedWordCount: fixedWords,
      changeRatio
    }
  }
}

/**
 * Apply an AI-suggested fix to a section
 * Regenerates the section with the fix prompt
 * NOTE: This is a premium feature - requires PATENT_REVIEW service access (Pro tier)
 */
async function handleApplyAIFix(
  user: any,
  patentId: string,
  data: any,
  requestHeaders: Record<string, string>
) {
  const { sessionId, jurisdiction, sectionKey, issue, currentContent, relatedContent } = data

  if (!sessionId || !jurisdiction || !sectionKey || !issue) {
    return NextResponse.json({ 
      error: 'Session ID, jurisdiction, section key, and issue are required' 
    }, { status: 400 })
  }

  // Check if user has access to PATENT_REVIEW service (Pro tier feature)
  if (user.tenantId) {
    const serviceCheck = await enforceServiceAccess(
      user.id,
      user.tenantId,
      'PATENT_REVIEW'
    )
    if (!serviceCheck.allowed) {
      return NextResponse.json({
        error: 'AI Review Fix is a Pro feature',
        reason: 'Upgrade to Pro plan to apply AI-suggested fixes',
        code: 'SERVICE_ACCESS_DENIED',
        upgradeRequired: true
      }, { status: 403 })
    }
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { 
      annexureDrafts: { orderBy: { version: 'desc' } },
      diagramSources: true // Include diagram sources
    }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }
  const figuresSkipped = areFiguresSkipped(session)
  if (figuresSkipped && isDrawingSectionKey(sectionKey)) {
    return NextResponse.json({
      error: 'Drawing sections are disabled for this figureless draft.'
    }, { status: 400 })
  }

  const code = jurisdiction.toUpperCase()

  // Get current section content if not provided
  let content = currentContent
  if (!content) {
    const latestDraft = session.annexureDrafts.find(
      (d: any) => (d.jurisdiction || '').toUpperCase() === code
    )
    if (latestDraft) {
      content = (latestDraft as any)[sectionKey] || 
        (latestDraft.extraSections as any)?.[sectionKey] || ''
    }
  }

  if (!content) {
    return NextResponse.json({ error: 'No content found for section' }, { status: 400 })
  }

  // Extract figures (PlantUML) from diagram sources
  const figures = figuresSkipped ? [] : (session!.diagramSources || []).map((ds: any) => ({
    figureNo: ds.figureNo,
    title: `Figure ${ds.figureNo}`,
    plantuml: ds.plantumlCode || ''
  })).filter((f: any) => f.plantuml)

  // Extract components from reference map
  const referenceMap = (session as any).referenceMap || {}
  const components = extractComponentsArray(referenceMap)
    .map((c: any) => ({
      name: c.name || c.label || '',
      // Use referenceLabel (universal format: 100/200, S100/S200, (a)/(b)) with fallbacks
      numeral: String(c.referenceLabel || c.numeral || c.referenceNumeral || '')
    }))
    .filter((c: any) => c.name && c.numeral)
  const numberingStyle =
    (referenceMap as any)?.components?.numberingStyle ||
    (referenceMap as any)?.numberingStyle ||
    null

  // Normalize issue object - extract fixPrompt from metadata if not directly available
  // This handles both original AIReviewIssue format and converted ValidationIssue format
  const normalizedIssue: AIReviewIssue = {
    ...issue,
    category: (issue as any).category || 'general', // Preserve category if it exists, default to 'general'
    fixPrompt: issue.fixPrompt || (issue.metadata as any)?.fixPrompt || issue.suggestedFix || '',
    sectionKey: issue.sectionKey || (issue.metadata as any)?.sectionKey || sectionKey,
    sectionLabel: issue.sectionLabel || (issue.metadata as any)?.sectionLabel || sectionKey,
    title: issue.title || (issue.metadata as any)?.title || 'Issue',
    description: issue.description || (issue.metadata as any)?.description || '',
    suggestion: issue.suggestion || (issue.metadata as any)?.suggestion || issue.suggestedFix || '',
    severity: issue.severity || (issue.metadata as any)?.originalSeverity || 3
  }

  if (isProtectedAIReviewIssue(normalizedIssue)) {
    return NextResponse.json({
      error: 'This AI review item targets frozen claims or approved diagram assets and cannot be applied automatically.'
    }, { status: 400 })
  }

  // Build the fix prompt with full context including diagrams
  const fixPrompt = buildFixPrompt(content, normalizedIssue, {
    relatedContent,
    figures: !figuresSkipped && normalizedIssue.category === 'diagram' ? figures : undefined, // Only include diagrams for diagram-related issues
    figuresSkipped,
    components,
    numberingStyle
  })

  // Use LLM to regenerate the section with the fix via admin-configured stage
  const result = await llmGateway.executeLLMOperation(
    { headers: requestHeaders || {} },
    {
      taskCode: 'LLM2_DRAFT',
      stageCode: 'DRAFT_REVIEW', // Use admin-configured model/limits for AI fixes
      prompt: fixPrompt,
      parameters: {
        tenantId: user.tenantId,
        jurisdiction: code,
        temperature: 0.2, // Low temperature for focused fixes
        purpose: 'apply_ai_fix'
      },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        patentId,
        sessionId,
        sectionKey,
        issueId: issue.id,
        purpose: 'apply_ai_fix'
      }
    }
  )

  if (!result.success || !result.response) {
    return NextResponse.json({ 
      error: result.error?.message || 'Failed to apply fix' 
    }, { status: 500 })
  }

  // Clean up response
  let fixedContent = (result.response.output || '').trim()
  fixedContent = fixedContent.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '')
  
  // ============================================================================
  // POST-FIX VALIDATION - Verify the fix didn't break anything
  // ============================================================================
  const fixValidation = await validateFixedContent(
    content, 
    fixedContent, 
    sectionKey, 
    code,
    normalizedIssue
  )
  
  // If fix validation found critical issues, warn the user
  if (fixValidation.hasProblems) {
    console.warn(`[ApplyAIFix] Fix validation found problems for ${sectionKey}:`, fixValidation.problems)
  }

  // Compute diff data for micro-versioning
  const diffData = computeTextDiff(content, fixedContent)

  // Track the applied fix in the latest review with full history
  const latestReview = await prisma.aIReviewResult.findFirst({
    where: { sessionId, jurisdiction: code },
    orderBy: { reviewedAt: 'desc' }
  })

  const fixHistoryEntry = {
    id: `fix-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    issueId: issue.id,
    sectionKey,
    timestamp: new Date().toISOString(),
    status: 'fixed' as const,
    changeSummary: issue.title || 'Applied AI fix',
    beforeText: content,
    afterText: fixedContent,
    diffData,
    issueCode: issue.issueCode || issue.code,
    issueSeverity: issue.severity
  }

  if (latestReview) {
    const existingFixes = Array.isArray(latestReview.appliedFixes) ? latestReview.appliedFixes : []
    
    // Update issues array to mark this issue as fixed
    const existingIssues = Array.isArray(latestReview.issues) ? latestReview.issues : []
    const updatedIssues = existingIssues.map((i: any) => 
      i.id === issue.id ? { ...i, status: 'fixed', resolvedAt: new Date().toISOString(), resolvedBy: 'fix' } : i
    )
    
    // Recalculate score based on remaining active issues (not fixed, not ignored)
    const activeIssues = updatedIssues.filter((i: any) => i.status !== 'fixed' && i.status !== 'ignored')
    const totalIssuesCount = updatedIssues.length
    const resolvedCount = totalIssuesCount - activeIssues.length
    const errors = activeIssues.filter((i: any) => i.type === 'error' || i.t === 'E').length
    const warnings = activeIssues.filter((i: any) => i.type === 'warning' || i.t === 'W').length
    const suggestions = activeIssues.filter((i: any) => i.type === 'suggestion' || i.t === 'S').length
    
    // Adaptive scoring: 85-90 with issues, scales to 100 as issues are fixed
    // Base score varies by severity (85-90 range), then scales to 100 based on resolution progress
    const FLOOR_SCORE = 85
    const CEILING_WITH_ISSUES = 90
    const PERFECT_SCORE = 100
    
    let newScore: number
    if (activeIssues.length === 0) {
      // All issues resolved - perfect score
      newScore = PERFECT_SCORE
    } else {
      // Calculate severity-based base score (85-90)
      const severityWeight = errors * 3 + warnings * 2 + suggestions * 1
      const maxSeverityWeight = 15
      const qualityFactor = Math.max(0, 1 - (severityWeight / maxSeverityWeight))
      const baseScore = FLOOR_SCORE + (qualityFactor * (CEILING_WITH_ISSUES - FLOOR_SCORE))
      
      // Scale towards 100 based on resolution progress
      const resolvedRatio = totalIssuesCount > 0 ? resolvedCount / totalIssuesCount : 0
      newScore = Math.round(baseScore + ((PERFECT_SCORE - baseScore) * resolvedRatio))
      newScore = Math.max(FLOOR_SCORE, Math.min(PERFECT_SCORE - 1, newScore)) // Cap at 99 if issues remain
    }
    
    // Build updated summary with recalculated score
    const existingSummary = (latestReview.summary as any) || {}
    const updatedSummary = {
      ...existingSummary,
      totalIssues: activeIssues.length,
      errors,
      warnings,
      suggestions,
      overallScore: newScore,
      recommendation: activeIssues.length === 0 
        ? 'All issues resolved! Draft is ready for export.'
        : errors > 0 
          ? `Found ${errors} error(s) that should be fixed before filing.`
          : warnings > 0
            ? `Found ${warnings} warning(s). Review recommended before export.`
            : 'Draft looks good! Ready for export.'
    }
    
    await prisma.aIReviewResult.update({
      where: { id: latestReview.id },
      data: {
        issues: updatedIssues,
        summary: updatedSummary,
        appliedFixes: [
          ...existingFixes,
          fixHistoryEntry
        ]
      }
    })
  }

  return NextResponse.json({
    success: true,
    sectionKey,
    originalContent: content,
    fixedContent,
    diffData,
    fixHistoryEntry,
    issue: { ...issue, status: 'fixed' },
    tokensUsed: result.response.outputTokens,
    // Include validation only if there's a critical problem
    validation: fixValidation.hasProblems ? fixValidation : undefined
  })
}

/**
 * Compute text diff for before/after comparison
 * Handles empty strings and patent-specific patterns (numerals, figures)
 */
function computeTextDiff(before: string, after: string) {
  // Handle edge cases
  if (!before && !after) {
    return {
      beforeText: '',
      afterText: '',
      segments: [],
      summary: 'No changes'
    }
  }
  
  if (before === after) {
    return {
      beforeText: before,
      afterText: after,
      segments: [{ type: 'unchanged' as const, text: after }],
      summary: 'No changes'
    }
  }
  
  if (!before) {
    return {
      beforeText: '',
      afterText: after,
      segments: [{ type: 'addition' as const, text: after }],
      summary: `Added ${after.split(/\s+/).filter(Boolean).length} words`
    }
  }
  
  if (!after) {
    return {
      beforeText: before,
      afterText: '',
      segments: [{ type: 'deletion' as const, text: before }],
      summary: `Removed ${before.split(/\s+/).filter(Boolean).length} words`
    }
  }

  // Tokenize preserving patent patterns like (100), Fig. 1, etc.
  // Split on whitespace but keep the whitespace tokens for reconstruction
  const tokenize = (text: string) => text.split(/(\s+)/).filter(t => t.length > 0)
  
  const beforeTokens = tokenize(before)
  const afterTokens = tokenize(after)
  
  // Simple diff computation using LCS
  const segments: Array<{ type: 'addition' | 'deletion' | 'unchanged'; text: string }> = []
  let addedCount = 0
  let removedCount = 0
  
  const m = beforeTokens.length
  const n = afterTokens.length
  
  // Limit diff computation for very large texts (performance safeguard)
  if (m * n > 1000000) {
    // Fallback: show as full replacement for very large diffs
    return {
      beforeText: before,
      afterText: after,
      segments: [
        { type: 'deletion' as const, text: before.substring(0, 500) + (before.length > 500 ? '...' : '') },
        { type: 'addition' as const, text: after.substring(0, 500) + (after.length > 500 ? '...' : '') }
      ],
      summary: 'Large text replacement (diff truncated)'
    }
  }
  
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (beforeTokens[i - 1] === afterTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  
  // Backtrack to build segments
  let i = m, j = n
  const tempSegments: typeof segments = []
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeTokens[i - 1] === afterTokens[j - 1]) {
      tempSegments.unshift({ type: 'unchanged', text: beforeTokens[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      tempSegments.unshift({ type: 'addition', text: afterTokens[j - 1] })
      // Only count non-whitespace as "words"
      if (afterTokens[j - 1].trim()) addedCount++
      j--
    } else if (i > 0) {
      tempSegments.unshift({ type: 'deletion', text: beforeTokens[i - 1] })
      if (beforeTokens[i - 1].trim()) removedCount++
      i--
    }
  }
  
  // Merge adjacent segments of the same type for cleaner output
  const mergedSegments: typeof segments = []
  for (const seg of tempSegments) {
    const last = mergedSegments[mergedSegments.length - 1]
    if (last && last.type === seg.type) {
      last.text += seg.text
    } else {
      mergedSegments.push({ ...seg })
    }
  }
  
  return {
    beforeText: before,
    afterText: after,
    segments: mergedSegments,
    summary: addedCount === 0 && removedCount === 0 
      ? 'Minor formatting changes' 
      : `Added ${addedCount} words, removed ${removedCount} words`
  }
}

/**
 * Get existing AI reviews for a session/jurisdiction
 */
async function handleGetAIReviews(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  // Build query
  const whereClause: any = { sessionId }
  if (jurisdiction) {
    whereClause.jurisdiction = jurisdiction.toUpperCase()
  }

  // Get reviews with most recent first
  const reviews = await prisma.aIReviewResult.findMany({
    where: whereClause,
    orderBy: { reviewedAt: 'desc' },
    take: 10 // Limit to last 10 reviews per jurisdiction
  })
  const sanitizedReviews = reviews.map((review: any) => {
    const issues = Array.isArray(review.issues) ? filterProtectedAIReviewIssues(review.issues as any[]) : []
    const errors = issues.filter((i: any) => i.type === 'error' || i.t === 'E').length
    const warnings = issues.filter((i: any) => i.type === 'warning' || i.t === 'W').length
    const suggestions = issues.filter((i: any) => i.type === 'suggestion' || i.t === 'S').length
    const summary = {
      ...((review.summary as any) || {}),
      totalIssues: issues.length,
      errors,
      warnings,
      suggestions,
      overallScore: issues.length === 0 ? 100 : ((review.summary as any)?.overallScore || 85),
      recommendation: issues.length === 0
        ? 'Draft looks good! Ready for export.'
        : ((review.summary as any)?.recommendation || 'Review completed.')
    }
    return { ...review, issues, summary }
  })

  // Get the latest review for each jurisdiction
  const latestByJurisdiction: Record<string, any> = {}
  for (const review of sanitizedReviews) {
    if (!latestByJurisdiction[review.jurisdiction]) {
      latestByJurisdiction[review.jurisdiction] = review
    }
  }

  return NextResponse.json({
    success: true,
    reviews: sanitizedReviews,
    latest: latestByJurisdiction,
    count: sanitizedReviews.length
  })
}

/**
 * Mark an AI issue as ignored
 */
async function handleIgnoreAIIssue(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction, issueId, reviewId } = data

  if (!sessionId || !jurisdiction || !issueId) {
    return NextResponse.json({ 
      error: 'Session ID, jurisdiction, and issue ID required' 
    }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const code = jurisdiction.toUpperCase()

  // Find the review to update
  let review
  if (reviewId) {
    review = await prisma.aIReviewResult.findUnique({ where: { id: reviewId } })
  } else {
    review = await prisma.aIReviewResult.findFirst({
      where: { sessionId, jurisdiction: code },
      orderBy: { reviewedAt: 'desc' }
    })
  }

  if (!review) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  }

  // Validate the issue exists in this review
  const issues = Array.isArray(review.issues) ? (review.issues as any[]) : []
  const targetIssue = issues.find((i: any) => i.id === issueId) as { id: string; status?: string } | undefined
  
  if (!targetIssue) {
    return NextResponse.json({ error: 'Issue not found in this review' }, { status: 404 })
  }

  // Check if already ignored or fixed
  if (targetIssue.status === 'ignored') {
    return NextResponse.json({ 
      success: true, 
      message: 'Issue is already ignored',
      reviewId: review.id 
    })
  }
  
  if (targetIssue.status === 'fixed') {
    return NextResponse.json({ 
      error: 'Cannot ignore a fixed issue. Revert the fix first if needed.' 
    }, { status: 400 })
  }

  // Add to ignored issues and update issue status
  const existingIgnored = Array.isArray(review.ignoredIssues) ? (review.ignoredIssues as string[]) : []
  
  // Update the issue status to 'ignored'
  const updatedIssues = issues.map((i: any) => 
    i.id === issueId 
      ? { ...i, status: 'ignored', resolvedAt: new Date().toISOString(), resolvedBy: 'ignore' } 
      : i
  )
  
  // Recalculate score based on remaining active issues (not fixed, not ignored)
  const activeIssues = updatedIssues.filter((i: any) => i.status !== 'fixed' && i.status !== 'ignored')
  const totalIssuesCount = updatedIssues.length
  const resolvedCount = totalIssuesCount - activeIssues.length
  const errors = activeIssues.filter((i: any) => i.type === 'error' || i.t === 'E').length
  const warnings = activeIssues.filter((i: any) => i.type === 'warning' || i.t === 'W').length
  const suggestions = activeIssues.filter((i: any) => i.type === 'suggestion' || i.t === 'S').length
  
  // Adaptive scoring: 85-90 with issues, scales to 100 as issues are fixed
  const FLOOR_SCORE = 85
  const CEILING_WITH_ISSUES = 90
  const PERFECT_SCORE = 100
  
  let newScore: number
  if (activeIssues.length === 0) {
    newScore = PERFECT_SCORE
  } else {
    const severityWeight = errors * 3 + warnings * 2 + suggestions * 1
    const maxSeverityWeight = 15
    const qualityFactor = Math.max(0, 1 - (severityWeight / maxSeverityWeight))
    const baseScore = FLOOR_SCORE + (qualityFactor * (CEILING_WITH_ISSUES - FLOOR_SCORE))
    const resolvedRatio = totalIssuesCount > 0 ? resolvedCount / totalIssuesCount : 0
    newScore = Math.round(baseScore + ((PERFECT_SCORE - baseScore) * resolvedRatio))
    newScore = Math.max(FLOOR_SCORE, Math.min(PERFECT_SCORE - 1, newScore))
  }
  
  // Build updated summary with recalculated score
  const existingSummary = (review.summary as any) || {}
  const updatedSummary = {
    ...existingSummary,
    totalIssues: activeIssues.length,
    errors,
    warnings,
    suggestions,
    overallScore: newScore,
    recommendation: activeIssues.length === 0 
      ? 'All issues resolved! Draft is ready for export.'
      : errors > 0 
        ? `Found ${errors} error(s) that should be fixed before filing.`
        : warnings > 0
          ? `Found ${warnings} warning(s). Review recommended before export.`
          : 'Draft looks good! Ready for export.'
  }
  
  await prisma.aIReviewResult.update({
    where: { id: review.id },
    data: {
      issues: updatedIssues,
      summary: updatedSummary,
      ignoredIssues: existingIgnored.includes(issueId) 
        ? existingIgnored 
        : [...existingIgnored, issueId]
    }
  })

  return NextResponse.json({
    success: true,
    reviewId: review.id,
    ignoredIssues: existingIgnored.includes(issueId) ? existingIgnored : [...existingIgnored, issueId],
    updatedIssueStatus: 'ignored',
    updatedSummary
  })
}

/**
 * Revert an applied AI fix
 * Restores the section to its state before the fix was applied
 */
async function handleRevertAIFix(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction, sectionKey, fixHistoryId } = data

  if (!sessionId || !jurisdiction || !sectionKey || !fixHistoryId) {
    return NextResponse.json({ 
      error: 'Session ID, jurisdiction, section key, and fix history ID required' 
    }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' } } }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const code = jurisdiction.toUpperCase()

  // Find the review with the fix history
  const review = await prisma.aIReviewResult.findFirst({
    where: { sessionId, jurisdiction: code },
    orderBy: { reviewedAt: 'desc' }
  })

  if (!review) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  }

  // Type for fix history entries
  interface FixHistoryEntry {
    id: string
    sectionKey: string
    status?: string
    beforeText?: string
    issueId: string
  }

  // Find the fix history entry - SECURITY: validate it belongs to this review
  const appliedFixes = Array.isArray(review.appliedFixes) ? (review.appliedFixes as unknown as FixHistoryEntry[]) : []
  const fixEntry = appliedFixes.find((f) => f.id === fixHistoryId)

  if (!fixEntry) {
    return NextResponse.json({ error: 'Fix history entry not found in this review' }, { status: 404 })
  }

  // SECURITY: Verify the fix belongs to the requested section
  if (fixEntry.sectionKey !== sectionKey) {
    return NextResponse.json({ error: 'Fix does not belong to specified section' }, { status: 400 })
  }

  // Check if already reverted
  if (fixEntry.status === 'reverted') {
    return NextResponse.json({ error: 'This fix has already been reverted' }, { status: 400 })
  }

  // Get the before text from the fix entry
  const revertedContent = fixEntry.beforeText

  if (!revertedContent && revertedContent !== '') {
    return NextResponse.json({ error: 'No previous content available for revert' }, { status: 400 })
  }

  // Update the review to mark the issue as reverted (back to pending for re-fixing)
  const issues = Array.isArray(review.issues) ? (review.issues as any[]) : []
  const updatedIssues = issues.map((i: any) => 
    i.id === fixEntry.issueId 
      ? { ...i, status: 'pending', revertedAt: new Date().toISOString(), previousStatus: i.status } 
      : i
  )

  // Update the fix entry status
  const updatedFixes = appliedFixes.map((f) =>
    f.id === fixHistoryId
      ? { ...f, status: 'reverted', revertedAt: new Date().toISOString() }
      : f
  )

  // Recalculate score based on remaining active issues (not fixed, not ignored)
  const activeIssues = updatedIssues.filter((i: any) => i.status !== 'fixed' && i.status !== 'ignored')
  const totalIssuesCount = updatedIssues.length
  const resolvedCount = totalIssuesCount - activeIssues.length
  const errors = activeIssues.filter((i: any) => i.type === 'error' || i.t === 'E').length
  const warnings = activeIssues.filter((i: any) => i.type === 'warning' || i.t === 'W').length
  const suggestions = activeIssues.filter((i: any) => i.type === 'suggestion' || i.t === 'S').length
  
  // Adaptive scoring: 85-90 with issues, scales to 100 as issues are fixed
  const FLOOR_SCORE = 85
  const CEILING_WITH_ISSUES = 90
  const PERFECT_SCORE = 100
  
  let newScore: number
  if (activeIssues.length === 0) {
    newScore = PERFECT_SCORE
  } else {
    const severityWeight = errors * 3 + warnings * 2 + suggestions * 1
    const maxSeverityWeight = 15
    const qualityFactor = Math.max(0, 1 - (severityWeight / maxSeverityWeight))
    const baseScore = FLOOR_SCORE + (qualityFactor * (CEILING_WITH_ISSUES - FLOOR_SCORE))
    const resolvedRatio = totalIssuesCount > 0 ? resolvedCount / totalIssuesCount : 0
    newScore = Math.round(baseScore + ((PERFECT_SCORE - baseScore) * resolvedRatio))
    newScore = Math.max(FLOOR_SCORE, Math.min(PERFECT_SCORE - 1, newScore))
  }
  
  // Build updated summary with recalculated score
  const existingSummary = (review.summary as any) || {}
  const updatedSummary = {
    ...existingSummary,
    totalIssues: activeIssues.length,
    errors,
    warnings,
    suggestions,
    overallScore: newScore,
    recommendation: activeIssues.length === 0 
      ? 'All issues resolved! Draft is ready for export.'
      : errors > 0 
        ? `Found ${errors} error(s) that should be fixed before filing.`
        : warnings > 0
          ? `Found ${warnings} warning(s). Review recommended before export.`
          : 'Draft looks good! Ready for export.'
  }

  await prisma.aIReviewResult.update({
    where: { id: review.id },
    data: {
      issues: updatedIssues,
      summary: updatedSummary,
      appliedFixes: updatedFixes as any
    }
  })

  return NextResponse.json({
    success: true,
    sectionKey,
    revertedContent,
    fixHistoryId,
    issueId: fixEntry.issueId,
    updatedSummary,
    message: 'Fix reverted successfully. Issue is now pending again.'
  })
}
