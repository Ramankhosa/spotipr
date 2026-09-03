'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import { AlertCircle, ArrowLeft, FileDown, Loader2, Play, Plus, RefreshCw, Save, Trash2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/lib/auth-context'
import { CORPUS_FIRST_YEAR, emptyWhitespaceScope } from '@/lib/whitespace/types'
import type { FieldMapResult, WhitespaceScope } from '@/lib/whitespace/types'
import { authHeaders, conflictRunId, isPollAborted, WATCH_TIMEOUT_STATUS, wsApi, type RunPayload } from './api'
import { ClustersPanel } from './ClustersPanel'
import { FieldRuleLadder, MatchRuleControl } from './FieldRulePanel'
import { HypothesesPanel } from './HypothesesPanel'
import { LiveActivityPanel } from './LiveActivityPanel'
import { SemanticSearchPanel } from './SemanticSearchPanel'
import { useRunActivity } from './useRunActivity'

interface StudyRow {
  id: string
  title: string
  seedText: string | null
  scope: WhitespaceScope
  scopeVersion: number
  status: string
  updatedAt: string
}

interface RunRow {
  id: string
  stage: string
  status: string
  scopeVersion: number
  durationMs: number | null
  lastError: string | null
  createdAt: string
  completedAt: string | null
}

/** What a COMPLETED field-map run's `results` holds. */
type FieldMapResults = FieldMapResult & { narrative?: string | null }

const api = wsApi

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)
const num = (value: number) => value.toLocaleString()

function scopeIsEmpty(scope: WhitespaceScope) {
  return scope.concepts.length === 0 && scope.classifications.length === 0
}

