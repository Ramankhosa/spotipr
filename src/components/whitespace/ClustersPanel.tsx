'use client'

/**
 * The area map: stages 2 (cluster), 3 (signals) and 4 (deep dive per area).
 *
 * Presentation rules, deliberate:
 *  - Area sizes are always "~N families" — they are sample extrapolations.
 *  - One human status per area; raw geometry (silhouette, cohesion) lives
 *    behind the "How this was computed" disclosure.
 *  - The map/grid is a selector. Nothing here claims an empty spot means
 *    anything — gaps are claimed only by tested hypotheses, one panel down.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { BookOpen, Grid2x2, Loader2, SignalHigh } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { conflictRunId, isPollAborted, wsApi } from './api'
import { ClusterMap } from './ClusterMap'
import { LiveActivityPanel } from './LiveActivityPanel'
import { useRunActivity } from './useRunActivity'

interface ClusterRow {
  id: string
  label: string
  description: string | null
  keywords: string[]
  memberCount: number
  fieldEstimate: number
  cohesion: number | null
  separation: number | null
  silhouette: number | null
  metrics: {
    density?: number | null
    velocityPct?: number | null
    hhi?: number | null
    crowdedness?: number | null
    recencyShare?: number | null
    topAssignees?: Array<{ label: string; families: number }>
    cpcMix?: Array<{ code: string; families: number }>
    grade?: string
    layout?: { x: number; y: number }
  } | null
  deepDive: {
    status: string
    textCoverage: { familiesTotal: number; withClaims: number } | null
    results: { familiesExtracted?: number; rarePairs?: unknown[] } | null
  } | null
}

interface Divergence {
  concept: string
  overlapPct: number | null
  semanticOnlyVocabulary: string | null
  divergent: boolean
}

const GRADE_LABEL: Record<string, string> = {
  'well-defined': 'Well-defined area',
  usable: 'Coherent area',
  diffuse: 'Broad mix',
}

type LiveStage = 'CLUSTER' | 'SIGNALS' | 'DEEP_DIVE'

/** The run whose activity this panel shows; a deep dive names its area. */
interface LiveRun {
  stage: LiveStage
  runId: string
  clusterId?: string
}

/** The slice of the study GET's `runs[]` this panel reads to re-attach. */
interface StudyRunRow {
  id: string
  stage: string
  status: string
  params?: Record<string, unknown> | null
}

function isLiveStage(stage: string): stage is LiveStage {
  return stage === 'CLUSTER' || stage === 'SIGNALS' || stage === 'DEEP_DIVE'
}

function paramString(params: StudyRunRow['params'], key: string): string | undefined {
  const value = params?.[key]
  return typeof value === 'string' ? value : undefined
}

