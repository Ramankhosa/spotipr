'use client'

// Check Coverage — the attorney-facing source-coverage experience.
//
// Renders an inline entry card (button + status chip) and a right-side drawer.
// The main view is the COVERAGE MAP: a table anchored to the Stage-0
// components and features — element name | where it landed in the draft — with
// a WhatsApp-style double tick for traced items, hover popups showing the
// matched draft lines, and inline "Mark reviewed" for anything open. Excluded
// material appears at the end of the same table so one scan answers "what was
// used, where, and what was not". Review marks persist on the draft row
// (save_coverage_review) keyed by the report's stable content hashes.
//
// Language rule: positive traceability wording only — items are stated
// factually ("Not found in the draft"), never as model-quality warnings.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  DraftFidelityAddition,
  DraftFidelityExclusion,
  DraftFidelityItem,
  DraftFidelityLocation,
  DraftFidelityReport,
} from '@/lib/draft-fidelity-report'
import { COVERAGE_CATEGORY_ORDER, coverageCategory } from '@/lib/coverage-categories'

type CoverageReviewMark = { status: 'reviewed'; note?: string; by?: string; at?: string }
type CoverageReviewMap = Record<string, CoverageReviewMark>

type CoverageTab = 'map' | 'beyond' | 'terms'

const EXCLUSION_REASON_LABELS: Record<string, string> = {
  removed_by_you: 'Removed by you in Stage 0',
  marked_do_not_claim: 'Marked do-not-claim',
  guardrail: 'Held back as not claimable',
  scope_no_claim: 'Scope set to “No claim”',
  scope_excluded: 'Scope set to “Exclude”',
}

function relativeTime(iso?: string): string {
  if (!iso) return ''
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return ''
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(time).toLocaleDateString()
}

