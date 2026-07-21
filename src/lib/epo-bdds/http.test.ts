import { describe, expect, it, vi } from 'vitest'
import {
  BddsAuthError,
  BddsFatalError,
  BddsRetryableError,
  backoffDelay,
  classifyStatus,
  withRetry,
} from './http'

describe('classifyStatus', () => {
  it('treats 401/403 as auth failures so they fail loudly instead of retrying', () => {
    expect(classifyStatus(401, '')).toBeInstanceOf(BddsAuthError)
    expect(classifyStatus(403, '')).toBeInstanceOf(BddsAuthError)
  })

  it('treats 5xx and 429 as retryable', () => {
    expect(classifyStatus(500, '')).toBeInstanceOf(BddsRetryableError)
    expect(classifyStatus(503, '')).toBeInstanceOf(BddsRetryableError)
    expect(classifyStatus(429, '')).toBeInstanceOf(BddsRetryableError)
  })

  it('honours Retry-After on a 429', () => {
    const error = classifyStatus(429, '', '30') as BddsRetryableError
    expect(error.retryAfterMs).toBe(30_000)
  })

  it('treats other 4xx as fatal', () => {
    expect(classifyStatus(404, 'nope')).toBeInstanceOf(BddsFatalError)
    expect(classifyStatus(400, 'bad')).toBeInstanceOf(BddsFatalError)
  })
})

describe('backoffDelay', () => {
  it('grows exponentially and stays within the cap', () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const delay = backoffDelay(attempt, 1000, 30_000)
      expect(delay).toBeGreaterThanOrEqual(0)
      expect(delay).toBeLessThanOrEqual(30_000)
    }
  })
})

describe('withRetry', () => {
  const sleep = () => Promise.resolve()

  it('returns the first successful result without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    expect(await withRetry(fn, { sleep })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries retryable errors then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new BddsRetryableError('flaky', 503))
      .mockRejectedValueOnce(new BddsRetryableError('flaky', 503))
      .mockResolvedValue('ok')
    expect(await withRetry(fn, { sleep, maxRetries: 3 })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('never retries an auth error — a bad password must not burn the budget', async () => {
    const fn = vi.fn().mockRejectedValue(new BddsAuthError('bad creds', 401))
    await expect(withRetry(fn, { sleep, maxRetries: 3 })).rejects.toBeInstanceOf(BddsAuthError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('never retries a fatal error', async () => {
    const fn = vi.fn().mockRejectedValue(new BddsFatalError('gone', 404))
    await expect(withRetry(fn, { sleep, maxRetries: 3 })).rejects.toBeInstanceOf(BddsFatalError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('gives up after maxRetries and propagates the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new BddsRetryableError('always down', 500))
    await expect(withRetry(fn, { sleep, maxRetries: 2 })).rejects.toThrow('always down')
    expect(fn).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it('retries raw network faults, which fetch surfaces as TypeError', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue('ok')
    expect(await withRetry(fn, { sleep, maxRetries: 2 })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
