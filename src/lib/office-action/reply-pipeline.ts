import { prisma } from '../prisma'
import { loadOfficeActionProfile } from './oa-case-service'
import { normalizeInvention } from './document-intake'
import { buildInventionDigest, digestFromSpotiprDraft, type InventionDigest } from './invention-digest'
import { buildClaimChart, persistClaimChart, type CitationText } from './claim-chart-service'
import { buildObjectionStrategy, usableAmendments, type ObjectionStrategy } from './strategy-service'
import { draftObjectionReply, draftNamedSection } from './response-drafter'
import { isProceduralObjection } from './procedural-reply'
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
  /** Called between stages (drives the background job's currentStep display). */
  onProgress?: (step: string, done: number, total: number) => void | Promise<void>
  /**
   * Checked before each objection. Returning true stops the run cleanly at the
   * next boundary — the draft stays flagged in progress so "Resume preparation"
   * picks it up, which is what lets the attorney pause, add prior art, and
   * continue with the new document in play.
   */
  shouldStop?: () => Promise<boolean> | boolean
  /**
   * Continue the latest draft instead of opening a new version: keep every
   * section that has text and redraft only the ones that are missing or failed.
   * Set by the workspace's "Resume preparation" / "Retry failed sections".
   */
  resume?: boolean
}

export interface PrepareResult {
  draftId: string
  version: number
  objectionsDrafted: number
  /** Sections whose LLM draft failed (empty body — attorney must write/edit). */
  draftErrors: number
  amendmentsProposed: number
  amendmentsUsable: number
  judgmentFlags: Array<{ objectionId: string; flag: string }>
  /** The run was paused at an objection boundary; the draft can be resumed. */
  stopped?: boolean
  /** Objections still to draft when the run stopped. */
  remaining?: number
}

