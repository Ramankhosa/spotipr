/**
 * POST /api/super-admin/access-requests/[id]/decision
 *
 * The one place a trial request is actually decided.
 *
 *   { action: 'approve', trialDays, inviteExpiryDays, note, sendEmail }
 *   { action: 'decline', reason, sendEmail }
 *
 * Approve mints an email-locked TrialInvite in the "Inbound Trial Requests"
 * campaign and returns the activation link, so the admin can still deliver it by
 * hand if the mail fails.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { approveTrial, declineTrial } from '@/lib/access-requests/service'
import { requireAdmin } from '@/lib/access-requests/auth'
import { FIELD_LIMITS } from '@/lib/access-requests/constants'

export const dynamic = 'force-dynamic'

const decisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    trialDays: z.number().int().min(1).max(365).optional(),
    inviteExpiryDays: z.number().int().min(1).max(365).optional(),
    campaignId: z.string().optional(),
    note: z.string().max(FIELD_LIMITS.decisionReason).optional(),
    sendEmail: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('decline'),
    reason: z.string().max(FIELD_LIMITS.decisionReason).optional(),
    sendEmail: z.boolean().optional(),
  }),
])

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 })
  }
  if (!admin.canWrite) {
    return NextResponse.json({ error: 'Read-only access' }, { status: 403 })
  }

  try {
    const parsed = decisionSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const actor = { userId: admin.userId, email: admin.email }

    const result =
      parsed.data.action === 'approve'
        ? await approveTrial(params.id, parsed.data, actor)
        : await declineTrial(params.id, parsed.data, actor)

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[AccessRequest] Decision failed:', error)
    return NextResponse.json({ error: 'Failed to record the decision' }, { status: 500 })
  }
}
