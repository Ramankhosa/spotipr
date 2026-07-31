'use client'

import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { getAuthoritativeClaims } from '@/lib/claims-context'
// Pure data module (zero imports) — safe in a client component. Do NOT import
// from patent-search/index or the providers here: those reach prisma and the
// corpus service, which drags the server graph into the browser bundle.
import { PATENT_COUNTRIES } from '@/lib/patent-search/patent-countries'

interface RelatedArtStageProps {
  session: {
    id: string
    relatedArtRuns?: Array<{
      id: string
      resultsJson: any[]
      ranAt: string
    }>
    relatedArtSelections?: Array<{
      patentNumber: string
      title?: string
      snippet?: string
      score?: number
      tags?: string[]
      publicationDate?: string
      cpcCodes?: string[]
      ipcCodes?: string[]
      inventors?: string[]
      assignees?: string[]
      runId?: string
      userNotes?: string
    }>
    ideaRecord?: any
    manualPriorArt?: {
      manualPriorArtText: string
      useOnlyManualPriorArt: boolean
      useManualAndAISearch: boolean
    }
    aiAnalysisData?: Record<string, any>
    noveltyHandoff?: {
      searchId?: string
      citationCount?: number
      shortlistedCount?: number
      findingsDigest?: string
      risk?: { headline?: string; noveltyRisk?: string; assessmentConfidence?: string }
      importedAt?: string
    } | null
  }
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

type ResultItem = {
  title: string
  pn: string
  snippet?: string
  abstract?: string
  publication_date?: string
  score?: number
  inventors?: string[] | string
  assignees?: string[] | string
}

type AIAnalysisEntry = {
  aiSummary?: string
  noveltyThreat?: string
  relevantParts?: string[]
  irrelevantParts?: string[]
  noveltyComparison?: string
  analysisStatus?: 'analyzed' | 'unknown'
  evidenceBasis?: 'title_abstract'
  failureReason?: string
}

type AnalysisProgressState = {
  processed: number
  total: number
  currentBatch: number
  totalBatches: number
  message: string
}

/** One decision per patent: where it will be used downstream. */
type PatentTags = { background: boolean; claims: boolean }

/** A manually entered reference. Lives in the same list as search results. */
type ManualRef = { id: string; text: string; background: boolean; claims: boolean }

type Phase = 'idle' | 'searching' | 'assessing'

type ThreatLevel = 'anticipates' | 'obvious' | 'adjacent' | 'remote' | 'unknown'

// `label` is the wording on the summary/filter cards; `badgeLabel` is the short,
// uniform wording on each list row so the fixed-width badge column stays tidy.
const THREAT_META: Record<ThreatLevel, { label: string; badgeLabel: string; sub: string; badge: string; card: string; cardActive: string; number: string }> = {
  anticipates: {
    label: 'High risk',
    badgeLabel: 'High',
    sub: 'May anticipate',
    badge: 'bg-red-50 text-red-700 border border-red-200',
    card: 'border-paper-300 hover:border-red-300',
    cardActive: 'bg-red-50 border-red-300 ring-1 ring-red-200',
    number: 'text-red-600'
  },
  obvious: {
    label: 'Obviousness risk',
    badgeLabel: 'Obvious',
    sub: 'May be combinable',
    badge: 'bg-amber-50 text-amber-700 border border-amber-200',
    card: 'border-paper-300 hover:border-amber-300',
    cardActive: 'bg-amber-50 border-amber-300 ring-1 ring-amber-200',
    number: 'text-amber-600'
  },
  adjacent: {
    label: 'Adjacent',
    badgeLabel: 'Adjacent',
    sub: 'Citable context',
    badge: 'bg-green-50 text-green-700 border border-green-200',
    card: 'border-paper-300 hover:border-green-300',
    cardActive: 'bg-green-50 border-green-300 ring-1 ring-green-200',
    number: 'text-green-600'
  },
  remote: {
    label: 'Remote',
    badgeLabel: 'Remote',
    sub: 'Loosely related',
    badge: 'bg-paper-100 text-ai-graphite-600 border border-paper-300',
    card: 'border-paper-300 hover:border-paper-400',
    cardActive: 'bg-paper-100 border-ai-graphite-400 ring-1 ring-paper-400',
    number: 'text-ai-graphite-600'
  },
  unknown: {
    label: 'Not assessed',
    badgeLabel: 'Unknown',
    sub: 'Retry available',
    badge: 'bg-white text-ai-graphite-500 border border-dashed border-ai-graphite-300',
    card: 'border-paper-300',
    cardActive: 'bg-paper-100 border-ai-graphite-400 ring-1 ring-paper-400',
    number: 'text-ai-graphite-500'
  }
}

/** Risky references default to claim comparison; safe ones to the background section. */
function defaultTagsForThreat(threat: string | undefined): PatentTags {
  if (threat === 'anticipates' || threat === 'obvious') return { background: false, claims: true }
  if (threat === 'adjacent' || threat === 'remote') return { background: true, claims: false }
  return { background: false, claims: false }
}

const RelatedArtStage = React.memo(function RelatedArtStage({ session, patent, onComplete, onRefresh }: RelatedArtStageProps) {
  const idea = session?.ideaRecord || {}
  const searchQuery = idea?.searchQuery || ''

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [phase, setPhase] = useState<Phase>('idle')
  const [phaseMessage, setPhaseMessage] = useState('')
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgressState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'warning'; text: string } | null>(null)

  const [results, setResults] = useState<ResultItem[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [aiAnalysis, setAiAnalysis] = useState<Record<string, AIAnalysisEntry>>({})
  const [patentDetailsMap, setPatentDetailsMap] = useState<Record<string, any>>({})
  const [detailsLoading, setDetailsLoading] = useState(false)

  // Search scope (all previous "Advanced Settings" preserved here)
  const [queryText, setQueryText] = useState('')
  const [scopeOpen, setScopeOpen] = useState(false)
  const [searchPanelOpen, setSearchPanelOpen] = useState(false)
  const [limit, setLimit] = useState(25)
  const [filterCountries, setFilterCountries] = useState<string[]>([])
  const [afterDate, setAfterDate] = useState('')
  const [publicationDateTo, setPublicationDateTo] = useState('')
  const [filingDateFrom, setFilingDateFrom] = useState('')
  const [filingDateTo, setFilingDateTo] = useState('')

  // Triage
  const [tags, setTags] = useState<Record<string, PatentTags>>({})
  const [manualRefs, setManualRefs] = useState<ManualRef[]>([])
  const [riskFilter, setRiskFilter] = useState<ThreatLevel | null>(null)
  const [countryFilter, setCountryFilter] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addFormOpen, setAddFormOpen] = useState(false)
  const [manualDraft, setManualDraft] = useState('')
  const [continuing, setContinuing] = useState(false)
  const [hasHydrated, setHasHydrated] = useState(false)
  // Explicit opt-out of claim refinement, for users who are confident in their
  // preliminary claims. Without this, skipping is only inferrable from tagging
  // nothing for claims — which gives no way to skip while still tagging claim
  // references for later stages.
  const [skipClaimRefinement, setSkipClaimRefinement] = useState(false)

  // Idea bank (unchanged behavior)
  const [ideaBank, setIdeaBank] = useState<Array<{ title: string; core_principle: string; expected_advantage: string; tags: string[]; non_obvious_extension: string }>>([])
  const [ideaBankOpen, setIdeaBankOpen] = useState(false)
  const [hasRestoredFromStorage, setHasRestoredFromStorage] = useState(false)

  const lastLoadedRunIdRef = useRef<string | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)
  const hasInitializedRef = useRef(false)
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---------------------------------------------------------------------------
  // Patent identity + analysis lookup helpers
  // ---------------------------------------------------------------------------
  function canonicalizePatentNumber(value: any) {
    if (!value) return ''
    const normalized = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
    const kindSuffixMatch = normalized.match(/^(.*\d)[A-Z]\d?$/)
    return kindSuffixMatch?.[1] || normalized
  }

  function getPatentNumber(item: any) {
    return String(
      item?.publicationNumber ||
      item?.publication_number ||
      item?.patent_number ||
      item?.pn ||
      item?.publication_id ||
      item?.publicationId ||
      item?.patentId ||
      item?.patent_id ||
      item?.id ||
      ''
    ).trim()
  }

  const getPatentKey = (item: any, index?: number) => {
    const pn = getPatentNumber(item) || 'N/A'
    const ttl = item.title || (item as any).invention_title || pn || 'Untitled'
    const idx = typeof index === 'number' ? index : 0
    return pn !== 'N/A' ? pn : `${ttl}-${idx}`
  }

  function getAnalysisForPatentNumber(patentNumber: any): AIAnalysisEntry | null {
    const pn = String(patentNumber || '').trim()
    if (!pn || pn === 'N/A') return null
    if (aiAnalysis[pn]) return aiAnalysis[pn]
    const canonical = canonicalizePatentNumber(pn)
    if (!canonical) return null
    if (aiAnalysis[canonical]) return aiAnalysis[canonical]
    const matchedKey = Object.keys(aiAnalysis).find(key => canonicalizePatentNumber(key) === canonical)
    return matchedKey ? aiAnalysis[matchedKey] : null
  }

