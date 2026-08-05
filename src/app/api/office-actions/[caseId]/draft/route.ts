import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceOfficeActionAccess } from '@/lib/office-action/route-guards'
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
  /**
   * Refuse edits while a prepare run owns this draft.
   *
   * The pipeline holds its own in-memory copy of the section array from the
   * moment the run starts and rewrites the whole JSON after every objection. An
   * edit or approval landing mid-run was therefore silently discarded by the next
   * persist — the attorney watched their approval disappear with no error. Say so
   * instead of accepting a write that is about to be thrown away.
   */
  if (sections.inProgress === true) {
    return NextResponse.json({
      error: 'This reply is still being prepared. Pause the run (or wait for it to finish) before editing — an edit made now would be overwritten by the run.',
      code: 'DRAFT_IN_PROGRESS'
    }, { status: 409 })
  }
  const replies: any[] = Array.isArray(sections.objectionReplies) ? sections.objectionReplies : []

  if (Array.isArray(body.objectionReplies)) {
    for (const edit of body.objectionReplies) {
      const target = replies.find(r => r.objectionId === edit.objectionId)
      if (!target) continue

      if (typeof edit.bodyText === 'string') {
        // A procedural section's text is system-owned: it is generated from the
        // confirmed compliance type and asserts a completed act. Letting it be
        // hand-edited would leave a confirmation attached to a materially
        // different assertion.
        if (target.attorneyAction) {
          return NextResponse.json({
            error: 'This section states a statutory compliance and is written by the system from what you confirm. Change the confirmation instead of the wording.'
          }, { status: 400 })
        }
        target.bodyText = edit.bodyText
        target.approved = false          // edits re-open approval
      }

      // Procedural confirmation. confirmedBy/confirmedAt are assigned HERE, from
      // the authenticated session and server time — never taken from the request
      // body. An audit trail the client can populate attests nothing.
      if (edit.compliance && typeof edit.compliance === 'object' && target.attorneyAction) {
        const status = edit.compliance.status
        if (!['PENDING', 'CONFIRMED', 'NOT_APPLICABLE'].includes(status)) {
          return NextResponse.json({ error: 'Unknown compliance status' }, { status: 400 })
        }
        if (status === 'NOT_APPLICABLE' && !String(edit.compliance.notApplicableReason || '').trim()) {
          return NextResponse.json({ error: 'Say why this requirement does not apply.' }, { status: 400 })
        }

        let supportingDocumentIds: string[] = []
        if (Array.isArray(edit.compliance.supportingDocumentIds) && edit.compliance.supportingDocumentIds.length) {
          // Every attached document must exist and belong to THIS case.
          const ids = edit.compliance.supportingDocumentIds.map(String)
          const found = await prisma.oaCaseDocument.findMany({
            where: { id: { in: ids }, caseId: params.caseId }, select: { id: true }
          })
          if (found.length !== ids.length) {
            return NextResponse.json({ error: 'A supporting document was not found on this case.' }, { status: 400 })
          }
          supportingDocumentIds = found.map(d => d.id)
        }

        target.compliance = status === 'CONFIRMED'
          ? {
              status, confirmedBy: auth.user.id, confirmedAt: new Date().toISOString(),
              supportingDocumentIds,
              ...(edit.compliance.attorneyNote ? { attorneyNote: String(edit.compliance.attorneyNote) } : {})
            }
          : {
              status,
              ...(edit.compliance.notApplicableReason ? { notApplicableReason: String(edit.compliance.notApplicableReason) } : {})
            }

        // The filed sentence exists only while the act is confirmed. Withdrawing
        // the confirmation removes the assertion, it does not merely flag it.
        if (status === 'CONFIRMED') {
          const { complianceRuleFor } = await import('@/lib/office-action/procedural-reply')
          const { loadOfficeActionProfile } = await import('@/lib/office-action/oa-case-service')
          const oaCase = await prisma.officeActionCase.findUnique({
            where: { id: params.caseId }, select: { jurisdictionCode: true }
          })
          const profile = oaCase ? await loadOfficeActionProfile(oaCase.jurisdictionCode) : null
          const row = await prisma.oaObjection.findFirst({
            where: { id: edit.objectionId }, select: { canonicalCode: true, subTypeId: true }
          })
          if (profile && row) {
            // The attorney's word is the control here, deliberately.
            //
            // Filing a Form 3 happens on the office's portal — this system has
            // no visibility into it and never will, so requiring a copy here
            // would verify only that SOME file exists in our database, not that
            // the act occurred. That is ceremony, and it costs them time on a
            // deadline. We accept one click as approval for the substantive
            // legal arguments; demanding documentary proof for the clerical act
            // while trusting them on the law would be backwards.
            //
            // What IS enforced is that this sentence did not exist until they
            // said so. That was the defect; this is the control.
            const rule = complianceRuleFor(profile, row.canonicalCode, row.subTypeId)
            target.bodyText = rule.filingSentence
          }
        } else {
          target.bodyText = ''
          target.approved = false
        }
      }

      /**
       * Approval is applied only when this edit did not also change the text.
       *
       * Sending { bodyText, approved: true } in one call set approved=false for
       * the edit and then immediately back to true here — so replacement text
       * became export-eligible in a single request without anyone re-reading it,
       * defeating the "edits re-open approval" rule this route documents.
       * Approving is a separate act from editing, and now has to be a separate
       * call.
       */
      const alsoEditedText = typeof edit.bodyText === 'string'
      if (typeof edit.approved === 'boolean' && !alsoEditedText) target.approved = edit.approved
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

// A single redraft is one LLM call — long, but nothing like a full prepare run.
export const maxDuration = 300

/**
 * POST /api/office-actions/:caseId/draft
 * Redraft ONE objection's section with the attorney's direction as input.
 * Body: { objectionId: string, remarks: string }
 *
 * The attorney is reacting to specific words, so the model is given the current
 * section plus their instruction and asked to revise — same evidence, same
 * authorities, same doctrine as the original run. The redrafted section always
 * comes back unapproved: it has not been read yet.
 */
export async function POST(request: NextRequest, { params }: { params: { caseId: string } }) {
  const auth = await authenticateUser(request)
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })

  const oaCase = await prisma.officeActionCase.findUnique({ where: { id: params.caseId } })
  if (!oaCase) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  if (oaCase.userId !== auth.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const access = await enforceOfficeActionAccess(auth.user)
  if (!access.allowed) return access.response

  let body: any
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const objectionId = String(body.objectionId || '')
  const remarks = String(body.remarks || '').trim()
  if (!objectionId) return NextResponse.json({ error: 'objectionId is required' }, { status: 400 })
  if (!remarks) return NextResponse.json({ error: 'Tell the drafter what to change.' }, { status: 400 })

  const row = await prisma.oaObjection.findFirst({
    where: { id: objectionId, document: { caseId: params.caseId } }
  })
  if (!row) return NextResponse.json({ error: 'Objection not found on this case' }, { status: 404 })

  const draft = await prisma.oaResponseDraft.findFirst({
    where: { caseId: params.caseId }, orderBy: { version: 'desc' }
  })
  if (!draft) return NextResponse.json({ error: 'No reply draft yet — prepare the reply first' }, { status: 409 })
  if (((draft.sectionsJson as any) || {}).inProgress === true) {
    return NextResponse.json({
      error: 'This reply is still being prepared. Pause the run before redrafting a section — the run would overwrite it.',
      code: 'DRAFT_IN_PROGRESS'
    }, { status: 409 })
  }

  const { loadOfficeActionProfile } = await import('@/lib/office-action/oa-case-service')
  const profile = await loadOfficeActionProfile(oaCase.jurisdictionCode)
  if (!profile) return NextResponse.json({ error: `No office-action profile for ${oaCase.jurisdictionCode}` }, { status: 503 })

  const sections = (draft.sectionsJson as any) || {}
  const replies: any[] = Array.isArray(sections.objectionReplies) ? sections.objectionReplies : []
  const current = replies.find(r => r.objectionId === objectionId)

  // Forward the caller's own authorization so the metering gateway meters this
  // against the same tenant as every other stage.
  const requestHeaders: Record<string, string> = {}
  const authHeader = request.headers.get('authorization')
  if (authHeader) requestHeaders.authorization = authHeader

  const { draftObjectionReply } = await import('@/lib/office-action/response-drafter')
  const { digestFromSpotiprDraft } = await import('@/lib/office-action/invention-digest')

  const drafted = await draftObjectionReply(
    {
      profile,
      caseId: params.caseId,
      digest: (oaCase.inventionDigest as any) || digestFromSpotiprDraft({}),
      tenantId: auth.user.tenantId || undefined,
      userId: auth.user.id,
      requestHeaders
    } as any,
    {
      id: row.id, sortOrder: row.sortOrder, canonicalCode: row.canonicalCode as any,
      subTypeId: row.subTypeId || undefined, localBasis: row.localBasis || undefined,
      officeNumber: (row.analysisJson as any)?.officeNumber || undefined,
      examinerText: row.examinerText, quoteVerified: row.quoteVerified,
      claimsAffected: (row.claimsAffected as any) || [], citationLabels: (row.citationLabels as any) || []
    } as any,
    { remarks, previousText: current?.bodyText || undefined }
  )

  if (drafted.draftError || !(drafted.bodyText || '').trim()) {
    return NextResponse.json({ error: drafted.draftError || 'The redraft came back empty — try again.' }, { status: 502 })
  }

  // Keep the attorney's remark with the section: it is the record of why the
  // wording changed, and it pre-fills the box if they want to refine again.
  const next = { ...(current || {}), ...drafted, approved: false, attorneyRemarks: remarks }

  /**
   * Re-read the row before writing.
   *
   * The redraft is one LLM call and takes a while, and `sections` was read before
   * it. Writing that stale snapshot back would discard anything the attorney (or
   * another tab) changed on OTHER sections in the meantime. Merge into the
   * current row and touch only this objection's entry.
   */
  const fresh = await prisma.oaResponseDraft.findUnique({
    where: { id: draft.id }, select: { sectionsJson: true }
  })
  const freshSections = (fresh?.sectionsJson as any) || sections
  const freshReplies: any[] = Array.isArray(freshSections.objectionReplies) ? freshSections.objectionReplies : []
  const exists = freshReplies.some(r => r.objectionId === objectionId)
  const merged = exists
    ? freshReplies.map(r => r.objectionId === objectionId ? { ...r, ...next } : r)
    : [...freshReplies, next].sort((a, b) => a.sortOrder - b.sortOrder)

  await prisma.oaResponseDraft.update({
    where: { id: draft.id },
    data: { sectionsJson: { ...freshSections, objectionReplies: merged } as any }
  })
  await prisma.oaObjection.updateMany({ where: { id: objectionId }, data: { status: 'DRAFTED' } }).catch(() => {})

  return NextResponse.json({ objectionId, bodyText: drafted.bodyText, version: draft.version })
}