function OriginTag({ origin }: { origin: 'user' | 'copilot' }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        origin === 'user' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
      }`}
    >
      {origin === 'user' ? 'yours' : 'suggested'}
    </span>
  )
}

/**
 * Comma-separated list editor that lets the user actually type commas.
 *
 * `value={list.join(', ')}` with parse-on-change stripped a trailing comma on
 * the re-render, so the next character concatenated onto the previous term.
 * The raw string lives here and is parsed on blur; the model reseeds it
 * whenever the underlying list changes while the field is not being edited.
 */
function ListInput({
  values,
  onCommit,
  placeholder,
  className,
  transform,
}: {
  values: string[]
  onCommit: (items: string[]) => void
  placeholder?: string
  className?: string
  /** Applied to each parsed item (e.g. uppercasing jurisdiction codes). */
  transform?: (item: string) => string
}) {
  const joined = values.join(', ')
  const [raw, setRaw] = useState(joined)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setRaw(joined)
  }, [joined, editing])

  return (
    <Input
      value={raw}
      onFocus={() => setEditing(true)}
      onChange={e => setRaw(e.target.value)}
      onBlur={() => {
        setEditing(false)
        const items = raw
          .split(',')
          .map(s => (transform ? transform(s.trim()) : s.trim()))
          .filter(Boolean)
        if (JSON.stringify(items) !== JSON.stringify(values)) onCommit(items)
        else setRaw(joined)
      }}
      placeholder={placeholder}
      className={className}
    />
  )
}

/** Year field that tolerates being cleared mid-typing; parsed and clamped on blur. */
function YearInput({
  value,
  fallback,
  onCommit,
  className,
}: {
  value: number
  /** Used when the field is left empty or unparsable. */
  fallback: number
  onCommit: (year: number) => void
  className?: string
}) {
  const [raw, setRaw] = useState(String(value))
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setRaw(String(value))
  }, [value, editing])

  return (
    <Input
      type="number"
      value={raw}
      onFocus={() => setEditing(true)}
      onChange={e => setRaw(e.target.value)}
      onBlur={() => {
        setEditing(false)
        const parsed = Number.parseInt(raw, 10)
        const year = Number.isFinite(parsed) ? Math.min(Math.max(parsed, CORPUS_FIRST_YEAR), 2100) : fallback
        if (year !== value) onCommit(year)
        else setRaw(String(value))
      }}
      className={className}
    />
  )
}

function Bars({ rows, total }: { rows: Array<{ label: string; families: number; definition?: string }>; total: number }) {
  const max = rows.reduce((m, r) => Math.max(m, r.families), 0)
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing in range.</p>
  return (
    <ul className="space-y-2">
      {rows.map(row => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-foreground" title={row.definition || row.label}>
              {row.label}
              {row.definition && <span className="ml-2 text-xs text-muted-foreground">{row.definition}</span>}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {num(row.families)} · {pct(row.families, total)}%
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary"
              style={{ width: `${max > 0 ? Math.max(2, (row.families / max) * 100) : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function WhitespaceStudyApp({ studyId }: { studyId: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const { user, isLoading: authLoading } = useAuth()

  const [study, setStudy] = useState<StudyRow | null>(null)
  const [runs, setRuns] = useState<RunRow[]>([])
  const [scope, setScope] = useState<WhitespaceScope>(emptyWhitespaceScope())
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [compiling, setCompiling] = useState(false)
  /** Set after the server refuses to overwrite user edits; the next click confirms. */
  const [rebuildArmed, setRebuildArmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [run, setRun] = useState<RunPayload | null>(null)
  const [running, setRunning] = useState(false)
  // Bumped when a downstream panel changes shared state (e.g. re-clustering
  // invalidates hypotheses' cluster labels), forcing the sibling to refetch.
  const [panelEpoch, setPanelEpoch] = useState(0)
  const [downloadingReport, setDownloadingReport] = useState(false)

  const autoCompiled = useRef(false)

  // Live narration for the field map in flight. The panel reads the entry for
  // `watchedRunId`; the entry exists only while the run has reported.
  const activity = useRunActivity(studyId)
  const { watch: watchRun, dismiss: dismissRun } = activity
  const [watchedRunId, setWatchedRunId] = useState<string | null>(null)

  // One abort controller for the field-map watch this page owns. A census runs
  // for minutes; without it, navigating away left the loop polling — and
  // calling setState — from a component that no longer exists.
  const pollAbort = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      pollAbort.current?.abort()
    },
    []
  )
  /** The run currently being watched, so load() never double-attaches to it. */
  const watchingRun = useRef<string | null>(null)

  const patchScope = useCallback((updater: (draft: WhitespaceScope) => WhitespaceScope) => {
    setScope(current => updater(structuredClone(current)))
    setDirty(true)
  }, [])

  /**
   * Watches one field-map run to its terminal status, then shows its payload.
   * Shared by a fresh start, a 409 attach, and a reload that found the run
   * already in flight. `announceFailure` is false when re-attaching to a run
   * the user did not just start: reading a study whose last map failed a week
   * ago is not news, and the error toast fired on every single page load. The
   * failure stays visible in the panel either way.
   */
  const attachToFieldMap = useCallback(
    async (runId: string, options: { announceFailure?: boolean } = {}) => {
      const announceFailure = options.announceFailure ?? true
      if (watchingRun.current === runId) return
      pollAbort.current?.abort()
      const controller = new AbortController()
      pollAbort.current = controller
      watchingRun.current = runId
      setWatchedRunId(runId)
      setRunning(true)
      try {
        const final = await watchRun(runId, controller.signal)
        if (controller.signal.aborted) return
        // A stopped watch is not a run status: keep whatever was shown and let
        // the panel say "stopped watching" until the user reloads.
        if (final.status !== WATCH_TIMEOUT_STATUS) setRun(final)
        if (final.status === 'FAILED' && announceFailure) {
          toast({
            variant: 'error',
            title: 'Field map failed',
            description: final.error || 'The stage did not complete.',
          })
        }
      } catch (error) {
        if (isPollAborted(error)) return
        toast({
          variant: 'error',
          title: 'Lost track of the run',
          description: error instanceof Error ? error.message : 'Reload to check its status.',
        })
      } finally {
        if (watchingRun.current === runId) watchingRun.current = null
        if (pollAbort.current === controller) pollAbort.current = null
        if (!controller.signal.aborted) setRunning(false)
      }
    },
    [toast, watchRun]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await api<{ study: StudyRow; runs: RunRow[] }>(`/api/whitespace/studies/${studyId}`)
      setStudy(data.study)
      setScope(data.study.scope)
      setDirty(false)
      setRuns(data.runs || [])
      const latestFieldMap = (data.runs || []).find(r => r.stage === 'FIELD_MAP')
      if (latestFieldMap) {
        if (latestFieldMap.status === 'QUEUED' || latestFieldMap.status === 'PROCESSING') {
          // Still in flight after a reload: watch it rather than showing an
          // idle "Map the field" button over a working server.
          void attachToFieldMap(latestFieldMap.id, { announceFailure: false })
        } else {
          try {
            setRun(await api<RunPayload>(`/api/whitespace/studies/${studyId}/runs/${latestFieldMap.id}`))
          } catch (error) {
            toast({
              variant: 'error',
              title: 'Lost track of the run',
              description: error instanceof Error ? error.message : 'Reload to check its status.',
            })
          }
        }
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load this study.')
    } finally {
      setLoading(false)
    }
  }, [studyId, attachToFieldMap, toast])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setLoading(false)
      return
    }
    void load()
  }, [authLoading, user, load])

  const compile = useCallback(
    async (force: boolean) => {
      if (!study) return
      setCompiling(true)
      try {
        const data = await api<{ scope: WhitespaceScope; scopeVersion: number }>(
          `/api/whitespace/studies/${studyId}/scope/compile`,
          { method: 'POST', body: JSON.stringify({ brief: study.seedText || '', force }) }
        )
        setScope(data.scope)
        setDirty(false)
        setStudy(current =>
          current ? { ...current, scope: data.scope, scopeVersion: data.scopeVersion, title: data.scope.title || current.title } : current
        )
        setRebuildArmed(false)
      } catch (error) {
        const code = (error as { code?: string })?.code
        if (code === 'SCOPE_HAS_USER_EDITS') {
          // Arm the second click. The button used to send force=true whenever
          // the scope was non-empty, so this 409 could never be reached and a
          // single click silently replaced the user's own concepts and
          // classifications — while the toast promised a confirmation step that
          // did not exist.
          setRebuildArmed(true)
          toast({
            variant: 'warning',
            title: 'This scope has your edits',
            description: 'Press “Replace my scope” to confirm — your edits will be overwritten.',
          })
        } else {
          toast({
            variant: 'error',
            title: 'Could not build the scope',
            description: error instanceof Error ? error.message : 'Try again.',
          })
        }
      } finally {
        setCompiling(false)
      }
    },
    [study, studyId, toast]
  )

  // A study created from the list page arrives with an empty scope and a brief.
  // Compiling it on arrival is the step the user was promised, not a surprise.
  useEffect(() => {
    if (!study || autoCompiled.current) return
    if (scopeIsEmpty(study.scope) && (study.seedText || '').trim().length >= 20) {
      autoCompiled.current = true
      void compile(false)
    }
  }, [study, compile])

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

  const saveScope = useCallback(async () => {
    setSaving(true)
    try {
      const data = await api<{ study: StudyRow }>(`/api/whitespace/studies/${studyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ scope, title: scope.title || undefined }),
      })
      setStudy(current => (current ? { ...current, ...data.study, scope: data.study.scope } : data.study))
      setScope(data.study.scope)
      setDirty(false)
      toast({
        variant: 'success',
        title: `Scope saved as v${data.study.scopeVersion}`,
        description: 'Results computed against an earlier version are marked as such.',
      })
    } catch (error) {
      toast({
        variant: 'error',
        title: 'Could not save the scope',
        description: error instanceof Error ? error.message : 'Try again.',
      })
    } finally {
      setSaving(false)
    }
  }, [scope, studyId, toast])

  const startFieldMap = useCallback(async () => {
    setRunning(true)
    // A failed panel left from the previous map hands its display back now.
    if (watchedRunId) dismissRun(watchedRunId)
    try {
      const data = await api<{ runId: string }>(`/api/whitespace/studies/${studyId}/runs`, {
        method: 'POST',
        body: JSON.stringify({ stage: 'FIELD_MAP' }),
      })
      void attachToFieldMap(data.runId)
    } catch (error) {
      // 409 means this stage is already running — attach to it instead of
      // reporting a failure for work that is in fact under way.
      if ((error as { status?: number })?.status === 409) {
        toast({ variant: 'default', title: 'Already mapping', description: 'Showing the run in progress.' })
        const liveRunId = conflictRunId(error)
        if (liveRunId) void attachToFieldMap(liveRunId)
        else void load()
        return
      }
      setRunning(false)
      toast({
        variant: 'error',
        title: 'Could not start the field map',
        description: error instanceof Error ? error.message : 'Try again.',
      })
    }
  }, [studyId, attachToFieldMap, dismissRun, load, toast, watchedRunId])

  const runnable = useMemo(
    () => scope.concepts.some(c => c.label.trim()) || scope.classifications.some(c => c.accepted && c.code.trim()),
    [scope]
  )

  // ------------------------------------------------------------------ render

  if (authLoading || loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading study…</span>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-16">
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">Sign in to open this study.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => router.push('/login')}>
            Sign in
          </Button>
        </div>
      </div>
    )
  }

  if (loadError || !study) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-16">
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex-1">
            <p className="text-sm text-foreground">{loadError || 'Study not found.'}</p>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
              <Button variant="ghost" size="sm" onClick={() => router.push('/whitespace')}>
                Back to studies
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const results = run?.status === 'COMPLETED' ? (run.results as FieldMapResults | null) : null
  const staleResult = Boolean(results && run?.scopeStale)
  const mapActivity = activity.get(watchedRunId)
  // While the panel holds a failure it shows the server's message itself;
  // Dismiss hands the display back to the plain error box.
  const panelHoldsFailure = mapActivity?.status === 'FAILED' || mapActivity?.status === WATCH_TIMEOUT_STATUS

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
      <Link
        href="/whitespace"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All studies
      </Link>

      <header className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl leading-tight text-foreground">{study.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Scope v{study.scopeVersion} · corpus from {CORPUS_FIRST_YEAR} · {runs.length}{' '}
            {runs.length === 1 ? 'run' : 'runs'}
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

      {/* ------------------------------------------------------------ scope */}
      <section className="mb-10 rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">The premise</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Everything below is searched literally. Correct it before you trust any number that follows.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void compile(rebuildArmed)}
              disabled={compiling}
              title={
                rebuildArmed
                  ? 'This replaces the concepts and classifications you edited.'
                  : 'Re-reads your brief and drafts the scope again.'
              }
            >
              {compiling ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-2 h-3.5 w-3.5" />}
              {rebuildArmed ? 'Replace my scope' : 'Rebuild scope'}
            </Button>
            <Button size="sm" onClick={() => void saveScope()} disabled={!dirty || saving}>
              {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
              Save scope
            </Button>
          </div>
        </div>

        {compiling && scopeIsEmpty(scope) ? (
          <div className="flex items-center gap-2 px-5 py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Reading your brief and drafting the scope…</span>
          </div>
        ) : (
          <div className="space-y-8 px-5 py-5">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Title
              </label>
              <Input
                value={scope.title}
                onChange={e => patchScope(d => ({ ...d, title: e.target.value }))}
                placeholder="What this study is about"
              />
              <label className="mb-1.5 mt-4 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What we understood
              </label>
              <Textarea
                value={scope.summary}
                onChange={e => patchScope(d => ({ ...d, summary: e.target.value }))}
                rows={3}
                placeholder="A restatement of the field in plain language."
              />
            </div>

            {/* concepts */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Concepts ({scope.concepts.length})
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    patchScope(d => ({
                      ...d,
                      concepts: [
                        ...d.concepts,
                        { id: `c-${d.concepts.length + 1}-${Math.random().toString(36).slice(2, 7)}`, label: '', synonyms: [], required: true, origin: 'user' },
                      ],
                    }))
                  }
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add
                </Button>
              </div>
              {scope.concepts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No concepts yet.</p>
              ) : (
                <ul className="space-y-3">
                  {scope.concepts.map((concept, index) => (
                    <li key={concept.id || index} className="rounded-md border border-border p-3">
                      <div className="flex items-center gap-2">
                        <Input
                          value={concept.label}
                          onChange={e =>
                            patchScope(d => {
                              d.concepts[index] = { ...d.concepts[index], label: e.target.value, origin: 'user' }
                              return d
                            })
                          }
                          placeholder="Concept, as you would say it"
                          className="flex-1"
                        />
                        <OriginTag origin={concept.origin} />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => patchScope(d => ({ ...d, concepts: d.concepts.filter((_, i) => i !== index) }))}
                          aria-label="Remove concept"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <ListInput
                        values={concept.synonyms}
                        onCommit={items =>
                          patchScope(d => {
                            d.concepts[index] = { ...d.concepts[index], synonyms: items, origin: 'user' }
                            return d
                          })
                        }
                        placeholder="How patents say it — functional phrasing, jargon, acronyms (comma separated)"
                        className="mt-2 text-sm"
                      />
                      <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                          checked={concept.required}
                          onCheckedChange={checked =>
                            patchScope(d => {
                              d.concepts[index] = { ...d.concepts[index], required: checked, origin: 'user' }
                              return d
                            })
                          }
                        />
                        Must appear in every document (unchecked: counts toward the match rule below)
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {scope.concepts.length > 0 && (
                <div className="mt-4 rounded-md border border-dashed border-border p-3">
                  <MatchRuleControl
                    scope={scope}
                    disabled={running}
                    onChange={matching => patchScope(d => ({ ...d, matching }))}
                  />
                </div>
              )}
            </div>

            {/* classifications */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Classifications ({scope.classifications.filter(c => c.accepted).length} of {scope.classifications.length} accepted)
              </h3>
              {scope.classifications.length === 0 ? (
                <p className="text-sm text-muted-foreground">None suggested.</p>
              ) : (
                <ul className="space-y-2">
                  {scope.classifications.map((cls, index) => (
                    <li key={`${cls.code}-${index}`} className="flex items-start gap-3 rounded-md border border-border p-3">
                      <Checkbox
                        checked={cls.accepted}
                        onCheckedChange={checked =>
                          patchScope(d => {
                            d.classifications[index] = { ...d.classifications[index], accepted: checked }
                            return d
                          })
                        }
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm text-foreground">{cls.code}</span>
                          <OriginTag origin={cls.origin} />
                        </div>
                        {cls.definition && <p className="mt-0.5 text-xs text-muted-foreground">{cls.definition}</p>}
                        {cls.caution && (
                          <p className="mt-1 text-xs text-amber-700 dark:text-amber-500">Caution: {cls.caution}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* assumptions */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Assumptions ({scope.assumptions.length})
              </h3>
              {scope.assumptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">None recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {scope.assumptions.map((assumption, index) => (
                    <li key={assumption.id || index} className="flex items-start gap-3 rounded-md border border-border p-3">
                      <span className="mt-0.5 shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {assumption.kind}
                      </span>
                      <p className="flex-1 text-sm text-foreground">{assumption.text}</p>
                      {assumption.kind === 'interpretation' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => patchScope(d => ({ ...d, assumptions: d.assumptions.filter((_, i) => i !== index) }))}
                          aria-label="Remove assumption"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* exclusions + filters */}
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Excluded terms
                </label>
                <ListInput
                  values={scope.exclusions.map(e => e.term)}
                  onCommit={items =>
                    patchScope(d => ({
                      ...d,
                      exclusions: items.map(term => ({
                        term,
                        reason: d.exclusions.find(x => x.term === term)?.reason,
                        origin: d.exclusions.find(x => x.term === term)?.origin ?? 'user',
                      })),
                    }))
                  }
                  placeholder="Comma separated"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Jurisdictions
                </label>
                <ListInput
                  values={scope.filters.jurisdictions}
                  transform={item => item.toUpperCase()}
                  onCommit={items =>
                    patchScope(d => ({
                      ...d,
                      filters: { ...d.filters, jurisdictions: items },
                    }))
                  }
                  placeholder="US, EP, IN — empty means all"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Filing years
                </label>
                <div className="flex items-center gap-2">
                  <YearInput
                    value={scope.filters.yearFrom}
                    fallback={CORPUS_FIRST_YEAR}
                    onCommit={year => patchScope(d => ({ ...d, filters: { ...d.filters, yearFrom: year } }))}
                    className="w-28"
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <YearInput
                    value={scope.filters.yearTo}
                    fallback={scope.filters.yearTo}
                    onCommit={year => patchScope(d => ({ ...d, filters: { ...d.filters, yearTo: year } }))}
                    className="w-28"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Assignees
                </label>
                <ListInput
                  values={scope.filters.assignees}
                  onCommit={items =>
                    patchScope(d => ({
                      ...d,
                      filters: { ...d.filters, assignees: items },
                    }))
                  }
                  placeholder="Empty means all"
                />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* --------------------------------------------------------- field map */}
      <section className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Field map</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              How much has been filed, by whom, where — and how much of it we can actually read.
            </p>
          </div>
          <Button size="sm" onClick={() => void startFieldMap()} disabled={running || !runnable || dirty}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Mapping…
              </>
            ) : (
              <>
                {results ? <RefreshCw className="mr-2 h-3.5 w-3.5" /> : <Play className="mr-2 h-3.5 w-3.5" />}
                {results ? 'Run again' : 'Map the field'}
              </>
            )}
          </Button>
        </div>

        <div className="px-5 py-5">
          {!runnable && (
            <p className="mb-4 text-sm text-muted-foreground">
              Add at least one concept, or accept one classification, before running.
            </p>
          )}
          {dirty && (
            <p className="mb-4 text-sm text-amber-700 dark:text-amber-500">
              Save the scope first — otherwise the map would answer the old question.
            </p>
          )}
          {staleResult && (
            <p className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-500">
              These numbers were computed against scope v{run?.scopeVersion}. The scope is now v
              {run?.currentScopeVersion}. Run again to bring them in line.
            </p>
          )}
          {run?.status === 'FAILED' && !panelHoldsFailure && (
            <div className="mb-4 flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm text-foreground">{run.error || 'The stage failed.'}</p>
            </div>
          )}

          <AnimatePresence>
            {mapActivity && (
              <LiveActivityPanel
                key={mapActivity.runId}
                variant="full"
                state={mapActivity}
                className="mb-4"
                footnote="This stage reads the corpus only and costs nothing. You can leave this page — the census continues."
                onDismiss={() => dismissRun(mapActivity.runId)}
              />
            )}
          </AnimatePresence>

          {!results && !running && !mapActivity && run?.status !== 'FAILED' && (
            <p className="text-sm text-muted-foreground">
              No map yet. Once the scope reads correctly, run it — this stage only reads the corpus and costs you
              nothing.
            </p>
          )}

          {results && (
            <div className="space-y-8">
              {results.narrative && (
                <p className="text-sm leading-relaxed text-foreground">{results.narrative}</p>
              )}

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  { label: 'Families', value: num(results.familyCount) },
                  { label: 'Publications', value: num(results.publicationCount) },
                  {
                    label: 'Claims readable',
                    value: `${pct(results.textCoverage.withClaims, results.textCoverage.familiesTotal)}%`,
                  },
                  {
                    label: 'Granted (proxy)',
                    value: `${pct(results.statusProxy.granted, results.familyCount)}%`,
                  },
                ].map(stat => (
                  <div key={stat.label} className="rounded-md border border-border p-3">
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="mt-1 font-serif text-2xl text-foreground tabular-nums">{stat.value}</p>
                  </div>
                ))}
              </div>

              {results.fieldRule && <FieldRuleLadder rule={results.fieldRule} />}

              {/* Only measured steps are rendered. `corpus` and `afterFilters`
                  are null because the census evaluates the whole scope predicate
                  in one pass and never counts those populations — they used to
                  be filled with the post-concept count, which drew 66/66/66 as
                  though the scope had narrowed twice. A funnel of one step is
                  not a funnel, so it stays hidden until there are two. */}
              {(() => {
                const measured = [
                  { label: 'Corpus', value: results.gateCounts.corpus },
                  { label: 'After filters', value: results.gateCounts.afterFilters },
                  { label: 'After concepts', value: results.gateCounts.afterConcepts },
                ].filter((gate): gate is { label: string; value: number } => typeof gate.value === 'number')
                if (measured.length < 2) return null
                return (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      How the count narrows
                    </h3>
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[...measured, { label: 'Families', value: results.gateCounts.families }].map(gate => (
                        <li key={gate.label} className="rounded-md bg-muted/50 p-3">
                          <p className="text-xs text-muted-foreground">{gate.label}</p>
                          <p className="mt-0.5 text-sm tabular-nums text-foreground">{num(gate.value)}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })()}

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Filings by year
                </h3>
                <div className="flex items-end gap-1 overflow-x-auto pb-1">
                  {results.filingsByYear.map(point => {
                    const max = results.filingsByYear.reduce((m, p) => Math.max(m, p.families), 1)
                    const lagYear = new Date().getFullYear() - Math.ceil(results.publicationLagMonths / 12)
                    const incomplete = point.year > lagYear
                    return (
                      <div key={point.year} className="flex min-w-[18px] flex-1 flex-col items-center gap-1">
                        <div
                          className={`w-full rounded-t ${incomplete ? 'bg-primary/25' : 'bg-primary'}`}
                          style={{ height: `${Math.max(2, (point.families / max) * 120)}px` }}
                          title={`${point.year}: ${num(point.families)} families${incomplete ? ' (incomplete — publication lag)' : ''}`}
                        />
                        <span className="text-[9px] tabular-nums text-muted-foreground">{`'${String(point.year).slice(2)}`}</span>
                      </div>
                    )
                  })}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Pale bars are inside the ~{results.publicationLagMonths}-month publication lag: those years are
                  structurally undercounted, not declining.
                </p>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Where it is filed
                  </h3>
                  <Bars rows={results.jurisdictions.slice(0, 8)} total={results.familyCount} />
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Who is filing
                  </h3>
                  <Bars rows={results.assignees.slice(0, 8)} total={results.familyCount} />
                </div>
                <div className="sm:col-span-2">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Classifications in play
                  </h3>
                  <Bars rows={results.classifications.slice(0, 10)} total={results.familyCount} />
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  What we can actually read
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Country</th>
                        <th className="py-2 pr-4 text-right font-medium">Families</th>
                        <th className="py-2 text-right font-medium">With claims</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.textCoverage.byJurisdiction.slice(0, 10).map(row => (
                        <tr key={row.country} className="border-b border-border/60 last:border-0">
                          <td className="py-2 pr-4 text-foreground">{row.country}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">{num(row.families)}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">
                            {num(row.withClaims)} · {pct(row.withClaims, row.families)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {results.coverageNotes.length > 0 && (
                <div className="rounded-md border border-border bg-muted/40 p-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Read this before drawing conclusions
                  </h3>
                  <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                    {results.coverageNotes.map((note, index) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Stages 2-4: areas, signals, deep dives. */}
      <ClustersPanel
        studyId={studyId}
        fieldMapReady={Boolean(results)}
        onChanged={() => setPanelEpoch(epoch => epoch + 1)}
      />

      {results && (
        <div className="mt-10">
          <SemanticSearchPanel studyId={studyId} />
        </div>
      )}

      {/* Stages 5-7: hypotheses, validation, concepts. refreshToken (not key):
          a remount on every upstream stage completion destroyed an in-progress
          review draft and the scroll position. */}
      <HypothesesPanel refreshToken={panelEpoch} studyId={studyId} areasReady={Boolean(results)} />
    </div>
  )
}
