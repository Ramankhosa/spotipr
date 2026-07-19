import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { prisma } from '@/lib/prisma'
import { prepareReply } from '@/lib/office-action/reply-pipeline'

// Chains chart → strategy → draft for every objection; LLM-heavy.
export const maxDuration = 300

/**
 * POST /api/office-actions/:caseId/prepare
 * Runs the reply pipeline and persists an OaResponseDraft ready for export.
 * Body (optional): { objectionIds?: string[] } to prepare a subset.
 */
export async function POST(request: NextRequest, { params }: { params: { caseId: string } }) {
  const auth = await authenticateUser(request)
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })

  const owner = await prisma.officeActionCase.findUnique({
    where: { id: params.caseId }, select: { userId: true }
  })
  if (!owner) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  if (owner.userId !== auth.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (auth.user.tenantId) {
    const access = await enforceServiceAccess(auth.user.id, auth.user.tenantId, 'OFFICE_ACTION_RESPONSE')
    if (!access.allowed) return access.response
  }

  let body: any = {}
  try { body = await request.json() } catch { /* optional */ }

  const requestHeaders: Record<string, string> = {}
  const authHeader = request.headers.get('authorization')
  if (authHeader) requestHeaders.authorization = authHeader

  try {
    const result = await prepareReply(params.caseId, {
      tenantId: auth.user.tenantId, userId: auth.user.id, requestHeaders,
      objectionIds: Array.isArray(body.objectionIds) ? body.objectionIds : undefined
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Prepare failed' }, { status: 500 })
  }
}
