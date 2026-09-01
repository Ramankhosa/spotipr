/**
 * Stage Navigation Configuration
 * 
 * This file defines the STRUCTURE of stages and sub-stages.
 * All actual DATA (jurisdictions, sections, completion status) comes from:
 * - session object (from database)
 * - API calls to /api/sections/by-jurisdiction
 * - CountryProfile/CountrySectionMapping tables
 * 
 * NO HARDCODED DATA - everything is dynamic and database-driven.
 */

import {
  Lightbulb,
  Search,
  Scale,
  Layers,
  PenTool,
  FileText,
  CheckCircle,
  Download,
  Bot,
  Upload,
  Grid3X3,
  ListOrdered,
  Hash,
  Globe,
  Brain,
  CheckSquare,
  FileCheck,
  Edit3,
  Lock,
  List,
  ListChecks,
  Zap,
  type LucideIcon
} from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

export type SubStageStatus = 'completed' | 'in_progress' | 'pending' | 'skipped'

// ============================================================================
// Safe Helpers
// ============================================================================

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function extractReferenceMapComponents(value: unknown): any[] {
  const parsed = typeof value === 'string' ? safeJsonParse<any>(value, null) : value
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).components)) {
    return (parsed as any).components
  }
  return []
}

export interface SubStageDefinition {
  key: string
  label: string
  icon: LucideIcon
  description: string
  required: boolean
  /** Function to derive status from session data */
  getStatus: (session: any) => SubStageStatus
}

export interface StageDefinition {
  key: string
  label: string
  icon: LucideIcon
  description: string
  /** Static sub-stages (defined here) */
  subStages: SubStageDefinition[]
  /** Whether this stage has dynamic sub-stages (e.g., jurisdictions) */
  hasDynamicSubStages?: boolean
  /** Progress weight for overall calculation */
  weight: number
}

export interface JurisdictionSectionInfo {
  key: string
  label: string
  displayOrder: number
  isRequired: boolean
  status: SubStageStatus
  wordCount?: number
}

export interface JurisdictionDraftInfo {
  code: string
  name: string
  sections: JurisdictionSectionInfo[]
  completedCount: number
  totalCount: number
  status: SubStageStatus
}

// ============================================================================
// Stage Definitions (Structure Only - No Hardcoded Data)
// ============================================================================

