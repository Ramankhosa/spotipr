'use client'

import { useMemo, useState } from 'react'
import { Hint } from '@/components/ui/hint'
import { hueFor, type DimensionMapResult, type DimensionMatrix } from './types'

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
export function CoOccupancyGrid({ result }: { result: DimensionMapResult }) {
  const harvested = result.matrices.filter(matrix => matrix.harvested)
  const skipped = result.matrices.filter(matrix => !matrix.harvested)
  const [activeIndex, setActiveIndex] = useState(0)
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
        <div className="rail-x mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {harvested.map((entry, index) => {
            const a = result.registry.find(d => d.id === entry.aDimensionId)
            const b = result.registry.find(d => d.id === entry.bDimensionId)
            return (
              <button
                key={`${entry.aDimensionId}-${entry.bDimensionId}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={[
                  'shrink-0 rounded-full border px-3 py-1 text-xs transition-colors',
                  index === activeIndex
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent',
                ].join(' ')}
              >
                {a?.label} × {b?.label}
              </button>
            )
          })}
        </div>
      )}

      {matrix ? (
        <Matrix result={result} matrix={matrix} />
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

function Matrix({ result, matrix }: { result: DimensionMapResult; matrix: DimensionMatrix }) {
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
                          rowLabel={rowValue.label}
                          colLabel={colValue.label}
                          observed={observed}
                          rowFamilies={rowValue.families}
                          colFamilies={colValue.families}
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
  rowLabel,
  colLabel,
  observed,
  rowFamilies,
  colFamilies,
  gap,
  marginFloor,
}: {
  onClose: () => void
  rowLabel: string
  colLabel: string
  observed: number
  rowFamilies: number
  colFamilies: number
  gap: DimensionMapResult['gaps'][number] | null
  marginFloor: number
}) {
  const thin = rowFamilies < marginFloor || colFamilies < marginFloor
  return (
    <div
      className="absolute left-1/2 top-full z-30 mt-1 w-64 -translate-x-1/2 rounded-lg border border-border bg-popover p-3 text-left shadow-lg"
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
    </div>
  )
}
