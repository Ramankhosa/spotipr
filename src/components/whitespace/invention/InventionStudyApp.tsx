'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowLeft, Compass, FileDown, Lightbulb, Loader2, Play, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/hint'
import { useToast } from '@/components/ui/toast'
import { HypothesesPanel } from '../HypothesesPanel'
import { authHeaders, conflictRunId, isPollAborted, PollAbortedError, pollRun, wsApi, type RunProgress } from '../api'
import { CoOccupancyGrid } from './CoOccupancyGrid'
import { GapDirections, MAX_ATTACKS_PER_ROUND } from './GapDirections'
import { JourneyRail, type JourneyStep, type StepState } from './JourneyRail'
import { RoundsTimeline } from './RoundsTimeline'
import { TrailPanel } from './TrailPanel'
import { ViewpointRegistry, type RegistryEdit } from './ViewpointRegistry'
import { SETTLED_LABEL, type DimensionMapResult } from './types'
import { FieldRuleLadder, MatchRuleControl } from '../FieldRulePanel'
import type { ScopeMatching } from '@/lib/whitespace/types'

interface ScopeConcept {
  id: string
  label: string
  synonyms: string[]
  required: boolean
  origin: string
}

interface Scope {
  title: string
  summary: string
  concepts: ScopeConcept[]
  classifications: Array<{ code: string; definition?: string; caution?: string; accepted: boolean }>
  assumptions: Array<{ id: string; text: string; kind: string }>
  filters: { yearFrom: number; yearTo: number; jurisdictions: string[]; assignees: string[] }
  /** "At least k of the optional concepts"; absent reads as auto. */
  matching?: ScopeMatching
}

interface Study {
  id: string
  title: string
  kind: string
  scope: Scope
  scopeVersion: number
  inventionJson: { problem?: string; approach?: string; constraints?: string } | null
}

interface RunRow {
  id: string
  stage: string
  status: string
  scopeVersion: number
  createdAt: string
  lastError: string | null
}

const SECTION_IDS = ['invention', 'scope', 'viewpoints', 'grid', 'directions', 'hypotheses'] as const