export const STAGE_DEFINITIONS: StageDefinition[] = [
  {
    key: 'IDEA_ENTRY',
    label: 'Invention Structure',
    icon: Lightbulb,
    description: 'Define and review your invention structure',
    weight: 10,
    subStages: [
      {
        key: 'invention_details',
        label: 'Invention Details',
        icon: FileText,
        description: 'Problem, objectives, and approach',
        required: true,
        getStatus: (session) => {
          const idea = session?.ideaRecord?.normalizedData || {}
          const hasProblem = !!idea.problem?.trim()
          const hasObjectives = !!idea.objectives?.trim()
          if (hasProblem && hasObjectives) return 'completed'
          if (hasProblem || hasObjectives) return 'in_progress'
          return 'pending'
        }
      },
      {
        key: 'components',
        label: 'Components',
        icon: Layers,
        description: 'System components and modules',
        required: false,
        getStatus: (session) => {
          const components = session?.ideaRecord?.components
          if (Array.isArray(components) && components.length > 0) return 'completed'
          return 'pending'
        }
      },
      {
        key: 'classification',
        label: 'Classification Codes',
        icon: Hash,
        description: 'CPC/IPC codes for patent search',
        required: false,
        getStatus: (session) => {
          const idea = session?.ideaRecord
          const hasCpc = Array.isArray(idea?.cpcCodes) && idea.cpcCodes.length > 0
          const hasIpc = Array.isArray(idea?.ipcCodes) && idea.ipcCodes.length > 0
          return (hasCpc || hasIpc) ? 'completed' : 'pending'
        }
      },
      {
        key: 'jurisdiction_select',
        label: 'Jurisdiction Selection',
        icon: Globe,
        description: 'Target filing countries',
        required: true,
        getStatus: (session) => {
          const jurisdictions = session?.draftingJurisdictions || []
          return jurisdictions.length > 0 ? 'completed' : 'pending'
        }
      }
    ]
  },
  {
    key: 'PRELIMINARY_CLAIMS',
    label: 'Preliminary Claims',
    icon: Scale,
    description: 'Generate and review initial patent claims',
    weight: 12,
    subStages: [
      {
        key: 'claims_draft',
        label: 'Claims Draft',
        icon: Scale,
        description: 'Generate jurisdiction-aware claims',
        required: true,
        getStatus: (session) => {
          const normalized = session?.ideaRecord?.normalizedData || {}
          const hasClaims = !!normalized.claims || !!normalized.claimsProvisional
          if (hasClaims) return 'completed'
          return 'pending'
        }
      }
      // No freeze sub-stage: the saved claim set feeds downstream drafting directly.
    ]
  },
  {
    key: 'RELATED_ART',
    label: 'Prior Art Analysis',
    icon: Search,
    description: 'Search and analyze related patents',
    weight: 15,
    subStages: [
      {
        key: 'search',
        label: 'Patent Search',
        icon: Search,
        description: 'Run AI-powered patent search',
        required: true,
        getStatus: (session) => {
          const config = session?.priorArtConfig || {}
          if (config.skipped) return 'skipped'
          const runs = session?.relatedArtRuns || []
          const hasResults = runs.some((r: any) => {
            const results = r.resultsJson || r.results
            return Array.isArray(results) && results.length > 0
          })
          if (hasResults) return 'completed'
          if (runs.length > 0) return 'in_progress'
          return 'pending'
        }
      },
      {
        key: 'analyze',
        label: 'AI Analysis',
        icon: Brain,
        description: 'Review novelty and threat assessment',
        required: false,
        getStatus: (session) => {
          const config = session?.priorArtConfig || {}
          if (config.skipped) return 'skipped'
          const hasAnalysis = !!session?.aiAnalysisData && Object.keys(session.aiAnalysisData).length > 0
          return hasAnalysis ? 'completed' : 'pending'
        }
      },
      {
        key: 'select_prior_art',
        label: 'Select for Drafting',
        icon: CheckSquare,
        description: 'Select patents for background section',
        required: true,
        getStatus: (session) => {
          const config = session?.priorArtConfig || {}
          if (config.skipped) return 'skipped'
          const draftConfig = config.priorArtForDrafting || {}
          const hasSelections =
            (session?.relatedArtSelections || []).length > 0 ||
            (Array.isArray(draftConfig.selectedPatents) && draftConfig.selectedPatents.length > 0)
          const hasManual =
            !!session?.manualPriorArt?.manualPriorArtText ||
            (!!draftConfig.manualText && draftConfig.manualText.trim().length > 0)
          if (hasSelections || hasManual) return 'completed'
          return 'pending'
        }
      },
      {
        key: 'select_claim_ref',
        label: 'Select for Claims',
        icon: FileCheck,
        description: 'Select patents for claim comparison',
        required: false,
        getStatus: (session) => {
          const config = session?.priorArtConfig || {}
          if (config.skipped || config.skippedClaimRefinement) return 'skipped'
          const claimConfig = config.claimRefinementConfig || {}
          const hasSelections = (claimConfig.selectedPatents || []).length > 0
          return hasSelections ? 'completed' : 'pending'
        }
      }
    ]
  },
  {
    key: 'CLAIM_REFINEMENT',
    label: 'Claim Refinement',
    icon: Scale,
    description: 'Refine claims based on prior art',
    weight: 15,
    subStages: [
      {
        key: 'patent_selection',
        label: 'Reference Patents',
        icon: List,
        description: 'Patents selected for comparison',
        required: true,
        getStatus: (session) => {
          const config = session?.priorArtConfig || {}
          if (config.skippedClaimRefinement) return 'skipped'
          const claimConfig = config.claimRefinementConfig || {}
          return (claimConfig.selectedPatents || []).length > 0 ? 'completed' : 'pending'
        }
      },
      {
        key: 'ai_analysis',
        label: 'AI Comparison',
        icon: Zap,
        description: 'AI analyzes claims vs prior art',
        required: true,
        getStatus: (session) => {
          const config = session?.priorArtConfig || {}
          if (config.skippedClaimRefinement) return 'skipped'
          const normalized = session?.ideaRecord?.normalizedData || {}
          return !!normalized.claimsRefinementPreview ? 'completed' : 'pending'
        }
      },
      {
        key: 'claim_editing',
        label: 'Claim Editing',
        icon: Edit3,
        description: 'Review and modify suggested changes',
        required: false,
        getStatus: (session) => {
          const config = session?.priorArtConfig || {}
          if (config.skippedClaimRefinement) return 'skipped'
          const normalized = session?.ideaRecord?.normalizedData || {}
          const hasRefinedClaims = !!normalized.claimsFinal || !!normalized.claimsRefinementApplied
          return hasRefinedClaims ? 'completed' : 'pending'
        }
      },
      {
        key: 'approval',
        label: 'Finalize Claims',
        icon: Lock,
        description: 'Settle the claim set drafting will use',
        required: true,
        getStatus: (session) => {
          const config = session?.priorArtConfig || {}
          if (config.skippedClaimRefinement) return 'skipped'
          const normalized = session?.ideaRecord?.normalizedData || {}

          // Complete once refinement has actually produced a claim set — either applied
          // changes or an explicit lock. Freezing on its own is no longer the signal,
          // since drafting reads the saved claims whether or not they are locked.
          const refinementApplied = !!normalized.claimsRefinementApplied || !!normalized.claimsFinal
          return refinementApplied ? 'completed' : 'pending'
        }
      }
    ]
  },
  {
    key: 'COMPONENT_PLANNER',
    label: 'Component Planner',
    icon: Layers,
    description: 'Define system components and reference numerals',
    weight: 15,
    subStages: [
      {
        key: 'components_list',
        label: 'Define Components',
        icon: List,
        description: 'Name and describe each component',
        required: true,
        getStatus: (session) => {
          const components = session?.referenceMap?.components
          if (!components) return 'pending'
          const parsed = extractReferenceMapComponents(components)
          return parsed.length > 0 ? 'completed' : 'pending'
        }
      },
      {
        key: 'numeral_assignment',
        label: 'Assign Numerals',
        icon: Hash,
        description: 'Reference numbers (100, 102, etc.)',
        required: true,
        getStatus: (session) => {
          const components = session?.referenceMap?.components
          if (!components) return 'pending'
          const parsed = extractReferenceMapComponents(components)
          if (parsed.length === 0) return 'pending'
          const allHaveNumerals = parsed.every((c: any) => c.referenceLabel || (c.numeral !== undefined && c.numeral !== null))
          return allHaveNumerals ? 'completed' : 'in_progress'
        }
      },
      {
        key: 'validation',
        label: 'Validation',
        icon: CheckCircle,
        description: 'Ensure no conflicts or duplicates',
        required: true,
        getStatus: (session) => {
          return session?.referenceMap?.isValid ? 'completed' : 'pending'
        }
      }
    ]
  },
  {
    key: 'FIGURE_PLANNER',
    label: 'Figure Planner',
    icon: PenTool,
    description: 'Plan patent illustrations and diagrams',
    weight: 15,
    subStages: [
      {
        key: 'ai_generation',
        label: 'AI Diagrams',
        icon: Bot,
        description: 'Generate PlantUML diagrams',
        required: false,
        getStatus: (session) => {
          if (session?.figuresSkipped) return 'skipped'
          const diagrams = session?.diagramSources || []
          return diagrams.length > 0 ? 'completed' : 'pending'
        }
      },
      {
        key: 'upload_sketches',
        label: 'Upload Sketches',
        icon: Upload,
        description: 'Add hand-drawn figures',
        required: false,
        getStatus: (session) => {
          if (session?.figuresSkipped) return 'skipped'
          const sketches = session?.sketchRecords || []
          return sketches.filter((s: any) => s.status === 'SUCCESS' && !s.isDeleted).length > 0 
            ? 'completed' 
            : 'pending'
        }
      },
      {
        key: 'arrangement',
        label: 'Arrange Figures',
        icon: Grid3X3,
        description: 'Order and organize figures',
        required: true,
        getStatus: (session) => {
          if (session?.figuresSkipped) return 'skipped'
          const hasSequence = Array.isArray(session?.figureSequence) && session.figureSequence.length > 0
          return hasSequence ? 'completed' : 'pending'
        }
      },
      {
        key: 'numbering_finalize',
        label: 'Finalize Numbering',
        icon: ListOrdered,
        description: 'Lock figure numbers',
        required: true,
        getStatus: (session) => {
          if (session?.figuresSkipped) return 'skipped'
          return session?.figureSequenceFinalized ? 'completed' : 'pending'
        }
      }
    ]
  },
  {
    key: 'ANNEXURE_DRAFT',
    label: 'Drafting & Export',
    icon: FileText,
    description: 'Draft patents and export documents',
    weight: 25,
    hasDynamicSubStages: true, // Jurisdictions are loaded from database
    subStages: [
      // Static sub-stages for Review and Export
      // Jurisdiction drafts are added dynamically
      {
        key: 'ai_review',
        label: 'AI Review',
        icon: Bot,
        description: 'AI-powered draft review',
        required: false,
        getStatus: (session) => {
          const reviews = session?.aiReviews || []
          if (reviews.length === 0) return 'pending'
          
          // For multi-jurisdiction: check if at least ONE selected jurisdiction has a review
          const selectedJurisdictions = (session?.draftingJurisdictions || [])
            .map((j: string) => (j || '').toUpperCase())
            .filter(Boolean)
          
          if (selectedJurisdictions.length === 0) {
            // No jurisdictions selected yet, any review counts
            return reviews.length > 0 ? 'completed' : 'pending'
          }
          
          // Check if any selected jurisdiction has a review
          const hasReviewForSelectedJurisdiction = reviews.some((r: any) => 
            selectedJurisdictions.includes((r.jurisdiction || '').toUpperCase())
          )
          
          return hasReviewForSelectedJurisdiction ? 'completed' : 'pending'
        }
      },
      {
        key: 'coverage',
        label: 'Check Coverage',
        icon: ListChecks,
        description: 'Trace the draft back to the disclosure',
        required: false,
        getStatus: (session) => {
          // "Engaged with" rather than "passed": the coverage percentage needs a
          // fresh report, but review marks are a durable record that the
          // attorney worked the list.
          const drafts = session?.annexureDrafts || []
          const hasMarks = drafts.some((draft: any) => {
            const review = draft?.extraSections?._coverageReview
            return review && typeof review === 'object' && Object.keys(review).length > 0
          })
          return hasMarks ? 'completed' : 'pending'
        }
      },
      {
        key: 'export',
        label: 'Export Documents',
        icon: Download,
        description: 'Generate final documents',
        required: true,
        getStatus: (session) => {
          // Export is "completed" when session is marked complete
          // OR when at least one jurisdiction draft has substantial content
          if (session?.completedAt) return 'completed'
          
          const drafts = session?.annexureDrafts || []
          if (drafts.length === 0) return 'pending'
          
          // Check if any jurisdiction draft has key sections filled
          // Using direct column access (database is source of truth for column names)
          const hasExportableDraft = drafts.some((draft: any) => {
            // Check essential sections that indicate a draft is ready for export
            const hasDetailedDescription = typeof draft.detailedDescription === 'string' &&
              draft.detailedDescription.replace(/<[^>]*>/g, '').trim().split(/\s+/).filter(Boolean).length >= 50
            
            const hasClaims = typeof draft.claims === 'string' &&
              draft.claims.replace(/<[^>]*>/g, '').trim().split(/\s+/).filter(Boolean).length >= 20
            
            return hasDetailedDescription && hasClaims
          })
          
          return hasExportableDraft ? 'completed' : 'pending'
        }
      }
    ]
  }
]

