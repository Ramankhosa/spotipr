import { prisma } from '../prisma'
import { loadOfficeActionProfile } from './oa-case-service'
import { normalizeInvention } from './document-intake'
import { buildInventionDigest, digestFromSpotiprDraft, type InventionDigest } from './invention-digest'
import { buildClaimChart, persistClaimChart, type CitationText } from './claim-chart-service'
import { buildObjectionStrategy, usableAmendments, type ObjectionStrategy } from './strategy-service'
import { draftObjectionReply, draftNamedSection } from './response-drafter'
import type { ClassifiedObjection } from './objection-classifier'
import type { OaGateway } from './oa-llm-service'
import type { DraftedObjectionReply, AmendedClaim } from './reply-assembly'

/**
 * Office Action Studio — reply pipeline
 *
 * Chains the stages for a case: invention digest (once) → per objection
 * {claim chart → strategy → draft} → named sections → persist an OaResponseDraft
 * that the export route turns into the filing DOCX. This is the connective
 * tissue that makes a real FER run all the way to a finished reply.
 */

export interface PrepareOptions {
  tenantId?: string
  userId?: string
  requestHeaders?: Record<string, string>
  gateway?: OaGateway
  /** Only prepare these objection ids (default: all non-dismissed). */
  objectionIds?: string[]
}

export interface PrepareResult {
  draftId: string
  version: number
  objectionsDrafted: number
  amendmentsProposed: number
  amendmentsUsable: number
  judgmentFlags: Array<{ objectionId: string; flag: string }>
}

