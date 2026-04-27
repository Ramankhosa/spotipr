/**
 * Sketch Generation Service
 * 
 * Handles AI-powered sketch generation for patent figures using Gemini 3 Pro Image
 * Preview / Nano Banana Pro (gemini-3-pro-image-preview) at 2K output size.
 * Supports three modes: AUTO, GUIDED, and REFINE.
 * 
 * Key Features:
 * - Patent-style black-and-white line art generation
 * - Context-aware generation from invention data
 * - Multi-view support (combined or separate sketches)
 * - Modification chains with version tracking
 * - Anti-hallucination prompting
 * 
 * LLM Gateway Integration:
 * - Uses gateway for policy/quota enforcement (DIAGRAM_GENERATION feature)
 * - Uses gateway for model resolution (plan-configured models)
 * - Records usage through gateway metering system
 */

import { prisma } from './prisma'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { resolveModel } from '@/lib/metering/model-resolver'
import { llmGateway } from '@/lib/metering/gateway'
import { createMeteringSystem } from '@/lib/metering/system'
import { extractTenantContextFromRequest } from '@/lib/metering/auth-bridge'
import { CONTINGENCY_MULTIPLIER } from '@/lib/metering/cost-calculator'
import type { TaskCode, FeatureCode } from '@prisma/client'

// Types
export type SketchMode = 'AUTO' | 'GUIDED' | 'REFINE'
export type SketchStatus = 'SUGGESTED' | 'PENDING' | 'SUCCESS' | 'FAILED'

export interface SketchContextFlags {
  useIdeaSummary?: boolean
  useClaims?: boolean
  useDiagrams?: boolean
  useComponents?: boolean
}

export interface SketchViewConfig {
  combinedView?: boolean
  separateViews?: string[] // e.g., ['top', 'front', 'side']
}

export interface SketchGenerationRequest {
  patentId: string
  sessionId?: string
  mode: SketchMode
  title?: string
  userPrompt?: string
  contextFlags?: SketchContextFlags
  viewsRequested?: SketchViewConfig
  sourceSketchId?: string // For REFINE mode or modification chains
  uploadedImageBase64?: string // For REFINE mode
  uploadedImageMimeType?: string
  language?: string // Primary language for labels/annotations (from Stage 0)
  referenceSketchIds?: string[] // Already-generated sketch IDs to use as visual style references
}

export interface SketchContextBundle {
  ideaSummary: string
  keyComponents: string[]
  claims: string[]
  diagramSummaries: string[]
  referenceNumerals: Record<string, string>
  inventionType: string
  language: string // Primary language for labels/annotations
  patentTypePrimary: 'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION' | null // Patent type for numbering style
  numberingStyle: 'NUMERIC_BUCKET' | 'STEP_LABEL' | 'CONSTITUENT_LABEL' // Derived numbering style
}

export interface SketchGenerationResult {
  success: boolean
  sketchId?: string
  imagePath?: string
  imageUrl?: string
  error?: string
  attemptCount?: number
}

// Constants
const SKETCH_UPLOAD_DIR = 'public/uploads/sketches'
const MAX_MODIFY_ATTEMPTS = 10
const SKETCH_FIXED_COST_INR = 30
// Static FX assumption to map INR to USD for unified metering totals.
const INR_TO_USD = 0.012
const SKETCH_FIXED_COST_USD = SKETCH_FIXED_COST_INR * INR_TO_USD

// ============================================================================
// IMAGE GENERATION MODEL CONFIGURATION
// ============================================================================
// Model selection is controlled ENTIRELY through the Super Admin LLM Config panel.
// No hardcoded fallbacks - if model resolution fails, we fail with a clear error.
//
// Configure the sketch generation model in Super Admin → LLM Config:
// - Select your Plan
// - Find "Sketch Generation" stage under PATENT_DRAFTING feature
// - Assign a model that supports image OUTPUT (e.g., gemini-3-pro-image-preview)
//
// IMPORTANT: Only specific models support image generation:
// ✓ gemini-3-pro-image-preview (recommended)
// ✓ imagen-3.0-generate-002 (Imagen 3)
// ✗ gemini-2.0-flash, gemini-2.0-flash-exp (text/vision only - NO image output)
// ✗ gemini-2.0-flash-lite (text/vision only - NO image output)
// ============================================================================
const SKETCH_RECOMMENDED_MODEL = 'gemini-3-pro-image-preview'
const SKETCH_OUTPUT_IMAGE_SIZE = '2K'
const SKETCH_STAGE_CODE = 'DRAFT_SKETCH_GENERATION'
const SKETCH_TASK_CODE: TaskCode = 'LLM3_DIAGRAM' // Closest task for vision + drafting limits

/**
 * Resolve the active plan for a tenant (latest active, non-expired)
 */
async function getActivePlanIdForTenant(tenantId?: string | null): Promise<string | null> {
  if (!tenantId) return null
  const now = new Date()
  const plan = await prisma.tenantPlan.findFirst({
    where: {
      tenantId,
      status: 'ACTIVE',
      effectiveFrom: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    },
    orderBy: { effectiveFrom: 'desc' },
    select: { planId: true }
  })
  return plan?.planId || null
}

/**
 * Resolve sketch model from database configuration ONLY.
 * No hardcoded fallbacks - model must be configured in Super Admin LLM Config.
 * 
 * Returns ordered list:
 * 1) Plan-specific stage model (from PlanStageModelConfig)
 * 2) Plan-configured fallbacks (from the same config)
 * 3) Environment override (GEMINI_SKETCH_MODEL) - for development/testing only
 * 
 * If no model is configured, returns empty array - caller should handle gracefully.
 */
async function resolveSketchModelCandidates(tenantId?: string | null): Promise<string[]> {
  const candidates: string[] = []

  try {
    const planId = await getActivePlanIdForTenant(tenantId)
    if (planId) {
      console.log(`[SketchService] Resolving model for planId=${planId}, stage=${SKETCH_STAGE_CODE}`)
      const resolved = await resolveModel(planId, SKETCH_TASK_CODE, SKETCH_STAGE_CODE)
      
      if (resolved?.modelCode) {
        console.log(`[SketchService] Model resolved from DB: ${resolved.modelCode} (source: ${resolved.source})`)
        candidates.push(resolved.modelCode)
        
        // Add plan-configured fallbacks (if any)
        if (resolved.fallbacks && resolved.fallbacks.length > 0) {
          console.log(`[SketchService] Fallbacks from DB: ${resolved.fallbacks.map(f => f.modelCode).join(', ')}`)
          resolved.fallbacks.forEach(fb => {
            if (fb?.modelCode) candidates.push(fb.modelCode)
          })
        }
      } else {
        console.warn(`[SketchService] No model configured for sketch generation in plan ${planId}`)
      }
    } else {
      console.warn(`[SketchService] No active plan found for tenant ${tenantId || 'unknown'}`)
    }
  } catch (e) {
    console.error('[SketchService] Model resolution failed:', e instanceof Error ? e.message : e)
  }

  // Environment override for development/testing (NOT for production)
  if (process.env.GEMINI_SKETCH_MODEL && candidates.length === 0) {
    console.log(`[SketchService] Using env override: ${process.env.GEMINI_SKETCH_MODEL}`)
    candidates.push(process.env.GEMINI_SKETCH_MODEL)
  }

  // NO hardcoded fallbacks - return only what's configured in the database
  // If empty, the caller should fail with a clear error message
  return Array.from(new Set(candidates.filter(Boolean)))
}

// === CONTEXT BUNDLE BUILDER ===

/**
 * Builds a context bundle from invention data for sketch generation.
 * This bundle provides the AI with factual information to prevent hallucination.
 */
