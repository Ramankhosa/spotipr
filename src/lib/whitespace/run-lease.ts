/**
 * Whitespace Studio — the run lease.
 *
 * `WhitespaceRun` has carried lockedBy / lockedUntil / heartbeatAt /
 * attemptCount / maxAttempts / nextAttemptAt since it was modelled, and nothing
 * ever wrote to them: runs were executed by a detached `setTimeout` in whichever
 * web process happened to serve the POST. That process is replaced on every
 * deploy and recycled by the platform whenever it likes, so an in-flight census
 * simply vanished — the row sat PROCESSING until a reader tripped the 15-minute
 * staleness sweep and told the user to run it again. Nothing retried, and
 * nothing could be moved to a worker because the work only existed in memory.
 *
 * This module holds the small pieces the lease needs, in a file with no imports
 * from the stages, so both the service and the stages can use it without a
 * cycle.
 */

import { prisma } from '@/lib/prisma'

/**
 * How long a claim is good for before another worker may take the run.
 *
 * Comfortably longer than the slowest stage's own budget: the dimension census
 * alone can hold a transaction for ten minutes. Stages extend the lease at every
 * heartbeat, so this is the ceiling on how long a genuinely dead worker keeps a
 * run to itself, not a limit on how long a live one may work.
 */
export const RUN_LEASE_MS = 20 * 60 * 1000

/** Retry backoff by attempt number, in milliseconds. */
const RETRY_BACKOFF_MS = [30_000, 2 * 60_000, 5 * 60_000]

/**
 * `attemptCount` is the attempt that just failed, ALREADY incremented by the
 * claim — so the first failure arrives as 1 and must map to the first rung.
 */
export function retryDelayMs(attemptCount: number): number {
  return RETRY_BACKOFF_MS[Math.max(0, Math.min(attemptCount - 1, RETRY_BACKOFF_MS.length - 1))]
}

/**
 * A failure that retrying cannot fix.
 *
 * Most whitespace failures are refusals, not faults: "this field matches more
 * than 250,000 publications", "no concept survived common-word removal", "run
 * the field map first". Those are deterministic — the same scope will refuse the
 * same way three times — and each attempt costs minutes of database time and,
 * for the metered stages, another round of model spend. Retrying them would turn
 * one honest refusal into three, and the user would wait ten minutes to read the
 * same sentence.
 *
 * Everything NOT thrown as this is assumed transient (a dropped connection, a
 * rate-limited model, a restarted worker) and is retried with backoff.
 */
export class WhitespacePermanentError extends Error {
  readonly permanent = true
  constructor(message: string) {
    super(message)
    this.name = 'WhitespacePermanentError'
  }
}

export function isPermanentFailure(error: unknown): boolean {
  return error instanceof WhitespacePermanentError || (error as { permanent?: boolean })?.permanent === true
}

/**
 * The run's lease is no longer this worker's.
 *
 * Thrown by heartbeatRun when the fenced write matches no row: the lease
 * expired and another worker reclaimed the run, or the run was resolved from
 * outside. The stage must abort — every further model call is spend on work
 * whose result cannot be committed, and every further write races the worker
 * that now legitimately holds the run.
 */
export class WhitespaceLeaseLostError extends Error {
  readonly leaseLost = true
  constructor(runId: string) {
    super(`Run ${runId} is no longer leased to this worker.`)
    this.name = 'WhitespaceLeaseLostError'
  }
}

export function isLeaseLost(error: unknown): boolean {
  return error instanceof WhitespaceLeaseLostError || (error as { leaseLost?: boolean })?.leaseLost === true
}

/**
 * Extends this run's lease and records live narration.
 *
 * Stages used to each keep a private `heartbeat()` that wrote `heartbeatAt` and
 * nothing else. Under a lease that is not enough: a stage that works for longer
 * than RUN_LEASE_MS without pushing `lockedUntil` forward would have its run
 * claimed by a second worker and executed twice. Every stage calls this instead.
 *
 * Fenced on `lockedBy`: an unconditional write would let a worker that already
 * lost its lease re-extend it and keep working blind against the new holder.
 * When the fence matches no row this throws WhitespaceLeaseLostError so the
 * stage aborts. A write that merely errors (a connection blip) is still
 * swallowed — a missed heartbeat costs a re-claim at worst; failing a
 * forty-minute census because a bookkeeping write blipped would be far worse.
 */
export async function heartbeatRun(
  runId: string,
  workerId: string,
  progress?: { phase: string; detail: string; round?: number }
): Promise<void> {
  let count: number
  try {
    const updated = await prisma.whitespaceRun.updateMany({
      where: { id: runId, lockedBy: workerId, status: 'PROCESSING' },
      data: {
        heartbeatAt: new Date(),
        lockedUntil: new Date(Date.now() + RUN_LEASE_MS),
        ...(progress ? { progress: { ...progress } } : {}),
      },
    })
    count = updated.count
  } catch {
    // Staleness detection and narration only.
    return
  }
  if (count === 0) throw new WhitespaceLeaseLostError(runId)
}
