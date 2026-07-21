'use client'

// Prior-Art Studio shell: sessions, Quick/Studio density modes, Copilot draft,
// runs with the gate funnel, result refinement, keyboard triage, the reader,
// the element grid, evidence trail and report download.
//
// Human-nature rules baked in: AI is opt-in and visible, every control has a
// mouse path and a key, help lives in ? icons, and no screen is a dead end.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Zap,
  ClipboardCopy,
  FileSpreadsheet,
  HelpCircle,
  Keyboard,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  ScrollText,
  Sparkles,
  X,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { Hint } from '@/components/ui/hint'
import { resolvePatentLink } from '@/lib/prior-art-studio/patent-links'
import {
  type StudioDocTag,
  type StudioPlan,
  type StudioResultFamily,
  type StudioRunPayload,
  type StudioSaturation,
  type StudioTheoryPayload,
  type StudioTrailEntryPayload,
} from '@/lib/prior-art-studio/types'
import { QueryCanvas } from './QueryCanvas'
import { GatesFunnel } from './GatesFunnel'
import { ResultsList, type DocStateLite } from './ResultsList'
import { ResultsFilterBar, DEFAULT_RESULT_FILTERS, applyResultFilters, type ResultFilters } from './ResultsFilterBar'
import { DocumentReader } from './DocumentReader'
import { ElementGrid } from './ElementGrid'
import { TrailPanel } from './TrailPanel'
import { OnboardingCoach } from './OnboardingCoach'

const ONBOARDING_KEY = 'pas_onboarding_done'
const MODE_KEY = 'pas_mode'
const RAIL_KEY = 'pas_rail_collapsed'

type Mode = 'quick' | 'studio'
type MainTab = 'results' | 'grid' | 'trail'

interface SessionSummary {
  id: string
  title: string
  planVersion: number
  updatedAt: string
  createdAt: string
  _count?: { runs: number; docStates: number }
}

interface ActiveSession {
  id: string
  title: string
  plan: StudioPlan
  planVersion: number
  seedText?: string | null
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/prior-art-studio${path}`, { ...init, headers: { ...authHeaders(), ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`)
  return payload as T
}

let trailIdCounter = 0
function localTrailEntry(kind: string, summary: string, actor = 'user:you'): StudioTrailEntryPayload {
  trailIdCounter += 1
  return { id: `local-${Date.now()}-${trailIdCounter}`, kind, actor, summary, createdAt: new Date().toISOString() }
}

