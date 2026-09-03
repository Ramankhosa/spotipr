'use client'

/**
 * Whitespace Studio — the live activity panel.
 *
 * Renders one run's activity state (useRunActivity) as a step rail, counters
 * and an event feed. Everything shown was written by the worker because it did
 * that work: there are no timer-driven steps, no guessed percentages, and no
 * conclusions before the run completes. Health is the server's own silence.
 *
 * Two variants: `full` for a section that is running (the field map, the
 * dimension map, the areas), `compact` for a card (a deep dive, a validation).
 * Terminal states collapse to one honest row: a check with the elapsed time,
 * or the server's failure message verbatim.
 *
 * Cobalt marks the live step and the newest line only; everything else is ink
 * on paper. Motion respects prefers-reduced-motion throughout.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AlertCircle, Check, Loader2, Minus } from 'lucide-react'
import { STAGE_LABEL } from '@/lib/whitespace/labels'
import type { LiveEventKind, LiveStep } from '@/lib/whitespace/types'
import { WATCH_TIMEOUT_STATUS } from './api'
import type { FeedItem, RunActivityState } from './useRunActivity'

const KIND_LABEL: Record<LiveEventKind, string> = {
  read: 'read',
  count: 'counted',
  attack: 'attack',
  model: 'model',
  note: '',
}

const QUIET_AFTER_MS = 20_000
const SILENT_AFTER_MS = 60_000
const REQUEUE_NOTE_AFTER_MS = 2 * 60_000
const OVERDUE_RETRY_MS = 60_000

function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function hhmmss(t: number): string {
  const date = new Date(t)
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => n.toString().padStart(2, '0')).join(':')
}

function localTime(t: number): string {
  const date = new Date(t)
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
}

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Re-renders once a second while the run is live, for the clocks. */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(nowMs)
  useEffect(() => {
    if (!active) return
    setNow(nowMs())
    const timer = setInterval(() => setNow(nowMs()), 1_000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

interface Derived {
  mode: 'queued' | 'live' | 'summary' | 'failed' | 'stopped'
  active: LiveStep | null
  doneCount: number
  skippedCount: number
  elapsedMs: number | null
  /** Server-measured silence, projected forward by the time since the tick. */
  silenceMs: number | null
  /** Time since the newest event, projected likewise. Null when no events yet. */
  quietMs: number | null
  bar: { n: number; total: number; label: string } | null
}

function derive(state: RunActivityState, now: number): Derived {
  const sinceTick = Math.max(0, now - state.tickReceivedAt)
  const mode: Derived['mode'] =
    state.status === 'COMPLETED'
      ? 'summary'
      : state.status === 'FAILED'
        ? 'failed'
        : state.status === WATCH_TIMEOUT_STATUS
          ? 'stopped'
          : state.status === 'QUEUED'
            ? 'queued'
            : 'live'
  const active = state.steps.find(step => step.state === 'active') ?? null
  const doneCount = state.steps.filter(step => step.state === 'done').length
  const skippedCount = state.steps.filter(step => step.state === 'skipped' || step.state === 'failed').length
  const elapsedMs = mode === 'live' && state.elapsedMs !== null ? state.elapsedMs + sinceTick : mode === 'summary' ? state.elapsedMs : null

  let silenceMs: number | null = null
  if (state.serverNow !== null) {
    const lastSignal = Math.max(state.heartbeatAt ?? 0, state.createdAt ?? 0)
    if (lastSignal > 0) silenceMs = Math.max(0, state.serverNow - lastSignal) + sinceTick
  }

  const newest = [...state.pending, ...state.feed].reduce<number>((max, item) => Math.max(max, item.t), 0)
  const quietMs = state.serverNow !== null && newest > 0 ? Math.max(0, state.serverNow - newest) + sinceTick : null

  let bar: Derived['bar'] = null
  if (active && typeof active.total === 'number' && active.total > 0) {
    bar = { n: active.n ?? 0, total: active.total, label: active.label }
  } else {
    const counter = state.counters.find(c => typeof c.total === 'number' && c.total > 0 && c.value !== null)
    if (counter) bar = { n: counter.value as number, total: counter.total as number, label: counter.label }
  }

  return { mode, active, doneCount, skippedCount, elapsedMs, silenceMs, quietMs, bar }
}

function healthLine(state: RunActivityState, derived: Derived): string | null {
  if (derived.mode !== 'live') return null
  if (state.connectionLost) return 'Connection lost — retrying'
  const silence = derived.silenceMs ?? 0
  if (silence >= REQUEUE_NOTE_AFTER_MS) {
    return `The worker has not reported for ${mmss(silence)} — the server requeues it after 15 minutes of silence`
  }
  if (silence >= SILENT_AFTER_MS) return `The worker has not reported for ${mmss(silence)}`
  if (derived.quietMs !== null && derived.quietMs >= QUIET_AFTER_MS && derived.active) {
    return `Working on ${derived.active.label.toLowerCase()} — no new lines for ${Math.round(derived.quietMs / 1000)} s`
  }
  return null
}

function queuedLine(state: RunActivityState): string {
  const attempt = state.attempt ?? 0
  if (attempt <= 0 || !state.error) return 'Queued — waiting for a worker'
  const total = state.maxAttempts ? ` of ${state.maxAttempts}` : ''
  const when = state.nextAttemptAt !== null ? ` Retrying after ${localTime(state.nextAttemptAt)}.` : ''
  const overdue =
    state.nextAttemptAt !== null && state.serverNow !== null && state.serverNow > state.nextAttemptAt + OVERDUE_RETRY_MS
      ? ' Retry is overdue — no worker has picked it up yet.'
      : ''
  return `Attempt ${attempt}${total} stopped: ${state.error}.${when}${overdue}`
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function LiveDot({ failed = false }: { failed?: boolean }) {
  if (failed) return <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
    </span>
  )
}

function Waveform({ quiet, reduce }: { quiet: boolean; reduce: boolean }) {
  const staticHeights = [4, 8, 6, 10, 6, 8, 4]
  return (
    <span className="flex h-3 items-end gap-[3px]" aria-hidden>
      {staticHeights.map((height, index) =>
        reduce ? (
          <span key={index} className="w-0.5 rounded-full bg-primary/70" style={{ height }} />
        ) : (
          <motion.span
            key={index}
            className="w-0.5 rounded-full bg-primary/70"
            animate={{ height: [3, 12, 3] }}
            transition={{ duration: quiet ? 1.6 : 0.9, delay: index * 0.08, repeat: Infinity, ease: 'easeInOut' }}
          />
        )
      )}
    </span>
  )
}

function StepIndicator({ state }: { state: LiveStep['state'] }) {
  switch (state) {
    case 'done':
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
        </span>
      )
    case 'active':
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden />
        </span>
      )
    case 'skipped':
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
          <Minus className="h-3 w-3" aria-hidden />
        </span>
      )
    case 'failed':
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-destructive text-destructive">
          <AlertCircle className="h-3 w-3" aria-hidden />
        </span>
      )
    default:
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border">
          <span className="h-1.5 w-1.5 rounded-full bg-border" aria-hidden />
        </span>
      )
  }
}

