'use client'

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles,
  Lock,
  Unlock,
  ChevronDown,
  ChevronRight,
  Edit2,
  Check,
  RefreshCw,
  AlertCircle,
  Globe,
  Lightbulb,
  Scale,
  Info,
  Trash2,
  FileSearch,
  ShieldCheck,
  BookOpen,
  GitBranch,
  Layers3,
  CheckCircle2,
  FileText
} from 'lucide-react'
import { ClaimsEditor, RichTextEditorRef } from '@/components/ui/rich-text-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import PersonaManager, { type PersonaSelection } from '@/components/drafting/PersonaManager'
import { useAuth } from '@/lib/auth-context'
import {
  stripTrailingClaimDependencyLabel,
  stripTrailingClaimDependencyLabelsFromHtml
} from '@/lib/draft-claims-parser'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PreliminaryClaimsStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

interface Claim {
  number: number
  type: 'independent' | 'dependent'
  dependsOn?: number
  text: string
  category?: 'method' | 'system' | 'apparatus' | 'composition' | 'product'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Tooltip = ({ children, content, position = 'bottom' }: { children: React.ReactNode; content: string; position?: 'top' | 'bottom' | 'left' | 'right' }) => (
  <div className="relative group">
    {children}
    <div className={`absolute z-50 hidden group-hover:block px-3 py-2 text-xs text-white bg-gray-900 rounded-lg shadow-lg whitespace-normal max-w-xs pointer-events-none
      ${position === 'bottom' ? 'top-full mt-2 left-1/2 -translate-x-1/2' : ''}
      ${position === 'top' ? 'bottom-full mb-2 left-1/2 -translate-x-1/2' : ''}
      ${position === 'left' ? 'right-full mr-2 top-1/2 -translate-y-1/2' : ''}
      ${position === 'right' ? 'left-full ml-2 top-1/2 -translate-y-1/2' : ''}
    `}>
      {content}
    </div>
  </div>
)

const parseClaimsFromHtml = (html: string): Claim[] => {
  if (!html || html.trim() === '' || html === '<p></p>') return []

  const claims: Claim[] = []
  const blocks = html.split(/<\/p>/i)

  blocks.forEach((block) => {
    const plain = block.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!plain) return

    const match = plain.match(/^(\d+)\.?\s*(.+)$/)
    if (match) {
      const number = Number(match[1])
      const text = stripTrailingClaimDependencyLabel(match[2].trim())

      const depMatch = text.match(/(?:claim|claims?)\s+(\d+)/i)
      const dependsOn = depMatch ? Number(depMatch[1]) : undefined

      claims.push({
        number,
        text,
        type: number === 1 || !dependsOn ? 'independent' : 'dependent',
        dependsOn: number === 1 ? undefined : dependsOn,
        category: 'method'
      })
    }
  })

  return claims
}

const CLAIM_GENERATION_PHASES = [
  {
    label: 'Reviewing invention disclosure',
    detail: 'Reading normalized facts, objectives, components, and source-stated embodiments.',
    icon: FileSearch
  },
  {
    label: 'Checking support boundaries',
    detail: 'Separating claimable features from unsupported or excluded material.',
    icon: ShieldCheck
  },
  {
    label: 'Selecting claim architecture',
    detail: 'Aligning the independent-claim form with the invention type and jurisdiction.',
    icon: BookOpen
  },
  {
    label: 'Drafting the independent claim',
    detail: 'Balancing broad scope with the minimum source-supported inventive combination.',
    icon: Scale
  },
  {
    label: 'Planning dependent fallbacks',
    detail: 'Arranging embodiments, alternatives, ranges, components, and method steps.',
    icon: GitBranch
  },
  {
    label: 'Applying jurisdiction rules',
    detail: 'Checking transitions, dependencies, numbering, and local drafting conventions.',
    icon: Globe
  },
  {
    label: 'Reviewing term consistency',
    detail: 'Checking antecedent basis, dependency references, and repeated claim terms.',
    icon: Layers3
  },
  {
    label: 'Preparing support notes',
    detail: 'Building quality observations and source-support signals for attorney review.',
    icon: FileText
  },
]

const CLAIM_GENERATION_NOTES = [
  'Claims define the boundaries of protection, so scope and clarity are being balanced.',
  'Dependent claims are being used as fallback positions around narrower embodiments.',
  'Unsupported wording is being avoided so the claim set remains tied to the disclosure.',
  'The final validation waits for the model response before the claims are shown.',
]

function estimateClaimGenerationDurationMs(componentCount: number, usePersonaStyle: boolean) {
  const componentLoad = Math.min(7000, Math.max(0, componentCount - 6) * 350)
  const styleLoad = usePersonaStyle ? 2500 : 0
  return 36000 + componentLoad + styleLoad
}

