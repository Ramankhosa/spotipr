/**
 * Tenant Admin - Firm Profile API
 *
 * GET  - Read the tenant's firm profile. Open to any tenant member (analysts generate
 *        reports and need the branding); returns null when unset.
 * PUT  - Create/update the firm profile. Gated to OWNER/ADMIN.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, requireTenantRole } from '@/lib/middleware'
import { getFirmProfile, upsertFirmProfile } from '@/lib/firm-profile-service'
import { firmProfileSchema } from '@/lib/firm-profile-schema'

export const dynamic = 'force-dynamic'

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