export async function buildSketchContextBundle(
  patentId: string,
  sessionId: string | undefined,
  flags: SketchContextFlags = { useIdeaSummary: true, useClaims: true, useDiagrams: true, useComponents: true },
  requestedLanguage?: string
): Promise<SketchContextBundle> {
  // Helper to derive numbering style from patent type
  const deriveNumberingStyle = (patentType: string | null | undefined): 'NUMERIC_BUCKET' | 'STEP_LABEL' | 'CONSTITUENT_LABEL' => {
    if (!patentType) return 'NUMERIC_BUCKET'
    switch (patentType) {
      case 'PROCESS': return 'STEP_LABEL'
      case 'COMPOSITION': return 'CONSTITUENT_LABEL'
      default: return 'NUMERIC_BUCKET'
    }
  }

  const bundle: SketchContextBundle = {
    ideaSummary: '',
    keyComponents: [],
    claims: [],
    diagramSummaries: [],
    referenceNumerals: {},
    inventionType: 'GENERAL',
    language: requestedLanguage || 'en',
    patentTypePrimary: null,
    numberingStyle: 'NUMERIC_BUCKET'
  }

  // Get session with related data
  const session = sessionId ? await prisma.draftingSession.findUnique({
    where: { id: sessionId },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true,
      diagramSources: true,
      annexureDrafts: {
        orderBy: { version: 'desc' },
        take: 1
      }
    }
  }) : null

  // Extract figures language from session if not explicitly provided
  if (!requestedLanguage && session) {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    if (typeof status.__figuresLanguage === 'string' && status.__figuresLanguage.trim()) {
      bundle.language = status.__figuresLanguage.trim().toLowerCase()
    } else {
      // Fallback to active jurisdiction's language
      const activeJurisdiction = ((session as any)?.activeJurisdiction || '').toUpperCase()
      if (activeJurisdiction && status?.[activeJurisdiction]?.language) {
        bundle.language = status[activeJurisdiction].language
      }
    }
  }

  // Extract patent type and numbering style from session
  if (session) {
    const patentType = (session as any).patentTypePrimary as 'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION' | null
    bundle.patentTypePrimary = patentType
    bundle.numberingStyle = deriveNumberingStyle(patentType)
    
    // Also check referenceMap for stored numberingStyle (may have user override)
    const refMapRaw = session.referenceMap?.components as any
    const storedStyle = refMapRaw?.numberingStyle
    if (storedStyle && ['NUMERIC_BUCKET', 'STEP_LABEL', 'CONSTITUENT_LABEL'].includes(storedStyle)) {
      bundle.numberingStyle = storedStyle
    }
  }

  // 1. Idea Summary
  if (flags.useIdeaSummary && session?.ideaRecord) {
    const idea = session.ideaRecord.normalizedData as any
    bundle.ideaSummary = [
      idea?.title && `Title: ${idea.title}`,
      idea?.problem && `Problem: ${idea.problem}`,
      idea?.objectives && `Objectives: ${idea.objectives}`,
      idea?.logic && `Core Logic: ${idea.logic}`,
      idea?.inputs && `Inputs: ${idea.inputs}`,
      idea?.outputs && `Outputs: ${idea.outputs}`
    ].filter(Boolean).join('\n')

    // Extract invention type
    const types = Array.isArray(idea?.inventionType) 
      ? idea.inventionType 
      : (idea?.inventionType ? [idea.inventionType] : [])
    bundle.inventionType = types.length > 0 ? types.join('+') : 'GENERAL'
  }

  // 2. Key Components from Reference Map
  if (flags.useComponents && session?.referenceMap) {
    // Handle both nested structure { components: { components: [...] } } and direct array { components: [...] }
    const refMapRaw = session.referenceMap.components as any
    const refMap = Array.isArray(refMapRaw) 
      ? refMapRaw 
      : (refMapRaw?.components && Array.isArray(refMapRaw.components) ? refMapRaw.components : [])
    
    if (refMap.length > 0) {
      bundle.keyComponents = refMap.map((c: any) => c.name || c.label || c.component).filter(Boolean)
      // Build reference numerals map - use referenceLabel (universal across all patent types)
      // For NUMERIC_BUCKET: referenceLabel = "100", "200", etc.
      // For STEP_LABEL: referenceLabel = "S100", "S200", etc.
      // For CONSTITUENT_LABEL: referenceLabel = "(a)", "(b)", "(c)", etc.
      refMap.forEach((c: any) => {
        const label = c.referenceLabel || (c.numeral !== undefined ? String(c.numeral) : null)
        if (label && (c.name || c.label)) {
          bundle.referenceNumerals[label] = c.name || c.label
        }
      })
    }
  }

  // 3. Claims (independent + few dependent)
  if (flags.useClaims && session?.annexureDrafts?.[0]) {
    const claimsText = session.annexureDrafts[0].claims || ''
    // Extract first 5 claims for context (don't overwhelm)
    const claimMatches = claimsText.match(/\d+\.\s+[^.]+\./g)
    if (claimMatches) {
      bundle.claims = claimMatches.slice(0, 5)
    }
  }

  // 4. Diagram Summaries (titles & descriptions, not full PlantUML)
  if (flags.useDiagrams && session?.figurePlans) {
    bundle.diagramSummaries = session.figurePlans.map((fig: any) => 
      `Figure ${fig.figureNo}: ${fig.title}${fig.description ? ` - ${fig.description}` : ''}`
    )
  }

  return bundle
}

// === PROMPT BUILDERS ===

/**
 * Gets the labeling rules text based on numbering style.
 * Different patent types use different reference label formats.
 */
function getLabelingRulesForStyle(numberingStyle: 'NUMERIC_BUCKET' | 'STEP_LABEL' | 'CONSTITUENT_LABEL'): string {
  switch (numberingStyle) {
    case 'STEP_LABEL':
      return `• Reference labels for PROCESS patents use step format: S100, S200, S300, etc.
• Use the EXACT reference labels provided in the component list (e.g., S100, S200)
• NO alphabetic words or text descriptions may appear ANYWHERE in the drawing
• NO part names, titles, or descriptors in the drawing
• NO figure numbers or "FIG." labels in the drawing
• Each step/component labeled once per view unless clarity requires repetition
• Labels must NOT overlap geometry — use leader lines to connect labels to components
• Place labels clearly near their corresponding components`
    case 'CONSTITUENT_LABEL':
      return `• Reference labels for COMPOSITION patents use alphabetical format: (a), (b), (c), etc.
• Use the EXACT reference labels provided in the component list (e.g., (a), (b), (c))
• NO alphabetic words or text descriptions may appear ANYWHERE in the drawing
• NO part names, titles, or descriptors in the drawing
• NO figure numbers or "FIG." labels in the drawing
• Each constituent/ingredient labeled once per view unless clarity requires repetition
• Labels must NOT overlap geometry — use leader lines to connect labels to components
• Place labels clearly near their corresponding components`
    case 'NUMERIC_BUCKET':
    default:
      return `• ONLY numeric reference labels are allowed (#100, #200, #300, etc.)
• Use the EXACT reference labels provided in the component list
• NO alphabetic words or text descriptions may appear ANYWHERE in the drawing
• NO part names, titles, or descriptors in the drawing
• NO figure numbers or "FIG." labels in the drawing
• Each component labeled once per view unless clarity requires repetition
• Labels must NOT overlap geometry — use leader lines to connect labels to components
• Place labels clearly near their corresponding components`
  }
}

/**
 * Gets the compliance checklist text based on numbering style.
 */
function getComplianceChecklistForStyle(numberingStyle: 'NUMERIC_BUCKET' | 'STEP_LABEL' | 'CONSTITUENT_LABEL'): string {
  const labelExample = numberingStyle === 'STEP_LABEL' 
    ? 'S100, S200, etc.' 
    : numberingStyle === 'CONSTITUENT_LABEL' 
      ? '(a), (b), (c), etc.' 
      : '#100, #200, etc.'
  
  return `✔ Only listed components shown (no extras)
✔ Reference labels only (${labelExample}) — use exactly the labels from the provided list
✔ Main view provided; secondary view only if explicitly stated internals exist
✔ Dashed lines used correctly (internal/hidden only)
✔ No forbidden elements present`
}

/**
 * Builds the system role prompt for sketch generation.
 * USPTO/EPO/WIPO-compliant patent line drawing rules with anti-hallucination.
 * Now patent-type-aware for correct reference label formats.
 */