export async function prepareReply(caseId: string, opts: PrepareOptions = {}): Promise<PrepareResult> {
  const oaCase = await prisma.officeActionCase.findUnique({
    where: { id: caseId },
    include: { documents: { orderBy: { createdAt: 'asc' }, include: { objections: { orderBy: { sortOrder: 'asc' } }, citations: true } } }
  })
  if (!oaCase) throw new Error('Case not found')

  const profile = await loadOfficeActionProfile(oaCase.jurisdictionCode)
  if (!profile) throw new Error(`No office-action profile for ${oaCase.jurisdictionCode}`)

  const progress = async (step: string, done: number, total: number) => {
    try { await opts.onProgress?.(step, done, total) } catch { /* progress must never break the run */ }
  }

  // Only parsed communications carry objections worth answering.
  const readyDocs = oaCase.documents.filter(d => d.parseStatus === 'COMPLETED')
  const workItems = readyDocs.flatMap(doc =>
    doc.objections
      .filter(o => o.status !== 'DISMISSED' && (!opts.objectionIds || opts.objectionIds.includes(o.id)))
      .map(o => ({ doc, row: o })))
  const totalSteps = workItems.length + 2 // + digest + named sections

  // ---- 1. Invention context (digest built once, reused by every objection) ----
  await progress('Reading the invention', 0, totalSteps)
  const normalized = normalizeInvention(oaCase.specificationText || '', oaCase.claimsText || undefined)
  let digest = oaCase.inventionDigest as unknown as InventionDigest | null
  if (!digest) {
    if (normalized.paragraphs.length) {
      const built = await buildInventionDigest(profile, normalized,
        { tenantId: opts.tenantId, userId: opts.userId, requestHeaders: opts.requestHeaders }, opts.gateway)
      digest = built.digest || null
    }
    if (digest) {
      // Persist ONLY a real digest. Persisting the empty fallback would poison
      // every later run (the null-check would never rebuild it).
      await prisma.officeActionCase.update({ where: { id: caseId }, data: { inventionDigest: digest as any } })
    }
  }
  const digestForRun = digest || digestFromSpotiprDraft({})   // empty but valid — this run still proceeds

  const ctxBase = {
    profile, caseId, digest: digestForRun, paragraphs: normalized.paragraphs,
    tenantId: opts.tenantId, userId: opts.userId, requestHeaders: opts.requestHeaders, gateway: opts.gateway
  }

  // ---- 2. Create the draft row UP FRONT and persist incrementally after every
  // objection, so a timeout/crash mid-run loses at most one objection's work
  // (and the paid LLM calls behind the finished ones are never wasted).
  //
  // A run that died mid-way leaves its draft flagged inProgress. RESUME that row
  // instead of opening a new version: a fresh version would become the "latest
  // draft" the workspace renders, so a retry would blank the sections the
  // attorney could already see, and every retry would re-buy the LLM calls
  // behind the objections already drafted.
  // Resume when a run was interrupted, or when the attorney explicitly asks to
  // continue a finished draft that has failed sections — redrafting only the
  // gaps costs one LLM call per gap instead of re-buying the whole reply.
  const last = await prisma.oaResponseDraft.findFirst({ where: { caseId }, orderBy: { version: 'desc' } })
  const lastSections = (last?.sectionsJson as any) || {}
  const lastHasGaps = Array.isArray(lastSections.objectionReplies)
    && lastSections.objectionReplies.some((r: any) => !(r?.bodyText || '').trim())
  const resumable = last && (lastSections.inProgress || (opts.resume && lastHasGaps)) ? last : null
  const version = resumable ? resumable.version : (last?.version || 0) + 1
  const draft = resumable || await prisma.oaResponseDraft.create({
    data: {
      caseId,
      documentId: readyDocs[0]?.id || null,
      version,
      sectionsJson: { objectionReplies: [], namedSections: {}, inProgress: true } as any,
      amendedClaimsJson: { claims: [] } as any,
      complianceJson: { formsStatus: {}, judgmentFlags: [] } as any
    }
  })

  const resumedSections = (resumable?.sectionsJson as any) || {}
  // Carry over only the sections that actually have text. An empty/failed one is
  // dropped here and re-drafted below, so a retry replaces it rather than
  // leaving the old failure sitting next to the new section.
  const objectionReplies: DraftedObjectionReply[] = Array.isArray(resumedSections.objectionReplies)
    ? resumedSections.objectionReplies.filter((r: any) => (r?.bodyText || '').trim())
    : []
  const allAmendments: AmendedClaim[] = Array.isArray((resumable?.amendedClaimsJson as any)?.claims)
    ? [...(resumable!.amendedClaimsJson as any).claims] : []
  const judgmentFlags: PrepareResult['judgmentFlags'] = Array.isArray((resumable?.complianceJson as any)?.judgmentFlags)
    ? [...(resumable!.complianceJson as any).judgmentFlags] : []
  // Only sections that actually carry text count as done — a failed one is retried.
  const alreadyDrafted = new Set(objectionReplies.filter(r => (r.bodyText || '').trim()).map(r => r.objectionId))
  let proposedCount = 0
  let done = objectionReplies.length

  const persistPartial = async (finished: boolean) => {
    await prisma.oaResponseDraft.update({
      where: { id: draft.id },
      data: {
        sectionsJson: { objectionReplies, namedSections, inProgress: !finished } as any,
        amendedClaimsJson: { claims: dedupeAmendments(allAmendments) } as any,
        complianceJson: { formsStatus: {}, judgmentFlags } as any
      }
    })
  }
  let namedSections: Record<string, string> = {}

  let stopped = false
  for (const { doc, row } of workItems) {
    if (alreadyDrafted.has(row.id)) continue      // resumed run: keep what is already paid for

    // Pause point. Checked here, between objections, so a stop never lands in
    // the middle of a paid stage and never leaves a half-written section.
    if (opts.shouldStop && await opts.shouldStop()) { stopped = true; break }

    await progress(`Objection ${done + 1} of ${workItems.length}`, done + 1, totalSteps)

    // Everything for ONE objection is isolated: a chart, strategy or draft that
    // throws costs that objection its section, never the rest of the run.
    try {
      // Citation full text available for charting (resolved by the worker). Only
      // substantive records qualify — charting against a bare title/abstract
      // produces false NOT_DISCLOSED verdicts the attorney would rely on.
      const citationTexts: CitationText[] = doc.citations
        .filter(c => {
          const f = (c.passagesJson as any)?.fullDocument
          return f && (f.claims || f.description)
        })
        .map(c => {
          const f = (c.passagesJson as any).fullDocument
          return { label: c.label, title: f.title, abstract: f.abstract, claims: f.claims, description: f.description }
        })

      const objection: ClassifiedObjection & { id: string } = {
        id: row.id, sortOrder: row.sortOrder, canonicalCode: row.canonicalCode as any,
        subTypeId: row.subTypeId || undefined, localBasis: row.localBasis || undefined,
        officeNumber: (row.analysisJson as any)?.officeNumber || undefined,
        examinerText: row.examinerText, quoteVerified: row.quoteVerified,
        claimsAffected: (row.claimsAffected as any) || [], citationLabels: (row.citationLabels as any) || []
      }

      // A procedural requirement takes neither a chart nor a strategy — there is
      // nothing to distinguish and nothing to amend, only something to file.
      // Skipping both saves two paid calls per formal objection.
      const procedural = isProceduralObjection(profile, objection.canonicalCode)

      // ---- claim chart (only for citation-driven objections) ----
      let chart
      const usesCitations = !procedural && (objection.citationLabels || []).length > 0 && citationTexts.length > 0
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

      // ---- strategy (+ deterministic s.59 basis guard) ----
      const strat = procedural
        ? { success: true, strategy: undefined as ObjectionStrategy | undefined }
        : await buildObjectionStrategy(ctxBase as any, objection, chart)
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

      // ---- draft the objection reply ----
      const drafted = await draftObjectionReply(ctxBase as any, objection)
      objectionReplies.push(drafted)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[OA prepare] objection ${row.id} (${row.canonicalCode}) failed:`, message)
      // Record the failure as a section so the attorney sees which one to write,
      // and so a later run retries only this objection.
      objectionReplies.push({
        objectionId: row.id,
        sortOrder: row.sortOrder,
        code: row.canonicalCode as any,
        officeNumber: (row.analysisJson as any)?.officeNumber || undefined,
        title: row.canonicalCode,
        statuteBasis: row.localBasis || undefined,
        examinerConcern: (row.examinerText || '').slice(0, 320),
        bodyText: '',
        draftError: message,
        approved: false,
        quoteVerified: row.quoteVerified
      } as DraftedObjectionReply)
    }
    done++
    await persistPartial(false)
  }

  // A paused run keeps its draft open so the next prepare resumes it, and skips
  // the closing sections — they are written once, over the finished set.
  if (stopped) {
    await persistPartial(false)     // inProgress stays true — this draft resumes
    return {
      draftId: draft.id, version,
      objectionsDrafted: objectionReplies.filter(r => (r.bodyText || '').trim()).length,
      draftErrors: objectionReplies.filter(r => r.draftError).length,
      amendmentsProposed: proposedCount,
      amendmentsUsable: allAmendments.length,
      judgmentFlags,
      stopped: true,
      remaining: Math.max(0, workItems.length - objectionReplies.length)
    }
  }

  // ---- named sections ----
  // Isolated too: losing the prayer must not discard every drafted objection.
  await progress('Preliminary submissions and prayer', totalSteps - 1, totalSteps)
  namedSections = { ...(resumedSections.namedSections || {}) }
  try {
    namedSections = {
      preliminarySubmissions: await draftNamedSection(ctxBase as any, 'preliminarySubmissions',
        'Acknowledge the report, summarize the invention in two sentences, and state that each objection is answered in turn.'),
      conclusionAndPrayer: await draftNamedSection(ctxBase as any, 'conclusionAndPrayer',
        'Close with the prayer for grant and a request for a hearing if any objection remains.')
    }
  } catch (err) {
    console.error('[OA prepare] named sections failed:', err instanceof Error ? err.message : err)
  }
  // The run is finished either way — inProgress:false stops a later prepare from
  // resuming this draft, and the attorney gets a fresh version next time.
  await persistPartial(true)

  const draftErrors = objectionReplies.filter(r => r.draftError).length
  const bodiesDrafted = objectionReplies.filter(r => (r.bodyText || '').trim()).length
  return {
    draftId: draft.id, version,
    objectionsDrafted: bodiesDrafted,
    draftErrors,
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