/** Sleep that rejects with PollAbortedError the moment the signal fires. */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new PollAbortedError())
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new PollAbortedError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function InventionStudyApp({ studyId }: { studyId: string }) {
  const { toast } = useToast()
  const [study, setStudy] = useState<Study | null>(null)
  const [runs, setRuns] = useState<RunRow[]>([])
  const [result, setResult] = useState<DimensionMapResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [compiling, setCompiling] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const [edit, setEdit] = useState<RegistryEdit>({ removedDimensions: new Set(), removedValues: new Set() })
  const [selectedGaps, setSelectedGaps] = useState<Set<string>>(new Set())
  const [attacking, setAttacking] = useState(false)
  /** Bumped after an attack round so the verdicts panel refetches. */
  const [panelEpoch, setPanelEpoch] = useState(0)
  const [downloadingReport, setDownloadingReport] = useState(false)
  const [attackLabel, setAttackLabel] = useState<string | null>(null)
  const [savingScope, setSavingScope] = useState(false)
  const autoCompiled = useRef(false)
  // Guards the scope PATCH synchronously. The disabled prop only takes effect
  // after a re-render, so two fast clicks would otherwise both read the same
  // stale scope and the second would overwrite the first.
  const scopeSaveInFlight = useRef(false)

  // Aborts every poll this app owns on unmount. A map or attack round runs for
  // minutes; without this, navigating away left the loop polling every three
  // seconds — and the attack loop POSTing new metered runs — from a dead
  // component. A set, because a map poll and an attack round can coexist.
  const pollAborts = useRef<Set<AbortController>>(new Set())
  useEffect(() => {
    const controllers = pollAborts.current
    return () => {
      controllers.forEach(controller => controller.abort())
    }
  }, [])
  /** The DIMENSION_MAP run currently being watched, so load() never double-attaches. */
  const watchedDimensionRun = useRef<string | null>(null)
  /** Set by load() when a reload finds a map still in flight; an effect attaches to it. */
  const [resumeRunId, setResumeRunId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const data = await wsApi<{ study: Study; runs: RunRow[] }>(`/api/whitespace/studies/${studyId}`)
      setStudy(data.study)
      setRuns(data.runs)

      const latest = data.runs.find(run => run.stage === 'DIMENSION_MAP' && run.status === 'COMPLETED')
      if (latest) {
        const payload = await wsApi<{ results: DimensionMapResult | null }>(
          `/api/whitespace/studies/${studyId}/runs/${latest.id}`
        )
        setResult(payload.results ?? null)
      }
      const failed = data.runs.find(run => run.stage === 'DIMENSION_MAP' && run.status === 'FAILED')
      if (failed && !latest) setRunError(failed.lastError)

      // A map still in flight after a reload must resume polling — otherwise
      // the page shows an idle "Map the field" button over a working server.
      const active = data.runs.find(
        run => run.stage === 'DIMENSION_MAP' && (run.status === 'QUEUED' || run.status === 'PROCESSING')
      )
      if (active && watchedDimensionRun.current !== active.id) setResumeRunId(active.id)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load the study.')
    } finally {
      setLoading(false)
    }
  }, [studyId])

  useEffect(() => {
    void load()
  }, [load])

  const scopeEmpty = !study?.scope?.concepts?.length

  const compile = useCallback(
    async (force = false) => {
      setCompiling(true)
      try {
        await wsApi(`/api/whitespace/studies/${studyId}/scope/compile`, {
          method: 'POST',
          body: JSON.stringify({ force }),
        })
        await load()
      } catch (error) {
        const err = error as Error & { code?: string }
        toast({
          variant: err.code === 'SCOPE_HAS_USER_EDITS' ? 'warning' : 'error',
          title: 'Could not build the scope',
          description: err.message,
        })
      } finally {
        setCompiling(false)
      }
    },
    [load, studyId, toast]
  )

  // Compile once on arrival so the user lands on something reviewable rather
  // than an empty form they have to discover a button for.
  useEffect(() => {
    if (!study || autoCompiled.current) return
    if (scopeEmpty && study.kind === 'INVENTION') {
      autoCompiled.current = true
      void compile(false)
    }
  }, [study, scopeEmpty, compile])

  /**
   * Watches one DIMENSION_MAP run to completion. Shared by a fresh start, a
   * 409 attach, and a reload that found the run already in flight. Nothing here
   * touches state after its controller aborts: an abort means the component is
   * unmounting, or a newer watcher owns the state.
   */
  const attachToDimensionRun = useCallback(
    async (runId: string, controller: AbortController) => {
      watchedDimensionRun.current = runId
      setRunning(true)
      setRunError(null)
      try {
        const final = await pollRun(studyId, runId, (_status, tick) => setProgress(tick), controller.signal)
        if (controller.signal.aborted) return
        if (final.status === 'COMPLETED') {
          setResult(final.results as DimensionMapResult)
          setEdit({ removedDimensions: new Set(), removedValues: new Set() })
          setSelectedGaps(new Set())
        } else {
          setRunError(final.error || 'The run did not finish.')
        }
        await load()
      } catch (error) {
        if (isPollAborted(error)) return
        setRunError(error instanceof Error ? error.message : 'Could not run the map.')
      } finally {
        if (watchedDimensionRun.current === runId) watchedDimensionRun.current = null
        pollAborts.current.delete(controller)
        if (!controller.signal.aborted) {
          setRunning(false)
          setProgress(null)
        }
      }
    },
    [load, studyId]
  )

  // Re-attach after a reload found a map QUEUED/PROCESSING (see load).
  useEffect(() => {
    if (!resumeRunId) return
    setResumeRunId(null)
    if (watchedDimensionRun.current === resumeRunId) return
    const controller = new AbortController()
    pollAborts.current.add(controller)
    void attachToDimensionRun(resumeRunId, controller)
  }, [resumeRunId, attachToDimensionRun])

  const runDimensionMap = useCallback(
    async (registry?: DimensionMapResult['registry']) => {
      setRunning(true)
      setRunError(null)
      setProgress(null)
      const controller = new AbortController()
      pollAborts.current.add(controller)
      try {
        const body: Record<string, unknown> = { stage: 'DIMENSION_MAP' }
        if (registry) {
          body.params = {
            registry: {
              dimensions: registry.map(dimension => ({
                label: dimension.label,
                description: dimension.description,
                values: dimension.values.map(value => ({ label: value.label, synonyms: value.synonyms })),
              })),
            },
          }
        }
        let runId: string
        try {
          const started = await wsApi<{ runId: string }>(`/api/whitespace/studies/${studyId}/runs`, {
            method: 'POST',
            body: JSON.stringify(body),
            signal: controller.signal,
          })
          runId = started.runId
        } catch (error) {
          // 409 means a map with these params is already in flight — attach to
          // it rather than reporting a failure for work under way.
          const liveRunId = conflictRunId(error)
          if (!liveRunId) throw error
          runId = liveRunId
        }
        await attachToDimensionRun(runId, controller)
      } catch (error) {
        pollAborts.current.delete(controller)
        if (isPollAborted(error)) return
        setRunError(error instanceof Error ? error.message : 'Could not run the map.')
        setRunning(false)
        setProgress(null)
      }
    },
    [attachToDimensionRun, studyId]
  )

  /**
   * Toggles a concept between must-appear and optional, and saves.
   *
   * Required concepts INTERSECT, so each one multiplies the restriction — the
   * usual reason an invention field comes back empty is that every component of
   * the invention was marked required. The user has to be able to undo that
   * here, where the message telling them to is.
   */
  const toggleRequired = useCallback(
    async (conceptId: string) => {
      if (!study || scopeSaveInFlight.current) return
      scopeSaveInFlight.current = true
      setSavingScope(true)
      try {
        const nextScope: Scope = {
          ...study.scope,
          concepts: study.scope.concepts.map(concept =>
            concept.id === conceptId ? { ...concept, required: !concept.required, origin: 'user' } : concept
          ),
        }
        await wsApi(`/api/whitespace/studies/${studyId}`, {
          method: 'PATCH',
          body: JSON.stringify({ scope: nextScope }),
        })
        await load()
      } catch (error) {
        toast({
          variant: 'error',
          title: 'Could not update the field',
          description: error instanceof Error ? error.message : 'Try again.',
        })
      } finally {
        scopeSaveInFlight.current = false
        setSavingScope(false)
      }
    },
    [load, study, studyId, toast]
  )

  /**
   * Sets the match rule ("at least k of the optional concepts", or auto) and
   * saves. Same guard as toggleRequired: the two edit the same scope row.
   */
  const setMatching = useCallback(
    async (matching: ScopeMatching) => {
      if (!study || scopeSaveInFlight.current) return
      scopeSaveInFlight.current = true
      setSavingScope(true)
      try {
        await wsApi(`/api/whitespace/studies/${studyId}`, {
          method: 'PATCH',
          body: JSON.stringify({ scope: { ...study.scope, matching } }),
        })
        await load()
      } catch (error) {
        toast({
          variant: 'error',
          title: 'Could not update the match rule',
          description: error instanceof Error ? error.message : 'Try again.',
        })
      } finally {
        scopeSaveInFlight.current = false
        setSavingScope(false)
      }
    },
    [load, study, studyId, toast]
  )

  const requiredCount = study?.scope?.concepts?.filter(concept => concept.required).length ?? 0
  const optionalCount = (study?.scope?.concepts?.length ?? 0) - requiredCount
  const matchingMode = study?.scope?.matching?.minimumOptionalConcepts ?? 'auto'
  const dirty = edit.removedDimensions.size > 0 || edit.removedValues.size > 0

  const recount = useCallback(() => {
    if (!result) return
    const registry = result.registry
      .filter(dimension => !edit.removedDimensions.has(dimension.id))
      .map(dimension => ({
        ...dimension,
        values: dimension.values.filter(value => !edit.removedValues.has(value.id)),
      }))
      .filter(dimension => dimension.values.length >= 2)
    void runDimensionMap(registry)
  }, [edit, result, runDimensionMap])

  /**
   * Starts one VALIDATE run. Attaches to the live run on 409; on 429 (the run
   * limiter allows five starts a minute, which sequential attacks can brush)
   * waits out part of the window and retries once before giving a clear reason.
   */
  const startValidateRun = useCallback(
    async (hypothesisId: string, signal: AbortSignal): Promise<string> => {
      const start = () =>
        wsApi<{ runId: string }>(`/api/whitespace/studies/${studyId}/runs`, {
          method: 'POST',
          body: JSON.stringify({ stage: 'VALIDATE', params: { hypothesisId } }),
          signal,
        })
      try {
        return (await start()).runId
      } catch (error) {
        const liveRunId = conflictRunId(error)
        if (liveRunId) return liveRunId
        if ((error as { status?: number })?.status !== 429) throw error
        await abortableDelay(20_000, signal)
        try {
          return (await start()).runId
        } catch (retryError) {
          const retryLiveRunId = conflictRunId(retryError)
          if (retryLiveRunId) return retryLiveRunId
          if ((retryError as { status?: number })?.status === 429) {
            throw new Error(
              'The run limiter is still at its cap. Wait a minute, then attack the remaining directions again.'
            )
          }
          throw retryError
        }
      }
    },
    [studyId]
  )

  const attackSelected = useCallback(async () => {
    if (!result || !selectedGaps.size) return
    const latest = runs.find(run => run.stage === 'DIMENSION_MAP' && run.status === 'COMPLETED')
    if (!latest) return
    setAttacking(true)
    const controller = new AbortController()
    pollAborts.current.add(controller)
    try {
      setAttackLabel('Promoting the selected directions…')
      const promoted = await wsApi<{ promoted: Array<{ gapId: string; hypothesisId: string }> }>(
        `/api/whitespace/studies/${studyId}/gaps/promote`,
        {
          method: 'POST',
          // The server promotes at most MAX_ATTACKS_PER_ROUND per call; the
          // selection is capped to the same number, this slice is a backstop.
          body: JSON.stringify({ runId: latest.id, gapIds: Array.from(selectedGaps).slice(0, MAX_ATTACKS_PER_ROUND) }),
          signal: controller.signal,
        }
      )
      let index = 0
      let failedCount = 0
      for (const entry of promoted.promoted) {
        // The user leaving aborts the round — never POST a new metered run
        // from a component that is no longer there.
        if (controller.signal.aborted) throw new PollAbortedError()
        index += 1
        setAttackLabel(`Attacking direction ${index} of ${promoted.promoted.length}…`)
        const runId = await startValidateRun(entry.hypothesisId, controller.signal)
        const final = await pollRun(studyId, runId, undefined, controller.signal)
        if (final.status !== 'COMPLETED') failedCount += 1
      }
      if (controller.signal.aborted) return
      const total = promoted.promoted.length
      const plural = total === 1 ? '' : 's'
      if (failedCount === 0) {
        toast({
          variant: 'success',
          title: 'Attacks finished',
          description: `${total} direction${plural} tested. The verdicts are in the section below.`,
        })
      } else if (failedCount < total) {
        toast({
          variant: 'warning',
          title: 'Some attacks did not finish',
          description: `${total} direction${plural} tested, ${failedCount} did not finish. The verdicts that completed are in the section below.`,
        })
      } else {
        toast({
          variant: 'error',
          title: 'The attacks did not finish',
          description: `None of the ${total} direction${plural} completed. Try again, or test them one at a time from the verdicts section.`,
        })
      }
      setSelectedGaps(new Set())
      await load()
      setPanelEpoch(epoch => epoch + 1)
    } catch (error) {
      if (isPollAborted(error)) return
      toast({
        variant: 'error',
        title: 'Could not attack the directions',
        description: error instanceof Error ? error.message : 'Try again.',
      })
    } finally {
      pollAborts.current.delete(controller)
      if (!controller.signal.aborted) {
        setAttacking(false)
        setAttackLabel(null)
      }
    }
  }, [load, result, runs, selectedGaps, startValidateRun, studyId, toast])

  // wsApi parses every response as JSON, so the report has to be fetched raw.
  const downloadReport = useCallback(async () => {
    setDownloadingReport(true)
    try {
      const response = await fetch(`/api/whitespace/studies/${studyId}/report`, { headers: authHeaders() })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error || 'The report could not be generated.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Whitespace-Report_${(study?.title || 'study').replace(/[^A-Za-z0-9-_ ]/g, '').slice(0, 40).trim() || 'study'}.docx`
      link.click()
      URL.revokeObjectURL(url)
      toast({ variant: 'success', title: 'Report downloaded' })
    } catch (error) {
      toast({
        variant: 'error',
        title: 'Could not build the report',
        description: error instanceof Error ? error.message : 'Try again.',
      })
    } finally {
      setDownloadingReport(false)
    }
  }, [studyId, study?.title, toast])

  const steps = useMemo<JourneyStep[]>(() => {
    const scopeReady = !scopeEmpty
    const mapped = Boolean(result)
    const hasGrid = Boolean(result?.matrices.some(matrix => matrix.harvested))
    const hasGaps = Boolean(result?.gaps.length)
    const state = (done: boolean, current: boolean, locked: boolean): StepState =>
      running && current ? 'running' : done ? 'done' : locked ? 'locked' : 'current'
    return [
      { id: 'invention', label: 'Your invention', hint: 'What you described', state: 'done' },
      {
        id: 'scope',
        label: 'The field around it',
        hint: scopeReady ? 'Reviewable — edit before counting' : 'Being built…',
        state: state(scopeReady, !scopeReady, false),
      },
      {
        id: 'viewpoints',
        label: 'Viewpoints',
        hint: mapped ? `${result?.registry.length} axes found` : 'How the field organises',
        state: state(mapped, !mapped && scopeReady, !scopeReady),
      },
      {
        id: 'grid',
        label: 'The grid',
        hint: hasGrid ? 'Where the field sits' : mapped ? 'No pair readable' : 'Crossed viewpoints',
        state: state(hasGrid, false, !mapped),
      },
      {
        id: 'directions',
        label: 'Directions',
        hint: hasGaps ? `${result?.gaps.length} candidates` : mapped ? 'None survived' : 'Unoccupied combinations',
        state: state(hasGaps, false, !mapped),
      },
      {
        id: 'hypotheses',
        label: 'Verdicts',
        hint: 'Attacked directions, and your review',
        state: state(false, false, !hasGaps),
      },
    ]
  }, [result, running, scopeEmpty])

  const scrollTo = useCallback((id: string) => {
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  if (loading) {
    return (
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-16 text-muted-foreground sm:px-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading the study…</span>
      </div>
    )
  }

  if (loadError || !study) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="text-sm text-foreground">{loadError || 'Study not found.'}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const invention = study.inventionJson

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <Link
        href="/whitespace"
        className="mb-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All studies
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <Lightbulb className="h-4 w-4" />
            <span className="text-[11px] font-medium uppercase tracking-widest">Invention whitespace</span>
          </div>
          <h1 className="text-2xl font-semibold leading-tight text-foreground sm:text-3xl">{study.title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            We map the field around your invention by the axes it actually varies along, count who occupies
            what, and surface the combinations nobody has taken.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void downloadReport()} disabled={downloadingReport}>
          {downloadingReport ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileDown className="mr-2 h-3.5 w-3.5" />
          )}
          Download report
        </Button>
      </header>

      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
        <div className="mb-6 lg:sticky lg:top-6 lg:mb-0 lg:self-start">
          <JourneyRail steps={steps} onSelect={scrollTo} />
        </div>

        <div className="min-w-0 space-y-10">
          {/* 1 — the invention as described */}
          <section id="section-invention" className="scroll-mt-6">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Your invention
            </h2>
            <div className="space-y-2.5 rounded-xl border border-border bg-card p-4">
              {invention?.problem && <Field label="Problem" value={invention.problem} />}
              {invention?.approach && <Field label="How it works" value={invention.approach} />}
              {invention?.constraints && <Field label="Constraints" value={invention.constraints} />}
              {!invention?.problem && !invention?.approach && (
                <p className="text-sm text-muted-foreground">No structured brief was recorded for this study.</p>
              )}
            </div>
          </section>

          {/* 2 — the compiled field */}
          <section id="section-scope" className="scroll-mt-6">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                The field we will read
                <Hint
                  title="Why a field, not your invention"
                  text="A search that only matches your own wording finds nothing and makes everything look empty. The scope is deliberately the space of existing approaches to the same problem — including ones your invention rejects."
                />
              </h2>
              <span className="text-xs text-muted-foreground">scope v{study.scopeVersion}</span>
            </div>

            {compiling ? (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Reading your description and drafting the field…
              </div>
            ) : scopeEmpty ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center">
                <p className="text-sm text-muted-foreground">No scope yet.</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => void compile(false)}>
                  Build the field
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card p-4">
                {study.scope.summary && (
                  <p className="mb-3 text-sm leading-relaxed text-foreground">{study.scope.summary}</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {study.scope.concepts.map(concept => (
                    <button
                      key={concept.id}
                      type="button"
                      onClick={() => void toggleRequired(concept.id)}
                      disabled={savingScope || running}
                      title={
                        concept.required
                          ? 'Must appear in every document counted. Click to make it optional.'
                          : 'Optional — broadens the field. Click to require it.'
                      }
                      className={[
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                        concept.required
                          ? 'border-primary/40 bg-primary/[0.06] text-foreground'
                          : 'border-border bg-muted/60 text-muted-foreground hover:bg-accent',
                        savingScope || running ? 'opacity-60' : '',
                      ].join(' ')}
                    >
                      {concept.label}
                      {concept.required && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">must</span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                  {requiredCount === 0
                    ? 'No concept is must-appear. Click a concept to require it in every document counted.'
                    : requiredCount === 1
                      ? 'One concept must appear in every document counted. Click a concept to change that.'
                      : `${requiredCount} concepts must ALL appear in the same document — they intersect, so each one shrinks the field sharply. Click any "must" to make it optional.`}
                  {optionalCount > 0 &&
                    (matchingMode === 'auto'
                      ? ' How many of the other concepts a document also needs is fitted automatically: every rung is measured and the tightest one that still yields a workable field is used.'
                      : ' The number of other concepts a document also needs is pinned below.')}
                </p>
                <div className="mt-2 rounded-md border border-dashed border-border px-2.5 py-2">
                  <MatchRuleControl
                    compact
                    scope={study.scope}
                    disabled={savingScope || running}
                    onChange={matching => void setMatching(matching)}
                  />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Filing years {study.scope.filters.yearFrom}–{study.scope.filters.yearTo}
                  {study.scope.filters.jurisdictions.length
                    ? ` · ${study.scope.filters.jurisdictions.join(', ')}`
                    : ' · all jurisdictions'}
                  {study.scope.classifications.filter(c => c.accepted).length
                    ? ` · ${study.scope.classifications.filter(c => c.accepted).length} classification codes`
                    : ''}
                </p>
              </div>
            )}

            {!scopeEmpty && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button onClick={() => void runDimensionMap()} disabled={running || compiling}>
                  {running ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Mapping…
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      {result ? 'Map the field again' : 'Map the field'}
                    </>
                  )}
                </Button>
                <Button variant="outline" size="sm" onClick={() => void compile(true)} disabled={running || compiling}>
                  Rebuild the field
                </Button>
              </div>
            )}

            {running && (
              <div className="mt-3 rounded-xl border border-border bg-muted/40 p-4">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  {progress?.detail || 'Starting…'}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Discovery reads a sample and proposes viewpoints; every proposal is then counted against the
                  whole field before it is kept. This usually takes a couple of minutes.
                </p>
              </div>
            )}

            {runError && !running && (
              <div className="mt-3 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-sm leading-relaxed text-foreground">{runError}</p>
              </div>
            )}
          </section>

          {result && (
            <>
              {/* 3 — viewpoints + how they were found */}
              <section id="section-viewpoints" className="scroll-mt-6 space-y-6">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Viewpoints
                </h2>
                <FieldStats result={result} />
                {result.fieldRule && <FieldRuleLadder rule={result.fieldRule} className="bg-card" />}
                <RoundsTimeline result={result} />
                <ViewpointRegistry
                  result={result}
                  edit={edit}
                  dirty={dirty}
                  recounting={running}
                  onRecount={recount}
                  onToggleDimension={id =>
                    setEdit(prev => {
                      const next = new Set(prev.removedDimensions)
                      next.has(id) ? next.delete(id) : next.add(id)
                      return { ...prev, removedDimensions: next }
                    })
                  }
                  onToggleValue={id =>
                    setEdit(prev => {
                      const next = new Set(prev.removedValues)
                      next.has(id) ? next.delete(id) : next.add(id)
                      return { ...prev, removedValues: next }
                    })
                  }
                />
              </section>

              {/* 4 — the grid */}
              <section id="section-grid" className="scroll-mt-6">
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  The grid
                </h2>
                <CoOccupancyGrid result={result} />
              </section>

              {/* 5 — directions */}
              <section id="section-directions" className="scroll-mt-6">
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Directions
                </h2>
                <GapDirections
                  result={result}
                  selected={selectedGaps}
                  attacking={attacking}
                  attackingLabel={attackLabel}
                  onAttack={() => void attackSelected()}
                  onToggle={id =>
                    setSelectedGaps(prev => {
                      const next = new Set(prev)
                      if (next.has(id)) next.delete(id)
                      // The promote endpoint takes at most this many per call
                      // and silently drops the rest — don't let more be chosen.
                      else if (next.size < MAX_ATTACKS_PER_ROUND) next.add(id)
                      return next
                    })
                  }
                />
              </section>

              {/* Attacked directions land here. Before this section existed the
                  verdicts were written and never shown. The panel brings its own
                  card header, so this wrapper only supplies the rail anchor and
                  cancels the standalone top margin. refreshToken (not key): a
                  remount would destroy an in-progress review draft. */}
              <section id="section-hypotheses" className="scroll-mt-6 [&>section]:mt-0">
                <HypothesesPanel
                  refreshToken={panelEpoch}
                  studyId={studyId}
                  areasReady
                  proposeEnabled={false}
                  emptyHint="Nothing attacked yet. Select directions above and attack them — the verdicts, and your review of them, appear here."
                  onChanged={() => void load()}
                />
              </section>

              <ReadThisFirst result={result} />
            </>
          )}

          <TrailPanel studyId={studyId} />
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm leading-relaxed text-foreground">{value}</p>
    </div>
  )
}