function buildSystemPrompt(numberingStyle: 'NUMERIC_BUCKET' | 'STEP_LABEL' | 'CONSTITUENT_LABEL' = 'NUMERIC_BUCKET'): string {
  return `SYSTEM ROLE — USPTO/EPO/WIPO Patent Line Drawing Generator

Generate a USPTO/EPO/WIPO-compliant black-and-white line drawing. Follow ALL rules exactly. Do NOT interpret or add detail beyond the invention description.

═══════════════════════════════════════════════════════════════════════════════
DRAWING RULES (STRICT COMPLIANCE)
═══════════════════════════════════════════════════════════════════════════════
• Solid lines = visible features
• Dashed lines = internal/hidden features ONLY where explicitly specified
• Clean, precise lines suitable for patent filings
• Professional engineering/technical drawing style
• Clear component separation with distinct boundaries
• NO shading, gradients, textures, icons, dimension lines, motion marks, UI elements, or decorative curves

═══════════════════════════════════════════════════════════════════════════════
LABELING RULES (STRICT — NO EXCEPTIONS)
═══════════════════════════════════════════════════════════════════════════════
${getLabelingRulesForStyle(numberingStyle)}

═══════════════════════════════════════════════════════════════════════════════
PROHIBITED ELEMENTS (NO EXCEPTIONS)
═══════════════════════════════════════════════════════════════════════════════
❌ Text descriptions or part names
❌ Shading, gradients, or textures
❌ Icons or symbolic representations
❌ Arrows (except as explicit flow indicators when specified)
❌ Dimension lines or measurements
❌ Motion marks or rotation indicators
❌ UI elements or decorative curves
❌ Extra components not in the invention context
❌ Hidden assumptions or inferred mechanical details
❌ Symbolic embellishments
❌ Any element not explicitly described in the invention

═══════════════════════════════════════════════════════════════════════════════
ANTI-HALLUCINATION CONSTRAINTS
═══════════════════════════════════════════════════════════════════════════════
1. Use ONLY components explicitly provided in the invention context
2. Use ONLY reference numerals from the provided numeral list
3. Do NOT invent or add components, features, or structures
4. Do NOT assume internal mechanisms unless explicitly described
5. If information is ambiguous → use simplified block representation
6. When in doubt between detailed and simple → choose SIMPLE + TRUTHFUL

═══════════════════════════════════════════════════════════════════════════════
OUTPUT REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════
1. MAIN VIEW: Primary assembled view (orientation based on invention context)
2. SECONDARY VIEW: Only if it reveals components or physical relationships explicitly stated in the invention.
   If no internal structure is disclosed or claimed, OMIT the secondary view.

═══════════════════════════════════════════════════════════════════════════════
ENFORCEMENT
═══════════════════════════════════════════════════════════════════════════════
If ANY rule would be violated, simplify the drawing until compliant.
If the invention description is too ambiguous to draw, use simplified block diagram.

═══════════════════════════════════════════════════════════════════════════════
COMPLIANCE CHECKLIST (Self-verify before output)
═══════════════════════════════════════════════════════════════════════════════
${getComplianceChecklistForStyle(numberingStyle)}`
}

/**
 * Builds the user prompt for AUTO mode generation.
 */
function buildAutoModePrompt(context: SketchContextBundle, viewConfig?: SketchViewConfig): string {
  // Language labels mapping
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
  const languageLabel = languageLabels[context.language] || context.language.toUpperCase()

  let prompt = `Generate a USPTO/EPO/WIPO-compliant patent line drawing for this invention:

═══════════════════════════════════════════════════════════════════════════════
LANGUAGE REQUIREMENT
═══════════════════════════════════════════════════════════════════════════════
PRIMARY LANGUAGE: ${languageLabel} (${context.language})
All labels, descriptions, and annotations in the drawing MUST be in ${languageLabel}.
${context.language !== 'en' ? `Use proper ${languageLabel} characters and terminology. Only use English for standard technical terms with no ${languageLabel} equivalent.` : ''}

═══════════════════════════════════════════════════════════════════════════════
INVENTION CONTEXT
═══════════════════════════════════════════════════════════════════════════════
${context.ideaSummary}

`

  if (context.keyComponents.length > 0) {
    prompt += `KEY COMPONENTS (use ONLY these):
${context.keyComponents.map((c, i) => `- ${c}`).join('\n')}

`
  }

  if (Object.keys(context.referenceNumerals).length > 0) {
    prompt += `REFERENCE LABELS (use ONLY these as labels):
${Object.entries(context.referenceNumerals).map(([label, name]) => `${label} → ${name}`).join('\n')}

IMPORTANT: In the drawing, use ONLY the reference labels shown above (100/200 for products, S100/S200 for processes, (a)/(b) for compositions), NOT the component names.
`
  }

  if (context.claims.length > 0) {
    prompt += `KEY CLAIMS (for structural reference only):
${context.claims.join('\n')}

`
  }

  if (context.diagramSummaries.length > 0) {
    prompt += `EXISTING DIAGRAMS (maintain consistency):
${context.diagramSummaries.join('\n')}

`
  }

  prompt += `INVENTION TYPE: ${context.inventionType}

`

  // View configuration
  if (viewConfig?.separateViews && viewConfig.separateViews.length > 0) {
    prompt += `═══════════════════════════════════════════════════════════════════════════════
REQUIRED VIEWS
═══════════════════════════════════════════════════════════════════════════════
Generate these specific views: ${viewConfig.separateViews.join(', ')}
`
  } else if (viewConfig?.combinedView) {
    prompt += `═══════════════════════════════════════════════════════════════════════════════
REQUIRED VIEWS
═══════════════════════════════════════════════════════════════════════════════
Generate a combined multi-view figure showing multiple perspectives in one drawing.
Include: Main assembled view + one secondary view (cross-section, exploded, or alternate angle)
`
  } else {
    prompt += `═══════════════════════════════════════════════════════════════════════════════
REQUIRED VIEWS
═══════════════════════════════════════════════════════════════════════════════
1. MAIN VIEW: Primary assembled view showing the invention's key components and relationships
2. SECONDARY VIEW: Only if it reveals components or physical relationships explicitly stated.
   If no internal structure is disclosed, OMIT the secondary view.
`
  }

  prompt += `
═══════════════════════════════════════════════════════════════════════════════
COMPLIANCE CHECKLIST (Self-verify before output)
═══════════════════════════════════════════════════════════════════════════════
${getComplianceChecklistForStyle(context.numberingStyle)}
✔ Main view provided; secondary view only if explicitly stated internals exist

If ANY rule would be violated, simplify the drawing until compliant.`

  return prompt
}

/**
 * Builds the user prompt for GUIDED mode generation.
 */
function buildGuidedModePrompt(
  context: SketchContextBundle, 
  userPrompt: string,
  viewConfig?: SketchViewConfig
): string {
  const basePrompt = buildAutoModePrompt(context, viewConfig)
  
  return `${basePrompt}

═══════════════════════════════════════════════════════════════════════════════
USER INSTRUCTIONS (Apply within compliance rules)
═══════════════════════════════════════════════════════════════════════════════
${userPrompt}

═══════════════════════════════════════════════════════════════════════════════
INSTRUCTION PRIORITY (when user requests conflict with rules)
═══════════════════════════════════════════════════════════════════════════════
1. Patent office compliance rules ALWAYS override user preferences
2. Invention context accuracy ALWAYS override aesthetic requests
3. Apply user layout/view preferences ONLY if they don't violate rules

EXAMPLES OF WHAT TO IGNORE:
- User asks for color → Generate black and white only
- User asks for text labels → Use reference labels only (${context.numberingStyle === 'STEP_LABEL' ? 'S100, S200...' : context.numberingStyle === 'CONSTITUENT_LABEL' ? '(a), (b), (c)...' : '#100, #200...'})
- User asks for components not in context → Do not add them
- User asks for shading/gradients → Use line art only`
}

/**
 * Builds the language requirement section for sketch prompts.
 * Shared across all prompt modes for consistency.
 */
function buildLanguageRequirementSection(context: SketchContextBundle): string {
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
  const languageLabel = languageLabels[context.language] || context.language.toUpperCase()
  
  return `═══════════════════════════════════════════════════════════════════════════════
LANGUAGE REQUIREMENT
═══════════════════════════════════════════════════════════════════════════════
PRIMARY LANGUAGE: ${languageLabel} (${context.language})
All labels, descriptions, and annotations in the drawing MUST be in ${languageLabel}.
${context.language !== 'en' ? `Use proper ${languageLabel} characters and terminology. Only use English for standard technical terms with no ${languageLabel} equivalent.` : ''}
`
}

/**
 * Builds the prompt for REFINE mode (cleaning up uploaded sketches).
 */