/** WhatsApp-style double tick: traced-and-mapped. */
function DoubleTick({ className = 'text-emerald-500' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center ${className}`} aria-label="Traced">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 13l4 4L14 9" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 13.5l3.5 3.5L21.5 8.5" />
      </svg>
    </span>
  )
}

function OpenDot() {
  return (
    <span className="inline-flex w-4 h-4 items-center justify-center" aria-label="Not found yet">
      <span className="w-2.5 h-2.5 rounded-full border-2 border-amber-400" />
    </span>
  )
}

function ExcludedDash() {
  return (
    <span className="inline-flex w-4 h-4 items-center justify-center text-ai-graphite-300" aria-label="Excluded by you">
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.5" />
        <path strokeLinecap="round" d="M8.5 12h7" />
      </svg>
    </span>
  )
}

export default function SourceCoveragePanel({
  sessionId,
  jurisdiction,
  patentId,
  displayName,
  onJumpToSection,
  draftTouchedAt,
}: {
  sessionId: string
  jurisdiction: string
  patentId: string
  displayName: Record<string, string>
  onJumpToSection: (sectionKey: string, matchText?: string) => void
  draftTouchedAt: number | null
}) {
  const [report, setReport] = useState<DraftFidelityReport | null>(null)
  const [reportMeta, setReportMeta] = useState<{ draftVersion?: number; jurisdiction?: string } | null>(null)
  const [coverageReview, setCoverageReview] = useState<CoverageReviewMap>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState<CoverageTab>('map')
  const [noteDraft, setNoteDraft] = useState<{ key: string; text: string } | null>(null)
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set())

  // A jurisdiction switch invalidates the report entirely (it belongs to another
  // draft row) — previously the panel silently kept showing the old one.
  useEffect(() => {
    setReport(null)
    setReportMeta(null)
    setCoverageReview({})
    setError(null)
  }, [jurisdiction])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`,
  })

  const runReport = useCallback(async () => {
    if (!sessionId || !patentId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          action: 'compute_source_fidelity',
          sessionId,
          // The reference draft has no per-jurisdiction annexure row; fall back to latest.
          ...(jurisdiction && jurisdiction !== 'REFERENCE' ? { jurisdiction } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not build the coverage report.')
      setReport(data.report)
      setReportMeta({ draftVersion: data.draftVersion, jurisdiction: data.jurisdiction })
      setCoverageReview(data.coverageReview && typeof data.coverageReview === 'object' ? data.coverageReview : {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the coverage report.')
    } finally {
      setLoading(false)
    }
  }, [sessionId, patentId, jurisdiction])

  const saveReview = useCallback(async (key: string, mark: { status: 'reviewed'; note?: string } | null) => {
    setSavingKeys(prev => new Set(prev).add(key))
    const previous = coverageReview
    // Optimistic: the drawer stays responsive; a failed save restores and reports.
    setCoverageReview(current => {
      const next = { ...current }
      if (mark) next[key] = { ...mark, at: new Date().toISOString() }
      else delete next[key]
      return next
    })
    try {
      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          action: 'save_coverage_review',
          sessionId,
          ...(jurisdiction && jurisdiction !== 'REFERENCE' ? { jurisdiction } : {}),
          patch: { [key]: mark },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save the review mark.')
      if (data.coverageReview && typeof data.coverageReview === 'object') {
        setCoverageReview(data.coverageReview)
      }
    } catch (err) {
      setCoverageReview(previous)
      setError(err instanceof Error ? err.message : 'Could not save the review mark.')
    } finally {
      setSavingKeys(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }, [coverageReview, patentId, sessionId, jurisdiction])

  const sectionLabel = useCallback(
    (key: string) => displayName[key] || (key === 'claims' ? 'Claims' : key),
    [displayName]
  )

  // ── Derived rows ───────────────────────────────────────────────────────────
  const items = report?.items || []
  const openItems = useMemo(() => items.filter(item => item.status === 'open'), [items])
  const missingTerms = useMemo(
    () => (report?.terminology.terms || []).filter(term => term.status === 'missing'),
    [report]
  )
  const foundTerms = useMemo(
    () => (report?.terminology.terms || []).filter(term => term.status === 'found'),
    [report]
  )
  const additions = report?.additions || []
  const excluded = report?.excluded || []

  const isReviewed = useCallback((key: string) => coverageReview[key]?.status === 'reviewed', [coverageReview])
  const toReviewOpenCount = useMemo(
    () => openItems.filter(item => !isReviewed(item.key)).length + missingTerms.filter(term => !isReviewed(term.key)).length,
    [openItems, missingTerms, isReviewed]
  )
  const beyondOpenCount = useMemo(
    () => additions.filter(addition => !isReviewed(addition.key)).length,
    [additions, isReviewed]
  )
  const reviewedCount = useMemo(
    () => [...openItems.map(item => item.key), ...missingTerms.map(term => term.key), ...additions.map(addition => addition.key)]
      .filter(key => isReviewed(key)).length,
    [openItems, missingTerms, additions, isReviewed]
  )
  const allAccounted = Boolean(report) && toReviewOpenCount === 0 && beyondOpenCount === 0

  // Coverage map rows: Stage-0 order inside each category, components first —
  // the attorney maps the draft against the initial Stage-0 understanding.
  const mapGroups = useMemo(() => {
    const byCategory = new Map<string, DraftFidelityItem[]>()
    items.forEach(item => {
      const list = byCategory.get(item.category) || []
      list.push(item)
      byCategory.set(item.category, list)
    })
    const ordered: Array<{ category: string; rows: DraftFidelityItem[] }> = []
    COVERAGE_CATEGORY_ORDER.forEach(key => {
      const list = byCategory.get(key)
      if (list?.length) ordered.push({ category: key, rows: list })
      byCategory.delete(key)
    })
    byCategory.forEach((list, key) => ordered.push({ category: key, rows: list }))
    return ordered
  }, [items])

  const stale = Boolean(
    report && draftTouchedAt && new Date(report.generatedAt).getTime() < draftTouchedAt
  )

  const coveragePercent = report && report.coverage.total > 0
    ? Math.round((report.coverage.covered / report.coverage.total) * 100)
    : null

  // ── Shared building blocks ─────────────────────────────────────────────────

  /** Section chip with a hover popup showing the matched draft line. */
  const sectionChip = (location: DraftFidelityLocation, fallbackText?: string) => (
    <span key={location.section} className="relative group/chip inline-block">
      <button
        onClick={() => onJumpToSection(location.section, location.sentence || fallbackText)}
        className="px-2 py-0.5 rounded-md border border-ai-blue-200 bg-ai-blue-50 text-[11px] font-medium text-ai-blue-700 hover:bg-ai-blue-100 transition-colors"
      >
        {sectionLabel(location.section)}
      </button>
      {location.sentence && (
        <span className="pointer-events-none invisible group-hover/chip:visible absolute right-0 top-full mt-1 z-50 w-72 max-w-[70vw] rounded-lg border border-paper-300 bg-white p-2.5 shadow-xl">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-ai-graphite-400 mb-1">
            {sectionLabel(location.section)}
          </span>
          <span className="block text-xs leading-relaxed text-ai-graphite-800">“{location.sentence}”</span>
          <span className="block mt-1.5 text-[10px] text-ai-blue-600">Click to show in the draft</span>
        </span>
      )}
    </span>
  )

  const reviewControls = (key: string) => {
    const mark = coverageReview[key]
    const saving = savingKeys.has(key)
    if (mark?.status === 'reviewed') {
      return (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 flex-wrap">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span>Reviewed · {relativeTime(mark.at)}</span>
          {mark.note && <span className="text-ai-graphite-500 italic truncate max-w-[150px]" title={mark.note}>“{mark.note}”</span>}
          <button
            onClick={() => saveReview(key, null)}
            disabled={saving}
            className="text-ai-graphite-400 hover:text-ai-graphite-700 underline underline-offset-2 disabled:opacity-50"
          >
            Reopen
          </button>
        </div>
      )
    }
    if (noteDraft?.key === key) {
      return (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={noteDraft.text}
            onChange={event => setNoteDraft({ key, text: event.target.value })}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                saveReview(key, { status: 'reviewed', note: noteDraft.text.trim() || undefined })
                setNoteDraft(null)
              }
              if (event.key === 'Escape') setNoteDraft(null)
            }}
            placeholder="Optional note…"
            className="flex-1 min-w-0 px-2 py-1 rounded-md border border-paper-300 text-xs focus:outline-none focus:ring-1 focus:ring-ai-blue-300"
          />
          <button
            onClick={() => {
              saveReview(key, { status: 'reviewed', note: noteDraft.text.trim() || undefined })
              setNoteDraft(null)
            }}
            disabled={saving}
            className="px-2 py-1 rounded-md bg-ai-blue-600 text-white text-[11px] font-medium hover:bg-ai-blue-500 disabled:opacity-50"
          >
            Save
          </button>
          <button onClick={() => setNoteDraft(null)} className="text-[11px] text-ai-graphite-400 hover:text-ai-graphite-700">
            Cancel
          </button>
        </div>
      )
    }
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-amber-700">Not found in the draft yet</span>
        <button
          onClick={() => setNoteDraft({ key, text: '' })}
          disabled={saving}
          className="px-2 py-0.5 rounded-md border border-paper-300 bg-white text-[11px] font-medium text-ai-graphite-700 hover:border-ai-blue-300 hover:text-ai-blue-700 transition-colors disabled:opacity-50"
        >
          Mark reviewed
        </button>
      </div>
    )
  }

  // ── Coverage map (table) ───────────────────────────────────────────────────
  const mapBody = (
    <div className="rounded-xl border border-paper-200 bg-white overflow-hidden">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-paper-200 bg-paper-50">
            <th className="w-9 px-3 py-2" aria-label="Status" />
            <th className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-ai-graphite-500">Element / feature</th>
            <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-ai-graphite-500">Where in the draft</th>
          </tr>
        </thead>
        <tbody>
          {mapGroups.map(group => {
            const meta = coverageCategory(group.category)
            return (
              <React.Fragment key={group.category}>
                <tr className="bg-paper-100/70">
                  <td colSpan={3} className="px-3 py-1.5 text-[11px] font-semibold text-ai-graphite-700" title={meta.hint}>
                    {meta.label}
                  </td>
                </tr>
                {group.rows.map(item => (
                  <tr key={item.key} className="border-t border-paper-100 align-top">
                    <td className="px-3 py-2.5">
                      {item.status === 'covered' ? <DoubleTick /> : isReviewed(item.key)
                        ? <DoubleTick className="text-ai-graphite-300" />
                        : <OpenDot />}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="text-sm text-ai-graphite-900" title={item.label !== item.shortLabel ? item.label : undefined}>
                        {item.shortLabel}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {item.status === 'covered'
                        ? (item.coveredIn.length > 0
                            ? <div className="flex flex-wrap gap-1.5">{item.coveredIn.map(location => sectionChip(location, item.shortLabel))}</div>
                            : <span className="text-[11px] text-ai-graphite-400">Covered across sections</span>)
                        : reviewControls(item.key)}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            )
          })}

          {excluded.length > 0 && (
            <>
              <tr className="bg-paper-100/70 border-t border-paper-200">
                <td colSpan={3} className="px-3 py-1.5 text-[11px] font-semibold text-ai-graphite-500">
                  Excluded by you — accounted for, not lost
                </td>
              </tr>
              {excluded.map(item => (
                <tr key={item.key} className="border-t border-paper-100 align-top">
                  <td className="px-3 py-2.5"><ExcludedDash /></td>
                  <td className="px-2 py-2.5 text-sm text-ai-graphite-500">{item.label}</td>
                  <td className="px-3 py-2.5 text-[11px] text-ai-graphite-400">
                    {EXCLUSION_REASON_LABELS[item.reason] || 'Excluded'}
                  </td>
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  )

  // ── Beyond source ──────────────────────────────────────────────────────────
  const beyondBody = (
    <div className="space-y-3">
      <p className="text-xs text-ai-graphite-500 px-1">
        Sentences that go beyond the source disclosure. Confirm each is intended, or edit the section.
      </p>
      {additions.length === 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Every sentence traces back to your source material.
        </div>
      )}
      {Object.entries(
        additions.reduce<Record<string, DraftFidelityAddition[]>>((groups, item) => {
          ;(groups[item.section] = groups[item.section] || []).push(item)
          return groups
        }, {})
      ).map(([section, rows]) => (
        <div key={section} className="rounded-xl border border-paper-200 bg-white overflow-hidden">
          <div className="px-3 py-2 bg-paper-100/70 text-[11px] font-semibold text-ai-graphite-700">{sectionLabel(section)}</div>
          <div className="divide-y divide-paper-100">
            {rows.map(item => (
              <div key={item.key} className={`px-3 py-2.5 ${isReviewed(item.key) ? 'bg-paper-50/60' : ''}`}>
                <div className="text-sm text-ai-graphite-900">{item.sentence}</div>
                {item.unmatchedTerms.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {item.unmatchedTerms.map(term => (
                      <span key={term} className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-[10px] text-amber-800">{term}</span>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {coverageReview[item.key]?.status === 'reviewed' ? reviewControls(item.key) : (
                    <>
                      <button
                        onClick={() => setNoteDraft({ key: item.key, text: '' })}
                        className="px-2 py-0.5 rounded-md border border-paper-300 bg-white text-[11px] font-medium text-ai-graphite-700 hover:border-ai-blue-300 hover:text-ai-blue-700 transition-colors"
                      >
                        Mark reviewed
                      </button>
                      <button
                        onClick={() => onJumpToSection(item.section, item.sentence)}
                        className="text-[11px] text-ai-blue-700 hover:underline underline-offset-2"
                      >
                        Show in draft
                      </button>
                    </>
                  )}
                </div>
                {noteDraft?.key === item.key && <div className="mt-2">{reviewControls(item.key)}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )

  // ── Inventor's terms ───────────────────────────────────────────────────────
  const termsBody = (
    <div className="space-y-3">
      <p className="text-xs text-ai-graphite-500 px-1">
        {report?.sourceHandlingMode === 'PRESERVE'
          ? 'You chose to keep the idea exactly as provided — these exact terms should appear in the draft.'
          : 'Informational — structure-and-polish mode may rephrase terminology.'}
      </p>
      {missingTerms.length > 0 && (
        <div className="rounded-xl border border-paper-200 bg-white overflow-hidden">
          <div className="px-3 py-2 bg-paper-100/70 text-[11px] font-semibold text-ai-graphite-700">Not used in the draft</div>
          <div className="divide-y divide-paper-100">
            {missingTerms.map(term => (
              <div key={term.key} className="px-3 py-2.5">
                <div className="text-sm text-ai-graphite-900">“{term.term}”</div>
                <div className="mt-1.5">{reviewControls(term.key)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {foundTerms.length > 0 && (
        <div className="rounded-xl border border-paper-200 bg-white p-3">
          <div className="text-xs font-semibold text-ai-graphite-800 mb-2 flex items-center gap-1.5">
            <DoubleTick /> Used in the draft
          </div>
          <div className="flex flex-wrap gap-1.5">
            {foundTerms.map(term => (
              <button
                key={term.key}
                onClick={() => term.foundIn.length > 0 && onJumpToSection(term.foundIn[0], term.term)}
                className="px-2 py-0.5 rounded-md border border-paper-200 bg-paper-50 text-[11px] text-ai-graphite-700 hover:border-ai-blue-300 hover:text-ai-blue-700 transition-colors"
                title={term.foundIn.map(sectionLabel).join(', ')}
              >
                {term.term}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  const tabs: Array<{ key: CoverageTab; label: string; count?: number }> = [
    { key: 'map', label: 'Coverage map', count: toReviewOpenCount },
    { key: 'beyond', label: 'Beyond source', count: beyondOpenCount },
    { key: 'terms', label: 'Inventor’s terms', count: missingTerms.filter(term => !isReviewed(term.key)).length },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Inline entry card */}
      <div className="mt-6 rounded-2xl border border-paper-300 bg-white">
        <div className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ai-graphite-900">Check Coverage</h3>
            <p className="text-xs text-ai-graphite-500 mt-0.5">
              See exactly where every part of the disclosure landed in the draft.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {report && (
              allAccounted ? (
                <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-700 inline-flex items-center gap-1.5">
                  <DoubleTick /> All accounted for
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full bg-paper-100 border border-paper-300 text-xs font-medium text-ai-graphite-700 tabular-nums">
                  {report.coverage.covered}/{report.coverage.total} traced
                  {toReviewOpenCount + beyondOpenCount > 0 ? ` · ${toReviewOpenCount + beyondOpenCount} to review` : ''}
                </span>
              )
            )}
            <button
              onClick={() => {
                setDrawerOpen(true)
                if (!report) void runReport()
              }}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-ai-blue-600 text-white hover:bg-ai-blue-500 disabled:opacity-50"
            >
              {loading ? 'Checking…' : report ? 'Open coverage' : 'Check Coverage'}
            </button>
          </div>
        </div>
        {error && !drawerOpen && (
          <div className="px-6 py-3 text-sm text-red-600 bg-red-50 border-t border-red-100 rounded-b-2xl">{error}</div>
        )}
      </div>

      {/* Drawer */}
      {drawerOpen && (
        <div className="fixed inset-y-0 right-0 z-40 w-full sm:w-[520px] bg-white border-l border-paper-300 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
          {/* Header */}
          <div className="px-5 pt-4 pb-3 border-b border-paper-200">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {/* Coverage ring */}
                <div className="relative w-14 h-14 shrink-0">
                  <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="#e9e6df" strokeWidth="3.5" />
                    {coveragePercent !== null && (
                      <circle
                        cx="18" cy="18" r="15" fill="none"
                        stroke={allAccounted ? '#10b981' : '#1d4ed8'}
                        strokeWidth="3.5" strokeLinecap="round"
                        strokeDasharray={`${coveragePercent * 0.94} 100`}
                      />
                    )}
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-ai-graphite-900 tabular-nums">
                    {coveragePercent !== null ? `${coveragePercent}%` : '—'}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ai-graphite-900">
                    {report ? `${report.coverage.covered} of ${report.coverage.total} source items traced` : 'Check Coverage'}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                    {report && (
                      <span className="px-1.5 py-0.5 rounded bg-paper-100 border border-paper-200 text-[10px] font-medium text-ai-graphite-600">
                        {report.sourceHandlingMode === 'PRESERVE' ? 'Keep-my-idea mode' : 'Structure & polish mode'}
                      </span>
                    )}
                    {report && (
                      <span className="text-[10px] text-ai-graphite-400">
                        Draft v{reportMeta?.draftVersion ?? '—'} · checked {relativeTime(report.generatedAt)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => void runReport()}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-lg border border-paper-300 bg-white text-xs font-medium text-ai-graphite-700 hover:border-ai-blue-300 hover:text-ai-blue-700 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Checking…' : 'Re-check'}
                </button>
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="p-1.5 rounded-lg text-ai-graphite-400 hover:text-ai-graphite-700 hover:bg-paper-100"
                  title="Close"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {stale && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center justify-between gap-2">
                <span>The draft changed since this check.</span>
                <button onClick={() => void runReport()} className="font-medium underline underline-offset-2 hover:text-amber-900">
                  Re-check
                </button>
              </div>
            )}

            {/* Tabs */}
            {report && (
              <div className="mt-3 flex items-center rounded-md border border-paper-300 bg-paper-50 p-0.5 overflow-x-auto">
                {tabs.map(tabDef => {
                  const active = tab === tabDef.key
                  const attention = (tabDef.count ?? 0) > 0
                  return (
                    <button
                      key={tabDef.key}
                      onClick={() => setTab(tabDef.key)}
                      aria-pressed={active}
                      className={`whitespace-nowrap rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        active ? 'bg-white shadow-sm text-ai-graphite-900' : 'text-ai-graphite-500 hover:text-ai-graphite-800'
                      }`}
                    >
                      {tabDef.label}
                      {attention && (
                        <span className="ml-1 px-1 rounded-full bg-amber-100 text-amber-800 text-[10px] tabular-nums">{tabDef.count}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-4 bg-paper-50/50">
            {error && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
            )}
            {!report && !loading && !error && (
              <p className="text-sm text-ai-graphite-500 px-1">Run a check to map the draft back to the disclosure.</p>
            )}
            {loading && !report && (
              <p className="text-sm text-ai-graphite-500 px-1 animate-pulse">Tracing the draft against your disclosure…</p>
            )}
            {report && allAccounted && (
              <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="text-sm font-semibold text-emerald-800 inline-flex items-center gap-2">
                  <DoubleTick /> All source content is accounted for.
                </div>
                <div className="mt-0.5 text-xs text-emerald-700">
                  {report.coverage.covered} traced{reviewedCount > 0 ? ` · ${reviewedCount} reviewed by you` : ''}
                  {excluded.length > 0 ? ` · ${excluded.length} excluded by your selections` : ''}
                </div>
              </div>
            )}
            {report && (tab === 'map' ? mapBody : tab === 'beyond' ? beyondBody : termsBody)}
          </div>
        </div>
      )}
    </>
  )
}
