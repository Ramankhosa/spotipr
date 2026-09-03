'use client'

/**
 * Whitespace Studio — live activity for runs in flight.
 *
 * One hook per study surface. `watch(runId, signal)` is a drop-in for
 * `pollRun(studyId, runId, undefined, signal)`: it resolves with the same final
 * payload, and along the way keeps a per-run activity state the panel renders.
 *
 * What the reducer guarantees (it is pure and exported for tests):
 *  - Steps and counters are copied from the server wholesale. Nothing is
 *    inferred client-side; a v1 payload (a pre-upgrade worker) becomes a single
 *    active step and nothing more.
 *  - Events are appended by `seq`, deduped across overlapping windows, and a
 *    gap is counted as `skipped` rather than hidden. A new ATTEMPT (retry after
 *    a failure) inserts a divider and restarts the sequence, so nothing from
 *    the old attempt is dropped or misattributed.
 *  - Arriving events are dripped into the visible feed one at a time between
 *    polls, so motion is continuous; under reduced motion they appear at once.
 *  - Health is the server's own silence (serverNow − heartbeatAt), never the
 *    client's clock against a server timestamp.
 *  - No entry exists for a run that never produced a live tick: a fresh
 *    attach that lands directly on a terminal status resolves silently and
 *    the parent's existing UI handles it.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import type { LiveCounter, LiveEvent, LiveStep } from '@/lib/whitespace/types'
import { isPollAborted, pollRun, type RunPayload } from './api'

export interface FeedItem extends LiveEvent {
  /** A break between attempts — rendered as a hairline, not an event. */
  divider?: boolean
}

export interface RunActivityState {
  runId: string
  status: string
  stage: string | null
  attempt: number | null
  maxAttempts: number | null
  /** Epoch ms, server clock. */
  nextAttemptAt: number | null
  steps: LiveStep[]
  counters: LiveCounter[]
  activeKey: string | null
  detail: string | null
  round: number | null
  /** Visible, ascending seq, capped at FEED_CAP. */
  feed: FeedItem[]
  /** Arrived but not yet shown. */
  pending: LiveEvent[]
  lastSeq: number
  /** Events that left the server's window before this client saw them. */
  skipped: number
  serverNow: number | null
  heartbeatAt: number | null
  createdAt: number | null
  elapsedMs: number | null
  /** performance.now() when the latest tick arrived — the monotonic anchor. */
  tickReceivedAt: number
  ticksSeen: number
  connectionLost: boolean
  /** The payload lacked the structured v2 state. */
  v1: boolean
  final: RunPayload | null
  error: string | null
  settledAt: number | null
}

export type RunActivityAction =
  | { type: 'tick'; runId: string; payload: RunPayload; now: number; wall: number }
  | { type: 'drip'; runId: string; all?: boolean }
  | { type: 'connection'; runId: string; lost: boolean }
  | { type: 'settle'; runId: string; payload: RunPayload; now: number }
  | { type: 'forget'; runId: string }
  | { type: 'reset' }

export type RunActivityMap = Record<string, RunActivityState>

export const FEED_CAP = 60
const DRIP_CATCH_UP_THRESHOLD = 12

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function blankEntry(runId: string, now: number): RunActivityState {
  return {
    runId,
    status: 'QUEUED',
    stage: null,
    attempt: null,
    maxAttempts: null,
    nextAttemptAt: null,
    steps: [],
    counters: [],
    activeKey: null,
    detail: null,
    round: null,
    feed: [],
    pending: [],
    lastSeq: 0,
    skipped: 0,
    serverNow: null,
    heartbeatAt: null,
    createdAt: null,
    elapsedMs: null,
    tickReceivedAt: now,
    ticksSeen: 0,
    connectionLost: false,
    v1: false,
    final: null,
    error: null,
    settledAt: null,
  }
}

function capFeed(feed: FeedItem[]): FeedItem[] {
  return feed.length > FEED_CAP ? feed.slice(feed.length - FEED_CAP) : feed
}