function buildRefineModePrompt(
  context: SketchContextBundle,
  userPrompt?: string
): string {
  let prompt = `Interpret and refine this user-uploaded sketch into a USPTO/EPO/WIPO-compliant patent line drawing.

${buildLanguageRequirementSection(context)}
═══════════════════════════════════════════════════════════════════════════════
INVENTION CONTEXT (Source of Truth for components and numerals)
═══════════════════════════════════════════════════════════════════════════════
${context.ideaSummary}

`

  if (context.keyComponents.length > 0) {
    prompt += `OFFICIAL COMPONENTS (only these may appear):
${context.keyComponents.map((c, i) => `- ${c}`).join('\n')}

`
  }

  if (Object.keys(context.referenceNumerals).length > 0) {
    prompt += `OFFICIAL REFERENCE LABELS (replace any text labels with these):
${Object.entries(context.referenceNumerals).map(([label, name]) => `${label} → ${name}`).join('\n')}

CRITICAL: Convert ALL text labels in the uploaded sketch to the reference labels shown above.
`
  }

  // Get label format description based on numbering style
  const labelFormatDesc = context.numberingStyle === 'STEP_LABEL' 
    ? 'step labels (S100, S200, etc.)' 
    : context.numberingStyle === 'CONSTITUENT_LABEL' 
      ? 'constituent labels ((a), (b), (c), etc.)' 
      : 'numeric reference labels (#100, #200, etc.)'

  prompt += `═══════════════════════════════════════════════════════════════════════════════
REFINEMENT TASKS
═══════════════════════════════════════════════════════════════════════════════
1. Extract the structure and layout from the uploaded sketch
2. Identify components and map them to the official component list
3. REMOVE any components not in the invention context
4. REPLACE all text labels with the official reference labels (${labelFormatDesc})
5. Convert to clean black-and-white line art (no shading/gradients)
6. Apply solid lines for visible features, dashed for internal/hidden
7. Remove any arrows, dimension lines, icons, or decorative elements

═══════════════════════════════════════════════════════════════════════════════
REFINEMENT RULES
═══════════════════════════════════════════════════════════════════════════════
- Preserve the user's intended LAYOUT and SPATIAL ARRANGEMENT
- Correct all labels to match the official reference label format provided above
- Remove any non-compliant elements (text descriptions, shading, icons)
- If sketch shows unlisted components → REMOVE them (don't invent labels)
- If sketch is too noisy/unclear → Simplify to core components only
`

  if (userPrompt) {
    prompt += `
═══════════════════════════════════════════════════════════════════════════════
USER REFINEMENT INSTRUCTIONS (apply within compliance rules)
═══════════════════════════════════════════════════════════════════════════════
${userPrompt}
`
  }

  // Get label example based on numbering style
  const labelExample = context.numberingStyle === 'STEP_LABEL' 
    ? 'S100, S200, etc.' 
    : context.numberingStyle === 'CONSTITUENT_LABEL' 
      ? '(a), (b), (c), etc.' 
      : '#100, #200, etc.'

  prompt += `
═══════════════════════════════════════════════════════════════════════════════
COMPLIANCE CHECKLIST (Self-verify before output)
═══════════════════════════════════════════════════════════════════════════════
✔ Only listed components shown (no extras)
✔ Reference labels only (${labelExample}) — use exactly the labels from the provided list
✔ Clean line art (no shading, gradients, textures)
✔ Dashed lines used correctly (internal/hidden only)
✔ No forbidden elements present`

  return prompt
}

/**
 * Builds the prompt for MODIFY operations.
 */
function buildModifyPrompt(
  context: SketchContextBundle,
  modifyInstructions: string,
  originalSketchTitle?: string,
  originalSketchDescription?: string
): string {
  let prompt = `Modify this existing patent sketch while maintaining USPTO/EPO/WIPO compliance.

═══════════════════════════════════════════════════════════════════════════════
ORIGINAL SKETCH INFO
═══════════════════════════════════════════════════════════════════════════════
Title: ${originalSketchTitle || 'Untitled'}
${originalSketchDescription ? `Description: ${originalSketchDescription}` : ''}

═══════════════════════════════════════════════════════════════════════════════
INVENTION CONTEXT (Source of Truth - must remain accurate)
═══════════════════════════════════════════════════════════════════════════════
${context.ideaSummary}

`

  if (Object.keys(context.referenceNumerals).length > 0) {
    prompt += `REFERENCE LABELS (use ONLY these labels):
${Object.entries(context.referenceNumerals).map(([label, name]) => `${label} → ${name}`).join('\n')}

`
  }

  // Get label format description based on numbering style
  const labelFormatDesc = context.numberingStyle === 'STEP_LABEL' 
    ? 'step labels (S100, S200, etc.)' 
    : context.numberingStyle === 'CONSTITUENT_LABEL' 
      ? 'constituent labels ((a), (b), (c), etc.)' 
      : 'numeric reference labels (#100, #200, etc.)'

  prompt += `═══════════════════════════════════════════════════════════════════════════════
MODIFICATION INSTRUCTIONS
═══════════════════════════════════════════════════════════════════════════════
${modifyInstructions}

═══════════════════════════════════════════════════════════════════════════════
MODIFICATION RULES
═══════════════════════════════════════════════════════════════════════════════
✓ PRESERVE: Reference labels from context (${labelFormatDesc})
✓ PRESERVE: Essential invention components
✓ APPLY: Only the requested modifications
✓ OUTPUT: New clean sketch (not overlay on original)

✗ DO NOT: Add components not in invention context
✗ DO NOT: Remove components essential to the invention
✗ DO NOT: Add text labels — use only the official reference labels provided
✗ DO NOT: Add shading, gradients, icons, or arrows
✗ DO NOT: Misrepresent the invention structure

═══════════════════════════════════════════════════════════════════════════════
IF MODIFICATION CONFLICTS WITH COMPLIANCE
═══════════════════════════════════════════════════════════════════════════════
If the requested modification would violate patent drawing rules:
1. Apply the closest compliant alternative
2. Maintain invention accuracy over user aesthetic preference
3. When in doubt, make minimal changes to preserve compliance`

  return prompt
}

// === GEMINI IMAGE GENERATION WITH GATEWAY INTEGRATION ===

// Response type for sketch generation - simplified, no metadata extraction
export interface SketchGenerationResponse {
  success: boolean
  imageBase64?: string
  error?: string
  tokensUsed?: number
  modelUsed?: string
  reservationId?: string
}

/**
 * Enforce sketch generation access through LLM Gateway.
 * This checks DIAGRAM_GENERATION feature access, quota, and creates a reservation.
 * 
 * @returns Enforcement decision with reservation ID if allowed, or error if denied
 */
async function enforceSketchAccess(
  tenantId: string | undefined,
  userId: string | undefined
): Promise<{ allowed: true; reservationId: string; modelCode?: string } | { allowed: false; error: string }> {
  if (!tenantId) {
    // No tenant context - allow but warn (for backwards compatibility)
    console.warn('[SketchService] No tenant context - skipping gateway enforcement')
    return { allowed: true, reservationId: '' }
  }

  try {
    const meteringSystem = createMeteringSystem()
    
    // Create feature request for DIAGRAM_GENERATION
    const featureRequest = {
      tenantId,
      featureCode: 'DIAGRAM_GENERATION' as FeatureCode,
      taskCode: SKETCH_TASK_CODE,
      userId,
      metadata: {
        idempotencyKey: `sketch-${Date.now()}-${crypto.randomUUID()}`
      }
    }

    // Evaluate access through policy service
    const decision = await meteringSystem.policy.evaluateAccess(featureRequest)

    if (!decision.allowed) {
      console.warn(`[SketchService] Access denied: ${decision.reason}`)
      return { 
        allowed: false, 
        error: decision.reason || 'Sketch generation not available for your plan'
      }
    }

    console.log(`[SketchService] Access granted - reservation: ${decision.reservationId}`)
    return { 
      allowed: true, 
      reservationId: decision.reservationId || '',
      modelCode: decision.modelClass as string | undefined
    }
  } catch (error) {
    console.error('[SketchService] Gateway enforcement error:', error)
    // On error, allow access (fail open) - the actual API call may still fail
    return { allowed: true, reservationId: '' }
  }
}

/**
 * Record sketch generation usage through the metering system.
 */
