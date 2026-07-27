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
  Trash2,
  FileSearch,
  BookOpen,
  PenLine,
  ListChecks,
  Save,
  User,
  Loader2
} from 'lucide-react'
import { ClaimsEditor, RichTextEditorRef } from '@/components/ui/rich-text-editor'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import PersonaManager, { type PersonaSelection } from '@/components/drafting/PersonaManager'
import { useAuth } from '@/lib/auth-context'
import type { StreamingClaim } from '@/lib/draft-claims-stream'
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

type ClaimScopeStyle = 'broad' | 'default' | 'narrow'

type PatentType = 'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION'

// ---------------------------------------------------------------------------
// Static config
// ---------------------------------------------------------------------------

const CLAIM_SCOPE_STYLES: Array<{ value: ClaimScopeStyle; label: string; help: string }> = [
  {
    value: 'broad',
    label: 'Broad',
    help: 'Claim 1 recites the minimum source-supported inventive combination. Embodiments, ranges and fallbacks move into dependent claims.',
  },
  {
    value: 'default',
    label: 'Balanced',
    help: 'Source-supported Claim 1 with dependent fallback positions — neither obviously overbroad nor unnecessarily narrow.',
  },
  {
    value: 'narrow',
    label: 'Narrow',
    help: 'Independent claims carry more concrete source-supported differentiators for tighter initial coverage.',
  },
]

const PATENT_TYPES: Array<{ value: PatentType; hint: string }> = [
  { value: 'PRODUCT', hint: 'Single device or article' },
  { value: 'SYSTEM', hint: 'Multi-component setup' },
  { value: 'PROCESS', hint: 'Method or steps' },
  { value: 'COMPOSITION', hint: 'Chemical or material' },
]

