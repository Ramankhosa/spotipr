import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { prisma } from '@/lib/prisma'
import { loadOfficeActionProfile } from '@/lib/office-action/oa-case-service'
import { assembleReply, type DraftedObjectionReply, type AmendedClaim, type CaseMeta } from '@/lib/office-action/reply-assembly'
import { lintReply } from '@/lib/office-action/compliance-lint'
import { buildReplyDocx } from '@/lib/office-action/oa-docx-export'

export const maxDuration = 120

/**
 * POST /api/office-actions/:caseId/export
 * Assembles the approved objection replies + amended claims into the reply
 * letter, runs the compliance lint, and — only if it passes — returns the DOCX.
 * Body (optional): { preview: true } to run the lint without generating the file.
 */
export async function POST(request: NextRequest, { params }: { params: { caseId: string } }) {
  const auth = await authenticateUser(request)
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })

  const oaCase = await prisma.officeActionCase.findUnique({
    where: { id: params.caseId },
    include: { documents: { include: { objections: true } } }
  })
  if (!oaCase) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  if (oaCase.userId !== auth.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (auth.user.tenantId) {
    const access = await enforceServiceAccess(auth.user.id, auth.user.tenantId, 'OFFICE_ACTION_RESPONSE')
    if (!access.allowed) return access.response
  }

  const profile = await loadOfficeActionProfile(oaCase.jurisdictionCode)
  if (!profile) return NextResponse.json({ error: `No office-action profile for ${oaCase.jurisdictionCode}` }, { status: 400 })

  let body: any = {}
  try { body = await request.json() } catch { /* optional body */ }

  // Load the latest response draft (per-section approved content) for this case.
  const draft = await prisma.oaResponseDraft.findFirst({
    where: { caseId: params.caseId },
    orderBy: { version: 'desc' }
  })
  if (!draft) return NextResponse.json({ error: 'No reply draft yet — run the Draft stage first' }, { status: 409 })

  const objectionReplies = (draft.sectionsJson as any)?.objectionReplies as DraftedObjectionReply[] || []
  const namedSections = (draft.sectionsJson as any)?.namedSections as Record<string, string> || {}
  const amendedClaims = (draft.amendedClaimsJson as any)?.claims as AmendedClaim[] || []
  const formsStatus = (draft.complianceJson as any)?.formsStatus || {}
  const agent = (draft.complianceJson as any)?.agent || {}

  const allObjections = oaCase.documents.flatMap(d => d.objections)
  const confirmed = allObjections.filter(o => o.status !== 'DISMISSED')
  const confirmedObjectionIds = confirmed.map(o => o.id)
  const confirmedObjectionCodes = confirmed.map(o => o.canonicalCode)

  // The communication this draft answers — never blindly documents[0] (that can
  // be a failed upload or an earlier notice).
  const respondingTo = oaCase.documents.find(d => d.id === draft.documentId)
    || [...oaCase.documents].reverse().find(d => d.parseStatus === 'COMPLETED')

  const meta: CaseMeta = {
    jurisdictionOffice: profile.meta.office,
    applicationNumber: oaCase.applicationNumber,
    applicantName: oaCase.applicantName || undefined,
    reportDate: respondingTo?.issueDate?.toISOString().slice(0, 10),
    agentName: agent.name || undefined,
    agentRegNo: agent.regNo || undefined
  }

  const assembled = assembleReply({ profile, meta, objectionReplies, namedSections, amendedClaims })
  const lint = lintReply({ assembled, objectionReplies, amendedClaims, formsStatus, confirmedObjectionIds, confirmedObjectionCodes })

  // Persist the lint result on the draft either way.
  await prisma.oaResponseDraft.update({
    where: { id: draft.id },
    data: { complianceJson: { ...(draft.complianceJson as any || {}), lint } }
  })

  if (body.preview) {
    const { renderReplyHtml } = await import('@/lib/office-action/reply-html-preview')
    return NextResponse.json({ lint, blocks: assembled.blocks.map(b => b.type), html: renderReplyHtml(assembled, profile) })
  }

  if (!lint.pass) {
    return NextResponse.json({ error: 'Compliance lint failed — resolve blocking items before export', lint }, { status: 422 })
  }

  const buffer = await buildReplyDocx(assembled, profile, { includeComplianceNote: body.includeVerificationNote === true, lint })

  // The reply has been produced and passed the lint — reflect it on the docket.
  await prisma.officeActionCase.update({
    where: { id: oaCase.id }, data: { status: 'REPLIED' }
  }).catch(() => {})

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="FER-Reply-${oaCase.applicationNumber}.docx"`
    }
  })
}