async function recordSketchUsage(
  reservationId: string,
  tokensUsed: number,
  modelCode: string,
  userId?: string
): Promise<void> {
  if (!reservationId) return // No reservation to record against

  try {
    const meteringSystem = createMeteringSystem()
    const fixedCost = SKETCH_FIXED_COST_USD
    const contingencyCost = fixedCost * CONTINGENCY_MULTIPLIER

    await meteringSystem.metering.recordUsage(
      reservationId,
      {
        inputTokens: Math.ceil(tokensUsed * 0.3), // Estimate: 30% input
        outputTokens: Math.ceil(tokensUsed * 0.7), // Estimate: 70% output (image)
        modelClass: modelCode as any,
        apiCalls: 1,
        metadata: {
          service: 'sketch-generation',
          stageCode: SKETCH_STAGE_CODE,
          cost: {
            actualCost: fixedCost,
            contingencyCost,
            currency: 'USD',
            source: 'fixed_inr_sketch_cost',
            inrAmount: SKETCH_FIXED_COST_INR
          }
        }
      },
      userId
    )
    console.log(`[SketchService] Usage recorded: ${tokensUsed} tokens for reservation ${reservationId}`)
  } catch (error) {
    console.error('[SketchService] Failed to record usage:', error)
    // Don't fail the sketch generation if usage recording fails
  }
}

/**
 * Generates a sketch using Gemini image generation with retry logic.
 * 
 * GATEWAY INTEGRATION:
 * - Enforces DIAGRAM_GENERATION feature access before API call
 * - Uses plan-configured model from model resolver
 * - Records usage through metering system after successful generation
 * 
 * IMAGE GENERATION APPROACH:
 * - Primary: Use Gemini models with native image generation (responseModalities: ['Image', 'Text'])
 * - The model must support image OUTPUT (not just vision input)
 * - Recommended: gemini-3-pro-image-preview (Nano Banana Pro) with imageSize: "2K"
 * 
 * @param systemPrompt - System instructions for the model
 * @param userPrompt - User-provided prompt/instructions
 * @param modelCandidates - Ordered list of models to try (from model resolver)
 * @param inputImage - Optional input image for REFINE/MODIFY modes
 * @param gatewayContext - Tenant and user IDs for gateway enforcement
 * @param referenceImages - Optional array of reference sketch images for visual style consistency
 */
export async function generateSketchWithGemini(
  systemPrompt: string,
  userPrompt: string,
  modelCandidates: string[],
  inputImage?: { base64: string; mimeType: string },
  gatewayContext?: { tenantId?: string; userId?: string },
  referenceImages?: Array<{ base64: string; mimeType: string; title?: string }>
): Promise<SketchGenerationResponse> {
  // 1. Enforce access through LLM Gateway
  const accessCheck = await enforceSketchAccess(
    gatewayContext?.tenantId,
    gatewayContext?.userId
  )
  
  if (!accessCheck.allowed) {
    return { success: false, error: accessCheck.error }
  }
  
  const reservationId = accessCheck.reservationId

  // Dynamic import to avoid client-side issues. The newer @google/genai SDK
  // exposes imageConfig.imageSize, which is required to force 2K output.
  const { GoogleGenAI } = require('@google/genai')
  
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) {
    return { success: false, error: 'Google AI API key not configured. Set GOOGLE_AI_API_KEY in .env' }
  }

  const genAI = new GoogleGenAI({ apiKey })
  
  // Retry logic with exponential backoff per model candidate
  const maxRetries = 3
  let lastError: string = ''
  
  for (const modelCode of modelCandidates) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Determine generation config based on model type.
        // Imagen models use a different API than Gemini native image generation.
        const isImagenModel = modelCode.toLowerCase().includes('imagen')

        if (isImagenModel) {
          lastError = `Imagen model ${modelCode} is not supported by the Gemini native sketch path`
          break
        }
        
        // For Gemini Nano Banana Pro image generation.
        // Reference: https://ai.google.dev/gemini-api/docs/image-generation
        // Use responseModalities plus imageConfig.imageSize to force 2K output.
        const generationConfig: any = {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            imageSize: SKETCH_OUTPUT_IMAGE_SIZE,
          },
        }

        // Build content parts - focused prompt for image generation only
        const fullPrompt = systemPrompt + '\n\n' + userPrompt
        const parts: any[] = [
          { text: fullPrompt }
        ]

        // Add reference sketch images for visual style consistency
        if (referenceImages && referenceImages.length > 0) {
          console.log(`[SketchService] Including ${referenceImages.length} reference sketch(es) for style consistency`)
          for (const refImg of referenceImages) {
            parts.push({
              inlineData: {
                mimeType: refImg.mimeType,
                data: refImg.base64
              }
            })
          }
        }

        // Add input image for REFINE/MODIFY modes
        if (inputImage) {
          console.log(`[SketchService] Including source image for modification (${inputImage.mimeType})`)
          parts.push({
            inlineData: {
              mimeType: inputImage.mimeType,
              data: inputImage.base64
            }
          })
        }

        const refCount = referenceImages?.length || 0
        console.log(`[SketchService] Calling ${modelCode} at ${SKETCH_OUTPUT_IMAGE_SIZE} (attempt ${attempt}/${maxRetries})${inputImage ? ' with source image' : ''}${refCount > 0 ? ` with ${refCount} reference(s)` : ''}...`)
        
        const response = await genAI.models.generateContent({
          model: modelCode,
          contents: parts,
          config: generationConfig,
        })

        // Extract image from response
        const candidates = response.candidates
        if (!candidates || candidates.length === 0) {
          lastError = 'No response candidates from Gemini'
          if (attempt < maxRetries) {
            const delay = Math.min(2000 * attempt, 10000)
            console.log(`[SketchService] No candidates, waiting ${delay}ms before retry...`)
            await new Promise(resolve => setTimeout(resolve, delay))
          }
          continue
        }

        // Look for image in response
        for (const candidate of candidates) {
          if (candidate.content?.parts) {
            for (const part of candidate.content.parts) {
              if (part.inlineData) {
                const tokensUsed = response.usageMetadata?.totalTokenCount || 0
                console.log(`[SketchService] Successfully generated image with ${modelCode}`)
                
                // 2. Record usage through gateway metering
                await recordSketchUsage(
                  reservationId,
                  tokensUsed,
                  modelCode,
                  gatewayContext?.userId
                )
                
                return {
                  success: true,
                  imageBase64: part.inlineData.data,
                  tokensUsed,
                  modelUsed: modelCode,
                  reservationId
                }
              }
            }
          }
        }

        // Check for text response (might be an error or explanation)
        const textResponse = response.text
        if (textResponse) {
          console.log('[SketchService] Model returned text instead of image:', textResponse.substring(0, 300))
          lastError = `Model returned text instead of image: ${textResponse.substring(0, 150)}...`
          break
        }
        
        lastError = 'Model returned empty response'
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error(`[SketchService] Attempt ${attempt} failed for ${modelCode}:`, errorMsg)
        lastError = errorMsg
        
        // If the model doesn't support image generation, try next candidate
        if (/does not support.*image|response modalities/i.test(errorMsg)) {
          console.warn(`[SketchService] Model ${modelCode} doesn't support image generation, trying next...`)
          break
        }
        
        // If the model is not found/unsupported, break and try the next candidate
        if (/not found|unsupported/i.test(errorMsg) || /404/.test(errorMsg)) {
          console.warn(`[SketchService] Model ${modelCode} unavailable, trying next fallback...`)
          break
        }

        // Check for quota/rate limit - wait longer
        if (errorMsg.includes('quota') || errorMsg.includes('rate limit') || /429/.test(errorMsg)) {
          console.log(`[SketchService] Rate limited, waiting ${5000 * attempt}ms before retry...`)
          await new Promise(resolve => setTimeout(resolve, 5000 * attempt))
          continue
        }
        
        // For network errors, retry with exponential backoff
        if (attempt < maxRetries) {
          const delay = Math.min(2000 * Math.pow(2, attempt - 1), 15000)
          console.log(`[SketchService] Network error, waiting ${delay}ms before retry...`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }
  }
  
  // All retries failed - provide helpful error message
  const triedModels = modelCandidates.join(', ')
  return { 
    success: false, 
    error: `Image generation failed after trying: ${triedModels}. Error: ${lastError}. 

TROUBLESHOOTING:
1. Ensure the configured model supports image OUTPUT (not just vision input)
2. Recommended model: ${SKETCH_RECOMMENDED_MODEL} (Nano Banana Pro)
3. Sketch output is requested with imageSize: "${SKETCH_OUTPUT_IMAGE_SIZE}" (2K), not 4K
4. Models that do NOT work: gemini-2.0-flash, gemini-2.0-flash-exp, gemini-2.0-flash-lite (these are text-only)
5. Configure the model in Super Admin → LLM Config → PATENT_DRAFTING → Sketch Generation`
  }
}

