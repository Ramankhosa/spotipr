/**
 * The retry budget and the permanence rule.
 *
 * Both exist because whitespace failures are mostly REFUSALS, not faults. "This
 * field matches more than 250,000 publications" is deterministic — retrying it
 * three times costs minutes of database time and, on the metered stages, three
 * rounds of model spend, to print the same sentence. Transient failures (a
 * dropped connection, a restarted worker) are the ones the budget is for.
 */

import { describe, expect, it } from 'vitest'
import { isPermanentFailure, retryDelayMs, WhitespacePermanentError, RUN_LEASE_MS } from '../run-lease'

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
    const delays = [0, 1, 2].map(retryDelayMs)
    expect(delays[0]).toBeGreaterThan(0)
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1])
  })

  it('holds at the last step rather than reading off the end', () => {
    expect(retryDelayMs(99)).toBe(retryDelayMs(2))
    expect(Number.isFinite(retryDelayMs(99))).toBe(true)
  })
})

describe('RUN_LEASE_MS', () => {
  it('outlasts the slowest stage, so a live worker is never overtaken mid-run', () => {
    // The dimension census alone budgets ~10.7 minutes of transaction time.
    expect(RUN_LEASE_MS).toBeGreaterThan(11 * 60 * 1000)
  })
})
