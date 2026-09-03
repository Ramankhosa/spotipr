'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Hint } from '@/components/ui/hint'
import { isPollAborted, wsApi } from '../api'
import { DISTANCE_TOOLTIP, type SemanticSearchNeighbor } from '../SemanticSearchPanel'
import { hueFor, type DimensionMapResult, type DimensionMatrix, type DimensionValue } from './types'

/**
 * The grid: two viewpoints crossed, every cell an exact family count.
 *
 * Follows the house matrix rules from prior-art-studio/ElementGrid — cells are
 * categorical rather than a continuous heat ramp, every cell opens what is
 * behind it, and no number appears without something behind it. Occupancy uses
 * an ordinal ink ramp rather than the brand cobalt, which means action and AI
 * everywhere else in the product; gap cells are marked by SHAPE (a dashed well)
 * rather than colour, so they read even where the ramp is dark.
 */
/**
 * Pair chips beyond this count collapse behind a "Show all" toggle. The rail
 * used to be one hidden-scrollbar line, which left every off-screen pair
 * undiscoverable; wrapping shows everything, and the cap keeps a 28-pair
 * registry from burying the grid it selects for.
 */
const PAIR_CHIP_LIMIT = 12

export function CoOccupancyGrid({ result, studyId }: { result: DimensionMapResult; studyId: string }) {
  const harvested = result.matrices.filter(matrix => matrix.harvested)
  const skipped = result.matrices.filter(matrix => !matrix.harvested)
  const [activeIndex, setActiveIndex] = useState(0)
  const [showAllPairs, setShowAllPairs] = useState(false)
  // A recount replaces the matrices wholesale; a stale index would silently
  // show a different pair (or none) under the previously active chip.
  useEffect(() => {
    setActiveIndex(0)
    setShowAllPairs(false)
  }, [result])
  const matrix = harvested[activeIndex] ?? harvested[0] ?? null

  if (!result.matrices.length) {
    return (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Fewer than two viewpoints survived, so there is nothing to cross.
      </p>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Where the field actually sits
          <Hint
            title="How to read the grid"
            text="Each cell counts the patent families that occupy BOTH values. A cell is only treated as a gap when both its row and column are well populated on their own and the two axes are independent enough that a zero is surprising — otherwise an empty cell is just arithmetic."
          />
        </h3>
        {harvested.length > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            counts are families, not publications
          </span>
        )}
      </div>

      {harvested.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {harvested.map((entry, index) => {
            // Indices stay original across the collapse so a chip always
            // selects the pair it names; the active chip never hides.
            if (!showAllPairs && index >= PAIR_CHIP_LIMIT && index !== activeIndex) return null
            const a = result.registry.find(d => d.id === entry.aDimensionId)
            const b = result.registry.find(d => d.id === entry.bDimensionId)
            return (
              <button
                key={`${entry.aDimensionId}-${entry.bDimensionId}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={[
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  index === activeIndex
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent',
                ].join(' ')}
              >
                {a?.label} × {b?.label}
              </button>
            )
          })}
          {harvested.length > PAIR_CHIP_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAllPairs(v => !v)}
              className="rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {showAllPairs ? 'Show fewer' : `Show all ${harvested.length} pairs`}
            </button>
          )}
        </div>
      )}

      {matrix ? (
        <Matrix result={result} matrix={matrix} studyId={studyId} />
      ) : (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-foreground">No viewpoint pair could be read for emptiness.</p>
          <p className="mx-auto mt-1.5 max-w-lg text-xs text-muted-foreground">
            Every pair was set aside for the reasons below. That is a finding about this field, not a
            failure — an empty cell between axes that overlap, or on an axis that sees only a sliver of
            the field, would be a vocabulary artefact rather than an opening.
          </p>
        </div>
      )}

      {skipped.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            {skipped.length} viewpoint pair{skipped.length === 1 ? '' : 's'} set aside, and why
          </summary>
          <ul className="mt-2 space-y-1.5 border-l border-border pl-3">
            {skipped.map(entry => {
              const a = result.registry.find(d => d.id === entry.aDimensionId)
              const b = result.registry.find(d => d.id === entry.bDimensionId)
              return (
                <li key={`${entry.aDimensionId}-${entry.bDimensionId}`} className="text-xs">
                  <span className="font-medium text-foreground">
                    {a?.label} × {b?.label}
                  </span>
                  <span className="block text-muted-foreground">{entry.skipReason}</span>
                </li>
              )
            })}
          </ul>
        </details>
      )}
    </div>
  )
}

function Matrix({
  result,
  matrix,
  studyId,
}: {
  result: DimensionMapResult
  matrix: DimensionMatrix
  studyId: string
}) {
  const aIndex = result.registry.findIndex(d => d.id === matrix.aDimensionId)
  const bIndex = result.registry.findIndex(d => d.id === matrix.bDimensionId)
  const a = result.registry[aIndex]
  const b = result.registry[bIndex]
  const [open, setOpen] = useState<string | null>(null)

  const cellMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const cell of matrix.cells) map.set(`${cell.aValueId}:${cell.bValueId}`, cell.observed)
    return map
  }, [matrix])

  const gapMap = useMemo(() => {
    const map = new Map<string, (typeof result.gaps)[number]>()
    for (const gap of result.gaps) map.set(`${gap.aValueId}:${gap.bValueId}`, gap)
    return map
  }, [result.gaps])

  if (!a || !b) return null
  const maxCell = Math.max(1, ...matrix.cells.map(cell => cell.observed))

  /** Ordinal ink ramp — four steps, so a cell reads as a category not a gradient. */
  const cellStyle = (observed: number) => {
    if (observed === 0) return 'bg-card text-muted-foreground'
    const ratio = observed / maxCell
    if (ratio > 0.66) return 'bg-foreground/80 text-background'
    if (ratio > 0.33) return 'bg-foreground/45 text-background'
    if (ratio > 0.1) return 'bg-foreground/20 text-foreground'
    return 'bg-foreground/[0.08] text-foreground'
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${hueFor(aIndex).dot}`} aria-hidden />
          rows: {a.label}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${hueFor(bIndex).dot}`} aria-hidden />
          columns: {b.label}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-foreground/50" aria-hidden />
          candidate gap
        </span>
      </div>

      <div className="scroll-x">
        <table className="w-full border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">
            Families occupying each combination of {a.label} and {b.label}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-card p-1 text-left" />
              {b.values.map(value => (
                <th
                  key={value.id}
                  scope="col"
                  className="min-w-[4.5rem] p-1 align-bottom text-[10px] font-medium leading-tight text-muted-foreground"
                >
                  {value.label}
                </th>
              ))}
              <th scope="col" className="min-w-[3rem] p-1 text-[10px] font-semibold text-muted-foreground">
                row
              </th>
            </tr>
          </thead>
          <tbody>
            {a.values.map(rowValue => (
              <tr key={rowValue.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 min-w-[8rem] max-w-[11rem] bg-card p-1 text-left text-[11px] font-medium leading-tight text-foreground"
                >
                  {rowValue.label}
                </th>
                {b.values.map(colValue => {
                  const key = `${rowValue.id}:${colValue.id}`
                  const observed = cellMap.get(key) ?? 0
                  const gap = gapMap.get(key)
                  const isOpen = open === key
                  return (
                    <td key={colValue.id} className="relative p-0">
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : key)}
                        className={[
                          'novelty-matrix-cell h-11 w-full rounded-sm text-center text-[11px] font-medium tabular-nums transition-colors',
                          cellStyle(observed),
                          gap ? 'border-2 border-dashed border-foreground/50' : 'border border-transparent',
                          isOpen ? 'ring-2 ring-primary ring-offset-1' : '',
                        ].join(' ')}
                        aria-label={`${rowValue.label} with ${colValue.label}: ${observed} families${gap ? ', candidate gap' : ''}`}
                      >
                        {observed === 0 ? (gap ? '—' : '0') : observed.toLocaleString()}
                      </button>
                      {isOpen && (
                        <CellPopover
                          onClose={() => setOpen(null)}
                          studyId={studyId}
                          aDimensionLabel={a.label}
                          bDimensionLabel={b.label}
                          rowValue={rowValue}
                          colValue={colValue}
                          observed={observed}
                          gap={gap ?? null}
                          marginFloor={result.thresholds.marginFloor}
                        />
                      )}
                    </td>
                  )
                })}
                <td className="p-1 text-center text-[11px] tabular-nums text-muted-foreground">
                  {rowValue.families.toLocaleString()}
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="sticky left-0 z-10 bg-card p-1 text-left text-[10px] font-semibold text-muted-foreground">
                column
              </th>
              {b.values.map(value => (
                <td key={value.id} className="p-1 text-center text-[11px] tabular-nums text-muted-foreground">
                  {value.families.toLocaleString()}
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CellPopover({
  onClose,
  studyId,
  aDimensionLabel,
  bDimensionLabel,
  rowValue,
  colValue,
  observed,
  gap,
  marginFloor,
}: {
  onClose: () => void
  studyId: string
  aDimensionLabel: string
  bDimensionLabel: string
  rowValue: DimensionValue
  colValue: DimensionValue
  observed: number
  gap: DimensionMapResult['gaps'][number] | null
  marginFloor: number
}) {
  const rowLabel = rowValue.label
  const colLabel = colValue.label
  const rowFamilies = rowValue.families
  const colFamilies = colValue.families
  const thin = rowFamilies < marginFloor || colFamilies < marginFloor

  // The nearest-art probe is on demand: each press is one embed call, so it
  // never fires on open. State lives here — the popover unmounts on close, so
  // reopening starts idle (a fresh call, bounded by the endpoint's rate cap).
  const [artState, setArtState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'loaded'; neighbors: SemanticSearchNeighbor[] }
    | { kind: 'unavailable'; reason: string }
    | { kind: 'failed'; message: string }
  >({ kind: 'idle' })

  const findClosestArt = async () => {
    setArtState({ kind: 'loading' })
    // Labels plus a few synonyms per side — embeddings need vocabulary, not
    // grammar, the same way the census phrases a value's query.
    const query = [
      aDimensionLabel,
      rowLabel,
      ...rowValue.synonyms.slice(0, 4),
      bDimensionLabel,
      colLabel,
      ...colValue.synonyms.slice(0, 4),
    ]
      .join(', ')
      .slice(0, 600)
    try {
      const payload = await wsApi<
        | { available: true; neighbors: SemanticSearchNeighbor[] }
        | { available: false; reason: string }
      >(`/api/whitespace/studies/${studyId}/semantic-search`, {
        method: 'POST',
        body: JSON.stringify({ query, limit: 5 }),
      })
      if (!payload.available) setArtState({ kind: 'unavailable', reason: payload.reason })
      else setArtState({ kind: 'loaded', neighbors: payload.neighbors })
    } catch (error) {
      if (isPollAborted(error)) return
      setArtState({ kind: 'failed', message: error instanceof Error ? error.message : 'Try again.' })
    }
  }

  return (
    <div
      className="absolute left-1/2 top-full z-30 mt-1 w-72 -translate-x-1/2 rounded-lg border border-border bg-popover p-3 text-left shadow-lg"
      role="dialog"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-2 top-2 text-xs text-muted-foreground hover:text-foreground"
        aria-label="Close"
      >
        ✕
      </button>
      <p className="pr-4 text-xs font-semibold text-foreground">
        {rowLabel} × {colLabel}
      </p>
      <p className="mt-1.5 text-xs tabular-nums text-foreground">
        {observed.toLocaleString()} famil{observed === 1 ? 'y' : 'ies'} occupy both
      </p>
      <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
        {rowFamilies.toLocaleString()} occupy {rowLabel} · {colFamilies.toLocaleString()} occupy {colLabel}
      </p>
      {gap ? (
        <div className="mt-2 border-t border-border pt-2">
          <p className="text-[11px] leading-snug text-foreground">
            About {gap.expected.toFixed(0)} were expected here if the two viewpoints were independent.
          </p>
          {gap.nearMissB && (
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {rowLabel} families usually take <span className="text-foreground">{gap.nearMissB.valueLabel}</span>{' '}
              instead ({gap.nearMissB.families.toLocaleString()}).
            </p>
          )}
          {gap.coverageSuspect && gap.suspectReason && (
            <p className="mt-1 text-[11px] leading-snug text-amber-800">{gap.suspectReason}</p>
          )}
        </div>
      ) : observed === 0 ? (
        <p className="mt-2 border-t border-border pt-2 text-[11px] leading-snug text-muted-foreground">
          {thin
            ? `Empty, but ${rowFamilies < marginFloor ? rowLabel : colLabel} is too thin on its own (under ${marginFloor.toLocaleString()} families) for the emptiness to mean anything.`
            : 'Empty, but too few families were expected here for the absence to be surprising.'}
        </p>
      ) : null}

      <div className="mt-2 border-t border-border pt-2">
        {artState.kind === 'idle' && (
          <div>
            <button
              type="button"
              onClick={() => void findClosestArt()}
              className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
            >
              Find the closest art
            </button>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Runs one meaning-based search for this combination.
            </p>
          </div>
        )}
        {artState.kind === 'loading' && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Searching near this combination…
          </p>
        )}
        {artState.kind === 'unavailable' && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Semantic search is unavailable — {artState.reason}
          </p>
        )}
        {artState.kind === 'failed' && (
          <p className="text-[11px] leading-snug text-muted-foreground">{artState.message}</p>
        )}
        {artState.kind === 'loaded' &&
          (artState.neighbors.length === 0 ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Nothing in this field reads close to this combination — consistent with a gap, though
              absence of art is never proof.
            </p>
          ) : (
            <div>
              <p className="text-[11px] font-medium text-foreground">Closest art to this combination</p>
              <ul className="mt-1 max-h-48 space-y-1.5 overflow-y-auto">
                {artState.neighbors.map(neighbor => (
                  <li key={neighbor.publicationNumber} className="text-[11px] leading-snug">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {neighbor.publicationNumber}
                    </span>{' '}
                    <span className="font-mono text-[10px] text-muted-foreground" title={DISTANCE_TOOLTIP}>
                      dist {neighbor.distance.toFixed(2)}
                    </span>
                    <span className="line-clamp-1 text-foreground">{neighbor.title ?? 'Untitled'}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </div>
  )
}
