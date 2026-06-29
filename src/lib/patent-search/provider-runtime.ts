type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function providerEnvPrefix(providerId: string) {
  return providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
}

export function providerTimeoutMs(providerId: string, fallbackMs: number) {
  const prefix = providerEnvPrefix(providerId)
  return envNumber(`${prefix}_TIMEOUT_MS`, envNumber('PATENT_SEARCH_PROVIDER_TIMEOUT_MS', fallbackMs))
}

export function providerTimeoutGraceMs(providerId: string, fallbackMs = 5000) {
  const prefix = providerEnvPrefix(providerId)
  return envNumber(`${prefix}_TIMEOUT_GRACE_MS`, envNumber('PATENT_SEARCH_PROVIDER_TIMEOUT_GRACE_MS', fallbackMs))
}

export async function fetchWithProviderTimeout(
  input: FetchInput,
  init: FetchInit = {},
  options: {
    providerId: string
    operation: string
    timeoutMs: number
    graceMs?: number
  }
): Promise<Response> {
  const timeoutMs = Math.max(1000, Math.trunc(options.timeoutMs))
  const graceMs = Math.max(0, Math.trunc(options.graceMs ?? providerTimeoutGraceMs(options.providerId)))
  const controller = new AbortController()
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let abortTimer: ReturnType<typeof setTimeout> | undefined
  let didAbort = false

  graceTimer = setTimeout(() => {
    console.warn('[PatentSearchProvider]', JSON.stringify({
      event: 'timeout_grace_started',
      providerId: options.providerId,
      operation: options.operation,
      timeoutMs,
      graceMs,
    }))
  }, timeoutMs)

  abortTimer = setTimeout(() => {
    didAbort = true
    controller.abort()
  }, timeoutMs + graceMs)

  try {
    return await fetch(input, {
      ...(init || {}),
      signal: controller.signal,
    })
  } catch (error) {
    const isAbort = didAbort || (error instanceof Error && error.name === 'AbortError')
    if (isAbort) {
      throw new Error(`${options.providerId} ${options.operation} timed out after ${timeoutMs + graceMs}ms (timeout ${timeoutMs}ms + grace ${graceMs}ms).`)
    }
    throw error
  } finally {
    if (graceTimer) clearTimeout(graceTimer)
    if (abortTimer) clearTimeout(abortTimer)
  }
}

export function compactLogDetails<T extends Record<string, unknown>>(details: T): T {
  if (String(process.env.PATENT_SEARCH_VERBOSE_LOGS || '').toLowerCase() === 'true') return details
  const maxItems = envNumber('PATENT_SEARCH_LOG_SAMPLE_SIZE', 5)
  const compactValue = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value
    if (value.length <= maxItems) return value
    return {
      count: value.length,
      sample: value.slice(0, maxItems),
      omitted: value.length - maxItems,
    }
  }
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, compactValue(value)])
  ) as T
}
