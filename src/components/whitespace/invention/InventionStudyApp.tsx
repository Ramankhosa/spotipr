'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowLeft, Compass, Lightbulb, Loader2, Play, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/hint'
import { useToast } from '@/components/ui/toast'
import { pollRun, wsApi, type RunProgress } from '../api'
import { CoOccupancyGrid } from './CoOccupancyGrid'
import { GapDirections } from './GapDirections'
import { JourneyRail, type JourneyStep, type StepState } from './JourneyRail'
import { RoundsTimeline } from './RoundsTimeline'
import { TrailPanel } from './TrailPanel'
import { ViewpointRegistry, type RegistryEdit } from './ViewpointRegistry'
import { SETTLED_LABEL, type DimensionMapResult } from './types'

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

const SECTION_IDS = ['invention', 'scope', 'viewpoints', 'grid', 'directions'] as const

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
  const [attackLabel, setAttackLabel] = useState<string | null>(null)
  const autoCompiled = useRef(false)

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

  const runDimensionMap = useCallback(
    async (registry?: DimensionMapResult['registry']) => {
      setRunning(true)
      setRunError(null)
      setProgress(null)
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
        const started = await wsApi<{ runId: string }>(`/api/whitespace/studies/${studyId}/runs`, {
          method: 'POST',
          body: JSON.stringify(body),
        })
        const final = await pollRun(studyId, started.runId, (_status, tick) => setProgress(tick))
        if (final.status === 'COMPLETED') {
          setResult(final.results as DimensionMapResult)
          setEdit({ removedDimensions: new Set(), removedValues: new Set() })
          setSelectedGaps(new Set())
        } else {
          setRunError(final.error || 'The run did not finish.')
        }
        await load()
      } catch (error) {
        setRunError(error instanceof Error ? error.message : 'Could not run the map.')
      } finally {
        setRunning(false)
        setProgress(null)
      }
    },
    [load, studyId]
  )

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

  const attackSelected = useCallback(async () => {
    if (!result || !selectedGaps.size) return
    const latest = runs.find(run => run.stage === 'DIMENSION_MAP' && run.status === 'COMPLETED')
    if (!latest) return
    setAttacking(true)
    try {
      setAttackLabel('Promoting the selected directions…')
      const promoted = await wsApi<{ promoted: Array<{ gapId: string; hypothesisId: string }> }>(
        `/api/whitespace/studies/${studyId}/gaps/promote`,
        { method: 'POST', body: JSON.stringify({ runId: latest.id, gapIds: Array.from(selectedGaps) }) }
      )
      let index = 0
      for (const entry of promoted.promoted) {
        index += 1
        setAttackLabel(`Attacking direction ${index} of ${promoted.promoted.length}…`)
        const started = await wsApi<{ runId: string }>(`/api/whitespace/studies/${studyId}/runs`, {
          method: 'POST',
          body: JSON.stringify({ stage: 'VALIDATE', params: { hypothesisId: entry.hypothesisId } }),
        })
        await pollRun(studyId, started.runId)
      }
      toast({
        variant: 'success',
        title: 'Attacks finished',
        description: `${promoted.promoted.length} direction${promoted.promoted.length === 1 ? '' : 's'} tested. Open the study's hypotheses to read the verdicts.`,
      })
      setSelectedGaps(new Set())
      await load()
    } catch (error) {
      toast({
        variant: 'error',
        title: 'Could not attack the directions',
        description: error instanceof Error ? error.message : 'Try again.',
      })
    } finally {
      setAttacking(false)
      setAttackLabel(null)
    }
  }, [load, result, runs, selectedGaps, studyId, toast])

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

      <header className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-primary">
          <Lightbulb className="h-4 w-4" />
          <span className="text-[11px] font-medium uppercase tracking-widest">Invention whitespace</span>
        </div>
        <h1 className="text-2xl font-semibold leading-tight text-foreground sm:text-3xl">{study.title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          We map the field around your invention by the axes it actually varies along, count who occupies
          what, and surface the combinations nobody has taken.
        </p>
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
                    <span
                      key={concept.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs text-foreground"
                    >
                      {concept.label}
                      {concept.required && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">must</span>
                      )}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
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
                      next.has(id) ? next.delete(id) : next.add(id)
                      return next
                    })
                  }
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
  const stats: Array<[string, string, string]> = [
    ['Families', result.familyCount.toLocaleString(), 'in the field we read'],
    ['Viewpoints', String(result.registry.length), SETTLED_LABEL[result.settledReason].replace(/^[a-z]+ — /, '')],
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
