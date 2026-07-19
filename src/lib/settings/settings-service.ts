import { prisma } from '@/lib/prisma'
import {
  SettingsSnapshot,
  coerceSettingValue,
  defaultSettings,
  getSettingDefinition,
  listSettingDefinitions,
} from './registry'

// Cached accessor for runtime settings.
//
// The retrieval path runs several of these lookups per search, so a per-request DB
// round trip would be a bad trade on a hot path. Values are cached process-wide for a
// short TTL and invalidated explicitly on write. With multiple app processes, a write
// on one is visible to the others within the TTL — acceptable for tuning knobs, where
// a few seconds of skew changes ranking slightly and nothing more.

const CACHE_TTL_MS = Math.max(
  1000,
  Number(process.env.SETTINGS_CACHE_TTL_MS || '30000') || 30_000
)

let cache: { values: SettingsSnapshot; expiresAt: number } | null = null
let inFlight: Promise<SettingsSnapshot> | null = null

function applyOverrides(rows: Array<{ key: string; value: unknown }>): SettingsSnapshot {
  const values = defaultSettings()
  for (const row of rows) {
    // A stored row whose key or value no longer validates (registry changed, range
    // tightened) falls back to the default rather than propagating a bad value.
    const coerced = coerceSettingValue(row.key, row.value)
    if (coerced.ok && coerced.value !== undefined) values[row.key] = coerced.value
  }
  return values
}

async function loadSettings(): Promise<SettingsSnapshot> {
  try {
    const rows = await prisma.systemSetting.findMany({ select: { key: true, value: true } })
    return applyOverrides(rows as Array<{ key: string; value: unknown }>)
  } catch (error) {
    // Never let a settings outage take down search — fall back to registry defaults,
    // which are the env-derived values the system used before this table existed.
    console.warn('[Settings] Failed to load overrides; using defaults.',
      error instanceof Error ? error.message : error)
    return defaultSettings()
  }
}

/** All settings with overrides applied. Cached; safe to call per request. */
export async function getSettings(): Promise<SettingsSnapshot> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.values
  if (inFlight) return inFlight

  inFlight = loadSettings()
    .then(values => {
      cache = { values, expiresAt: Date.now() + CACHE_TTL_MS }
      return values
    })
    .finally(() => { inFlight = null })

  return inFlight
}

export async function getNumberSetting(key: string): Promise<number> {
  const values = await getSettings()
  const value = values[key]
  if (typeof value === 'number') return value
  const definition = getSettingDefinition(key)
  return typeof definition?.default === 'number' ? definition.default : 0
}

export async function getBooleanSetting(key: string): Promise<boolean> {
  const values = await getSettings()
  const value = values[key]
  if (typeof value === 'boolean') return value
  const definition = getSettingDefinition(key)
  return definition?.default === true
}

export function invalidateSettingsCache() {
  cache = null
}

export interface SettingsUpdateResult {
  ok: boolean
  errors: string[]
  values?: SettingsSnapshot
}

/**
 * Persist overrides. Every value is validated against the registry first and the
 * whole batch is rejected if any fail, so a partially-applied edit can never leave
 * retrieval in a half-configured state.
 *
 * A value equal to its registry default deletes the row rather than storing it,
 * keeping the table a record of genuine deviations from stock behaviour.
 */
export async function updateSettings(
  updates: Record<string, unknown>,
  updatedBy?: string
): Promise<SettingsUpdateResult> {
  const errors: string[] = []
  const valid: Array<{ key: string; value: number | boolean; category: string }> = []

  for (const [key, raw] of Object.entries(updates)) {
    const definition = getSettingDefinition(key)
    if (!definition) {
      errors.push(`Unknown setting "${key}".`)
      continue
    }
    const coerced = coerceSettingValue(key, raw)
    if (!coerced.ok || coerced.value === undefined) {
      errors.push(coerced.error || `Invalid value for "${key}".`)
      continue
    }
    valid.push({ key, value: coerced.value, category: definition.category })
  }

  if (errors.length) return { ok: false, errors }

  await prisma.$transaction(valid.map(entry => {
    const definition = getSettingDefinition(entry.key)
    if (definition && entry.value === definition.default) {
      return prisma.systemSetting.deleteMany({ where: { key: entry.key } })
    }
    return prisma.systemSetting.upsert({
      where: { key: entry.key },
      create: { key: entry.key, value: entry.value as any, category: entry.category, updatedBy },
      update: { value: entry.value as any, category: entry.category, updatedBy },
    })
  }))

  invalidateSettingsCache()
  return { ok: true, errors: [], values: await getSettings() }
}

/** Reset specific keys (or all) back to their registry defaults. */
export async function resetSettings(keys?: string[]) {
  if (keys?.length) {
    const known = keys.filter(key => getSettingDefinition(key))
    await prisma.systemSetting.deleteMany({ where: { key: { in: known } } })
  } else {
    await prisma.systemSetting.deleteMany({
      where: { key: { in: listSettingDefinitions().map(setting => setting.key) } },
    })
  }
  invalidateSettingsCache()
  return getSettings()
}

/**
 * Registry metadata joined with current values, for the admin UI. `isOverridden`
 * distinguishes an explicit admin choice from a value that merely happens to equal
 * the default.
 */
export async function getSettingsForAdmin() {
  const [values, rows] = await Promise.all([
    getSettings(),
    prisma.systemSetting.findMany({ select: { key: true, updatedAt: true, updatedBy: true } }),
  ])
  const overrides = new Map(rows.map(row => [row.key, row]))

  return listSettingDefinitions().map(definition => ({
    ...definition,
    value: values[definition.key],
    isOverridden: overrides.has(definition.key),
    updatedAt: overrides.get(definition.key)?.updatedAt || null,
    updatedBy: overrides.get(definition.key)?.updatedBy || null,
  }))
}

/**
 * Settings with a caller-supplied override layered on top, without touching the
 * database or the shared cache. The calibration harness uses this to run retrieval
 * under a candidate config while live traffic keeps the persisted one.
 */
export async function getSettingsWithOverride(override: Record<string, unknown> = {}): Promise<SettingsSnapshot> {
  const base = await getSettings()
  const values: SettingsSnapshot = { ...base }
  for (const [key, raw] of Object.entries(override)) {
    const coerced = coerceSettingValue(key, raw)
    if (coerced.ok && coerced.value !== undefined) values[key] = coerced.value
  }
  return values
}
