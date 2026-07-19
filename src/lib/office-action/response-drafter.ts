import type { OfficeActionProfile } from './oa-profile-schema'
import { runOaStage, type OaGateway } from './oa-llm-service'
import { renderDigest, type InventionDigest } from './invention-digest'
import { retrieveContext, renderContextBlock } from './context-budget'
import type { ClassifiedObjection } from './objection-classifier'
import type { DraftedObjectionReply } from './reply-assembly'

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

/** Draft one objection's argument section, retrieving only the basis it needs. */
export async function draftObjectionReply(ctx: DraftCtx, objection: ClassifiedObjection): Promise<DraftedObjectionReply> {
  // Retrieve spec basis relevant to this objection (top-K, token-capped).
  const basis = await retrieveContext({
    caseId: ctx.caseId,
    query: `${objection.canonicalCode} ${objection.localBasis || ''} ${objection.examinerText}`.slice(0, 800),
    newMatterSafeOnly: true,     // amendment/argument basis from as-filed spec only
    kinds: ['SPECIFICATION']
  })

  const input = [
    `Invention digest:\n${renderDigest(ctx.digest)}`,
    basis.length ? `\nRelevant specification basis (cite the ¶ tags):\n${renderContextBlock(basis)}` : '',
    `\nObjection (${objection.canonicalCode}, ${objection.localBasis || ''}):\n"${objection.examinerText}"`,
    `\nDraft the objection-wise reply for this single objection following the jurisdiction doctrine. Return JSON { heading, bodyText }. Cite ¶ tags for any specification support. Do not fabricate quotes or authorities.`
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
    title: titleOf(objection),
    statuteBasis: objection.localBasis || undefined,
    examinerConcern: shorten(objection.examinerText),
    bodyText: res.data?.bodyText || '',
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
    PROCEDURAL_DISCLOSURE: 'Foreign-filing disclosure (Section 8)', FORMALITIES: 'Formal requirements', OTHER: 'Other requirements'
  }
  return label[o.canonicalCode] || o.canonicalCode
}
