'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, CheckCircle2, Sparkles, Unlock, Pencil, Save, X, Plus, Trash2, Wand2, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react'

interface ClaimRefinementStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

type ClaimRow = { number: number; text: string }

const stripTags = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

const parseClaims = (html: string, structured?: any[]): ClaimRow[] => {
  if (Array.isArray(structured) && structured.length > 0) {
    return structured.map((c: any) => ({ number: Number(c.number) || 0, text: c.text || '' }))
  }
  if (!html) return []
  const blocks = html.split(/<\/p>/i)
  const rows: ClaimRow[] = []
  blocks.forEach((b) => {
    const plain = stripTags(b)
    if (!plain) return
    const match = plain.match(/^(\d+)\.\s*(.+)$/)
    if (match) {
      rows.push({ number: Number(match[1]), text: match[2] })
    }
  })
  return rows
}

type DiffPart = { type: 'same' | 'add' | 'del'; text: string }

const diffWords = (oldText: string, newText: string): DiffPart[] => {
  const a = (oldText || '').split(/\s+/)
  const b = (newText || '').split(/\s+/)
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const parts: DiffPart[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      parts.push({ type: 'same', text: a[i] })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      parts.push({ type: 'del', text: a[i] })
      i++
    } else {
      parts.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < m) { parts.push({ type: 'del', text: a[i++] }) }
  while (j < n) { parts.push({ type: 'add', text: b[j++] }) }
  return parts
}

const renderDiff = (oldText: string, newText: string) => {
  if (!newText || oldText === newText) return <span className="text-ai-graphite-700">{oldText || newText}</span>
  const parts = diffWords(oldText, newText)
  return (
    <span className="text-[13.5px] leading-relaxed text-ai-graphite-700">
      {parts.map((p, idx) => {
        if (p.type === 'same') return <span key={idx}>{p.text} </span>
        if (p.type === 'add') return <span key={idx} className="rounded bg-emerald-50 px-0.5 font-medium text-emerald-800">{p.text} </span>
        return <span key={idx} className="rounded bg-wax-50 px-0.5 text-wax-600 line-through">{p.text} </span>
      })}
    </span>
  )
}

/** Label + control pair used across the dense settings strip. */
const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ai-graphite-400">{children}</span>
)