function ClaimGenerationProgress({
  activeJurisdiction,
  patentType,
  componentCount,
  hasUserRemarks,
  usePersonaStyle,
  personaName,
  hasSourceFactLedger,
  hasScopeRecommendations,
}: {
  activeJurisdiction: string
  patentType: 'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION' | null
  componentCount: number
  hasUserRemarks: boolean
  usePersonaStyle: boolean
  personaName?: string
  hasSourceFactLedger: boolean
  hasScopeRecommendations: boolean
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [noteIndex, setNoteIndex] = useState(0)
  const estimatedDuration = estimateClaimGenerationDurationMs(componentCount, usePersonaStyle)
  const elapsedMs = elapsedSeconds * 1000
  const ratio = Math.min(1, elapsedMs / estimatedDuration)
  const readiness = Math.min(96, 7 + Math.round(ratio * 89))
  const activePhaseIndex = Math.min(CLAIM_GENERATION_PHASES.length - 1, Math.floor(ratio * CLAIM_GENERATION_PHASES.length))
  const currentPhase = elapsedMs > estimatedDuration
    ? 'Finalizing claim set and support checks...'
    : CLAIM_GENERATION_PHASES[activePhaseIndex]?.label || 'Drafting preliminary claims...'

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNoteIndex((index) => (index + 1) % CLAIM_GENERATION_NOTES.length)
    }, 5600)
    return () => window.clearInterval(timer)
  }, [])

  const inputs = [
    `${activeJurisdiction} rules`,
    patentType ? `${patentType} claim form` : 'claim type review',
    componentCount > 0 ? `${componentCount} component${componentCount === 1 ? '' : 's'}` : 'source text',
    hasSourceFactLedger ? 'source fact ledger' : null,
    hasScopeRecommendations ? 'scope recommendations' : null,
    hasUserRemarks ? 'user remarks' : null,
    usePersonaStyle ? (personaName ? `${personaName} style` : 'persona style') : null,
  ].filter((input): input is string => Boolean(input))

  return (
    <div className="rounded-lg border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-indigo-50 p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">Claim Drafting Workbench</p>
          <h4 className="mt-1 text-base font-semibold text-gray-900">Drafting preliminary claims</h4>
          <p className="mt-1 text-sm text-gray-600">
            Estimated progress is shown while the model prepares the claim set.
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 shadow-sm">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          {elapsedSeconds}s elapsed
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-gray-800" aria-live="polite">{currentPhase}</span>
          <span className="text-xs font-semibold text-amber-700">{readiness}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={readiness}
          className="h-2 overflow-hidden rounded-full bg-amber-100"
        >
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 via-orange-400 to-indigo-500"
            initial={false}
            animate={{ width: `${readiness}%` }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          />
        </div>
        {elapsedMs > estimatedDuration && (
          <p className="mt-2 rounded-md border border-amber-200 bg-white px-3 py-2 text-xs text-amber-800">
            This claim set is taking longer than usual. Final validation will complete as soon as the response returns.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {inputs.map((input) => (
          <span
            key={input}
            className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600"
          >
            {input}
          </span>
        ))}
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {CLAIM_GENERATION_PHASES.map((phase, index) => {
          const Icon = phase.icon
          const complete = index < activePhaseIndex
          const active = index === activePhaseIndex
          return (
            <div
              key={phase.label}
              className={[
                'flex gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                complete
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : active
                    ? 'border-amber-300 bg-amber-100/70 text-amber-950'
                    : 'border-gray-200 bg-white/80 text-gray-500',
              ].join(' ')}
            >
              <div className={[
                'mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full',
                complete ? 'bg-emerald-600 text-white' : active ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-400',
              ].join(' ')}>
                {complete ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{phase.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed opacity-80">{phase.detail}</p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 min-h-[36px] rounded-lg border border-indigo-100 bg-white/80 px-3 py-2 text-sm text-gray-700" aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.p
            key={CLAIM_GENERATION_NOTES[noteIndex]}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {CLAIM_GENERATION_NOTES[noteIndex]}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PreliminaryClaimsStage({ session, patent, onComplete, onRefresh }: PreliminaryClaimsStageProps) {
  // ---- Claims state ----
  const [claims, setClaims] = useState<Claim[]>([])
  const [claimsText, setClaimsText] = useState('')
  const [claimsFrozen, setClaimsFrozen] = useState(false)
  const [claimsFrozenAt, setClaimsFrozenAt] = useState<string | null>(null)
  const [isGeneratingClaims, setIsGeneratingClaims] = useState(false)
  const [isResettingClaims, setIsResettingClaims] = useState(false)
  const claimsEditorRef = useRef<RichTextEditorRef>(null)
  const [isEditingClaims, setIsEditingClaims] = useState(false)
  const [claimGenerationQuality, setClaimGenerationQuality] = useState<any>(null)
  const [showClaimsDetails, setShowClaimsDetails] = useState(true)
  const [showQualityObservations, setShowQualityObservations] = useState(false)
  const [showFreezeHelp, setShowFreezeHelp] = useState(false)

  // ---- Patent type state ----
  const [patentType, setPatentType] = useState<'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION' | null>(null)
  const [isUpdatingPatentType, setIsUpdatingPatentType] = useState(false)
  const [showPatentTypeDropdown, setShowPatentTypeDropdown] = useState(false)

  // ---- User claim remarks ----
  const [userClaimRemarks, setUserClaimRemarks] = useState('')

  // ---- Persona / style state ----
  const [usePersonaStyle, setUsePersonaStyle] = useState(false)
  const [personaSelection, setPersonaSelection] = useState<PersonaSelection | undefined>(undefined)
  const [showPersonaManager, setShowPersonaManager] = useState(false)
  const [showNoPersonasModal, setShowNoPersonasModal] = useState(false)
  const [personasAvailable, setPersonasAvailable] = useState<{ myCount: number; orgCount: number } | null>(null)
  const [checkingPersonas, setCheckingPersonas] = useState(false)

  // ---- Navigation state ----
  const [isNavigating, setIsNavigating] = useState(false)
  const [skipPriorArtClicked, setSkipPriorArtClicked] = useState(false)
  const [useInitialClaimsForDraft, setUseInitialClaimsForDraft] = useState(false)

  // ---- Misc state ----
  const [regenerateInstructions, setRegenerateInstructions] = useState('')
  const [draftSaved, setDraftSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ---- Auth context ----
  const { token, user } = useAuth()
  const isAdmin = user?.roles?.some((r: string) => ['OWNER', 'ADMIN'].includes(r))

  // ---- Derived session data ----
  const normalizedRecord = (session?.ideaRecord?.normalizedData as any) || {}
  const activeJurisdiction = (session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'US').toUpperCase()
  const allJurisdictions = session?.draftingJurisdictions || [activeJurisdiction]

  const title = session?.ideaRecord?.title || ''
  const rawIdea = session?.ideaRecord?.rawInput || ''
  const problem = normalizedRecord.problem || session?.ideaRecord?.problem || ''
  const objectives = normalizedRecord.objectives || session?.ideaRecord?.objectives || ''
  const logic = normalizedRecord.logic || session?.ideaRecord?.logic || ''
  const components: any[] = normalizedRecord.components || session?.ideaRecord?.components || []
  const bestMethod = normalizedRecord.bestMethod || session?.ideaRecord?.bestMethod || ''
  const abstractText = normalizedRecord.abstract || session?.ideaRecord?.abstract || ''

  // ---- Load claims + persona from session ----
  useEffect(() => {
    const nd = (session?.ideaRecord?.normalizedData as any) || {}

    if (nd.claims) {
        const savedClaims = typeof nd.claims === 'string'
          ? stripTrailingClaimDependencyLabelsFromHtml(nd.claims)
          : nd.claims
      if (Array.isArray(savedClaims)) {
        setClaims(savedClaims)
        const claimsTextContent = savedClaims
          .map((c: Claim) => {
            return `${c.number}. ${stripTrailingClaimDependencyLabel(c.text)}`
          })
          .join('\n\n')
        setClaimsText(claimsTextContent)
      } else if (typeof savedClaims === 'string') {
        setClaims(parseClaimsFromHtml(savedClaims))
        setClaimsText(stripTrailingClaimDependencyLabelsFromHtml(savedClaims))
      }
    } else {
      setClaims([])
      setClaimsText('')
    }
    setClaimGenerationQuality(nd.claimGenerationQuality || null)

    if (nd.claimsApprovedAt) {
      setClaimsFrozen(true)
      setClaimsFrozenAt(nd.claimsApprovedAt)
    } else {
      setClaimsFrozen(false)
      setClaimsFrozenAt(null)
    }

    if (nd.userClaimRemarks) {
      setUserClaimRemarks(nd.userClaimRemarks)
    } else {
      setUserClaimRemarks('')
    }

    const savedPersonaSelection = (session as any)?.personaSelection as PersonaSelection | undefined
    const savedPersonaEnabled = Boolean((session as any)?.usePersonaStyle ?? (session as any)?.personaStyleEnabled)
    setPersonaSelection(savedPersonaSelection?.primaryPersonaId ? savedPersonaSelection : undefined)
    setUsePersonaStyle(Boolean(savedPersonaEnabled && savedPersonaSelection?.primaryPersonaId))
  }, [session])

  // ---- Load patent type ----
  useEffect(() => {
    if (session?.patentTypePrimary) {
      setPatentType(session.patentTypePrimary as any)
    }
  }, [session?.patentTypePrimary])

  // ---- Close patent type dropdown on outside click / Escape ----
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showPatentTypeDropdown) {
        const target = event.target as HTMLElement
        if (!target.closest('[data-patent-type-dropdown]')) {
          setShowPatentTypeDropdown(false)
        }
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showPatentTypeDropdown) {
        setShowPatentTypeDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showPatentTypeDropdown])

  // ---- Reset draft-saved flag when claims content changes ----
  useEffect(() => {
    if (draftSaved) {
      setDraftSaved(false)
    }
  }, [claimsText, draftSaved])

  // ---- Derived flags ----
  const strippedClaims = typeof claimsText === 'string' ? claimsText.replace(/<[^>]*>/g, '').trim() : ''
  const hasClaims = strippedClaims.length > 0 || claims.length > 0
  const canProceed = hasClaims

  const qualityStatus = claimGenerationQuality?.status as string | undefined
  const qualityWarnings: any[] = Array.isArray(claimGenerationQuality?.warnings) ? claimGenerationQuality.warnings : []
  const qualityBadge = qualityStatus === 'source_supported'
    ? { label: 'Source-supported', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' }
    : qualityStatus === 'thin_disclosure'
      ? { label: 'Thin disclosure', className: 'bg-amber-100 text-amber-800 border-amber-200' }
      : qualityStatus === 'needs_review'
        ? { label: 'Needs review', className: 'bg-rose-100 text-rose-700 border-rose-200' }
        : null

  // ---------------------------------------------------------------------------
  // Persona handlers
  // ---------------------------------------------------------------------------

  const checkPersonasAvailable = async (): Promise<boolean> => {
    if (!token) return false
    setCheckingPersonas(true)
    try {
      const res = await fetch('/api/personas', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) return false
      const data = await res.json()
      const myCount = (data.myPersonas || []).length
      const orgCount = (data.orgPersonas || []).length
      setPersonasAvailable({ myCount, orgCount })
      return (myCount + orgCount) > 0
    } catch (err) {
      console.error('Error checking personas:', err)
      return false
    } finally {
      setCheckingPersonas(false)
    }
  }

  const handlePersonaButtonClick = async () => {
    const hasPersonas = await checkPersonasAvailable()
    if (hasPersonas) {
      setShowPersonaManager(true)
    } else {
      setShowNoPersonasModal(true)
    }
  }

  const persistPersonaConfig = async (enabled: boolean, selection?: PersonaSelection) => {
    if (!session?.id) return null
    const response = await onComplete({
      action: 'update_persona_config',
      sessionId: session.id,
      enabled,
      personaSelection: selection
    })
    if (response?.error) throw new Error(response.error)
    setUsePersonaStyle(Boolean(response?.usePersonaStyle))
    setPersonaSelection(response?.personaSelection?.primaryPersonaId ? response.personaSelection : selection)
    return response
  }

  const formatPersonaCoverageWarning = (warnings: any[]) => {
    const lines = (Array.isArray(warnings) ? warnings : [])
      .map((warning: any) => {
        const fallback = warning?.fallback === 'personal_sample'
          ? 'personal non-persona sample will be used'
          : 'no style block will be used'
        return `- ${warning?.sectionKey || 'section'} (${warning?.jurisdiction || activeJurisdiction}): ${fallback}`
      })
      .join('\n')
    return `The selected persona is missing writing samples for this generation.\n\n${lines || '- One or more sections have no persona sample.'}\n\nContinue without persona style for those missing sections?`
  }

  const handleStyleToggle = async () => {
    try {
      setError(null)
      if (usePersonaStyle) {
        await persistPersonaConfig(false, personaSelection)
        return
      }
      const hasPersonas = await checkPersonasAvailable()
      if (!hasPersonas) {
        setShowNoPersonasModal(true)
        return
      }
      if (!personaSelection?.primaryPersonaId) {
        setShowPersonaManager(true)
        return
      }
      await persistPersonaConfig(true, personaSelection)
    } catch (e) {
      console.error('Failed to update persona style:', e)
      setError(e instanceof Error ? e.message : 'Failed to update persona style.')
    }
  }

  // ---------------------------------------------------------------------------
  // Claims handlers
  // ---------------------------------------------------------------------------

  const handleGenerateClaims = async () => {
    if (!session?.id) return
    try {
      setIsGeneratingClaims(true)
      setError(null)

      const ideaContext = {
        title,
        rawIdea,
        problem,
        objectives,
        logic,
        components,
        bestMethod,
        abstract: abstractText,
        coreInventiveConcept: normalizedRecord.coreInventiveConcept,
        claimableFeatures: normalizedRecord.claimableFeatures,
        fallbackLimitations: normalizedRecord.fallbackLimitations,
        doNotClaim: normalizedRecord.doNotClaim,
        sourceFactLedger: normalizedRecord.sourceFactLedger,
        scopeRecommendations: normalizedRecord.scopeRecommendations,
        normalizationReviewWarnings: normalizedRecord.normalizationReviewWarnings
      }

      const payload = {
        action: 'generate_claims',
        sessionId: session.id,
        jurisdiction: activeJurisdiction,
        userInstructions: regenerateInstructions.trim() || undefined,
        userClaimRemarks: userClaimRemarks.trim() || undefined,
        usePersonaStyle,
        personaSelection,
        ideaContext
      }

      let response = await onComplete(payload)

      if (response?.code === 'PERSONA_COVERAGE_WARNING') {
        const confirmed = window.confirm(formatPersonaCoverageWarning(response.personaWarnings || []))
        if (!confirmed) return
        response = await onComplete({ ...payload, acceptPersonaWarnings: true })
      }

      if (response?.error) throw new Error(response.error)
      if (!response) throw new Error('No response received while generating claims.')

      const responseClaims = Array.isArray(response.claims) ? response.claims : []
      const responseClaimsHtml = typeof response.claimsHtml === 'string' ? response.claimsHtml.trim() : ''

      if (responseClaims.length > 0) {
        setClaims(responseClaims)
        if (responseClaimsHtml) {
          setClaimsText(responseClaimsHtml)
        } else {
          const formatted = responseClaims
            .map((c: Claim) => `<p><strong>${c.number}.</strong> ${c.text}</p>`)
            .join('\n')
          setClaimsText(formatted)
        }
      } else if (responseClaimsHtml) {
        setClaims(parseClaimsFromHtml(responseClaimsHtml))
        setClaimsText(responseClaimsHtml)
      } else {
        throw new Error('No claims were returned. Please try again.')
      }

      if (response?.patentType) {
        setPatentType(response.patentType as any)
      }
      setClaimGenerationQuality(response.claimGenerationQuality || null)

      await onRefresh()
      setRegenerateInstructions('')
    } catch (e) {
      console.error('Failed to generate claims:', e)
      setError(e instanceof Error ? e.message : 'Failed to generate claims. Please try again.')
    } finally {
      setIsGeneratingClaims(false)
    }
  }

  const handleUpdatePatentType = async (newType: 'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION') => {
    if (!session?.id || newType === patentType) return
    try {
      setIsUpdatingPatentType(true)
      setError(null)
      await onComplete({
        action: 'update_patent_type',
        sessionId: session.id,
        patentType: newType
      })
      setPatentType(newType)
      setShowPatentTypeDropdown(false)
      await onRefresh()
    } catch (e) {
      console.error('Failed to update patent type:', e)
      setError('Failed to update patent type. Please try again.')
    } finally {
      setIsUpdatingPatentType(false)
    }
  }

  const handleSaveClaims = async () => {
    if (!session?.id) return
    try {
      setError(null)
      const claimsContent = claimsEditorRef.current?.getHTML() || claimsText
      const parsedFromHtml = parseClaimsFromHtml(claimsContent)
      const structuredToSave = parsedFromHtml.length > 0 ? parsedFromHtml : (claims.length > 0 ? claims : null)
      await onComplete({
        action: 'save_claims',
        sessionId: session.id,
        claims: claimsContent,
        claimsStructured: structuredToSave
      })
      await onRefresh()
      setDraftSaved(true)
    } catch (e) {
      console.error('Failed to save claims:', e)
      setError('Failed to save claims.')
    }
  }

  const handleResetClaims = async () => {
    if (!session?.id || !hasClaims) return
    const confirmed = window.confirm(
      'Reset claims?\n\nThis will delete generated, edited, frozen, and refined claim data for this Stage 1 claim set. This cannot be undone.'
    )
    if (!confirmed) return

    try {
      setIsResettingClaims(true)
      setError(null)
      const response = await onComplete({
        action: 'reset_claims',
        sessionId: session.id
      })

      if (response?.error) throw new Error(response.error)
      if (!response) throw new Error('Failed to reset claims.')

      setClaims([])
      setClaimsText('')
      setClaimGenerationQuality(null)
      setClaimsFrozen(false)
      setClaimsFrozenAt(null)
      setIsEditingClaims(false)
      setRegenerateInstructions('')
      setDraftSaved(false)
      setSkipPriorArtClicked(false)
      setUseInitialClaimsForDraft(false)
      await onRefresh()
    } catch (e) {
      console.error('Failed to reset claims:', e)
      setError(e instanceof Error ? e.message : 'Failed to reset claims.')
    } finally {
      setIsResettingClaims(false)
    }
  }

  const handleDoneEditing = async () => {
    if (!session?.id) return
    try {
      setError(null)
      const claimsContent = claimsEditorRef.current?.getHTML() || claimsText
      const parsedFromHtml = parseClaimsFromHtml(claimsContent)
      const structuredToSave = parsedFromHtml.length > 0 ? parsedFromHtml : (claims.length > 0 ? claims : null)
      await onComplete({
        action: 'save_claims',
        sessionId: session.id,
        claims: claimsContent,
        claimsStructured: structuredToSave
      })
      await onRefresh()
      setDraftSaved(true)
      setIsEditingClaims(false)
    } catch (e) {
      console.error('Failed to save claims:', e)
      setError('Failed to save claims.')
    }
  }

  const handleFreezeClaims = async () => {
    if (!session?.id) return
    try {
      setError(null)
      const claimsContent = claimsEditorRef.current?.getHTML() || claimsText
      if (!claimsContent || claimsContent.trim() === '' || claimsContent === '<p></p>') {
        setError('Please generate or enter claims before freezing.')
        return
      }
      const parsedFromHtml = parseClaimsFromHtml(claimsContent)
      const structuredToSave = parsedFromHtml.length > 0 ? parsedFromHtml : (claims.length > 0 ? claims : null)
      await onComplete({
        action: 'freeze_claims',
        sessionId: session.id,
        claims: claimsContent,
        claimsStructured: structuredToSave,
        jurisdiction: activeJurisdiction
      })
      setClaimsFrozen(true)
      setClaimsFrozenAt(new Date().toISOString())
      await onRefresh()
    } catch (e) {
      console.error('Failed to freeze claims:', e)
      setError('Failed to freeze claims.')
    }
  }

  const handleUnfreezeClaims = async () => {
    if (!session?.id) return
    try {
      setError(null)
      await onComplete({
        action: 'unfreeze_claims',
        sessionId: session.id
      })
      setClaimsFrozen(false)
      setClaimsFrozenAt(null)
      await onRefresh()
    } catch (e) {
      console.error('Failed to unfreeze claims:', e)
      setError('Failed to unfreeze claims.')
    }
  }

  const persistClaimsDraft = async () => {
    if (!session?.id) return
    const claimsContent = claimsEditorRef.current?.getHTML() || claimsText
    if (!claimsContent || claimsContent.trim() === '' || claimsContent === '<p></p>') {
      throw new Error('Please add claims before continuing.')
    }
    const parsedFromHtml = parseClaimsFromHtml(claimsContent)
    const structuredToSave = parsedFromHtml.length > 0 ? parsedFromHtml : (claims.length > 0 ? claims : null)
    await onComplete({
      action: 'save_claims',
      sessionId: session.id,
      claims: claimsContent,
      claimsStructured: structuredToSave
    })
  }

  // ---------------------------------------------------------------------------
  // Navigation handlers
  // ---------------------------------------------------------------------------

  const proceedToPriorArt = async () => {
    if (!session?.id) return
    try {
      setIsNavigating(true)
      setError(null)
      if (!claimsFrozen) await persistClaimsDraft()
      await onComplete({
        action: 'set_stage',
        sessionId: session.id,
        stage: 'RELATED_ART'
      })
      await onRefresh()
    } catch (e) {
      console.error('Failed to proceed to prior art:', e)
      setError(e instanceof Error ? e.message : 'Failed to proceed to prior art')
    } finally {
      setIsNavigating(false)
    }
  }

  const handleSkipClick = () => {
    setSkipPriorArtClicked(true)
  }

  const skipPriorArtAndFreeze = async () => {
    if (!session?.id) return
    try {
      setIsNavigating(true)
      setError(null)
      if (!claimsFrozen) await persistClaimsDraft()
      await onComplete({
        action: 'set_stage',
        sessionId: session.id,
        stage: 'COMPONENT_PLANNER',
        skipPriorArt: true,
        useInitialClaimsForDrafting: useInitialClaimsForDraft
      })
      await onRefresh()
    } catch (e) {
      console.error('Failed to skip prior art:', e)
      setError(e instanceof Error ? e.message : 'Failed to skip prior art')
    } finally {
      setIsNavigating(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="px-6 py-8 max-w-[1400px] mx-auto">
      {/* ---- Page Header ---- */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Scale className="w-6 h-6 text-indigo-600" />
              </div>
              Preliminary Claims
            </h2>
            <p className="text-gray-500 mt-2">
              Generate and refine jurisdiction-aware patent claims based on your invention disclosure.
            </p>
          </div>

          <Badge variant="outline" className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-amber-200 text-amber-800">
            <Globe className="w-3.5 h-3.5" />
            {activeJurisdiction}
            {allJurisdictions.length > 1 && (
              <span className="text-xs opacity-70">+{allJurisdictions.length - 1}</span>
            )}
          </Badge>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ---- Claims layout ---- */}
      <div className="grid grid-cols-1 gap-6">
        {/* ========== Claims Panel ========== */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            {/* Claims Header */}
            <button
              onClick={() => setShowClaimsDetails(!showClaimsDetails)}
              className="w-full flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-white to-indigo-50/30 hover:bg-indigo-50/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-indigo-100 flex items-center justify-center">
                  <Scale className="w-3.5 h-3.5 text-indigo-600" />
                </div>
                <h3 className="text-sm font-semibold text-gray-900">
                  Initial Patent Claims
                </h3>
                <Badge variant="secondary" className="text-xs">
                  {activeJurisdiction} Rules
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {!showClaimsDetails && (
                  <span className="text-xs text-gray-500">Click to expand</span>
                )}
                {showClaimsDetails ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </div>
            </button>

            {/* Compact metadata, status, and style controls */}
            {showClaimsDetails && (
              <div className="px-5 py-3 bg-gradient-to-r from-indigo-50/50 to-violet-50/50 border-b border-indigo-100">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-600">Invention Type</span>
                    <div className="relative" data-patent-type-dropdown>
                      <Tooltip content="Click to change the invention type if the AI classification is incorrect" position="bottom">
                        <button
                          onClick={() => setShowPatentTypeDropdown(!showPatentTypeDropdown)}
                          disabled={isUpdatingPatentType || claimsFrozen}
                          className={`text-xs font-bold px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-all ${
                            isUpdatingPatentType ? 'opacity-50 cursor-wait' :
                            claimsFrozen ? 'cursor-not-allowed opacity-70' :
                            'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-indigo-300'
                          } ${
                            patentType === 'PRODUCT' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                            patentType === 'SYSTEM' ? 'bg-purple-100 text-purple-800 border border-purple-200' :
                            patentType === 'PROCESS' ? 'bg-green-100 text-green-800 border border-green-200' :
                            patentType === 'COMPOSITION' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                            'bg-gray-100 text-gray-600 border border-gray-200'
                          }`}
                        >
                          {isUpdatingPatentType ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            patentType || 'Not classified'
                          )}
                          {!claimsFrozen && !isUpdatingPatentType && (
                            <ChevronDown className={`w-3 h-3 transition-transform ${showPatentTypeDropdown ? 'rotate-180' : ''}`} />
                          )}
                        </button>
                      </Tooltip>

                      {/* Dropdown Menu */}
                      <AnimatePresence>
                        {showPatentTypeDropdown && !claimsFrozen && (
                          <motion.div
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.15 }}
                            className="absolute left-0 top-full mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px]"
                          >
                            {(['PRODUCT', 'SYSTEM', 'PROCESS', 'COMPOSITION'] as const).map((type) => (
                              <button
                                key={type}
                                onClick={() => handleUpdatePatentType(type)}
                                disabled={isUpdatingPatentType}
                                className={`w-full px-3 py-2 text-left text-xs font-medium flex items-center gap-2 transition-colors ${
                                  patentType === type
                                    ? 'bg-indigo-50 text-indigo-700'
                                    : 'hover:bg-gray-50 text-gray-700'
                                }`}
                              >
                                <span className={`w-2 h-2 rounded-full ${
                                  type === 'PRODUCT' ? 'bg-blue-500' :
                                  type === 'SYSTEM' ? 'bg-purple-500' :
                                  type === 'PROCESS' ? 'bg-green-500' :
                                  'bg-amber-500'
                                }`} />
                                <span>{type}</span>
                                {patentType === type && (
                                  <Check className="w-3 h-3 ml-auto text-indigo-600" />
                                )}
                              </button>
                            ))}
                            <div className="border-t border-gray-100 mt-1 pt-1 px-3 py-2">
                              <p className="text-[10px] text-gray-500 leading-relaxed">
                                <strong>PRODUCT:</strong> Single device/article<br/>
                                <strong>SYSTEM:</strong> Multi-component setup<br/>
                                <strong>PROCESS:</strong> Method/steps<br/>
                                <strong>COMPOSITION:</strong> Chemical/material
                              </p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    {!patentType && (
                      <span className="text-[10px] text-gray-400">(Classifying...)</span>
                    )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-gray-600">
                      <span className="font-medium">Writing Style</span>
                      <span className="text-gray-500">
                        {usePersonaStyle
                          ? (personaSelection?.primaryPersonaName || 'Enabled')
                          : 'Off'}
                      </span>
                    </div>

                    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                      claimsFrozen
                        ? 'border-green-200 bg-green-50 text-green-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                    }`}>
                      {claimsFrozen ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                      <span>
                        {claimsFrozen && claimsFrozenAt
                          ? `Frozen ${new Date(claimsFrozenAt).toLocaleDateString()}`
                          : 'Freeze before proceeding'}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {claimsFrozen && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleUnfreezeClaims}
                        className="h-8 text-amber-700 hover:text-amber-800 hover:bg-amber-50"
                      >
                        <Unlock className="w-3 h-3 mr-1" />
                        Unfreeze to Edit
                      </Button>
                    )}
                    <Tooltip content={usePersonaStyle
                      ? "Persona style is ON - Claims will be generated using your selected writing style"
                      : "Enable to generate claims in your preferred writing style"
                    } position="bottom">
                      <div
                        onClick={handleStyleToggle}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                          checkingPersonas ? 'opacity-50 cursor-wait' : ''
                        } ${
                          usePersonaStyle
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        <span className="text-sm">{checkingPersonas ? '...' : usePersonaStyle ? '✓' : '○'}</span>
                        <span className="text-xs font-medium">Style</span>
                      </div>
                    </Tooltip>

                    <Tooltip content="Select a writing persona (e.g., CSE, Bio, Chemistry) for your claims" position="bottom">
                      <button
                        onClick={handlePersonaButtonClick}
                        disabled={checkingPersonas}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                          checkingPersonas ? 'opacity-50 cursor-wait' : ''
                        } ${
                          personaSelection?.primaryPersonaName
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <span>👤</span>
                        <span className="font-medium">
                          {checkingPersonas ? 'Checking...' : personaSelection?.primaryPersonaName || 'Persona'}
                        </span>
                        {personaSelection?.secondaryPersonaNames?.length ? (
                          <span className="text-[10px] bg-indigo-200 text-indigo-700 px-1 rounded">
                            +{personaSelection.secondaryPersonaNames.length}
                          </span>
                        ) : null}
                      </button>
                    </Tooltip>
                  </div>
                </div>
              </div>
            )}

            <AnimatePresence>
              {showClaimsDetails && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  {/* Multi-Jurisdiction Notice */}
                  {allJurisdictions.length > 1 && (
                    <div className="px-5 py-2 bg-blue-50 border-b border-blue-100">
                      <div className="flex items-start gap-2 text-sm text-blue-800">
                        <Globe className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="font-medium">Multi-Jurisdiction Filing:</span>{' '}
                          <span>These reference claims are generated for initial review using {activeJurisdiction} rules. Jurisdiction-specific claims will be drafted one-by-one during the drafting stage.</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Claims Editor */}
                  <div className="p-6">
                    {!claimsText && !isGeneratingClaims ? (
                      <div className="py-6">
                        <div className="text-center mb-6">
                          <Scale className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                          <p className="text-gray-600">No claims generated yet.</p>
                        </div>

                        {/* User Remarks Textarea */}
                        <div className="max-w-lg mx-auto mb-6">
                          <div className="flex items-center gap-2 mb-2">
                            <Lightbulb className="w-4 h-4 text-amber-500" />
                            <span className="text-sm text-gray-600">
                              Add remarks to guide claim drafting (optional)
                            </span>
                          </div>
                          <textarea
                            value={userClaimRemarks}
                            onChange={(e) => setUserClaimRemarks(e.target.value)}
                            placeholder="Any specific emphasis, exclusions, embodiments, or scope preferences for claim drafting?"
                            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 resize-none"
                            rows={3}
                          />
                          <p className="text-[11px] text-gray-400 mt-1">
                            These remarks influence scope and emphasis, not the patent type.
                          </p>
                        </div>

                        <div className="text-center">
                          <Button
                            onClick={() => handleGenerateClaims()}
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                          >
                            <Sparkles className="w-4 h-4 mr-2" />
                            Generate Claims for {activeJurisdiction}
                          </Button>
                          <p className="text-xs text-gray-500 mt-3">
                            Claims will be generated using {activeJurisdiction} patent office rules
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {isGeneratingClaims ? (
                          <ClaimGenerationProgress
                            activeJurisdiction={activeJurisdiction}
                            patentType={patentType}
                            componentCount={components.length}
                            hasUserRemarks={Boolean(userClaimRemarks.trim() || regenerateInstructions.trim())}
                            usePersonaStyle={usePersonaStyle}
                            personaName={personaSelection?.primaryPersonaName}
                            hasSourceFactLedger={Boolean(normalizedRecord.sourceFactLedger)}
                            hasScopeRecommendations={Boolean(normalizedRecord.scopeRecommendations)}
                          />
                        ) : (
                          <>
                            {/* Edit Mode Header */}
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-700">
                                  {isEditingClaims ? 'Editing Claims' : 'Generated Claims'}
                                </span>
                                {isEditingClaims && (
                                  <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-xs">
                                    <Edit2 className="w-3 h-3 mr-1" />
                                    Edit Mode
                                  </Badge>
                                )}
                                {qualityBadge && !isEditingClaims && (
                                  <Badge variant="outline" className={`text-xs border ${qualityBadge.className}`}>
                                    {qualityBadge.label}
                                  </Badge>
                                )}
                              </div>

                              {/* Claim action buttons */}
                              <div className="flex items-center gap-2">
                                {!claimsFrozen && !isEditingClaims && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setIsEditingClaims(true)}
                                    disabled={isResettingClaims}
                                    className="text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                                  >
                                    <Edit2 className="w-3.5 h-3.5 mr-1.5" />
                                    Edit Claims
                                  </Button>
                                )}
                                {!claimsFrozen && isEditingClaims && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleDoneEditing}
                                    disabled={isResettingClaims}
                                    className="text-green-600 border-green-200 hover:bg-green-50"
                                  >
                                    <Check className="w-3.5 h-3.5 mr-1.5" />
                                    Done Editing
                                  </Button>
                                )}
                                {hasClaims && !isGeneratingClaims && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleResetClaims}
                                    disabled={isResettingClaims}
                                    className="text-red-600 border-red-200 hover:bg-red-50"
                                  >
                                    {isResettingClaims ? (
                                      <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                                    )}
                                    Reset Claims
                                  </Button>
                                )}
                              </div>
                            </div>

                            {qualityWarnings.length > 0 && (
                              <div className="rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900">
                                <button
                                  type="button"
                                  onClick={() => setShowQualityObservations(!showQualityObservations)}
                                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-amber-100/60 transition-colors"
                                  aria-expanded={showQualityObservations}
                                >
                                  <span className="flex items-center gap-2 font-medium">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-600" />
                                    Claim Quality Observations
                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                      {qualityWarnings.length}
                                    </span>
                                  </span>
                                  {showQualityObservations ? (
                                    <ChevronDown className="h-4 w-4 flex-shrink-0 text-amber-700" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-amber-700" />
                                  )}
                                </button>
                                <AnimatePresence initial={false}>
                                  {showQualityObservations && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.18 }}
                                      className="overflow-hidden"
                                    >
                                      <ul className="list-disc border-t border-amber-200 px-4 py-3 pl-10 text-xs leading-relaxed">
                                        {qualityWarnings.map((warning: any, idx: number) => (
                                          <li key={idx}>{warning?.message || String(warning)}</li>
                                        ))}
                                      </ul>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            )}

                            {/* Claims Display / Editor */}
                            {isEditingClaims ? (
                              <div className="border-2 border-indigo-200 rounded-lg bg-indigo-50/30">
                                <div className="px-3 py-2 bg-indigo-100 border-b border-indigo-200 text-xs text-indigo-700 flex items-center gap-2">
                                  <Edit2 className="w-3 h-3" />
                                  <span>Make your changes below. Click &quot;Done Editing&quot; when finished to save your changes.</span>
                                </div>
                                <div className="p-1">
                                  <ClaimsEditor
                                    ref={claimsEditorRef}
                                    value={claimsText}
                                    onChange={setClaimsText}
                                    disabled={claimsFrozen}
                                    placeholder={`1. A method for... comprising:\n   a) a first step of...\n   b) a second step of...\n\n2. The method of claim 1, wherein...`}
                                  />
                                </div>
                              </div>
                            ) : (
                              <div
                                className="border border-gray-200 rounded-lg bg-gray-50/50 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/20 transition-colors group"
                                onClick={() => !claimsFrozen && setIsEditingClaims(true)}
                              >
                                <div className="px-4 py-3 prose prose-sm max-w-none text-gray-700 leading-relaxed [&>p]:mb-3 [&>p:last-child]:mb-0">
                                  <div
                                    dangerouslySetInnerHTML={{ __html: claimsText }}
                                  />
                                </div>
                                {!claimsFrozen && (
                                  <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 flex items-center gap-1 group-hover:text-indigo-600 group-hover:bg-indigo-50 transition-colors">
                                    <Edit2 className="w-3 h-3" />
                                    Click to edit claims
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Regeneration instructions + action buttons */}
                            <div className="flex flex-col gap-3 pt-4 border-t border-gray-100">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={regenerateInstructions}
                                  onChange={(e) => setRegenerateInstructions(e.target.value)}
                                  placeholder="Enter instructions for claim regeneration (optional)"
                                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                  disabled={claimsFrozen || isGeneratingClaims || isResettingClaims}
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleGenerateClaims()}
                                  disabled={claimsFrozen || isGeneratingClaims || isResettingClaims}
                                >
                                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                                  Regenerate
                                </Button>
                              </div>

                              <div className="flex items-center gap-2">
                                {!claimsFrozen && (
                                  <>
                                    {isEditingClaims && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleDoneEditing}
                                        disabled={isResettingClaims}
                                        className={draftSaved ? "bg-green-50 border-green-200 text-green-700" : "text-green-600 border-green-200 hover:bg-green-50"}
                                      >
                                        {draftSaved ? (
                                          <>
                                            <Check className="w-3.5 h-3.5 mr-1.5 text-green-600" />
                                            Saved!
                                          </>
                                        ) : (
                                          <>
                                            <Check className="w-3.5 h-3.5 mr-1.5" />
                                            Done Editing
                                          </>
                                        )}
                                      </Button>
                                    )}
                                    <Button
                                      size="sm"
                                      onClick={handleFreezeClaims}
                                      disabled={isResettingClaims}
                                      className="bg-green-600 hover:bg-green-700 text-white"
                                    >
                                      <Lock className="w-3.5 h-3.5 mr-1.5" />
                                      Freeze Initial Claims
                                    </Button>
                                    <div
                                      className="relative"
                                      onMouseEnter={() => setShowFreezeHelp(true)}
                                      onMouseLeave={() => setShowFreezeHelp(false)}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => setShowFreezeHelp(!showFreezeHelp)}
                                        className="flex h-8 w-8 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-700 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                        aria-label="Why freeze claims?"
                                        aria-expanded={showFreezeHelp}
                                      >
                                        <Info className="h-4 w-4" />
                                      </button>
                                      {showFreezeHelp && (
                                        <div className="absolute bottom-full left-1/2 z-50 mb-2 w-80 -translate-x-1/2 rounded-lg border border-blue-200 bg-blue-50 p-4 text-left shadow-lg">
                                          <h4 className="mb-2 text-sm font-semibold text-blue-900">Why freeze claims?</h4>
                                          <ul className="list-disc space-y-1 pl-4 text-xs text-blue-800">
                                            <li>Claims define the legal scope of your patent protection</li>
                                            <li>Frozen claims will be used in Figure Planner for relevant diagrams</li>
                                            <li>Prior Art analysis will compare patents against your specific claims</li>
                                            <li>Final draft will use these exact claims (no regeneration)</li>
                                            <li>Multi-jurisdiction support: claims transform to country-specific style</li>
                                          </ul>
                                        </div>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </div>
      </div>

      {/* ---- Navigation ---- */}
      <div className="mt-10 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 text-sm text-amber-700">
            <AlertCircle className="w-4 h-4" />
            <span>
              {claimsFrozen
                ? 'Claims are frozen; you can still proceed or unfreeze to edit.'
                : 'Claims are provisional; you can continue to prior art or skip and freeze them as final.'}
            </span>
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-end">
            {skipPriorArtClicked ? (
              <>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={useInitialClaimsForDraft}
                    onChange={(e) => setUseInitialClaimsForDraft(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Use Initial Claims for drafting
                </label>
                <Button
                  onClick={skipPriorArtAndFreeze}
                  disabled={!canProceed || isNavigating || isResettingClaims}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={handleSkipClick}
                  disabled={!canProceed || isNavigating || isResettingClaims}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  Skip Prior Art Stage
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
                <Button
                  variant="outline"
                  onClick={proceedToPriorArt}
                  disabled={!canProceed || isNavigating || isResettingClaims}
                >
                  Next: Prior Art
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ---- Persona Manager Modal ---- */}
      {showPersonaManager && (
        <PersonaManager
          isOpen={showPersonaManager}
          onClose={() => setShowPersonaManager(false)}
          showSelector={true}
          currentSelection={personaSelection}
          onSelectPersona={(selection) => {
            void (async () => {
              try {
                setError(null)
                if (selection.primaryPersonaId) {
                  await persistPersonaConfig(true, selection)
                } else {
                  await persistPersonaConfig(false, selection)
                }
              } catch (e) {
                console.error('Failed to save persona selection:', e)
                setError(e instanceof Error ? e.message : 'Failed to save persona selection.')
              }
            })()
          }}
        />
      )}

      {/* ---- No Personas Available Modal ---- */}
      {showNoPersonasModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-violet-50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-100 rounded-xl">
                  <AlertCircle className="w-6 h-6 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">No Writing Personas Available</h3>
                  <p className="text-sm text-gray-500 mt-0.5">Create a persona to use your own writing style</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                Writing personas allow the AI to mimic your preferred drafting style, terminology, and structure
                when generating claims and other patent sections.
              </p>

              <div className="space-y-3">
                {/* Option 1 */}
                <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-100">
                  <div className="flex items-start gap-3">
                    <span className="text-lg">✍️</span>
                    <div>
                      <h4 className="font-medium text-indigo-900">Create Your Own Persona</h4>
                      <p className="text-sm text-indigo-700 mt-1">
                        Go to <strong>Personas</strong> page from the main navigation to create your personal writing style.
                      </p>
                      <a
                        href="/personas"
                        className="inline-flex items-center gap-1 mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        Open Personas Page
                        <ChevronRight className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                </div>

                {/* Option 2: Org personas (non-admin) */}
                {!isAdmin && (
                  <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
                    <div className="flex items-start gap-3">
                      <span className="text-lg">🏢</span>
                      <div>
                        <h4 className="font-medium text-purple-900">Use Organization Personas</h4>
                        <p className="text-sm text-purple-700 mt-1">
                          Contact your Administrator (OWNER or ADMIN) to create shared organization personas
                          that all team members can use.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Admin-specific guidance */}
                {isAdmin && (
                  <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                    <div className="flex items-start gap-3">
                      <span className="text-lg">👑</span>
                      <div>
                        <h4 className="font-medium text-emerald-900">Create Organization Personas</h4>
                        <p className="text-sm text-emerald-700 mt-1">
                          As an Admin, you can create <strong>Organization</strong> personas that will be
                          available to all users in your organization. Set visibility to &quot;Organization&quot; when creating.
                        </p>
                        <a
                          href="/personas"
                          className="inline-flex items-center gap-1 mt-2 text-sm font-medium text-emerald-600 hover:text-emerald-800"
                        >
                          Create Organization Persona
                          <ChevronRight className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setShowNoPersonasModal(false)}
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  setShowNoPersonasModal(false)
                  window.location.href = '/personas'
                }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Go to Personas Page
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
