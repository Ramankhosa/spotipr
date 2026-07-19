'use client'

// Refine the results you already have — no re-run, no LLM, no cost. This is the
// "narrow what came back" surface: text search within results, tag/lane/
// jurisdiction/date/applicant/CPC filters and sorting, all client-side over the
// current run. Essentials stay visible; the rest hides behind "More filters" so
// the default view stays calm.

import { ChevronDown, RotateCcw, Search, SlidersHorizontal } from 'lucide-react'
import { Hint } from '@/components/ui/hint'
import type { StudioDocTag, StudioResultFamily } from '@/lib/prior-art-studio/types'
import type { DocStateLite } from './ResultsList'

export type TagFilterValue = StudioDocTag | 'UNTAGGED'
export type LaneFilterValue = 'match' | 'cast' | 'both' | 'other'
export type ResultSort = 'rank' | 'dateDesc' | 'dateAsc' | 'title'

export type MatchFilterValue = 'all' | 'meets' | 'misses'

export interface ResultFilters {
  text: string
  tags: TagFilterValue[]
  lanes: LaneFilterValue[]
  /** The MATCH lens: view all, only those meeting every MATCH block, or only those missing one. */
  match: MatchFilterValue
  /** NOT-term hits are hidden by default but always one click away — never deleted. */
  showNotHits: boolean
  jurisdictions: string[]
  dateFrom: string
  dateTo: string
  applicant: string
  cpc: string
  hideExcluded: boolean
  onlyNew: boolean
  sort: ResultSort
}

export const DEFAULT_RESULT_FILTERS: ResultFilters = {
  text: '',
  tags: [],
  lanes: [],
  match: 'all',
  showNotHits: false,
  jurisdictions: [],
  dateFrom: '',
  dateTo: '',
  applicant: '',
  cpc: '',
  hideExcluded: false,
  onlyNew: false,
  sort: 'rank',
}

/** Jurisdiction isn't always populated by providers — fall back to the kind code prefix. */
export function jurisdictionOf(family: StudioResultFamily): string {
  if (family.jurisdiction) return family.jurisdiction.toUpperCase()
  const match = /^([A-Za-z]{2})/.exec(family.publicationNumber || '')
  return match ? match[1].toUpperCase() : '—'
}

export function countActiveFilters(filters: ResultFilters): number {
  let n = 0
  if (filters.text.trim()) n += 1
  if (filters.tags.length) n += 1
  if (filters.lanes.length) n += 1
  if (filters.jurisdictions.length) n += 1
  if (filters.dateFrom || filters.dateTo) n += 1
  if (filters.applicant.trim()) n += 1
  if (filters.cpc.trim()) n += 1
  if (filters.hideExcluded) n += 1
  if (filters.onlyNew) n += 1
  if (filters.match !== 'all') n += 1
  if (filters.showNotHits) n += 1
  return n
}

export function applyResultFilters(
  families: StudioResultFamily[],
  docStates: Record<string, DocStateLite>,
  filters: ResultFilters
): StudioResultFamily[] {
  const text = filters.text.trim().toLowerCase()
  const applicant = filters.applicant.trim().toLowerCase()
  const cpc = filters.cpc.trim().toUpperCase().replace(/\s+/g, '')

  const filtered = families.filter(family => {
    const state = docStates[family.familyKey] || {}

    if (filters.hideExcluded && state.excluded) return false
    if (filters.onlyNew && !family.isNew) return false

    if (!filters.showNotHits && family.hitsNotTerm) return false
    if (filters.match === 'meets' && family.meetsMatch === false) return false
    if (filters.match === 'misses' && family.meetsMatch !== false) return false

    if (filters.tags.length) {
      const tagValue: TagFilterValue = state.tag ?? 'UNTAGGED'
      if (!filters.tags.includes(tagValue)) return false
    }

    if (filters.lanes.length && !filters.lanes.includes(family.lane as LaneFilterValue)) return false

    if (filters.jurisdictions.length && !filters.jurisdictions.includes(jurisdictionOf(family))) return false

    if (filters.dateFrom && (!family.publicationDate || family.publicationDate < filters.dateFrom)) return false
    if (filters.dateTo && (!family.publicationDate || family.publicationDate > filters.dateTo)) return false

    if (applicant && !(family.applicants || '').toLowerCase().includes(applicant)) return false

    if (cpc) {
      const codes = (family.classifications || []).map(c => c.toUpperCase().replace(/\s+/g, ''))
      if (!codes.some(c => c.startsWith(cpc))) return false
    }

    if (text) {
      const haystack = [family.title, family.abstract, family.snippet, family.publicationNumber, family.applicants]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(text)) return false
    }

    return true
  })

  const sorted = [...filtered]
  if (filters.sort === 'dateDesc') {
    sorted.sort((a, b) => (b.publicationDate || '').localeCompare(a.publicationDate || ''))
  } else if (filters.sort === 'dateAsc') {
    sorted.sort((a, b) => (a.publicationDate || '').localeCompare(b.publicationDate || ''))
  } else if (filters.sort === 'title') {
    sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  }
  // 'rank' keeps the reranker's order, which is the array order.
  return sorted
}

const TAG_OPTIONS: { value: TagFilterValue; label: string }[] = [
  { value: 'RELEVANT', label: 'Relevant' },
  { value: 'MAYBE', label: 'Maybe' },
  { value: 'NOT_RELEVANT', label: 'Not relevant' },
  { value: 'UNTAGGED', label: 'Unreviewed' },
]

const LANE_OPTIONS: { value: LaneFilterValue; label: string }[] = [
  { value: 'match', label: 'Words only' },
  { value: 'cast', label: 'Meaning only' },
  { value: 'both', label: 'Words + meaning' },
]