// ============================================================================
// Stage Order (for navigation logic)
// ============================================================================

export const STAGE_ORDER = STAGE_DEFINITIONS.map(s => s.key)

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get visible stages based on skip configuration
 */
export function getVisibleStages(session: any): StageDefinition[] {
  const priorArtSkipped = !!session?.priorArtConfig?.skipped
  const claimRefinementSkipped = !!session?.priorArtConfig?.skippedClaimRefinement

  return STAGE_DEFINITIONS.filter(stage => {
    if (priorArtSkipped && stage.key === 'RELATED_ART') return false
    if (claimRefinementSkipped && stage.key === 'CLAIM_REFINEMENT') return false
    return true
  })
}

/**
 * Calculate sub-stage completion for a stage
 */
export function calculateStageCompletion(stage: StageDefinition, session: any): {
  completedCount: number
  totalCount: number
  requiredCompleted: number
  requiredTotal: number
  percentage: number
} {
  const statuses = stage.subStages.map(sub => ({
    status: sub.getStatus(session),
    required: sub.required
  }))

  const completedCount = statuses.filter(s => s.status === 'completed').length
  const totalCount = statuses.filter(s => s.status !== 'skipped').length
  const requiredCompleted = statuses.filter(s => s.required && s.status === 'completed').length
  const requiredTotal = statuses.filter(s => s.required && s.status !== 'skipped').length

  return {
    completedCount,
    totalCount,
    requiredCompleted,
    requiredTotal,
    percentage: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  }
}

