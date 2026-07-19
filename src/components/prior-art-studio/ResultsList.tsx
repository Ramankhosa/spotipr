'use client'

// Family-grouped results with inbox-grade triage. Every action has a button
// (discoverable) and a key (fast): j/k move, 1/2/3 tag, x exclude, Enter read,
// o open externally. The saturation meter at the foot is the stopping rule —
// it answers "have I searched enough?" with evidence instead of exhaustion.

import { useEffect, useRef } from 'react'
import { BookOpen, ExternalLink, EyeOff, Info } from 'lucide-react'
import { Hint } from '@/components/ui/hint'
import type {
  StudioDocTag,
  StudioElement,
  StudioResultFamily,
  StudioSaturation,
} from '@/lib/prior-art-studio/types'

export interface DocStateLite {
  tag?: StudioDocTag | null
  excluded?: boolean
}

interface ResultsListProps {
  families: StudioResultFamily[]
  totalCount: number
  elements: StudioElement[]
  docStates: Record<string, DocStateLite>
  cursor: number
  onCursorChange: (index: number) => void
  onTag: (family: StudioResultFamily, tag: StudioDocTag | null) => void
  onExclude: (family: StudioResultFamily, excluded: boolean) => void
  onOpenReader: (family: StudioResultFamily) => void
  openFamilyKey?: string | null
  /** The full document reader, rendered inline directly beneath the open card. */
  readerElement?: React.ReactNode
  saturation?: StudioSaturation | null
}

