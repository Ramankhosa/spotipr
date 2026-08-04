'use client'

import { Check, Circle, Loader2, Lock } from 'lucide-react'

export type StepState = 'done' | 'current' | 'running' | 'locked'

export interface JourneyStep {
  id: string
  label: string
  hint: string
  state: StepState
}

/**
 * The five acts of an invention study, always visible.
 *
 * The landscape pipeline communicates readiness only through disabled buttons,
 * which leaves the user guessing what comes next. Naming the steps and their
 * state is the cheapest comprehension win available on this screen.
 */
export function JourneyRail({ steps, onSelect }: { steps: JourneyStep[]; onSelect?: (id: string) => void }) {
  return (
    <nav aria-label="Study progress" className="rounded-xl border border-border bg-card p-1.5">
      <ol className="flex gap-1 overflow-x-auto rail-x lg:flex-col lg:overflow-visible">
        {steps.map((step, index) => {
          const interactive = Boolean(onSelect) && step.state !== 'locked'
          const Tag = interactive ? 'button' : 'div'
          return (
            <li key={step.id} className="min-w-[9.5rem] flex-1 lg:min-w-0">
              <Tag
                {...(interactive
                  ? {
                      type: 'button' as const,
                      onClick: () => onSelect?.(step.id),
                      // The visible label is split across spans with a decorative
                      // "Step N" prefix, so name the control explicitly.
                      'aria-label': `Step ${index + 1}: ${step.label} — ${step.hint}`,
                    }
                  : {})}
                className={[
                  'flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors',
                  step.state === 'current' || step.state === 'running'
                    ? 'bg-accent'
                    : interactive
                      ? 'hover:bg-accent/50'
                      : '',
                  step.state === 'locked' ? 'opacity-45' : '',
                ].join(' ')}
                aria-current={step.state === 'current' || step.state === 'running' ? 'step' : undefined}
              >
                <span className="mt-0.5 shrink-0" aria-hidden>
                  {step.state === 'done' ? (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  ) : step.state === 'running' ? (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    </span>
                  ) : step.state === 'locked' ? (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-muted-foreground">
                      <Lock className="h-2.5 w-2.5" />
                    </span>
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-primary text-primary">
                      <Circle className="h-1.5 w-1.5 fill-current" />
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Step {index + 1}
                  </span>
                  <span className="block text-sm font-medium leading-tight text-foreground">{step.label}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{step.hint}</span>
                </span>
              </Tag>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
