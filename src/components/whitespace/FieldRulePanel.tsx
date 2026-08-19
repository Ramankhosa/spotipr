'use client'

/**
 * The match rule, as the user sets it and as a run resolved it.
 *
 * Shared by the landscape and invention study pages so the one knob that sizes
 * the field reads the same in both: "a document is in the field when it matches
 * every must-appear concept and at least k of the others", with k either fitted
 * (auto) or pinned. The ladder shows what every rung a run measured came to,
 * so the fitted k is a reviewable choice rather than a hidden one.
 */

import { rungIsCompilable } from '@/lib/whitespace/scope-schema'
import { rungPhrase } from '@/lib/whitespace/field-rule'
import { scopeMatching, type FieldRule, type ScopeMatching, type WhitespaceScope } from '@/lib/whitespace/types'

const num = (value: number) => value.toLocaleString()

/** What the control needs from a scope — the invention page carries a narrower scope type. */
export type MatchRuleScope = Pick<WhitespaceScope, 'matching'> & {
  concepts: Array<Pick<WhitespaceScope['concepts'][number], 'label' | 'synonyms' | 'required'>>
}

/** The must-appear / optional split the rule is about, from a scope's concepts. */
export function conceptCounts(scope: Pick<MatchRuleScope, 'concepts'>): { requiredCount: number; optionalCount: number } {
  const usable = scope.concepts.filter(concept => concept.label.trim() || concept.synonyms.some(s => s.trim()))
  const requiredCount = usable.filter(concept => concept.required).length
  return { requiredCount, optionalCount: usable.length - requiredCount }
}

export function MatchRuleControl({
  scope,
  onChange,
  disabled,
  compact,
}: {
  scope: MatchRuleScope
  onChange: (matching: ScopeMatching) => void
  disabled?: boolean
  /** One-line layout for the invention page's chip row. */
  compact?: boolean
}) {
  const counts = conceptCounts(scope)
  const min = counts.requiredCount > 0 ? 0 : Math.min(1, counts.optionalCount)
  const value = scopeMatching(scope).minimumOptionalConcepts
  const options: number[] = []
  for (let k = counts.optionalCount; k >= min; k--) if (rungIsCompilable(counts.optionalCount, k)) options.push(k)
  // A pinned value that the current concept list cannot express is still shown
  // (so the user sees it and can change it) — scopeIsRunnable refuses the run.
  if (typeof value === 'number' && !options.includes(value)) options.unshift(value)

  const nothingToChoose = counts.optionalCount === 0 || (counts.optionalCount === 1 && min === 1)
  const selectId = 'ws-match-rule'

  return (
    <div className={compact ? 'flex flex-wrap items-center gap-x-2 gap-y-1' : ''}>
      <label htmlFor={selectId} className={compact ? 'text-[11px] text-muted-foreground' : 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground'}>
        {compact ? 'A document counts when it has' : 'Match rule'}
      </label>
      {!compact && (
        <p className="mb-2 text-xs text-muted-foreground">
          A document is in the field when it contains{' '}
          {counts.requiredCount > 0 ? (
            <>
              every must-appear concept <span className="text-foreground">and</span>{' '}
            </>
          ) : null}
          the number of {counts.requiredCount > 0 ? 'other ' : ''}concepts chosen here.
        </p>
      )}
      <select
        id={selectId}
        value={value === 'auto' ? 'auto' : String(value)}
        disabled={disabled || nothingToChoose}
        onChange={event =>
          onChange({ minimumOptionalConcepts: event.target.value === 'auto' ? 'auto' : Number(event.target.value) })
        }
        className={`rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
          compact ? 'h-7 px-2 text-xs' : 'h-9 px-3'
        }`}
        title={
          nothingToChoose
            ? 'Add optional concepts to get a choice here — with none, only the must-appear concepts define the field.'
            : 'Auto measures every rung and takes the tightest one that still yields a field the study can analyse.'
        }
      >
        <option value="auto">
          {compact ? 'auto: as many of the other concepts as still yields a field' : 'Auto — fitted to the field size'}
        </option>
        {options.map(k => (
          <option key={k} value={String(k)}>
            {rungPhrase(counts, k)}
          </option>
        ))}
      </select>
      {!compact && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {value === 'auto'
            ? 'Auto measures each rung, tightest first, and takes the first one that reaches the family floor without crossing the publication ceiling. Every rung it measured is listed with the field map.'
            : 'Pinned. The field will be exactly this rung — even if it turns out too small or too big to analyse. Set it back to auto to let the study choose.'}
        </p>
      )}
    </div>
  )
}

