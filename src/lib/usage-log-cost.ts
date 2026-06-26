function parseMetaPayload(meta: unknown): any | null {
  if (!meta) return null

  let payload: any = meta
  if (typeof meta === 'string') {
    try {
      payload = JSON.parse(meta)
    } catch {
      return null
    }
  }

  return payload && typeof payload === 'object' ? payload : null
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

export function getMetaActualCost(meta: unknown): number | null {
  const payload = parseMetaPayload(meta)
  if (!payload) return null

  const cost = payload?.cost
  return finiteNumber(cost?.actualCost)
}

export function getMetaThoughtTokens(meta: unknown): number {
  const payload = parseMetaPayload(meta)
  if (!payload) return 0

  const candidates = [
    payload.thoughtTokens,
    payload.reasoningTokens,
    payload.cost?.thoughtTokens,
    payload.costBreakdown?.thoughtTokens
  ]

  for (const value of candidates) {
    const tokens = finiteNumber(value)
    if (tokens !== null && tokens > 0) return Math.trunc(tokens)
  }

  return 0
}

export function areMetaThoughtTokensIncludedInOutput(meta: unknown): boolean {
  const payload = parseMetaPayload(meta)
  if (!payload) return false

  return (
    payload.thoughtTokensIncludedInOutput === true ||
    payload.reasoningTokensIncludedInOutput === true ||
    payload.cost?.thoughtTokensIncludedInOutput === true ||
    payload.costBreakdown?.thoughtTokensIncludedInOutput === true
  )
}

export function getMetaSeparatelyBilledThoughtTokens(meta: unknown): number {
  return areMetaThoughtTokensIncludedInOutput(meta) ? 0 : getMetaThoughtTokens(meta)
}

export function getBillableOutputTokens(outputTokens: number | null | undefined, meta: unknown): number {
  return (outputTokens ?? 0) + getMetaSeparatelyBilledThoughtTokens(meta)
}

export function getBillableTotalTokens(
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  meta: unknown
): number {
  return (inputTokens ?? 0) + getBillableOutputTokens(outputTokens, meta)
}
