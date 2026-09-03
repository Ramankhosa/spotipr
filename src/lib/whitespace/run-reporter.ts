/**
 * Whitespace Studio — the run reporter.
 *
 * One per run attempt, created by the executor and handed to the stage. Stages
 * declare the steps they will really take, then narrate as they work: step
 * changes, counters, and short events naming the documents read, values
 * counted, attacks run. The reporter buffers that in memory and writes it to
 * the run row's `progress` through `heartbeatRun`, which is also what extends
 * the lease — so narration and liveness are one write.
 *
 * Rules the reporter enforces so the panel never lies:
 *  - A step becomes `done` only by an explicit transition out of `active`.
 *    Stepping past a pending step marks it `skipped` ("not run"), never done.
 *  - Writes are throttled (minFlushIntervalMs) and back off on a blip; a key
 *    change flushes immediately. A keepalive flush runs while idle so a single
 *    long SQL statement still extends the lease and advances heartbeatAt.
 *  - Lease loss is fatal and STAYS fatal: every method — the synchronous ones
 *    included — rethrows it first, so a stage inside a long transaction aborts
 *    at its next narration call rather than working blind. A timer flush that
 *    hits the fence records the error instead of rejecting into the void.
 *  - After close() nothing writes; the executor closes the reporter BEFORE the
 *    completion write, so no late flush can trip the status fence.
 *  - Event text is plain, whitespace-collapsed, capped at 160 chars, and must
 *    narrate what was done, never what was found.
 */

import { heartbeatRun as defaultHeartbeat } from './run-lease'
import type {
  LiveCounter,
  LiveEvent,
  LiveEventKind,
  LiveStep,
  WhitespaceRunProgress,
  WhitespaceRunStage,
} from './types'

export type HeartbeatWriter = (
  runId: string,
  workerId: string,
  progress?: WhitespaceRunProgress
) => Promise<boolean>

export interface RunReporterOptions {
  runId: string
  workerId: string
  stage: WhitespaceRunStage
  /** The run's attemptCount; a retry narrates under a new number. */
  attempt: number
  heartbeat?: HeartbeatWriter
  now?: () => number
  /** Minimum spacing between throttled writes. Default 1.5 s. */
  minFlushIntervalMs?: number
  /** Idle write cadence that keeps the lease and heartbeatAt fresh. Default 30 s. */
  keepaliveMs?: number
  /** Newest events kept in the snapshot. Default 20. */
  windowSize?: number
  maxEventChars?: number
}

export interface StepProgress {
  n?: number
  total?: number
  round?: number
}

const MAX_BACKOFF_MS = 30_000