export function runActivityReducer(state: RunActivityMap, action: RunActivityAction): RunActivityMap {
  switch (action.type) {
    case 'reset':
      return {}

    case 'forget': {
      if (!(action.runId in state)) return state
      const next = { ...state }
      delete next[action.runId]
      return next
    }

    case 'connection': {
      const entry = state[action.runId]
      if (!entry || entry.connectionLost === action.lost) return state
      return { ...state, [action.runId]: { ...entry, connectionLost: action.lost } }
    }

    case 'tick': {
      const { payload, now, wall } = action
      const previous = state[action.runId] ?? blankEntry(action.runId, now)
      const progress = payload.progress ?? null
      const next: RunActivityState = {
        ...previous,
        status: payload.status,
        stage: payload.stage ?? progress?.stage ?? previous.stage,
        maxAttempts: payload.maxAttempts ?? previous.maxAttempts,
        nextAttemptAt: parseTime(payload.nextAttemptAt),
        serverNow: parseTime(payload.serverNow) ?? wall,
        heartbeatAt: parseTime(payload.heartbeatAt),
        createdAt: parseTime(payload.startedAt) ?? previous.createdAt,
        elapsedMs: typeof payload.elapsedMs === 'number' ? payload.elapsedMs : null,
        tickReceivedAt: now,
        ticksSeen: previous.ticksSeen + 1,
        connectionLost: false,
        error: payload.error ?? null,
      }

      const attempt = progress?.attempt ?? payload.attempt ?? previous.attempt
      if (previous.attempt !== null && attempt !== null && attempt !== previous.attempt) {
        // A retry. Everything from the old attempt stays as history behind a
        // divider; the sequence restarts so the new attempt's events are seen.
        const stopped = previous.error ?? 'the worker stopped'
        next.feed = capFeed([
          ...previous.feed,
          ...previous.pending,
          {
            seq: -attempt,
            t: wall,
            kind: 'note',
            text: `Attempt ${previous.attempt} stopped — ${stopped}`,
            divider: true,
          },
        ])
        next.pending = []
        next.lastSeq = 0
        next.skipped = 0
        next.steps = []
        next.counters = []
      }
      next.attempt = attempt

      if (!progress) {
        // QUEUED, or PROCESSING before the first narration write.
        return { ...state, [action.runId]: next }
      }

      next.activeKey = progress.phase ?? null
      next.detail = progress.detail ?? null
      next.round = typeof progress.round === 'number' ? progress.round : null

      if (progress.v === 2) {
        next.v1 = false
        next.steps = progress.steps ?? []
        next.counters = progress.counters ?? []
        const recent = progress.recent ?? []
        const fresh = recent.filter(event => event.seq > next.lastSeq)
        if (fresh.length) {
          const first = fresh[0].seq
          if (first > next.lastSeq + 1) next.skipped += first - next.lastSeq - 1
          next.pending = [...next.pending, ...fresh]
          next.lastSeq = fresh[fresh.length - 1].seq
        }
      } else {
        next.v1 = true
        // A v1 'done' phase is the old terminal narration: keep whatever rail
        // exists rather than rendering a step named "done".
        if (progress.phase !== 'done') {
          next.steps = [{ key: progress.phase, label: progress.detail, state: 'active' }]
        }
      }
      return { ...state, [action.runId]: next }
    }

    case 'drip': {
      const entry = state[action.runId]
      if (!entry || !entry.pending.length) return state
      const take = action.all ? entry.pending.length : entry.pending.length > DRIP_CATCH_UP_THRESHOLD ? 2 : 1
      return {
        ...state,
        [action.runId]: {
          ...entry,
          feed: capFeed([...entry.feed, ...entry.pending.slice(0, take)]),
          pending: entry.pending.slice(take),
        },
      }
    }

    case 'settle': {
      const entry = state[action.runId]
      // Never seen live: nothing to show, and nothing to leave behind.
      if (!entry) return state
      const { payload, now } = action
      const completed = payload.status === 'COMPLETED'
      return {
        ...state,
        [action.runId]: {
          ...entry,
          status: payload.status,
          final: payload,
          error: payload.error ?? entry.error,
          feed: capFeed([...entry.feed, ...entry.pending]),
          pending: [],
          // Only an active step can become done; skipped and failed stay as they are.
          steps: completed ? entry.steps.map(step => (step.state === 'active' ? { ...step, state: 'done' } : step)) : entry.steps,
          settledAt: now,
          connectionLost: false,
        },
      }
    }

    default:
      return state
  }
}

