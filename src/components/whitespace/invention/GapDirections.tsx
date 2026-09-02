'use client'

import { useState } from 'react'
import { AlertTriangle, ArrowRight, Loader2, Swords } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Hint } from '@/components/ui/hint'
import type { DimensionGap, DimensionMapResult } from './types'

/**
 * Mirrors MAX_PROMOTIONS_PER_CALL in api/whitespace/.../gaps/promote — the
 * server silently drops anything beyond it, so the client must not offer more.
 */
export const MAX_ATTACKS_PER_ROUND = 5

/**
 * Candidate directions — empty cells that survived the margin, expectation and
 * axis-quality tests, ranked.
 *
 * Selecting one promotes it to a hypothesis and runs the studio's existing
 * adversarial validation against it. That attack is metered and genuinely tries
 * to refute the direction, so the selection is deliberate rather than automatic.
 */
export function GapDirections({
  result,
  selected,
  onToggle,
  onAttack,
  attacking,
  attackingLabel,
}: {
  result: DimensionMapResult
  selected: Set<string>
  onToggle: (id: string) => void
  onAttack: () => void
  attacking: boolean
  attackingLabel: string | null
}) {
  if (!result.gaps.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <p className="text-sm text-foreground">No unoccupied combination survived the tests.</p>
        <p className="mx-auto mt-1.5 max-w-lg text-xs leading-relaxed text-muted-foreground">
          Every empty cell in this field was either between values too thin to mean anything, or had too
          few families expected in it for the absence to be surprising. That is an honest reading of{' '}
          {result.familyCount.toLocaleString()} families — this field is either well covered at the level
          the viewpoints describe, or too small to show structure. Widening the scope gives the grid more
          to work with.
        </p>
      </div>
    )
  }

  const pending = result.gaps.filter(gap => !gap.hypothesisId)
  const promoted = result.gaps.filter(gap => gap.hypothesisId)
  const atCap = selected.size >= MAX_ATTACKS_PER_ROUND

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Directions worth testing
          <Hint
            title="What survives to here"
            text="A cell reaches this list only when it is empty, both of its values are independently well established in the field, and enough families were expected in it that the zero is surprising rather than arithmetic. Ranking favours cells whose neighbours prove the combination was reachable."
          />
        </h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {result.gaps.length} candidate{result.gaps.length === 1 ? '' : 's'}
        </span>
      </div>

      <ul className="space-y-3">
        {[...pending, ...promoted].map(gap => (
          <li key={gap.id}>
            <GapCard
              gap={gap}
              familyCount={result.familyCount}
              selected={selected.has(gap.id)}
              onToggle={() => onToggle(gap.id)}
              disabled={attacking || (atCap && !selected.has(gap.id))}
            />
          </li>
        ))}
      </ul>

      <div className="sticky bottom-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-3.5 shadow-sm backdrop-blur">
        <p className="text-xs text-muted-foreground">
          {attacking
            ? attackingLabel || 'Attacking…'
            : selected.size
              ? `${selected.size} of ${MAX_ATTACKS_PER_ROUND} selected. Each runs a full adversarial search that tries to refute it.`
              : `Select the directions worth the search budget — up to ${MAX_ATTACKS_PER_ROUND} per attack round.`}
        </p>
        <Button size="sm" onClick={onAttack} disabled={attacking || selected.size === 0}>
          {attacking ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Attacking…
            </>
          ) : (
            <>
              <Swords className="mr-2 h-4 w-4" />
              Attack selected{selected.size ? ` (${selected.size})` : ''}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

function GapCard({
  gap,
  familyCount,
  selected,
  onToggle,
  disabled,
}: {
  gap: DimensionGap
  familyCount: number
  selected: boolean
  onToggle: () => void
  disabled: boolean
}) {
  const [showWorking, setShowWorking] = useState(false)
  const claimsPct =
    gap.armFamilies && gap.armFamilies > 0 && gap.armClaimsReadable !== null
      ? Math.round((gap.armClaimsReadable / gap.armFamilies) * 100)
      : null

  return (
    <article
      className={[
        'rounded-xl border bg-card p-4 transition-colors',
        gap.hypothesisId ? 'border-primary/40 bg-primary/[0.03]' : selected ? 'border-primary' : 'border-border',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        {!gap.hypothesisId && (
          <Checkbox checked={selected} onCheckedChange={onToggle} disabled={disabled} className="mt-1 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold leading-snug text-foreground">
            {gap.aValueLabel} <span className="font-normal text-muted-foreground">combined with</span>{' '}
            {gap.bValueLabel}
          </h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {gap.aDimensionLabel} × {gap.bDimensionLabel}
          </p>

          <p className="mt-2 text-xs leading-relaxed text-foreground">
            {gap.marginA.toLocaleString()} families use{' '}
            <span className="font-medium">{gap.aValueLabel}</span> and {gap.marginB.toLocaleString()} use{' '}
            <span className="font-medium">{gap.bValueLabel}</span>, but{' '}
            {gap.observed === 0 ? 'none combine them' : `only ${gap.observed} combine them`} — against about{' '}
            {gap.expected.toFixed(0)} expected by chance.
          </p>

          {gap.nearMissB && (
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Families using {gap.aValueLabel} usually solve {gap.bDimensionLabel} with{' '}
              <span className="text-foreground">{gap.nearMissB.valueLabel}</span> instead (
              {gap.nearMissB.families.toLocaleString()}) — the combination was reachable and the field went
              elsewhere.
            </p>
          )}

          {gap.coverageSuspect && gap.suspectReason && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] leading-snug text-amber-900">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              <span>{gap.suspectReason}</span>
            </p>
          )}

          {gap.hypothesisId && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
              <ArrowRight className="h-3 w-3" />
              Promoted — see the attack result below
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
            <span>{claimsPct === null ? 'claims not measured' : `claims readable for ${claimsPct}% nearby`}</span>
            <button
              type="button"
              onClick={() => setShowWorking(value => !value)}
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              {showWorking ? 'hide' : 'show'} the working
            </button>
          </div>

          {showWorking && (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-l border-border pl-3 text-[11px] tabular-nums sm:grid-cols-4">
              {[
                ['observed', gap.observed.toLocaleString()],
                ['expected', gap.expected.toFixed(1)],
                ['z', gap.z.toFixed(2)],
                ['rarity', gap.rarity.toFixed(2)],
                ['field', familyCount.toLocaleString()],
                ['no value on the other axis', gap.unassignedOnB.toLocaleString()],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <GapAnatomy gap={gap} />
      </div>
    </article>
  )
}

/**
 * The gap at a glance: two populated margins, an empty intersection, and where
 * those families went instead. Shape-coded, so it survives greyscale printing.
 */
function GapAnatomy({ gap }: { gap: DimensionGap }) {
  const max = Math.max(gap.marginA, gap.marginB, 1)
  const aWidth = Math.max(8, Math.round((gap.marginA / max) * 46))
  const bWidth = Math.max(8, Math.round((gap.marginB / max) * 46))

  return (
    <svg
      viewBox="0 0 124 62"
      className="hidden h-[62px] w-[124px] shrink-0 sm:block"
      role="img"
      aria-label={`${gap.marginA} families on one value, ${gap.marginB} on the other, ${gap.observed} on both`}
    >
      <text x="0" y="8" className="fill-current text-[7px] text-muted-foreground">
        {gap.aValueLabel.slice(0, 16)}
      </text>
      <rect x="0" y="11" width={aWidth} height="9" rx="2" className="fill-current text-foreground/70" />
      <text x={aWidth + 4} y="18.5" className="fill-current text-[7px] tabular-nums text-muted-foreground">
        {gap.marginA.toLocaleString()}
      </text>

      <text x="0" y="34" className="fill-current text-[7px] text-muted-foreground">
        {gap.bValueLabel.slice(0, 16)}
      </text>
      <rect x="0" y="37" width={bWidth} height="9" rx="2" className="fill-current text-foreground/70" />
      <text x={bWidth + 4} y="44.5" className="fill-current text-[7px] tabular-nums text-muted-foreground">
        {gap.marginB.toLocaleString()}
      </text>

      <rect
        x="0"
        y="52"
        width="46"
        height="9"
        rx="2"
        fill="none"
        strokeDasharray="3 2"
        className="stroke-current text-foreground/50"
        strokeWidth="1"
      />
      <text x="50" y="59.5" className="fill-current text-[7px] tabular-nums text-muted-foreground">
        both: {gap.observed}
      </text>
    </svg>
  )
}