export default function ClaimRefinementStage({ session, onComplete, onRefresh }: ClaimRefinementStageProps) {
  // Debug: Log session data to diagnose data flow issues
  console.log('🔍 ClaimRefinementStage - Session received:', {
    sessionId: session?.id,
    hasPriorArtConfig: !!session?.priorArtConfig,
    priorArtConfig: session?.priorArtConfig,
    claimRefinementConfig: (session?.priorArtConfig as any)?.claimRefinementConfig,
    selectedPatentsCount: (session?.priorArtConfig as any)?.claimRefinementConfig?.selectedPatents?.length || 0
  })

  const normalized = (session?.ideaRecord?.normalizedData as any) || {}
  const structured = normalized.claimsStructured || normalized.claimsStructuredProvisional || normalized.claimsStructuredFinal || []
  const currentClaimsHtml = normalized.claims || normalized.claimsFinal || normalized.claimsProvisional || ''
  const provisionalClaimsHtml = normalized.claimsProvisional || currentClaimsHtml
  const claimRefConfig = (session?.priorArtConfig as any)?.claimRefinementConfig || {}
  const claimRefManualText = typeof claimRefConfig?.manualText === 'string' ? claimRefConfig.manualText : ''
  const claimRefSelectedPatentsFromConfig: any[] = Array.isArray(claimRefConfig?.selectedPatents) ? claimRefConfig.selectedPatents : []
  
  // Debug: Log extracted config values
  console.log('🔍 ClaimRefinementStage - Config extracted:', {
    claimRefConfig,
    claimRefManualText,
    claimRefSelectedPatentsFromConfig
  })

  const baseClaims = useMemo(() => parseClaims(provisionalClaimsHtml, structured), [provisionalClaimsHtml, structured])
  const [preview, setPreview] = useState<any>(normalized.claimsRefinementPreview || null)
  const normalizePatentId = (p: any) => {
    const pn = p?.patentNumber || p?.pn || p?.publication_number || p?.publicationNumber || p?.id
    return typeof pn === 'string' ? pn.trim() : ''
  }
  const resolveThreat = (tags?: string[], novelty?: string) => {
    const tagThreat = (tags || []).find((t) => ['AI_ANTICIPATES', 'AI_OBVIOUS', 'AI_ADJACENT', 'AI_REMOTE'].includes(t))
    if (novelty) return novelty
    if (tagThreat === 'AI_ANTICIPATES') return 'anticipates'
    if (tagThreat === 'AI_OBVIOUS') return 'obvious'
    if (tagThreat === 'AI_ADJACENT') return 'adjacent'
    if (tagThreat === 'AI_REMOTE') return 'remote'
    return 'unknown'
  }
  // Patents for claim refinement should ONLY come from the claim refinement config
  // DO NOT fall back to relatedArtSelections as those are for prior art drafting, not claim refinement
  const optionsFromConfig = useMemo(() => claimRefSelectedPatentsFromConfig
    .map((p: any) => {
      const id = normalizePatentId(p)
      if (!id) return null
      return {
        id,
        title: p.title || 'Untitled',
        threat: resolveThreat(p.tags, (p as any).noveltyThreat),
        source: 'config' as const
      }
    })
    .filter(Boolean) as Array<{ id: string; title: string; threat: string; source: 'config' }>, [claimRefSelectedPatentsFromConfig])

  const configIdsKey = optionsFromConfig.map((p) => p.id).join('|')
  // Only use patents explicitly selected for claim refinement - no fallback to prior art selections
  const priorArtOptions = optionsFromConfig
  const initialMode = claimRefConfig.mode || 'ai'
  const [useAuto, setUseAuto] = useState(initialMode !== 'manual')
  const [useManual, setUseManual] = useState(initialMode === 'manual' || initialMode === 'hybrid' || !!claimRefManualText || !!session?.manualPriorArt)
  const [selectedPatents, setSelectedPatents] = useState<string[]>(priorArtOptions.map((p) => p.id))
  const [acceptMap, setAcceptMap] = useState<Record<number, boolean>>({})
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [applying, setApplying] = useState(false)
  const [freezing, setFreezing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdditionalInstructions, setShowAdditionalInstructions] = useState(false)
  const [additionalInstructions, setAdditionalInstructions] = useState('')
  const [showPatentReferences, setShowPatentReferences] = useState(true)
  
  // Manual editing states
  const [isEditMode, setIsEditMode] = useState(false)
  const [editableClaims, setEditableClaims] = useState<ClaimRow[]>([])
  const [savingClaims, setSavingClaims] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [unfreezing, setUnfreezing] = useState(false)
  
  // Check if claims are frozen
  const isFrozen = !!normalized.claimsApprovedAt

  useEffect(() => {
    const mode = claimRefConfig.mode || 'ai'
    // Only use patents from claim refinement config - not fallback to prior art
    const nextSelected = optionsFromConfig.map((p) => p.id)
    setUseAuto(mode !== 'manual')
    setUseManual(mode === 'manual' || mode === 'hybrid' || !!claimRefManualText || !!session?.manualPriorArt)
    setSelectedPatents(nextSelected)
  }, [claimRefConfig.mode, claimRefManualText, session?.manualPriorArt, configIdsKey, optionsFromConfig])

  useEffect(() => {
    if (preview?.refinedClaims) {
      const defaults: Record<number, boolean> = {}
      preview.refinedClaims.forEach((c: any) => {
        if (c.refined_text) defaults[Number(c.number)] = true
      })
      setAcceptMap(defaults)
    }
  }, [preview])

  // Initialize editable claims when entering edit mode or when baseClaims change
  useEffect(() => {
    if (isEditMode && editableClaims.length === 0) {
      setEditableClaims([...baseClaims])
    }
  }, [isEditMode, baseClaims, editableClaims.length])

  // Track unsaved changes
  useEffect(() => {
    if (isEditMode && editableClaims.length > 0) {
      const hasChanges = editableClaims.some((ec, idx) => {
        const original = baseClaims[idx]
        return !original || ec.text !== original.text || ec.number !== original.number
      }) || editableClaims.length !== baseClaims.length
      setHasUnsavedChanges(hasChanges)
    }
  }, [editableClaims, baseClaims, isEditMode])

  // Automatically unfreeze claims when entering claim refinement stage
  // BUT skip auto-unfreeze if the user just manually froze claims in this session
  const hasAutoUnfrozenRef = useRef(false)
  const userJustFrozeRef = useRef(false)
  const initialFrozenStateRef = useRef<boolean | null>(null)

  // Leaving the stage used to silently re-freeze the claims, purely so downstream
  // drafting would accept them. Drafting now reads the saved claim set directly, so that
  // auto-lock only served to make the claims read-only behind the user's back. Nothing
  // needs to happen on unmount — the claims are already saved.


  // Capture the initial frozen state on first render
  useEffect(() => {
    if (initialFrozenStateRef.current === null) {
      initialFrozenStateRef.current = isFrozen
    }
  }, [isFrozen])
  
  useEffect(() => {
    const autoUnfreezeClaims = async () => {
      // CRITICAL: Skip auto-unfreeze if user manually froze claims in this component session
      if (userJustFrozeRef.current) {
        console.log('[ClaimRefinementStage] Skipping auto-unfreeze: user manually froze claims')
        return
      }
      
      // Only auto-unfreeze once, only if claims were already frozen when component FIRST mounted,
      // and only if the user hasn't manually frozen claims
      const wasInitiallyFrozen = initialFrozenStateRef.current === true
      if (!hasAutoUnfrozenRef.current && isFrozen && wasInitiallyFrozen && session?.id && normalized) {
        hasAutoUnfrozenRef.current = true
        console.log('[ClaimRefinementStage] Auto-unfreezing claims for editing')
        try {
          await onComplete({
            action: 'unfreeze_claims',
            sessionId: session.id
          })
          await onRefresh()
          // Don't show success message for automatic unfreeze to avoid confusion
        } catch (e) {
          console.error('Auto-unfreeze failed:', e)
          hasAutoUnfrozenRef.current = false // Reset on failure so user can try manually
        }
      }
    }

    autoUnfreezeClaims()
  }, [isFrozen, session?.id, normalized, onComplete, onRefresh])

  // Enter edit mode
  const handleStartEditing = () => {
    setEditableClaims([...baseClaims])
    setIsEditMode(true)
    setSuccessMessage(null)
  }

  // Cancel editing
  const handleCancelEditing = () => {
    setEditableClaims([])
    setIsEditMode(false)
    setHasUnsavedChanges(false)
  }

  // Update a claim's text
  const handleClaimTextChange = (index: number, newText: string) => {
    setEditableClaims(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], text: newText }
      return updated
    })
  }

  // Add a new claim
  const handleAddClaim = () => {
    const maxNumber = editableClaims.reduce((max, c) => Math.max(max, c.number), 0)
    setEditableClaims(prev => [...prev, { number: maxNumber + 1, text: '' }])
  }

  // Remove a claim
  const handleRemoveClaim = (index: number) => {
    setEditableClaims(prev => {
      const updated = prev.filter((_, i) => i !== index)
      // Renumber claims
      return updated.map((c, idx) => ({ ...c, number: idx + 1 }))
    })
  }

  // Save edited claims
  const handleSaveClaims = async () => {
    if (!session?.id) return
    try {
      setSavingClaims(true)
      setError(null)
      
      // Convert editable claims back to HTML and structured format
      const claimsHtml = editableClaims.map(c => `<p>${c.number}. ${c.text}</p>`).join('\n')
      const claimsStructured = editableClaims.map(c => ({
        number: c.number,
        text: c.text,
        type: c.number === 1 ? 'independent' : 'dependent',
        category: c.number === 1 ? 'independent' : 'dependent'
      }))

      await onComplete({
        action: 'save_claims',
        sessionId: session.id,
        claims: claimsHtml,
        claimsStructured
      })
      
      await onRefresh()
      setIsEditMode(false)
      setHasUnsavedChanges(false)
      setSuccessMessage('Claims saved successfully!')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (e) {
      console.error('Save claims failed', e)
      setError('Failed to save claims.')
    } finally {
      setSavingClaims(false)
    }
  }

  // Ensure claims are editable before generating or applying refinements.
  // Previously the stage relied solely on a mount-time auto-unfreeze effect,
  // which could silently fail or race with the re-freeze-on-leave cleanup and
  // leave Generate/Apply permanently disabled behind `isFrozen` (user sees a
  // generated refinement but cannot apply it). Unfreezing inline here makes both
  // actions self-sufficient regardless of the frozen flag.
  const ensureClaimsUnfrozen = async () => {
    if (!session?.id || !isFrozen) return
    await onComplete({ action: 'unfreeze_claims', sessionId: session.id })
    await onRefresh()
  }

  const handlePreview = async () => {
    if (!session?.id) return
    try {
      setLoadingPreview(true)
      setError(null)
      await ensureClaimsUnfrozen()
      const formatPersonaCoverageWarning = (warnings: any[]) => {
        const jurisdiction = (session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'US').toUpperCase()
        const lines = (Array.isArray(warnings) ? warnings : [])
          .map((warning: any) => {
            const fallback = warning?.fallback === 'personal_sample'
              ? 'personal non-persona sample will be used'
              : 'no style block will be used'
            return `- ${warning?.sectionKey || 'claims'} (${warning?.jurisdiction || jurisdiction}): ${fallback}`
          })
          .join('\n')

        return `The selected persona is missing writing samples for claim refinement.\n\n${lines || '- Claims have no persona sample.'}\n\nContinue without persona style for the missing sample?`
      }

      const payload = {
        action: 'claim_refinement_preview',
        sessionId: session.id,
        useAuto,
        useManual,
        selectedPatents,
        additionalInstructions: showAdditionalInstructions ? additionalInstructions : ''
      }

      let resp = await onComplete(payload)
      if (resp?.code === 'PERSONA_COVERAGE_WARNING') {
        const confirmed = window.confirm(formatPersonaCoverageWarning(resp.personaWarnings || []))
        if (!confirmed) return
        resp = await onComplete({ ...payload, acceptPersonaWarnings: true })
      }
      if (resp?.error) throw new Error(resp.error)
      if (resp?.preview) {
        setPreview(resp.preview)
      }
    } catch (e) {
      console.error('Preview failed', e)
      setError(e instanceof Error ? e.message : 'Failed to generate refinement preview.')
    } finally {
      setLoadingPreview(false)
    }
  }

  /**
   * Record this claim set as the one drafting will use, then advance.
   * `lock: false` — the claims stay editable. Downstream stages read the saved set
   * regardless, so there is no reason to make the user unlock to fix a typo later.
   */
  const finalizeClaimsAndProceed = async (claimsOverride?: string, structuredOverride?: any[]) => {
    if (!session?.id) return
    try {
      setFreezing(true)
      setError(null)

      userJustFrozeRef.current = true

      await onComplete({
        action: 'freeze_claims',
        lock: false,
        sessionId: session.id,
        claims: claimsOverride || normalized.claims || normalized.claimsFinal || normalized.claimsProvisional || currentClaimsHtml,
        claimsStructured: structuredOverride || (structured && structured.length ? structured : undefined),
        jurisdiction: (session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()
      })
      await onComplete({
        action: 'set_stage',
        sessionId: session.id,
        stage: 'COMPONENT_PLANNER'
      })
      await onRefresh()
      setSuccessMessage('Claims finalized and ready for the next stage.')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (e) {
      console.error('Finalize failed', e)
      setError('Failed to finalize claims.')
      userJustFrozeRef.current = false
      throw e
    } finally {
      setFreezing(false)
    }
  }

  const handleApply = async () => {
    if (!session?.id) return
    try {
      setApplying(true)
      setError(null)
      setSuccessMessage(null)
      await ensureClaimsUnfrozen()
      const accepted = Object.entries(acceptMap).filter(([, v]) => v).map(([k]) => Number(k))

      const applyResponse = await onComplete({
        action: 'claim_refinement_apply',
        sessionId: session.id,
        acceptedClaimNumbers: accepted,
        acceptAll: false
      })
      if (applyResponse?.error) throw new Error(applyResponse.error)

      const claimCount = accepted.length
      const refinedClaims = preview?.refinedClaims || []
      const modifiedCount = accepted.filter(claimNum =>
        refinedClaims.find((r: any) => Number(r.number) === claimNum)?.refined_text
      ).length

      await finalizeClaimsAndProceed(applyResponse?.claimsHtml, applyResponse?.claims)

      const message = claimCount === 0
        ? 'No selected refinements were applied. Your claims carry forward unchanged and the workflow has advanced.'
        : `Applied ${claimCount} claim refinement${claimCount !== 1 ? 's' : ''}${modifiedCount > 0 ? ` (${modifiedCount} claim${modifiedCount !== 1 ? 's' : ''} modified)` : ''}. Ready for the next stage.`
      setSuccessMessage(message)
      setTimeout(() => setSuccessMessage(null), 8000)
    } catch (e) {
      console.error('Apply failed', e)
      setError(e instanceof Error ? e.message : 'Failed to apply refinements.')
    } finally {
      setApplying(false)
    }
  }

  const handleFinalize = async () => {
    if (!session?.id) return

    // Warn if there are unsaved changes
    if (isEditMode && hasUnsavedChanges) {
      const confirmProceed = window.confirm('You have unsaved changes. Do you want to save them before continuing?')
      if (confirmProceed) {
        await handleSaveClaims()
        // Wait for refresh to complete
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    await finalizeClaimsAndProceed()
  }

  const handleUnfreeze = async () => {
    if (!session?.id) return
    try {
      setUnfreezing(true)
      setError(null)
      
      // Reset the manual freeze flag when user explicitly unfreezes
      userJustFrozeRef.current = false
      
      await onComplete({
        action: 'unfreeze_claims',
        sessionId: session.id
      })
      await onRefresh()
      setSuccessMessage('Claims unfrozen. You can now edit them.')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (e) {
      console.error('Unfreeze failed', e)
      setError('Failed to unfreeze claims.')
    } finally {
      setUnfreezing(false)
    }
  }

  // One row per claim, carrying its AI suggestion inline. Previously the original claims
  // and the AI suggestions lived in two separate cards showing the same claim set twice,
  // so comparing meant scrolling between panels. Merging them is the whole point of the
  // layout below: read a claim, see what changed, accept it — without moving.
  const claimRows = useMemo(() => {
    const refinedClaims: any[] = preview?.refinedClaims || []
    return baseClaims.map((claim) => {
      const refined = refinedClaims.find((r: any) => Number(r.number) === Number(claim.number))
      const refinedText = refined?.refined_text || ''
      return {
        number: claim.number,
        originalText: refined?.original_text || claim.text,
        refinedText,
        changed: Boolean(refinedText),
        changeReason: refined?.change_reason || '',
      }
    })
  }, [baseClaims, preview])

  const changedCount = claimRows.filter(row => row.changed).length
  const acceptedCount = claimRows.filter(row => row.changed && (acceptMap[row.number] ?? true)).length
  const canRefine = !loadingPreview && (useAuto ? selectedPatents.length > 0 : useManual)

  const setAllAccepted = (accepted: boolean) => {
    setAcceptMap(claimRows.reduce((map, row) => {
      if (row.changed) map[row.number] = accepted
      return map
    }, {} as Record<number, boolean>))
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-5 sm:px-6 sm:py-6">
      {/* ---- Header: one row ---- */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ai-blue-50 ring-1 ring-inset ring-ai-blue-100">
            <Wand2 className="h-[18px] w-[18px] text-ai-blue-700" />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ai-graphite-900">
              Claim Refinement
            </h1>
            <p className="text-[13px] leading-tight text-ai-graphite-500">
              Compare your claims against the selected prior art and accept what improves them.
            </p>
          </div>
        </div>
        {isFrozen && (
          <button
            onClick={handleUnfreeze}
            disabled={unfreezing}
            className="inline-flex items-center gap-1.5 rounded-md border border-paper-300 bg-white px-2 py-1 text-[11px] font-medium text-ai-graphite-700 transition-colors hover:border-ai-blue-300 hover:text-ai-blue-700"
          >
            <Unlock className="h-3 w-3" />
            {unfreezing ? 'Unlocking…' : 'Locked — unlock to edit'}
          </button>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {successMessage && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      <div className="rounded-xl border border-paper-300 bg-white">
        {/* ---- Settings strip: what the refinement reads from ---- */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-t-xl border-b border-paper-200 bg-paper-50 px-3 py-2">
          <FieldLabel>Compare against</FieldLabel>

          <div className="flex items-center rounded-md border border-paper-300 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setUseAuto(!useAuto)}
              aria-pressed={useAuto}
              title="Use the patents selected in the Prior Art stage"
              className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                useAuto ? 'bg-ai-blue-600 text-white' : 'text-ai-graphite-600 hover:bg-paper-100'
              }`}
            >
              {priorArtOptions.length} patent{priorArtOptions.length === 1 ? '' : 's'}
            </button>
            <span className="h-4 w-px bg-paper-300" />
            <button
              type="button"
              onClick={() => setUseManual(!useManual)}
              aria-pressed={useManual}
              title="Include your manual prior-art notes"
              className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                useManual ? 'bg-ai-blue-600 text-white' : 'text-ai-graphite-600 hover:bg-paper-100'
              }`}
            >
              Manual notes
            </button>
          </div>

          {priorArtOptions.length > 0 && useAuto && (
            <button
              type="button"
              onClick={() => setShowPatentReferences(!showPatentReferences)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-ai-graphite-500 transition-colors hover:text-ai-blue-700"
            >
              {selectedPatents.length} of {priorArtOptions.length} selected
              {showPatentReferences ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowAdditionalInstructions(!showAdditionalInstructions)}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
              additionalInstructions.trim()
                ? 'border-ai-blue-200 bg-ai-blue-50 text-ai-blue-700'
                : 'border-paper-300 bg-white text-ai-graphite-600 hover:border-ai-blue-300'
            }`}
          >
            <Pencil className="h-3 w-3" />
            Instructions
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              onClick={handlePreview}
              disabled={!canRefine}
              className="h-7 bg-ai-blue-600 px-2.5 text-[11px] text-white hover:bg-ai-blue-700"
            >
              {loadingPreview
                ? <><span className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />Analyzing…</>
                : <><Sparkles className="mr-1.5 h-3 w-3" />{preview ? 'Re-run analysis' : 'Analyze claims'}</>}
            </Button>
          </div>
        </div>

        {/* Expandable patent picker */}
        {showPatentReferences && useAuto && priorArtOptions.length > 0 && (
          <div className="max-h-44 overflow-y-auto border-b border-paper-200 bg-white px-3 py-2">
            <div className="grid gap-1 sm:grid-cols-2">
              {claimRefSelectedPatentsFromConfig.map((patent: any) => {
                const patentId = patent?.patentNumber || patent?.pn || patent?.id || ''
                const threat = patent?.noveltyThreat || resolveThreat(patent?.tags, patent?.noveltyThreat)
                return (
                  <label
                    key={patentId}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-paper-100"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPatents.includes(patentId)}
                      onChange={(e) => {
                        setSelectedPatents((prev) => (
                          e.target.checked ? [...prev, patentId] : prev.filter((x) => x !== patentId)
                        ))
                      }}
                      className="h-3.5 w-3.5 rounded border-paper-400 text-ai-blue-600 focus:ring-ai-blue-500"
                    />
                    <span className="flex-1 truncate font-mono text-[11px] text-ai-graphite-700">{patentId}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
                      threat === 'anticipates' ? 'bg-wax-50 text-wax-600' :
                      threat === 'obvious' ? 'bg-amber-50 text-amber-700' :
                      'bg-paper-200 text-ai-graphite-600'
                    }`}>
                      {threat}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        )}

        {showAdditionalInstructions && (
          <div className="border-b border-paper-200 bg-white px-3 py-2">
            <textarea
              className="w-full resize-none rounded-md border border-paper-300 px-2.5 py-2 text-[12px] text-ai-graphite-800 placeholder:text-ai-graphite-400 focus:border-ai-blue-500 focus:outline-none focus:ring-1 focus:ring-ai-blue-500"
              rows={2}
              placeholder="E.g. focus on mechanical aspects, keep claim 1 broad, avoid software limitations…"
              value={additionalInstructions}
              onChange={(e) => setAdditionalInstructions(e.target.value)}
            />
          </div>
        )}

        {priorArtOptions.length === 0 && (
          <div className="flex items-start gap-2 border-b border-paper-200 bg-amber-50/60 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
            <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
            <span>No patents selected. Pick references in the Prior Art stage, or switch on Manual notes to refine against your own guidance.</span>
          </div>
        )}

        {/* ---- Claim list toolbar ---- */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-paper-200 px-3 py-2">
          <span className="text-[12px] font-medium text-ai-graphite-900">
            {isEditMode ? 'Editing claims' : 'Claims'}
            <span className="ml-1.5 font-normal text-ai-graphite-400">
              {isEditMode ? editableClaims.length : claimRows.length}
            </span>
          </span>

          {preview && !isEditMode && (
            <span className="text-[11px] text-ai-graphite-500">
              {changedCount === 0
                ? 'No changes suggested'
                : <>{changedCount} suggested · <span className="font-medium text-ai-blue-700">{acceptedCount} accepted</span></>}
            </span>
          )}

          {preview && changedCount > 0 && !isEditMode && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setAllAccepted(true)}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-ai-graphite-500 transition-colors hover:bg-paper-100 hover:text-ai-blue-700"
              >
                Accept all
              </button>
              <button
                onClick={() => setAllAccepted(false)}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-ai-graphite-500 transition-colors hover:bg-paper-100 hover:text-ai-graphite-900"
              >
                Reject all
              </button>
            </div>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {!isEditMode ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStartEditing}
                disabled={isFrozen}
                className="h-7 border-paper-300 px-2 text-[11px] font-medium text-ai-graphite-700 hover:border-ai-blue-300 hover:text-ai-blue-700"
              >
                <Pencil className="mr-1 h-3 w-3" />
                Edit
              </Button>
            ) : (
              <>
                {hasUnsavedChanges && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-ai-blue-700">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ai-blue-500" />
                    Unsaved
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelEditing}
                  className="h-7 border-paper-300 px-2 text-[11px] font-medium text-ai-graphite-600"
                >
                  <X className="mr-1 h-3 w-3" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveClaims}
                  disabled={savingClaims || !hasUnsavedChanges}
                  className="h-7 bg-ai-blue-600 px-2.5 text-[11px] text-white hover:bg-ai-blue-700"
                >
                  <Save className="mr-1 h-3 w-3" />
                  {savingClaims ? 'Saving…' : 'Save'}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* ---- Unified claim list ---- */}
        <div className="divide-y divide-paper-200">
          {isEditMode ? (
            <div className="space-y-2 p-3">
              {editableClaims.map((c, index) => (
                <div key={index} className="group relative flex gap-2.5 rounded-lg border border-paper-300 p-2.5 transition-colors focus-within:border-ai-blue-400">
                  <span className="mt-0.5 w-5 flex-shrink-0 text-right text-[12px] font-semibold tabular-nums text-ai-graphite-500">
                    {c.number}.
                  </span>
                  <textarea
                    value={c.text}
                    onChange={(e) => handleClaimTextChange(index, e.target.value)}
                    className="min-h-[52px] flex-1 resize-none border-0 bg-transparent p-0 text-[13.5px] leading-relaxed text-ai-graphite-800 focus:outline-none focus:ring-0"
                    placeholder="Enter claim text…"
                  />
                  <button
                    onClick={() => handleRemoveClaim(index)}
                    aria-label={`Remove claim ${c.number}`}
                    className="h-fit rounded p-1 text-ai-graphite-300 opacity-0 transition-all hover:text-wax-500 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                onClick={handleAddClaim}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-paper-400 py-2 text-[12px] text-ai-graphite-400 transition-colors hover:border-ai-blue-300 hover:text-ai-blue-600"
              >
                <Plus className="h-3.5 w-3.5" />
                Add claim
              </button>
            </div>
          ) : claimRows.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-[13px] text-ai-graphite-500">No claims found for this session.</p>
            </div>
          ) : (
            claimRows.map((row) => {
              const accepted = acceptMap[row.number] ?? true
              const showRefined = row.changed && accepted
              return (
                <div
                  key={row.number}
                  className={`flex gap-3 px-4 py-3 transition-colors ${row.changed ? 'bg-ai-blue-50/30' : ''}`}
                >
                  <span className="mt-0.5 w-5 flex-shrink-0 text-right text-[12px] font-semibold tabular-nums text-ai-graphite-500">
                    {row.number}.
                  </span>

                  <div className="min-w-0 flex-1">
                    {row.changed ? (
                      <>
                        {showRefined
                          ? renderDiff(row.originalText, row.refinedText)
                          : <span className="text-[13.5px] leading-relaxed text-ai-graphite-700">{row.originalText}</span>}
                        {row.changeReason && (
                          <p className="mt-1.5 text-[11px] leading-relaxed text-ai-graphite-500">
                            {row.changeReason}
                          </p>
                        )}
                      </>
                    ) : (
                      <span className="text-[13.5px] leading-relaxed text-ai-graphite-700">{row.originalText}</span>
                    )}
                  </div>

                  {row.changed && (
                    <div className="flex-shrink-0">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={accepted}
                        onClick={() => setAcceptMap((prev) => ({ ...prev, [row.number]: !accepted }))}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                          accepted
                            ? 'border-ai-blue-200 bg-ai-blue-50 text-ai-blue-700'
                            : 'border-paper-300 bg-white text-ai-graphite-500 hover:border-ai-blue-300'
                        }`}
                      >
                        {accepted ? <CheckCircle2 className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        {accepted ? 'Accepted' : 'Rejected'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* ---- Footer: the one action that moves you forward ---- */}
        {!isEditMode && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-paper-200 bg-paper-50 px-3 py-2.5">
            <p className="text-[11px] text-ai-graphite-500">
              {!preview
                ? 'Analyze your claims to see suggested refinements, or continue with them as they are.'
                : acceptedCount > 0
                  ? `${acceptedCount} refinement${acceptedCount === 1 ? '' : 's'} will be written into your claims.`
                  : 'Your claims will carry forward unchanged.'}
            </p>
            <Button
              size="sm"
              onClick={preview ? handleApply : handleFinalize}
              disabled={applying || freezing || savingClaims}
              className="h-8 bg-ai-blue-600 px-3 text-[12px] text-white hover:bg-ai-blue-700"
            >
              {(applying || freezing)
                ? <><span className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />Saving…</>
                : <>{preview && acceptedCount > 0 ? 'Apply & continue' : 'Continue'}<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></>}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
