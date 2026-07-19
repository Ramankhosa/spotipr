'use client'

// The Gates funnel: the whole retrieval pipeline as counted stages, so recall
// is visible instead of anxious guesswork. Clicking the Filters gate opens the
// inspector — what each constraint removed, and what one change would do.
// Estimates are marked with ~ and are never what the trail records.

import { useState } from 'react'
import { ChevronDown, Sparkles } from 'lucide-react'
import { Hint } from '@/components/ui/hint'
import type { StudioGateCounts, StudioGateDetail } from '@/lib/prior-art-studio/types'

interface GatesFunnelProps {
  counts: StudioGateCounts | null
  detail?: StudioGateDetail | null
  running?: boolean
  suggestedTerms?: string[]
  onHarvestTerms?: (terms: string[]) => void
}

function formatCount(value: number | null | undefined, isEstimate = false): string {
  if (value === null || value === undefined) return '—'
  const text = value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value.toLocaleString()
  return isEstimate ? `~${text}` : text
}

const GATE_HELP: Record<string, string> = {
  Corpus: 'Every patent document in the PatentNest corpus (Google Patents public data + Indian corpus + fetched documents). Estimate.',
  Filters: 'Documents surviving your date, jurisdiction and classification filters — before any keyword or meaning matching. Click to see what each constraint removed.',
  Recall: 'Documents retrieved from the corpus. On the worldwide corpus this is driven by the meaning (EXPAND) lane, because no full-text index covers those 45M records — see the MATCH gate for how your literal terms were applied. Exact.',
  MATCH: 'Your MATCH terms applied as a requirement: every MATCH block must be satisfied literally. On the worldwide corpus this runs as a filter over retrieved candidates rather than as its own recall lane, so it narrows precisely but cannot surface a document the meaning lane never retrieved. Widen a block to EXPAND if this is cutting too deep.',
  Families: 'The same invention filed in several countries is one “family”. Duplicates collapse so you review each invention once.',
  Shown: 'The ranked set presented for review, ordered by the reranker. Work it with the keyboard: j/k to move, 1/2/3 to tag.',
}