export interface UseRunActivityOptions {
  /** Poll cadence for a watched run. Default 2 s (3 s when more than three are live). */
  pollIntervalMs?: number
  /** Gap between events dripped into the feed. Default 300 ms. */
  dripMs?: number
  /** How long a completed run's summary row lingers before the entry is dropped. Default 1.8 s. */
  lingerMs?: number
}

export interface RunActivity {
  runs: RunActivityMap
  get(runId: string | null | undefined): RunActivityState | null
  /** Drop-in for pollRun(studyId, runId, undefined, signal). */
  watch(runId: string, signal: AbortSignal): Promise<RunPayload>
  dismiss(runId: string): void
}

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export function useRunActivity(studyId: string, options: UseRunActivityOptions = {}): RunActivity {
  const pollIntervalMs = options.pollIntervalMs ?? 2_000
  const dripMs = options.dripMs ?? 300
  const lingerMs = options.lingerMs ?? 1_800

  const [runs, dispatch] = useReducer(runActivityReducer, {})
  const reduceMotion = useReducedMotion()
  const watchers = useRef(0)
  const runsRef = useRef(runs)
  runsRef.current = runs

  useEffect(() => {
    dispatch({ type: 'reset' })
  }, [studyId])

  const watch = useCallback(
    async (runId: string, signal: AbortSignal): Promise<RunPayload> => {
      watchers.current += 1
      try {
        const final = await pollRun(
          studyId,
          runId,
          (_status, _progress, payload) => dispatch({ type: 'tick', runId, payload, now: nowMs(), wall: Date.now() }),
          signal,
          {
            intervalMs: watchers.current > 3 ? 3_000 : pollIntervalMs,
            onTransientError: () => dispatch({ type: 'connection', runId, lost: true }),
            onRecovered: () => dispatch({ type: 'connection', runId, lost: false }),
          }
        )
        // A stopped watch settles like a terminal status; the reducer keeps
        // the entry until dismissed, and the panel says "stopped watching".
        dispatch({ type: 'settle', runId, payload: final, now: nowMs() })
        return final
      } catch (error) {
        if (isPollAborted(error)) dispatch({ type: 'forget', runId })
        throw error
      } finally {
        watchers.current -= 1
      }
    },
    [studyId, pollIntervalMs]
  )

  // Drip: one event per tick of the interval, for every run with a backlog.
  const anyPending = Object.values(runs).some(run => run.pending.length > 0)
  useEffect(() => {
    if (!anyPending) return
    if (reduceMotion) {
      for (const run of Object.values(runsRef.current)) {
        if (run.pending.length) dispatch({ type: 'drip', runId: run.runId, all: true })
      }
      return
    }
    const timer = setInterval(() => {
      for (const run of Object.values(runsRef.current)) {
        if (run.pending.length) dispatch({ type: 'drip', runId: run.runId })
      }
    }, dripMs)
    return () => clearInterval(timer)
  }, [anyPending, reduceMotion, dripMs])

  // Linger: a completed entry shows its summary row briefly, then goes away.
  // Failed and stopped-watching entries stay until dismissed.
  const completedKey = Object.values(runs)
    .filter(run => run.status === 'COMPLETED' && run.settledAt !== null)
    .map(run => `${run.runId}:${run.settledAt}`)
    .join('|')
  useEffect(() => {
    if (!completedKey) return
    const timers = Object.values(runsRef.current)
      .filter(run => run.status === 'COMPLETED' && run.settledAt !== null)
      .map(run => {
        const remaining = Math.max(0, lingerMs - (nowMs() - (run.settledAt as number)))
        return setTimeout(() => dispatch({ type: 'forget', runId: run.runId }), remaining)
      })
    return () => timers.forEach(timer => clearTimeout(timer))
  }, [completedKey, lingerMs])

  const get = useCallback((runId: string | null | undefined) => (runId ? runs[runId] ?? null : null), [runs])
  const dismiss = useCallback((runId: string) => dispatch({ type: 'forget', runId }), [])

  return { runs, get, watch, dismiss }
}
