/**
 * GET   /api/super-admin/access-requests/[id]  Full detail + event trail
 * PATCH /api/super-admin/access-requests/[id]  Triage: status, notes, assignment
 *
 * APPROVED / REJECTED are deliberately NOT settable here — a trial decision has
 * side effects (invite, email), so it goes through /decision.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRequestDetail, triageRequest } from '@/lib/access-requests/service'
import { requireAdmin } from '@/lib/access-requests/auth'
import { ALL_STATUSES, FIELD_LIMITS } from '@/lib/access-requests/constants'

export const dynamic = 'force-dynamic'

const triageSchema = z.object({
  status: z.enum(ALL_STATUSES as [string, ...string[]]).optional(),
  internalNotes: z.string().max(FIELD_LIMITS.internalNotes).optional(),
  assignToSelf: z.boolean().optional(),
  unassign: z.boolean().optional(),
  note: z.string().max(2000).optional(),
})

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 })
  }

  try {
    const detail = await getRequestDetail(params.id)
    if (!detail) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

    return NextResponse.json({ ...detail, canWrite: admin.canWrite })
  } catch (error) {
    console.error('[AccessRequest] Detail failed:', error)
    return NextResponse.json({ error: 'Failed to load request' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 })
  }
  if (!admin.canWrite) {
    return NextResponse.json({ error: 'Read-only access' }, { status: 403 })
  }

  try {
    const parsed = triageSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const result = await triageRequest(params.id, parsed.data as never, {
      userId: admin.userId,
      email: admin.email,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ success: true, request: result.request })
  } catch (error) {
    console.error('[AccessRequest] Triage failed:', error)
    return NextResponse.json({ error: 'Failed to update request' }, { status: 500 })
  }
}
