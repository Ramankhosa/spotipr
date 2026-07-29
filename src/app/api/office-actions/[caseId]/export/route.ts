import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { recordServiceCompletion } from '@/lib/service-completion'
import { prisma } from '@/lib/prisma'
import { loadOfficeActionProfile } from '@/lib/office-action/oa-case-service'
import { assembleReply, type DraftedObjectionReply, type AmendedClaim, type CaseMeta } from '@/lib/office-action/reply-assembly'
import { lintReply } from '@/lib/office-action/compliance-lint'
import { buildReplyDocx } from '@/lib/office-action/oa-docx-export'
import {
  analyzeParagraphMarkers, splitParagraphs, splitSections, citableIdSet
} from '@/lib/office-action/document-intake'
import { normalizeLegacyDraftJson, normalizeLegacyCompliance, normalizeLegacyClaimChart, hashDocumentText } from '@/lib/office-action/oa-json-schema'

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
    include: { documents: { include: { objections: true, citations: true } } }
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

  // Read every stored shape through its normalizer — no call site guesses.
  const sections = normalizeLegacyDraftJson(draft.sectionsJson)
  const compliance = normalizeLegacyCompliance(draft.complianceJson)
  const objectionReplies = sections.objectionReplies as unknown as DraftedObjectionReply[]
  const namedSections = sections.namedSections
  const amendedClaims = (draft.amendedClaimsJson as any)?.claims as AmendedClaim[] || []
  const formsStatus = compliance.formsStatus
  const agent = (compliance as any).agent || {}

  const allObjections = oaCase.documents.flatMap(d => d.objections)
  const confirmed = allObjections.filter(o => o.status !== 'DISMISSED')
  const confirmedObjectionIds = confirmed.map(o => o.id)
  const confirmedObjectionCodes = confirmed.map(o => o.canonicalCode)

  // Recompute the paragraph table here rather than reading a persisted copy.
  // splitParagraphs is pure, so the upload path, the reply pipeline and this
  // route all derive the same anchors from the same stored text — one function
  // over one input, which is checkable, instead of three copies to keep in sync.
  const specText = oaCase.specificationText || ''
  const markerAnalysis = analyzeParagraphMarkers(specText)
  const specParagraphs = splitParagraphs(specText, markerAnalysis)
  const specSections = splitSections(specParagraphs)
  const citableIds = citableIdSet(specParagraphs)

  /**
   * Which document on this case IS the specification as filed.
   *
   * `newMatterSafe` cannot answer this: it is set from the upload's `kind`, so
   * an amended, corrected or translated specification uploaded later is also
   * flagged safe. The first specification on the case is presumptively the
   * as-filed one; a LATER, different one is the dangerous case and must be
   * designated deliberately rather than inherited by silence.
   */
  const specDocs = await prisma.oaCaseDocument.findMany({
    where: { caseId: params.caseId, kind: 'SPECIFICATION' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, text: true, createdAt: true }
  })
  const distinctSpecs = new Set(specDocs.map(d => hashDocumentText(d.text || '')))
  const stored = compliance.basisSource
  let basisSource = stored
  if (!basisSource && specDocs.length === 1) {
    basisSource = {
      documentId: specDocs[0].id,
      contentHash: hashDocumentText(specDocs[0].text || ''),
      designatedAsFiled: true,
      designatedBy: 'system:first-upload',
      designatedAt: specDocs[0].createdAt.toISOString()
    }
  }
  // More than one distinct specification and no explicit designation: we do not
  // know which is as filed, and guessing would let post-filing text support an
  // amendment. The lint's basisSource check fails, which is the intended outcome.
  if (!stored && distinctSpecs.size > 1) basisSource = undefined

  /**
   * Unresolved disagreements in the charts this reply actually relies on.
   *
   * Two objections can chart the same cited document and reach opposite
   * conclusions about the same claim limitation. The merge records that rather
   * than letting the later run win silently — but a contradiction the reply
   * DEPENDS on must not be advisory. Scoped to charts referenced by an approved
   * substantive objection: a conflict in a chart nobody cites is worth seeing,
   * not worth blocking on.
   */
  const approvedIds = new Set(objectionReplies.filter(r => r.approved && !r.attorneyAction).map(r => r.objectionId))
  const reliedLabels = new Set(
    allObjections.filter(o => approvedIds.has(o.id)).flatMap(o => ((o.citationLabels as any) || []) as string[])
  )
  const chartConflicts: Array<{ citationLabel: string; claimNumber: number; feature: string; previousVerdict: string; incomingVerdict: string }> = []
  // Every charted cell, for the contradiction check: what the reply SAYS about
  // a cited document is checked against what this case's own evidence records.
  const chartFacts: Array<{ citationLabel: string; claimNumber: number; feature: string; verdict: string }> = []
  for (const citation of oaCase.documents.flatMap(d => d.citations)) {
    if (!citation.claimChartJson) continue
    const relied = reliedLabels.has(citation.label)
    for (const row of normalizeLegacyClaimChart(citation.claimChartJson).rows) {
      const cell = (row as any)?.cell
      if (cell?.verdict) {
        chartFacts.push({
          citationLabel: citation.label, claimNumber: (row as any).claimNumber,
          feature: String((row as any).feature || ''), verdict: cell.verdict
        })
      }
      if (cell?.conflict?.status === 'CONFLICT' && relied) {
        chartConflicts.push({
          citationLabel: citation.label, claimNumber: (row as any).claimNumber,
          feature: String((row as any).feature || '').slice(0, 80),
          previousVerdict: cell.conflict.previousVerdict, incomingVerdict: cell.conflict.incomingVerdict
        })
      }
    }
  }

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
    agentRegNo: agent.regNo || undefined,
    numbering: markerAnalysis.mode
  }

  const assembled = assembleReply({
    profile, meta, objectionReplies, namedSections, amendedClaims, specParagraphs, specSections
  })
  const lint = lintReply({
    assembled, objectionReplies, amendedClaims, formsStatus, confirmedObjectionIds, confirmedObjectionCodes,
    specParagraphs, numbering: markerAnalysis, specificationText: specText,
    citationOverrides: compliance.citationOverrides, basisSource,
    profile, chartConflicts, chartFacts,
    parsed: (respondingTo?.parsedJson as any) || null,
    caseApplicationNumber: oaCase.applicationNumber,
    caseApplicantName: oaCase.applicantName || undefined,
    computedDeadlines: (respondingTo?.deadlinesJson as any) || [],
    identityOverride: compliance.identityOverride
  })

  // Persist the lint result on the draft either way. When the attorney accepts
  // outstanding findings, record WHO accepted WHAT and WHEN — server-assigned,
  // never taken from the request.
  const acknowledgement = (!body.preview && body.acknowledgeSignature === lint.signature)
    ? {
        signature: lint.signature,
        acknowledgedBy: auth.user.id,
        acknowledgedAt: new Date().toISOString(),
        items: lint.checks.filter(c => c.status !== 'pass').map(c => ({ id: c.id, status: c.status, detail: c.detail }))
      }
    : (compliance as any).acknowledgement
  await prisma.oaResponseDraft.update({
    where: { id: draft.id },
    data: { complianceJson: { ...compliance, lint, ...(acknowledgement ? { acknowledgement } : {}) } as any }
  })

  if (body.preview) {
    const { renderReplyHtml } = await import('@/lib/office-action/reply-html-preview')
    return NextResponse.json({
      lint,
      numbering: { mode: markerAnalysis.mode, confidence: markerAnalysis.confidence, reasons: markerAnalysis.reasons,
                   firstMarker: markerAnalysis.firstMarker, lastMarker: markerAnalysis.lastMarker,
                   paragraphCount: specParagraphs.length },
      blocks: assembled.blocks.map(b => b.type),
      html: renderReplyHtml(assembled, profile)
    })
  }

  /**
   * The checks inform; they do not decide.
   *
   * Several findings are things only the attorney can settle, and some are
   * settled outside this system entirely — a Form 3 filed on the office portal,
   * an applicant name that differs for a reason we cannot see, a citation they
   * know is right. Refusing to produce the document would not make any of those
   * go away; it would just leave them with a deadline and no draft.
   *
   * So export is gated on ACKNOWLEDGEMENT rather than absence of findings: they
   * confirm they have read this exact set, and that is recorded. The
   * acknowledgement is bound to the findings' signature, so accepting once
   * cannot silently carry over to a different set of problems later.
   */
  const outstanding = lint.checks.filter(c => c.status !== 'pass')
  if (outstanding.length && body.acknowledgeSignature !== lint.signature) {
    return NextResponse.json({
      requiresAcknowledgement: true,
      signature: lint.signature,
      error: body.acknowledgeSignature
        ? 'The checks have changed since you reviewed them — read them again before exporting.'
        : 'Confirm you have read the outstanding items, then export.',
      lint
    }, { status: 409 })
  }

  const buffer = await buildReplyDocx(assembled, profile, {
    includeComplianceNote: body.includeVerificationNote === true, lint, citableIds
  })

  // The reply has been produced and passed the lint — reflect it on the docket.
  await prisma.officeActionCase.update({
    where: { id: oaCase.id }, data: { status: 'REPLIED' }
  }).catch(() => {})

  // A lint-passing exported reply is what an OFFICE_ACTION_RESPONSE quota unit buys.
  // Keyed on the case, so re-exporting the same reply does not consume a second unit.
  if (auth.user.tenantId) {
    await recordServiceCompletion({
      tenantId: auth.user.tenantId,
      userId: auth.user.id,
      serviceType: 'OFFICE_ACTION_RESPONSE',
      operationId: oaCase.id,
      operationType: 'OA_REPLY_EXPORT',
      metadata: { applicationNumber: oaCase.applicationNumber, jurisdiction: oaCase.jurisdictionCode }
    })
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="FER-Reply-${oaCase.applicationNumber}.docx"`
    }
  })
}