// === MAIN SKETCH GENERATION FUNCTION ===

/**
 * Main entry point for sketch generation.
 * Creates a SketchRecord and initiates generation based on mode.
 */
export async function generateSketch(
  request: SketchGenerationRequest,
  userId: string,
  tenantId?: string
): Promise<SketchGenerationResult> {
  const { patentId, sessionId, mode, title, userPrompt, contextFlags, viewsRequested, sourceSketchId, uploadedImageBase64, uploadedImageMimeType, referenceSketchIds } = request

  // 1. Validate inputs based on mode
  if (mode === 'REFINE' && !uploadedImageBase64) {
    return { success: false, error: 'REFINE mode requires an uploaded image' }
  }

  // 2. Check modification chain limit
  if (sourceSketchId) {
    const sourceSketch = await prisma.sketchRecord.findUnique({
      where: { id: sourceSketchId }
    })
    if (sourceSketch && sourceSketch.attemptCount >= MAX_MODIFY_ATTEMPTS) {
      return { success: false, error: `Maximum modification attempts (${MAX_MODIFY_ATTEMPTS}) reached for this sketch chain` }
    }
  }

  // 3. Build context bundle
  const contextBundle = await buildSketchContextBundle(
    patentId,
    sessionId,
    contextFlags || { useIdeaSummary: true, useClaims: true, useDiagrams: true, useComponents: true }
  )

  // 3.1 Resolve model candidates from database (no hardcoded fallbacks)
  const modelCandidates = await resolveSketchModelCandidates(tenantId)
  
  if (modelCandidates.length === 0) {
    return {
      success: false,
      error: `No sketch generation model configured. Please configure a model for "Sketch Generation" stage in Super Admin → LLM Config. Recommended model: ${SKETCH_RECOMMENDED_MODEL}`
    }
  }
  
  const preferredModel = modelCandidates[0]
  console.log(`[SketchService] Using model: ${preferredModel} (${modelCandidates.length} candidates total)`)

  // 4. Check for minimum context
  if (!contextBundle.ideaSummary && contextBundle.keyComponents.length === 0) {
    return { success: false, error: 'Insufficient invention context. Please complete the Idea Entry stage first.' }
  }

  // 5. Create pending SketchRecord
  const sketchRecord = await prisma.sketchRecord.create({
    data: {
      patentId,
      sessionId,
      mode,
      status: 'PENDING',
      title: title || `Sketch - ${mode} Mode`,
      userPrompt,
      contextFlags: contextFlags as any,
      viewsRequested: viewsRequested as any,
      sourceSketchId,
      attemptCount: 0,
      aiModel: preferredModel
    }
  })

  try {
    // 6. Build prompts based on mode (pass numbering style for patent-type-aware labeling)
    const systemPrompt = buildSystemPrompt(contextBundle.numberingStyle)
    let userPromptFinal: string

    switch (mode) {
      case 'AUTO':
        userPromptFinal = buildAutoModePrompt(contextBundle, viewsRequested)
        break
      case 'GUIDED':
        userPromptFinal = buildGuidedModePrompt(contextBundle, userPrompt || '', viewsRequested)
        break
      case 'REFINE':
        userPromptFinal = buildRefineModePrompt(contextBundle, userPrompt)
        break
      default:
        throw new Error(`Unknown sketch mode: ${mode}`)
    }

    // 7. Prepare input image if present
    let inputImage: { base64: string; mimeType: string } | undefined
    if (mode === 'REFINE' && uploadedImageBase64 && uploadedImageMimeType) {
      inputImage = { base64: uploadedImageBase64, mimeType: uploadedImageMimeType }
      
      // Save original uploaded image
      const originalFilename = `original_${sketchRecord.id}.${uploadedImageMimeType.split('/')[1] || 'png'}`
      const originalPath = path.join(SKETCH_UPLOAD_DIR, originalFilename)
      await fs.mkdir(SKETCH_UPLOAD_DIR, { recursive: true })
      await fs.writeFile(originalPath, Buffer.from(uploadedImageBase64, 'base64'))
      
      await prisma.sketchRecord.update({
        where: { id: sketchRecord.id },
        data: {
          originalImagePath: `/uploads/sketches/${originalFilename}`,
          originalImageFilename: originalFilename
        }
      })
    }

    // For MODIFY mode (sourceSketchId present), load source sketch image
    if (sourceSketchId && mode !== 'REFINE') {
      const sourceSketch = await prisma.sketchRecord.findUnique({
        where: { id: sourceSketchId }
      })
      if (sourceSketch?.imagePath) {
        const imagePath = path.join('public', sourceSketch.imagePath)
        try {
          const imageBuffer = await fs.readFile(imagePath)
          inputImage = {
            base64: imageBuffer.toString('base64'),
            mimeType: 'image/png'
          }
          userPromptFinal = buildModifyPrompt(
            contextBundle,
            userPrompt || 'Improve the sketch',
            sourceSketch.title,
            sourceSketch.description || undefined
          )
        } catch (e) {
          console.warn('[SketchService] Could not load source sketch image:', e)
        }
      }
    }

    // Store prompt for debugging
    await prisma.sketchRecord.update({
      where: { id: sketchRecord.id },
      data: { aiPromptUsed: userPromptFinal }
    })

    // 7.5. Load reference sketch images for visual style consistency
    let referenceImages: Array<{ base64: string; mimeType: string; title?: string }> = []
    if (referenceSketchIds && referenceSketchIds.length > 0) {
      console.log(`[SketchService] Loading ${referenceSketchIds.length} reference sketches for style consistency...`)
      const referenceSketches = await prisma.sketchRecord.findMany({
        where: {
          id: { in: referenceSketchIds },
          status: 'SUCCESS',
          isDeleted: false
        },
        select: { id: true, imagePath: true, title: true }
      })
      
      for (const refSketch of referenceSketches) {
        if (refSketch.imagePath) {
          const imagePath = path.join('public', refSketch.imagePath)
          try {
            const imageBuffer = await fs.readFile(imagePath)
            referenceImages.push({
              base64: imageBuffer.toString('base64'),
              mimeType: 'image/png',
              title: refSketch.title || undefined
            })
            console.log(`[SketchService] Loaded reference sketch: ${refSketch.title || refSketch.id}`)
          } catch (e) {
            console.warn(`[SketchService] Could not load reference sketch ${refSketch.id}:`, e)
          }
        }
      }

      // Add reference style instructions to prompt if we have reference images
      if (referenceImages.length > 0) {
        const refTitles = referenceImages.map(r => r.title).filter(Boolean).join(', ')
        userPromptFinal = `${userPromptFinal}

VISUAL STYLE REFERENCES:
The following ${referenceImages.length} image(s) are provided as VISUAL STYLE REFERENCES.
Maintain CONSISTENT visual style, line weight, shading technique, and overall aesthetic with these reference sketches${refTitles ? ` (${refTitles})` : ''}.
The new sketch should look like it belongs to the same set of figures as these references.`
      }
    }

    // 8. Generate sketch with gateway enforcement for policy/quota/metering
    // Title and description are already set from suggestion or user input
    const result = await generateSketchWithGemini(
      systemPrompt, 
      userPromptFinal, 
      modelCandidates, 
      inputImage,
      { tenantId, userId }, // Gateway context for DIAGRAM_GENERATION feature access
      referenceImages // Pass reference images for visual style consistency
    )

    // 9. Update record based on result
    if (result.success && result.imageBase64) {
      // Save generated image
      const filename = `sketch_${sketchRecord.id}_${Date.now()}.png`
      const filePath = path.join(SKETCH_UPLOAD_DIR, filename)
      await fs.mkdir(SKETCH_UPLOAD_DIR, { recursive: true })
      const imageBuffer = Buffer.from(result.imageBase64, 'base64')
      await fs.writeFile(filePath, imageBuffer)

      // Get image dimensions from buffer
      const imageSize = require('image-size').default || require('image-size')
      let width: number | undefined
      let height: number | undefined
      try {
        // Pass buffer directly to imageSize for more reliable parsing
        const dimensions = imageSize(imageBuffer)
        width = dimensions.width
        height = dimensions.height
      } catch (e) {
        console.warn('[SketchService] Could not get image dimensions:', e)
      }

      // Calculate checksum
      const checksum = crypto.createHash('sha256').update(imageBuffer).digest('hex')

      console.log(`[SketchService] Sketch generated successfully`)

      await prisma.sketchRecord.update({
        where: { id: sketchRecord.id },
        data: {
          status: 'SUCCESS',
          imagePath: `/uploads/sketches/${filename}`,
        imageFilename: filename,
        imageWidth: width,
        imageHeight: height,
        imageChecksum: checksum,
        tokensUsed: result.tokensUsed,
        attemptCount: { increment: 1 },
        aiModel: result.modelUsed || preferredModel
      }
    })

      return {
        success: true,
        sketchId: sketchRecord.id,
        imagePath: `/uploads/sketches/${filename}`,
        imageUrl: `/uploads/sketches/${filename}`,
        attemptCount: 1
      }

    } else {
      // Mark as failed
      await prisma.sketchRecord.update({
        where: { id: sketchRecord.id },
        data: {
          status: 'FAILED',
          errorMessage: result.error || 'Unknown error',
          attemptCount: { increment: 1 }
        }
      })

      return {
        success: false,
        sketchId: sketchRecord.id,
        error: result.error || 'Sketch generation failed',
        attemptCount: 1
      }
    }

  } catch (error) {
    // Update record with error
    await prisma.sketchRecord.update({
      where: { id: sketchRecord.id },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        attemptCount: { increment: 1 }
      }
    })

    return {
      success: false,
      sketchId: sketchRecord.id,
      error: error instanceof Error ? error.message : 'Unknown error during sketch generation'
    }
  }
}

