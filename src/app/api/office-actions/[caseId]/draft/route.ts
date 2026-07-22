import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

/**
 * PATCH /api/office-actions/:caseId/draft
 * Attorney edits over the latest reply draft: approve/un-approve an objection
 * reply, edit its text, edit a named section, tick the forms checklist, or
 * control the amended claims going into the filing. Edits re-open approval
 * (an edited section must be re-approved before export).
 *
 * Body: {
 *   objectionReplies?: Array<{ objectionId: string; bodyText?: string; approved?: boolean }>
 *   namedSections?: Record<string, string>
 *   formsStatus?: Record<string, boolean>
 *   amendedClaims?: Array<{ claimNumber: number; remove?: boolean; markedText?: string; cleanText?: string; basisRefs?: string[] }>
 *   agent?: { name?: string; regNo?: string }
 * }
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

  const draft = await prisma.oaResponseDraft.findFirst({
    where: { caseId: params.caseId }, orderBy: { version: 'desc' }
  })
  if (!draft) return NextResponse.json({ error: 'No reply draft yet — prepare the reply first' }, { status: 409 })

  const sections = (draft.sectionsJson as any) || {}
  const replies: any[] = Array.isArray(sections.objectionReplies) ? sections.objectionReplies : []

  if (Array.isArray(body.objectionReplies)) {
    for (const edit of body.objectionReplies) {
      const target = replies.find(r => r.objectionId === edit.objectionId)
      if (!target) continue
      if (typeof edit.bodyText === 'string') {
        target.bodyText = edit.bodyText
        target.approved = false          // edits re-open approval
      }
      if (typeof edit.approved === 'boolean') target.approved = edit.approved
    }
  }

  const namedSections = { ...(sections.namedSections || {}) }
  if (body.namedSections && typeof body.namedSections === 'object') {
    for (const [k, v] of Object.entries(body.namedSections)) {
      if (typeof v === 'string') namedSections[k] = v
    }
  }

  const compliance = { ...((draft.complianceJson as any) || {}) }
  if (body.formsStatus && typeof body.formsStatus === 'object') {
    compliance.formsStatus = { ...(compliance.formsStatus || {}), ...body.formsStatus }
  }
  if (body.agent && typeof body.agent === 'object') {
    compliance.agent = {
      ...(compliance.agent || {}),
      ...(typeof body.agent.name === 'string' ? { name: body.agent.name } : {}),
      ...(typeof body.agent.regNo === 'string' ? { regNo: body.agent.regNo } : {})
    }
  }

  // Amended-claims control: the attorney decides what goes into the filing —
  // remove a proposed amendment, edit its text, or add their own.
  const amended = { ...((draft.amendedClaimsJson as any) || {}) }
  let claims: any[] = Array.isArray(amended.claims) ? [...amended.claims] : []
  if (Array.isArray(body.amendedClaims)) {
    for (const edit of body.amendedClaims) {
      const n = Number(edit?.claimNumber)
      if (!n) continue
      if (edit.remove === true) {
        claims = claims.filter(c => c.claimNumber !== n)
        continue
      }
      const existing = claims.find(c => c.claimNumber === n)
      const target = existing || { claimNumber: n, markedText: '', cleanText: '', basisRefs: [] }
      if (typeof edit.markedText === 'string') target.markedText = edit.markedText
      if (typeof edit.cleanText === 'string') target.cleanText = edit.cleanText
      if (Array.isArray(edit.basisRefs)) target.basisRefs = edit.basisRefs.map(String)
      if (!existing) claims.push(target)
    }
    claims.sort((a, b) => a.claimNumber - b.claimNumber)
  }

  const updated = await prisma.oaResponseDraft.update({
    where: { id: draft.id },
    data: {
      sectionsJson: { ...sections, objectionReplies: replies, namedSections } as any,
      amendedClaimsJson: { ...amended, claims } as any,
      complianceJson: compliance as any
    }
  })

  // Mirror approval onto the objection rows (drives the rail's status chips).
  if (Array.isArray(body.objectionReplies)) {
    for (const edit of body.objectionReplies) {
      if (typeof edit.approved !== 'boolean' && typeof edit.bodyText !== 'string') continue
      const reply = replies.find(r => r.objectionId === edit.objectionId)
      if (!reply) continue
      await prisma.oaObjection.updateMany({
        where: { id: edit.objectionId, document: { caseId: params.caseId } },
        data: { status: reply.approved ? 'APPROVED' : 'DRAFTED' }
      }).catch(() => {})
    }
  }

  return NextResponse.json({
    draftId: updated.id,
    version: updated.version,
    approved: replies.filter(r => r.approved).length,
    total: replies.length
  })
}
