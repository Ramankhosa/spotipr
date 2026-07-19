'use client'

import React from 'react'
import { ChevronLeft, ChevronRight, Loader2, Play, RotateCcw } from 'lucide-react'

interface NoveltyFloatingButtonsProps {
  onPrevious: (() => void) | null
  onNext: (() => void) | null
  onRunCurrent: (() => Promise<void>) | null
  previousLabel?: string
  nextLabel?: string
  currentStageLabel?: string
  isRunning?: boolean
  isFailed?: boolean
  disabled?: boolean
}

export default function NoveltyFloatingButtons({
  onPrevious,
  onNext,
  onRunCurrent,
  previousLabel = 'Previous',
  nextLabel = 'Next',
  currentStageLabel = 'Run Stage',
  isRunning = false,
  isFailed = false,
  disabled = false,
}: NoveltyFloatingButtonsProps) {
  if (!onPrevious && !onNext && !onRunCurrent) return null

  const navigationDisabled = disabled || isRunning

  return (
    <div className="sticky bottom-0 z-20 mt-8 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onPrevious || undefined}
          disabled={!onPrevious || navigationDisabled}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:min-w-[10rem] sm:justify-start"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="truncate">Previous: {previousLabel}</span>
        </button>

        {onRunCurrent ? (
          <button
            type="button"
            onClick={() => onRunCurrent()}
            disabled={disabled || isRunning}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-[12rem] ${
              isFailed ? 'bg-rose-600 hover:bg-rose-700' : 'bg-ai-blue-600 hover:bg-ai-blue-700'
            }`}
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isFailed ? (
              <RotateCcw className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            <span>{isRunning ? 'Running...' : isFailed ? 'Retry Stage' : currentStageLabel}</span>
          </button>
        ) : (
          <div className="hidden sm:block" />
        )}

        <button
          type="button"
          onClick={onNext || undefined}
          disabled={!onNext || navigationDisabled}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:min-w-[10rem] sm:justify-end"
        >
          <span className="truncate">Next: {nextLabel}</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