  function getAnalysisForPatent(item: any): AIAnalysisEntry | null {
    return getAnalysisForPatentNumber(getPatentNumber(item))
  }

  function firstText(...values: any[]) {
    for (const value of values) {
      if (value === null || value === undefined) continue
      const text = String(value).trim()
      if (text) return text
    }
    return ''
  }

  function normalizeTextList(value: any): string[] {
    if (Array.isArray(value)) {
      return value.map(item => String(item || '').trim()).filter(Boolean)
    }
    if (typeof value === 'string') {
      return value.split(/[|;,]/).map(item => item.trim()).filter(Boolean)
    }
    return []
  }

  function getResultSourceLabel(item: any) {
    const providerValues = [
      ...(Array.isArray(item?.sourceProviders) ? item.sourceProviders : []),
      item?.sourceProvider,
      item?.providerId,
      item?.provider
    ].map(value => String(value || '').toLowerCase())
    const pn = getPatentNumber(item).toUpperCase()
    if (providerValues.some(value => value === 'indian-corpus' || value === 'indian_corpus')) return 'Indian patents'
    if (providerValues.some(value => value === 'google-patents')) return 'Google Patents'
    if (providerValues.some(value => value === 'epo-ops' || value === 'epo-ops-corpus')) return 'European patents'
    const jurisdiction = String(item?.jurisdiction || item?.country || '').toUpperCase().replace(/[^A-Z]/g, '')
    if (jurisdiction === 'IN' || pn.startsWith('IN')) return 'Indian patents'
    if (jurisdiction === 'EP' || jurisdiction === 'WO' || pn.startsWith('EP') || pn.startsWith('WO')) return 'European patents'
    return 'International patents'
  }

  // Two-letter jurisdiction for the per-result country filter. Prefers the
  // explicit jurisdiction/country field, falling back to the patent-number prefix.
  function getResultCountry(item: any): string {
    const jurisdiction = String(item?.jurisdiction || item?.country || '').toUpperCase().replace(/[^A-Z]/g, '')
    if (jurisdiction.length >= 2) return jurisdiction.slice(0, 2)
    const pn = getPatentNumber(item).toUpperCase()
    const match = pn.match(/^([A-Z]{2})/)
    return match ? match[1] : 'XX'
  }

  function findStoredPatentDetails(item: any) {
    const rawPn = getPatentNumber(item)
    const canonical = canonicalizePatentNumber(rawPn)
    return patentDetailsMap[rawPn] || patentDetailsMap[canonical] || {}
  }

  function getPatentDisplayData(item: any, index: number) {
    const db = findStoredPatentDetails(item)
    const rawPn = firstText(
      db.publicationNumber,
      item?.publicationNumber,
      item?.publication_number,
      item?.patent_number,
      item?.pn,
      item?.publication_id,
      item?.id
    )
    const pn = rawPn || `Result ${index + 1}`
    const title = firstText(db.title, item?.title, item?.invention_title, 'Untitled patent')
    const abstract = firstText(
      db.abstract,
      db.description,
      item?.abstract,
      item?.abstract_text,
      item?.abstractText,
      item?.abstract_en,
      item?.abstractEnglish,
      item?.snippet,
      item?.summary,
      item?.description
    )
    const publicationDate = firstText(db.publicationDate, item?.publication_date, item?.pub_date, item?.date, item?.year)
    const filingDate = firstText(db.filingDate, item?.filing_date, item?.filingDate, item?.application_date, item?.app_date)
    const priorityDate = firstText(db.priorityDate, item?.priority_date, item?.priorityDate)
    const applicationNumber = firstText(item?.application_number, item?.applicationNumber, item?.app_no)
    const inventors = [
      ...normalizeTextList(db.inventors),
      ...normalizeTextList(item?.inventors),
      ...normalizeTextList(item?.inventor_names),
      ...normalizeTextList(item?.inventor)
    ].filter((value, idx, arr) => arr.indexOf(value) === idx)
    const assignees = [
      ...normalizeTextList(db.assignees),
      ...normalizeTextList(item?.assignees),
      ...normalizeTextList(item?.assignee_names),
      ...normalizeTextList(item?.assignee),
      ...normalizeTextList(item?.applicants)
    ].filter((value, idx, arr) => arr.indexOf(value) === idx)
    const cpcCodes = [
      ...normalizeTextList(db.cpcs),
      ...normalizeTextList(item?.cpcCodes),
      ...normalizeTextList(item?.cpc_codes),
      ...normalizeTextList(item?.cpc)
    ].filter((value, idx, arr) => arr.indexOf(value) === idx)
    const ipcCodes = [
      ...normalizeTextList(db.ipcs),
      ...normalizeTextList(item?.ipcCodes),
      ...normalizeTextList(item?.ipc_codes),
      ...normalizeTextList(item?.ipc)
    ].filter((value, idx, arr) => arr.indexOf(value) === idx)
    const rawScore = item?.relevanceScore ?? item?.score ?? item?.relevance
    const score = typeof rawScore === 'number' ? (rawScore > 1 ? rawScore : rawScore * 100) : null
    const link = firstText(db.link, db.pdfLink, item?.link, item?.url, item?.patent_url, rawPn ? `https://patents.google.com/patent/${rawPn}` : '')
    const sourceLabel = getResultSourceLabel(item)

    return { pn, title, abstract, publicationDate, filingDate, priorityDate, applicationNumber, inventors, assignees, cpcCodes, ipcCodes, score, link, sourceLabel }
  }

