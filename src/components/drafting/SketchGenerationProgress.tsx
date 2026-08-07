'use client'

// Waiting state for illustration generation.
//
// The image API returns one response at the end — there are no progress events
// to subscribe to — so the captions below are driven by elapsed time, not by
// backend state. They are written to describe what the pipeline actually does
// (compose → draw → label → automated check → optional correction pass) and the
// thresholds are set from observed generation times, so the caption stays
// truthful about the phase even though it cannot be exact. The elapsed counter
// is real, and is what tells the user the request is still alive.

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

/** Caption shown once elapsed time passes `afterSeconds`; last match wins. */
const PHASES: Array<{ afterSeconds: number; caption: string }> = [
  { afterSeconds: 0, caption: 'Reading your invention facts…' },
  { afterSeconds: 6, caption: 'Composing the view…' },
  { afterSeconds: 16, caption: 'Drawing the line work…' },
  { afterSeconds: 32, caption: 'Placing reference numerals…' },
  { afterSeconds: 50, caption: 'Checking the drawing…' },
  { afterSeconds: 70, caption: 'Applying finishing corrections…' },
  { afterSeconds: 95, caption: 'Still working — detailed figures take longer…' },
]

interface SketchGenerationProgressProps {
  /** Epoch ms when the request started. */
  startedAt: number
  /** Optional title of the figure being drawn. */
  label?: string
  className?: string
}

export default function SketchGenerationProgress({
  startedAt,
  label,
  className = '',
}: SketchGenerationProgressProps) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  const phase = PHASES.reduce((current, next) => (elapsed >= next.afterSeconds ? next : current), PHASES[0])

  return (
    <div className={`overflow-hidden rounded-lg border border-paper-300 bg-white ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-paper-200 bg-paper-100 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-ai-blue-600" />
          <span className="truncate text-[13px] font-medium text-ai-graphite-900" aria-live="polite">
            {phase.caption}
            {label && <span className="ml-2 font-normal text-ai-graphite-500">{label}</span>}
          </span>
        </div>
        <span className="text-[11px] tabular-nums text-ai-graphite-500">{elapsed}s</span>
      </div>

      {/* Indeterminate bar: the API gives no completion fraction, so this signals
          liveness rather than progress. */}
      <div className="h-1 w-full overflow-hidden bg-paper-200">
        <div className="sketch-progress-bar h-full w-1/3 rounded-full bg-ai-blue-500" />
      </div>

      <p className="px-4 py-2.5 text-xs leading-relaxed text-ai-graphite-500">
        Illustrations are drawn at high resolution and automatically checked for label and line-art
        defects, so this usually takes under a minute. You can keep working in other tabs.
      </p>

      <style jsx>{`
        .sketch-progress-bar {
          animation: sketch-progress 1.8s ease-in-out infinite;
        }
        @keyframes sketch-progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .sketch-progress-bar {
            animation: none;
            width: 100%;
            opacity: 0.4;
          }
        }
      `}</style>
    </div>
  )
}