export function ClustersPanel({
  studyId,
  fieldMapReady,
  onChanged,
}: {
  studyId: string
  fieldMapReady: boolean
  onChanged?: () => void
}) {
  const { toast } = useToast()
  const [clusters, setClusters] = useState<ClusterRow[]>([])
  const [divergence, setDivergence] = useState<Divergence[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState<string | null>(null)
  const [mapping, setMapping] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [divingClusterId, setDivingClusterId] = useState<string | null>(null)
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null)

  // Live narration for the stage in flight: one full panel for the section
  // (cluster, signals) or one compact panel inside the area being read.
  const activity = useRunActivity(studyId)
  const { watch: watchRun, dismiss: dismissRun } = activity
  const [live, setLive] = useState<LiveRun | null>(null)
  // The parent passes an inline arrow; a ref keeps it out of effect deps.
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  const load = useCallback(async () => {
    try {
      const data = await wsApi<{ clusters: ClusterRow[]; signals: { divergence?: Divergence[] } | null }>(
        `/api/whitespace/studies/${studyId}/clusters`
      )
      setClusters(data.clusters)
      setDivergence(data.signals?.divergence ?? [])
      setLoadFailed(null)
    } catch (error) {
      // Auth errors surface on the study page; anything else must not pass
      // itself off as a genuinely empty area list.
      if ((error as { status?: number })?.status !== 401) {
        setLoadFailed(error instanceof Error ? error.message : 'Could not load the areas.')
      }
    } finally {
      setLoading(false)
    }
  }, [studyId])

  useEffect(() => {
    void load()
  }, [load])

  // One abort controller for every poll this panel owns. Without it a stage that
  // takes minutes kept polling — and kept calling setState — long after the user
  // navigated away from the study.
  const pollAbort = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      pollAbort.current?.abort()
    },
    []
  )

  const startStage = useCallback(
    async (
      stage: 'CLUSTER' | 'SIGNALS' | 'DEEP_DIVE',
      params: Record<string, string> | undefined,
      setBusy: (busy: boolean) => void,
      failTitle: string
    ) => {
      setBusy(true)
      pollAbort.current?.abort()
      const controller = new AbortController()
      pollAbort.current = controller
      try {
        let runId: string
        try {
          const started = await wsApi<{ runId: string }>(`/api/whitespace/studies/${studyId}/runs`, {
            method: 'POST',
            body: JSON.stringify({ stage, params }),
          })
          runId = started.runId
        } catch (error) {
          // 409 means this exact stage+params is already in flight — attach to
          // that run rather than reporting a failure for work under way.
          const liveRunId = conflictRunId(error)
          if (!liveRunId) throw error
          runId = liveRunId
        }
        setLive({ stage, runId, clusterId: params?.clusterId })
        const final = await watchRun(runId, controller.signal)
        if (final.status === 'FAILED') {
          toast({ variant: 'error', title: failTitle, description: final.error || 'The stage did not complete.' })
        }
        await load()
        onChanged?.()
      } catch (error) {
        // An aborted poll is the user leaving, not a failure to report.
        if (isPollAborted(error)) return
        toast({
          variant: 'error',
          title: failTitle,
          description: error instanceof Error ? error.message : 'Try again.',
        })
      } finally {
        if (pollAbort.current === controller) pollAbort.current = null
        setBusy(false)
      }
    },
    [studyId, toast, load, onChanged, watchRun]
  )

  /**
   * Re-attaches after a reload: a CLUSTER, SIGNALS or DEEP_DIVE run left
   * QUEUED or PROCESSING keeps working on the server, and without a watch the
   * panel showed idle buttons over it. Every live run is watched; the newest
   * drives the panels (a deep dive is mapped to its area by params.clusterId).
   * Refreshes when they settle; a failure is not toasted because the user did
   * not just start this work — the panel shows it.
   */
  const reattach = useCallback(async () => {
    if (pollAbort.current) return
    const controller = new AbortController()
    pollAbort.current = controller
    const resumed: LiveRun[] = []
    try {
      const data = await wsApi<{ runs: StudyRunRow[] }>(`/api/whitespace/studies/${studyId}`, {
        signal: controller.signal,
      })
      for (const run of data.runs) {
        if (!isLiveStage(run.stage) || (run.status !== 'QUEUED' && run.status !== 'PROCESSING')) continue
        resumed.push({ stage: run.stage, runId: run.id, clusterId: paramString(run.params, 'clusterId') })
      }
      if (!resumed.length) return
      setLive(resumed[0])
      for (const entry of resumed) {
        if (entry.stage === 'CLUSTER') setMapping(true)
        else if (entry.stage === 'SIGNALS') setScoring(true)
        else if (entry.clusterId) setDivingClusterId(entry.clusterId)
      }
      await Promise.all(resumed.map(entry => watchRun(entry.runId, controller.signal)))
      if (controller.signal.aborted) return
      await load()
      onChangedRef.current?.()
    } catch (error) {
      if (isPollAborted(error)) return
      // Background re-attach; the cards keep their state until the next load.
    } finally {
      if (pollAbort.current === controller) pollAbort.current = null
      // Clear only what this re-attach set, and only if still the owner: a
      // stage the user started meanwhile must keep its own spinner.
      for (const entry of resumed) {
        if (entry.stage === 'CLUSTER') setMapping(false)
        else if (entry.stage === 'SIGNALS') setScoring(false)
        else if (entry.clusterId) {
          const clusterId = entry.clusterId
          setDivingClusterId(current => (current === clusterId ? null : current))
        }
      }
    }
  }, [studyId, watchRun, load])

  useEffect(() => {
    void reattach()
  }, [reattach])

  const hasSignals = clusters.some(cluster => typeof cluster.metrics?.density === 'number')
  const divergent = divergence.filter(entry => entry.divergent)

  // Null until the run has reported once; gone again shortly after it completes.
  const liveState = live ? activity.get(live.runId) : null
  const sectionActivity = live && live.stage !== 'DEEP_DIVE' ? liveState : null
  const diveActivity = live && live.stage === 'DEEP_DIVE' ? liveState : null

  // Areas clustered before layout coordinates were persisted have no map;
  // hide it entirely rather than draw a partial one. A re-map regenerates it.
  const mapClusters = clusters.filter(
    (cluster): cluster is ClusterRow & { metrics: { layout: { x: number; y: number } } } =>
      Number.isFinite(cluster.metrics?.layout?.x) && Number.isFinite(cluster.metrics?.layout?.y)
  )

  return (
    <section className="mt-10 rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Areas of the field</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The field broken into technology areas, each measured for crowding and momentum. Area sizes are estimates
            from a sample.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={clusters.length ? 'outline' : 'default'}
            size="sm"
            onClick={() => void startStage('CLUSTER', undefined, setMapping, 'Could not map the areas')}
            disabled={mapping || !fieldMapReady}
          >
            {mapping ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Grid2x2 className="mr-2 h-3.5 w-3.5" />}
            {clusters.length ? 'Re-map areas' : 'Break into areas'}
          </Button>
          {clusters.length > 0 && (
            <Button
              variant={hasSignals ? 'outline' : 'default'}
              size="sm"
              onClick={() => void startStage('SIGNALS', undefined, setScoring, 'Could not measure the areas')}
              disabled={scoring}
            >
              {scoring ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <SignalHigh className="mr-2 h-3.5 w-3.5" />}
              {hasSignals ? 'Re-measure' : 'Measure areas'}
            </Button>
          )}
        </div>
      </div>

      <div className="px-5 py-5">
        {!fieldMapReady && (
          <p className="text-sm text-muted-foreground">Run the field map first — areas are cut from its footprint.</p>
        )}

        {fieldMapReady && loading && (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading areas…</span>
          </div>
        )}

        {fieldMapReady && !loading && loadFailed && !clusters.length && !mapping && (
          <p className="text-sm text-muted-foreground">
            The areas could not be loaded — {loadFailed}{' '}
            <Button
              variant="outline"
              size="sm"
              className="ml-2"
              onClick={() => {
                setLoading(true)
                void load()
              }}
            >
              Retry
            </Button>
          </p>
        )}

        {fieldMapReady && !loading && !loadFailed && !clusters.length && !mapping && (
          <p className="text-sm text-muted-foreground">
            No areas yet. Mapping reads the field&apos;s embedding vectors and groups families that describe similar
            work — it costs nothing to run.
          </p>
        )}

        <AnimatePresence>
          {sectionActivity && (
            <LiveActivityPanel
              key={sectionActivity.runId}
              variant="full"
              state={sectionActivity}
              className="mb-5"
              onDismiss={() => dismissRun(sectionActivity.runId)}
            />
          )}
        </AnimatePresence>

        {divergent.length > 0 && (
          <div className="mb-5 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <p className="text-sm font-medium text-foreground">The field uses vocabulary your scope does not</p>
            <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
              {divergent.map(entry => (
                <li key={entry.concept}>
                  “{entry.concept}” — word-based and meaning-based search agree on only {entry.overlapPct}% of results.
                  {entry.semanticOnlyVocabulary && <> Consider adding: {entry.semanticOnlyVocabulary}.</>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {mapClusters.length >= 2 && (
          <ClusterMap
            clusters={mapClusters.map(cluster => ({
              id: cluster.id,
              label: cluster.label,
              fieldEstimate: cluster.fieldEstimate,
              layout: cluster.metrics.layout,
            }))}
            selectedId={selectedClusterId}
            onSelect={id => {
              setSelectedClusterId(id)
              document
                .getElementById(`cluster-card-${id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }}
          />
        )}

        {clusters.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2">
            {clusters.map(cluster => {
              const metrics = cluster.metrics ?? {}
              const grade = GRADE_LABEL[String(metrics.grade ?? '')] ?? null
              const dive = cluster.deepDive
              const diveDone = dive?.status === 'COMPLETED' && dive.results
              const diving = divingClusterId === cluster.id
              return (
                <li
                  key={cluster.id}
                  id={`cluster-card-${cluster.id}`}
                  className={[
                    'flex flex-col rounded-md border p-4',
                    selectedClusterId === cluster.id ? 'border-primary/50' : 'border-border',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{cluster.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        ~{cluster.fieldEstimate.toLocaleString()} families (estimate)
                        {grade ? ` · ${grade}` : ''}
                      </p>
                    </div>
                  </div>
                  {cluster.description && (
                    <p className="mt-2 text-sm text-muted-foreground">{cluster.description}</p>
                  )}

                  {typeof metrics.density === 'number' && (
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      <Metric label="Density" value={metrics.density} format="unit" />
                      <Metric
                        label="5y filings"
                        value={metrics.velocityPct ?? null}
                        format="pct"
                      />
                      <Metric label="Crowding" value={metrics.crowdedness ?? null} format="unit" />
                    </div>
                  )}

                  {(metrics.topAssignees?.length ?? 0) > 0 && (
                    <p className="mt-3 truncate text-xs text-muted-foreground">
                      Active here: {metrics.topAssignees!.slice(0, 3).map(assignee => assignee.label).join(', ')}
                    </p>
                  )}

                  <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                    <span className="text-xs text-muted-foreground">
                      {diveDone
                        ? `Claims read for ${dive!.results!.familiesExtracted ?? 0} families`
                        : dive?.status === 'COMPLETED'
                          ? 'No claims readable in this area'
                          : 'Claims not read yet'}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void startStage(
                          'DEEP_DIVE',
                          { clusterId: cluster.id },
                          // Clear only if still the owner: starting dive B aborts
                          // dive A, whose finally must not wipe B's spinner and
                          // re-enable its button mid-run.
                          busy =>
                            setDivingClusterId(current =>
                              busy ? cluster.id : current === cluster.id ? null : current
                            ),
                          'Could not read the claims'
                        )
                      }}
                      disabled={diving}
                    >
                      {diving ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          Reading…
                        </>
                      ) : (
                        <>
                          <BookOpen className="mr-2 h-3.5 w-3.5" />
                          {diveDone ? 'Read again' : 'Read the claims'}
                        </>
                      )}
                    </Button>
                  </div>

                  <AnimatePresence>
                    {diveActivity && live?.clusterId === cluster.id && (
                      <LiveActivityPanel
                        key={diveActivity.runId}
                        variant="compact"
                        state={diveActivity}
                        className="mt-3"
                        onDismiss={() => dismissRun(diveActivity.runId)}
                      />
                    )}
                  </AnimatePresence>

                  <details className="mt-3 border-t border-border/60 pt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">How this was computed</summary>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {cluster.memberCount.toLocaleString()} sampled members
                      {cluster.silhouette !== null && ` · silhouette ${cluster.silhouette.toFixed(2)}`}
                      {cluster.cohesion !== null && ` · cohesion ${cluster.cohesion.toFixed(2)}`}
                      {cluster.separation !== null && ` · separation ${cluster.separation.toFixed(2)}`}
                      {typeof metrics.hhi === 'number' && ` · assignee HHI ${metrics.hhi.toFixed(2)}`}
                      {(metrics.cpcMix?.length ?? 0) > 0 &&
                        ` · CPC: ${metrics.cpcMix!.slice(0, 3).map(entry => entry.code).join(', ')}`}
                    </p>
                  </details>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

function Metric({ label, value, format }: { label: string; value: number | null; format: 'unit' | 'pct' }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      {value === null ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : format === 'pct' ? (
        <p className="text-sm tabular-nums text-foreground">
          {value > 0 ? '+' : ''}
          {value}%
        </p>
      ) : (
        <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
          <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
        </div>
      )}
    </div>
  )
}