export function GatesFunnel({ counts, detail, running, suggestedTerms, onHarvestTerms }: GatesFunnelProps) {
  const [open, setOpen] = useState(false)

  const gates: Array<{ label: string; value: string; accent?: boolean; clickable?: boolean }> = counts
    ? [
        { label: 'Corpus', value: formatCount(counts.corpus, counts.corpusIsEstimate) },
        { label: 'Filters', value: formatCount(counts.filters, counts.filtersIsEstimate), clickable: true },
        { label: 'Recall', value: formatCount(counts.recall), accent: true },
        ...(counts.matchMode === 'filter'
          ? [{ label: 'MATCH', value: counts.matchRemoved ? `−${counts.matchRemoved.toLocaleString()}` : '−0' }]
          : []),
        { label: 'Families', value: formatCount(counts.families) },
        { label: 'Shown', value: formatCount(counts.shown) },
      ]
    : [
        { label: 'Corpus', value: '·' },
        { label: 'Filters', value: '·' },
        { label: 'Recall', value: '·', accent: true },
        { label: 'Families', value: '·' },
        { label: 'Shown', value: '·' },
      ]

  const lanes = counts?.lanes
  const gapPct = counts?.vocabularyGap !== undefined ? Math.round(counts.vocabularyGap * 100) : null

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <div className="flex items-stretch overflow-x-auto" role="group" aria-label="Search funnel">
          {gates.map((gate, i) => {
            const isOpen = open && gate.clickable
            const body = (
              <>
                <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-wider text-muted-foreground">
                  {gate.label}
                  <Hint text={GATE_HELP[gate.label]} />
                  {gate.clickable && <ChevronDown className={`h-2.5 w-2.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
                </div>
                <div className="font-mono text-sm font-semibold tabular-nums text-foreground">{gate.value}</div>
              </>
            )
            const className = `relative min-w-[92px] border border-border px-3 py-1 text-left ${
              i === 0 ? 'rounded-l-md' : 'border-l-0'
            } ${i === gates.length - 1 ? 'rounded-r-md' : ''} ${
              isOpen ? 'bg-amber-50 dark:bg-amber-950/30' : gate.accent ? 'bg-blue-50 dark:bg-blue-950/30' : 'bg-background'
            } ${running ? 'animate-pulse' : ''}`

            return gate.clickable ? (
              <button key={gate.label} type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className={className}>
                {body}
              </button>
            ) : (
              <div key={gate.label} className={className}>
                {body}
              </div>
            )
          })}
        </div>

        {counts?.steered && (
          <span
            className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-bold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
            title="Ranking was influenced by documents you marked relevant — the steer block is on your canvas and removable."
          >
            STEERED
          </span>
        )}

        {counts && counts.semanticLaneRan === false && (
          <span className="inline-flex items-center gap-1 rounded-md border border-red-400 bg-red-50 px-2 py-1 text-[10px] font-bold text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            ⚠ MEANING LANE DID NOT RUN
            <Hint
              title="Why this matters"
              text="No embedding key is configured, so the search fell back to keyword matching only. The lane counts and vocabulary-gap figure are meaningless for this run, and recall across the worldwide corpus is severely reduced. Do not treat this run as a completed search."
            />
          </span>
        )}

        {lanes && counts?.semanticLaneRan !== false && (
          <div className="ml-auto flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground">
            <span>
              words-only <b className="font-mono text-foreground">{lanes.matchOnly.toLocaleString()}</b>
            </span>
            <span className="text-blue-600 dark:text-blue-400">
              meaning-only <b className="font-mono">{lanes.castOnly.toLocaleString()}</b>
            </span>
            <span>
              both <b className="font-mono text-foreground">{lanes.both.toLocaleString()}</b>
            </span>
            <Hint
              title="What each lane caught"
              text="“Meaning-only” documents share no query word with your canvas — a keyword-only search would have missed every one of them. If this number is large, your MATCH vocabulary is probably missing synonyms."
            />
          </div>
        )}
      </div>

      {/* Vocabulary repair — turn the gap into an action, not just a statistic */}
      {gapPct !== null && gapPct >= 20 && suggestedTerms && suggestedTerms.length > 0 && onHarvestTerms && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-blue-50/60 px-3 py-2 text-[11px] dark:bg-blue-950/20">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
          <span className="text-foreground/90">
            <b>{gapPct}%</b> of meaning-only hits share no word with your query. Vocabulary they use:
          </span>
          {suggestedTerms.slice(0, 6).map(term => (
            <span key={term} className="rounded-full border border-blue-300 bg-background px-2 py-0.5 font-mono text-[10px] text-blue-700 dark:border-blue-800 dark:text-blue-300">
              {term}
            </span>
          ))}
          <button
            type="button"
            onClick={() => onHarvestTerms(suggestedTerms.slice(0, 6))}
            className="ml-auto rounded-md border border-blue-300 bg-background px-2 py-1 font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-300"
          >
            Add as suggestions to canvas
          </button>
          <Hint
            title="Why this matters"
            text="These are words used by documents your keyword lane could never reach. Adding them turns a silent recall gap into MATCH coverage. They arrive as suggestions — you still approve each one."
          />
        </div>
      )}

      {open && detail && (
        <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-2">
          <div>
            <h5 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              What each constraint removed
            </h5>
            {detail.constraints.length ? (
              <div className="space-y-1">
                {detail.constraints.map(constraint => (
                  <div key={constraint.label} className="flex items-baseline justify-between gap-3 border-b border-dashed border-border py-1 text-[11px]">
                    <span className="text-foreground/90">{constraint.label}</span>
                    <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                      {constraint.removed !== null ? `−${constraint.removed.toLocaleString()}` : '—'}
                      {constraint.remaining !== null && (
                        <span className="ml-2 text-foreground">{constraint.remaining.toLocaleString()} left</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">No filters applied — the whole corpus is in scope.</p>
            )}
          </div>

          <div>
            <h5 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              What one change would do
            </h5>
            {detail.sensitivity.length ? (
              <div className="space-y-1">
                {detail.sensitivity.map(item => (
                  <div key={item.label} className="flex items-baseline justify-between gap-3 border-b border-dashed border-border py-1 text-[11px]">
                    <span className="text-foreground/90">{item.label}</span>
                    <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{item.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">Add a filter to see its effect here.</p>
            )}
          </div>

          <div className="sm:col-span-2">
            <h5 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Coverage limits that apply to every query here
            </h5>
            <ul className="space-y-0.5 text-[11px] text-muted-foreground">
              {detail.disclosures.map(line => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Counts marked <b>~</b> are instant planner estimates; the evidence trail records exact figures.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