// === SKETCH MANAGEMENT FUNCTIONS ===

/**
 * Lists all sketches for a patent/session.
 */
export async function listSketches(
  patentId: string,
  sessionId?: string,
  options?: {
    includeDeleted?: boolean
    favoritesOnly?: boolean
    limit?: number
    offset?: number
  }
) {
  const where: any = {
    patentId,
    ...(sessionId && { sessionId }),
    ...(!options?.includeDeleted && { isDeleted: false }),
    ...(options?.favoritesOnly && { isFavorite: true })
  }

  const sketches = await prisma.sketchRecord.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: options?.limit || 50,
    skip: options?.offset || 0,
    include: {
      sourceSketch: {
        select: { id: true, title: true }
      }
    }
  })

  return sketches
}

/**
 * Gets a single sketch by ID.
 */
export async function getSketch(sketchId: string) {
  return prisma.sketchRecord.findUnique({
    where: { id: sketchId },
    include: {
      sourceSketch: true,
      derivedSketches: {
        select: { id: true, title: true, createdAt: true }
      }
    }
  })
}

/**
 * Deletes a sketch (soft delete).
 */
export async function deleteSketch(sketchId: string, userId: string): Promise<{ success: boolean; error?: string }> {
  const sketch = await prisma.sketchRecord.findUnique({
    where: { id: sketchId },
    include: { session: true }
  })

  if (!sketch) {
    return { success: false, error: 'Sketch not found' }
  }

  // Verify ownership via session
  if (sketch.session && sketch.session.userId !== userId) {
    return { success: false, error: 'Access denied' }
  }

  await prisma.sketchRecord.update({
    where: { id: sketchId },
    data: { isDeleted: true }
  })

  return { success: true }
}

/**
 * Toggles favorite status.
 */
export async function toggleSketchFavorite(sketchId: string): Promise<{ success: boolean; isFavorite?: boolean }> {
  const sketch = await prisma.sketchRecord.findUnique({
    where: { id: sketchId }
  })

  if (!sketch) {
    return { success: false }
  }

  const updated = await prisma.sketchRecord.update({
    where: { id: sketchId },
    data: { isFavorite: !sketch.isFavorite }
  })

  return { success: true, isFavorite: updated.isFavorite }
}

/**
 * Updates sketch metadata (title, description).
 */
export async function updateSketchMetadata(
  sketchId: string,
  data: { title?: string; description?: string }
): Promise<{ success: boolean }> {
  await prisma.sketchRecord.update({
    where: { id: sketchId },
    data
  })

  return { success: true }
}

/**
 * Retries a failed sketch generation.
 */
export async function retrySketchGeneration(
  sketchId: string,
  userId: string,
  tenantId?: string
): Promise<SketchGenerationResult> {
  const sketch = await prisma.sketchRecord.findUnique({
    where: { id: sketchId }
  })

  if (!sketch) {
    return { success: false, error: 'Sketch not found' }
  }

  if (sketch.status !== 'FAILED') {
    return { success: false, error: 'Can only retry failed sketches' }
  }

  // Create a new generation request from the existing sketch
  return generateSketch({
    patentId: sketch.patentId,
    sessionId: sketch.sessionId || undefined,
    mode: sketch.mode as SketchMode,
    title: sketch.title,
    userPrompt: sketch.userPrompt || undefined,
    contextFlags: sketch.contextFlags as SketchContextFlags,
    viewsRequested: sketch.viewsRequested as SketchViewConfig,
    sourceSketchId: sketch.sourceSketchId || undefined
  }, userId, tenantId)
}

// === SKETCH SUGGESTION FUNCTIONS ===

export interface SketchSuggestion {
  title: string
  description: string
}

/**
 * Creates sketch suggestion records from LLM-generated suggestions.
 * These are placeholders without images - user must explicitly generate.
 */
export async function createSketchSuggestions(
  patentId: string,
  sessionId: string,
  suggestions: SketchSuggestion[]
): Promise<{ created: number; sketchIds: string[] }> {
  const sketchIds: string[] = []
  
  for (const suggestion of suggestions) {
    // Validate suggestion has required fields
    if (!suggestion.title || !suggestion.description) {
      console.warn('[SketchService] Skipping invalid suggestion:', suggestion)
      continue
    }
    
    const sketch = await prisma.sketchRecord.create({
      data: {
        patentId,
        sessionId,
        mode: 'AUTO',
        status: 'SUGGESTED',
        title: suggestion.title.trim(),
        description: suggestion.description.trim(),
        attemptCount: 0
      }
    })
    
    sketchIds.push(sketch.id)
  }
  
  console.log(`[SketchService] Created ${sketchIds.length} sketch suggestions`)
  return { created: sketchIds.length, sketchIds }
}

/**
 * Generates image for a SUGGESTED sketch.
 * Uses the pre-defined title and description for focused image generation.
 */
