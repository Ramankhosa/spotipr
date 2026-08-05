import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceOfficeActionAccess } from '@/lib/office-action/route-guards'
import { createCase, OaProfileUnavailableError } from '@/lib/office-action/oa-case-service'
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

  const access = await enforceOfficeActionAccess(auth.user)
  if (!access.allowed) return access.response

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
  // An application number ends up in the reply letter, the subject line and the
  // export's Content-Disposition filename. A quote or CR/LF there made the export
  // throw while constructing the response — AFTER the case had been flipped to
  // REPLIED and the quota unit recorded, with no route to correct it afterwards.
  if (applicationNumber.length > 64 || /[\r\n"\\]/.test(applicationNumber)) {
    return NextResponse.json({
      error: 'applicationNumber must be at most 64 characters and cannot contain quotes, backslashes or line breaks.'
    }, { status: 400 })
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
    // A missing/invalid jurisdiction profile is a deployment gap, not bad input —
    // 503 so it is not mistaken for a validation failure, with the fix in the body.
    if (err instanceof OaProfileUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    // Anything else is internal: Prisma constraint text, gateway internals,
    // tenant-resolution detail. Log it, return a generic message.
    console.error('[OA cases] create failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not create the case. Please try again.' }, { status: 500 })
  }
}
