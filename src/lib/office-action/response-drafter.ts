import type { OfficeActionProfile } from './oa-profile-schema'
import { runOaStage, fenceUntrusted, type OaGateway } from './oa-llm-service'
import { renderDigest, type InventionDigest } from './invention-digest'
import { retrieveContext, renderContextBlock, retrieveSupplementaryContext, renderSupplementaryBlock } from './context-budget'
import type { ClassifiedObjection } from './objection-classifier'
import type { DraftedObjectionReply } from './reply-assembly'
import { renderObjectionDoctrine } from './objection-doctrine'
import { isProceduralObjection, buildProceduralReply } from './procedural-reply'

/**
 * Office Action Studio — Draft stage
 *
 * Produces the reply section text from small, cost-bounded context: the reusable
 * invention digest + top-K retrieved specification paragraphs for THIS objection,
 * never the full spec (see OFFICE_ACTION_CONTEXT_AND_COST.md). Feeds the
 * deterministic assembly + lint + DOCX export.
 */

interface DraftCtx {
  profile: OfficeActionProfile
  caseId: string
  digest: InventionDigest
  tenantId?: string
  userId?: string
  requestHeaders?: Record<string, string>
  gateway?: OaGateway
}

export interface RedraftInput {
  /** What the attorney wants changed, in their own words. */
  remarks: string
  /** The section they are reacting to — the model revises it rather than starting blind. */
  previousText?: string
}

/** Draft one objection's argument section, retrieving only the basis it needs. */
export async function draftObjectionReply(
  ctx: DraftCtx,
  objection: ClassifiedObjection,
  redraft?: RedraftInput
): Promise<DraftedObjectionReply> {
  // Procedural requirements are complied with, not argued. No LLM call: the
  // model cannot file a Form 3 or attach an annexure, and asking it to write
  // around that produces an assertion of compliance nobody has performed.
  //
  // The section is created with NO body. The profile's sentence asserts a
  // completed act ("An updated Form 3 … is filed along with this reply"), so
  // writing it down before the attorney has done anything would leave a
  // misrepresentation sitting in the draft with only a gate between it and the
  // Controller. It is generated on confirmation instead.
  if (isProceduralObjection(ctx.profile, objection.canonicalCode)) {
    const procedural = buildProceduralReply(ctx.profile, objection)
    return {
      objectionId: (objection as any).id || String(objection.sortOrder),
      sortOrder: objection.sortOrder,
      code: objection.canonicalCode,
      officeNumber: objection.officeNumber,
      title: titleOf(objection),
      statuteBasis: objection.localBasis || undefined,
      examinerConcern: shorten(objection.examinerText),
      bodyText: '',
      attorneyAction: true,
      actionItems: procedural.actionItems,
      requiresSupportingDocument: procedural.requiresSupportingDocument,
      compliance: { status: 'PENDING' },
      approved: false,
      quoteVerified: objection.quoteVerified
    } as DraftedObjectionReply
  }

  const query = `${objection.canonicalCode} ${objection.localBasis || ''} ${objection.examinerText}`.slice(0, 800)
  // Retrieve spec basis relevant to this objection (top-K, token-capped).
  const basis = await retrieveContext({
    caseId: ctx.caseId,
    query,
    newMatterSafeOnly: true,     // amendment/argument basis from as-filed spec only
    kinds: ['SPECIFICATION']
  })
  // Attorney-provided supplementary evidence targeted at this objection
  // (efficacy data, declarations…) — argument material, never s.59 basis.
  const supp = await retrieveSupplementaryContext({
    caseId: ctx.caseId, objectionCode: objection.canonicalCode, query
  })

  // The system prompt tells the drafter to follow the jurisdiction doctrine and
  // to cite only whitelisted authorities — this is what supplies both.
  const doctrine = renderObjectionDoctrine(ctx.profile, objection)

  const input = [
    `Invention digest:\n${renderDigest(ctx.digest)}`,
    doctrine ? `\n${doctrine}` : '',
    // The blocks are labelled with internal ¶ anchors; the reply must cite them
    // the way a filing does — "paragraph [0007]" — never with the ¶ marker.
    basis.length ? `\nRelevant specification basis (cite these paragraphs as [0007], dropping the ¶):\n${renderContextBlock(basis)}` : '',
    (supp.chunks.length || supp.notes.length) ? `\n${renderSupplementaryBlock(supp)}` : '',
    // Fenced: verbatim text lifted out of an uploaded document.
    `\nObjection (${objection.canonicalCode}, ${objection.localBasis || ''}):\n${fenceUntrusted("the examiner's objection, verbatim", objection.examinerText)}`,
    // A redraft is a revision, not a fresh attempt: the attorney is reacting to
    // specific words, so the model must see them and be told the direction is
    // binding. Their instruction comes last, closest to the task.
    redraft?.previousText
      ? `\nThe section currently reads:\n"""\n${redraft.previousText}\n"""`
      : '',
    redraft?.remarks
      ? `\nThe attorney has reviewed that draft and directs the following change. Follow it exactly, keep everything else that already works, and stay within the evidence and authorities supplied above — if the direction cannot be carried out on this record, say so plainly in the section instead of inventing support:\n"""\n${redraft.remarks}\n"""`
      : '',
    `\nDraft the objection-wise reply for this single objection following the jurisdiction doctrine. Return JSON { heading, bodyText }. Cite specification support as paragraph numbers in square brackets, e.g. "paragraph [0007]" or "[0021]–[0022]" — never write the ¶ character. Do not fabricate quotes or authorities.`
  ].filter(Boolean).join('\n')

  const res = await runOaStage<{ heading?: string; bodyText?: string }>(
    { stageCode: 'OA_DRAFT_SECTION', profile: ctx.profile, promptSubKey: 'objectionWiseReply', input,
      tenantId: ctx.tenantId, userId: ctx.userId, requestHeaders: ctx.requestHeaders, purpose: 'office_action:draft_objection' },
    ctx.gateway
  )

  return {
    objectionId: (objection as any).id || String(objection.sortOrder),
    sortOrder: objection.sortOrder,
    code: objection.canonicalCode,
    officeNumber: objection.officeNumber,
    title: titleOf(objection),
    statuteBasis: objection.localBasis || undefined,
    examinerConcern: shorten(objection.examinerText),
    bodyText: res.success ? (res.data?.bodyText || '') : '',
    // A failed LLM call must be visible downstream: the lint blocks approving
    // an empty section, and the UI shows the failure instead of a blank box.
    draftError: res.success ? undefined : (res.error || 'Drafting failed'),
    approved: false,
    quoteVerified: objection.quoteVerified
  }
}

