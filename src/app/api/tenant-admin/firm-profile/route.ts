/**
 * Tenant Admin - Firm Profile API
 *
 * GET  - Read the tenant's firm profile. Open to any tenant member (analysts generate
 *        reports and need the branding); returns null when unset.
 * PUT  - Create/update the firm profile. Gated to OWNER/ADMIN.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, requireTenantRole } from '@/lib/middleware'
import { getFirmProfile, upsertFirmProfile } from '@/lib/firm-profile-service'

export const dynamic = 'force-dynamic'

const MAX_LOGO_BYTES = 500 * 1024 // 500KB

// Treat blank strings from the form as "not provided" so optional validators don't fire.
const emptyToUndef = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

export function isValidLogoDataUri(value?: string): boolean {
  if (!value) return true
  const match = value.match(/^data:image\/(png|jpe?g);base64,(.+)$/i)
  if (!match) return false // SVG and other formats are rejected (PDFKit can't render them)
  try {
    const bytes = Buffer.from(match[2], 'base64')
    return bytes.length > 0 && bytes.length <= MAX_LOGO_BYTES
  } catch {
    return false
  }
}

export const firmProfileSchema = z.object({
  firmName: z.string().min(2, 'Firm name must be at least 2 characters').max(200, 'Firm name too long'),
  logoDataUri: z.preprocess(
    emptyToUndef,
    z.string().refine(isValidLogoDataUri, 'Logo must be a PNG or JPEG data URI under 500KB').optional()
  ),
  tagline: z.preprocess(emptyToUndef, z.string().max(200).optional()),
  addressLine1: z.preprocess(emptyToUndef, z.string().max(200).optional()),
  addressLine2: z.preprocess(emptyToUndef, z.string().max(200).optional()),
  city: z.preprocess(emptyToUndef, z.string().max(120).optional()),
  state: z.preprocess(emptyToUndef, z.string().max(120).optional()),
  countryCode: z.preprocess(emptyToUndef, z.string().length(2, 'Country code must be 2 characters (ISO-2)').optional()),
  postalCode: z.preprocess(emptyToUndef, z.string().max(20).optional()),
  phone: z.preprocess(emptyToUndef, z.string().regex(/^\+[1-9]\d{1,14}$/, 'Phone must be in E.164 format (+country code)').optional()),
  email: z.preprocess(emptyToUndef, z.string().email('Invalid email format').optional()),
  website: z.preprocess(emptyToUndef, z.string().url('Invalid website URL').optional()),
  accentColor: z.preprocess(emptyToUndef, z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Accent color must be a #RRGGBB hex value').optional()),
  showPoweredBy: z.boolean().optional().default(true),
})

/**
 * GET /api/tenant-admin/firm-profile
 */
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticateRequest(request)
    if (error) return error

    if (!user!.tenant_id) {
      return NextResponse.json({ error: 'No tenant associated with user' }, { status: 400 })
    }
    if (user!.tenant_ati_id === 'PLATFORM') {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'Platform scope users cannot access tenant-specific endpoints' },
        { status: 403 }
      )
    }

    const profile = await getFirmProfile(user!.tenant_id)
    const canEdit = (user!.roles || []).some(role => ['OWNER', 'ADMIN'].includes(role))
    return NextResponse.json({ profile, canEdit })
  } catch (err) {
    console.error('[FirmProfile] GET error:', err)
    return NextResponse.json({ error: 'Failed to load firm profile' }, { status: 500 })
  }
}

/**
 * PUT /api/tenant-admin/firm-profile
 */
export async function PUT(request: NextRequest) {
  try {
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck

    const { user, error } = await authenticateRequest(request)
    if (error) return error
    const tenantId = user!.tenant_id
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant associated with user' }, { status: 400 })
    }

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const parsed = firmProfileSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const result = await upsertFirmProfile(
      {
        userId: user!.sub,
        tenantId,
        roles: user!.roles || [],
        email: user!.email,
      },
      parsed.data
    )

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ profile: result.profile })
  } catch (err) {
    console.error('[FirmProfile] PUT error:', err)
    return NextResponse.json({ error: 'Failed to save firm profile' }, { status: 500 })
  }
}
