import { afterEach, describe, expect, test, vi } from 'vitest'
import { compactLogDetails, fetchWithProviderTimeout, providerTimeoutGraceMs, providerTimeoutMs } from './provider-runtime'

const originalFetch = global.fetch
const originalEnv = { ...process.env }

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  global.fetch = originalFetch
  process.env = { ...originalEnv }
})

describe('patent provider runtime helpers', () => {
  test('aborts only after timeout plus grace period', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let aborted = false
    global.fetch = vi.fn((_input: any, init: any) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    })) as any

    const promise = fetchWithProviderTimeout('https://example.test/search', {}, {
      providerId: 'pqai',
      operation: 'rest_search',
      timeoutMs: 1000,
      graceMs: 250,
    })
    const rejection = expect(promise).rejects.toThrow('timed out after 1250ms')

    await vi.advanceTimersByTimeAsync(1000)
    expect(aborted).toBe(false)
    expect(warn).toHaveBeenCalledWith('[PatentSearchProvider]', expect.stringContaining('timeout_grace_started'))

    await vi.advanceTimersByTimeAsync(249)
    expect(aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await rejection
    expect(aborted).toBe(true)
  })

  test('uses provider-specific timeout and grace environment overrides', () => {
    process.env.PQAI_TIMEOUT_MS = '1234'
    process.env.PQAI_TIMEOUT_GRACE_MS = '456'
    expect(providerTimeoutMs('pqai', 15_000)).toBe(1234)
    expect(providerTimeoutGraceMs('pqai')).toBe(456)
  })

  test('compacts large arrays unless verbose logging is enabled', () => {
    process.env.PATENT_SEARCH_LOG_SAMPLE_SIZE = '2'
    const compact = compactLogDetails({
      event: 'aggregate_completed',
      candidatePublicationNumbers: ['A', 'B', 'C', 'D'],
    })
    expect(compact.candidatePublicationNumbers).toEqual({
      count: 4,
      sample: ['A', 'B'],
      omitted: 2,
    })

    process.env.PATENT_SEARCH_VERBOSE_LOGS = 'true'
    const verbose = compactLogDetails({
      event: 'aggregate_completed',
      candidatePublicationNumbers: ['A', 'B', 'C', 'D'],
    })
    expect(verbose.candidatePublicationNumbers).toEqual(['A', 'B', 'C', 'D'])
  })
})