const TAG_META: Record<StudioDocTag, { label: string; classes: string; key: string }> = {
  RELEVANT: { label: 'Relevant', classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300', key: '1' },
  MAYBE: { label: 'Maybe', classes: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300', key: '2' },
  NOT_RELEVANT: { label: 'Not relevant', classes: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300', key: '3' },
}

const LANE_META: Record<string, { label: string; classes: string; help: string }> = {
  match: { label: 'WORDS', classes: 'text-muted-foreground', help: 'Found by literal keyword match only.' },
  cast: {
    label: 'MEANING',
    classes: 'text-blue-600 dark:text-blue-400',
    help: 'Found by meaning only — it shares no query word with your canvas. A keyword-only search would have missed it.',
  },
  both: {
    label: 'WORDS+MEANING',
    classes: 'text-amber-700 dark:text-amber-400',
    help: 'Found by both the keyword lane and the meaning lane — usually the strongest candidates.',
  },
  other: { label: 'FILTER', classes: 'text-muted-foreground', help: 'Surfaced by filters or fuzzy matching.' },
}

const VERDICT_CLASSES: Record<string, string> = {
  STRONG: 'bg-amber-600 text-white border-amber-600',
  PART: 'bg-amber-600/40 text-foreground border-amber-600/60',
  WEAK: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
  NONE: 'bg-muted text-muted-foreground/50 border-border',
}

function googlePatentsUrl(family: StudioResultFamily): string {
  return family.link || `https://patents.google.com/patent/${family.publicationNumber.replace(/[^A-Za-z0-9]/g, '')}`
}

/** Sparkline of new-relevant-per-batch: the shape of a search running dry. */
function SaturationSpark({ saturation }: { saturation: StudioSaturation }) {
  const buckets = saturation.buckets.slice(-8)
  const max = Math.max(1, ...buckets.map(b => b.newRelevant))
  return (
    <span className="inline-flex h-4 items-end gap-[2px]" aria-hidden>
      {buckets.map((bucket, i) => (
        <span
          key={i}
          className="w-[5px] rounded-sm bg-primary/70"
          style={{ height: `${Math.max(2, (bucket.newRelevant / max) * 16)}px` }}
        />
      ))}
    </span>
  )
}

export function ResultsList({
  families,
  totalCount,
  elements,
  docStates,
  cursor,
  onCursorChange,
  onTag,
  onExclude,
  onOpenReader,
  openFamilyKey,
  readerElement,
  saturation,
}: ResultsListProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  useEffect(() => {
    if (!openFamilyKey) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-family="${openFamilyKey}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [openFamilyKey])

  if (!families.length) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-card/50 px-8 py-12 text-center">
        <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Info className="h-5 w-5" />
        </span>
        <p className="text-sm font-semibold text-foreground">
          {totalCount > 0 ? 'Nothing matches these filters' : 'No results yet'}
        </p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {totalCount > 0
            ? `All ${totalCount} documents from this run are hidden by your current filters. Clear or loosen them to see the rest.`
            : 'Run the search to fill this list.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div ref={listRef} className="space-y-2">
        {families.map((family, index) => {
          const state = docStates[family.familyKey] || {}
          const isCursor = index === cursor
          const isOpen = openFamilyKey === family.familyKey
          const lane = LANE_META[family.lane] || LANE_META.other
          return (
            <div key={family.familyKey} className="space-y-2">
            <div
              data-index={index}
              data-family={family.familyKey}
              onClick={() => onCursorChange(index)}
              className={`rounded-xl border bg-card p-3.5 shadow-sm transition-all ${state.excluded ? 'opacity-40' : ''} ${
                isCursor
                  ? 'border-lamp-500 ring-2 ring-lamp-500/25 shadow'
                  : 'border-border hover:border-border hover:shadow'
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation()
                    onOpenReader(family)
                  }}
                  className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/50"
                  title="Open and read this document (Enter)"
                >
                  {family.publicationNumber}
                </button>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation()
                    onOpenReader(family)
                  }}
                  title="Open the full record — abstract, claims, bibliographic details, family"
                  className="text-left text-[14px] font-semibold leading-snug text-foreground transition-colors hover:text-lamp-700 hover:underline dark:hover:text-lamp-300"
                >
                  {family.title}
                </button>
                <span className="text-[10px] text-muted-foreground">
                  {family.members.length > 1 ? `family of ${family.members.length} · ` : ''}
                  {family.applicants ? `${family.applicants} · ` : ''}
                  {family.publicationDate || ''}
                </span>
                {family.isNew && <span className="text-[9px] font-extrabold tracking-wider text-primary">NEW</span>}
                {family.meetsMatch === false && (
                  <span
                    className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground"
                    title="Does not contain a term from every MATCH block — shown anyway, because the closest art often uses different words"
                  >
                    misses MATCH
                  </span>
                )}
                {family.hitsNotTerm && (
                  <span
                    className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300"
                    title="Contains one of your NOT terms — hidden by default, shown because you enabled the NOT-hits filter"
                  >
                    NOT hit
                  </span>
                )}
                {state.tag && (
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${TAG_META[state.tag].classes}`}>
                    {TAG_META[state.tag].label}
                  </span>
                )}
              </div>

              {(family.snippet || family.abstract) && (
                <p className={`mt-1.5 max-w-4xl text-[13px] leading-relaxed text-muted-foreground ${isOpen ? '' : 'line-clamp-2'}`}>
                  {family.snippet || family.abstract}
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {elements.length > 0 && family.elementCells && (
                  <span className="inline-flex gap-1" title="Per-element evidence — see the Element Grid tab">
                    {elements.map((element, i) => {
                      const verdict = family.elementCells?.[element.id]?.verdict || 'NONE'
                      return (
                        <span
                          key={element.id}
                          className={`inline-block w-6 rounded border px-0.5 text-center font-mono text-[8px] leading-[13px] ${VERDICT_CLASSES[verdict]}`}
                          title={`E${i + 1}: ${element.text} — ${verdict}`}
                        >
                          E{i + 1}
                        </span>
                      )
                    })}
                  </span>
                )}

                <span className={`font-mono text-[9px] ${lane.classes}`} title={lane.help}>
                  {lane.label}
                </span>
                {typeof family.rerankScore === 'number' && (
                  <span className="font-mono text-[9px] text-muted-foreground" title="Reranker score — how well this document matches the whole plan (0–1)">
                    rerank {family.rerankScore.toFixed(2)}
                  </span>
                )}
                {(family.matchedFields?.length || family.matchReasons?.length) && (
                  <span className="group relative inline-flex">
                    <button type="button" className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground" onClick={e => e.stopPropagation()}>
                      <Info className="h-3 w-3" /> why this?
                    </button>
                    <span className="invisible absolute left-0 top-full z-40 mt-1 w-72 rounded-lg border border-border bg-popover p-2.5 text-[11px] leading-relaxed text-popover-foreground shadow-lg group-hover:visible">
                      {family.matchReasons?.length ? family.matchReasons.join(' · ') : `Matched: ${family.matchedFields?.join(', ')}`}
                    </span>
                  </span>
                )}

                <span className="ml-auto inline-flex items-center gap-1">
                  <button
                    type="button"
                    title="Read this document (Enter)"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                    onClick={e => {
                      e.stopPropagation()
                      onOpenReader(family)
                    }}
                  >
                    <BookOpen className="h-3 w-3" /> Read
                  </button>
                  {(['RELEVANT', 'MAYBE', 'NOT_RELEVANT'] as const).map(tag => (
                    <button
                      key={tag}
                      type="button"
                      title={`${TAG_META[tag].label} (key ${TAG_META[tag].key})`}
                      className={`rounded-md border px-2 py-1.5 text-[10px] font-semibold sm:py-0.5 ${
                        state.tag === tag ? `${TAG_META[tag].classes} border-transparent` : 'border-border text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={e => {
                        e.stopPropagation()
                        onTag(family, state.tag === tag ? null : tag)
                      }}
                    >
                      {TAG_META[tag].label}
                    </button>
                  ))}
                  <button
                    type="button"
                    title={state.excluded ? 'Restore family (key x)' : 'Exclude family (key x)'}
                    className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground sm:p-1"
                    onClick={e => {
                      e.stopPropagation()
                      onExclude(family, !state.excluded)
                    }}
                  >
                    <EyeOff className="h-3 w-3" />
                  </button>
                  <a
                    href={googlePatentsUrl(family)}
                    target="_blank"
                    rel="noreferrer"
                    title="Open on Google Patents (key o)"
                    className="rounded-md border border-border p-1 text-muted-foreground hover:text-foreground"
                    onClick={e => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </span>
              </div>
            </div>
            {isOpen && readerElement && <div className="pl-2 sm:pl-4">{readerElement}</div>}
            </div>
          )
        })}
      </div>

      {saturation && saturation.reviewed > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-paper-50 px-3.5 py-2.5 text-[11px] text-muted-foreground shadow-sm dark:bg-card">
          <span className="font-semibold text-foreground">Have I searched enough?</span>
          <SaturationSpark saturation={saturation} />
          <span>
            {saturation.reviewed} reviewed · <b className="text-foreground">{saturation.recentRelevant}</b> newly relevant in the
            last two batches
          </span>
          <span className="text-foreground/90">{saturation.suggestion}</span>
          <Hint
            title="The stopping rule"
            text="Reviewing a thousand references has no natural end. This tracks whether new *relevant* art is still appearing — when it stops, you have an evidence-based place to stop, and the report records the depth you reached."
          />
        </div>
      )}
    </div>
  )
}
