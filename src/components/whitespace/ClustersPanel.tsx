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

import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Grid2x2, Loader2, SignalHigh } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { pollRun, wsApi } from './api'

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
  const [mapping, setMapping] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [divingClusterId, setDivingClusterId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await wsApi<{ clusters: ClusterRow[]; signals: { divergence?: Divergence[] } | null }>(
        `/api/whitespace/studies/${studyId}/clusters`
      )
      setClusters(data.clusters)
      setDivergence(data.signals?.divergence ?? [])
    } catch {
      // The section renders its empty state; the study page surfaces auth errors.
    } finally {
      setLoading(false)
    }
  }, [studyId])

  useEffect(() => {
    void load()
  }, [load])

  const startStage = useCallback(
    async (
      stage: 'CLUSTER' | 'SIGNALS' | 'DEEP_DIVE',
      params: Record<string, string> | undefined,
      setBusy: (busy: boolean) => void,
      failTitle: string
    ) => {
      setBusy(true)
      try {
        const started = await wsApi<{ runId: string }>(`/api/whitespace/studies/${studyId}/runs`, {
          method: 'POST',
          body: JSON.stringify({ stage, params }),
        })
        const final = await pollRun(studyId, started.runId)
        if (final.status === 'FAILED') {
          toast({ variant: 'error', title: failTitle, description: final.error || 'The stage did not complete.' })
        }
        await load()
        onChanged?.()
      } catch (error) {
        toast({
          variant: 'error',
          title: failTitle,
          description: error instanceof Error ? error.message : 'Try again.',
        })
      } finally {
        setBusy(false)
      }
    },
    [studyId, toast, load, onChanged]
  )

  const hasSignals = clusters.some(cluster => typeof cluster.metrics?.density === 'number')
  const divergent = divergence.filter(entry => entry.divergent)

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

        {fieldMapReady && !loading && !clusters.length && !mapping && (
          <p className="text-sm text-muted-foreground">
            No areas yet. Mapping reads the field&apos;s embedding vectors and groups families that describe similar
            work — it costs nothing to run.
          </p>
        )}

        {mapping && !clusters.length && (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Grouping the field into areas…</span>
          </div>
        )}

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

        {clusters.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2">
            {clusters.map(cluster => {
              const metrics = cluster.metrics ?? {}
              const grade = GRADE_LABEL[String(metrics.grade ?? '')] ?? null
              const dive = cluster.deepDive
              const diveDone = dive?.status === 'COMPLETED' && dive.results
              const diving = divingClusterId === cluster.id
              return (
                <li key={cluster.id} className="flex flex-col rounded-md border border-border p-4">
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
                        setDivingClusterId(cluster.id)
                        void startStage(
                          'DEEP_DIVE',
                          { clusterId: cluster.id },
                          busy => setDivingClusterId(busy ? cluster.id : null),
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
