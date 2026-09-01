'use client'


import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { PageLoadingBird } from '@/components/ui/loading-bird'
import { getStageNavigationPath } from '@/lib/stage-navigation-path'

// Stage components
import IdeaEntryStage from '@/components/drafting/IdeaEntryStage'
import ComponentPlannerStage from '@/components/drafting/ComponentPlannerStage'
import FigurePlannerStage from '@/components/drafting/FigurePlannerStage'
import ClaimRefinementStage from '@/components/drafting/ClaimRefinementStage'
import AnnexureDraftStage from '@/components/drafting/AnnexureDraftStage'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - file added dynamically during session; type generation will catch up
import RelatedArtStage from '@/components/drafting/RelatedArtStage'
import CountryWiseDraftStage from '@/components/drafting/CountryWiseDraftStage'
import PreliminaryClaimsStage from '@/components/drafting/PreliminaryClaimsStage'
// Vertical Stage Navigation (replaces FloatingStageNavigation)
import VerticalStageNav from '@/components/drafting/VerticalStageNav'
import StageFooterNav from '@/components/drafting/StageFooterNav'
import { STAGE_DEFINITIONS } from '@/lib/stage-navigation-config'
// Floating forward/backward navigation buttons

interface DraftingSession {
  id: string
  status: string
  createdAt: string
  updatedAt: string
  ideaRecord?: any
  referenceMap?: any
  figurePlans?: any[]
  diagramSources?: any[]
  sketchRecords?: any[]
  annexureDrafts?: any[]
  priorArtConfig?: any
  manualPriorArt?: any
  relatedArtRuns?: any[]
  relatedArtSelections?: any[]
  // Figure sequence for unified ordering of diagrams + sketches
  figureSequence?: Array<{ id: string; type: 'diagram' | 'sketch'; sourceId: string; finalFigNo: number }>
  figureSequenceFinalized?: boolean
  figuresSkipped?: boolean
  figuresSkippedAt?: string | null
}

interface Patent {
  id: string
  title: string
  project: {
    id: string
    name: string
  }
}

interface PatentUsageMetrics {
  patent_id: string
  total_input_tokens: number
  total_output_tokens: number
  tokens_by_model: Array<{ model: string; inputTokens: number; outputTokens: number }>
  tokens_by_task: Array<{ task: string; inputTokens: number; outputTokens: number }>
}

const STAGE_COMPONENTS = {
  IDEA_ENTRY: IdeaEntryStage,
  PRELIMINARY_CLAIMS: PreliminaryClaimsStage,
  RELATED_ART: RelatedArtStage,
  CLAIM_REFINEMENT: ClaimRefinementStage,
  COMPONENT_PLANNER: ComponentPlannerStage,
  FIGURE_PLANNER: FigurePlannerStage,
  COUNTRY_WISE_DRAFTING: CountryWiseDraftStage,
  ANNEXURE_DRAFT: AnnexureDraftStage,
  COMPLETED: AnnexureDraftStage
}

const STAGE_LABELS = {
  IDEA_ENTRY: 'Invention Structure',
  PRELIMINARY_CLAIMS: 'Preliminary Claims',
  RELATED_ART: 'Prior Art Analysis',
  CLAIM_REFINEMENT: 'Claim Refinement',
  COMPONENT_PLANNER: 'Component Planner',
  FIGURE_PLANNER: 'Figure Planner',
  COUNTRY_WISE_DRAFTING: 'Jurisdiction Setup',
  ANNEXURE_DRAFT: 'Draft Sections',
  COMPLETED: 'Completed'
}

const STAGE_PROGRESS = {
  IDEA_ENTRY: 10,
  PRELIMINARY_CLAIMS: 22,
  RELATED_ART: 35,
  CLAIM_REFINEMENT: 45,
  COMPONENT_PLANNER: 58,
  FIGURE_PLANNER: 70,
  COUNTRY_WISE_DRAFTING: 55,
  ANNEXURE_DRAFT: 82,
  COMPLETED: 100
}

