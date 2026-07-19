'use client'

// Prior-Art Studio shell: sessions, Quick/Studio density modes, Copilot draft,
// runs with the gate funnel, result refinement, keyboard triage, the reader,
// the element grid, evidence trail and report download.
//
// Human-nature rules baked in: AI is opt-in and visible, every control has a
// mouse path and a key, help lives in ? icons, and no screen is a dead end.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ClipboardCopy,
  HelpCircle,
  Keyboard,
  Loader2,
  Play,
  Plus,
  ScrollText,
  Sparkles,
  X,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { Hint } from '@/components/ui/hint'
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

  const [mode, setMode] = useState<Mode>('quick')
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
  const [reportLoading, setReportLoading] = useState(false)
  const [pinning, setPinning] = useState(false)
  const savingRef = useRef(false)

  // ------------------------------------------------------------------ setup
  useEffect(() => {
    if (typeof window === 'undefined') return
    setMode((localStorage.getItem(MODE_KEY) as Mode) || 'quick')
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

  useEffect(() => {
    if (!user) return
    api<{ sessions: SessionSummary[] }>('/sessions')
      .then(data => setSessions(data.sessions))
      .catch(err => toast({ title: 'Could not load sessions', description: err.message, variant: 'error' }))
  }, [user, toast])

  // ------------------------------------------------------------- session io
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
            results: StudioResultFamily[]
            warnings?: string[]
            newFamilyCount: number
            durationMs?: number
          } | null
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
      } catch (err) {
        toast({ title: 'Could not open session', description: err instanceof Error ? err.message : String(err), variant: 'error' })
      }
    },
    [toast]
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

  const execute = useCallback(async () => {
    if (!active || running) return
    const hasActive = active.plan.blocks.some(b => b.terms.some(t => t.accepted)) || active.plan.cpc.some(c => c.accepted)
    if (!hasActive) {
      toast({ title: 'Nothing to run yet', description: 'Accept at least one term (dashed chips are inert suggestions) or add your own.', variant: 'error' })
      return
    }
    setRunning(true)
    try {
      const data = await api<{ run: StudioRunPayload }>(`/sessions/${active.id}/run`, { method: 'POST', body: JSON.stringify({}) })
      setRun(data.run)
      setCursor(0)
      setFilters(current => ({ ...DEFAULT_RESULT_FILTERS, sort: current.sort }))
      setReaderFamily(null)
      setTrail(t => [
        localTrailEntry(
          'RUN',
          `Run v${data.run.planVersion} (${data.run.planHash}): ${data.run.gateCounts.recall.toLocaleString()} recall → ${data.run.gateCounts.families.toLocaleString()} families → ${data.run.gateCounts.shown} shown`
        ),
        ...t,
      ])
      if (data.run.warnings.length) toast({ title: 'Run finished with notes', description: data.run.warnings[0] })
    } catch (err) {
      toast({ title: 'Run failed', description: err instanceof Error ? err.message : String(err), variant: 'error' })
    } finally {
      setRunning(false)
    }
  }, [active, running, toast])

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
        const data = await api<{ saturation: StudioSaturation }>(`/sessions/${active.id}/docs`, {
          method: 'POST',
          body: JSON.stringify({ familyKey: family.familyKey, publicationNumber: family.publicationNumber, ...patch }),
        })
        if (data.saturation) setSaturation(data.saturation)
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
      if (mainTab !== 'results' || !visibleFamilies.length) return
      const family = visibleFamilies[cursor]
      if (event.key === 'j') setCursor(c => Math.min(c + 1, visibleFamilies.length - 1))
      else if (event.key === 'k') setCursor(c => Math.max(c - 1, 0))
      else if (event.key === 'Enter' && family) setReaderFamily(family)
      else if (event.key === 'o' && family) {
        window.open(family.link || `https://patents.google.com/patent/${family.publicationNumber.replace(/[^A-Za-z0-9]/g, '')}`, '_blank')
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
  }, [active, visibleFamilies, cursor, docStates, setDocState, mainTab])

  // ----------------------------------------------------------------- render
  if (authLoading) return <div className="p-10 text-sm text-muted-foreground">Loading Prior-Art Studio…</div>
  if (!user) return <div className="p-10 text-sm text-muted-foreground">Please log in to use Prior-Art Studio.</div>

  if (!active) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        {showOnboarding && <OnboardingCoach onClose={closeOnboarding} />}
        <div className="mb-6 flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">Prior-Art Studio</h1>
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
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
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
        className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={draft}
          disabled={drafting || running}
          className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-3.5 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
        >
          {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {drafting ? 'Drafting your search…' : active.plan.blocks.length ? 'Re-draft from description' : 'Draft my search'}
        </button>
        <span className="text-xs text-muted-foreground">≈10 seconds · suggestions stay inert until you accept them</span>
      </div>
    </div>
  )

  const resultsPane = (
    <div className="space-y-3">
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
      {readerFamily && (
        <DocumentReader
          family={readerFamily}
          elements={active.plan.elements}
          onClose={() => setReaderFamily(null)}
          onSteerFrom={steerFrom}
          authHeaders={authHeaders}
        />
      )}
      {run ? (
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
          saturation={saturation}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {active.plan.blocks.length
            ? 'The canvas is ready. Press Run search to fill the funnel and get your first ranked, family-grouped results.'
            : 'Describe the invention and press “Draft my search” — or add concept blocks by hand if you prefer to build the query yourself.'}
        </div>
      )}
    </div>
  )

  return (
    <div className="mx-auto max-w-[1800px] px-4 py-6 lg:px-6">
      {showOnboarding && <OnboardingCoach onClose={closeOnboarding} />}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setActive(null)
            setRun(null)
            api<{ sessions: SessionSummary[] }>('/sessions').then(d => setSessions(d.sessions)).catch(() => {})
          }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Sessions
        </button>
        <input
          defaultValue={active.title}
          key={active.id + active.title}
          onBlur={e => saveTitle(e.target.value.trim())}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-base font-bold text-foreground hover:border-border focus:border-border focus:outline-none"
          aria-label="Search title"
        />
        <span className="font-mono text-[10px] text-muted-foreground">plan v{active.planVersion}</span>
        <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Layout density">
          {(['quick', 'studio'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`px-3 py-1 text-xs font-semibold capitalize ${mode === m ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground'}`}
            >
              {m}
            </button>
          ))}
          <Hint
            className="mx-1 self-center"
            title="Quick vs Studio"
            text="Quick is a single guided column — describe, approve, run, review. Studio adds the canvas rail, the element grid and the evidence trail. Same engine, same session — switch anytime."
          />
        </div>
        <button type="button" title="Keyboard shortcuts (?)" onClick={() => setShowKeys(v => !v)} className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground">
          <Keyboard className="h-4 w-4" />
        </button>
        <button type="button" title="Show the introduction again" onClick={() => setShowOnboarding(true)} className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground">
          <HelpCircle className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={execute}
          disabled={running || drafting}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          title="Execute the plan on the canvas against the corpus"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? 'Searching…' : 'Run search'}
        </button>
      </div>

      {showKeys && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Keys:</span>
          {[
            ['j / k', 'move'],
            ['1', 'relevant'],
            ['2', 'maybe'],
            ['3', 'not relevant'],
            ['x', 'exclude family'],
            ['Enter', 'read document'],
            ['o', 'open on Google Patents'],
            ['?', 'toggle this bar'],
          ].map(([key, label]) => (
            <span key={key}>
              <kbd className="rounded border border-border bg-background px-1 font-mono text-[10px]">{key}</kbd> {label}
            </span>
          ))}
        </div>
      )}

      <div className="mb-4">
        <GatesFunnel
          counts={run?.gateCounts || null}
          detail={run?.gateDetail}
          running={running}
          suggestedTerms={run?.suggestedTerms}
          onHarvestTerms={harvestTerms}
        />
      </div>

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
        <div className="mx-auto max-w-4xl space-y-4">
          {seedCard}
          {active.plan.blocks.length > 0 && (
            <div className="rounded-xl border border-border bg-background p-4">
              <QueryCanvas plan={active.plan} disabled={drafting || running} onChange={savePlan} />
            </div>
          )}
          {resultsPane}
          <div className="flex justify-end">
            <button type="button" onClick={downloadReport} disabled={reportLoading} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
              {reportLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScrollText className="h-3.5 w-3.5" />} Compile search report (DOCX)
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <div className="space-y-4">
            {seedCard}
            <div className="rounded-xl border border-border bg-background p-4">
              <QueryCanvas plan={active.plan} disabled={drafting || running} onChange={savePlan} />
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
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

          <div className="min-w-0 space-y-4">
            <div className="flex items-center gap-1 border-b border-border" role="tablist" aria-label="Workspace">
              {([
                ['results', `Results${run ? ` · ${visibleFamilies.length}` : ''}`],
                ['grid', `Element grid${active.plan.elements.length ? ` · ${active.plan.elements.length}` : ''}`],
                ['trail', `Trail · ${trail.length}`],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={mainTab === tab}
                  onClick={() => setMainTab(tab as MainTab)}
                  className={`-mb-px border-b-2 px-3 py-2 text-xs font-semibold ${
                    mainTab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
              {theories.length > 0 && (
                <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                  {theories.length} pinned {theories.length === 1 ? 'theory' : 'theories'}
                </span>
              )}
            </div>

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
      )}
    </div>
  )
}
