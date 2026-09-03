/**
 * The retry budget and the permanence rule.
 *
 * Both exist because whitespace failures are mostly REFUSALS, not faults. "This
 * field matches more than 250,000 publications" is deterministic — retrying it
 * three times costs minutes of database time and, on the metered stages, three
 * rounds of model spend, to print the same sentence. Transient failures (a
 * dropped connection, a restarted worker) are the ones the budget is for.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isLeaseLost,
  isPermanentFailure,
  retryDelayMs,
  WhitespaceLeaseLostError,
  WhitespacePermanentError,
  RUN_LEASE_MS,
} from '../run-lease'

describe('WhitespacePermanentError', () => {
  it('marks a refusal as not worth retrying', () => {
    const refusal = new WhitespacePermanentError('This field is too broad to count within 90s.')
    expect(isPermanentFailure(refusal)).toBe(true)
    expect(refusal.message).toContain('too broad')
  })

  it('treats an ordinary failure as transient, so it keeps its retries', () => {
    expect(isPermanentFailure(new Error('Connection terminated unexpectedly'))).toBe(false)
    expect(isPermanentFailure('some string')).toBe(false)
    expect(isPermanentFailure(null)).toBe(false)
    expect(isPermanentFailure(undefined)).toBe(false)
  })

  it('recognises the marker across a module boundary, not by identity', () => {
    // A worker and the web process can load different copies of the module, so
    // `instanceof` alone is not enough — the duck-typed flag has to carry.
    expect(isPermanentFailure({ permanent: true, message: 'from another realm' })).toBe(true)
  })
})

describe('retryDelayMs', () => {
  it('backs off between attempts', () => {
    const delays = [1, 2, 3].map(retryDelayMs)
    expect(delays[0]).toBeGreaterThan(0)
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1])
  })

  it('maps the FIRST failed attempt to the first rung — attemptCount arrives pre-incremented by the claim', () => {
    // The claim bumps attemptCount before execution, so the first failure is
    // recorded as attempt 1. Indexing the table with the raw count skipped the
    // shortest rung entirely and every first retry waited the second delay.
    expect(retryDelayMs(1)).toBeLessThan(retryDelayMs(2))
    expect(retryDelayMs(0)).toBe(retryDelayMs(1))
  })

  it('holds at the last step rather than reading off the end', () => {
    expect(retryDelayMs(99)).toBe(retryDelayMs(3))
    expect(Number.isFinite(retryDelayMs(99))).toBe(true)
  })
})

describe('RUN_LEASE_MS', () => {
  it('outlasts the slowest stage, so a live worker is never overtaken mid-run', () => {
    // The dimension census alone budgets ~10.7 minutes of transaction time.
    expect(RUN_LEASE_MS).toBeGreaterThan(11 * 60 * 1000)
  })
})

describe('WhitespaceLeaseLostError', () => {
  it('recognises the marker across a module boundary, not by identity', () => {
    expect(isLeaseLost(new WhitespaceLeaseLostError('run-1'))).toBe(true)
    expect(isLeaseLost({ leaseLost: true, message: 'from another realm' })).toBe(true)
    expect(isLeaseLost(new Error('Connection terminated unexpectedly'))).toBe(false)
  })
})

describe('heartbeatRun', () => {
  let updateManyArgs: Array<Record<string, unknown>>
  let updateManyResult: () => Promise<{ count: number }>

  beforeEach(() => {
    vi.resetModules()
    updateManyArgs = []
    updateManyResult = async () => ({ count: 1 })
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        whitespaceRun: {
          updateMany: (args: Record<string, unknown>) => {
            updateManyArgs.push(args)
            return updateManyResult()
          },
        },
      },
    }))
  })

  afterEach(() => {
    vi.doUnmock('@/lib/prisma')
  })

  it('extends only a lease this worker still holds, carrying the progress payload', async () => {
    const { heartbeatRun } = await import('../run-lease')
    await expect(heartbeatRun('run-1', 'worker-a', { phase: 'census', detail: 'counting' })).resolves.toBe(true)
    expect(updateManyArgs).toHaveLength(1)
    expect(updateManyArgs[0].where).toMatchObject({ id: 'run-1', lockedBy: 'worker-a', status: 'PROCESSING' })
    expect(updateManyArgs[0].data).toMatchObject({ progress: { phase: 'census', detail: 'counting' } })
  })

  it('throws lease-lost when the fence matches no row, so the stage aborts instead of working blind', async () => {
    updateManyResult = async () => ({ count: 0 })
    const lease = await import('../run-lease')
    await expect(lease.heartbeatRun('run-1', 'worker-a')).rejects.toSatisfy(lease.isLeaseLost)
  })

  it('still swallows a write that merely errors — a bookkeeping blip must not fail a census', async () => {
    updateManyResult = async () => {
      throw new Error('Connection terminated unexpectedly')
    }
    const { heartbeatRun } = await import('../run-lease')
    // …but says so, so a narration writer can back off instead of stalling.
    await expect(heartbeatRun('run-1', 'worker-a')).resolves.toBe(false)
  })
})
