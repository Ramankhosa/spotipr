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
  Recall: 'Distinct documents retrieved from the corpus, counted once even when several lanes or both corpora returned the same one. On the worldwide corpus this is driven by the meaning (EXPAND) lane, because no full-text index covers those 45M records — see the MATCH gate for how your literal terms were applied. Exact.',
  Ranked: 'How many of the retrieved documents were carried forward for review. Retrieval casts a wider net than one person can read, so the top-ranked slice is what gets collapsed into families. Shown only when it differs from Recall.',
  MATCH: 'How many retrieved documents literally satisfy every MATCH block. This is a LENS, not a filter — nothing is removed. All documents are shown below; use the “Meets/Misses MATCH” pills above the results to focus on either group.',
  Families: 'The ranked set collapsed so the same invention filed in several countries appears once. This is what you review.',
  Shown: 'Everything retrieved and ranked is presented — matching, non-matching and NOT-flagged alike. Filters above the results narrow the view without removing anything.',
}

export function GatesFunnel({ counts, detail, running, suggestedTerms, onHarvestTerms }: GatesFunnelProps) {
  const [open, setOpen] = useState(false)

  const gates: Array<{ label: string; value: string; accent?: boolean; clickable?: boolean }> = counts
    ? [
        { label: 'Corpus', value: formatCount(counts.corpus, counts.corpusIsEstimate) },
        { label: 'Filters', value: formatCount(counts.filters, counts.filtersIsEstimate), clickable: true },
        { label: 'Recall', value: formatCount(counts.recall), accent: true },
        // Only shown when it actually differs — an uncounted drop between Recall
        // and Families is exactly the kind of gap this funnel exists to expose,
        // but a stage that always reads the same as the one before it is noise.
        ...(typeof counts.ranked === 'number' && counts.ranked !== counts.recall
          ? [{ label: 'Ranked', value: formatCount(counts.ranked) }]
          : []),
        ...(counts.matchMode === 'filter' && typeof counts.matchSatisfied === 'number'
          ? [{ label: 'MATCH', value: `${counts.matchSatisfied.toLocaleString()}/${(counts.matchSatisfied + (counts.matchRemoved || 0)).toLocaleString()}` }]
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
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <div className="flex items-stretch overflow-x-auto" role="group" aria-label="Search funnel">
          {gates.map((gate, i) => {
            const isOpen = open && gate.clickable
            const className = `relative min-w-[104px] border border-border px-3.5 py-2 text-left transition-colors ${
              i === 0 ? 'rounded-l-lg' : 'border-l-0'
            } ${i === gates.length - 1 ? 'rounded-r-lg' : ''} ${
              isOpen
                ? 'bg-brass-50 ring-1 ring-inset ring-brass-300 dark:bg-brass-950/40 dark:ring-brass-800'
                : gate.accent
                  ? 'bg-lamp-50/70 dark:bg-lamp-950/25'
                  : 'bg-paper-50 dark:bg-background'
            } ${gate.clickable ? 'cursor-pointer hover:bg-brass-50/70 dark:hover:bg-brass-950/25' : ''} ${running ? 'animate-pulse' : ''}`

            // The Hint is itself a <button>, so it must sit OUTSIDE the gate's
            // own button — a nested button is invalid HTML, and React was
            // reporting it as a hydration error on every render of this funnel.
            // The clickable gate becomes a plain container holding a button that
            // covers it, which keeps one accessible control per gate.
            return (
              <div key={gate.label} className={className}>
                <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {gate.clickable ? (
                    <button
                      type="button"
                      onClick={() => setOpen(v => !v)}
                      aria-expanded={open}
                      className="inline-flex items-center gap-1 uppercase tracking-[0.08em] after:absolute after:inset-0 after:content-['']"
                    >
                      {gate.label}
                      <ChevronDown className={`h-2.5 w-2.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                  ) : (
                    gate.label
                  )}
                  <span className="relative z-10">
                    <Hint text={GATE_HELP[gate.label]} />
                  </span>
                </div>
                <div className="font-mono text-base font-semibold leading-tight tabular-nums text-foreground">{gate.value}</div>
              </div>
            )
          })}
        </div>

        {counts?.steered && (
          <span
            className="rounded-full bg-lamp-100 px-2 py-0.5 text-[11px] font-bold text-lamp-700 dark:bg-lamp-950/50 dark:text-lamp-300"
            title="Ranking was influenced by documents you marked relevant — the steer block is on your canvas and removable."
          >
            STEERED
          </span>
        )}

        {counts && counts.semanticLaneRan === false && (
          <span className="inline-flex items-center gap-1 rounded-md border border-red-400 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            ⚠ MEANING LANE DID NOT RUN
            <Hint
              title="Why this matters"
              text="No embedding key is configured, so the search fell back to keyword matching only. The lane counts and vocabulary-gap figure are meaningless for this run, and recall across the worldwide corpus is severely reduced. Do not treat this run as a completed search."
            />
          </span>
        )}

        {lanes && counts?.semanticLaneRan !== false && (
          <div className="ml-auto flex flex-wrap items-center gap-2.5 rounded-lg border border-border bg-paper-50 px-3 py-2 text-xs text-muted-foreground dark:bg-background">
            <span>
              words-only <b className="font-mono text-foreground">{lanes.matchOnly.toLocaleString()}</b>
            </span>
            <span className="text-lamp-600 dark:text-lamp-400">
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
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-lamp-50/60 px-3 py-2 text-xs dark:bg-lamp-950/20">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-lamp-600 dark:text-lamp-400" />
          <span className="text-foreground/90">
            <b>{gapPct}%</b> of meaning-only hits share no word with your query. Vocabulary they use:
          </span>
          {suggestedTerms.slice(0, 6).map(term => (
            <span key={term} className="rounded-full border border-lamp-300 bg-background px-2 py-0.5 font-mono text-[11px] text-lamp-700 dark:border-lamp-800 dark:text-lamp-300">
              {term}
            </span>
          ))}
          <button
            type="button"
            onClick={() => onHarvestTerms(suggestedTerms.slice(0, 6))}
            className="ml-auto rounded-md border border-lamp-300 bg-background px-2 py-1 font-semibold text-lamp-700 hover:bg-lamp-100 dark:border-lamp-800 dark:text-lamp-300"
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
            <h5 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              What each constraint removed
            </h5>
            {detail.constraints.length ? (
              <div className="space-y-1">
                {detail.constraints.map(constraint => (
                  <div key={constraint.label} className="flex items-baseline justify-between gap-3 border-b border-dashed border-border py-1 text-xs">
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
              <p className="text-xs text-muted-foreground">No filters applied — the whole corpus is in scope.</p>
            )}
          </div>

          <div>
            <h5 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              What one change would do
            </h5>
            {detail.sensitivity.length ? (
              <div className="space-y-1">
                {detail.sensitivity.map(item => (
                  <div key={item.label} className="flex items-baseline justify-between gap-3 border-b border-dashed border-border py-1 text-xs">
                    <span className="text-foreground/90">{item.label}</span>
                    <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{item.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Add a filter to see its effect here.</p>
            )}
          </div>

          <div className="sm:col-span-2">
            <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Coverage limits that apply to every query here
            </h5>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {detail.disclosures.map(line => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Counts marked <b>~</b> are instant planner estimates; the evidence trail records exact figures.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
