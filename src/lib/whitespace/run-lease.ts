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

export function retryDelayMs(attemptCount: number): number {
  return RETRY_BACKOFF_MS[Math.min(attemptCount, RETRY_BACKOFF_MS.length - 1)]
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
 * Extends this run's lease and records live narration.
 *
 * Stages used to each keep a private `heartbeat()` that wrote `heartbeatAt` and
 * nothing else. Under a lease that is not enough: a stage that works for longer
 * than RUN_LEASE_MS without pushing `lockedUntil` forward would have its run
 * claimed by a second worker and executed twice. Every stage calls this instead.
 *
 * Never throws. A missed heartbeat costs a re-claim at worst; failing a
 * forty-minute census because a bookkeeping write blipped would be far worse.
 */
export async function heartbeatRun(
  runId: string,
  progress?: { phase: string; detail: string; round?: number }
): Promise<void> {
  try {
    await prisma.whitespaceRun.update({
      where: { id: runId },
      data: {
        heartbeatAt: new Date(),
        lockedUntil: new Date(Date.now() + RUN_LEASE_MS),
        ...(progress ? { progress: { ...progress } } : {}),
      },
    })
  } catch {
    // Staleness detection and narration only.
  }
}
