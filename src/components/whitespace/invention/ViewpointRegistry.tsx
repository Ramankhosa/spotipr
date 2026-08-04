'use client'

import { useState } from 'react'
import { Sparkles, Trash2, RotateCcw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/hint'
import { hueFor, type Dimension, type DimensionMapResult } from './types'

export interface RegistryEdit {
  removedDimensions: Set<string>
  removedValues: Set<string>
}

/**
 * The viewpoint registry — the answer to "how is this field organised?".
 *
 * Two rules this screen must not break:
 *   1. Values are vocabulary, not a partition. A family can occupy several
 *      values of one axis, so value counts are drawn as independent bars
 *      against the field, never as slices of a pie.
 *   2. Growth is the point. Anything discovered after the seed round carries a
 *      round badge, because that is the mechanism the product is built on.
 */
export function ViewpointRegistry({
  result,
  edit,
  onToggleDimension,
  onToggleValue,
  onRecount,
  recounting,
  dirty,
}: {
  result: DimensionMapResult
  edit: RegistryEdit
  onToggleDimension: (id: string) => void
  onToggleValue: (id: string) => void
  onRecount: () => void
  recounting: boolean
  dirty: boolean
}) {
  const remaining = result.registry.filter(dimension => !edit.removedDimensions.has(dimension.id))
  const remainingValues = remaining.reduce(
    (sum, dimension) => sum + dimension.values.filter(value => !edit.removedValues.has(value.id)).length,
    0
  )
  const tooSmall = remaining.length < 2 || remainingValues < 4

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Viewpoints in this field
          <Hint
            title="What a viewpoint is"
            text="An axis along which the documents in this field genuinely differ — the way the Japanese Patent Office's F-terms give each technical field its own set of viewpoints (purpose, means, material, operating condition). Each value is matched by its own vocabulary, and the counts are an exact census of the whole field."
          />
        </h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {remaining.length} viewpoints · {remainingValues} values · {result.familyCount.toLocaleString()} families
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {result.registry.map((dimension, index) => (
          <DimensionCard
            key={dimension.id}
            dimension={dimension}
            hue={hueFor(index)}
            familyCount={result.familyCount}
            removed={edit.removedDimensions.has(dimension.id)}
            removedValues={edit.removedValues}
            onToggleDimension={() => onToggleDimension(dimension.id)}
            onToggleValue={onToggleValue}
          />
        ))}
      </div>

      {dirty && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3.5">
          <p className="text-sm text-foreground">
            {tooSmall
              ? 'Keep at least two viewpoints and four values — below that there is nothing to cross.'
              : 'Your edits change what gets counted. Recount to rebuild the grid and the directions from them.'}
          </p>
          <Button size="sm" onClick={onRecount} disabled={recounting || tooSmall}>
            {recounting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Recounting…
              </>
            ) : (
              <>
                <RotateCcw className="mr-2 h-4 w-4" />
                Recount the field
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

function DimensionCard({
  dimension,
  hue,
  familyCount,
  removed,
  removedValues,
  onToggleDimension,
  onToggleValue,
}: {
  dimension: Dimension
  hue: ReturnType<typeof hueFor>
  familyCount: number
  removed: boolean
  removedValues: Set<string>
  onToggleDimension: () => void
  onToggleValue: (id: string) => void
}) {
  const [showVocab, setShowVocab] = useState(false)
  const placedShare = 1 - dimension.residualShare
  const maxValue = Math.max(1, ...dimension.values.map(value => value.families))

  return (
    <section
      className={[
        'rounded-xl border bg-card p-4 transition-opacity',
        removed ? 'border-dashed border-border opacity-50' : 'border-border',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${hue.dot}`} aria-hidden />
            <h4 className="text-sm font-semibold text-foreground">{dimension.label}</h4>
            {dimension.introducedInRound > 1 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-medium text-emerald-800">
                <Sparkles className="h-2.5 w-2.5" />
                round {dimension.introducedInRound}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{dimension.description}</p>
        </div>
        <button
          type="button"
          onClick={onToggleDimension}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={removed ? `Restore ${dimension.label}` : `Remove ${dimension.label}`}
          title={removed ? 'Restore this viewpoint' : 'Remove this viewpoint'}
        >
          {removed ? <RotateCcw className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Coverage: how much of the field this axis can place at all. */}
      <div className="mt-3 flex items-center gap-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${hue.bar}`} style={{ width: `${Math.round(placedShare * 100)}%` }} />
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          places {Math.round(placedShare * 100)}%
        </span>
      </div>

      <ul className="mt-3 space-y-1.5">
        {dimension.values.map(value => {
          const valueRemoved = removedValues.has(value.id) || removed
          return (
            <li key={value.id} className="group flex items-center gap-2">
              <button
                type="button"
                onClick={() => onToggleValue(value.id)}
                disabled={removed}
                className={[
                  'flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors',
                  removed ? 'cursor-default' : 'hover:bg-accent/50',
                  valueRemoved ? 'opacity-45' : '',
                ].join(' ')}
                title={removed ? undefined : valueRemoved ? 'Restore this value' : 'Remove this value'}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-xs ${valueRemoved ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                      {value.label}
                      {value.round > 1 && (
                        <span className="ml-1 text-[10px] font-medium text-emerald-700">·new</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {value.families.toLocaleString()}
                    </span>
                  </span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className={`block h-full rounded-full ${hue.bar} opacity-70`}
                      style={{ width: `${Math.round((value.families / maxValue) * 100)}%` }}
                    />
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {dimension.multiAssignmentRatio > 1.2 && (
        <p className="mt-2.5 text-[11px] leading-snug text-muted-foreground">
          Values overlap here — many families match more than one, so these counts add up to more than the{' '}
          {dimension.assignedFamilies.toLocaleString()} families this viewpoint places.
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowVocab(value => !value)}
        className="mt-2.5 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {showVocab ? 'Hide' : 'Show'} the words each value matches
      </button>
      {showVocab && (
        <dl className="mt-2 space-y-1.5 border-l border-border pl-3">
          {dimension.values.map(value => (
            <div key={value.id}>
              <dt className="text-[11px] font-medium text-foreground">{value.label}</dt>
              <dd className="text-[11px] leading-snug text-muted-foreground">
                {[value.label, ...value.synonyms].join(' · ')}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
