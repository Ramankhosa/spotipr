export function getMetaActualCost(meta: unknown): number | null {
  if (!meta) return null

  let payload: any = meta
  if (typeof meta === 'string') {
    try {
      payload = JSON.parse(meta)
    } catch {
      return null
    }
  }

  const cost = payload?.cost
  if (!cost || typeof cost.actualCost !== 'number') return null
  if (!Number.isFinite(cost.actualCost)) return null
  return cost.actualCost
}