export async function generateFromSuggestion(
  sketchId: string,
  userId: string,
  tenantId?: string
): Promise<SketchGenerationResult> {
  const sketch = await prisma.sketchRecord.findUnique({
    where: { id: sketchId },
    include: { session: true }
  })

  if (!sketch) {
    return { success: false, error: 'Sketch suggestion not found' }
  }

  if (sketch.status !== 'SUGGESTED' && sketch.status !== 'FAILED') {
    return { success: false, error: 'Can only generate from SUGGESTED or FAILED sketches' }
  }

  // Verify ownership
  if (sketch.session && sketch.session.userId !== userId) {
    return { success: false, error: 'Access denied' }
  }

  // Mark as pending
  await prisma.sketchRecord.update({
    where: { id: sketchId },
    data: { status: 'PENDING' }
  })

  try {
    // Build context bundle from session
    const contextBundle = await buildSketchContextBundle(
      sketch.patentId,
      sketch.sessionId || undefined,
      { useIdeaSummary: true, useClaims: true, useDiagrams: true, useComponents: true }
    )
    
    // Resolve model from database (no hardcoded fallbacks)
    const modelCandidates = await resolveSketchModelCandidates(tenantId)
    
    if (modelCandidates.length === 0) {
      await prisma.sketchRecord.update({
        where: { id: sketchId },
        data: {
          status: 'FAILED',
          errorMessage: 'No sketch generation model configured'
        }
      })
      return {
        success: false,
        sketchId,
        error: 'No sketch generation model configured. Please configure a model for "Sketch Generation" stage in Super Admin → LLM Config.'
      }
    }
    
    const preferredModel = modelCandidates[0]
    console.log(`[SketchService] Using model for suggestion: ${preferredModel}`)

    // Build focused prompt using the suggestion's title and description (pass numbering style for patent-type-aware labeling)
    const systemPrompt = buildSystemPrompt(contextBundle.numberingStyle)
    const userPrompt = buildPromptFromSuggestion(contextBundle, sketch.title, sketch.description || '')

    // Store prompt for debugging
    await prisma.sketchRecord.update({
      where: { id: sketchId },
      data: { aiPromptUsed: userPrompt }
    })

    // Generate image with gateway enforcement for policy/quota/metering
    const result = await generateSketchWithGemini(
      systemPrompt, 
      userPrompt, 
      modelCandidates,
      undefined, // No input image for suggestions
      { tenantId, userId } // Gateway context for DIAGRAM_GENERATION feature access
    )

    if (result.success && result.imageBase64) {
      // Save generated image
      const filename = `sketch_${sketchId}_${Date.now()}.png`
      const filePath = path.join(SKETCH_UPLOAD_DIR, filename)
      await fs.mkdir(SKETCH_UPLOAD_DIR, { recursive: true })
      const imageBuffer = Buffer.from(result.imageBase64, 'base64')
      await fs.writeFile(filePath, imageBuffer)

      // Get image dimensions
      const imageSize = require('image-size').default || require('image-size')
      let width: number | undefined
      let height: number | undefined
      try {
        const dimensions = imageSize(imageBuffer)
        width = dimensions.width
        height = dimensions.height
      } catch (e) {
        console.warn('[SketchService] Could not get image dimensions:', e)
      }

      // Calculate checksum
      const checksum = crypto.createHash('sha256').update(imageBuffer).digest('hex')

      await prisma.sketchRecord.update({
        where: { id: sketchId },
        data: {
          status: 'SUCCESS',
          imagePath: `/uploads/sketches/${filename}`,
          imageFilename: filename,
          imageWidth: width,
          imageHeight: height,
          imageChecksum: checksum,
          tokensUsed: result.tokensUsed,
          attemptCount: { increment: 1 },
          aiModel: result.modelUsed || preferredModel
        }
      })

      return {
        success: true,
        sketchId,
        imagePath: `/uploads/sketches/${filename}`,
        imageUrl: `/uploads/sketches/${filename}`,
        attemptCount: 1
      }
    } else {
      // Mark as failed
      await prisma.sketchRecord.update({
        where: { id: sketchId },
        data: {
          status: 'FAILED',
          errorMessage: result.error || 'Unknown error',
          attemptCount: { increment: 1 }
        }
      })

      return {
        success: false,
        sketchId,
        error: result.error || 'Image generation failed',
        attemptCount: 1
      }
    }
  } catch (error) {
    // Mark as failed on exception
    await prisma.sketchRecord.update({
      where: { id: sketchId },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        attemptCount: { increment: 1 }
      }
    })

    return {
      success: false,
      sketchId,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Builds a focused prompt from a sketch suggestion.
 * Uses the pre-defined title and description along with full invention context.
 * 
 * STRICT PATENT-DRAFTING MODE:
 * - No invention of new components beyond the official registry
 * - Existing diagrams are the source of truth for relationships
 * - No creative fill-in of missing details
 */
function buildPromptFromSuggestion(
  context: SketchContextBundle,
  title: string,
  description: string
): string {
  let prompt = `Generate a USPTO/EPO/WIPO-compliant patent line drawing under STRICT patent-drafting conventions.

═══════════════════════════════════════════════════════════════════════════════
STRICT PATENT-DRAFTING CONSTRAINTS (MANDATORY)
═══════════════════════════════════════════════════════════════════════════════
1. DO NOT INVENT: Never add components, sub-components, features, or relationships
   not explicitly listed in the OFFICIAL COMPONENT REGISTRY below.

2. NO CREATIVE FILL-IN: If physical details are missing or ambiguous, use
   simplified block/schematic representation. Do NOT guess or extrapolate.

3. INTERNAL CONSISTENCY: This sketch must be fully consistent with any existing
   PlantUML diagrams. Do not contradict, extend, or reinterpret any defined
   entity, hierarchy, connection, or interaction.

4. PRESERVE EXACTLY: Every component name, numeral, and relationship must match
   the authoritative invention facts. No renaming, no re-numbering.

${buildLanguageRequirementSection(context)}
═══════════════════════════════════════════════════════════════════════════════
FIGURE TO GENERATE
═══════════════════════════════════════════════════════════════════════════════
Title: ${title}
Description: ${description}

═══════════════════════════════════════════════════════════════════════════════
AUTHORITATIVE INVENTION CONTEXT (Source of Truth)
═══════════════════════════════════════════════════════════════════════════════
${context.ideaSummary}

INVENTION TYPE: ${context.inventionType}

`

  if (context.keyComponents.length > 0) {
    prompt += `═══════════════════════════════════════════════════════════════════════════════
OFFICIAL COMPONENT REGISTRY (Use ONLY these - NO additions allowed)
═══════════════════════════════════════════════════════════════════════════════
${context.keyComponents.map(c => `• ${c}`).join('\n')}

CRITICAL: Every component in your drawing MUST exist in this registry.
Do NOT add sub-components, internal parts, or details not listed above.

`
  }

  if (Object.keys(context.referenceNumerals).length > 0) {
    prompt += `═══════════════════════════════════════════════════════════════════════════════
OFFICIAL REFERENCE LABELS (Use EXACTLY these labels)
═══════════════════════════════════════════════════════════════════════════════
${Object.entries(context.referenceNumerals).map(([label, name]) => `${label} → ${name}`).join('\n')}

LABELING RULES:
• Use ONLY the reference labels shown above (e.g., 100/200 for products, S100/S200 for processes, (a)/(b) for compositions)
• NO text labels, part names, or descriptions in the drawing
• NO invented labels for unlisted components
• Each label must point to exactly the component it represents

`
  }

  if (context.claims.length > 0) {
    prompt += `═══════════════════════════════════════════════════════════════════════════════
KEY CLAIMS (Structural reference - do not add elements beyond these)
═══════════════════════════════════════════════════════════════════════════════
${context.claims.join('\n')}

`
  }

  if (context.diagramSummaries.length > 0) {
    prompt += `═══════════════════════════════════════════════════════════════════════════════
CONTROLLING PLANTUML DIAGRAMS (Maintain consistency)
═══════════════════════════════════════════════════════════════════════════════
${context.diagramSummaries.join('\n')}

These diagrams define the authoritative structure of the invention.
Preserve EXACTLY: every entity, label, and explicitly defined physical relationship.
Logical or signal interactions in PlantUML do NOT imply physical attachment unless stated.
Do NOT contradict or extend what is shown.

`
  }

  prompt += `═══════════════════════════════════════════════════════════════════════════════
DRAWING REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════
Generate the sketch as described in the title and description above.

VIEW REQUIREMENTS:
1. MAIN VIEW: Primary view as specified in the description
2. SECONDARY VIEW: Cross-section, alternate angle, or detail view if appropriate
   (Only if it reveals components/relationships from the official registry)

REPRESENTATION RULES:
• Show ONLY components from the Official Component Registry
• Show ONLY relationships explicitly defined in invention context or diagrams
• Use simplified/schematic representation for any ambiguous physical details
• When in doubt between detailed and simple → choose SIMPLE + ACCURATE

═══════════════════════════════════════════════════════════════════════════════
VALIDATION CHECKLIST (Self-verify before output)
═══════════════════════════════════════════════════════════════════════════════
✔ Every component shown exists in Official Component Registry
✔ Every relationship shown is explicitly defined in invention facts
✔ Numeric labels match exactly the Official Reference Numerals
✔ No invented components, sub-parts, or internal details added
✔ Consistent with all existing PlantUML diagrams
✔ Solid lines for visible features, dashed for internal/hidden only
✔ No text labels, shading, gradients, or decorative elements
✔ No flowchart or process diagram elements

If ANY validation fails → simplify until fully compliant.
If a requested view cannot be drawn without inventing details → use simplified block representation.`

  return prompt
}

/**
 * Clears all SUGGESTED sketches for a session (e.g., before regenerating suggestions).
 */
export async function clearSketchSuggestions(sessionId: string): Promise<{ deleted: number }> {
  const result = await prisma.sketchRecord.deleteMany({
    where: {
      sessionId,
      status: 'SUGGESTED'
    }
  })
  
  console.log(`[SketchService] Cleared ${result.count} sketch suggestions for session ${sessionId}`)
  return { deleted: result.count }
}
