/**
 * Firm Profile Service (server-only)
 *
 * Tenant-scoped firm identity + white-label branding used to co-brand novelty reports
 * (and, later, filing documents). One profile per tenant.
 *
 * IMPORTANT: every prisma.firmProfile.* call is wrapped in try/catch and degrades to
 * "no firm" so report/PDF generation never crashes if the Prisma client has not yet been
 * regenerated on a target environment (prod deploy does not run `prisma generate`).
 */

import { prisma } from './prisma'
import type { FirmBranding } from './novelty-attorney-report'

const FIRM_PROFILE_WRITE_ROLES = ['OWNER', 'ADMIN']

// Minimal actor context (roles as plain strings) so callers can pass the JWT payload's
// string[] roles without an enum cast.
export interface FirmActorContext {
  userId: string
  tenantId: string
  roles: string[]
  email?: string
}

// The subset of columns the report renderers need. `select`ing explicitly keeps large or
// irrelevant columns out and makes the mapping obvious.
const FIRM_BRANDING_SELECT = {
  firmName: true,
  logoDataUri: true,
  tagline: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  countryCode: true,
  postalCode: true,
  phone: true,
  email: true,
  website: true,
  accentColor: true,
  showPoweredBy: true,
} as const

/**
 * Load a tenant's firm branding for embedding into a report. Returns null when there is no
 * profile, no firm name, or the model is unavailable. Never throws.
 */
export async function loadFirmBranding(tenantId: string | null | undefined): Promise<FirmBranding | null> {
  if (!tenantId) return null
  try {
    const record = await prisma.firmProfile.findUnique({
      where: { tenantId },
      select: FIRM_BRANDING_SELECT,
    })
    if (!record || !record.firmName) return null
    return { ...record }
  } catch (error) {
    console.warn('[FirmProfile] loadFirmBranding failed; rendering default branding.', error)
    return null
  }
}

/**
 * Full firm profile record for the tenant-admin form. Never throws.
 */
export async function getFirmProfile(tenantId: string) {
  try {
    return await prisma.firmProfile.findUnique({ where: { tenantId } })
  } catch (error) {
    console.warn('[FirmProfile] getFirmProfile failed.', error)
    return null
  }
}

export interface FirmProfileInput {
  firmName: string
  logoDataUri?: string | null
  tagline?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  state?: string | null
  countryCode?: string | null
  postalCode?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  accentColor?: string | null
  showPoweredBy?: boolean
}

/**
 * Create or update the tenant's firm profile. Gated to OWNER/ADMIN. Writes an audit row.
 */
export async function upsertFirmProfile(
  actorContext: FirmActorContext,
  data: FirmProfileInput
): Promise<{ success: boolean; profile?: any; error?: string }> {
  if (!actorContext.roles?.some(role => FIRM_PROFILE_WRITE_ROLES.includes(role))) {
    return { success: false, error: 'Insufficient permissions to edit the firm profile' }
  }

  const tenantId = actorContext.tenantId
  if (!tenantId) {
    return { success: false, error: 'No tenant associated with user' }
  }

  // Normalize empty strings to null so optional fields clear cleanly.
  const normalized = {
    firmName: data.firmName.trim(),
    logoDataUri: emptyToNull(data.logoDataUri),
    tagline: emptyToNull(data.tagline),
    addressLine1: emptyToNull(data.addressLine1),
    addressLine2: emptyToNull(data.addressLine2),
    city: emptyToNull(data.city),
    state: emptyToNull(data.state),
    countryCode: emptyToNull(data.countryCode)?.toUpperCase() ?? null,
    postalCode: emptyToNull(data.postalCode),
    phone: emptyToNull(data.phone),
    email: emptyToNull(data.email),
    website: emptyToNull(data.website),
    accentColor: emptyToNull(data.accentColor),
    showPoweredBy: data.showPoweredBy ?? true,
  }

  try {
    const profile = await prisma.firmProfile.upsert({
      where: { tenantId },
      create: { tenantId, ...normalized },
      update: normalized,
    })

    await prisma.auditLog.create({
      data: {
        actorUserId: actorContext.userId,
        tenantId,
        action: 'FIRM_PROFILE_UPDATE',
        resource: `firmProfile:${tenantId}`,
        meta: {
          firmName: normalized.firmName,
          hasLogo: Boolean(normalized.logoDataUri),
          accentColor: normalized.accentColor,
          showPoweredBy: normalized.showPoweredBy,
        },
      },
    }).catch(err => console.warn('[FirmProfile] audit log failed (non-fatal).', err))

    return { success: true, profile }
  } catch (error) {
    console.error('[FirmProfile] upsertFirmProfile failed.', error)
    return { success: false, error: 'Failed to save the firm profile' }
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}