/** Fit → one sentence, and whether it warrants attention. */
export function fitSummary(rule: FieldRule): { text: string; warn: boolean } {
  const chosen = rule.ladder.find(rung => rung.minimumOptional === rule.minimumOptional)
  const families = chosen && chosen.families !== null && !chosen.overCap ? ` (${num(chosen.families)} families)` : ''
  const phrase = rule.optionalCount > 0 ? rungPhrase(rule, rule.minimumOptional) : 'every must-appear concept'
  switch (rule.fit) {
    case 'in-band':
      return { text: `Auto chose ${phrase}${families} — the tightest rung inside the ${num(rule.band.minFamilies)}-family floor and ${num(rule.band.maxPublications)}-publication ceiling.`, warn: false }
    case 'too-narrow':
      return { text: `Even the loosest rung, ${phrase}${families}, is under the ${num(rule.band.minFamilies)}-family floor. The concept wording is what limits the field.`, warn: true }
    case 'too-broad':
      return { text: `Even the tightest rung, ${phrase}, matches more than ${num(rule.band.maxPublications)} publications. The concepts are too generic for this corpus.`, warn: true }
    case 'cliff':
      return { text: `${phrase}${families} is under the ${num(rule.band.minFamilies)}-family floor, and the next looser rung is over the ${num(rule.band.maxPublications)}-publication ceiling — the ladder jumps straight past the workable band.`, warn: true }
    case 'pinned':
      return { text: `Pinned to ${phrase} in the scope; nothing was fitted.`, warn: false }
    default:
      return { text: rule.optionalCount === 0 ? 'Only must-appear concepts, so there was nothing to fit.' : `Only one rung was possible: ${phrase}.`, warn: false }
  }
}

export function FieldRuleLadder({ rule, className = '' }: { rule: FieldRule; className?: string }) {
  const summary = fitSummary(rule)
  const measured = rule.ladder.filter(rung => !rung.skipped)
  return (
    <div className={`rounded-md border border-border p-3 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Match rule</h3>
        <span className="text-[11px] text-muted-foreground">
          {rule.requiredCount} must-appear · {rule.optionalCount} other · {rule.mode === 'auto' ? 'auto' : 'pinned'}
        </span>
      </div>
      <p className={`mt-1.5 text-sm ${summary.warn ? 'text-amber-700 dark:text-amber-500' : 'text-foreground'}`}>{summary.text}</p>
      {rule.ladder.length > 0 && rule.optionalCount > 0 && (
        <ul className="mt-3 space-y-1">
          {rule.ladder.map(rung => {
            const used = rung.minimumOptional === rule.minimumOptional
            const label = rungPhrase(rule, rung.minimumOptional)
            const figure = rung.skipped
              ? 'not measured'
              : rung.timedOut
                ? `could not be sized in time — treated as more than ${num(rule.band.maxPublications)} publications`
                : rung.overCap
                  ? `more than ${num(rule.band.maxPublications)} publications`
                  : `${num(rung.families ?? 0)} famil${rung.families === 1 ? 'y' : 'ies'}${
                      rung.publications !== null && rung.publications !== rung.families ? ` · ${num(rung.publications)} publications` : ''
                    }`
            const tooFew = !rung.skipped && !rung.overCap && !rung.timedOut && (rung.families ?? 0) < rule.band.minFamilies
            return (
              <li
                key={rung.minimumOptional}
                className={`flex flex-wrap items-baseline justify-between gap-x-3 rounded px-2 py-1 text-xs ${
                  used ? 'bg-primary/[0.06] text-foreground' : 'text-muted-foreground'
                }`}
              >
                <span>
                  {label}
                  {used && <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">used</span>}
                </span>
                <span className={`tabular-nums ${rung.overCap || rung.timedOut ? 'text-amber-700 dark:text-amber-500' : tooFew ? 'text-muted-foreground' : ''}`}>
                  {figure}
                  {tooFew ? ' — under the floor' : ''}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {measured.length > 0 && rule.mode === 'auto' && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Rungs are measured tightest first and measuring stops at the first workable one, so looser rungs may be unmeasured. Pin a rung in the scope to run with it regardless.
        </p>
      )}
    </div>
  )
}
