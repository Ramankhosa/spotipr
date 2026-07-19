import { prisma } from '@/lib/prisma'
import { listPatentSearchProviders } from '@/lib/patent-search/provider-registry'
import type { PatentSearchProviderId } from '@/lib/patent-search/types'

// Super-admin control over which patent search providers may be dispatched.
//
// A provider has two independent gates:
//   - the code-level `enabled` flag (credentials present, implementation ready)
//   - this table, which lets an admin turn a working provider off without a deploy
//
// `allowAsFallback` is separate from `enabled` because the fallback lane is the one
// that costs money: an admin may want a provider available for explicit selection
// while keeping it out of the automatic path that fires on an empty corpus result.

const CACHE_TTL_MS = Math.max(
  1000,
  Number(process.env.SETTINGS_CACHE_TTL_MS || '30000') || 30_000
)

export interface ProviderAccessRecord {
  providerId: string
  enabled: boolean
  allowAsFallback: boolean
  notes?: string | null
}

let cache: { records: Map<string, ProviderAccessRecord>; expiresAt: number } | null = null
let inFlight: Promise<Map<string, ProviderAccessRecord>> | null = null

async function loadAccess(): Promise<Map<string, ProviderAccessRecord>> {
  try {
    const rows = await prisma.patentProviderAccess.findMany()
    return new Map(rows.map((row: ProviderAccessRecord) => [row.providerId, {
      providerId: row.providerId,
      enabled: row.enabled,
      allowAsFallback: row.allowAsFallback,
      notes: row.notes,
    }]))
  } catch (error) {
    // An access-table outage must not silently disable every provider, which would
    // turn every search into a zero-result search. Fail open to the code defaults.
    console.warn('[ProviderAccess] Failed to load overrides; using code defaults.',
      error instanceof Error ? error.message : error)
    return new Map()
  }
}

async function getAccessMap() {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.records
  if (inFlight) return inFlight

  inFlight = loadAccess()
    .then(records => {
      cache = { records, expiresAt: Date.now() + CACHE_TTL_MS }
      return records
    })
    .finally(() => { inFlight = null })

  return inFlight
}

export function invalidateProviderAccessCache() {
  cache = null
}

export interface ProviderAccessGates {
  /** Providers an admin has switched off entirely. */
  disabled: Set<PatentSearchProviderId>
  /** Providers barred specifically from the automatic fallback lane. */
  fallbackBlocked: Set<PatentSearchProviderId>
}

/** Admin gates for the orchestrator to apply before dispatch. */
export async function getProviderAccessGates(): Promise<ProviderAccessGates> {
  const records = await getAccessMap()
  const disabled = new Set<PatentSearchProviderId>()
  const fallbackBlocked = new Set<PatentSearchProviderId>()

  // Array.from rather than iterating the Map directly: this project's tsconfig
  // target predates downlevel iteration over Map iterators.
  for (const record of Array.from(records.values())) {
    const providerId = record.providerId as PatentSearchProviderId
    if (!record.enabled) {
      disabled.add(providerId)
      fallbackBlocked.add(providerId)
      continue
    }
    if (!record.allowAsFallback) fallbackBlocked.add(providerId)
  }

  return { disabled, fallbackBlocked }
}

/**
 * Registered providers joined with their admin overrides, for the admin UI.
 * `effectiveEnabled` folds both gates together so the UI can show what will
 * actually happen rather than making the reader combine two flags.
 */
export async function getProviderAccessForAdmin() {
  const records = await getAccessMap()
  return listPatentSearchProviders().map(provider => {
    const override = records.get(provider.id)
    const adminEnabled = override?.enabled ?? true
    return {
      providerId: provider.id,
      label: provider.label,
      jurisdictions: provider.jurisdictions,
      capabilities: provider.capabilities,
      /** Whether the provider is implemented and has credentials. */
      codeEnabled: provider.enabled,
      adminEnabled,
      allowAsFallback: override?.allowAsFallback ?? true,
      effectiveEnabled: provider.enabled && adminEnabled,
      isOverridden: Boolean(override),
      notes: override?.notes || null,
    }
  })
}

export async function updateProviderAccess(
  updates: Array<{ providerId: string; enabled?: boolean; allowAsFallback?: boolean; notes?: string | null }>,
  updatedBy?: string
) {
  const known = new Set(listPatentSearchProviders().map(provider => String(provider.id)))
  const errors: string[] = []
  const valid = updates.filter(update => {
    if (!known.has(update.providerId)) {
      errors.push(`Unknown provider "${update.providerId}".`)
      return false
    }
    return true
  })
  if (errors.length) return { ok: false, errors }

  await prisma.$transaction(valid.map(update => prisma.patentProviderAccess.upsert({
    where: { providerId: update.providerId },
    create: {
      providerId: update.providerId,
      enabled: update.enabled ?? true,
      allowAsFallback: update.allowAsFallback ?? true,
      notes: update.notes ?? null,
      updatedBy,
    },
    update: {
      ...(update.enabled !== undefined ? { enabled: update.enabled } : {}),
      ...(update.allowAsFallback !== undefined ? { allowAsFallback: update.allowAsFallback } : {}),
      ...(update.notes !== undefined ? { notes: update.notes } : {}),
      updatedBy,
    },
  })))

  invalidateProviderAccessCache()
  return { ok: true, errors: [] }
}
