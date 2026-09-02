'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, Loader2 } from 'lucide-react'
import { wsApi } from '../api'

interface TrailEntry {
  id: string
  kind: string
  actor: string
  byModel: boolean
  summary: string
  at: string
}

const KIND_STYLE: Record<string, string> = {
  SCOPE: 'border-violet-200 bg-violet-50 text-violet-800',
  RUN: 'border-teal-200 bg-teal-50 text-teal-800',
  EDIT: 'border-amber-200 bg-amber-50 text-amber-900',
  HYPOTHESIS: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  CHALLENGE: 'border-rose-200 bg-rose-50 text-rose-800',
  NOTE: 'border-border bg-muted text-muted-foreground',
  SYSTEM: 'border-border bg-muted text-muted-foreground',
}

function when(iso: string) {
  const date = new Date(iso)
  const mins = Math.round((Date.now() - date.getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`
  return date.toLocaleDateString()
}

/** How this study reached its answer — loaded on demand, collapsed by default. */
export function TrailPanel({ studyId }: { studyId: string }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<TrailEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const data = await wsApi<{ entries: TrailEntry[] }>(`/api/whitespace/studies/${studyId}/trail`)
      setEntries(data.entries)
    } catch {
      // A failed fetch is not an empty trail — offer a retry instead of
      // caching [] as "Nothing recorded yet" for the rest of the session.
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [studyId])

  // Refetch on every open: the trail grows as the study is worked on.
  useEffect(() => {
    if (open) void load()
  }, [open, load])

  return (
    <section className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <History className="h-3.5 w-3.5" />
          How this study got here
        </span>
        <span className="text-[11px] text-muted-foreground">{open ? 'hide' : 'show'}</span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3">
          {loading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading the trail…
            </p>
          ) : failed ? (
            <p className="text-xs text-muted-foreground">
              The trail could not be loaded.{' '}
              <button
                type="button"
                onClick={() => void load()}
                className="underline underline-offset-2 hover:text-foreground"
              >
                Retry
              </button>
            </p>
          ) : !entries?.length ? (
            <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ol className="space-y-2">
              {entries.map(entry => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
                  <span
                    className={`shrink-0 rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${
                      KIND_STYLE[entry.kind] ?? KIND_STYLE.SYSTEM
                    }`}
                  >
                    {entry.kind.toLowerCase()}
                  </span>
                  <span className="min-w-0 flex-1 text-foreground">{entry.summary}</span>
                  {entry.byModel && (
                    <span className="shrink-0 rounded-full border border-primary/30 bg-primary/5 px-1.5 py-px text-[10px] font-medium text-primary">
                      AI
                    </span>
                  )}
                  <span className="shrink-0 tabular-nums text-muted-foreground">{when(entry.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}