function FieldStats({ result }: { result: DimensionMapResult }) {
  const placed = 1 - result.unclassifiedShare
  // The label map may trail the server's reasons; never throw over a stat hint.
  // The strip takes everything through the first "— ", which also handles
  // multi-word prefixes like "stopped at the round limit — ".
  const settledHint = (SETTLED_LABEL[result.settledReason] ?? 'axes the field varies along').replace(/^[^—]*— /, '')
  const stats: Array<[string, string, string]> = [
    ['Families', result.familyCount.toLocaleString(), 'in the field we read'],
    ['Viewpoints', String(result.registry.length), settledHint],
    ['Placed', `${Math.round(placed * 100)}%`, 'match at least one value'],
    ['Rounds', String(result.rounds.length || 1), 'until nothing new appeared'],
  ]
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
      {stats.map(([label, value, hint]) => (
        <div key={label} className="bg-card p-3.5">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
          <dd className="mt-1 font-mono text-[17px] font-semibold tabular-nums text-foreground">{value}</dd>
          <dd className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</dd>
        </div>
      ))}
    </dl>
  )
}

function ReadThisFirst({ result }: { result: DimensionMapResult }) {
  return (
    <section className="rounded-xl border border-border bg-muted/30 p-4">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <ScrollText className="h-3.5 w-3.5" />
        Read this before drawing conclusions
      </h3>
      <ul className="mt-2 space-y-1.5">
        {[...result.limitations, ...result.coverageNotes].map((note, index) => (
          <li key={index} className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
            <span aria-hidden className="text-muted-foreground/60">
              •
            </span>
            <span>{note}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