/**
 * Get section completion status from annexure drafts
 * 
 * Uses CountrySectionMapping.sectionKey (from database) as the ONLY source of truth.
 * The sectionKey is the canonical key that matches:
 * - Direct columns on AnnexureDraft (e.g., fieldOfInvention, claims)
 * - Keys in extraSections JSON (e.g., objectsOfInvention, preamble)
 * 
 * NO hardcoded lists or fuzzy matching - trust the database mapping.
 */
export function getSectionCompletionStatus(
  session: any,
  jurisdictionCode: string,
  sectionKey: string
): { status: SubStageStatus; wordCount: number } {
  const drafts = session?.annexureDrafts || []
  
  // Find the latest draft for this jurisdiction (drafts are ordered by version desc)
  const jurisdictionDraft = drafts.find((d: any) => 
    d.jurisdiction?.toUpperCase() === jurisdictionCode.toUpperCase()
  )

  if (!jurisdictionDraft) {
    return { status: 'pending', wordCount: 0 }
  }

  let content = ''

  // 1. Check direct column on annexure draft (the sectionKey IS the column name)
  if (jurisdictionDraft[sectionKey] !== undefined && jurisdictionDraft[sectionKey] !== null) {
    content = jurisdictionDraft[sectionKey]
  }

  // 2. Check extraSections JSON (for sections not in legacy columns)
  if (!content) {
    const extraSections = typeof jurisdictionDraft.extraSections === 'string'
      ? safeJsonParse<Record<string, any>>(jurisdictionDraft.extraSections, {})
      : (jurisdictionDraft.extraSections || {})

    if (extraSections[sectionKey]) {
      content = extraSections[sectionKey]
    }
  }

  // 3. Check validationReport.extraSections (fallback storage location)
  if (!content) {
    const validationExtraSections = jurisdictionDraft.validationReport?.extraSections
    const parsed = typeof validationExtraSections === 'string'
      ? safeJsonParse<Record<string, any>>(validationExtraSections, {})
      : (validationExtraSections || {})

    if (parsed[sectionKey]) {
      content = parsed[sectionKey]
    }
  }

  // Calculate word count (strip HTML tags)
  const trimmed = typeof content === 'string' ? content.replace(/<[^>]*>/g, '').trim() : ''
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length

  if (wordCount >= 20) return { status: 'completed', wordCount }
  if (wordCount > 0) return { status: 'in_progress', wordCount }
  return { status: 'pending', wordCount: 0 }
}

