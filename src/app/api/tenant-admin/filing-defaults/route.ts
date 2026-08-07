/**
 * Tenant Admin — firm filing defaults (the top layer of the cascade).
 *
 * GET  - the firm's presets. Open to any tenant member: attorneys need to see which house
 *        style their filings inherit, even when they cannot change it.
 * PUT  - create/update a preset. Gated to OWNER/ADMIN, same as the firm profile.
 *
 * A firm serving mixed client types keeps several named presets, because real firms
 * differentiate by client AND filing type rather than by applicant category alone.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, requireTenantRole } from '@/lib/middleware'
import { DECLARATION_CLAUSES } from '@/lib/filing/declarations'
import { BASELINE_SETTINGS } from '@/lib/filing/settings-resolver'

export const dynamic = 'force-dynamic'

const CLAUSE_KEYS = DECLARATION_CLAUSES.map(c => c.key) as [string, ...string[]]

const settingsPatchSchema = z.object({
  emptyFieldStyle: z.enum(['dash', 'na', 'blank']).optional(),
  notApplicableStyle: z.enum(['dash', 'na', 'blank', 'strike']).optional(),
  inapplicableClauseStyle: z.enum(['cross', 'strike']).optional(),
  dateStyle: z.enum(['blankDay', 'fullDate']).optional(),
  officeBranch: z.string().min(1).max(60).optional(),
  titleCase: z.enum(['preserve', 'title', 'upper']).optional(),
  nameCase: z.enum(['preserve', 'title', 'upper']).optional(),
  addressLineTerminalPeriod: z.boolean().optional(),
  declarations: z.record(z.enum(CLAUSE_KEYS), z.enum(['tick', 'cross', 'strike'])).optional(),
  includeDocs: z.object({
    form1: z.boolean().optional(),
    form5: z.boolean().optional(),
    drawings: z.boolean().optional(),
  }).optional(),
}).strict()

const presetSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Preset name is required').max(80),
  isDefault: z.boolean().optional(),
  appliesTo: z.object({
    applicantCategory: z.array(z.string()).optional(),
    applicationType: z.array(z.string()).optional(),
  }).nullable().optional(),
  settings: settingsPatchSchema,
})

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticateRequest(request)
    if (error) return error

    const tenantId = user!.tenant_id
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant associated with user' }, { status: 400 })
    }
    if (user!.tenant_ati_id === 'PLATFORM') {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'Platform scope users cannot access tenant-specific endpoints' },
        { status: 403 }
      )
    }

    const presets = await prisma.firmFilingPreset.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    }).catch(err => {
      console.warn('[FilingDefaults] read failed; returning none.', err)
      return []
    })

    const canEdit = (user!.roles || []).some(role => ['OWNER', 'ADMIN'].includes(role))
    return NextResponse.json({
      presets,
      canEdit,
      // What a preset falls back to for any key it does not pin.
      baseline: BASELINE_SETTINGS,
      clauses: DECLARATION_CLAUSES.map(c => ({ key: c.key, label: c.label })),
    })
  } catch (err) {
    console.error('[FilingDefaults] GET error:', err)
    return NextResponse.json({ error: 'Failed to load filing defaults' }, { status: 500 })
  }
}

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
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const parsed = presetSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { id, name, isDefault, appliesTo, settings } = parsed.data

    const preset = await prisma.$transaction(async (tx) => {
      // Exactly one default per tenant, or the cascade's top layer would be ambiguous.
      if (isDefault) {
        await tx.firmFilingPreset.updateMany({
          where: { tenantId, ...(id ? { id: { not: id } } : {}) },
          data: { isDefault: false },
        })
      }

      if (id) {
        return tx.firmFilingPreset.update({
          where: { id },
          data: { name, isDefault: isDefault ?? false, appliesTo: appliesTo ?? undefined, settings },
        })
      }

      return tx.firmFilingPreset.upsert({
        where: { tenantId_name: { tenantId, name } },
        create: { tenantId, name, isDefault: isDefault ?? false, appliesTo: appliesTo ?? undefined, settings },
        update: { isDefault: isDefault ?? false, appliesTo: appliesTo ?? undefined, settings },
      })
    })

    await prisma.auditLog.create({
      data: {
        actorUserId: user!.sub,
        tenantId,
        action: 'FIRM_FILING_DEFAULTS_UPDATE',
        resource: `firmFilingPreset:${preset.id}`,
        meta: { name: preset.name, isDefault: preset.isDefault },
      },
    }).catch(err => console.warn('[FilingDefaults] audit log failed (non-fatal).', err))

    return NextResponse.json({ preset })
  } catch (err) {
    console.error('[FilingDefaults] PUT error:', err)
    return NextResponse.json({ error: 'Failed to save filing defaults' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck

    const { user, error } = await authenticateRequest(request)
    if (error) return error
    const tenantId = user!.tenant_id
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant associated with user' }, { status: 400 })
    }

    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Preset id is required' }, { status: 400 })

    // Scope the delete to the tenant so an id from another tenant cannot be removed.
    const result = await prisma.firmFilingPreset.deleteMany({ where: { id, tenantId } })
    if (!result.count) return NextResponse.json({ error: 'Preset not found' }, { status: 404 })

    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error('[FilingDefaults] DELETE error:', err)
    return NextResponse.json({ error: 'Failed to delete the preset' }, { status: 500 })
  }
}
