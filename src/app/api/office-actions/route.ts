import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { createCase } from '@/lib/office-action/oa-case-service'
import { prisma } from '@/lib/prisma'

export const maxDuration = 60

// GET /api/office-actions — list the caller's cases
export async function GET(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })

  const cases = await prisma.officeActionCase.findMany({
    where: { userId: auth.user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, jurisdictionCode: true, applicationNumber: true, title: true,
      applicantName: true, status: true, createdAt: true, updatedAt: true,
      _count: { select: { documents: true } }
    }
  })
  return NextResponse.json({ cases })
}

// POST /api/office-actions — create a new office-action / FER case
export async function POST(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })

  if (auth.user.tenantId) {
    const access = await enforceServiceAccess(auth.user.id, auth.user.tenantId, 'OFFICE_ACTION_RESPONSE')
    if (!access.allowed) return access.response
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const jurisdictionCode = String(body.jurisdictionCode || '').trim()
  const applicationNumber = String(body.applicationNumber || '').trim()
  if (!jurisdictionCode || !applicationNumber) {
    return NextResponse.json({ error: 'jurisdictionCode and applicationNumber are required' }, { status: 400 })
  }

  try {
    const created = await createCase(
      { userId: auth.user.id, tenantId: auth.user.tenantId },
      {
        jurisdictionCode,
        applicationNumber,
        applicantName: body.applicantName,
        title: body.title,
        patentId: body.patentId,
        specificationText: body.specificationText,
        claimsText: body.claimsText
      }
    )
    return NextResponse.json({ case: created }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create case'
    const status = message.includes('No active office-action profile') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