const STAGE_ORDER: Array<keyof typeof STAGE_COMPONENTS> = [
  'IDEA_ENTRY',
  'PRELIMINARY_CLAIMS',
  'RELATED_ART',
  'CLAIM_REFINEMENT',
  'COMPONENT_PLANNER',
  'FIGURE_PLANNER',
  'ANNEXURE_DRAFT',
  'COMPLETED'
]

// Normalize legacy statuses (REVIEW_FIX / EXPORT_READY) to the unified drafting stage
const normalizeStage = (status?: string): keyof typeof STAGE_COMPONENTS => {
  if (status === 'REVIEW_FIX' || status === 'EXPORT_READY') return 'ANNEXURE_DRAFT'
  if (status && status in STAGE_COMPONENTS) return status as keyof typeof STAGE_COMPONENTS
  return 'ANNEXURE_DRAFT'
}

export default function PatentDraftingPage() {
  const { user, isLoading: authLoading, refreshUser, logout } = useAuth() as any
  
  // Sidebar collapsed state for responsive layout
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [stageNavOpen, setStageNavOpen] = useState(false)
  const router = useRouter()
  const params = useParams()
  const patentId = params?.patentId as string

  const [patent, setPatent] = useState<Patent | null>(null)
  const [session, setSession] = useState<DraftingSession | null>(null)
  const [styleStatus, setStyleStatus] = useState<{ enabled: boolean; sections: string[]; profile?: { version: number; status: string; updatedAt: string } | null } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // Fatal errors block page render; inline errors are shown in-page while keeping the user on the drafting screen
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [usage, setUsage] = useState<PatentUsageMetrics | null>(null)
  const [quotaError, setQuotaError] = useState<{
    message: string;
    code: string;
    quotaInfo?: { remainingDaily: number | null; remainingMonthly: number | null; source: string }
  } | null>(null)
  const [navNotice, setNavNotice] = useState<string | null>(null)
  const stageNavigationInFlightRef = useRef(false)

  const resumeSession = useCallback(async () => {
    try {
      const response = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ action: 'resume' })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to resume drafting')
      }

      const data = await response.json()
      setSession(data.session)
      setInlineError(null)
      return data.session
    } catch (err) {
      console.error('Resume session error:', err)
      // Keep the user on the drafting page; surface a retry message instead of kicking them out
      setInlineError('Error has occurred, please retry.')
      return null
    }
  }, [patentId])

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true)
      setInlineError(null)

      // Load patent details
      const patentResponse = await fetch(`/api/patents/${patentId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (!patentResponse.ok) {
        const errorData = await patentResponse.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to load patent')
      }

      const patentData = await patentResponse.json()
      setPatent(patentData.patent)

      // Load drafting sessions
      const sessionResponse = await fetch(`/api/patents/${patentId}/drafting`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json()
        const latest = sessionData.sessions?.[0] || null
        setSession(latest)

        // Fetch style integration status (best-effort)
        try {
          const ss = await fetch(`/api/patents/${patentId}/drafting/style-status`, {
            headers: {
              "Authorization": `Bearer ${localStorage.getItem('auth_token')}`
            }
          })
          if (ss.ok) {
            const data = await ss.json()
            setStyleStatus(data)
          } else {
            setStyleStatus(null)
          }
        } catch {
          setStyleStatus(null)
        }
        // Auto-resume if no session exists yet
        if (!latest) {
          await resumeSession()
        }
      } else {
        // If GET fails, try resume to recover gracefully
        await resumeSession()
      }

      // Load per-patent LLM usage (best-effort; non-blocking)
      try {
        const usageResponse = await fetch(`/api/patents/${patentId}/usage`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        })
        if (usageResponse.ok) {
          const usageData = await usageResponse.json()
          setUsage(usageData)
        } else {
          setUsage(null)
        }
      } catch {
        setUsage(null)
      }

    } catch (err) {
      console.error('Failed to load data:', err)
      // Fatal because we cannot render the drafting workspace without these primitives
      setFatalError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }, [patentId, resumeSession])

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (!authLoading && user) {
      loadData()
    }
  }, [authLoading, user, router, patentId, loadData])

  const refreshSessionData = async () => {
    try {
      const sessionResponse = await fetch(`/api/patents/${patentId}/drafting`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json()
        const latest = sessionData.sessions?.[0] || null
        setSession(latest)
      }

      try {
        const ss = await fetch(`/api/patents/${patentId}/drafting/style-status`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        })
        if (ss.ok) {
          const data = await ss.json()
          setStyleStatus(data)
        }
      } catch (styleErr) {
        console.warn('Silent style status refresh failed:', styleErr)
      }
    } catch (err) {
      console.error('Failed to refresh session data:', err)
    }
  }

  const handleStageComplete = async (stageData: any) => {
    console.log('handleStageComplete called with:', stageData)
    const doRequest = async () => {
      return await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(stageData)
      })
    }
    try {
      // Call API to update stage
      let response = await doRequest()
      console.log('API response status:', response.status)

      let result = null

      // Retry once on 401 by refreshing user/token
      if (response.status === 401) {
        console.log('Retrying after 401 error')
        try { await refreshUser(localStorage.getItem('auth_token') || undefined) } catch {}
        response = await doRequest()
        console.log('Retry response status:', response.status)
      }

      if (!response.ok) {
        let message = 'Failed to update stage'
        let errorCode = 'UNKNOWN_ERROR'
        let quotaInfo = undefined

        try {
          const err = await response.json()
          console.log('API error response:', err)
          if (err?.error) message = err.error
          if (err?.code) errorCode = err.code
          if (err?.quotaInfo) quotaInfo = err.quotaInfo
          result = err // Store error result for potential use
        } catch (parseError) {
          console.log('Failed to parse error response:', parseError)
        }
        console.log('Stage update failed:', { status: response.status, message, errorCode, stageData })

        // Ensure message is always a string
        if (typeof message !== 'string' || !message.trim()) {
          message = 'Failed to update stage'
        }

        if (response.status === 401) {
          try { logout() } catch {}
          router.push('/login')
          // Avoid throwing after redirect to prevent runtime error on this page
          return null
        }

        // Handle quota errors specially - show them in UI instead of throwing
        if (errorCode === 'DAILY_QUOTA_EXCEEDED' || errorCode === 'MONTHLY_QUOTA_EXCEEDED' || errorCode === 'SERVICE_ACCESS_DENIED') {
          setQuotaError({
            message,
            code: errorCode,
            quotaInfo
          })
          return null // Don't proceed with the stage update
        }

        // Handle component validation errors
        if (errorCode === 'INVALID_COMPONENT_MAP' && result?.details) {
          const validationErrors = Array.isArray(result.details) ? result.details : [result.details];
          setInlineError(`Component validation failed: ${validationErrors.join(', ')}`);
          if (stageData?.action === 'update_component_map') {
            return { error: message, details: validationErrors, code: errorCode };
          }
          return null;
        }

        // Handle stage transition errors gracefully - show in UI instead of crashing
        if (message.includes('Stage transition not allowed') || message.includes('transition')) {
          setNavNotice('Please follow the stages in order. Use the navigation arrows or sidebar to proceed through each step sequentially.');
          return null;
        }

        // For component-owned long-running actions, return error details to the component instead
        // of only setting a page-level error. This lets the active stage show the actionable message.
        const componentOwnedErrorActions = [
          'generate_claims',
          'reset_claims',
          'claim_refinement_preview',
          'claim_refinement_apply',
          'freeze_claims',
          'unfreeze_claims',
          'save_claims',
          'set_stage',
          'generate_sections',
          'update_persona_config',
          'regenerate_diagram_llm', 
          'generate_diagrams_llm',
          'plan_and_generate_diagrams_llm', // Combined plan+generate action
          'plan_figures_llm',
          'save_plantuml',
          'add_figure_llm',
          'add_figures_llm',
          'fix_plantuml_render',
          'modify_sketch',
          'generate_sketch',
          'generate_sketch_guided',
          'refine_sketch'
        ]
        if (componentOwnedErrorActions.includes(stageData?.action)) {
          // Return error object so component can display it
          setInlineError(message || 'Error has occurred, please retry.')
          return {
            error: message,
            details: result?.details,
            code: errorCode,
            confirmationRequired: result?.confirmationRequired,
            splitProposal: result?.splitProposal,
            personaWarnings: result?.personaWarnings,
            personaProvenance: result?.personaProvenance
          }
        }

        // For other errors, set inline error state instead of throwing to prevent runtime crash
        setInlineError(message || 'Error has occurred, please retry.');
        return null;
      }

      // CRITICAL: Parse successful response data BEFORE refreshing session
      // This ensures the caller gets the API response even if the component re-renders
      try {
        result = await response.json()
        console.log('API success response received:', { action: stageData?.action, hasResult: !!result })
      } catch (parseError) {
        console.warn('Failed to parse success response as JSON:', parseError)
      }

      // For read-only actions, avoid refreshing to preserve local UI state
      // IMPORTANT: Session refresh can cause component remounts which lose async context
      const action = stageData?.action
      
      // Actions that skip refresh entirely (local state only, no sidebar impact)
      const skipRefreshActions = [
        'generate_diagrams_llm', 
        'clear_related_art_selections',
        'save_manual_prior_art',
        'related_art_llm_review' // Component handles state locally, refresh would lose in-progress data
      ]
      
      // Actions that skip immediate refresh but should trigger delayed background refresh
      // This updates the sidebar without interrupting the component's local state management
        const delayedRefreshActions = [
          'related_art_search', // Results need time to settle in component state
          'save_ai_analysis', // AI analysis saved, sidebar should show completion
          'related_art_select', // Selections saved, sidebar should show completion
          'generate_sections', // Section generated, sidebar should show completion
          'autosave_sections', // Section saved, sidebar should show completion
          'save_sections', // Explicit save, sidebar should show completion
          'run_ai_review' // Avoid aggressive refresh; keep UI smooth while review completes
        ]
      
      const suppressRefresh = stageData?.suppressRefresh === true
      const skipRefresh = suppressRefresh || skipRefreshActions.includes(action)
      const needsDelayedRefresh = !suppressRefresh && delayedRefreshActions.includes(action)

      if (!skipRefresh && !needsDelayedRefresh) {
        await refreshSessionData()
      } else if (needsDelayedRefresh) {
        // SUBTLE BACKGROUND REFRESH for sidebar completion tracking
        // - 2.5s delay: ensures local component state has fully settled
        // - Uses requestIdleCallback when available for minimal UI impact
        // - Fails silently - user never sees errors from this
        const doSubtleRefresh = () => {
          refreshSessionData().catch(() => {
            // Intentionally silent - this is a background optimization
          })
        }
        
        setTimeout(() => {
          if (typeof requestIdleCallback !== 'undefined') {
            // Run during browser idle time for zero UI impact
            requestIdleCallback(doSubtleRefresh, { timeout: 3000 })
          } else {
            doSubtleRefresh()
          }
        }, 2500)
      }

      // Clear any previous inline error after a successful action
      setInlineError(null)
      return result
    } catch (err) {
      console.error('Stage completion error:', err)
      // Don't throw - show inline error so the user stays on this page
      const errorMessage = err instanceof Error ? err.message : 'Error has occurred, please retry.'
      setInlineError(errorMessage)
      return null
    }
  }

  const getCurrentStage = useCallback(() => {
    if (!session) return 'IDEA_ENTRY'
    return normalizeStage(session.status)
  }, [session])

  const StageComponent = useMemo(() => {
    const stage = getCurrentStage()
    const Component = STAGE_COMPONENTS[stage as keyof typeof STAGE_COMPONENTS]
    return Component || IdeaEntryStage
  }, [getCurrentStage])

  const getPrevNextStages = () => {
    const stage = getCurrentStage() as keyof typeof STAGE_COMPONENTS
    const priorArtSkipped = !!(session as any)?.priorArtConfig?.skipped
    const claimRefinementSkipped = !!(session as any)?.priorArtConfig?.skippedClaimRefinement

    // Build dynamic order excluding skipped stages
    const order = STAGE_ORDER.filter(s => {
      if (priorArtSkipped && s === 'RELATED_ART') return false
      if (claimRefinementSkipped && s === 'CLAIM_REFINEMENT') return false
      return true
    })
    const idx = order.indexOf(stage)

    let prev = idx > 0 ? order[idx - 1] : null
    const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null

    // Special-case: when at COMPONENT_PLANNER, determine the correct previous stage
    if (stage === 'COMPONENT_PLANNER') {
      if (priorArtSkipped) {
        prev = 'IDEA_ENTRY'
      } else if (claimRefinementSkipped) {
        prev = 'RELATED_ART'
      } else {
        prev = 'CLAIM_REFINEMENT'
      }
    }

    return { prev, next, priorArtSkipped, claimRefinementSkipped }
  }

  const getVisibleStageOrder = useCallback(() => {
    const priorArtSkipped = !!(session as any)?.priorArtConfig?.skipped
    const claimRefinementSkipped = !!(session as any)?.priorArtConfig?.skippedClaimRefinement

    return STAGE_ORDER.filter(stage => {
      if (priorArtSkipped && stage === 'RELATED_ART') return false
      if (claimRefinementSkipped && stage === 'CLAIM_REFINEMENT') return false
      return true
    })
  }, [session])

  useEffect(() => {
    // Clear navigation notice whenever stage changes
    setNavNotice(null)
  }, [session?.status])

  const goToPrevStage = async () => {
    const { prev, priorArtSkipped, claimRefinementSkipped } = getPrevNextStages()
    if (!prev || !session) return

    if (getCurrentStage() === 'COMPONENT_PLANNER') {
      if (priorArtSkipped) {
        setNavNotice('Prior art was skipped earlier, so returning to Invention Structure.')
      } else if (claimRefinementSkipped) {
        setNavNotice('Claim refinement was skipped, so returning to Related Art stage.')
      } else {
        setNavNotice('Returning to Claim Refinement, which is the stage before components.')
      }
    } else {
      setNavNotice(null)
    }

    await handleStageComplete({ action: 'set_stage', sessionId: session.id, stage: prev })
  }

  const goToNextStage = async () => {
    const { next } = getPrevNextStages()
    if (!next || !session) return
    setNavNotice(null)
    await handleStageComplete({ action: 'set_stage', sessionId: session.id, stage: next })
  }

  /**
   * Rail items under "Review & Export" are actions on the current draft, not
   * pipeline stages: move to the drafting stage if needed, then tell the stage
   * which panel to open. The stage listens for this event so the generic
   * StageComponent prop contract stays unchanged.
   */
  const handleOpenDraftAction = async (actionKey: string) => {
    if (getCurrentStage() !== 'ANNEXURE_DRAFT') {
      await handleNavigateToStage('ANNEXURE_DRAFT')
    }
    // Let the stage mount/settle before it is asked to focus a panel.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('patentnest:draft-action', { detail: { action: actionKey } }))
    }, 60)
  }

  if (authLoading || isLoading) {
    return <PageLoadingBird message="Loading patent drafting..." />
  }

  if (fatalError || !patent) {
    return (
      <div className="min-h-screen bg-[#F5F6F7] flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error</h2>
          <p className="text-gray-600 mb-4">{fatalError || 'Patent not found'}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => { setFatalError(null); loadData(); }}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-lamp-600 hover:bg-lamp-700"
            >
              Retry
            </button>
            <Link
              href="/dashboard"
              className="inline-flex items-center px-4 py-2 border text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50"
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const currentStage = getCurrentStage()
  // StageComponent is now memoized above

  // Compact Back/Next shown under every stage. Routed through the same handler
  // as the rail so the unsaved-work guard applies to these controls too.
  const stageFooterNav = (() => {
    const { prev, next } = getPrevNextStages()
    const labelFor = (key: string | null) =>
      key ? (STAGE_DEFINITIONS.find(stage => stage.key === key)?.label || null) : null
    const order = getVisibleStageOrder()
    const position = order.indexOf(currentStage as any)
    return {
      prevLabel: labelFor(prev),
      nextLabel: labelFor(next),
      onBack: () => { if (prev) void handleNavigateToStage(prev) },
      onNext: () => { if (next) void handleNavigateToStage(next) },
      positionLabel: position >= 0 ? `Stage ${position + 1} of ${order.length}` : undefined,
    }
  })()

  // Handler for stage navigation from sidebar
  const handleNavigateToStage = async (stageKey: string) => {
    if (!session || stageNavigationInFlightRef.current) return

    const targetStage = normalizeStage(stageKey)
    const current = getCurrentStage()
    if (targetStage === current) return

    // Stages can flag unsaved work (e.g. the component planner) — confirm before discarding it.
    if ((window as any).__componentPlannerDirty) {
      const leave = window.confirm('You have unsaved component changes. Leave this stage and discard them?')
      if (!leave) return
    }

    const order = getVisibleStageOrder()

    // Walk through the visible path so a sidebar click behaves like repeated
    // arrow navigation instead of depending on direct transition pairs.
    const stagesToVisit = getStageNavigationPath(order, current as keyof typeof STAGE_COMPONENTS, targetStage)

    setNavNotice(null)
    stageNavigationInFlightRef.current = true
    try {
      for (const nextStage of stagesToVisit) {
        const result = await handleStageComplete({
          action: 'set_stage',
          sessionId: session.id,
          stage: nextStage
        })
        if (!result) break
      }
    } finally {
      stageNavigationInFlightRef.current = false
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F6F7]">
      {/* Vertical Stage Navigation Sidebar */}
      {session && (
        <VerticalStageNav
          session={session}
          currentStage={currentStage}
          patentId={patentId}
          onNavigateToStage={handleNavigateToStage}
          onOpenDraftAction={handleOpenDraftAction}
          onCollapsedChange={setSidebarCollapsed}
          mobileOpen={stageNavOpen}
          onMobileClose={() => setStageNavOpen(false)}
        />
      )}

      {/* Stage navigation lives in the rail and in each stage's own
          continue/back controls — no screen-edge floating arrows. */}

      {/* Main Content Area - Shifted right for the rail; below lg the rail is
          a drawer, so the content keeps the full width. */}
      <div className={`${session ? (sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-72') : ''} transition-all duration-300`}>
        {/* Quota Error Banner */}
        {quotaError && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
            <div className="max-w-[98%] mx-auto flex items-center justify-between">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-amber-800">
                    {quotaError.message}
                  </p>
                  {quotaError.quotaInfo && (
                    <p className="text-xs text-amber-700 mt-1">
                      {quotaError.quotaInfo.remainingMonthly !== null && quotaError.quotaInfo.remainingMonthly > 0 &&
                        `Monthly operations remaining: ${quotaError.quotaInfo.remainingMonthly}`
                      }
                    </p>
                  )}
                </div>
              </div>
              <div className="flex-shrink-0">
                <button
                  onClick={() => setQuotaError(null)}
                  className="text-amber-600 hover:text-amber-800 p-1 rounded-full hover:bg-amber-100 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Inline error banner for non-fatal stage errors */}
        {inlineError && (
          <div className="bg-rose-50 border-b border-rose-200 px-4 py-3">
            <div className="max-w-[98%] mx-auto flex items-center justify-between">
              <div className="flex items-start gap-2 text-rose-800 text-sm">
                <svg className="w-5 h-5 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="font-medium">Error has occurred, please retry.</p>
                  <p className="text-xs text-rose-700 mt-1">{inlineError}</p>
                </div>
              </div>
              <button
                onClick={() => setInlineError(null)}
                className="text-rose-600 hover:text-rose-800 p-1 rounded-full hover:bg-rose-100 transition-colors"
                aria-label="Dismiss error"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Header - Simplified (navigation moved to sidebar) */}
        <header className="bg-white/90 backdrop-blur-md border-b border-gray-200 sticky top-0 z-30">
          <div className="w-full max-w-[98%] mx-auto px-3 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-14 gap-2">
              <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                {/* Below lg the stage rail is a drawer — this is its handle. */}
                {session && (
                  <button
                    type="button"
                    onClick={() => setStageNavOpen(true)}
                    aria-label="Open stage navigation"
                    className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 lg:hidden"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                )}

                <Link
                  href={`/projects/${patent.project.id}`}
                  className="hidden sm:block text-gray-400 hover:text-gray-700 transition-colors duration-200 p-1 rounded-full hover:bg-gray-100"
                  title="Back to Project"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </Link>

                <div className="h-4 w-px bg-gray-200 mx-2 hidden sm:block"></div>

                <div className="flex flex-col justify-center min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <h1 className="text-sm font-semibold text-gray-900 truncate max-w-full sm:max-w-lg cursor-default" title={patent.title}>
                      {patent.title}
                    </h1>
                    {styleStatus && (
                      <Badge variant={styleStatus.enabled ? "default" : "secondary"} className="hidden sm:inline-flex text-[10px] h-4 px-1.5">
                        {styleStatus.enabled ? 'Style Active' : 'No Style'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 font-medium flex items-center gap-1 truncate">
                    <span className="uppercase tracking-wider truncate">{STAGE_LABELS[currentStage as keyof typeof STAGE_LABELS]}</span>
                    <span className="text-gray-300">•</span>
                    <span className="whitespace-nowrap">{STAGE_PROGRESS[currentStage as keyof typeof STAGE_PROGRESS]}%</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3 flex-shrink-0">
                {usage && (
                  <div className="hidden lg:flex flex-col items-end text-[10px] text-gray-400 mr-4">
                     <span>{usage.total_input_tokens.toLocaleString()} in / {usage.total_output_tokens.toLocaleString()} out</span>
                     <span className="opacity-70">Session Usage</span>
                  </div>
                )}

                {/* Filing forms live outside the drafting stages — the draft is the
                    specification, this is the paperwork that goes with it. */}
                <Link
                  href={`/patents/${patentId}/filing`}
                  className="inline-flex items-center px-2.5 sm:px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                  title="Generate Form 1, Form 5 and drawing sheets"
                >
                  <svg className="w-3 h-3 sm:mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="hidden sm:inline">Filing forms</span>
                </Link>

                <button
                  onClick={resumeSession}
                  className="inline-flex items-center px-2.5 sm:px-3 py-1.5 border border-lamp-600/20 text-xs font-medium rounded-md text-lamp-700 bg-lamp-50 hover:bg-lamp-100 transition-colors"
                  title="Resume the latest drafting session"
                >
                  <svg className="w-3 h-3 sm:mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="hidden sm:inline">Resume</span>
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content - Maximized Writing Space */}
        <main className="w-full mx-auto py-3 px-2 sm:py-6 sm:px-6 lg:px-8">
          {navNotice && (
            <div className="max-w-[98%] mx-auto mb-3">
              <div className="flex items-start gap-2 rounded-md border border-lamp-100 bg-lamp-50 px-3 py-2 text-xs text-lamp-800">
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-9a1 1 0 01.894.553l2.5 5A1 1 0 0112.5 16h-5a1 1 0 01-.894-1.447l2.5-5A1 1 0 0110 9zm0-4a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
                </svg>
                <div className="flex-1 leading-relaxed">{navNotice}</div>
                <button
                  onClick={() => setNavNotice(null)}
                  className="text-lamp-600 hover:text-lamp-800 transition-colors"
                  aria-label="Dismiss notice"
                >
                  ×
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200/60 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] min-h-[calc(100vh-140px)]">
            {session ? (
              <div className="h-full">
                <StageComponent
                  session={session}
                  patent={patent}
                  onComplete={handleStageComplete}
                  onRefresh={refreshSessionData}
                />
                <StageFooterNav
                  prevLabel={stageFooterNav.prevLabel}
                  nextLabel={stageFooterNav.nextLabel}
                  onBack={stageFooterNav.onBack}
                  onNext={stageFooterNav.onNext}
                  positionLabel={stageFooterNav.positionLabel}
                />
              </div>
            ) : (
              <div className="p-12 text-center flex flex-col items-center justify-center h-64">
                <div className="animate-pulse flex space-x-2 mb-4">
                   <div className="h-2 w-2 bg-lamp-400 rounded-full"></div>
                   <div className="h-2 w-2 bg-lamp-400 rounded-full animation-delay-200"></div>
                   <div className="h-2 w-2 bg-lamp-400 rounded-full animation-delay-400"></div>
                </div>
                <div className="text-sm font-medium text-gray-500">Loading drafting workspace...</div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
