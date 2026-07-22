import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { CANONICAL_OBJECTION_CODES } from '@/lib/office-action/oa-profile-schema'

/**
 * PATCH /api/office-actions/:caseId/objections
 * Attorney control over an objection card:
 *   { objectionId, dismiss: true }   — exclude it from the reply (misparse,
 *                                      duplicate, or handled elsewhere); the
 *                                      coverage lint stops requiring it.
 *   { objectionId, dismiss: false }  — restore it.
 *   { objectionId, canonicalCode }   — re-categorize (e.g. an unclassified
 *                                      OTHER card after a degraded intake).
 */
export async function PATCH(request: NextRequest, { params }: { params: { caseId: string } }) {
  const auth = await authenticateUser(request)
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })

  const owner = await prisma.officeActionCase.findUnique({
    where: { id: params.caseId }, select: { userId: true }
  })
  if (!owner) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  if (owner.userId !== auth.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const objectionId = String(body.objectionId || '')
  if (!objectionId) return NextResponse.json({ error: 'objectionId is required' }, { status: 400 })

  const objection = await prisma.oaObjection.findFirst({
    where: { id: objectionId, document: { caseId: params.caseId } }
  })
  if (!objection) return NextResponse.json({ error: 'Objection not found on this case' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (typeof body.dismiss === 'boolean') {
    // Restoring returns the card to its pre-dismissal life-cycle state.
    data.status = body.dismiss ? 'DISMISSED' : (objection.strategyJson ? 'STRATEGY_CHOSEN' : 'EXTRACTED')
  }
  if (typeof body.canonicalCode === 'string') {
    if (!(CANONICAL_OBJECTION_CODES as readonly string[]).includes(body.canonicalCode)) {
      return NextResponse.json({ error: `canonicalCode must be one of ${CANONICAL_OBJECTION_CODES.join(', ')}` }, { status: 400 })
    }
    data.canonicalCode = body.canonicalCode
  }
  if (!Object.keys(data).length) {
    return NextResponse.json({ error: 'Nothing to update — pass dismiss and/or canonicalCode' }, { status: 400 })
  }

  const updated = await prisma.oaObjection.update({ where: { id: objection.id }, data: data as any })
  return NextResponse.json({ objection: { id: updated.id, status: updated.status, canonicalCode: updated.canonicalCode } })
}