export async function prepareReply(caseId: string, opts: PrepareOptions = {}): Promise<PrepareResult> {
  const oaCase = await prisma.officeActionCase.findUnique({
    where: { id: caseId },
    include: { documents: { include: { objections: { orderBy: { sortOrder: 'asc' } }, citations: true } } }
  })
  if (!oaCase) throw new Error('Case not found')

  const profile = await loadOfficeActionProfile(oaCase.jurisdictionCode)
  if (!profile) throw new Error(`No office-action profile for ${oaCase.jurisdictionCode}`)

  // ---- 1. Invention context (digest built once, reused by every objection) ----
  const normalized = normalizeInvention(oaCase.specificationText || '', oaCase.claimsText || undefined)
  let digest = oaCase.inventionDigest as unknown as InventionDigest | null
  if (!digest) {
    if (normalized.paragraphs.length) {
      const built = await buildInventionDigest(profile, normalized,
        { tenantId: opts.tenantId, userId: opts.userId, requestHeaders: opts.requestHeaders }, opts.gateway)
      digest = built.digest || null
    }
    if (!digest) digest = digestFromSpotiprDraft({})   // empty but valid — pipeline still runs
    await prisma.officeActionCase.update({ where: { id: caseId }, data: { inventionDigest: digest as any } })
  }

  const ctxBase = {
    profile, caseId, digest, paragraphs: normalized.paragraphs,
    tenantId: opts.tenantId, userId: opts.userId, requestHeaders: opts.requestHeaders, gateway: opts.gateway
  }

  const objectionReplies: DraftedObjectionReply[] = []
  const allAmendments: AmendedClaim[] = []
  const judgmentFlags: PrepareResult['judgmentFlags'] = []
  let proposedCount = 0

  for (const doc of oaCase.documents) {
    // Citation full text available for charting (resolved by the worker).
    const citationTexts: CitationText[] = doc.citations
      .filter(c => (c.passagesJson as any)?.fullDocument)
      .map(c => {
        const f = (c.passagesJson as any).fullDocument
        return { label: c.label, title: f.title, abstract: f.abstract, claims: f.claims, description: f.description }
      })

    const objections = doc.objections.filter(o =>
      o.status !== 'DISMISSED' && (!opts.objectionIds || opts.objectionIds.includes(o.id)))

    for (const row of objections) {
      const objection: ClassifiedObjection & { id: string } = {
        id: row.id, sortOrder: row.sortOrder, canonicalCode: row.canonicalCode as any,
        subTypeId: row.subTypeId || undefined, localBasis: row.localBasis || undefined,
        examinerText: row.examinerText, quoteVerified: row.quoteVerified,
        claimsAffected: (row.claimsAffected as any) || [], citationLabels: (row.citationLabels as any) || []
      }

      // ---- 2. Claim chart (only for citation-driven objections) ----
      let chart
      const usesCitations = (objection.citationLabels || []).length > 0 && citationTexts.length > 0
      if (usesCitations && oaCase.claimsText) {
        const relevant = citationTexts.filter(c => objection.citationLabels!.includes(c.label))
        const built = await buildClaimChart(profile, {
          claimsText: oaCase.claimsText,
          claimNumbers: (objection.claimsAffected as number[]) || [],
          citations: relevant.length ? relevant : citationTexts
        }, { tenantId: opts.tenantId, userId: opts.userId, requestHeaders: opts.requestHeaders }, opts.gateway)
        if (built.chart) {
          chart = built.chart
          await persistClaimChart(doc.id, built.chart)
        }
      }

      // ---- 3. Strategy (+ deterministic s.59 basis guard) ----
      const strat = await buildObjectionStrategy(ctxBase as any, objection, chart)
      const strategy: ObjectionStrategy | undefined = strat.strategy
      if (strategy) {
        await prisma.oaObjection.update({
          where: { id: row.id },
          data: { strategyJson: strategy as any, status: 'STRATEGY_CHOSEN' }
        })
        proposedCount += strategy.amendments.length
        for (const a of usableAmendments(strategy)) {
          const verdict = strategy.basisVerdicts.find(v => v.claimNumber === a.claimNumber)
          allAmendments.push({
            claimNumber: a.claimNumber, markedText: a.markedText, cleanText: a.cleanText,
            basisRefs: verdict?.refsResolved ? a.basisRefs : []
          })
        }
        if (strategy.judgmentFlag) judgmentFlags.push({ objectionId: row.id, flag: strategy.judgmentFlag })
      }

      // ---- 4. Draft the objection reply ----
      const drafted = await draftObjectionReply(ctxBase as any, objection)
      objectionReplies.push(drafted)
    }
  }

  // ---- 5. Named sections ----
  const namedSections: Record<string, string> = {
    preliminarySubmissions: await draftNamedSection(ctxBase as any, 'preliminarySubmissions',
      'Acknowledge the report, summarize the invention in two sentences, and state that each objection is answered in turn.'),
    conclusionAndPrayer: await draftNamedSection(ctxBase as any, 'conclusionAndPrayer',
      'Close with the prayer for grant and a request for a hearing if any objection remains.')
  }

  // ---- 6. Persist the draft (what the export route consumes) ----
  const last = await prisma.oaResponseDraft.findFirst({ where: { caseId }, orderBy: { version: 'desc' } })
  const version = (last?.version || 0) + 1
  const draft = await prisma.oaResponseDraft.create({
    data: {
      caseId,
      documentId: oaCase.documents[0]?.id || null,
      version,
      sectionsJson: { objectionReplies, namedSections } as any,
      amendedClaimsJson: { claims: dedupeAmendments(allAmendments) } as any,
      complianceJson: { formsStatus: {}, judgmentFlags } as any
    }
  })

  return {
    draftId: draft.id, version,
    objectionsDrafted: objectionReplies.length,
    amendmentsProposed: proposedCount,
    amendmentsUsable: allAmendments.length,
    judgmentFlags
  }
}

/** Last amendment per claim number wins (later objections may refine the same claim). */
function dedupeAmendments(list: AmendedClaim[]): AmendedClaim[] {
  const byClaim = new Map<number, AmendedClaim>()
  for (const a of list) byClaim.set(a.claimNumber, a)
  return Array.from(byClaim.values()).sort((a, b) => a.claimNumber - b.claimNumber)
}
