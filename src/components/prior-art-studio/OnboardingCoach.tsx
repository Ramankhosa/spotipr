'use client'

// First-run coach: four short cards that explain the mental model before the
// user touches anything. Dismissable, never comes back unless asked (the "?"
// button in the header reopens it).

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Layers, ListChecks, ScrollText, Sparkles } from 'lucide-react'

const STEPS = [
  {
    icon: Sparkles,
    title: 'Describe, don’t query',
    body: 'Paste the invention disclosure in plain words. The query generator drafts the search for you: concept blocks, synonyms (including “patentese”), classification codes and claim elements — in seconds instead of hours.',
  },
  {
    icon: Check,
    title: 'You approve every word',
    body: 'AI suggestions arrive as dashed blue chips. They do nothing until you accept them — click ✓ to keep one, ✕ to reject it. The search only ever runs what you can see on the canvas.',
  },
  {
    icon: Layers,
    title: 'Watch the funnel',
    body: 'Every run shows counts at each stage: corpus → filters → recall → families → shown. The “meaning-only” number is what a keyword-only search would have missed entirely.',
  },
  {
    icon: ListChecks,
    title: 'Review like an inbox, leave with a report',
    body: 'Move with j/k, tag with 1 (relevant), 2 (maybe), 3 (not), x to exclude a family. Everything you do is recorded on the Evidence Trail and compiles to a Word search report in one click.',
  },
]

interface OnboardingCoachProps {
  onClose: () => void
}

export function OnboardingCoach({ onClose }: OnboardingCoachProps) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const Icon = current.icon
  const isLast = step === STEPS.length - 1
  const dialogRef = useRef<HTMLDivElement>(null)

  /**
   * Modal behaviour that `aria-modal="true"` only claims, and does not provide:
   * initial focus, Escape to dismiss, a focus trap, and focus restored to
   * whatever opened it. Without these the dialog covers the whole app while Tab
   * walks invisibly through the page behind it.
   */
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) || []
      ).filter(element => !element.hasAttribute('disabled'))

    focusables()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const activeElement = document.activeElement
      if (event.shiftKey && (activeElement === first || !dialogRef.current?.contains(activeElement))) {
        last.focus()
        event.preventDefault()
      } else if (!event.shiftKey && activeElement === last) {
        first.focus()
        event.preventDefault()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Advanced Search Studio introduction">
      <div ref={dialogRef} className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Advanced Search Studio · {step + 1} of {STEPS.length}
            </div>
            <h2 className="text-base font-bold text-foreground">{current.title}</h2>
          </div>
        </div>
        <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{current.body}</p>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Step ${i + 1}`}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-primary' : 'w-1.5 bg-border'}`}
              />
            ))}
          </div>
          <button type="button" className="ml-auto text-xs font-medium text-muted-foreground hover:text-foreground" onClick={onClose}>
            Skip
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
            onClick={() => (isLast ? onClose() : setStep(step + 1))}
          >
            {isLast ? (
              <>
                <ScrollText className="h-3.5 w-3.5" /> Start searching
              </>
            ) : (
              <>
                Next <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