/** Whitespace-collapsed, capped, never undefined. */
function cleanText(text: string, max: number): string {
  const collapsed = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export class RunReporter {
  private readonly runId: string
  private readonly workerId: string
  private readonly stage: WhitespaceRunStage
  private readonly attempt: number
  private readonly writer: HeartbeatWriter
  private readonly now: () => number
  private readonly minFlushIntervalMs: number
  private readonly keepaliveMs: number
  private readonly windowSize: number
  private readonly maxEventChars: number

  private steps: LiveStep[] = []
  private counters: LiveCounter[] = []
  private recent: LiveEvent[] = []
  private seq = 0
  private round: number | undefined
  private readonly startedAt: number
  private writeFailures = 0

  private dirty = false
  private closed = false
  private fatalError: unknown = null
  private inFlight: Promise<void> | null = null
  private lastFlushAt = 0
  private backoffMs: number
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: RunReporterOptions) {
    this.runId = options.runId
    this.workerId = options.workerId
    this.stage = options.stage
    this.attempt = options.attempt
    this.writer = options.heartbeat ?? defaultHeartbeat
    this.now = options.now ?? (() => Date.now())
    this.minFlushIntervalMs = options.minFlushIntervalMs ?? 1_500
    this.keepaliveMs = options.keepaliveMs ?? 30_000
    this.windowSize = options.windowSize ?? 20
    this.maxEventChars = options.maxEventChars ?? 160
    this.backoffMs = this.minFlushIntervalMs
    this.startedAt = this.now()

    this.keepaliveTimer = setInterval(() => {
      if (this.closed || this.fatalError || this.inFlight) return
      if (this.now() - this.lastFlushAt < this.keepaliveMs) return
      void this.flushNow().catch(() => {
        /* recorded as fatal inside flushNow */
      })
    }, this.keepaliveMs)
    this.keepaliveTimer.unref?.()
  }

  /** The lease-lost (or other write) error that ended this reporter, if any. */
  get fatal(): unknown {
    return this.fatalError
  }

  get isClosed(): boolean {
    return this.closed
  }

  // -------------------------------------------------------------------------
  // Declaring and moving through steps
  // -------------------------------------------------------------------------

  /** Declares the real plan. Writes immediately. Idempotent per key. */
  async plan(
    steps: Array<{ key: string; label: string }>,
    counters?: Array<{ key: string; label: string; total?: number }>
  ): Promise<void> {
    this.assertLive()
    if (this.closed) return
    for (const step of steps) {
      if (!this.steps.some(existing => existing.key === step.key)) {
        this.steps.push({ key: step.key, label: step.label, state: 'pending' })
      }
    }
    for (const counter of counters ?? []) {
      if (!this.counters.some(existing => existing.key === counter.key)) {
        this.counters.push({
          key: counter.key,
          label: counter.label,
          value: null,
          ...(typeof counter.total === 'number' ? { total: counter.total } : {}),
        })
      }
    }
    await this.flushNow()
  }

  /**
   * Makes `key` the active step. The previous active step becomes done; any
   * still-pending step declared BEFORE `key` becomes skipped — a stage that
   * legitimately jumps forward did not do that work, and the rail must not
   * say it did. A key change writes immediately; the same key again only
   * updates the detail and progress (throttled).
   */
  async step(key: string, detail?: string, progress?: StepProgress): Promise<void> {
    this.assertLive()
    if (this.closed) return
    let target = this.steps.find(step => step.key === key)
    if (!target) {
      // Never throw over narration: an undeclared key is appended.
      target = { key, label: detail ?? key, state: 'pending' }
      this.steps.push(target)
    }
    if (progress?.round !== undefined) this.round = progress.round

    if (target.state === 'active') {
      this.applyDetail(target, detail, progress)
      this.scheduleFlush()
      return
    }

    const targetIndex = this.steps.indexOf(target)
    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i]
      if (step.state === 'active') step.state = 'done'
      else if (i < targetIndex && step.state === 'pending') {
        step.state = 'skipped'
        step.detail = 'not run'
      }
    }
    target.state = 'active'
    delete target.n
    delete target.total
    this.applyDetail(target, detail, progress)
    this.clearFlushTimer()
    await this.flushNow()
  }

  /** The step did not run. Writes immediately. */
  async skip(key: string, reason: string): Promise<void> {
    this.assertLive()
    if (this.closed) return
    this.markTerminal(key, 'skipped', reason)
    this.clearFlushTimer()
    await this.flushNow()
  }

  /** The step ran and its failure was caught. Writes immediately. */
  async fail(key: string, reason: string): Promise<void> {
    this.assertLive()
    if (this.closed) return
    this.markTerminal(key, 'failed', reason)
    this.clearFlushTimer()
    await this.flushNow()
  }

  private markTerminal(key: string, state: 'skipped' | 'failed', reason: string): void {
    let target = this.steps.find(step => step.key === key)
    if (!target) {
      target = { key, label: key, state: 'pending' }
      this.steps.push(target)
    }
    target.state = state
    target.detail = cleanText(reason, this.maxEventChars)
    delete target.n
    delete target.total
  }

  private applyDetail(target: LiveStep, detail?: string, progress?: StepProgress): void {
    if (detail !== undefined) target.detail = cleanText(detail, this.maxEventChars)
    if (progress) {
      const n = finiteOrNull(progress.n)
      const total = finiteOrNull(progress.total)
      if (n !== null) target.n = n
      if (total !== null) target.total = total
    }
  }

  // -------------------------------------------------------------------------
  // Counters, events, detail — synchronous, throttled
  // -------------------------------------------------------------------------

  /** Upserts a counter. A non-finite value reads as "not measured". */
  count(key: string, value: number, total?: number, label?: string): void {
    this.assertLive()
    if (this.closed) return
    const measured = finiteOrNull(value)
    const cappedTotal = finiteOrNull(total)
    const existing = this.counters.find(counter => counter.key === key)
    if (existing) {
      existing.value = measured
      if (cappedTotal !== null) existing.total = cappedTotal
      if (label) existing.label = label
    } else {
      this.counters.push({
        key,
        label: label ?? key,
        value: measured,
        ...(cappedTotal !== null ? { total: cappedTotal } : {}),
      })
    }
    this.scheduleFlush()
  }

  /** Appends an event to the rolling window. */
  event(kind: LiveEventKind, text: string): void {
    this.assertLive()
    if (this.closed) return
    this.seq += 1
    this.recent.push({ seq: this.seq, t: this.now(), kind, text: cleanText(text, this.maxEventChars) })
    if (this.recent.length > this.windowSize) {
      this.recent.splice(0, this.recent.length - this.windowSize)
    }
    this.scheduleFlush()
  }

  /** Replaces the active step's status line. */
  detail(text: string): void {
    this.assertLive()
    if (this.closed) return
    const active = this.steps.find(step => step.state === 'active')
    if (!active) return
    active.detail = cleanText(text, this.maxEventChars)
    this.scheduleFlush()
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /**
   * An awaited write of the current snapshot — the drop-in for the silent
   * `heartbeatRun(runId, workerId)` calls stages used to make. Rethrows a lost
   * lease exactly as heartbeatRun does.
   */
  async heartbeat(): Promise<void> {
    this.assertLive()
    if (this.closed) return
    this.clearFlushTimer()
    await this.flushNow()
  }

  /** Same as heartbeat(): an awaited write regardless of the throttle. */
  async flush(): Promise<void> {
    await this.heartbeat()
  }

  /** Every active step becomes done. No write: completion nulls progress anyway. */
  done(): void {
    this.assertLive()
    if (this.closed) return
    for (const step of this.steps) if (step.state === 'active') step.state = 'done'
    this.dirty = true
  }

  /**
   * Stops all writing. Cancels timers, waits for a write already in flight,
   * and swallows anything that write raises — after close there is nobody
   * left to act on it. Idempotent.
   */
  async close(): Promise<void> {
    if (!this.closed) this.closeInternal()
    if (this.inFlight) await this.inFlight.catch(() => undefined)
  }

  private closeInternal(): void {
    this.closed = true
    this.clearFlushTimer()
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
  }

  /** The exact object the next write would carry. Plain JSON by construction. */
  snapshot(): WhitespaceRunProgress {
    const active = this.steps.find(step => step.state === 'active')
    const lastSettled = [...this.steps].reverse().find(step => step.state !== 'pending')
    const lead = active ?? lastSettled ?? this.steps[0] ?? null
    const snapshot: WhitespaceRunProgress = {
      phase: lead?.key ?? 'starting',
      detail: lead ? (lead.detail ?? lead.label) : 'Starting',
      v: 2,
      stage: this.stage,
      attempt: this.attempt,
      steps: this.steps.map(step => ({
        key: step.key,
        label: step.label,
        state: step.state,
        ...(step.detail !== undefined ? { detail: step.detail } : {}),
        ...(step.n !== undefined ? { n: step.n } : {}),
        ...(step.total !== undefined ? { total: step.total } : {}),
      })),
      counters: this.counters.map(counter => ({
        key: counter.key,
        label: counter.label,
        value: counter.value,
        ...(counter.total !== undefined ? { total: counter.total } : {}),
      })),
      recent: this.recent.map(event => ({ ...event })),
      seq: this.seq,
      startedAt: this.startedAt,
      updatedAt: this.now(),
      writeFailures: this.writeFailures,
    }
    if (this.round !== undefined) snapshot.round = this.round
    return snapshot
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private assertLive(): void {
    if (this.fatalError) throw this.fatalError
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  /** A throttled write: now if the interval has passed, else once when it has. */
  private scheduleFlush(): void {
    if (this.closed || this.fatalError) return
    this.dirty = true
    if (this.inFlight || this.flushTimer) return
    const wait = Math.max(0, this.lastFlushAt + this.backoffMs - this.now())
    if (wait === 0) {
      void this.flushNow().catch(() => {
        /* recorded as fatal inside flushNow */
      })
      return
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      if (this.closed || this.fatalError || !this.dirty) return
      void this.flushNow().catch(() => {
        /* recorded as fatal inside flushNow */
      })
    }, wait)
    this.flushTimer.unref?.()
  }

  /**
   * One write at a time. A second caller waits for the write in flight and
   * then writes again (an awaited heartbeat must always extend the lease).
   * A lost lease is recorded as fatal AND rethrown, so an awaited caller sees
   * it now and every later caller sees it first thing.
   */
  private async flushNow(): Promise<void> {
    if (this.closed) return
    if (this.fatalError) throw this.fatalError
    if (this.inFlight) {
      await this.inFlight.catch(() => undefined)
      return this.flushNow()
    }
    this.dirty = false
    const snapshot = this.snapshot()
    const write = (async () => {
      let written: boolean
      try {
        written = await this.writer(this.runId, this.workerId, snapshot)
      } catch (error) {
        this.recordFatal(error)
        throw error
      }
      this.lastFlushAt = this.now()
      if (written) {
        this.backoffMs = this.minFlushIntervalMs
      } else {
        this.writeFailures += 1
        this.backoffMs = Math.min(MAX_BACKOFF_MS, this.backoffMs * 2)
      }
    })()
    this.inFlight = write
    try {
      await write
    } finally {
      if (this.inFlight === write) this.inFlight = null
    }
    if (this.dirty && !this.closed && !this.fatalError) this.scheduleFlush()
  }

  private recordFatal(error: unknown): void {
    if (!this.fatalError) this.fatalError = error
    this.closeInternal()
  }
}
