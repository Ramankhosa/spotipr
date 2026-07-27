'use client'

/**
 * Super Admin Retrieval Tuning
 *
 * Runtime control over the novelty search funnel — candidate caps, rerank cutoff,
 * deep-analysis ceiling, claims depth — plus provider access toggles and a
 * calibration harness for picking those values from evidence.
 *
 * The settings form is generated from the server-side registry, so a new tunable
 * appears here automatically without touching this file.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import {
  AlertTriangle, BarChart3, CheckCircle2, ChevronDown, FlaskConical, Loader2,
  RotateCcw, Save, Server, SlidersHorizontal,
} from 'lucide-react'

interface SettingRow {
  key: string
  label: string
  description: string
  category: string
  type: 'int' | 'float' | 'boolean'
  default: number | boolean
  min?: number
  max?: number
  envVar?: string
  value: number | boolean
  isOverridden: boolean
  updatedAt: string | null
  updatedBy: string | null
}

interface ProviderRow {
  providerId: string
  label: string
  jurisdictions: string[]
  codeEnabled: boolean
  adminEnabled: boolean
  allowAsFallback: boolean
  effectiveEnabled: boolean
  isOverridden: boolean
  notes: string | null
}

interface CategoryRow { id: string; label: string; description: string }
interface BenchmarkRow { id: string; title: string; jurisdiction: string | null; createdAt: string; status: string }
interface CalibrationRunRow {
  id: string; label: string; status: string; error: string | null
  configJson: Record<string, unknown>; searchIds: string[]; baselineId: string | null
  startedAt: string; completedAt: string | null
}

const numberFormat = new Intl.NumberFormat('en-US')

export default function RetrievalTuningPage() {
  const { authFetch } = useAuth()

  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [settings, setSettings] = useState<SettingRow[]>([])
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [access, setAccess] = useState<'full' | 'read-only'>('read-only')
  const [draft, setDraft] = useState<Record<string, number | boolean>>({})
  const [providerDraft, setProviderDraft] = useState<Record<string, { enabled: boolean; allowAsFallback: boolean }>>({})

  const [benchmarks, setBenchmarks] = useState<BenchmarkRow[]>([])
  const [runs, setRuns] = useState<CalibrationRunRow[]>([])
  const [selectedSearchIds, setSelectedSearchIds] = useState<string[]>([])
  const [calibrationLabel, setCalibrationLabel] = useState('')
  const [baselineRunId, setBaselineRunId] = useState('')
  const [activeRun, setActiveRun] = useState<any>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [calibrating, setCalibrating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showCalibration, setShowCalibration] = useState(false)

  const readOnly = access !== 'full'

  const loadConfig = useCallback(async () => {
    try {
      const [configResponse, benchmarkResponse, runsResponse] = await Promise.all([
        authFetch('/api/super-admin/retrieval-tuning'),
        authFetch('/api/super-admin/retrieval-tuning?action=benchmarks'),
        authFetch('/api/super-admin/retrieval-tuning?action=runs'),
      ])
      if (!configResponse.ok) {
        const body = await configResponse.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to load retrieval settings.')
      }
      const config = await configResponse.json()
      setCategories(config.categories || [])
      setSettings(config.settings || [])
      setProviders(config.providers || [])
      setAccess(config.access || 'read-only')
      setDraft(Object.fromEntries((config.settings || []).map((row: SettingRow) => [row.key, row.value])))
      setProviderDraft(Object.fromEntries((config.providers || []).map((row: ProviderRow) => [
        row.providerId, { enabled: row.adminEnabled, allowAsFallback: row.allowAsFallback },
      ])))

      if (benchmarkResponse.ok) setBenchmarks((await benchmarkResponse.json()).benchmarks || [])
      if (runsResponse.ok) setRuns((await runsResponse.json()).runs || [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load retrieval settings.')
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => { void loadConfig() }, [loadConfig])

  const dirtyKeys = useMemo(
    () => settings.filter(row => draft[row.key] !== row.value).map(row => row.key),
    [settings, draft]
  )
  const providerDirty = useMemo(
    () => providers.some(row => {
      const next = providerDraft[row.providerId]
      return next && (next.enabled !== row.adminEnabled || next.allowAsFallback !== row.allowAsFallback)
    }),
    [providers, providerDraft]
  )
  const isDirty = dirtyKeys.length > 0 || providerDirty

  const save = async () => {
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await authFetch('/api/super-admin/retrieval-tuning', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: Object.fromEntries(dirtyKeys.map(key => [key, draft[key]])),
          providers: providers
            .filter(row => {
              const next = providerDraft[row.providerId]
              return next && (next.enabled !== row.adminEnabled || next.allowAsFallback !== row.allowAsFallback)
            })
            .map(row => ({ providerId: row.providerId, ...providerDraft[row.providerId] })),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to save.')
      setSettings(body.settings || [])
      setProviders(body.providers || [])
      setDraft(Object.fromEntries((body.settings || []).map((row: SettingRow) => [row.key, row.value])))
      setProviderDraft(Object.fromEntries((body.providers || []).map((row: ProviderRow) => [
        row.providerId, { enabled: row.adminEnabled, allowAsFallback: row.allowAsFallback },
      ])))
      setNotice('Saved. New searches pick this up within the settings cache window (~30s).')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  const resetAll = async () => {
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await authFetch('/api/super-admin/retrieval-tuning', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to reset.')
      setSettings(body.settings || [])
      setDraft(Object.fromEntries((body.settings || []).map((row: SettingRow) => [row.key, row.value])))
      setNotice('All settings reset to their defaults.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to reset.')
    } finally {
      setSaving(false)
    }
  }

  const runCalibration = async () => {
    if (!selectedSearchIds.length) { setError('Select at least one benchmark search.'); return }
    setCalibrating(true); setError(''); setNotice(''); setActiveRun(null)
    try {
      const response = await authFetch('/api/super-admin/retrieval-tuning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: calibrationLabel.trim() || `Calibration ${new Date().toISOString().slice(0, 16)}`,
          searchIds: selectedSearchIds,
          // The unsaved draft is what gets tested, so a config can be evaluated
          // before it is ever applied to live traffic.
          configOverride: Object.fromEntries(settings.map(row => [row.key, draft[row.key]])),
          baselineRunId: baselineRunId || undefined,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Calibration failed.')
      setActiveRun(body.results)
      setNotice(`Calibration complete across ${body.results?.summary?.okCount ?? 0} searches.`)
      const runsResponse = await authFetch('/api/super-admin/retrieval-tuning?action=runs')
      if (runsResponse.ok) setRuns((await runsResponse.json()).runs || [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Calibration failed.')
    } finally {
      setCalibrating(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-200" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map(index => <div key={index} className="h-32 animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Retrieval tuning</h1>
        <p className="mt-1 max-w-prose text-sm text-slate-600">
          Controls how the novelty pipeline narrows the corpus down to the references that reach
          analysis. Changes apply to new searches without a redeploy.
        </p>
      </header>

      {readOnly && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>You have read-only super admin access. Values are shown but cannot be changed.</span>
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {notice && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> <span>{notice}</span>
        </div>
      )}

      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
        <strong className="font-semibold text-slate-800">Not tunable here:</strong> the embedding model,
        dimensions and dtype. Those must match the vectors already stored in the corpus — changing one at
        runtime would make every vector query match zero rows while search still appeared to work. They stay
        environment-only.
      </div>

      {/* ---------------------------------------------------------------- settings */}
      {categories.map(category => {
        const rows = settings.filter(row => row.category === category.id)
        if (!rows.length) return null
        return (
          <section key={category.id} className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-start gap-3 border-b border-slate-100 pb-4">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ai-blue-50 text-ai-blue-600">
                <SlidersHorizontal className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">{category.label}</h2>
                <p className="mt-0.5 max-w-prose text-xs text-slate-500">{category.description}</p>
              </div>
            </div>

            <div className="space-y-4">
              {rows.map(row => {
                const value = draft[row.key]
                const changed = value !== row.value
                return (
                  <div key={row.key} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
                    <div className="min-w-0">
                      <label htmlFor={row.key} className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
                        {row.label}
                        {row.isOverridden && (
                          <span className="rounded-full bg-ai-blue-50 px-2 py-0.5 text-[11px] font-semibold text-ai-blue-700">
                            overridden
                          </span>
                        )}
                        {changed && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                            unsaved
                          </span>
                        )}
                      </label>
                      <p className="mt-1 max-w-prose text-xs leading-5 text-slate-500">{row.description}</p>
                      <p className="mt-1 font-mono text-[11px] text-slate-400">
                        {row.key}
                        {' · default '}
                        {typeof row.default === 'boolean' ? String(row.default) : numberFormat.format(row.default)}
                        {typeof row.min === 'number' && typeof row.max === 'number'
                          ? ` · range ${numberFormat.format(row.min)}–${numberFormat.format(row.max)}`
                          : ''}
                        {row.envVar ? ` · ${row.envVar}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 sm:justify-end">
                      {row.type === 'boolean' ? (
                        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-700">
                          <input
                            id={row.key}
                            type="checkbox"
                            disabled={readOnly}
                            checked={Boolean(value)}
                            onChange={event => setDraft(current => ({ ...current, [row.key]: event.target.checked }))}
                            className="h-4 w-4 accent-ai-blue-600"
                          />
                          {value ? 'Enabled' : 'Disabled'}
                        </label>
                      ) : (
                        <input
                          id={row.key}
                          type="number"
                          disabled={readOnly}
                          value={String(value ?? '')}
                          min={row.min}
                          max={row.max}
                          step={row.type === 'float' ? 0.01 : 1}
                          onChange={event => setDraft(current => ({
                            ...current,
                            [row.key]: row.type === 'float' ? Number(event.target.value) : Math.trunc(Number(event.target.value)),
                          }))}
                          className="h-11 w-32 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 outline-none focus:border-ai-blue-400 focus:ring-2 focus:ring-ai-blue-500/15 disabled:bg-slate-50"
                        />
                      )}
                      <button
                        type="button"
                        disabled={readOnly || value === row.default}
                        onClick={() => setDraft(current => ({ ...current, [row.key]: row.default }))}
                        title="Reset to default"
                        aria-label={`Reset ${row.label} to default`}
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      {/* -------------------------------------------------------------- providers */}
      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-start gap-3 border-b border-slate-100 pb-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ai-blue-50 text-ai-blue-600">
            <Server className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Provider access</h2>
            <p className="mt-0.5 max-w-prose text-xs text-slate-500">
              Corpus providers answer searches directly. Live APIs are only dispatched when the corpus
              returns nothing, so <em>fallback</em> is where metered spend happens.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {providers.map(row => {
            const next = providerDraft[row.providerId] || { enabled: row.adminEnabled, allowAsFallback: row.allowAsFallback }
            return (
              <div key={row.providerId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{row.label}</span>
                    <span className="font-mono text-[11px] text-slate-400">{row.providerId}</span>
                    {!row.codeEnabled && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                        not configured
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {row.jurisdictions?.includes('*') ? 'All jurisdictions' : (row.jurisdictions || []).join(', ') || '—'}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      disabled={readOnly || !row.codeEnabled}
                      checked={next.enabled}
                      onChange={event => setProviderDraft(current => ({
                        ...current,
                        [row.providerId]: { ...next, enabled: event.target.checked },
                      }))}
                      className="h-4 w-4 accent-ai-blue-600"
                    />
                    Enabled
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      disabled={readOnly || !row.codeEnabled || !next.enabled}
                      checked={next.allowAsFallback}
                      onChange={event => setProviderDraft(current => ({
                        ...current,
                        [row.providerId]: { ...next, allowAsFallback: event.target.checked },
                      }))}
                      className="h-4 w-4 accent-ai-blue-600"
                    />
                    Fallback
                  </label>
                </div>
              </div>
            )
          })}
          {!providers.length && <p className="py-6 text-center text-sm text-slate-500">No providers registered.</p>}
        </div>
      </section>

      {/* ------------------------------------------------------------ calibration */}
      <section className="mb-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setShowCalibration(current => !current)}
          aria-expanded={showCalibration}
          className="flex w-full items-start justify-between gap-3 p-5 text-left"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lamp-50 text-lamp-600">
              <FlaskConical className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Calibration</h2>
              <p className="mt-0.5 max-w-prose text-xs text-slate-500">
                Replay past searches under the current draft config and compare. Retrieval and reranking
                only — no LLM analysis is run, so a sweep costs embedding and rerank calls, not deep analysis.
              </p>
            </div>
          </div>
          <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform ${showCalibration ? 'rotate-180' : ''}`} />
        </button>

        {showCalibration && (
          <div className="space-y-4 border-t border-slate-100 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-slate-600">Run label
                <input
                  value={calibrationLabel}
                  onChange={event => setCalibrationLabel(event.target.value)}
                  placeholder="e.g. rerank floor 0.35"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900 outline-none focus:border-ai-blue-400"
                />
              </label>
              <label className="text-xs font-medium text-slate-600">Compare against
                <select
                  value={baselineRunId}
                  onChange={event => setBaselineRunId(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900"
                >
                  <option value="">No baseline</option>
                  {runs.filter(run => run.status === 'COMPLETED').map(run => (
                    <option key={run.id} value={run.id}>{run.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">
                  Benchmark searches ({selectedSearchIds.length} selected)
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedSearchIds(
                    selectedSearchIds.length ? [] : benchmarks.slice(0, 10).map(row => row.id)
                  )}
                  className="text-xs font-medium text-ai-blue-700 hover:underline"
                >
                  {selectedSearchIds.length ? 'Clear' : 'Select first 10'}
                </button>
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                {benchmarks.map(row => {
                  const checked = selectedSearchIds.includes(row.id)
                  return (
                    <label key={row.id} className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${checked ? 'bg-ai-blue-50' : 'hover:bg-slate-50'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelectedSearchIds(current => checked
                          ? current.filter(id => id !== row.id)
                          : [...current, row.id])}
                        className="h-4 w-4 accent-ai-blue-600"
                      />
                      <span className="min-w-0 flex-1 truncate text-slate-800">{row.title || 'Untitled search'}</span>
                      <span className="shrink-0 text-xs text-slate-400">{String(row.createdAt).slice(0, 10)}</span>
                    </label>
                  )
                })}
                {!benchmarks.length && (
                  <p className="py-6 text-center text-sm text-slate-500">
                    No past searches available yet. Run a novelty search first — calibration replays real queries.
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void runCalibration()}
              disabled={readOnly || calibrating || !selectedSearchIds.length}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-lamp-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-lamp-700 disabled:opacity-50"
            >
              {calibrating ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
              {calibrating ? 'Replaying searches…' : 'Run calibration'}
            </button>

            {activeRun && (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="grid gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Searches', value: `${activeRun.summary.okCount}/${activeRun.summary.searchCount}` },
                    { label: 'Mean candidates', value: numberFormat.format(activeRun.summary.meanCandidateCount) },
                    { label: 'Dropped by floor', value: numberFormat.format(activeRun.summary.totalDroppedBelowFloor) },
                    { label: 'Mean duration', value: `${numberFormat.format(activeRun.summary.meanDurationMs)} ms` },
                  ].map(stat => (
                    <div key={stat.label} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-xs text-slate-500">{stat.label}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">{stat.value}</div>
                    </div>
                  ))}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-3 font-medium">Search</th>
                        <th className="py-2 pr-3 font-medium">Candidates</th>
                        <th className="py-2 pr-3 font-medium">Max</th>
                        <th className="py-2 pr-3 font-medium">Median</th>
                        <th className="py-2 font-medium">Min</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeRun.searches.map((row: any) => (
                        <tr key={row.searchId}>
                          <td className="max-w-[220px] truncate py-2 pr-3 text-slate-800" title={row.title}>
                            {row.title || row.searchId}
                            {!row.ok && <span className="ml-2 text-xs text-red-600">{row.error}</span>}
                          </td>
                          <td className="py-2 pr-3 text-slate-600">{row.candidateCount}</td>
                          <td className="py-2 pr-3 font-mono text-xs text-slate-600">{row.scores.max ?? '—'}</td>
                          <td className="py-2 pr-3 font-mono text-xs text-slate-600">{row.scores.median ?? '—'}</td>
                          <td className="py-2 font-mono text-xs text-slate-600">{row.scores.min ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-xs leading-5 text-slate-600">
                  Read the median and min columns to choose <code className="font-mono">rerank.minScore</code>:
                  a floor set between the median of good matches and the max of weak ones removes filler
                  without losing genuine art.
                </p>

                {activeRun.comparison && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
                    <span className="font-semibold text-slate-800">
                      {Math.round(activeRun.comparison.meanOverlapRatio * 100)}% mean overlap
                    </span>{' '}
                    with the baseline run. A high overlap means this config changed ordering more than membership.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ save bar */}
      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
        <span className="text-sm text-slate-600">
          {isDirty
            ? `${dirtyKeys.length} setting${dirtyKeys.length === 1 ? '' : 's'}${providerDirty ? ' and provider access' : ''} changed`
            : 'No unsaved changes'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void resetAll()}
            disabled={readOnly || saving}
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" /> Reset all
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={readOnly || saving || !isDirty}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-ai-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-ai-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