  // Claim-aware analysis runs off whatever claims exist. Locking them is optional,
  // so gating on claimsApprovedAt here would silently downgrade the comparison.
  const buildClaimsContext = () => {
    const normalizedData = (session?.ideaRecord?.normalizedData || {}) as any
    const claimsSnapshot = getAuthoritativeClaims(normalizedData)
    const structuredClaims = claimsSnapshot.structured
    const claimsText = claimsSnapshot.html
    const hasClaims = structuredClaims.length > 0 || claimsText.replace(/<[^>]*>/g, '').trim().length > 0
    return hasClaims ? {
      claims: structuredClaims.length > 0 ? structuredClaims : claimsText,
      jurisdiction: normalizedData.claimsJurisdiction,
      frozenAt: normalizedData.claimsApprovedAt || null
    } : null
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle: reset on session change, hydrate from stored data
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const newSessionId = session?.id || null
    const previousSessionId = currentSessionIdRef.current

    if (previousSessionId !== null && newSessionId !== previousSessionId) {
      hasInitializedRef.current = false
      lastLoadedRunIdRef.current = null
      setResults([])
      setRunId(null)
      setAiAnalysis({})
      setPatentDetailsMap({})
      setDetailsLoading(false)
      setQueryText('')
      setScopeOpen(false)
      setSearchPanelOpen(false)
      setLimit(25)
      setFilterCountries([])
      setAfterDate('')
      setPublicationDateTo('')
      setFilingDateFrom('')
      setFilingDateTo('')
      setTags({})
      setManualRefs([])
      setRiskFilter(null)
      setCountryFilter(null)
      setExpanded(new Set())
      setAddFormOpen(false)
      setManualDraft('')
      setHasHydrated(false)
      setError(null)
      setStatusMessage(null)
      setPhase('idle')
      setPhaseMessage('')
      setAnalysisProgress(null)
      setIdeaBank([])
      setHasRestoredFromStorage(false)
      if (typeof window !== 'undefined' && previousSessionId) {
        sessionStorage.removeItem(`ideaBank_${previousSessionId}`)
      }
    }

    currentSessionIdRef.current = newSessionId
  }, [session?.id])

  useEffect(() => {
    if (!session) return

    const latestRun = session.relatedArtRuns?.[0]
    const latestRunId = latestRun?.id || null
    const hasStoredResults = latestRun?.resultsJson && Array.isArray(latestRun.resultsJson) && latestRun.resultsJson.length > 0
    const runIdChanged = latestRunId && lastLoadedRunIdRef.current !== latestRunId

    if (latestRun && (runIdChanged || (!hasInitializedRef.current && latestRunId && hasStoredResults && results.length === 0))) {
      lastLoadedRunIdRef.current = latestRunId
      setResults(latestRun.resultsJson)
      setRunId(latestRun.id)
    } else if (latestRunId && !runId) {
      setRunId(latestRunId)
    }

    // AI analysis persisted with the session (also covers novelty-handoff imports,
    // which create a RelatedArtRun and aiAnalysisData together).
    if ((session as any)?.aiAnalysisData && Object.keys(aiAnalysis).length === 0) {
      const storedAiAnalysis = (session as any).aiAnalysisData
      if (storedAiAnalysis && typeof storedAiAnalysis === 'object' && Object.keys(storedAiAnalysis).length > 0) {
        setAiAnalysis(storedAiAnalysis)
      }
    }

    // Analysis stored per-selection (tags + userNotes JSON) — the durable copy.
    if ((!hasInitializedRef.current || runIdChanged) && latestRunId && session?.relatedArtSelections && session.relatedArtSelections.length > 0) {
      const allRunSelections = session.relatedArtSelections.filter((sel: any) => sel.runId === latestRunId)
      const storedAnalysis: Record<string, AIAnalysisEntry> = {}
      allRunSelections.forEach((sel: any) => {
        const selTags = Array.isArray(sel.tags) ? sel.tags : []
        const analyzed = selTags.includes('AI_REVIEWED')
        const unknown = selTags.includes('AI_ANALYSIS_UNKNOWN')
        if (!analyzed && !unknown) return
        let details: any = {}
        try { details = sel.userNotes ? JSON.parse(sel.userNotes) : {} } catch { details = { summary: sel.userNotes || '' } }
        const noveltyThreat = unknown ? 'unknown' :
          selTags.includes('AI_ANTICIPATES') ? 'anticipates' :
          selTags.includes('AI_OBVIOUS') ? 'obvious' :
          selTags.includes('AI_ADJACENT') ? 'adjacent' :
          selTags.includes('AI_REMOTE') ? 'remote' : 'unknown'
        storedAnalysis[sel.patentNumber] = {
          aiSummary: details.summary || '',
          noveltyThreat,
          relevantParts: Array.isArray(details.relevant_parts) ? details.relevant_parts : [],
          irrelevantParts: Array.isArray(details.irrelevant_parts) ? details.irrelevant_parts : [],
          noveltyComparison: details.novelty_comparison || '',
          analysisStatus: unknown ? 'unknown' : 'analyzed',
          evidenceBasis: 'title_abstract',
          failureReason: details.failure_reason,
        }
      })
      if (Object.keys(storedAnalysis).length > 0) setAiAnalysis(prev => ({ ...storedAnalysis, ...prev }))
    }

    // Restore tags + manual references from the saved workflow config.
    if (!hasInitializedRef.current) {
      const config = (session as any)?.priorArtConfig || {}
      const draftConfig = config.priorArtForDrafting || {}
      const claimConfig = config.claimRefinementConfig || {}
      const restoredTags: Record<string, PatentTags> = {}

      if (Array.isArray(draftConfig.selectedPatents)) {
        draftConfig.selectedPatents.forEach((p: any) => {
          if (!p.patentNumber) return
          restoredTags[p.patentNumber] = { ...(restoredTags[p.patentNumber] || { background: false, claims: false }), background: true }
        })
      }
      if (Array.isArray(claimConfig.selectedPatents)) {
        claimConfig.selectedPatents.forEach((p: any) => {
          if (!p.patentNumber) return
          restoredTags[p.patentNumber] = { ...(restoredTags[p.patentNumber] || { background: false, claims: false }), claims: true }
        })
      }
      if (Object.keys(restoredTags).length > 0) setTags(prev => ({ ...restoredTags, ...prev }))

      // Restore an earlier explicit decision to skip refinement, so a reload
      // doesn't silently put the stage back into the flow.
      if (config.skippedClaimRefinement) setSkipClaimRefinement(true)

      // Manual text from either the new config or the legacy manualPriorArt record.
      const draftManual = String(draftConfig.manualText || session?.manualPriorArt?.manualPriorArtText || '').trim()
      const claimManual = String(claimConfig.manualText || '').trim()
      const restored: ManualRef[] = []
      if (draftManual && draftManual === claimManual) {
        restored.push({ id: 'manual-restored-1', text: draftManual, background: true, claims: true })
      } else {
        if (draftManual) restored.push({ id: 'manual-restored-1', text: draftManual, background: true, claims: false })
        if (claimManual) restored.push({ id: 'manual-restored-2', text: claimManual, background: false, claims: true })
      }
      if (restored.length > 0) setManualRefs(prev => (prev.length === 0 ? restored : prev))
    }

    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true
      setHasHydrated(true)
    }
    // Hydration must re-run only when the session object changes — reacting to
    // aiAnalysis/results/runId here would replay stored state over user edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // Fetch stored patent metadata for the current results.
  useEffect(() => {
    if (results.length === 0) {
      setPatentDetailsMap({})
      return
    }
    const publicationNumbers = Array.from(new Set(
      results.map(item => getPatentNumber(item)).filter(pn => pn && pn !== 'N/A')
    ))
    if (publicationNumbers.length === 0) {
      setPatentDetailsMap({})
      return
    }
    let cancelled = false
    const load = async () => {
      setDetailsLoading(true)
      try {
        const response = await fetch('/api/patents/details/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: JSON.stringify({ publicationNumbers })
        })
        if (!cancelled && response.ok) {
          const data = await response.json()
          setPatentDetailsMap(data?.success && data?.patents ? data.patents : {})
        } else if (!cancelled) {
          setPatentDetailsMap({})
        }
      } catch (err) {
        console.warn('Failed to load stored patent details:', err)
        if (!cancelled) setPatentDetailsMap({})
      } finally {
        if (!cancelled) setDetailsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [results])

  // Idea bank persistence across remounts (unchanged behavior).
  useEffect(() => {
    if (session?.id && !hasRestoredFromStorage && ideaBank.length === 0) {
      try {
        const saved = sessionStorage.getItem(`ideaBank_${session.id}`)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (Array.isArray(parsed) && parsed.length > 0) {
            setIdeaBank(parsed)
            setHasRestoredFromStorage(true)
          }
        }
      } catch (e) {
        console.warn('Failed to restore ideaBank from sessionStorage:', e)
      }
    }
  }, [session?.id, hasRestoredFromStorage, ideaBank.length])

  useEffect(() => {
    if (typeof window === 'undefined' || !session?.id) return
    try {
      if (ideaBank.length > 0) {
        sessionStorage.setItem(`ideaBank_${session.id}`, JSON.stringify(ideaBank))
      } else if (hasRestoredFromStorage) {
        sessionStorage.removeItem(`ideaBank_${session.id}`)
      }
    } catch (e) {
      console.warn('Failed to save ideaBank to sessionStorage:', e)
    }
  }, [ideaBank, session?.id, hasRestoredFromStorage])

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------
  const hasAIReview = useMemo(() => {
    if (results.length === 0) return false
    return results.some(r => !!getAnalysisForPatent(r))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, aiAnalysis])

  const missingAnalysisPatentNumbers = useMemo(() => {
    const seen = new Set<string>()
    const missing: string[] = []
    results.forEach(result => {
      const pn = getPatentNumber(result)
      if (!pn || pn === 'N/A') return
      const canonical = canonicalizePatentNumber(pn) || pn.toUpperCase()
      if (seen.has(canonical)) return
      seen.add(canonical)
      const analysis = getAnalysisForPatentNumber(pn)
      if (!analysis || analysis.analysisStatus === 'unknown' || analysis.noveltyThreat === 'unknown') missing.push(pn)
    })
    return missing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, aiAnalysis])

  const threatCounts = useMemo(() => {
    const counts: Record<ThreatLevel, number> = { anticipates: 0, obvious: 0, adjacent: 0, remote: 0, unknown: 0 }
    results.forEach(r => {
      const analysis = getAnalysisForPatent(r)
      const threat = (analysis?.noveltyThreat || 'unknown') as ThreatLevel
      if (analysis?.analysisStatus === 'unknown' || !THREAT_META[threat]) counts.unknown += 1
      else counts[threat] += 1
    })
    return counts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, aiAnalysis])

  // Countries present in the current results, most common first — powers the
  // per-result country filter chips.
  const countryOptions = useMemo(() => {
    const counts = new Map<string, number>()
    results.forEach(r => {
      const code = getResultCountry(r)
      counts.set(code, (counts.get(code) || 0) + 1)
    })
    return Array.from(counts.entries())
      .map(([code, count]) => ({
        code,
        count,
        name: PATENT_COUNTRIES.find(c => c.code === code)?.name || code
      }))
      .sort((a, b) => b.count - a.count)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results])

  const filteredResults = useMemo(() => {
    if (!riskFilter && !countryFilter) return results
    return results.filter(r => {
      if (countryFilter && getResultCountry(r) !== countryFilter) return false
      if (riskFilter) {
        const analysis = getAnalysisForPatent(r)
        const threat = (analysis?.noveltyThreat || 'unknown') as ThreatLevel
        const effective = analysis?.analysisStatus === 'unknown' || !THREAT_META[threat] ? 'unknown' : threat
        if (effective !== riskFilter) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, aiAnalysis, riskFilter, countryFilter])

  const getTagsFor = useCallback((key: string): PatentTags => {
    return tags[key] || { background: false, claims: false }
  }, [tags])

  const backgroundCount = useMemo(() => {
    const fromPatents = results.filter((r, i) => getTagsFor(getPatentKey(r, i)).background).length
    const fromManual = manualRefs.filter(m => m.background).length
    return fromPatents + fromManual
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, tags, manualRefs, getTagsFor])

  const claimsCount = useMemo(() => {
    const fromPatents = results.filter((r, i) => getTagsFor(getPatentKey(r, i)).claims).length
    const fromManual = manualRefs.filter(m => m.claims).length
    return fromPatents + fromManual
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, tags, manualRefs, getTagsFor])

  // ---------------------------------------------------------------------------
  // Pre-tagging: once analysis lands, give untagged patents a sensible default.
  // Keys the user explicitly cleared stay in the map as {false,false}, so
  // defaults never fight an explicit decision.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!hasHydrated || results.length === 0) return
    setTags(prev => {
      let changed = false
      const next = { ...prev }
      results.forEach((r, i) => {
        const key = getPatentKey(r, i)
        if (next[key]) return
        const analysis = getAnalysisForPatent(r)
        if (!analysis || analysis.analysisStatus === 'unknown') return
        next[key] = defaultTagsForThreat(analysis.noveltyThreat)
        changed = true
      })
      return changed ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiAnalysis, results, hasHydrated])

  // ---------------------------------------------------------------------------
  // Selection payloads: derived from tags — mode is data, not a user decision.
  // ---------------------------------------------------------------------------
  const buildSelectionArrays = useCallback(() => {
    const priorArtPatents: any[] = []
    const claimRefPatents: any[] = []
    results.forEach((r, i) => {
      const key = getPatentKey(r, i)
      const t = tags[key]
      if (!t || (!t.background && !t.claims)) return
      const analysis = getAnalysisForPatent(r)
      const entry = {
        patentNumber: key,
        ...r,
        noveltyThreat: analysis?.noveltyThreat,
        aiSummary: analysis?.aiSummary,
        relevantParts: analysis?.relevantParts,
        irrelevantParts: analysis?.irrelevantParts,
        noveltyComparison: analysis?.noveltyComparison
      }
      if (t.background) priorArtPatents.push(entry)
      if (t.claims) claimRefPatents.push(entry)
    })
    const backgroundManualText = manualRefs.filter(m => m.background && m.text.trim()).map(m => m.text.trim()).join('\n\n')
    const claimsManualText = manualRefs.filter(m => m.claims && m.text.trim()).map(m => m.text.trim()).join('\n\n')
    const priorArtMode = priorArtPatents.length > 0 && backgroundManualText ? 'hybrid' : backgroundManualText ? 'manual' : 'ai'
    const claimRefMode = claimRefPatents.length > 0 && claimsManualText ? 'hybrid' : claimsManualText ? 'manual' : 'ai'
    return { priorArtPatents, claimRefPatents, backgroundManualText, claimsManualText, priorArtMode, claimRefMode }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, tags, manualRefs, aiAnalysis])

  // Autosave tag decisions so a reload never loses triage work. skipClaimRefinement
  // is intentionally omitted — the server keeps its stored value; only Continue
  // decides it.
  useEffect(() => {
    if (!hasHydrated || !session?.id) return
    if (results.length === 0 && manualRefs.length === 0) return
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current)
    autoSaveTimeoutRef.current = setTimeout(() => {
      const { priorArtPatents, claimRefPatents, backgroundManualText, claimsManualText, priorArtMode, claimRefMode } = buildSelectionArrays()
      onComplete({
        action: 'save_prior_art_config',
        sessionId: session.id,
        priorArtConfig: { mode: priorArtMode, selectedPatents: priorArtPatents, manualText: backgroundManualText },
        claimRefConfig: { mode: claimRefMode, selectedPatents: claimRefPatents, manualText: claimsManualText }
      }).catch(err => console.error('Autosave of prior art tags failed:', err))
    }, 1000)
    return () => {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags, manualRefs, hasHydrated, session?.id])

  // ---------------------------------------------------------------------------
  // Search + assess pipeline (one user action)
  // ---------------------------------------------------------------------------
  const applyAIReviewResponse = (resp: any, currentResults: ResultItem[], options?: { mergeExisting?: boolean }) => {
    if (!resp) {
      setError('AI review failed: No response from server. Please try again.')
      return false
    }

    const decisions: Array<{ pn: string; title: string; relevance: number | null; novelty_threat?: string; summary: string; analysis_status?: 'analyzed' | 'unknown'; evidence_basis?: 'title_abstract'; failure_reason?: string; detailedAnalysis?: any }> = Array.isArray(resp?.decisions) ? resp.decisions : []

    let ideas: any[] = []
    if (Array.isArray(resp?.ideaBankSuggestions)) ideas = resp.ideaBankSuggestions
    else if (Array.isArray(resp?.data?.ideaBankSuggestions)) ideas = resp.data.ideaBankSuggestions
    if (!options?.mergeExisting || ideas.length > 0) setIdeaBank([...ideas])

    const byPn: Record<string, any> = {}
    const byCanonicalPn: Record<string, any> = {}
    for (const d of decisions) {
      if (!d?.pn) continue
      const decision = {
        relevance: typeof d.relevance === 'number' ? d.relevance : null,
        novelty_threat: String((d as any).novelty_threat || 'remote'),
        summary: String(d.summary || '').slice(0, 260),
        title: d.title || '',
        relevant_parts: (d as any).detailedAnalysis?.relevant_parts || [],
        irrelevant_parts: (d as any).detailedAnalysis?.irrelevant_parts || [],
        novelty_comparison: (d as any).detailedAnalysis?.novelty_comparison || '',
        analysis_status: d.analysis_status || 'analyzed',
        evidence_basis: d.evidence_basis || 'title_abstract',
        failure_reason: d.failure_reason,
      }
      byPn[d.pn] = decision
      byCanonicalPn[canonicalizePatentNumber(d.pn)] = decision
    }

    const newAiAnalysis: Record<string, AIAnalysisEntry> = {}
    currentResults.forEach((r) => {
      const pn = getPatentNumber(r) || 'N/A'
      if (!pn || pn === 'N/A') return
      const dec = byPn[pn] || byCanonicalPn[canonicalizePatentNumber(pn)]
      if (!dec) return
      newAiAnalysis[pn] = {
        aiSummary: dec.summary,
        noveltyThreat: dec.novelty_threat,
        relevantParts: Array.isArray(dec.relevant_parts) ? dec.relevant_parts : [],
        irrelevantParts: Array.isArray(dec.irrelevant_parts) ? dec.irrelevant_parts : [],
        noveltyComparison: String(dec.novelty_comparison || '').trim(),
        analysisStatus: dec.analysis_status,
        evidenceBasis: dec.evidence_basis,
        failureReason: dec.failure_reason,
      }
    })

    setAiAnalysis(prev => (options?.mergeExisting ? { ...prev, ...newAiAnalysis } : newAiAnalysis))

    // Keep session.aiAnalysisData in sync — the stage-progress indicator and
    // session hydration both read it. The server merges, so partial re-runs are safe.
    if (Object.keys(newAiAnalysis).length > 0) {
      onComplete({ action: 'save_ai_analysis', sessionId: session?.id, aiAnalysisData: newAiAnalysis })
        .catch(err => console.warn('Failed to persist AI analysis data:', err))
    }

    const reviewedCount = typeof resp?.reviewed === 'number'
      ? resp.reviewed
      : decisions.filter(decision => decision.analysis_status !== 'unknown').length
    const unknownCount = typeof resp?.unknown === 'number'
      ? resp.unknown
      : decisions.length - reviewedCount
    setAnalysisProgress(prev => ({
      processed: typeof resp?.attempted === 'number' ? resp.attempted : decisions.length,
      total: prev?.total || currentResults.length,
      currentBatch: prev?.totalBatches || 1,
      totalBatches: prev?.totalBatches || 1,
      message: `${reviewedCount} assessed${unknownCount > 0 ? `; ${unknownCount} unknown after retry` : ''}.`
    }))
    return true
  }

  const runAIReview = async (options?: { missingOnly?: boolean; runIdOverride?: string; resultsOverride?: ResultItem[] }) => {
    const activeRunId = options?.runIdOverride || runId
    const activeResults = options?.resultsOverride || results
    if (!activeRunId) { setError('Run a search first.'); return }
    if (activeResults.length === 0) { setError('No results to review.'); return }
    if (phase === 'assessing') return

    const missingOnly = options?.missingOnly === true
    const candidatePatentNumbers = missingOnly ? missingAnalysisPatentNumbers : []
    const targetCount = missingOnly ? candidatePatentNumbers.length : activeResults.length

    if (missingOnly && targetCount === 0) {
      setStatusMessage({ type: 'success', text: 'All current results already have an AI assessment.' })
      return
    }

    try {
      setError(null)
      setPhase('assessing')
      setPhaseMessage(`Assessing ${targetCount} patent${targetCount !== 1 ? 's' : ''}...`)
      setAnalysisProgress({ processed: 0, total: targetCount, currentBatch: 0, totalBatches: 0, message: 'Preparing patent batches...' })

      const claimsContext = buildClaimsContext()

      const updateProgress = (event: any) => {
        const total = typeof event.total === 'number' && event.total > 0 ? event.total : targetCount
        const processed = typeof event.processed === 'number' ? Math.min(event.processed, total) : 0
        const currentBatch = typeof event.batch === 'number' ? event.batch : 0
        const totalBatches = typeof event.totalBatches === 'number' ? event.totalBatches : 0
        const message = String(event.message || '').trim()
        if (event.type === 'start') {
          setAnalysisProgress({ processed: 0, total, currentBatch: 0, totalBatches, message: message || `Starting assessment of ${total} patents...` })
        } else if (event.type === 'batch_started' || event.type === 'batch_completed') {
          setAnalysisProgress({ processed, total, currentBatch, totalBatches, message: message || `Assessed ${processed} of ${total} patents.` })
        } else if (event.type === 'saving' || event.type === 'saved') {
          setAnalysisProgress({ processed: total, total, currentBatch: totalBatches, totalBatches, message: message || 'Saving assessment results...' })
        }
      }

      let finalResponse: any = null

      if (patent?.id && typeof window !== 'undefined') {
        const response = await fetch(`/api/patents/${patent.id}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: JSON.stringify({
            action: 'related_art_llm_review_stream',
            sessionId: session?.id,
            runId: activeRunId,
            claimsContext,
            candidatePatentNumbers: missingOnly ? candidatePatentNumbers : undefined
          })
        })

        if (!response.ok) {
          const err = await response.json().catch(() => ({}))
          throw new Error(err?.error || 'AI review failed. Please try again.')
        }

        if (response.body) {
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          const handleLine = (line: string) => {
            if (!line.trim()) return
            const event = JSON.parse(line)
            if (event.type === 'error') {
              throw new Error(event.error || 'AI review failed. Please try again.')
            }
            if (event.type === 'complete') {
              finalResponse = event.response || event.data || event
              return
            }
            updateProgress(event)
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
        }
      }

      if (!finalResponse) {
        finalResponse = await onComplete({
          action: 'related_art_llm_review',
          sessionId: session?.id,
          runId: activeRunId,
          claimsContext,
          candidatePatentNumbers: missingOnly ? candidatePatentNumbers : undefined
        })
      }

      applyAIReviewResponse(finalResponse, activeResults, { mergeExisting: missingOnly })
    } catch (e) {
      console.error('AI review failed:', e)
      setError(e instanceof Error ? e.message : 'AI review failed. Please try again.')
    } finally {
      setPhase('idle')
      setPhaseMessage('')
    }
  }

  const runSearchAndAssess = async () => {
    if (phase !== 'idle') return
    try {
      setPhase('searching')
      setError(null)
      setStatusMessage(null)
      setPhaseMessage('Searching the patent corpus...')

      const effectiveQuery = queryText.trim() || searchQuery
      const resp = await onComplete({
        action: 'related_art_search',
        sessionId: session?.id,
        limit,
        queryOverride: effectiveQuery,
        afterDate: afterDate || undefined,
        providerIds: [],
        // Corpus scope filters — these narrow what is searched, not just shown.
        filters: {
          ...(filterCountries.length ? { countries: filterCountries } : {}),
          ...(publicationDateTo ? { publicationDateTo } : {}),
          ...(filingDateFrom ? { filingDateFrom } : {}),
          ...(filingDateTo ? { filingDateTo } : {}),
        },
      })

      const items = Array.isArray(resp?.results) ? resp.results : []
      const newRunId = resp?.runId || null

      // Fresh search: previous analysis and tags no longer apply.
      setAiAnalysis({})
      setAnalysisProgress(null)
      setPatentDetailsMap({})
      setTags({})
      setRiskFilter(null)
      setCountryFilter(null)
      setExpanded(new Set())
      setIdeaBank([])
      setHasRestoredFromStorage(false)
      if (typeof window !== 'undefined' && session?.id) {
        sessionStorage.removeItem(`ideaBank_${session.id}`)
      }

      setResults(items)
      setRunId(newRunId)
      setSearchPanelOpen(false)

      if (items.length === 0) {
        setPhase('idle')
        setPhaseMessage('')
        setStatusMessage({ type: 'warning', text: 'No patents matched this search. Broaden the query or scope and try again.' })
        return
      }

      // Assessment starts automatically — one user action, one pipeline.
      await runAIReview({ runIdOverride: newRunId || undefined, resultsOverride: items })
    } catch (e) {
      const errorData = (e as any)?.response?.data || e
      const serviceError = String((errorData as any)?.error || 'Search failed. Please try again.')
        .replace(/PQAI API/gi, 'Patent Search Service')
        .replace(/PQAI/gi, 'Patent Search Service')
      setError(serviceError)
      setPhase('idle')
      setPhaseMessage('')
    }
  }

  // ---------------------------------------------------------------------------
  // Continue: derive the exact legacy payloads from tags, then advance.
  // Claim refinement is skipped as a consequence of tagging nothing for claims.
  // ---------------------------------------------------------------------------
  const handleContinue = async () => {
    if (continuing) return
    setContinuing(true)
    setError(null)
    try {
      const { priorArtPatents, claimRefPatents, backgroundManualText, claimsManualText, priorArtMode, claimRefMode } = buildSelectionArrays()
      // An explicit skip wins. Otherwise refinement is inferred from whether the
      // user tagged anything for claim comparison.
      const willRefine = !skipClaimRefinement
        && (claimRefPatents.length > 0 || claimsManualText.trim().length > 0)

      // Persist user-confirmed selections on the run (kept for downstream
      // fallbacks and stage-status derivation).
      if (runId && session?.id) {
        try {
          await onComplete({ action: 'clear_related_art_selections', sessionId: session.id, runId })
          const taggedEntries = [...priorArtPatents, ...claimRefPatents]
          const seen = new Set<string>()
          const selections = taggedEntries.filter(entry => {
            if (seen.has(entry.patentNumber)) return false
            seen.add(entry.patentNumber)
            return true
          }).map(entry => ({
            patent_number: entry.patentNumber,
            title: entry.title,
            snippet: (entry as any).snippet || (entry as any).abstract,
            score: (entry as any).score,
            tags: ['USER_SELECTED'],
            publication_date: (entry as any).publication_date,
            inventors: (entry as any).inventors,
            assignees: (entry as any).assignees,
            user_notes: entry.aiSummary || undefined
          }))
          if (selections.length > 0) {
            await onComplete({ action: 'related_art_select', sessionId: session.id, runId, selections })
          }
        } catch (e) {
          console.warn('Failed to persist run selections:', e)
        }
      }

      await onComplete({
        action: 'save_prior_art_config',
        sessionId: session?.id,
        priorArtConfig: { mode: priorArtMode, selectedPatents: priorArtPatents, manualText: backgroundManualText },
        claimRefConfig: willRefine
          ? { mode: claimRefMode, selectedPatents: claimRefPatents, manualText: claimsManualText }
          : { mode: 'ai', selectedPatents: [], manualText: '' },
        skipClaimRefinement: !willRefine
      })

      const manualPriorArt = backgroundManualText ? {
        manualPriorArtText: backgroundManualText,
        useOnlyManualPriorArt: priorArtMode === 'manual',
        useManualAndAISearch: priorArtMode === 'hybrid'
      } : null

      if (willRefine) {
        await onComplete({
          action: 'set_stage',
          sessionId: session?.id,
          stage: 'CLAIM_REFINEMENT',
          priorArtForDrafting: { mode: priorArtMode, selectedPatents: priorArtPatents, manualText: backgroundManualText },
          claimRefinementConfig: { mode: claimRefMode, selectedPatents: claimRefPatents, manualText: claimsManualText },
          manualPriorArt,
          selectedPatents: claimRefPatents,
          priorArtConfig: {
            useAuto: claimRefMode !== 'manual',
            useManual: claimRefMode === 'manual' || claimRefMode === 'hybrid'
          }
        })
      } else {
        await onComplete({
          action: 'set_stage',
          sessionId: session?.id,
          stage: 'COMPONENT_PLANNER',
          priorArtForDrafting: { mode: priorArtMode, selectedPatents: priorArtPatents, manualText: backgroundManualText },
          claimRefinementSkipped: true,
          freezePreliminaryClaims: true,
          manualPriorArt,
          selectedPatents: priorArtPatents,
          priorArtConfig: {
            useAuto: priorArtMode !== 'manual',
            useManual: priorArtMode === 'manual' || priorArtMode === 'hybrid',
            skippedClaimRefinement: true
          }
        })
      }
      await onRefresh()
    } catch (e) {
      console.error('Failed to continue from prior art stage:', e)
      setError('Failed to save your selections. Please try again.')
    } finally {
      setContinuing(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Small UI helpers
  // ---------------------------------------------------------------------------
  const togglePatentTag = (key: string, which: keyof PatentTags) => {
    setTags(prev => {
      const current = prev[key] || { background: false, claims: false }
      return { ...prev, [key]: { ...current, [which]: !current[which] } }
    })
  }

  const toggleManualTag = (id: string, which: 'background' | 'claims') => {
    setManualRefs(prev => prev.map(m => (m.id === id ? { ...m, [which]: !m[which] } : m)))
  }

  const toggleExpanded = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const addManualRef = () => {
    const text = manualDraft.trim()
    if (!text) return
    setManualRefs(prev => [...prev, { id: `manual-${Date.now()}`, text, background: true, claims: false }])
    setManualDraft('')
    setAddFormOpen(false)
  }

  const removeManualRef = (id: string) => {
    setManualRefs(prev => prev.filter(m => m.id !== id))
  }

  const noveltyHandoff = session?.noveltyHandoff
  const running = phase !== 'idle'
  const showTriage = results.length > 0 || manualRefs.length > 0

  // On mobile the chips grow to split the row (bigger tap targets); on sm+ they
  // shrink to their natural width and sit inline at the row's right edge.
  const TagChip = ({ on, label, onClick, disabled }: { on: boolean; label: string; onClick: () => void; disabled?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`flex-1 sm:flex-none text-center px-3 py-2 sm:py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
        on
          ? 'bg-ai-blue-50 border-ai-blue-300 text-ai-blue-700'
          : 'bg-white border-paper-300 text-ai-graphite-500 hover:border-paper-400 hover:text-ai-graphite-600'
      } disabled:opacity-40`}
    >
      {on ? '✓ ' : ''}{label}
    </button>
  )

  const ManualRow = ({ m }: { m: ManualRef }) => (
    <div>
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-4 sm:px-5">
        <div className="sm:w-[84px] sm:shrink-0 sm:mt-0.5">
          <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap bg-white text-ai-graphite-600 border border-dashed border-ai-graphite-400">
            Manual
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-ai-graphite-800 whitespace-pre-wrap break-words">{m.text}</p>
          <div className="text-xs text-ai-graphite-500 mt-1 flex items-center gap-2">
            <span>Added manually · not assessed</span>
            <button
              type="button"
              onClick={() => removeManualRef(m.id)}
              className="text-red-500 hover:text-red-600 font-medium"
            >
              Remove
            </button>
          </div>
        </div>
        <div className="flex gap-2 sm:gap-1.5 sm:shrink-0">
          <TagChip on={m.background} label="Background" onClick={() => toggleManualTag(m.id, 'background')} />
          <TagChip on={m.claims} label="Claims" onClick={() => toggleManualTag(m.id, 'claims')} />
        </div>
      </div>
    </div>
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-white">
      {/* Prior art seeded from a completed novelty assessment — explains why the list
          below is already populated and analysed. */}
      {noveltyHandoff?.searchId && (
        <div className="max-w-5xl mx-auto px-4 pt-4">
          <div className="rounded-xl border border-lamp-200 bg-lamp-50/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-lamp-900">Imported from your novelty assessment</div>
                <p className="mt-1 text-sm text-lamp-800">
                  {noveltyHandoff.citationCount ?? 0} analysed reference{(noveltyHandoff.citationCount ?? 0) === 1 ? '' : 's'} were
                  carried over and pre-selected for drafting
                  {(noveltyHandoff.shortlistedCount ?? 0) > 0
                    ? `, plus ${noveltyHandoff.shortlistedCount} shortlisted reference${noveltyHandoff.shortlistedCount === 1 ? '' : 's'} listed for reference only`
                    : ''}.
                  {noveltyHandoff.risk?.headline ? ` Assessment outcome: ${noveltyHandoff.risk.headline}.` : ''}
                </p>
              </div>
              <a
                href={`/novelty-search/${noveltyHandoff.searchId}/consolidated`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-lg border border-lamp-300 bg-white px-3 py-1.5 text-sm font-medium text-lamp-800 hover:bg-lamp-100"
              >
                View full report
              </a>
            </div>
            {noveltyHandoff.findingsDigest && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-lamp-900">Assessment findings</summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-lamp-200 bg-white p-3 text-xs leading-5 text-slate-700">
                  {noveltyHandoff.findingsDigest}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-6 pb-40 sm:pb-32">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div>
            <h2 className="text-xl font-bold text-ai-graphite-900">Prior Art Analysis</h2>
            <p className="text-sm text-ai-graphite-500 mt-0.5">
              {showTriage && hasAIReview
                ? `${results.length} reference${results.length !== 1 ? 's' : ''} found and assessed${detailsLoading ? ' · loading metadata' : ''}`
                : 'One search, assessed automatically — then tag each reference for how it should be used.'}
            </p>
          </div>
          {showTriage && !running && (
            <button
              type="button"
              onClick={() => setSearchPanelOpen(open => !open)}
              className="px-4 py-2 rounded-xl text-sm font-medium border border-paper-300 text-ai-graphite-700 hover:border-ai-graphite-400 transition-colors"
            >
              {searchPanelOpen ? 'Hide search options' : 'Adjust search'}
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <div className="flex-1">
              <div className="font-medium text-red-800">Something went wrong</div>
              <div className="text-sm text-red-600 mt-0.5">{error}</div>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
          </div>
        )}

        {statusMessage && (
          <div className={`mb-4 p-3 rounded-xl border text-sm ${
            statusMessage.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <span>{statusMessage.text}</span>
              <button onClick={() => setStatusMessage(null)} className="opacity-60 hover:opacity-100 leading-none">×</button>
            </div>
          </div>
        )}

        {/* Search card — the start state, and reachable later via "Adjust search". */}
        {(!showTriage || searchPanelOpen) && !running && (
          <div className="space-y-4 mb-6">
            {!showTriage && (
              <div className="bg-ai-blue-50 rounded-2xl border border-ai-blue-100 p-5 flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-ai-blue-100 text-ai-blue-700 flex items-center justify-center font-semibold shrink-0">
                  {String(idea?.title || 'I').slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-ai-graphite-900">{idea?.title || 'Untitled invention'}</div>
                  {idea?.abstract && <p className="text-sm text-ai-graphite-600 mt-1 line-clamp-2">{idea.abstract}</p>}
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-paper-300 p-5 space-y-4">
              <div>
                <label htmlFor="prior-art-query" className="block text-sm font-medium text-ai-graphite-700 mb-2">
                  Search query — edit freely
                </label>
                <textarea
                  id="prior-art-query"
                  className="w-full border border-paper-400 rounded-xl p-3 text-sm bg-paper-100 focus:bg-white focus:ring-2 focus:ring-ai-blue-500 focus:border-ai-blue-500"
                  rows={3}
                  value={queryText || searchQuery}
                  onChange={(e) => setQueryText(e.target.value)}
                  placeholder="Describe the invention concepts to search for..."
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm text-ai-graphite-600">
                <span>Scope:</span>
                <span className="px-2.5 py-0.5 rounded-full border border-paper-300 text-xs">
                  {filterCountries.length === 0 ? 'All offices' : `${filterCountries.length} office${filterCountries.length !== 1 ? 's' : ''}`}
                </span>
                <span className="px-2.5 py-0.5 rounded-full border border-paper-300 text-xs">
                  {afterDate || publicationDateTo || filingDateFrom || filingDateTo ? 'Date filters set' : 'Any date'}
                </span>
                <span className="px-2.5 py-0.5 rounded-full border border-paper-300 text-xs">{limit} results</span>
                <button
                  type="button"
                  onClick={() => setScopeOpen(open => !open)}
                  className="text-ai-blue-600 hover:text-ai-blue-700 font-medium"
                >
                  {scopeOpen ? 'Hide scope options' : 'Adjust scope'}
                </button>
              </div>

              {scopeOpen && (
                <div className="grid md:grid-cols-2 gap-4 p-4 bg-paper-100 rounded-xl">
                  <div className="md:col-span-2">
                    <div className="flex items-baseline justify-between mb-1">
                      <label className="block text-sm font-medium text-ai-graphite-700">Patent offices</label>
                      <span className="text-xs text-ai-graphite-500">
                        {filterCountries.length === 0 ? 'All countries' : `${filterCountries.length} selected`}
                      </span>
                    </div>
                    <p className="text-xs text-ai-graphite-500 mb-2">
                      Leave empty to search every country in the corpus. Selecting offices narrows the search — it does not re-rank.
                    </p>
                    <div className="p-2 bg-white border border-paper-400 rounded-lg space-y-2">
                      {([
                        { key: 'primary', label: 'Major offices', items: PATENT_COUNTRIES.filter(c => c.primary) },
                        { key: 'other', label: 'Other offices', items: PATENT_COUNTRIES.filter(c => !c.primary) },
                      ] as const).map(group => group.items.length ? (
                        <div key={group.key}>
                          <div className="text-[11px] uppercase tracking-wide text-ai-graphite-400 mb-1">{group.label}</div>
                          <div className={`flex flex-wrap gap-1.5 ${group.key === 'other' ? 'max-h-36 sm:max-h-28 overflow-y-auto' : ''}`}>
                            {group.items.map(country => {
                              const selectedCountry = filterCountries.includes(country.code)
                              return (
                                <button
                                  key={country.code}
                                  type="button"
                                  aria-pressed={selectedCountry}
                                  aria-label={`${country.name} (${country.code})`}
                                  title={country.name}
                                  onClick={() => setFilterCountries(prev =>
                                    prev.includes(country.code)
                                      ? prev.filter(code => code !== country.code)
                                      : [...prev, country.code]
                                  )}
                                  className={`px-3 py-1.5 sm:px-2 sm:py-1 rounded-md text-xs font-medium border transition-colors ${
                                    selectedCountry
                                      ? 'bg-ai-blue-600 text-white border-ai-blue-600'
                                      : 'bg-white text-ai-graphite-700 border-paper-400 hover:border-ai-blue-400 hover:bg-ai-blue-50'
                                  }`}
                                >
                                  {country.code}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ) : null)}
                    </div>
                    {filterCountries.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setFilterCountries([])}
                        className="mt-2 text-xs text-ai-blue-600 hover:text-ai-blue-700"
                      >
                        Clear selection (search all countries)
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-ai-graphite-700 mb-1">Published after</label>
                    <input type="date" value={afterDate} onChange={(e) => setAfterDate(e.target.value)}
                      className="w-full border border-paper-400 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ai-graphite-700 mb-1">Published before</label>
                    <input type="date" value={publicationDateTo} onChange={(e) => setPublicationDateTo(e.target.value)}
                      className="w-full border border-paper-400 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ai-graphite-700 mb-1">Filed after</label>
                    <input type="date" value={filingDateFrom} onChange={(e) => setFilingDateFrom(e.target.value)}
                      className="w-full border border-paper-400 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ai-graphite-700 mb-1">Filed before</label>
                    <input type="date" value={filingDateTo} onChange={(e) => setFilingDateTo(e.target.value)}
                      className="w-full border border-paper-400 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ai-graphite-700 mb-1">Results limit</label>
                    <select value={limit} onChange={(e) => setLimit(parseInt(e.target.value))}
                      className="w-full border border-paper-400 rounded-lg px-3 py-2 text-sm">
                      <option value={10}>10 results</option>
                      <option value={25}>25 results</option>
                      <option value={50}>50 results</option>
                      <option value={100}>100 results</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4 pt-1">
                <button
                  onClick={runSearchAndAssess}
                  disabled={running}
                  className="px-6 py-3 rounded-xl text-sm font-semibold bg-ai-blue-600 text-white hover:bg-ai-blue-700 transition-colors shadow-sm disabled:opacity-50"
                >
                  {results.length > 0 ? 'Search again and assess' : 'Search and assess prior art'}
                </button>
                <span className="text-xs text-ai-graphite-500">
                  Searches 46.2M publications, then AI-screens every result — one step.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Pipeline progress — search and assessment share one indicator. */}
        {running && (
          <div className="bg-white rounded-2xl border border-paper-300 p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="animate-pulse w-3 h-3 rounded-full bg-ai-blue-500 shrink-0"></div>
              <div className="font-medium text-ai-graphite-900">
                {phase === 'searching' ? 'Searching the patent corpus...' : 'Assessing results against your invention...'}
              </div>
            </div>
            {phase === 'assessing' && analysisProgress && (
              <>
                <div className="flex items-center justify-between text-sm text-ai-graphite-600 mb-2">
                  <span>{analysisProgress.message}</span>
                  <span>
                    {analysisProgress.total > 0
                      ? `${Math.min(100, Math.round((analysisProgress.processed / analysisProgress.total) * 100))}%`
                      : '0%'}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-paper-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-ai-blue-600 transition-all duration-500"
                    style={{
                      width: `${analysisProgress.total > 0
                        ? Math.min(100, Math.round((analysisProgress.processed / analysisProgress.total) * 100))
                        : 0}%`
                    }}
                  />
                </div>
              </>
            )}
            {phase === 'searching' && phaseMessage && (
              <div className="text-sm text-ai-graphite-500">{phaseMessage}</div>
            )}
          </div>
        )}

        {/* Triage */}
        {showTriage && (
          <div className="space-y-4">
            {/* Results without assessment yet (e.g. hydrated old session) */}
            {results.length > 0 && !hasAIReview && !running && (
              <div className="bg-ai-blue-50 rounded-2xl border border-ai-blue-100 p-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-ai-graphite-900">Assess these {results.length} results</div>
                  <p className="text-sm text-ai-graphite-600 mt-0.5">
                    The AI screens each patent for novelty risk and pre-tags it for drafting or claim comparison.
                  </p>
                </div>
                <button
                  onClick={() => void runAIReview()}
                  disabled={!runId}
                  className="px-5 py-2.5 rounded-xl bg-ai-blue-600 text-white text-sm font-semibold hover:bg-ai-blue-700 disabled:opacity-50 transition-colors"
                >
                  Start assessment
                </button>
              </div>
            )}

            {/* Risk cards double as filters — the single taxonomy display. */}
            {hasAIReview && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {(['anticipates', 'obvious', 'adjacent', 'remote'] as ThreatLevel[]).map(level => {
                    const meta = THREAT_META[level]
                    const active = riskFilter === level
                    return (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setRiskFilter(active ? null : level)}
                        aria-pressed={active}
                        className={`text-left rounded-xl border p-4 transition-all ${active ? meta.cardActive : `bg-white ${meta.card}`}`}
                      >
                        <div className={`text-2xl font-bold ${meta.number}`}>{threatCounts[level]}</div>
                        <div className="text-sm font-medium text-ai-graphite-800 mt-0.5">{meta.label}</div>
                        <div className="text-xs text-ai-graphite-500">{meta.sub}</div>
                      </button>
                    )
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ai-graphite-500">
                  <span>
                    Cards filter the list. Risky references are pre-tagged for claim comparison; safe ones for the background section.
                  </span>
                  {riskFilter && (
                    <button onClick={() => setRiskFilter(null)} className="text-ai-blue-600 hover:text-ai-blue-700 font-medium">
                      Show all
                    </button>
                  )}
                  {threatCounts.unknown > 0 && !running && (
                    <button
                      onClick={() => void runAIReview({ missingOnly: true })}
                      className="text-ai-blue-600 hover:text-ai-blue-700 font-medium"
                    >
                      {threatCounts.unknown} not assessed — retry
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Country filter on the returned results. Horizontally scrollable so a
                long list of jurisdictions never breaks the layout on a phone. */}
            {countryOptions.length > 1 && (
              <div className="-mx-1 px-1">
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  <span className="shrink-0 text-xs font-medium text-ai-graphite-500">Country</span>
                  <button
                    type="button"
                    onClick={() => setCountryFilter(null)}
                    aria-pressed={countryFilter === null}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      countryFilter === null
                        ? 'bg-ai-blue-600 border-ai-blue-600 text-white'
                        : 'bg-white border-paper-300 text-ai-graphite-600 hover:border-ai-blue-300'
                    }`}
                  >
                    All ({results.length})
                  </button>
                  {countryOptions.map(({ code, name, count }) => {
                    const active = countryFilter === code
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setCountryFilter(active ? null : code)}
                        aria-pressed={active}
                        title={name}
                        className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          active
                            ? 'bg-ai-blue-600 border-ai-blue-600 text-white'
                            : 'bg-white border-paper-300 text-ai-graphite-600 hover:border-ai-blue-300'
                        }`}
                      >
                        {code} ({count})
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* The one list: search results and manual references together. */}
            {(results.length > 0 || manualRefs.length > 0) && (
              <div className="bg-white rounded-2xl border border-paper-300 overflow-hidden">
                <div className="divide-y divide-paper-200 max-h-[640px] overflow-y-auto">
                  {filteredResults.length === 0 && results.length > 0 && (
                    <div className="p-6 text-sm text-ai-graphite-500">
                      No references match {countryFilter && riskFilter ? 'these filters' : 'this filter'}.
                    </div>
                  )}
                  {filteredResults.map((r, i) => {
                    const key = getPatentKey(r, i)
                    const details = getPatentDisplayData(r, i)
                    const analysis = getAnalysisForPatent(r)
                    const threat = (analysis?.analysisStatus === 'unknown' ? 'unknown' : (analysis?.noveltyThreat || 'unknown')) as ThreatLevel
                    const meta = THREAT_META[threat] || THREAT_META.unknown
                    const t = getTagsFor(key)
                    const isExpanded = expanded.has(key)
                    return (
                      <div key={key}>
                        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-4 sm:px-5">
                          <div className="sm:w-[84px] sm:shrink-0 sm:mt-0.5">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${meta.badge}`}>
                              {meta.badgeLabel}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-ai-graphite-900 break-words">{details.title}</div>
                            <div className="text-xs text-ai-graphite-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="font-mono break-all">{details.pn}</span>
                              <span>·</span>
                              <span>{details.sourceLabel}</span>
                              {details.score !== null && (
                                <>
                                  <span>·</span>
                                  <span>{details.score.toFixed(0)}% match</span>
                                </>
                              )}
                              <span>·</span>
                              <button
                                type="button"
                                onClick={() => toggleExpanded(key)}
                                className="text-ai-blue-600 hover:text-ai-blue-700 font-medium"
                              >
                                {isExpanded ? 'Hide analysis' : 'View analysis'}
                              </button>
                            </div>
                            {analysis?.aiSummary && !isExpanded && (
                              <p className="text-xs text-ai-graphite-600 mt-1 line-clamp-2 sm:line-clamp-1">{analysis.aiSummary}</p>
                            )}
                          </div>
                          <div className="flex gap-2 sm:gap-1.5 sm:shrink-0">
                            <TagChip on={t.background} label="Background" onClick={() => togglePatentTag(key, 'background')} />
                            <TagChip on={t.claims} label="Claims" onClick={() => togglePatentTag(key, 'claims')} />
                          </div>
                        </div>

                        {/* Mobile: align with row padding (px-4). Desktop: indent under the
                            content column — px-5 (20) + badge col (84) + gap-4 (16) = 120. */}
                        {isExpanded && (
                          <div className="px-4 pb-4 sm:pr-5 sm:pl-[120px]">
                            <div className="rounded-xl border border-paper-300 bg-white p-4 space-y-3">
                              {details.abstract && (
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ai-graphite-500 mb-1">Abstract</div>
                                  <p className="text-sm text-ai-graphite-700">{details.abstract}</p>
                                </div>
                              )}
                              {analysis?.aiSummary && (
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ai-graphite-500 mb-1">AI summary</div>
                                  <p className="text-sm text-ai-graphite-700">{analysis.aiSummary}</p>
                                </div>
                              )}
                              {analysis?.relevantParts && analysis.relevantParts.length > 0 && (
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-red-600 mb-1">Overlaps with your invention</div>
                                  <ul className="text-sm text-red-800 space-y-1">
                                    {analysis.relevantParts.map((part, idx) => (
                                      <li key={idx} className="flex items-start gap-2"><span className="text-red-400">•</span><span>{part}</span></li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {analysis?.irrelevantParts && analysis.irrelevantParts.length > 0 && (
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-green-700 mb-1">Differences</div>
                                  <ul className="text-sm text-green-800 space-y-1">
                                    {analysis.irrelevantParts.map((part, idx) => (
                                      <li key={idx} className="flex items-start gap-2"><span className="text-green-500">•</span><span>{part}</span></li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {analysis?.noveltyComparison && (
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ai-blue-600 mb-1">Novelty assessment</div>
                                  <p className="text-sm text-ai-graphite-700">{analysis.noveltyComparison}</p>
                                </div>
                              )}
                              {analysis?.failureReason && (
                                <div className="text-sm text-ai-graphite-600 bg-paper-100 rounded-lg border border-paper-300 p-3">{analysis.failureReason}</div>
                              )}
                              <div className="grid gap-2 md:grid-cols-2 text-xs text-ai-graphite-600 pt-1">
                                <div><span className="font-semibold text-ai-graphite-800">Publication: </span>{details.publicationDate || 'Not available'}</div>
                                <div><span className="font-semibold text-ai-graphite-800">Filing: </span>{details.filingDate || 'Not available'}</div>
                                <div><span className="font-semibold text-ai-graphite-800">Inventors: </span>{details.inventors.length > 0 ? details.inventors.join(', ') : 'Not available'}</div>
                                <div><span className="font-semibold text-ai-graphite-800">Assignees: </span>{details.assignees.length > 0 ? details.assignees.join(', ') : 'Not available'}</div>
                                <div><span className="font-semibold text-ai-graphite-800">CPC: </span>{details.cpcCodes.length > 0 ? details.cpcCodes.join(', ') : 'Not available'}</div>
                                <div><span className="font-semibold text-ai-graphite-800">IPC: </span>{details.ipcCodes.length > 0 ? details.ipcCodes.join(', ') : 'Not available'}</div>
                              </div>
                              {details.link && (
                                <a
                                  href={details.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center text-sm font-medium text-ai-blue-600 hover:text-ai-blue-700"
                                >
                                  View patent source
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Manual references live in the same list (hidden while any filter is active). */}
                  {!riskFilter && !countryFilter && manualRefs.map(m => <ManualRow key={m.id} m={m} />)}
                </div>
              </div>
            )}

            {/* Add a manual reference */}
            <div className="bg-white rounded-2xl border border-dashed border-paper-400 p-4">
              {!addFormOpen ? (
                <button
                  type="button"
                  onClick={() => setAddFormOpen(true)}
                  className="text-sm font-medium text-ai-blue-600 hover:text-ai-blue-700"
                >
                  + Add reference manually
                </button>
              ) : (
                <div className="space-y-3">
                  <textarea
                    className="w-full border border-paper-400 rounded-xl p-3 text-sm focus:ring-2 focus:ring-ai-blue-500 focus:border-ai-blue-500"
                    rows={3}
                    autoFocus
                    value={manualDraft}
                    onChange={(e) => setManualDraft(e.target.value)}
                    placeholder="US10999888B2 — or paste a citation or description of known prior art..."
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={addManualRef}
                      disabled={!manualDraft.trim()}
                      className="px-4 py-2 rounded-xl text-sm font-semibold bg-ai-blue-600 text-white hover:bg-ai-blue-700 disabled:opacity-50 transition-colors"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAddFormOpen(false); setManualDraft('') }}
                      className="px-4 py-2 rounded-xl text-sm font-medium text-ai-graphite-600 hover:bg-paper-100 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Sticky footer: what happens next, an explicit opt-out, and one action. */}
      {showTriage && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-sm border-t border-paper-300">
          <div className="max-w-5xl mx-auto px-4 py-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
            <div className="text-sm text-ai-graphite-600">
              <span className="font-semibold text-ai-graphite-900">{backgroundCount}</span> for background
              {' · '}
              {skipClaimRefinement ? (
                <span className="text-amber-700">
                  skipping claim refinement — your preliminary claims become the final claims
                </span>
              ) : claimsCount > 0 ? (
                <>
                  <span className="font-semibold text-ai-graphite-900">{claimsCount}</span> for claim comparison — refinement runs next
                </>
              ) : (
                <span className="text-amber-700">no claim references — claim refinement will be skipped</span>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <label
                className="flex items-start gap-2 text-sm text-ai-graphite-700 cursor-pointer select-none"
                title="Go straight to drafting using the claims you already have. Anything you tagged for claim comparison is still saved."
              >
                <input
                  type="checkbox"
                  checked={skipClaimRefinement}
                  onChange={e => setSkipClaimRefinement(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-paper-400 text-ai-blue-600 focus:ring-ai-blue-500"
                />
                <span>
                  Skip claim refinement
                  <span className="block text-xs text-ai-graphite-500">
                    I&apos;m happy with my current claims
                  </span>
                </span>
              </label>
              <button
                onClick={handleContinue}
                disabled={continuing || running || (!hasAIReview && manualRefs.length === 0)}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-sm font-semibold bg-ai-blue-600 text-white hover:bg-ai-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {continuing ? 'Saving...' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Idea bank floating panel (unchanged behavior, sits above the footer) */}
      {ideaBank.length > 0 && ideaBankOpen && (
        <div className="fixed bottom-20 right-4 left-4 sm:left-auto sm:w-96 max-h-[60vh] sm:max-h-[500px] bg-white rounded-xl shadow-2xl border border-paper-300 overflow-hidden z-50">
          <div className="bg-amber-500 text-white px-4 py-3 flex items-center justify-between">
            <h4 className="font-semibold">Idea Bank ({ideaBank.length})</h4>
            <button onClick={() => setIdeaBankOpen(false)} className="text-white/80 hover:text-white text-lg leading-none">×</button>
          </div>
          <div className="max-h-[400px] overflow-y-auto p-4 space-y-3">
            {ideaBank.map((ideaItem, i) => (
              <div key={i} className="bg-amber-50 rounded-lg p-3 border border-amber-100">
                <div className="font-medium text-ai-graphite-900 text-sm">{ideaItem.title}</div>
                <div className="text-xs text-ai-graphite-600 mt-1">{ideaItem.core_principle}</div>
                {ideaItem.tags && ideaItem.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {ideaItem.tags.map((tag, j) => (
                      <span key={j} className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px]">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {ideaBank.length > 0 && !ideaBankOpen && (
        <button
          onClick={() => setIdeaBankOpen(true)}
          className="fixed bottom-20 right-4 px-4 py-2.5 bg-amber-500 text-white rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center gap-2 z-50"
        >
          <span className="font-medium text-sm">Idea Bank</span>
          <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">{ideaBank.length}</span>
        </button>
      )}
    </div>
  )
})

RelatedArtStage.displayName = 'RelatedArtStage'

export default RelatedArtStage