/**
 * Determine overall stage status
 */
export function getStageStatus(
  stage: StageDefinition,
  session: any,
  currentStage: string
): 'completed' | 'current' | 'pending' | 'skipped' {
  const currentIndex = STAGE_ORDER.indexOf(currentStage)
  const stageIndex = STAGE_ORDER.indexOf(stage.key)

  // Check if skipped
  const priorArtSkipped = !!session?.priorArtConfig?.skipped
  const claimRefinementSkipped = !!session?.priorArtConfig?.skippedClaimRefinement

  if (priorArtSkipped && stage.key === 'RELATED_ART') return 'skipped'
  if (claimRefinementSkipped && stage.key === 'CLAIM_REFINEMENT') return 'skipped'

  // Current stage
  if (stage.key === currentStage) return 'current'

  // Past stages
  if (stageIndex < currentIndex) return 'completed'

  // Future stages
  return 'pending'
}

/**
 * Calculate overall progress across all stages
 */
export function calculateOverallProgress(session: any, currentStage: string): number {
  const visibleStages = getVisibleStages(session)
  const currentIndex = visibleStages.findIndex(s => s.key === currentStage)
  
  if (currentIndex === -1) return 0

  let totalWeight = 0
  let completedWeight = 0

  visibleStages.forEach((stage, index) => {
    totalWeight += stage.weight

    if (index < currentIndex) {
      // Fully completed stages
      completedWeight += stage.weight
    } else if (index === currentIndex) {
      // Current stage - partial completion
      const completion = calculateStageCompletion(stage, session)
      completedWeight += (stage.weight * completion.percentage) / 100
    }
  })

  return totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0
}
