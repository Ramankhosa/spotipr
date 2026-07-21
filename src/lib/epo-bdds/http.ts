// Shared HTTP concerns for the BDDS client: typed errors and retry-with-backoff.
//
// Retryable vs fatal is kept explicit and separate — a 401 must fail loudly
// rather than burn the retry budget, and a corrupt/expired token must not be
// mistaken for a transient network fault.

export class BddsAuthError extends Error {
  constructor(message: string, readonly statusCode?: number) {
    super(message)
    this.name = 'BddsAuthError'
  }
}

export class BddsNotFoundError extends Error {
  constructor(resource: string, id: string | number) {
    super(`${resource} not found: ${id}`)
    this.name = 'BddsNotFoundError'
  }
}

/** Transient: network fault, 5xx, or 429. Safe to retry. */
export class BddsRetryableError extends Error {
  constructor(message: string, readonly statusCode?: number, readonly retryAfterMs?: number) {
    super(message)
    this.name = 'BddsRetryableError'
  }
}

/** Permanent: 4xx other than 429, or a malformed response. Do not retry. */
export class BddsFatalError extends Error {
  constructor(message: string, readonly statusCode?: number) {
    super(message)
    this.name = 'BddsFatalError'
  }
}

export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** Injected in tests so retries do not actually sleep. */
  sleep?: (ms: number) => Promise<void>
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Classify an HTTP status into our error taxonomy. `retryAfter` is the raw
 * header value when present.
 */
export function classifyStatus(status: number, body: string, retryAfter?: string | null): Error {
  if (status === 401 || status === 403) {
    const detail = body ? ` — ${body.slice(0, 300)}` : ''
    return new BddsAuthError(
      `BDDS auth failed (${status}). Check EPO_USERNAME / EPO_PASSWORD.${detail}`,
      status
    )
  }
  if (status === 429) {
    const seconds = Number(retryAfter)
    return new BddsRetryableError('BDDS rate limited', status, Number.isFinite(seconds) ? seconds * 1000 : undefined)
  }
  if (status >= 500) {
    return new BddsRetryableError(`BDDS server error (${status})`, status)
  }
  return new BddsFatalError(`BDDS request failed (${status}): ${body.slice(0, 300)}`, status)
}

/** Exponential backoff with full jitter, bounded by maxDelayMs. */
export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
  return Math.floor(Math.random() * exponential)
}

/**
 * Run `fn`, retrying only BddsRetryableError (and raw network faults, which
 * fetch surfaces as TypeError). Auth and fatal errors propagate immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxRetries = options.maxRetries ?? 3
  const baseDelayMs = options.baseDelayMs ?? 1000
  const maxDelayMs = options.maxDelayMs ?? 30_000
  const sleep = options.sleep ?? defaultSleep

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      const retryable = error instanceof BddsRetryableError || error instanceof TypeError
      if (!retryable || attempt === maxRetries) throw error

      const hinted = error instanceof BddsRetryableError ? error.retryAfterMs : undefined
      const delayMs = hinted ?? backoffDelay(attempt, baseDelayMs, maxDelayMs)
      options.onRetry?.(attempt + 1, delayMs, error)
      await sleep(delayMs)
    }
  }
  throw lastError
}
