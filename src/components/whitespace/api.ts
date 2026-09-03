/**
 * Whitespace Studio — client API helper.
 *
 * Auth is header-based JWT from localStorage, not cookies. Every whitespace
 * fetch goes through here so the Authorization header cannot be forgotten again
 * (the original "no login" bug was exactly that omission).
 */

import type { WhitespaceRunProgress } from '@/lib/whitespace/types'

export function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' }
}

export async function wsApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...authHeaders(), ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed (${response.status})`) as Error & {
      status: number
      code?: string
      payload?: unknown
    }
    error.status = response.status
    error.code = payload?.code
    // The body travels with the error: a 409 for "already running" carries the
    // live runId, and discarding it left callers unable to attach to that run.
    error.payload = payload
    throw error
  }
  return payload as T
}

/** The live run a 409 "already in flight" response points at, if any. */
export function conflictRunId(error: unknown): string | null {
  const err = error as { status?: number; payload?: { runId?: unknown } } | null
  if (err?.status !== 409) return null
  return typeof err.payload?.runId === 'string' ? err.payload.runId : null
}

/**
 * Live narration a stage writes while it works. Null once the run finishes.
 * The v1 fields (phase/detail/round) are always present; the structured v2
 * fields are what the activity panel renders.
 */
export type RunProgress = WhitespaceRunProgress

export interface RunPayload {
  runId?: string
  stage?: string
  status: string
  results: unknown
  progress: RunProgress | null
  error: string | null
  durationMs?: number | null
  /** Row creation — includes queue wait and earlier attempts. Not the attempt start. */
  startedAt?: string
  completedAt?: string | null
  attempt?: number | null
  maxAttempts?: number | null
  nextAttemptAt?: string | null
  heartbeatAt?: string | null
  /** Server clock at the time of the response; the only clock to measure silence with. */
  serverNow?: string
  /** Milliseconds since the current attempt started, measured on the server. */
  elapsedMs?: number | null
  scopeStale?: boolean
  scopeVersion?: number
  currentScopeVersion?: number
}

/** Thrown when a caller aborts a poll; callers treat it as "no longer interested". */
export class PollAbortedError extends Error {
  constructor() {
    super('Polling was cancelled.')
    this.name = 'PollAbortedError'
  }
}

export function isPollAborted(error: unknown): boolean {
  const name = (error as { name?: string })?.name
  // 'AbortError' is what fetch itself rejects with when the signal fires
  // mid-request — without matching it, an abort that lands between polls is
  // swallowed but one landing inside the fetch escapes as a spurious toast.
  return error instanceof PollAbortedError || name === 'PollAbortedError' || name === 'AbortError'
}

/**
 * The status pollRun resolves with when it stops WATCHING — not a run status.
 * The run may still be working; the server is the only judge of a dead run.
 */
export const WATCH_TIMEOUT_STATUS = 'WATCH_TIMEOUT'

export interface PollRunOptions {
  /** Poll cadence while the run is live. Default 3 s. */
  intervalMs?: number
  /**
   * Sanity cap on how long one watcher polls, NOT a judgement on the run —
   * the server fails genuinely dead runs on read. Default 3 hours.
   */
  maxWatchMs?: number
  /** Consecutive transient failures tolerated before giving up. Default 5. */
  maxConsecutiveFailures?: number
  onTransientError?: (consecutiveFailures: number, error: unknown) => void
  onRecovered?: () => void
}

const TRANSIENT_BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 30_000]

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PollAbortedError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new PollAbortedError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Polls a run until it leaves QUEUED/PROCESSING. Resolves with the final payload.
 *
 * `signal` is not optional in practice: a whitespace stage runs for minutes, so
 * a user who navigates away mid-run left this loop hitting the API every three
 * seconds for up to twenty minutes and then calling setState on a component
 * that no longer exists. Every caller should pass an AbortSignal tied to its
 * effect cleanup and swallow PollAbortedError.
 *
 * It stops on a TERMINAL STATUS only. There is deliberately no elapsed-time
 * wall: a dimension map can honestly run past twenty minutes, and the old wall
 * fabricated a FAILED for a run the server was still executing. Health is the
 * server's silence (heartbeatAt vs serverNow), which the payload carries.
 * Transient failures (network, 5xx, 429) are retried with backoff; auth and
 * not-found are not.
 */
export async function pollRun(
  studyId: string,
  runId: string,
  onTick?: (status: string, progress: RunProgress | null, payload: RunPayload) => void,
  signal?: AbortSignal,
  options: PollRunOptions = {}
): Promise<RunPayload> {
  const intervalMs = options.intervalMs ?? 3_000
  const maxWatchMs = options.maxWatchMs ?? 3 * 60 * 60 * 1_000
  const maxFailures = options.maxConsecutiveFailures ?? 5
  const watchStartedAt = Date.now()
  let consecutiveFailures = 0

  for (;;) {
    if (signal?.aborted) throw new PollAbortedError()
    if (Date.now() - watchStartedAt > maxWatchMs) {
      return {
        status: WATCH_TIMEOUT_STATUS,
        results: null,
        progress: null,
        error: 'Stopped watching this run — reload the page to check on it.',
      }
    }

    let payload: RunPayload
    try {
      payload = await wsApi<RunPayload>(`/api/whitespace/studies/${studyId}/runs/${runId}`, {
        signal,
        cache: 'no-store',
      })
      if (consecutiveFailures > 0) {
        consecutiveFailures = 0
        options.onRecovered?.()
      }
    } catch (error) {
      if (isPollAborted(error)) throw error
      const status = (error as { status?: number })?.status
      if (status === 401 || status === 403 || status === 404) throw error
      consecutiveFailures += 1
      if (consecutiveFailures > maxFailures) throw error
      options.onTransientError?.(consecutiveFailures, error)
      await sleep(TRANSIENT_BACKOFF_MS[Math.min(consecutiveFailures - 1, TRANSIENT_BACKOFF_MS.length - 1)], signal)
      continue
    }

    if (payload.status !== 'QUEUED' && payload.status !== 'PROCESSING') return payload
    onTick?.(payload.status, payload.progress ?? null, payload)
    await sleep(intervalMs, signal)
  }
}
