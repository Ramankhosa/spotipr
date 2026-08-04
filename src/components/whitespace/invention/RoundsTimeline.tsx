'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { Hint } from '@/components/ui/hint'
import { REJECTION_LABEL, SETTLED_LABEL, type DimensionMapResult, type DimensionRound } from './types'

/**
 * The discovery loop, made legible.
 *
 * The whole premise of an invention study is that the viewpoint set GROWS as
 * unplaced documents reveal axes the first guess missed. That is invisible in a
 * final registry, so each round gets a band: what it proposed, what survived
 * measurement, and — the load-bearing number — how much of the field remained
 * unplaced afterwards. Watching that bar fill is the proof the set converged.
 */
export function RoundsTimeline({ result }: { result: DimensionMapResult }) {
  const reduceMotion = useReducedMotion()
  const rounds = result.rounds

  if (!rounds.length) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        These viewpoints were supplied rather than discovered, so there is no discovery history to show.
      </p>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          How the viewpoints were found
          <Hint
            title="Why rounds"
            text="Each round reads documents that no existing viewpoint places, and asks whether they need a new value on an existing axis or a whole new axis. Every proposal is then counted against the field before it is accepted — the model names categories, the database decides whether they are real."
          />
        </h3>
        <span className="text-xs text-muted-foreground">{SETTLED_LABEL[result.settledReason]}</span>
      </div>

      <ol className="space-y-2.5">
        {rounds.map((round, index) => (
          <motion.li
            key={round.round}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduceMotion ? 0 : index * 0.12, duration: 0.3 }}
          >
            <RoundBand round={round} isLast={index === rounds.length - 1} />
          </motion.li>
        ))}
      </ol>
    </div>
  )
}

function RoundBand({ round, isLast }: { round: DimensionRound; isLast: boolean }) {
  const placedShare = 1 - round.residualShareAfter
  const added = round.acceptedValues.length
  const newAxes = round.acceptedDimensions.length

  const summary =
    added === 0
      ? 'nothing new survived measurement'
      : round.round === 1
        ? `seeded ${newAxes} viewpoint${newAxes === 1 ? '' : 's'}, ${added} value${added === 1 ? '' : 's'}`
        : `added ${newAxes ? `${newAxes} viewpoint${newAxes === 1 ? '' : 's'}, ` : ''}${added} value${added === 1 ? '' : 's'}`

  return (
    <div className="rounded-xl border border-border bg-card p-3.5 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex h-6 items-center rounded-full border border-border px-2 text-[11px] font-semibold tabular-nums text-foreground">
          Round {round.round}
        </span>
        <span className="text-sm text-foreground">{summary}</span>
        {added > 0 && round.round > 1 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
            <Sparkles className="h-3 w-3" />
            new
          </span>
        )}
        {isLast && added === 0 && (
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            settled
          </span>
        )}
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">
        Read {round.slice.families.toLocaleString()}{' '}
        {round.slice.basis === 'sample' ? 'sampled families' : 'families no viewpoint could place'} · proposed{' '}
        {round.proposedValues.length} value{round.proposedValues.length === 1 ? '' : 's'} · kept {added} · dropped{' '}
        {round.rejected.length}
      </p>

      {/* The convergence signal: how much of the field is placed after this round. */}
      <div className="mt-3 flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`${Math.round(placedShare * 100)} percent of sampled families placed after round ${round.round}`}
        >
          <div className="h-full rounded-full bg-foreground/70" style={{ width: `${Math.round(placedShare * 100)}%` }} />
        </div>
        <span className="w-28 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {Math.round(placedShare * 100)}% placed
        </span>
      </div>

      {round.rejected.length > 0 && (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            What we tried and dropped ({round.rejected.length})
          </summary>
          <ul className="mt-2 space-y-1.5 border-l border-border pl-3">
            {round.rejected.map((entry, index) => (
              <li key={`${entry.label}-${index}`} className="text-xs">
                <span className="font-medium text-foreground">{entry.label}</span>
                <span className="mx-1.5 rounded border border-border bg-muted px-1 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
                  {REJECTION_LABEL[entry.reason]}
                </span>
                <span className="block text-muted-foreground">{entry.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