/** First 1–2 sentences of the examiner's text, for the restated concern. */
function shorten(text: string, maxLen = 320): string {
  const one = (text || '').replace(/\s+/g, ' ').trim()
  if (one.length <= maxLen) return one
  const cut = one.slice(0, maxLen)
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '))
  return (lastStop > 80 ? cut.slice(0, lastStop + 1) : cut) + ' …'
}

/** Draft a named non-objection section (preliminary submissions / conclusion). */
export async function draftNamedSection(ctx: DraftCtx, sectionKey: string, hint: string): Promise<string> {
  const input = [
    `Invention digest:\n${renderDigest(ctx.digest)}`,
    `\nDraft the "${sectionKey}" section of the reply. ${hint} Return JSON { bodyText }.`
  ].join('\n')
  const res = await runOaStage<{ bodyText?: string }>(
    { stageCode: 'OA_DRAFT_SECTION', profile: ctx.profile, promptSubKey: sectionKey, input,
      tenantId: ctx.tenantId, userId: ctx.userId, requestHeaders: ctx.requestHeaders, purpose: `office_action:draft_${sectionKey}` },
    ctx.gateway
  )
  return res.data?.bodyText || ''
}

function titleOf(o: ClassifiedObjection): string {
  const label: Record<string, string> = {
    NOVELTY: 'Lack of novelty', INVENTIVE_STEP: 'Lack of inventive step', ELIGIBILITY: 'Non-patentable subject matter',
    SUFFICIENCY: 'Insufficient disclosure', CLARITY: 'Claims not clearly worded', UNITY: 'Unity of invention',
    PROCEDURAL_DISCLOSURE: 'Statutory disclosure requirements', FORMALITIES: 'Formal requirements', OTHER: 'Other requirements'
  }
  return label[o.canonicalCode] || o.canonicalCode
}
