"use client"

import React, { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

/**
 * Narrated waiting state for figure planning and drawing.
 *
 * Both operations are multi-step server pipelines that take tens of seconds, and
 * an attorney watching a spinner has no way to tell a working system from a hung
 * one. So the wait is narrated as the checks that are actually running, in the
 * order the server runs them.
 *
 * No elapsed timer: a visible clock turns a wait into a countdown the user
 * measures us against, and makes a normal 40-second run feel like a fault.
 *
 * The steps advance on a timer because the server returns one response rather
 * than progress events, so the cadence is an estimate — which is why the final
 * step of each sequence never claims to be finished and is written to stay true
 * however long the run takes. Nothing here reports a *result*; the panel
 * describes work in progress, and the real findings appear in the plan or the
 * figure list afterwards.
 */

export type FigureWorkPhase = 'planning' | 'drawing'

type WorkStep = {
  /** Present tense, attorney-facing. Describes work, never an outcome. */
  label: string
  /** One concrete line on why the step is worth the wait. */
  detail: string
  /** Seconds this step is expected to hold the spotlight. */
  holdSeconds: number
}

function planningSteps(claimCount?: number): WorkStep[] {
  return [
    {
      label: 'Reading your claims',
      detail: claimCount
        ? `Separating all ${claimCount} claims into the individual limitations a drawing has to show.`
        : 'Separating each claim into the individual limitations a drawing has to show.',
      holdSeconds: 7,
    },
    {
      label: 'Matching limitations to your components',
      detail: 'Every claimed element is traced to an entry in your component plan, so no figure invents a part you did not disclose.',
      holdSeconds: 8,
    },
    {
      label: 'Finding claim elements with nowhere to appear',
      detail: 'Anything the claims require but the component plan is missing gets added and numbered for you.',
      holdSeconds: 7,
    },
    {
      label: 'Choosing the smallest set of figures that covers everything',
      detail: 'Deciding which views your invention actually needs, and what belongs on each one.',
      holdSeconds: 9,
    },
    {
      label: 'Checking the plan leaves nothing uncovered',
      detail: 'Every required limitation is confirmed against a planned figure before anything is drawn.',
      holdSeconds: 120,
    },
  ]
}

function drawingSteps(figureCount?: number, requirementCount?: number): WorkStep[] {
  const figures = figureCount && figureCount > 0 ? figureCount : null
  return [
    {
      label: figures ? `Drafting all ${figures} figures at once` : 'Drafting your figures',
      detail: 'Each figure is built in parallel from the approved plan, laying out its parts, groupings and connections.',
      holdSeconds: 9,
    },
    {
      label: 'Keeping every step tied to your disclosure',
      detail: 'A process step that cannot be traced back to something you disclosed is not drawn.',
      holdSeconds: 8,
    },
    {
      label: 'Checking each figure fits a filing sheet',
      detail: 'Anything too dense to read at filing size is split into an overview plus detail sheets, without dropping content.',
      holdSeconds: 9,
    },
    {
      label: 'Applying your reference numerals',
      detail: 'Numbering comes from your component plan, so the drawings and the specification agree.',
      holdSeconds: 8,
    },
    {
      label: 'Rendering the drawings',
      detail: 'Producing filing-quality output in the line style your jurisdiction expects.',
      holdSeconds: 10,
    },
    {
      label: 'Inspecting the finished drawings',
      detail: requirementCount
        ? `Confirming every numeral appears on the page and all ${requirementCount} claim requirements are shown.`
        : 'Confirming every numeral actually appears on the page and each claim requirement is shown.',
      holdSeconds: 120,
    },
  ]
}

function StepIndicator({ state }: { state: 'done' | 'active' | 'upcoming' }) {
  if (state === 'done') {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100">
        <Check className="h-3 w-3 text-emerald-600" strokeWidth={3} />
      </span>
    )
  }
  if (state === 'active') {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ai-blue-100">
        <Loader2 className="h-3 w-3 animate-spin text-ai-blue-600" />
      </span>
    )
  }
  return (
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
      <span className="h-1.5 w-1.5 rounded-full bg-ai-graphite-300" />
    </span>
  )
}

export default function FigureWorkProgress({
  phase,
  figureCount,
  claimCount,
  requirementCount,
}: {
  phase: FigureWorkPhase
  figureCount?: number
  claimCount?: number
  requirementCount?: number
}) {
  const steps = phase === 'planning'
    ? planningSteps(claimCount)
    : drawingSteps(figureCount, requirementCount)

  // Elapsed seconds are tracked to advance the narration, never displayed.
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    setSeconds(0)
    const interval = setInterval(() => setSeconds(previous => previous + 1), 1000)
    return () => clearInterval(interval)
  }, [phase])

  let activeIndex = steps.length - 1
  let consumed = 0
  for (let index = 0; index < steps.length; index++) {
    consumed += steps[index].holdSeconds
    if (seconds < consumed) { activeIndex = index; break }
  }

  const heading = phase === 'planning' ? 'Planning your figures' : 'Drawing your figures'
  const closing = phase === 'planning'
    ? 'Nothing is drawn yet. You will see the plan and can change it before any figure is created.'
    : 'Your existing work is untouched until the complete set is finished and checked.'

  return (
    <div className="rounded-lg border border-ai-blue-100 bg-ai-blue-50/40 p-5">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ai-blue-400 opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-ai-blue-500" />
        </span>
        <h4 className="text-sm font-semibold text-ai-blue-900">{heading}</h4>
      </div>

      {/* Screen readers get the current step only; announcing the whole list on
          every tick would be unusable. */}
      <p className="sr-only" role="status" aria-live="polite">
        {steps[activeIndex].label}
      </p>

      <ol className="mt-4 space-y-3">
        {steps.map((step, index) => {
          const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'upcoming'
          // Upcoming steps are de-emphasised with a muted colour rather than
          // opacity: dimming this text to 45% drops it to roughly 2.3:1, and it
          // still tells the reader what the system is about to check.
          const labelTone = state === 'active'
            ? 'font-medium text-ai-blue-900'
            : state === 'done'
              ? 'text-ai-graphite-700'
              : 'text-ai-graphite-500'
          return (
            <li key={step.label} className="flex gap-3">
              <StepIndicator state={state} />
              <div className="min-w-0">
                <p className={`text-sm transition-colors duration-300 ${labelTone}`}>{step.label}</p>
                {state === 'active' && (
                  <p className="mt-0.5 max-w-prose text-sm text-ai-blue-700">{step.detail}</p>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      <p className="mt-4 border-t border-ai-blue-100 pt-3 text-xs text-ai-graphite-500">{closing}</p>
    </div>
  )
}