// Steps mirror the server's real progress events — nothing here is on a timer.
const GENERATION_STEPS: Array<{ key: string; label: string; icon: React.ComponentType<any> }> = [
  { key: 'reading', label: 'Reading disclosure', icon: FileSearch },
  { key: 'rules', label: 'Applying jurisdiction rules', icon: BookOpen },
  { key: 'drafting', label: 'Drafting claims', icon: PenLine },
  { key: 'checking', label: 'Checking dependencies', icon: ListChecks },
  { key: 'saving', label: 'Saving', icon: Save },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalizeClaimScopeStyle = (value: unknown): ClaimScopeStyle => {
  const style = String(value || '').trim().toLowerCase()
  if (style === 'broad' || style === 'narrow') return style
  return 'default'
}

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

// ---------------------------------------------------------------------------
// Small presentational primitives
// ---------------------------------------------------------------------------

const Tooltip = ({
  children,
  content,
  align = 'center',
  className = '',
}: {
  children: React.ReactNode
  content: string
  align?: 'center' | 'start' | 'end'
  className?: string
}) => (
  <div className={`group relative ${className}`}>
    {children}
    <span
      role="tooltip"
      className={`pointer-events-none absolute top-full z-50 mt-2 hidden w-60 rounded-lg border border-paper-300 bg-white px-3 py-2 text-left text-[11px] font-normal leading-relaxed text-ai-graphite-600 shadow-lg group-hover:block
        ${align === 'start' ? 'left-0' : align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}
    >
      {content}
    </span>
  </div>
)

/** Label + control pair inside the dense toolbar. */
const ControlGroup = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-1.5">
    <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ai-graphite-400">{label}</span>
    {children}
  </div>
)

const ToolbarDivider = () => <span className="hidden h-4 w-px bg-paper-300 sm:block" />

// ---------------------------------------------------------------------------
// Generation progress — driven entirely by server events
// ---------------------------------------------------------------------------

function ClaimGenerationProgress({
  completedSteps,
  activeStep,
  stepDetails,
  streamedClaims,
  startedAt,
}: {
  completedSteps: string[]
  activeStep: string | null
  stepDetails: Record<string, string>
  streamedClaims: StreamingClaim[]
  startedAt: number
}) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  const activeIndex = activeStep ? GENERATION_STEPS.findIndex(step => step.key === activeStep) : -1
  const doneCount = completedSteps.length
  const streamingClaim = streamedClaims.find(claim => !claim.complete)
  const detail = activeStep ? stepDetails[activeStep] : undefined

  return (
    <div className="overflow-hidden rounded-lg border border-paper-300 bg-white">
      {/* Status line */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-paper-200 bg-paper-100 px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-ai-blue-600" />
          <span className="truncate text-[13px] font-medium text-ai-graphite-900" aria-live="polite">
            {activeIndex >= 0 ? GENERATION_STEPS[activeIndex].label : 'Starting'}
            {detail && <span className="ml-2 font-normal text-ai-graphite-500">{detail}</span>}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] tabular-nums text-ai-graphite-500">
          {streamedClaims.length > 0 && (
            <span className="font-medium text-ai-blue-700">
              {streamedClaims.length} claim{streamedClaims.length === 1 ? '' : 's'} drafted
            </span>
          )}
          <span>{elapsed}s</span>
        </div>
      </div>

      {/* Step rail */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-paper-200 px-4 py-2.5">
        {GENERATION_STEPS.map((step, index) => {
          const Icon = step.icon
          const complete = completedSteps.includes(step.key)
          const active = step.key === activeStep
          return (
            <React.Fragment key={step.key}>
              {index > 0 && (
                <span className={`hidden h-px w-4 sm:block ${complete || active ? 'bg-ai-blue-200' : 'bg-paper-300'}`} />
              )}
              <div
                className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-ai-blue-50 text-ai-blue-700'
                    : complete
                      ? 'text-ai-graphite-600'
                      : 'text-ai-graphite-400'
                }`}
              >
                {complete && !active
                  ? <Check className="h-3.5 w-3.5 text-ai-blue-600" />
                  : <Icon className={`h-3.5 w-3.5 ${active ? 'text-ai-blue-600' : ''}`} />}
                <span className="whitespace-nowrap">{step.label}</span>
              </div>
            </React.Fragment>
          )
        })}
        <span className="ml-auto hidden text-[11px] tabular-nums text-ai-graphite-400 sm:block">
          {doneCount}/{GENERATION_STEPS.length}
        </span>
      </div>

      {/* Live claim text */}
      <div className="px-4 py-3">
        {streamedClaims.length === 0 ? (
          <div className="space-y-2.5 py-1" aria-hidden>
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="h-3 animate-pulse rounded bg-paper-200"
                style={{ width: `${[92, 78, 60][row]}%`, animationDelay: `${row * 140}ms` }}
              />
            ))}
          </div>
        ) : (
          <div className="max-h-[440px] space-y-3 overflow-y-auto pr-1">
            {streamedClaims.map((claim) => (
              <motion.p
                key={claim.number}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className={`text-[13.5px] leading-relaxed ${
                  claim.complete ? 'text-ai-graphite-700' : 'text-ai-graphite-900'
                }`}
              >
                <strong className="font-semibold text-ai-graphite-900">{claim.number}.</strong>{' '}
                {claim.text}
                {claim === streamingClaim && (
                  <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-ai-blue-600 align-middle" />
                )}
              </motion.p>
            ))}
          </div>
        )}
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

  // ---- Live generation state (fed by the NDJSON stream) ----
  const [generationStartedAt, setGenerationStartedAt] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<string[]>([])
  const [activeStep, setActiveStep] = useState<string | null>(null)
  const [stepDetails, setStepDetails] = useState<Record<string, string>>({})
  const [streamedClaims, setStreamedClaims] = useState<StreamingClaim[]>([])

  // ---- Patent type state ----
  const [patentType, setPatentType] = useState<PatentType | null>(null)
  const [isUpdatingPatentType, setIsUpdatingPatentType] = useState(false)
  const [showPatentTypeDropdown, setShowPatentTypeDropdown] = useState(false)

  // ---- User claim remarks ----
  const [userClaimRemarks, setUserClaimRemarks] = useState('')
  const [claimScopeStyle, setClaimScopeStyle] = useState<ClaimScopeStyle>('default')
  const [isSavingClaimScopeStyle, setIsSavingClaimScopeStyle] = useState(false)

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
    setClaimScopeStyle(normalizeClaimScopeStyle(nd.claimScopeStyle))

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
  const controlsLocked = claimsFrozen || isGeneratingClaims || isResettingClaims

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

  const handleClaimScopeStyleChange = async (nextStyle: ClaimScopeStyle) => {
    if (controlsLocked || isSavingClaimScopeStyle || nextStyle === claimScopeStyle) return
    const previousStyle = claimScopeStyle
    setClaimScopeStyle(nextStyle)
    if (!session?.id) return
    try {
      setIsSavingClaimScopeStyle(true)
      setError(null)
      const response = await onComplete({
        action: 'update_idea_record',
        sessionId: session.id,
        patch: {
          claimScopeStyle: nextStyle,
        },
      })
      if (response?.error) throw new Error(response.error)
    } catch (e) {
      setClaimScopeStyle(previousStyle)
      console.error('Failed to save claim scope style:', e)
      setError(e instanceof Error ? e.message : 'Failed to save claim scope style.')
    } finally {
      setIsSavingClaimScopeStyle(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Claims generation (streamed)
  // ---------------------------------------------------------------------------

  const resetGenerationProgress = () => {
    setCompletedSteps([])
    setActiveStep(null)
    setStepDetails({})
    setStreamedClaims([])
  }

  const applyProgressEvent = (event: any) => {
    if (event?.type === 'stage' && event.key) {
      setActiveStep(event.key)
      setCompletedSteps(steps => (steps.includes(event.key) ? steps : [...steps, event.key]))
      if (event.detail) {
        setStepDetails(details => ({ ...details, [event.key]: event.detail }))
      }
      return
    }

    if (event?.type === 'claims_reset') {
      setStreamedClaims([])
      return
    }

    if (event?.type === 'claims_delta' && Array.isArray(event.claims)) {
      setStreamedClaims((current) => {
        const merged = new Map(current.map(claim => [claim.number, claim]))
        event.claims.forEach((claim: StreamingClaim) => merged.set(claim.number, claim))
        return Array.from(merged.values()).sort((a, b) => a.number - b.number)
      })
    }
  }

  /**
   * Run one generation over the NDJSON stream. Returns the terminal payload.
   * Falls back to the buffered `generate_claims` action when streaming is unavailable
   * (older deploy, proxy that buffers, or a response with no readable body).
   */
  const runClaimGeneration = async (payload: Record<string, any>): Promise<any> => {
    if (!patent?.id || typeof window === 'undefined') {
      return await onComplete(payload)
    }

    let response: Response
    try {
      response = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ ...payload, action: 'generate_claims_stream' })
      })
    } catch (networkError) {
      console.warn('Claim stream request failed, falling back to buffered generation:', networkError)
      return await onComplete(payload)
    }

    if (!response.ok || !response.body) {
      console.warn(`Claim stream unavailable (status ${response.status}); falling back to buffered generation.`)
      return await onComplete(payload)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finalPayload: any = null

    const handleLine = (line: string) => {
      if (!line.trim()) return
      let event: any
      try {
        event = JSON.parse(line)
      } catch {
        return // ignore a partial or malformed frame
      }

      if (event.type === 'complete' || event.type === 'error') {
        finalPayload = event
        return
      }
      applyProgressEvent(event)
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) handleLine(line)
    }
    buffer += decoder.decode()
    if (buffer.trim()) handleLine(buffer)

    if (!finalPayload) {
      throw new Error('Claim generation ended before returning a claim set. Please try again.')
    }
    return finalPayload
  }

  const handleGenerateClaims = async () => {
    if (!session?.id) return
    try {
      setIsGeneratingClaims(true)
      setError(null)
      setGenerationStartedAt(Date.now())
      resetGenerationProgress()

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
        supportDataSources: normalizedRecord.supportDataSources,
        scopeRecommendations: normalizedRecord.scopeRecommendations,
        normalizationReviewWarnings: normalizedRecord.normalizationReviewWarnings
      }

      const payload = {
        action: 'generate_claims',
        sessionId: session.id,
        jurisdiction: activeJurisdiction,
        userInstructions: regenerateInstructions.trim() || undefined,
        userClaimRemarks: userClaimRemarks.trim() || undefined,
        claimScopeStyle,
        usePersonaStyle,
        personaSelection,
        ideaContext
      }

      let response = await runClaimGeneration(payload)

      if (response?.code === 'PERSONA_COVERAGE_WARNING') {
        const confirmed = window.confirm(formatPersonaCoverageWarning(response.personaWarnings || []))
        if (!confirmed) return
        resetGenerationProgress()
        response = await runClaimGeneration({ ...payload, acceptPersonaWarnings: true })
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
      if (response?.claimScopeStyle) {
        setClaimScopeStyle(normalizeClaimScopeStyle(response.claimScopeStyle))
      }

      await onRefresh()
      setRegenerateInstructions('')
    } catch (e) {
      console.error('Failed to generate claims:', e)
      setError(e instanceof Error ? e.message : 'Failed to generate claims. Please try again.')
    } finally {
      setIsGeneratingClaims(false)
      resetGenerationProgress()
    }
  }

  const handleUpdatePatentType = async (newType: PatentType) => {
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

  const handleResetClaims = async () => {
    if (!session?.id || !hasClaims) return
    const confirmed = window.confirm(
      'Reset claims?\n\nThis deletes the generated, edited, and refined claim data for this Stage 1 claim set. This cannot be undone.'
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

  // Claims can still arrive locked (from the Claim Refinement stage, an automated batch
  // run, or a session created before locking became optional), so unlocking stays.
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

  const skipPriorArtAndContinue = async () => {
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
    <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
      {/* ---- Page header: single row ---- */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ai-blue-50 ring-1 ring-inset ring-ai-blue-100">
            <Scale className="h-[18px] w-[18px] text-ai-blue-700" />
          </div>
          <div>
            <h2 className="text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ai-graphite-900">
              Preliminary Claims
            </h2>
            <p className="text-[13px] leading-tight text-ai-graphite-500">
              Jurisdiction-aware claims drafted from your invention disclosure.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-paper-300 bg-white px-2 py-1 text-[11px] font-medium text-ai-graphite-600">
            <Globe className="h-3 w-3 text-ai-graphite-400" />
            {activeJurisdiction}
            {allJurisdictions.length > 1 && (
              <span className="text-ai-graphite-400">+{allJurisdictions.length - 1}</span>
            )}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${
              claimsFrozen
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-paper-300 bg-white text-ai-graphite-600'
            }`}
          >
            {claimsFrozen ? <Lock className="h-3 w-3" /> : <Check className="h-3 w-3 text-emerald-600" />}
            {claimsFrozen && claimsFrozenAt
              ? `Locked ${new Date(claimsFrozenAt).toLocaleDateString()}`
              : hasClaims ? 'Saved' : 'Not started'}
          </span>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ---- Claims card ---- */}
      <div className="rounded-xl border border-paper-300 bg-white">
        {/* Dense control bar: every claim-generation setting on one line */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-t-xl border-b border-paper-200 bg-paper-50 px-3 py-2">
          {/* Invention type */}
          <ControlGroup label="Type">
            <div className="relative" data-patent-type-dropdown>
              <button
                onClick={() => setShowPatentTypeDropdown(!showPatentTypeDropdown)}
                disabled={isUpdatingPatentType || claimsFrozen}
                title="Change the invention type if the AI classification is incorrect"
                className={`flex items-center gap-1 rounded-md border border-paper-300 bg-white px-2 py-1 text-[11px] font-semibold text-ai-graphite-800 transition-colors ${
                  isUpdatingPatentType
                    ? 'cursor-wait opacity-60'
                    : claimsFrozen
                      ? 'cursor-not-allowed opacity-60'
                      : 'hover:border-ai-blue-300 hover:text-ai-blue-700'
                }`}
              >
                {isUpdatingPatentType
                  ? <RefreshCw className="h-3 w-3 animate-spin" />
                  : (patentType || 'Classifying…')}
                {!claimsFrozen && !isUpdatingPatentType && (
                  <ChevronDown className={`h-3 w-3 text-ai-graphite-400 transition-transform ${showPatentTypeDropdown ? 'rotate-180' : ''}`} />
                )}
              </button>

              <AnimatePresence>
                {showPatentTypeDropdown && !claimsFrozen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute left-0 top-full z-50 mt-1 min-w-[210px] overflow-hidden rounded-lg border border-paper-300 bg-white py-1 shadow-lg"
                  >
                    {PATENT_TYPES.map(({ value, hint }) => (
                      <button
                        key={value}
                        onClick={() => handleUpdatePatentType(value)}
                        disabled={isUpdatingPatentType}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                          patentType === value ? 'bg-ai-blue-50' : 'hover:bg-paper-100'
                        }`}
                      >
                        <span className="text-[11px] font-semibold text-ai-graphite-800">{value}</span>
                        <span className="text-[10px] text-ai-graphite-400">{hint}</span>
                        {patentType === value && <Check className="ml-auto h-3 w-3 text-ai-blue-600" />}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </ControlGroup>

          <ToolbarDivider />

          {/* Claim scope — segmented control replaces the old slider block */}
          <ControlGroup label="Scope">
            <div
              role="group"
              aria-label="Claim scope"
              className="flex items-center rounded-md border border-paper-300 bg-white p-0.5"
            >
              {CLAIM_SCOPE_STYLES.map((style) => {
                const active = style.value === claimScopeStyle
                return (
                  <Tooltip key={style.value} content={style.help} align="start">
                    <button
                      type="button"
                      onClick={() => handleClaimScopeStyleChange(style.value)}
                      disabled={controlsLocked || isSavingClaimScopeStyle}
                      aria-pressed={active}
                      className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        active
                          ? 'bg-ai-blue-600 text-white'
                          : 'text-ai-graphite-600 hover:bg-paper-100 hover:text-ai-graphite-900'
                      }`}
                    >
                      {style.label}
                    </button>
                  </Tooltip>
                )
              })}
            </div>
            {isSavingClaimScopeStyle && <RefreshCw className="h-3 w-3 animate-spin text-ai-blue-500" />}
          </ControlGroup>

          <ToolbarDivider />

          {/* Writing style / persona */}
          <ControlGroup label="Style">
            <div className="flex items-center rounded-md border border-paper-300 bg-white">
              <button
                type="button"
                onClick={handleStyleToggle}
                disabled={checkingPersonas}
                title={usePersonaStyle
                  ? 'Persona style is on — claims are drafted in your selected writing style'
                  : 'Draft claims in your own writing style'}
                className={`rounded-l-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  usePersonaStyle
                    ? 'bg-ai-blue-600 text-white'
                    : 'text-ai-graphite-500 hover:bg-paper-100'
                } ${checkingPersonas ? 'cursor-wait opacity-60' : ''}`}
              >
                {checkingPersonas ? '…' : usePersonaStyle ? 'On' : 'Off'}
              </button>
              <span className="h-4 w-px bg-paper-300" />
              <button
                type="button"
                onClick={handlePersonaButtonClick}
                disabled={checkingPersonas}
                title="Select a writing persona for your claims"
                className="flex items-center gap-1 rounded-r-md px-2 py-1 text-[11px] font-medium text-ai-graphite-700 transition-colors hover:bg-paper-100 hover:text-ai-blue-700"
              >
                <User className="h-3 w-3 text-ai-graphite-400" />
                {personaSelection?.primaryPersonaName || 'Persona'}
                {personaSelection?.secondaryPersonaNames?.length ? (
                  <span className="rounded bg-ai-blue-50 px-1 text-[10px] text-ai-blue-700">
                    +{personaSelection.secondaryPersonaNames.length}
                  </span>
                ) : null}
              </button>
            </div>
          </ControlGroup>

          {/* Right-aligned actions */}
          <div className="ml-auto flex items-center gap-1.5">
            {claimsFrozen ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnfreezeClaims}
                title="These claims are locked. Unlock to edit or regenerate them."
                className="h-7 border-paper-300 px-2 text-[11px] font-medium text-ai-graphite-700 hover:border-ai-blue-300 hover:text-ai-blue-700"
              >
                <Unlock className="mr-1 h-3 w-3" />
                Unlock
              </Button>
            ) : (
              <>
                {hasClaims && !isGeneratingClaims && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={isEditingClaims ? handleDoneEditing : () => setIsEditingClaims(true)}
                    disabled={isResettingClaims}
                    className="h-7 border-paper-300 px-2 text-[11px] font-medium text-ai-graphite-700 hover:border-ai-blue-300 hover:text-ai-blue-700"
                  >
                    {isEditingClaims
                      ? <><Check className="mr-1 h-3 w-3" />{draftSaved ? 'Saved' : 'Done'}</>
                      : <><Edit2 className="mr-1 h-3 w-3" />Edit</>}
                  </Button>
                )}
                {hasClaims && !isGeneratingClaims && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResetClaims}
                    disabled={isResettingClaims}
                    title="Delete this claim set and start over"
                    className="h-7 border-paper-300 px-2 text-[11px] font-medium text-ai-graphite-600 hover:border-wax-300 hover:text-wax-600"
                  >
                    {isResettingClaims
                      ? <RefreshCw className="h-3 w-3 animate-spin" />
                      : <Trash2 className="h-3 w-3" />}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Multi-jurisdiction notice */}
        {allJurisdictions.length > 1 && (
          <div className="flex items-start gap-2 border-b border-paper-200 bg-ai-blue-50/50 px-3 py-1.5 text-[11px] leading-relaxed text-ai-blue-800">
            <Globe className="mt-0.5 h-3 w-3 flex-shrink-0" />
            <span>
              Reference claims use {activeJurisdiction} rules. Jurisdiction-specific claims are drafted one-by-one during the drafting stage.
            </span>
          </div>
        )}

        {/* ---- Body ---- */}
        <div className="p-3 sm:p-4">
          {isGeneratingClaims ? (
            <ClaimGenerationProgress
              completedSteps={completedSteps}
              activeStep={activeStep}
              stepDetails={stepDetails}
              streamedClaims={streamedClaims}
              startedAt={generationStartedAt}
            />
          ) : !hasClaims ? (
            /* ---- Empty state ---- */
            <div className="mx-auto max-w-xl py-8 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-paper-100">
                <Scale className="h-5 w-5 text-ai-graphite-400" />
              </div>
              <h3 className="text-sm font-semibold text-ai-graphite-900">No claims yet</h3>
              <p className="mt-1 text-[13px] text-ai-graphite-500">
                Claims will be drafted from your disclosure using {activeJurisdiction} patent office rules.
              </p>

              <div className="mt-5 text-left">
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ai-graphite-400">
                  <Lightbulb className="h-3 w-3" />
                  Drafting remarks (optional)
                </label>
                <textarea
                  value={userClaimRemarks}
                  onChange={(e) => setUserClaimRemarks(e.target.value)}
                  placeholder="Any specific emphasis, exclusions, embodiments, or scope preferences?"
                  className="w-full resize-none rounded-lg border border-paper-300 px-3 py-2 text-[13px] text-ai-graphite-800 placeholder:text-ai-graphite-400 focus:border-ai-blue-500 focus:outline-none focus:ring-1 focus:ring-ai-blue-500"
                  rows={2}
                />
                <p className="mt-1 text-[11px] text-ai-graphite-400">
                  Remarks influence scope and emphasis, not the invention type.
                </p>
              </div>

              <Button
                onClick={() => handleGenerateClaims()}
                className="mt-4 bg-ai-blue-600 text-white hover:bg-ai-blue-700"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Generate claims for {activeJurisdiction}
              </Button>
            </div>
          ) : (
            /* ---- Claims present ---- */
            <div className="space-y-3">
              {isEditingClaims ? (
                <div className="overflow-hidden rounded-lg border border-ai-blue-200">
                  <div className="flex items-center gap-1.5 border-b border-ai-blue-200 bg-ai-blue-50 px-3 py-1.5 text-[11px] text-ai-blue-800">
                    <Edit2 className="h-3 w-3" />
                    Editing — choose Done when finished to save.
                  </div>
                  <ClaimsEditor
                    ref={claimsEditorRef}
                    value={claimsText}
                    onChange={setClaimsText}
                    disabled={claimsFrozen}
                    placeholder={`1. A method for... comprising:\n   a) a first step of...\n\n2. The method of claim 1, wherein...`}
                  />
                </div>
              ) : (
                <div
                  className={`group rounded-lg border border-paper-300 transition-colors ${
                    claimsFrozen ? '' : 'cursor-text hover:border-ai-blue-300'
                  }`}
                  onClick={() => !claimsFrozen && setIsEditingClaims(true)}
                >
                  <div
                    className="prose prose-sm max-w-none px-4 py-3 text-[13.5px] leading-relaxed text-ai-graphite-700 [&>p]:mb-3 [&>p:last-child]:mb-0 [&_strong]:font-semibold [&_strong]:text-ai-graphite-900"
                    dangerouslySetInnerHTML={{ __html: claimsText }}
                  />
                  {!claimsFrozen && (
                    <div className="flex items-center gap-1 border-t border-paper-200 px-4 py-1.5 text-[11px] text-ai-graphite-400 transition-colors group-hover:text-ai-blue-600">
                      <Edit2 className="h-3 w-3" />
                      Click anywhere to edit
                    </div>
                  )}
                </div>
              )}

              {/* Regenerate row. No freeze step: saved claims are what drafting uses. */}
              {!claimsFrozen && (
                <div className="flex items-center gap-1.5 border-t border-paper-200 pt-3">
                  <input
                    type="text"
                    value={regenerateInstructions}
                    onChange={(e) => setRegenerateInstructions(e.target.value)}
                    placeholder="Instructions for regeneration (optional)"
                    className="h-8 flex-1 rounded-md border border-paper-300 px-2.5 text-[12px] text-ai-graphite-800 placeholder:text-ai-graphite-400 focus:border-ai-blue-500 focus:outline-none focus:ring-1 focus:ring-ai-blue-500"
                    disabled={controlsLocked}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleGenerateClaims()}
                    disabled={controlsLocked}
                    className="h-8 border-paper-300 px-2.5 text-[12px] text-ai-graphite-700 hover:border-ai-blue-300 hover:text-ai-blue-700"
                  >
                    <RefreshCw className="mr-1.5 h-3 w-3" />
                    Regenerate
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- Navigation ---- */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-ai-graphite-500">
          {claimsFrozen
            ? 'Claims are locked. Unlock to edit — proceeding works either way.'
            : 'These claims carry through to every later stage. You can still edit them.'}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {skipPriorArtClicked ? (
            <>
              <label className="flex items-center gap-2 text-[12px] text-ai-graphite-700">
                <input
                  type="checkbox"
                  checked={useInitialClaimsForDraft}
                  onChange={(e) => setUseInitialClaimsForDraft(e.target.checked)}
                  className="rounded border-paper-400 text-ai-blue-600 focus:ring-ai-blue-500"
                />
                Use initial claims for drafting
              </label>
              <Button
                onClick={skipPriorArtAndContinue}
                disabled={!canProceed || isNavigating || isResettingClaims}
                className="bg-ai-blue-600 text-white hover:bg-ai-blue-700"
              >
                Next
                <ChevronRight className="ml-1.5 h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleSkipClick}
                disabled={!canProceed || isNavigating || isResettingClaims}
                className="border-paper-300 text-ai-graphite-700 hover:border-ai-blue-300 hover:text-ai-blue-700"
              >
                Skip prior art
              </Button>
              <Button
                onClick={proceedToPriorArt}
                disabled={!canProceed || isNavigating || isResettingClaims}
                className="bg-ai-blue-600 text-white hover:bg-ai-blue-700"
              >
                Next: Prior art
                <ChevronRight className="ml-1.5 h-4 w-4" />
              </Button>
            </>
          )}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-paper-300 bg-white shadow-xl">
            <div className="flex items-center gap-3 border-b border-paper-200 px-5 py-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-paper-100">
                <User className="h-4 w-4 text-ai-graphite-500" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-ai-graphite-900">No writing personas yet</h3>
                <p className="text-[12px] text-ai-graphite-500">Create one to draft in your own style</p>
              </div>
            </div>

            <div className="space-y-3 px-5 py-4">
              <p className="text-[13px] leading-relaxed text-ai-graphite-600">
                Writing personas let the AI mirror your preferred drafting style, terminology, and structure
                when generating claims and other patent sections.
              </p>

              <div className="rounded-lg border border-paper-300 bg-paper-50 p-3">
                <h4 className="text-[12px] font-semibold text-ai-graphite-900">Create your own</h4>
                <p className="mt-1 text-[12px] leading-relaxed text-ai-graphite-600">
                  Open the <strong>Personas</strong> page from the main navigation to capture your personal writing style.
                </p>
              </div>

              {!isAdmin ? (
                <div className="rounded-lg border border-paper-300 bg-paper-50 p-3">
                  <h4 className="text-[12px] font-semibold text-ai-graphite-900">Use organization personas</h4>
                  <p className="mt-1 text-[12px] leading-relaxed text-ai-graphite-600">
                    Ask an Owner or Admin to create shared organization personas for your team.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-ai-blue-200 bg-ai-blue-50 p-3">
                  <h4 className="text-[12px] font-semibold text-ai-blue-900">Create organization personas</h4>
                  <p className="mt-1 text-[12px] leading-relaxed text-ai-blue-800">
                    As an Admin you can set a persona&apos;s visibility to <strong>Organization</strong> so everyone can use it.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-paper-200 bg-paper-50 px-5 py-3">
              <Button variant="outline" onClick={() => setShowNoPersonasModal(false)} className="border-paper-300">
                Close
              </Button>
              <Button
                onClick={() => {
                  setShowNoPersonasModal(false)
                  window.location.href = '/personas'
                }}
                className="bg-ai-blue-600 text-white hover:bg-ai-blue-700"
              >
                Go to Personas
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