interface ResultsFilterBarProps {
  filters: ResultFilters
  onChange: (next: ResultFilters) => void
  families: StudioResultFamily[]
  shownCount: number
  newFamilyCount: number
  expanded: boolean
  onToggleExpanded: (value: boolean) => void
}

export function ResultsFilterBar({
  filters,
  onChange,
  families,
  shownCount,
  newFamilyCount,
  expanded,
  onToggleExpanded,
}: ResultsFilterBarProps) {
  const set = (patch: Partial<ResultFilters>) => onChange({ ...filters, ...patch })
  const toggleIn = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter(v => v !== value) : [...list, value]

  const activeCount = countActiveFilters(filters)
  const jurisdictions = Array.from(new Set(families.map(jurisdictionOf))).sort()

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
      active
        ? 'border-lamp-500 bg-lamp-50 text-lamp-700 dark:bg-lamp-950/50 dark:text-lamp-300'
        : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
    }`

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-[190px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filters.text}
            onChange={e => set({ text: e.target.value })}
            placeholder="Search within these results…"
            aria-label="Search within results"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex items-center gap-1">
          {TAG_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              className={chip(filters.tags.includes(option.value))}
              onClick={() => set({ tags: toggleIn(filters.tags, option.value) })}
            >
              {option.label}
            </button>
          ))}
          <Hint
            title="Filter by your marks"
            text="Narrow to what you tagged — e.g. show only “Unreviewed” to pick up exactly where you stopped, or only “Maybe” to work the second pass."
          />
        </div>

        {(() => {
          const meets = families.filter(f => f.meetsMatch !== false).length
          const misses = families.length - meets
          const notCount = families.filter(f => f.hitsNotTerm).length
          if (!misses && !notCount) return null
          return (
            <div className="flex items-center gap-1">
              {misses > 0 && (
                <>
                  <button type="button" className={chip(filters.match === 'meets')} onClick={() => set({ match: filters.match === 'meets' ? 'all' : 'meets' })}>
                    Meets MATCH · {meets}
                  </button>
                  <button type="button" className={chip(filters.match === 'misses')} onClick={() => set({ match: filters.match === 'misses' ? 'all' : 'misses' })}>
                    Misses MATCH · {misses}
                  </button>
                </>
              )}
              {notCount > 0 && (
                <button type="button" className={chip(filters.showNotHits)} onClick={() => set({ showNotHits: !filters.showNotHits })}>
                  NOT hits · {notCount}
                </button>
              )}
              <Hint
                title="Nothing is ever removed"
                text="Every retrieved document is here. “Misses MATCH” shows documents that lack one of your required literal terms — often the closest art in different words. “NOT hits” shows documents containing an excluded term, hidden by default but never deleted."
              />
            </div>
          )
        })()}

        <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Sort
          <select
            value={filters.sort}
            onChange={e => set({ sort: e.target.value as ResultSort })}
            className="rounded-md border border-border bg-background px-1.5 py-1 text-[11px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Sort results"
          >
            <option value="rank">Best match</option>
            <option value="dateDesc">Newest first</option>
            <option value="dateAsc">Oldest first</option>
            <option value="title">Title A–Z</option>
          </select>
        </label>

        <button
          type="button"
          onClick={() => onToggleExpanded(!expanded)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          <SlidersHorizontal className="h-3 w-3" />
          More filters
          {activeCount > 0 && (
            <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 text-[9px] font-bold text-primary">{activeCount}</span>
          )}
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>

        <span className="ml-auto whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
          {shownCount === families.length
            ? `${families.length} results`
            : `${shownCount} of ${families.length}`}
        </span>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_RESULT_FILTERS, sort: filters.sort })}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {expanded && (
        <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              How it was found
            </span>
            <div className="flex flex-wrap gap-1">
              {LANE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={chip(filters.lanes.includes(option.value))}
                  onClick={() => set({ lanes: toggleIn(filters.lanes, option.value) })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Jurisdiction
            </span>
            <div className="flex flex-wrap gap-1">
              {jurisdictions.slice(0, 10).map(code => (
                <button
                  key={code}
                  type="button"
                  className={chip(filters.jurisdictions.includes(code))}
                  onClick={() => set({ jurisdictions: toggleIn(filters.jurisdictions, code) })}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Applicant contains
            <input
              value={filters.applicant}
              onChange={e => set({ applicant: e.target.value })}
              placeholder="e.g. Stryker"
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            CPC / IPC starts with
            <input
              value={filters.cpc}
              onChange={e => set({ cpc: e.target.value })}
              placeholder="e.g. A61B"
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Published from
            <input
              type="date"
              value={filters.dateFrom}
              onChange={e => set({ dateFrom: e.target.value })}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-normal tracking-normal text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Published to
            <input
              type="date"
              value={filters.dateTo}
              onChange={e => set({ dateTo: e.target.value })}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-normal tracking-normal text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <label className="inline-flex items-center gap-2 self-end text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={filters.hideExcluded}
              onChange={e => set({ hideExcluded: e.target.checked })}
              className="h-3.5 w-3.5"
            />
            Hide excluded families
          </label>

          {newFamilyCount > 0 && (
            <label className="inline-flex items-center gap-2 self-end text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={filters.onlyNew}
                onChange={e => set({ onlyNew: e.target.checked })}
                className="h-3.5 w-3.5"
              />
              Only the {newFamilyCount} new since last run
            </label>
          )}

          <p className="text-[11px] text-muted-foreground sm:col-span-2 lg:col-span-4">
            These filters narrow what came back — they don’t re-run the search or change your canvas, so nothing is
            re-charged and your marks are preserved.
          </p>
        </div>
      )}
    </div>
  )
}