function ProgressBar({ n, total, label, className = '' }: { n: number; total: number; label: string; className?: string }) {
  const pct = Math.round((Math.min(n, total) / total) * 100)
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={n}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {n.toLocaleString()} of {total.toLocaleString()}
      </span>
    </div>
  )
}

function FeedRows({ items, reduce, size }: { items: FeedItem[]; reduce: boolean; size: 'full' | 'compact' }) {
  const textSize = size === 'full' ? 'text-[12.5px]' : 'text-[12px]'
  return (
    <ul aria-hidden="true" className="space-y-1">
      <AnimatePresence initial={false}>
        {items.map((item, index) => {
          const key = item.divider ? `divider-${item.seq}` : `event-${item.seq}`
          if (item.divider) {
            return (
              <motion.li
                key={key}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduce ? undefined : { opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="flex items-center gap-2 py-0.5 text-[11px] text-muted-foreground"
              >
                <span className="h-px flex-1 bg-border" />
                <span className="shrink-0">{item.text}</span>
                <span className="h-px flex-1 bg-border" />
              </motion.li>
            )
          }
          const emphasis = index === 0 ? 1 : index < 3 ? 0.75 : 0.45
          return (
            <motion.li
              key={key}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: emphasis, y: 0 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.25 }}
              className={`flex items-baseline gap-2 leading-snug ${textSize}`}
            >
              <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${index === 0 ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
              {KIND_LABEL[item.kind] ? (
                <span className="w-14 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {KIND_LABEL[item.kind]}
                </span>
              ) : (
                <span className="w-14 shrink-0" />
              )}
              <span className={`min-w-0 flex-1 truncate ${index === 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                {item.text}
              </span>
              <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">{hhmmss(item.t)}</span>
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ul>
  )
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export interface LiveActivityPanelProps {
  state: RunActivityState
  variant: 'full' | 'compact'
  title?: string
  /** A sentence about what this stage does, shown under the full panel. */
  footnote?: string
  /** FAILED / stopped-watching only: hands the display back to the parent. */
  onDismiss?: () => void
  className?: string
}

export function LiveActivityPanel({ state, variant, title, footnote, onDismiss, className = '' }: LiveActivityPanelProps) {
  const reduce = useReducedMotion() ?? false
  const now = useTicker(state.status === 'PROCESSING' || state.status === 'QUEUED')
  const derived = derive(state, now)
  const heading = title ?? (state.stage ? STAGE_LABEL[state.stage] ?? state.stage : 'Working')

  // Screen readers hear the step, not every detail change.
  const [announced, setAnnounced] = useState('')
  const activeKey = derived.active?.key ?? null
  const activeLabel = derived.active?.label ?? ''
  useEffect(() => {
    if (activeKey) setAnnounced(activeLabel)
  }, [activeKey, activeLabel])

  const entrance = {
    initial: reduce ? false : { opacity: 0, y: variant === 'full' ? 6 : 4 },
    animate: { opacity: 1, y: 0 },
    exit: reduce ? undefined : { opacity: 0 },
    transition: { duration: variant === 'full' ? 0.3 : 0.25 },
  }

  // --- terminal: completed ---------------------------------------------------
  if (derived.mode === 'summary') {
    return (
      <motion.div
        layout={!reduce}
        {...entrance}
        className={`flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-sm ${className}`}
        role="status"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
        </span>
        <span className="text-foreground">
          {heading} finished{derived.elapsedMs !== null ? ` in ${mmss(derived.elapsedMs)}` : ''}
        </span>
        {state.steps.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {derived.doneCount} step{derived.doneCount === 1 ? '' : 's'}
            {derived.skippedCount ? ` · ${derived.skippedCount} skipped` : ''}
          </span>
        )}
      </motion.div>
    )
  }

  // --- terminal: failed / stopped watching -----------------------------------
  if (derived.mode === 'failed' || derived.mode === 'stopped') {
    const message =
      state.error ??
      (derived.mode === 'stopped' ? 'Stopped watching this run — reload the page to check on it.' : 'The stage did not complete.')
    return (
      <motion.div
        {...entrance}
        className={`rounded-lg border border-destructive/40 bg-destructive/[0.03] px-3 py-2.5 ${className}`}
        role="status"
      >
        <div className="flex items-center gap-2">
          <LiveDot failed />
          <span className="text-sm font-medium text-foreground">
            {derived.mode === 'stopped' ? `${heading} — stopped watching` : `${heading} did not finish`}
          </span>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Dismiss
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-foreground">{message}</p>
        {variant === 'full' && derived.active && (
          <p className="mt-1 text-xs text-muted-foreground">Stopped during: {derived.active.label}</p>
        )}
      </motion.div>
    )
  }

  // --- queued ---------------------------------------------------------------
  if (derived.mode === 'queued') {
    return (
      <motion.div
        {...entrance}
        className={`flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/[0.03] px-3 py-2.5 ${className}`}
        role="status"
      >
        <span className="mt-1">
          <LiveDot />
        </span>
        <span className="text-sm text-foreground">{queuedLine(state)}</span>
      </motion.div>
    )
  }

  // --- live: compact ----------------------------------------------------------
  const health = healthLine(state, derived)
  const quiet = derived.quietMs !== null && derived.quietMs >= QUIET_AFTER_MS

  if (variant === 'compact') {
    const rows = state.feed.slice(-3).reverse()
    return (
      <motion.div {...entrance} className={`rounded-lg border border-primary/40 bg-primary/[0.03] px-3 py-2.5 ${className}`}>
        <div className="flex items-center gap-2">
          <LiveDot />
          <span className="min-w-0 truncate text-sm font-medium text-foreground" role="status" aria-live="polite">
            {announced || derived.active?.label || 'Starting'}
          </span>
          {derived.active?.detail && (
            <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">{derived.active.detail}</span>
          )}
          {derived.elapsedMs !== null && (
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{mmss(derived.elapsedMs)}</span>
          )}
        </div>
        {health && <p className="mt-1 text-[11px] text-muted-foreground">{health}</p>}
        {derived.bar && (
          <ProgressBar n={derived.bar.n} total={derived.bar.total} label={derived.bar.label} className="mt-2" />
        )}
        {rows.length > 0 && (
          <div className="mt-2">
            <FeedRows items={rows} reduce={reduce} size="compact" />
          </div>
        )}
      </motion.div>
    )
  }

  // --- live: full -------------------------------------------------------------
  const visible = state.feed.slice(-8).reverse()
  const log = [...state.feed].reverse()

  return (
    <motion.section
      {...entrance}
      role="region"
      aria-label={`${heading} in progress`}
      className={`overflow-hidden rounded-xl border border-primary/40 bg-card ${className}`}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <LiveDot />
        <h3 className="text-sm font-semibold text-foreground">{heading}</h3>
        <Waveform quiet={quiet} reduce={reduce} />
        {health && <span className="text-[11px] text-muted-foreground">{health}</span>}
        {derived.elapsedMs !== null && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{mmss(derived.elapsedMs)}</span>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announced}
      </p>

      <div className="grid sm:grid-cols-[15rem_minmax(0,1fr)]">
        <ol className="space-y-1 border-b border-border p-3 sm:border-b-0 sm:border-r" aria-label="Steps">
          {state.steps.length === 0 && (
            <li className="px-2.5 py-2 text-sm text-muted-foreground">Starting…</li>
          )}
          {state.steps.map(step => (
            <li
              key={step.key}
              aria-current={step.state === 'active' ? 'step' : undefined}
              className={`flex gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-300 ${step.state === 'active' ? 'bg-accent' : ''}`}
            >
              <span className="mt-0.5">
                <StepIndicator state={step.state} />
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${step.state === 'active' ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                  {step.label}
                </p>
                {(step.state === 'active' || step.state === 'skipped' || step.state === 'failed') && step.detail && (
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{step.detail}</p>
                )}
                {step.state === 'active' && typeof step.total === 'number' && step.total > 0 && (
                  <ProgressBar n={step.n ?? 0} total={step.total} label={step.label} className="mt-1.5" />
                )}
              </div>
            </li>
          ))}
        </ol>

        <div className="space-y-3 p-4">
          {state.counters.length > 0 && (
            <dl className="flex flex-wrap gap-x-6 gap-y-2">
              {state.counters.map(counter => (
                <div key={counter.key}>
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{counter.label}</dt>
                  <dd className="font-mono text-[15px] font-semibold tabular-nums text-foreground">
                    {counter.value === null ? '—' : counter.value.toLocaleString()}
                    {typeof counter.total === 'number' && (
                      <span className="font-normal text-muted-foreground"> / {counter.total.toLocaleString()}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {visible.length > 0 ? (
            <FeedRows items={visible} reduce={reduce} size="full" />
          ) : (
            <p className="text-xs text-muted-foreground">{derived.active?.detail ?? 'Waiting for the first report…'}</p>
          )}

          <details className="pt-1">
            <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              Everything the system has done ({log.filter(item => !item.divider).length} shown
              {state.skipped ? ` · ${state.skipped} not captured` : ''})
            </summary>
            <ol className="mt-2 max-h-56 space-y-0.5 overflow-y-auto border-l border-border pl-3 font-mono text-[11px] text-muted-foreground">
              {log.map(item => (
                <li key={item.divider ? `divider-${item.seq}` : `event-${item.seq}`}>
                  {item.divider ? `— ${item.text} —` : `${hhmmss(item.t)} · ${item.kind} · ${item.text}`}
                </li>
              ))}
              <li className="pt-1 text-muted-foreground/70">
                phase {state.activeKey ?? '—'} · attempt {state.attempt ?? '—'} · {state.ticksSeen} polls · run {state.runId}
              </li>
            </ol>
          </details>
        </div>
      </div>

      {footnote && <p className="border-t border-border px-4 py-2.5 text-[11px] leading-snug text-muted-foreground">{footnote}</p>}
    </motion.section>
  )
}