export function StudioApp() {
  const { user, isLoading: authLoading } = useAuth()
  const { toast } = useToast()

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [active, setActive] = useState<ActiveSession | null>(null)
  const [run, setRun] = useState<StudioRunPayload | null>(null)
  const [docStates, setDocStates] = useState<Record<string, DocStateLite>>({})
  const [trail, setTrail] = useState<StudioTrailEntryPayload[]>([])
  const [theories, setTheories] = useState<StudioTheoryPayload[]>([])
  const [saturation, setSaturation] = useState<StudioSaturation | null>(null)
  const [booleanPreview, setBooleanPreview] = useState('')

  const [mode, setMode] = useState<Mode>('studio')
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [mainTab, setMainTab] = useState<MainTab>('results')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showKeys, setShowKeys] = useState(false)
  const [disclosure, setDisclosure] = useState('')
  const [cursor, setCursor] = useState(0)
  const [filters, setFilters] = useState<ResultFilters>(DEFAULT_RESULT_FILTERS)
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [readerFamily, setReaderFamily] = useState<StudioResultFamily | null>(null)

  const [drafting, setDrafting] = useState(false)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [runDepth, setRunDepth] = useState<'deep' | 'fast'>('deep')
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [pinning, setPinning] = useState(false)
  const savingRef = useRef(false)

  // Elapsed-seconds ticker for the deep-search progress narrative. Seeded from
  // the run's server start time so a resumed poll doesn't restart at 0s.
  useEffect(() => {
    if (!running) {
      setElapsed(0)
      return
    }
    const startedAt = runStartedAt ?? Date.now()
    setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    const timer = setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))), 1000)
    return () => clearInterval(timer)
  }, [running, runStartedAt])

  // ------------------------------------------------------------------ setup
  useEffect(() => {
    if (typeof window === 'undefined') return
    const storedMode = localStorage.getItem(MODE_KEY)
    setMode(storedMode === 'quick' || storedMode === 'studio' ? storedMode : 'studio')
    setRailCollapsed(localStorage.getItem(RAIL_KEY) === '1')
    if (!localStorage.getItem(ONBOARDING_KEY)) setShowOnboarding(true)
  }, [])

  const closeOnboarding = () => {
    setShowOnboarding(false)
    localStorage.setItem(ONBOARDING_KEY, '1')
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    localStorage.setItem(MODE_KEY, next)
  }

  /** Collapse the plan rail to give the results the full width (key: [). */
  const toggleRail = useCallback(() => {
    setRailCollapsed(current => {
      const next = !current
      localStorage.setItem(RAIL_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  useEffect(() => {
    if (!user) return
    api<{ sessions: SessionSummary[] }>('/sessions')
      .then(data => setSessions(data.sessions))
      .catch(err => toast({ title: 'Could not load sessions', description: err.message, variant: 'error' }))
  }, [user, toast])

  // ------------------------------------------------------------- session io
  /** Poll a background run until it completes or fails. Tolerates transient network blips. */
  const pollRun = useCallback(async (sessionId: string, runId: string): Promise<StudioRunPayload> => {
    let consecutiveErrors = 0
    for (let attempt = 0; attempt < 150; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      try {
        const data = await api<{ status: 'RUNNING' | 'COMPLETE' | 'FAILED'; error?: string; run?: StudioRunPayload }>(
          `/sessions/${sessionId}/runs/${runId}`
        )
        consecutiveErrors = 0
        if (data.status === 'COMPLETE' && data.run) return data.run
        if (data.status === 'FAILED') throw new Error(data.error || 'The search failed on the server.')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // A FAILED status is final; a fetch hiccup is not — retry a few times.
        if (message && !message.startsWith('Failed to fetch') && !message.startsWith('NetworkError') && !message.includes('Request failed (5')) throw err
        consecutiveErrors += 1
        if (consecutiveErrors >= 3) throw err
      }
    }
    throw new Error('The search is taking unusually long — reload the page to check its status.')
  }, [])

  /** Shared landing path for a finished run — used by execute() and the resume-after-refresh poll. */
  const finishRun = useCallback(
    (run: StudioRunPayload, depth: 'deep' | 'fast') => {
      setRun(run)
      setCursor(0)
      setFilters(current => ({ ...DEFAULT_RESULT_FILTERS, sort: current.sort }))
      setReaderFamily(null)
      setTrail(t => [
        localTrailEntry(
          'RUN',
          `${depth === 'deep' ? 'Deep search' : 'Fast scan'} v${run.planVersion} (${run.planHash}): ${run.gateCounts.recall.toLocaleString()} recall → ${run.gateCounts.families.toLocaleString()} families → ${run.gateCounts.shown} shown`
        ),
        ...t,
      ])
      if (run.families.length === 0) {
        toast({
          title: 'Search returned no documents',
          description: run.warnings[0] || 'See the explanation above the results.',
          variant: 'error',
        })
      } else if (run.warnings.length) {
        toast({ title: 'Run finished with notes', description: run.warnings[0] })
      }
    },
    [toast]
  )

  const openSession = useCallback(
    async (sessionId: string) => {
      try {
        const data = await api<{
          session: ActiveSession
          latestRun: {
            id: string
            planVersion: number
            planHash: string
            createdAt: string
            gateCounts: StudioRunPayload['gateCounts']
            gateDetail?: StudioRunPayload['gateDetail'] | null
            suggestedTerms?: string[] | null
            results: StudioResultFamily[]
            warnings?: string[]
            newFamilyCount: number
            durationMs?: number
          } | null
          activeRun: { id: string; depth: 'deep' | 'fast'; createdAt: string } | null
          docStates: Array<{ familyKey: string; tag?: StudioDocTag | null; excluded: boolean }>
          trail: StudioTrailEntryPayload[]
          theories: StudioTheoryPayload[]
          saturation: StudioSaturation
          booleanPreview: string
        }>(`/sessions/${sessionId}`)
        setActive(data.session)
        setBooleanPreview(data.booleanPreview)
        setTrail(data.trail)
        setTheories(data.theories || [])
        setSaturation(data.saturation || null)
        setDocStates(Object.fromEntries(data.docStates.map(s => [s.familyKey, { tag: s.tag, excluded: s.excluded }])))
        setRun(
          data.latestRun
            ? {
                runId: data.latestRun.id,
                planVersion: data.latestRun.planVersion,
                planHash: data.latestRun.planHash,
                createdAt: data.latestRun.createdAt,
                gateCounts: data.latestRun.gateCounts,
                gateDetail: data.latestRun.gateDetail || undefined,
                suggestedTerms: data.latestRun.suggestedTerms || undefined,
                families: data.latestRun.results || [],
                warnings: data.latestRun.warnings || [],
                newFamilyCount: data.latestRun.newFamilyCount || 0,
                durationMs: data.latestRun.durationMs || 0,
                booleanPreview: '',
              }
            : null
        )
        setCursor(0)
        setFilters(DEFAULT_RESULT_FILTERS)
        setReaderFamily(null)
        setMainTab('results')
        setDisclosure(data.session.seedText || '')

        // A search is still running server-side (page was refreshed or reopened
        // mid-run) — resume the poll instead of losing it.
        if (data.activeRun) {
          const { id: runId, depth, createdAt } = data.activeRun
          setRunDepth(depth)
          setRunStartedAt(new Date(createdAt).getTime())
          setRunning(true)
          pollRun(sessionId, runId)
            .then(run => finishRun(run, depth))
            .catch(err =>
              toast({ title: 'Run failed', description: err instanceof Error ? err.message : String(err), variant: 'error' })
            )
            .finally(() => {
              setRunning(false)
              setRunStartedAt(null)
            })
        }
      } catch (err) {
        toast({ title: 'Could not open session', description: err instanceof Error ? err.message : String(err), variant: 'error' })
      }
    },
    [toast, pollRun, finishRun]
  )

  const createSession = async () => {
    try {
      const data = await api<{ session: { id: string } }>('/sessions', { method: 'POST', body: JSON.stringify({}) })
      await openSession(data.session.id)
      setSessions(null)
    } catch (err) {
      toast({ title: 'Could not create session', description: err instanceof Error ? err.message : String(err), variant: 'error' })
    }
  }

  const savePlan = useCallback(
    async (nextPlan: StudioPlan, editSummary: string) => {
      if (!active || savingRef.current) {
        if (savingRef.current) toast({ title: 'Still saving the previous edit — try again in a second.', variant: 'error' })
        return
      }
      const prev = active
      setActive({ ...active, plan: nextPlan })
      setTrail(t => [localTrailEntry('EDIT', editSummary), ...t])
      savingRef.current = true
      try {
        const data = await api<{ session: { planVersion: number }; booleanPreview: string }>(`/sessions/${active.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ plan: nextPlan, editSummary }),
        })
        setActive(current => (current ? { ...current, planVersion: data.session.planVersion } : current))
        setBooleanPreview(data.booleanPreview)
      } catch (err) {
        setActive(prev)
        toast({ title: 'Edit not saved', description: err instanceof Error ? err.message : String(err), variant: 'error' })
      } finally {
        savingRef.current = false
      }
    },
    [active, toast]
  )

  const saveTitle = async (title: string) => {
    if (!active || !title.trim() || title === active.title) return
    setActive({ ...active, title })
    try {
      await api(`/sessions/${active.id}`, { method: 'PATCH', body: JSON.stringify({ title }) })
    } catch {
      /* non-critical */
    }
  }

  // ---------------------------------------------------------------- actions
  const draft = async () => {
    if (!active) return
    if (disclosure.trim().length < 40) {
      toast({
        title: 'Add a few sentences first',
        description: 'Describe what the invention does and how — the generator drafts the search from your words.',
        variant: 'error',
      })
      return
    }
    setDrafting(true)
    try {
      const data = await api<{ plan: StudioPlan; planVersion: number; title: string; booleanPreview: string; modelCode?: string }>(
        `/sessions/${active.id}/draft`,
        { method: 'POST', body: JSON.stringify({ disclosure }) }
      )
      setActive({ ...active, plan: data.plan, planVersion: data.planVersion, title: data.title })
      setBooleanPreview(data.booleanPreview)
      setTrail(t => [
        localTrailEntry('COPILOT', `Drafted ${data.plan.blocks.length} concept blocks — review the dashed chips, then run`, `model:${data.modelCode || 'ai'}`),
        ...t,
      ])
      toast({ title: 'Search drafted', description: 'Nothing has run yet. Accept or reject the dashed suggestions, then press Run.', variant: 'success' })
    } catch (err) {
      toast({ title: 'Draft failed', description: err instanceof Error ? err.message : String(err), variant: 'error' })
    } finally {
      setDrafting(false)
    }
  }

  const execute = useCallback(async (depth: 'deep' | 'fast' = 'deep') => {
    if (!active || running) return
    const hasActive = active.plan.blocks.some(b => b.terms.some(t => t.accepted)) || active.plan.cpc.some(c => c.accepted)
    if (!hasActive) {
      toast({ title: 'Nothing to run yet', description: 'Accept at least one term (dashed chips are inert suggestions) or add your own.', variant: 'error' })
      return
    }
    setRunDepth(depth)
    setRunning(true)
    setRunStartedAt(Date.now())
    try {
      // The run executes in the background on the server (deep searches outlive
      // proxy timeouts); this POST only starts it, then we poll for the result.
      const response = await fetch(`/api/prior-art-studio/sessions/${active.id}/run`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ depth }),
      })
      const payload = await response.json().catch(() => ({}))
      let runId: string
      if (response.status === 409 && payload?.runId) {
        runId = payload.runId // a run is already in flight (second tab / lost response) — adopt it
      } else if (!response.ok || !payload?.runId) {
        throw new Error(payload?.error || `Request failed (${response.status})`)
      } else {
        runId = payload.runId
      }
      const run = await pollRun(active.id, runId)
      finishRun(run, depth)
    } catch (err) {
      toast({ title: 'Run failed', description: err instanceof Error ? err.message : String(err), variant: 'error' })
    } finally {
      setRunning(false)
      setRunStartedAt(null)
    }
  }, [active, running, toast, pollRun, finishRun])

  const setDocState = useCallback(
    async (family: StudioResultFamily, patch: Partial<DocStateLite>) => {
      if (!active) return
      setDocStates(current => ({ ...current, [family.familyKey]: { ...current[family.familyKey], ...patch } }))
      const label =
        patch.tag !== undefined
          ? patch.tag
            ? `Tagged ${family.publicationNumber}: ${patch.tag.toLowerCase().replace('_', ' ')}`
            : `Cleared tag on ${family.publicationNumber}`
          : patch.excluded
            ? `Excluded family of ${family.publicationNumber}`
            : `Restored family of ${family.publicationNumber}`
      setTrail(t => [localTrailEntry('TAG', label), ...t])
      try {
        const data = await api<{ saturation: StudioSaturation; familyAssessment?: StudioResultFamily }>(`/sessions/${active.id}/docs`, {
          method: 'POST',
          body: JSON.stringify({ familyKey: family.familyKey, publicationNumber: family.publicationNumber, ...patch }),
        })
        if (data.saturation) setSaturation(data.saturation)
        if (data.familyAssessment) {
          setRun(current => current ? {
            ...current,
            families: current.families.map(item =>
              item.familyKey === data.familyAssessment!.familyKey ? data.familyAssessment! : item
            ),
          } : current)
          setReaderFamily(current =>
            current?.familyKey === data.familyAssessment!.familyKey ? data.familyAssessment! : current
          )
        }
      } catch (err) {
        toast({ title: 'Mark not saved', description: err instanceof Error ? err.message : String(err), variant: 'error' })
      }
    },
    [active, toast]
  )

  /** Steering lives on the canvas: visible, weighted, removable. */
  const steerFrom = useCallback(
    (family: StudioResultFamily) => {
      if (!active) return
      const current = active.plan.steer
      const pubs = Array.from(new Set([...(current?.publicationNumbers || []), family.publicationNumber])).slice(0, 8)
      const next: StudioPlan = {
        ...active.plan,
        steer: { enabled: true, publicationNumbers: pubs, weight: current?.weight ?? 0.3 },
      }
      savePlan(next, `Steering: added ${family.publicationNumber} (${pubs.length} document${pubs.length === 1 ? '' : 's'})`)
      toast({ title: 'Added to steering', description: 'It appears on the canvas as a removable block. Re-run to apply.', variant: 'success' })
    },
    [active, savePlan, toast]
  )

  const harvestTerms = useCallback(
    (terms: string[]) => {
      if (!active) return
      const plan: StudioPlan = JSON.parse(JSON.stringify(active.plan))
      const target = plan.blocks.find(b => b.mode !== 'EXPAND') || plan.blocks[0]
      if (!target) {
        toast({ title: 'Add a concept block first', variant: 'error' })
        return
      }
      let added = 0
      for (const term of terms) {
        if (target.terms.some(t => t.text.toLowerCase() === term.toLowerCase())) continue
        target.terms.push({ text: term, origin: 'copilot', accepted: false })
        added += 1
      }
      if (!added) {
        toast({ title: 'Those terms are already on the canvas' })
        return
      }
      savePlan(plan, `Harvested ${added} term(s) from meaning-only hits into “${target.label}” (pending your approval)`)
      toast({
        title: `${added} terms added as suggestions`,
        description: 'They are dashed chips — accept the ones you want, then re-run.',
        variant: 'success',
      })
    },
    [active, savePlan, toast]
  )

  const pinTheory = useCallback(
    async (input: {
      kind: 'ANTICIPATION' | 'COMBINATION'
      publicationNumbers: string[]
      familyKeys: string[]
      motivation: string
      elementCoverage?: unknown
    }) => {
      if (!active) return
      setPinning(true)
      try {
        const data = await api<{ theory: StudioTheoryPayload }>(`/sessions/${active.id}/theories`, {
          method: 'POST',
          body: JSON.stringify(input),
        })
        setTheories(t => [data.theory, ...t])
        setTrail(t => [
          localTrailEntry('NOTE', `${input.kind === 'ANTICIPATION' ? '§102' : '§103'} theory pinned: ${input.publicationNumbers.join(' + ')}`),
          ...t,
        ])
        toast({ title: 'Theory pinned', description: 'It will appear in the compiled search report.', variant: 'success' })
      } catch (err) {
        toast({ title: 'Could not pin', description: err instanceof Error ? err.message : String(err), variant: 'error' })
      } finally {
        setPinning(false)
      }
    },
    [active, toast]
  )

  const removeTheory = useCallback(
    async (theoryId: string) => {
      if (!active) return
      setTheories(t => t.filter(x => x.id !== theoryId))
      try {
        await api(`/sessions/${active.id}/theories?theoryId=${encodeURIComponent(theoryId)}`, { method: 'DELETE' })
      } catch (err) {
        toast({ title: 'Could not remove', description: err instanceof Error ? err.message : String(err), variant: 'error' })
      }
    },
    [active, toast]
  )

  const downloadReport = async () => {
    if (!active) return
    setReportLoading(true)
    try {
      const response = await fetch(`/api/prior-art-studio/sessions/${active.id}/report`, { headers: authHeaders() })
      if (!response.ok) throw new Error('Report generation failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Search-Report_${active.title.replace(/[^A-Za-z0-9-_ ]/g, '').slice(0, 40) || 'session'}.docx`
      link.click()
      URL.revokeObjectURL(url)
      toast({ title: 'Report downloaded', variant: 'success' })
    } catch (err) {
      toast({ title: 'Report failed', description: err instanceof Error ? err.message : String(err), variant: 'error' })
    } finally {
      setReportLoading(false)
    }
  }

  /** Excel workbook of the tagged shortlist (Relevant + Maybe) for client sharing. */
  const downloadExcel = async () => {
    if (!active) return
    setExportLoading(true)
    try {
      const response = await fetch(`/api/prior-art-studio/sessions/${active.id}/export`, { headers: authHeaders() })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error || 'Excel export failed')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Prior-Art_${active.title.replace(/[^A-Za-z0-9-_ ]/g, '').slice(0, 40) || 'session'}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
      toast({ title: 'Excel exported', description: 'Contains the Relevant + Maybe shortlist with feature comparisons.', variant: 'success' })
    } catch (err) {
      toast({ title: 'Excel export failed', description: err instanceof Error ? err.message : String(err), variant: 'error' })
    } finally {
      setExportLoading(false)
    }
  }

  // -------------------------------------------------------------- filtering
  const allFamilies = useMemo(() => run?.families || [], [run])
  const visibleFamilies = useMemo(
    () => applyResultFilters(allFamilies, docStates, filters),
    [allFamilies, docStates, filters]
  )

  useEffect(() => {
    if (cursor >= visibleFamilies.length) setCursor(Math.max(0, visibleFamilies.length - 1))
  }, [visibleFamilies.length, cursor])

  // --------------------------------------------------------------- keyboard
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (!active) return
      if (event.key === '?') {
        setShowKeys(v => !v)
        return
      }
      if (event.key === '[' && mode === 'studio') {
        toggleRail()
        event.preventDefault()
        return
      }
      if (mainTab !== 'results' || !visibleFamilies.length) return
      const family = visibleFamilies[cursor]
      if (event.key === 'j') setCursor(c => Math.min(c + 1, visibleFamilies.length - 1))
      else if (event.key === 'k') setCursor(c => Math.max(c - 1, 0))
      else if (event.key === 'Enter' && family) setReaderFamily(family)
      else if (event.key === 'o' && family) {
        window.open(resolvePatentLink(family), '_blank')
      } else if (event.key === 'x' && family) setDocState(family, { excluded: !docStates[family.familyKey]?.excluded })
      else if (family && (event.key === '1' || event.key === '2' || event.key === '3')) {
        const tag: StudioDocTag = event.key === '1' ? 'RELEVANT' : event.key === '2' ? 'MAYBE' : 'NOT_RELEVANT'
        setDocState(family, { tag: docStates[family.familyKey]?.tag === tag ? null : tag })
        setCursor(c => Math.min(c + 1, visibleFamilies.length - 1))
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, visibleFamilies, cursor, docStates, setDocState, mainTab, mode, toggleRail])

  // ----------------------------------------------------------------- render
  if (authLoading) return <div className="p-10 text-sm text-muted-foreground">Loading Advanced Search Studio…</div>
  if (!user) return <div className="p-10 text-sm text-muted-foreground">Please log in to use Advanced Search Studio.</div>

  if (!active) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        {showOnboarding && <OnboardingCoach onClose={closeOnboarding} />}
        <div className="mb-6 flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Advanced Search Studio</h1>
          <button type="button" className="text-muted-foreground hover:text-foreground" title="Show the 30-second introduction again" onClick={() => setShowOnboarding(true)}>
            <HelpCircle className="h-4 w-4" />
          </button>
          <button type="button" onClick={createSession} className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> New search
          </button>
        </div>
        <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
          Manual patent searching with the boring parts automated: describe the invention, approve the AI-drafted query,
          watch the funnel, tag results like an inbox, and leave with a defensible search report.
        </p>
        {sessions === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your sessions…
          </div>
        ) : sessions.length === 0 ? (
          <button type="button" onClick={createSession} className="w-full rounded-xl border-2 border-dashed border-border bg-card p-10 text-center hover:border-primary/50">
            <Sparkles className="mx-auto mb-3 h-6 w-6 text-primary" />
            <div className="text-sm font-semibold text-foreground">Start your first search</div>
            <div className="mt-1 text-xs text-muted-foreground">You’ll paste a short description of the invention — the query is drafted for you.</div>
          </button>
        ) : (
          <div className="space-y-2">
            {sessions.map(session => (
              <button key={session.id} type="button" onClick={() => openSession(session.id)} className="flex w-full items-baseline gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left hover:border-primary/60">
                <span className="text-sm font-semibold text-foreground">{session.title}</span>
                <span className="text-xs text-muted-foreground">
                  plan v{session.planVersion}
                  {session._count ? ` · ${session._count.runs} runs · ${session._count.docStates} marks` : ''}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">{new Date(session.updatedAt).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const seedCard = (
    <div className="rounded-xl border border-border bg-gradient-to-b from-card to-paper-100/70 p-4 shadow-sm dark:to-card">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-lamp-100 text-lamp-700 dark:bg-lamp-900/60 dark:text-lamp-300">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-semibold text-foreground">Describe the invention</span>
        <Hint
          title="This replaces hours of query writing"
          text="Write plainly — what it is, what it does, what makes it different. The generator turns this into concept blocks, synonyms, patentese variants, claim elements and CPC codes. You approve every suggestion before anything runs."
        />
      </div>
      <textarea
        value={disclosure}
        onChange={e => setDisclosure(e.target.value)}
        rows={mode === 'quick' ? 5 : 3}
        placeholder="e.g. A surgical screwdriver for bone screws with a clutch that slips at a preset torque, clicks audibly, re-engages by itself, and has a one-piece sterilizable housing…"
        className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm leading-relaxed text-foreground shadow-inner transition-colors placeholder:text-muted-foreground/60 focus:border-lamp-500 focus:outline-none focus:ring-2 focus:ring-lamp-500/30"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={draft}
          disabled={drafting || running}
          className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-3.5 py-2 text-sm font-semibold text-blue-700 shadow-sm transition-all hover:bg-blue-100 hover:shadow disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
        >
          {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {drafting ? 'Drafting your search…' : active.plan.blocks.length ? 'Re-draft from description' : 'Draft my search'}
        </button>
        <span className="text-xs text-muted-foreground">≈10 seconds · suggestions stay inert until you accept them</span>
      </div>
    </div>
  )

  // Paced narrative for the deep search. The stages mirror the real pipeline
  // order; an attorney who reads them learns what the engine actually does.
  const DEEP_STAGES: Array<[number, string]> = [
    [0, 'Compiling your plan and embedding its concepts…'],
    [3, 'Casting meaning probes across 29.8M patent-family vectors…'],
    [10, 'Retrieving candidates from the Indian and worldwide corpora…'],
    [18, 'Collapsing duplicate filings into families…'],
    [24, 'Applying your MATCH requirements and exclusions, word by word…'],
    [30, 'Fusing lanes and ordering the strongest candidates…'],
    ...((active?.plan.elements.length ?? 0) > 0
      ? ([[38, 'Scoring claim elements against the shortlist…']] as Array<[number, string]>)
      : []),
    [48, 'Still working — deep searches over 45M documents can take up to a minute. Thorough beats fast.'],
  ]
  const currentStage = DEEP_STAGES.reduce((acc, [at, msg]) => (elapsed >= at ? msg : acc), DEEP_STAGES[0][1])

  const progressCard = running ? (
    <div className="rounded-xl border border-lamp-300 bg-lamp-50/70 p-4 shadow-sm dark:border-lamp-800 dark:bg-lamp-950/30" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-lamp-600 text-white dark:bg-lamp-500 dark:text-lamp-950">
          <Loader2 className="h-4.5 w-4.5 animate-spin" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{runDepth === 'deep' ? 'Deep search' : 'Fast scan'} in progress · {elapsed}s</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{currentStage}</p>
        </div>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-lamp-200/70 dark:bg-lamp-900">
        <div
          className="h-full rounded-full bg-lamp-600 transition-all duration-1000 dark:bg-lamp-400"
          style={{ width: `${Math.min(94, 8 + elapsed * 1.6)}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {runDepth === 'deep'
          ? 'Searching both corpora with full probe budgets — every gate will be counted when it lands.'
          : 'Quick look with reduced budgets — run a Deep search before relying on the numbers.'}
      </p>
    </div>
  ) : null

  const resultsPane = (
    <div className="space-y-3">
      {progressCard}
      {run && run.warnings.length > 0 && (
        <div
          className={`rounded-lg border p-3 text-xs ${
            run.families.length === 0
              ? 'border-red-400 bg-red-50 dark:border-red-800 dark:bg-red-950/30'
              : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/25'
          }`}
          role="status"
        >
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            {run.families.length === 0 ? 'This search presented no documents' : 'This run needs your attention'}
          </div>
          <ul className="space-y-1 text-muted-foreground">
            {run.warnings.map((warning, i) => (
              <li key={i}>• {warning}</li>
            ))}
          </ul>
          {run.families.length === 0 && (
            <p className="mt-2 text-muted-foreground">
              Nothing here says anything about the state of the art — retrieval itself returned nothing. Usual causes:
              date/CPC filters too narrow for this technology, or the meaning lane unavailable (see the warnings above).
              Widen the filters or wording and run again.
            </p>
          )}
        </div>
      )}
      {run && (
        <ResultsFilterBar
          filters={filters}
          onChange={setFilters}
          families={allFamilies}
          shownCount={visibleFamilies.length}
          newFamilyCount={run.newFamilyCount}
          expanded={filtersExpanded}
          onToggleExpanded={setFiltersExpanded}
        />
      )}
      {run ? (
        <div className={running ? 'pointer-events-none opacity-50 transition-opacity' : 'transition-opacity'}>
        <ResultsList
          families={visibleFamilies}
          totalCount={allFamilies.length}
          elements={active.plan.elements}
          docStates={docStates}
          cursor={cursor}
          onCursorChange={setCursor}
          onTag={(family, tag) => setDocState(family, { tag })}
          onExclude={(family, excluded) => setDocState(family, { excluded })}
          onOpenReader={setReaderFamily}
          openFamilyKey={readerFamily?.familyKey}
          readerElement={
            readerFamily ? (
              <DocumentReader
                family={readerFamily}
                elements={active.plan.elements}
                onClose={() => setReaderFamily(null)}
                onSteerFrom={steerFrom}
                authHeaders={authHeaders}
              />
            ) : null
          }
          saturation={saturation}
        />
        </div>
      ) : (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-card/50 px-8 py-14 text-center">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-lamp-100 text-lamp-700 dark:bg-lamp-900/60 dark:text-lamp-300">
            {active.plan.blocks.length ? <Play className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
          </span>
          <p className="text-sm font-semibold text-foreground">
            {active.plan.blocks.length ? 'Ready to search' : 'Start with the invention'}
          </p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {active.plan.blocks.length
              ? 'Press Run search to fill the funnel and get your first ranked, family-grouped results.'
              : 'Describe it above and press “Draft my search” — or add concept blocks by hand if you prefer to build the query yourself.'}
          </p>
        </div>
      )}
    </div>
  )

  return (
    // Full-height workspace: header and funnel stay put, the panes scroll.
    // A triage tool must keep its instruments visible while the list moves.
    <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-paper-200/60 dark:bg-background lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      {showOnboarding && <OnboardingCoach onClose={closeOnboarding} />}

      {/* ---- command bar -------------------------------------------------- */}
      <header className="shrink-0 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 lg:px-6">
          <button
            type="button"
            onClick={() => {
              setActive(null)
              setRun(null)
              api<{ sessions: SessionSummary[] }>('/sessions').then(d => setSessions(d.sessions)).catch(() => {})
            }}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Sessions</span>
          </button>

          <div className="h-5 w-px bg-border" aria-hidden />

          <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
            <input
              defaultValue={active.title}
              key={active.id + active.title}
              onBlur={e => saveTitle(e.target.value.trim())}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-[17px] font-semibold tracking-tight text-foreground transition-colors hover:border-border focus:border-border focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Search title"
            />
            <span className="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
              v{active.planVersion}
            </span>
          </div>

          <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-0.5" role="group" aria-label="Layout density">
            {(['quick', 'studio'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition-all ${
                  mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m}
              </button>
            ))}
            <Hint
              className="mx-0.5 self-center"
              title="Quick vs Studio"
              text="Quick is a single guided column — describe, approve, run, review. Studio adds the canvas rail, the element grid and the evidence trail. Same engine, same session — switch anytime."
            />
          </div>

          {mode === 'studio' && (
            <button
              type="button"
              onClick={toggleRail}
              title={railCollapsed ? 'Show the search plan (key [)' : 'Hide the search plan (key [)'}
              aria-label={railCollapsed ? 'Show the search plan' : 'Hide the search plan'}
              aria-controls="studio-search-plan"
              aria-expanded={!railCollapsed}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {railCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              <span className="hidden xl:inline">{railCollapsed ? 'Show search plan' : 'Hide search plan'}</span>
            </button>
          )}

          <button
            type="button"
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
            onClick={() => setShowKeys(v => !v)}
            className={`hidden rounded-md p-1.5 transition-colors sm:block ${showKeys ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <Keyboard className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Show the introduction again"
            aria-label="Show the introduction"
            onClick={() => setShowOnboarding(true)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={downloadReport}
            disabled={reportLoading}
            title="Compile the search report (DOCX)"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {reportLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScrollText className="h-3.5 w-3.5" />}
            <span className="hidden md:inline">Report</span>
          </button>
          <button
            type="button"
            onClick={downloadExcel}
            disabled={exportLoading}
            title="Export tagged patents (Relevant + Maybe) as a spreadsheet — details, abstracts, feature comparison, claims"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {exportLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
            <span className="hidden md:inline">Excel</span>
          </button>
          <div className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => execute('fast')}
              disabled={running || drafting}
              className="inline-flex items-center gap-1.5 rounded-md border border-lamp-300 bg-card px-3 py-2 text-sm font-semibold text-lamp-700 transition-colors hover:bg-lamp-50 disabled:opacity-50 dark:border-lamp-800 dark:text-lamp-300 dark:hover:bg-lamp-950/40"
              title="Fast scan (~5-10s): a quick look with reduced probe budgets — for iterating on the canvas"
            >
              <Zap className="h-4 w-4" />
              <span className="hidden xl:inline">Fast scan</span>
            </button>
            <button
              type="button"
              onClick={() => execute('deep')}
              disabled={running || drafting}
              className="inline-flex items-center gap-1.5 rounded-md bg-lamp-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-lamp-700 hover:shadow disabled:opacity-50 dark:bg-lamp-500 dark:hover:bg-lamp-400 dark:text-lamp-950"
              title="Deep search (30-60s): full probe budgets and extended timeouts across all 45M documents — for the search of record"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? `${runDepth === 'deep' ? 'Deep search' : 'Fast scan'} · ${elapsed}s` : 'Deep search'}
            </button>
            <Hint
              className="self-center"
              title="Fast scan vs Deep search"
              text="Fast scan (~5-10s) uses reduced budgets — perfect while you iterate on terms and blocks. Deep search (30-60s) runs full probe budgets and extended timeouts across the whole corpus, and is what belongs in your report. Both are recorded on the trail with their depth."
            />
          </div>
        </div>

        {showKeys && (
          <div className="hidden flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground sm:flex lg:px-6">
            {[
              ['j / k', 'move'],
              ['1', 'relevant'],
              ['2', 'maybe'],
              ['3', 'not relevant'],
              ['x', 'exclude family'],
              ['Enter', 'read document'],
              ['o', 'open on Google Patents'],
              ['[', 'hide / show plan panel'],
              ['?', 'hide this bar'],
            ].map(([key, label]) => (
              <span key={key} className="inline-flex items-center gap-1.5">
                <kbd className="rounded border border-border border-b-2 bg-card px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                  {key}
                </kbd>
                {label}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* ---- instruments -------------------------------------------------- */}
      <div className="shrink-0 border-b border-border bg-card/60 px-4 py-2.5 lg:px-6">
        <GatesFunnel
          counts={run?.gateCounts || null}
          detail={run?.gateDetail}
          running={running}
          suggestedTerms={run?.suggestedTerms}
          onHarvestTerms={harvestTerms}
        />
      </div>

      {/* ---- scrolling workspace ------------------------------------------ */}
      <div className="flex-1 px-3 py-4 sm:px-4 lg:min-h-0 lg:overflow-hidden lg:px-6">
      {/* Steering is never hidden: if it influences ranking, it is on screen. */}
      {active.plan.steer?.enabled && active.plan.steer.publicationNumbers.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-[11px] dark:border-blue-800 dark:bg-blue-950/30">
          <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          <span className="font-semibold text-blue-800 dark:text-blue-300">Steering ranking toward:</span>
          {active.plan.steer.publicationNumbers.map(pub => (
            <span key={pub} className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-background px-2 py-0.5 font-mono text-[10px] text-blue-700 dark:border-blue-800 dark:text-blue-300">
              {pub}
              <button
                type="button"
                aria-label={`Remove ${pub} from steering`}
                onClick={() => {
                  const rest = active.plan.steer!.publicationNumbers.filter(p => p !== pub)
                  savePlan(
                    { ...active.plan, steer: { enabled: rest.length > 0, publicationNumbers: rest, weight: active.plan.steer!.weight } },
                    `Steering: removed ${pub}`
                  )
                }}
                className="hover:text-destructive"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <span className="text-muted-foreground">weight {active.plan.steer.weight} · re-run to apply</span>
          <Hint
            title="Visible by design"
            text="Ranking is never influenced by anything you can't see. Steering lives here and on the plan, it's recorded in the trail, and removing a document takes one click."
          />
        </div>
      )}

      {mode === 'quick' ? (
        <div className="mx-auto max-w-4xl space-y-4 lg:h-full lg:overflow-y-auto lg:pr-1">
          {seedCard}
          {active.plan.blocks.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <QueryCanvas plan={active.plan} disabled={drafting || running} onChange={savePlan} />
            </div>
          )}
          {resultsPane}
        </div>
      ) : (
        <div
          className={`grid gap-5 lg:h-full lg:min-h-0 ${
            railCollapsed ? 'lg:grid-cols-1' : 'lg:grid-cols-[minmax(340px,26%)_1fr]'
          }`}
        >
          {/* left rail — the plan, scrolls independently; collapsible so the
              results can take the full width during triage */}
          <div
            id="studio-search-plan"
            className={`space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1 ${railCollapsed ? 'hidden' : ''}`}
          >
            {seedCard}
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <QueryCanvas plan={active.plan} disabled={drafting || running} onChange={savePlan} />
            </div>
            <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Query line</span>
                <Hint
                  title="Always in sync"
                  text="A readable rendering of exactly what will execute — the canvas and this line are the same object. CAST(…) marks meaning-based concepts; STEER(…) marks ranking influence from your marks."
                />
                <button
                  type="button"
                  className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    navigator.clipboard.writeText(booleanPreview)
                    toast({ title: 'Query copied', variant: 'success' })
                  }}
                >
                  <ClipboardCopy className="h-3 w-3" /> copy
                </button>
              </div>
              <code className="block whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                {booleanPreview || '(empty plan)'}
              </code>
            </div>
          </div>

          {/* right pane — the work surface, scrolls independently */}
          <div className="flex min-w-0 flex-col lg:min-h-0">
            <div className="flex shrink-0 items-center gap-1 border-b border-border">
              <button
                type="button"
                onClick={toggleRail}
                title={railCollapsed ? 'Show the plan panel (key [)' : 'Hide the plan panel — full width for results (key [)'}
                aria-label={railCollapsed ? 'Show the plan panel' : 'Hide the plan panel'}
                aria-controls="studio-search-plan"
                aria-expanded={!railCollapsed}
                className="mr-1 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {railCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </button>
              <div className="flex items-center gap-1" role="tablist" aria-label="Workspace">
              {([
                ['results', 'Results', run ? visibleFamilies.length : null],
                ['grid', 'Element grid', active.plan.elements.length || null],
                ['trail', 'Trail', trail.length || null],
              ] as const).map(([tab, label, count]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={mainTab === tab}
                  onClick={() => setMainTab(tab as MainTab)}
                  className={`-mb-px flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-semibold transition-colors ${
                    mainTab === tab
                      ? 'border-lamp-600 text-foreground dark:border-lamp-400'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                  }`}
                >
                  {label}
                  {count !== null && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
                        mainTab === tab ? 'bg-lamp-100 text-lamp-800 dark:bg-lamp-900 dark:text-lamp-200' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              ))}
              </div>
              {theories.length > 0 && (
                <span className="ml-auto mr-1 rounded-full bg-lamp-100 px-2.5 py-1 text-[10px] font-bold text-lamp-800 dark:bg-lamp-900/60 dark:text-lamp-200">
                  {theories.length} pinned {theories.length === 1 ? 'theory' : 'theories'}
                </span>
              )}
            </div>

            <div className="pt-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
              {mainTab === 'results' && resultsPane}
              {mainTab === 'grid' && (
                <ElementGrid
                  elements={active.plan.elements}
                  families={allFamilies}
                  theories={theories}
                  onPinTheory={pinTheory}
                  onRemoveTheory={removeTheory}
                  onOpenDocument={family => {
                    setReaderFamily(family)
                    setMainTab('results')
                  }}
                  pinning={pinning}
                />
              )}
              {mainTab === 'trail' && <TrailPanel entries={trail} onDownloadReport={downloadReport} reportLoading={reportLoading} />}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
