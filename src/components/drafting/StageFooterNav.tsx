'use client'

/**
 * StageFooterNav — the one consistent Back/Next control across every drafting
 * stage.
 *
 * Deliberately slim: a single sticky row at the bottom of the content column so
 * it is always reachable in a long draft without occupying page real estate.
 * Each stage keeps its own primary CTA (which runs that stage's validation and
 * persistence); this bar is plain navigation, routed through the same handler
 * as the rail so the unsaved-work guard applies here too.
 */

import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function StageFooterNav({
  prevLabel,
  nextLabel,
  onBack,
  onNext,
  positionLabel,
  busy = false,
}: {
  prevLabel: string | null
  nextLabel: string | null
  onBack: () => void | Promise<void>
  onNext: () => void | Promise<void>
  positionLabel?: string
  busy?: boolean
}) {
  if (!prevLabel && !nextLabel) return null

  return (
    <div className="sticky bottom-0 z-30 mt-6 border-t border-paper-300 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <div className="max-w-[98%] mx-auto flex items-center justify-between gap-3 px-4 py-2">
        {prevLabel ? (
          <button
            type="button"
            onClick={() => void onBack()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ai-graphite-600 hover:bg-paper-100 hover:text-ai-graphite-900 transition-colors disabled:opacity-50"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Back to</span>
            <span className="truncate max-w-[9rem]">{prevLabel}</span>
          </button>
        ) : <span />}

        {positionLabel && (
          <span className="text-[10px] uppercase tracking-wider text-ai-graphite-400 tabular-nums hidden sm:block">
            {positionLabel}
          </span>
        )}

        {nextLabel ? (
          <button
            type="button"
            onClick={() => void onNext()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ai-blue-700 hover:bg-ai-blue-50 transition-colors disabled:opacity-50"
          >
            <span className="hidden sm:inline">Next:</span>
            <span className="truncate max-w-[9rem]">{nextLabel}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        ) : <span />}
      </div>
    </div>
  )
}
