'use client'

// Evidence Trail: the append-only session log. Every query version, run count,
// tag and AI action — human and machine actors both — compiles into the report.

import { Download, Loader2 } from 'lucide-react'
import { Hint } from '@/components/ui/hint'
import type { StudioTrailEntryPayload } from '@/lib/prior-art-studio/types'

const KIND_STYLES: Record<string, string> = {
  RUN: 'bg-muted text-foreground',
  COPILOT: 'bg-lamp-100 text-lamp-800 dark:bg-lamp-950/50 dark:text-lamp-300',
  TAG: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  EDIT: 'bg-muted text-muted-foreground',
  NOTE: 'bg-muted text-muted-foreground',
  SYSTEM: 'bg-muted text-muted-foreground',
}

interface TrailPanelProps {
  entries: StudioTrailEntryPayload[]
  onDownloadReport: () => void
  reportLoading?: boolean
}

export function TrailPanel({ entries, onDownloadReport, reportLoading }: TrailPanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Evidence trail</span>
        <Hint
          title="Why this exists"
          text="FTO opinions and invalidity work require documenting how you searched: which queries, which filters, what you reviewed and marked. This log records it automatically — including what the AI proposed and what you accepted — and compiles into a Word report."
        />
        <button
          type="button"
          onClick={onDownloadReport}
          disabled={reportLoading}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {reportLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Compile report (DOCX)
        </button>
      </div>
      <ol className="space-y-0 divide-y divide-border rounded-lg border border-border bg-card px-3">
        {entries.length === 0 && (
          <li className="py-3 text-xs text-muted-foreground">Nothing yet — every edit, run and tag will be recorded here.</li>
        )}
        {entries.map(entry => (
          <li key={entry.id} className="flex items-baseline gap-2.5 py-2 text-xs">
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-bold ${KIND_STYLES[entry.kind] || KIND_STYLES.SYSTEM}`}>
              {entry.kind}
            </span>
            <span className="text-foreground/90">{entry.summary}</span>
            {entry.actor.startsWith('model:') && (
              <span className="ml-auto shrink-0 rounded bg-lamp-50 px-1.5 text-[11px] font-semibold text-lamp-700 dark:bg-lamp-950/40 dark:text-lamp-300">
                AI
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
