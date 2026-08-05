import { prisma } from '../prisma'
import { loadOfficeActionProfile } from './oa-case-service'
import { normalizeInvention } from './document-intake'
import { buildInventionDigest, digestFromSpotiprDraft, type InventionDigest } from './invention-digest'
import { buildClaimChart, persistClaimChart, toClaimNumbers, type CitationText } from './claim-chart-service'
import { buildObjectionStrategy, type ObjectionStrategy } from './strategy-service'
import { checkRetrievalConfig } from './context-budget'
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

  /**
   * Retrieval must be working before a paid run starts.
   *
   * Every argument, every s.59 basis pointer and every paragraph citation comes
   * from the case-document retrieval. When the chunk column and the configured
   * embedding model disagree, each search throws and is caught, so the run
   * completed with an empty context for every objection and reported full
   * success — while the drafter was still being told to cite specification
   * paragraphs, which is how fabricated citations get into a filing draft.
   * Refuse the run instead: nothing here is recoverable by continuing.
   */
  const retrievalConfig = await checkRetrievalConfig()
  if (!retrievalConfig.ok) {
    throw new Error(`Case-document retrieval is not operational. ${retrievalConfig.reason}`)
  }

  // Catch up any document whose upload-time indexing did not finish. Retrieval
  // is about to be needed for every objection, and this is the only place that
  // ever retries — without it a transient failure at upload silently degraded
  // the whole reply to digest-only context.
  const { reindexPendingCaseDocuments } = await import('./case-document-service')
  const reindex = await reindexPendingCaseDocuments(caseId)
  if (reindex.reindexed) {
    await progress(`Indexed ${reindex.reindexed} case document${reindex.reindexed === 1 ? '' : 's'} that had not finished`, 0, 1)
  }

  // Only parsed communications carry objections worth answering.
  const readyDocs = oaCase.documents.filter(d => d.parseStatus === 'COMPLETED')
  /**
   * sortOrder is per-document — each communication numbers its objections from
   * 0. Flat-mapping across documents and then sorting on it globally interleaved
   * two reports' objections and, wherever the office's own numbering was absent,
   * answered two different objections under the same label. Offset each
   * document's block so the sequence stays global and in document order.
   */
  const DOC_ORDER_STRIDE = 1000
  const workItems = readyDocs.flatMap((doc, docIndex) =>
    doc.objections
      .filter(o => o.status !== 'DISMISSED' && (!opts.objectionIds || opts.objectionIds.includes(o.id)))
      .map(o => ({ doc, row: o, globalOrder: docIndex * DOC_ORDER_STRIDE + o.sortOrder })))
  const totalSteps = workItems.length + 2 // + digest + named sections

  // ---- 1. Invention context (digest built once, reused by every objection) ----
  await progress('Reading the invention as filed and building the digest every section will work from', 0, totalSteps)
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
  /**
   * A run on an empty digest is not a normal run.
   *
   * Every section is then argued by a model that knows nothing about the
   * invention beyond per-objection retrieval, and the attorney received a
   * complete-looking draft with zero draft errors and nothing to indicate the
   * arguments were generic. It still proceeds — a draft they can fix beats no
   * draft on a deadline — but it is recorded and reported.
   */
  const digestMissing = !digest
  if (digestMissing) {
    await progress('The invention summary could not be built — sections will be drafted without it. Review them closely.', 0, totalSteps)
  }
  // Counts the attorney can check against their own file — every figure here is
  // read off the case, never estimated.
  const citedOnFile = readyDocs.flatMap(d => d.citations).filter(c => {
    const f = (c.passagesJson as any)?.fullDocument
    return f && (f.claims || f.description)
  }).length
  const numberingNote = normalized.numbering.mode === 'AUTHORED'
    ? `numbered [${normalized.numbering.firstMarker}]–[${normalized.numbering.lastMarker}] by the document`
    : 'no paragraph numbering in the document, so the reply will cite sections and quoted wording'
  await progress(
    `Invention indexed — ${normalized.paragraphs.length} paragraph${normalized.paragraphs.length === 1 ? '' : 's'} available as amendment basis (${numberingNote}), ` +
    `${workItems.length} objection${workItems.length === 1 ? '' : 's'} to answer, ` +
    `${citedOnFile} cited document${citedOnFile === 1 ? '' : 's'} on file`,
    0, totalSteps)

  const ctxBase = {
    profile, caseId, digest: digestForRun, paragraphs: normalized.paragraphs,
    // How the specification numbers itself decides whether the drafter may cite
    // paragraph numbers at all. Threaded from here so every stage agrees.
    numbering: normalized.numbering.mode,
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
  /**
   * Carry over the sections worth keeping. Two kinds qualify:
   *
   *  - anything with text (already paid for, and possibly attorney-edited), and
   *  - a procedural section whose compliance the attorney has already SETTLED.
   *
   * The second case is why this is not a plain text test. A section marked
   * NOT_APPLICABLE deliberately carries no body, so a text-only filter dropped
   * it and re-created it as PENDING — silently discarding the attorney's legal
   * determination and its written reason, and re-demanding a confirmation they
   * had already given.
   */
  const settledProcedural = (r: any) => {
    const status = r?.compliance?.status
    return r?.attorneyAction === true && (status === 'CONFIRMED' || status === 'NOT_APPLICABLE')
  }
  const objectionReplies: DraftedObjectionReply[] = Array.isArray(resumedSections.objectionReplies)
    ? resumedSections.objectionReplies.filter((r: any) => (r?.bodyText || '').trim() || settledProcedural(r))
    : []
  const allAmendments: AmendedClaim[] = Array.isArray((resumable?.amendedClaimsJson as any)?.claims)
    ? [...(resumable!.amendedClaimsJson as any).claims] : []
  const judgmentFlags: PrepareResult['judgmentFlags'] = Array.isArray((resumable?.complianceJson as any)?.judgmentFlags)
    ? [...(resumable!.complianceJson as any).judgmentFlags] : []
  const DIGEST_MISSING_FLAG = 'The invention summary could not be built for this run, so the arguments were drafted without it. Read each section against the specification before filing.'
  if (digestMissing && !judgmentFlags.some(f => f.flag === DIGEST_MISSING_FLAG)) {
    judgmentFlags.push({ objectionId: '', flag: DIGEST_MISSING_FLAG })
  }
  // A section counts as done if it has text, or if it is a procedural section the
  // attorney has already settled — re-running either would overwrite their work.
  const alreadyDrafted = new Set(
    objectionReplies.filter(r => (r.bodyText || '').trim() || settledProcedural(r)).map(r => r.objectionId))
  let proposedCount = 0
  let done = objectionReplies.length

  // Seed from the resumed draft BEFORE the loop. This used to start as {} and be
  // written by the first persistPartial, so a resume wiped the attorney's edited
  // preliminary submissions and prayer from the row mid-run — permanently, if the
  // run was then paused or crashed.
  let namedSections: Record<string, string> = { ...(resumedSections.namedSections || {}) }

  /**
   * Persist progress WITHOUT destroying state this pipeline does not own.
   *
   * complianceJson also carries the attorney's forms checklist, agent details,
   * lint acknowledgement, citation overrides and as-filed designation — all
   * written by the draft/export routes. Rewriting the whole object as
   * `{ formsStatus: {}, judgmentFlags }` erased every one of them on each
   * objection, so resuming a run silently reset the forms checklist and dropped
   * the signature block from the next export. Merge instead.
   */
  const persistPartial = async (finished: boolean) => {
    const current = await prisma.oaResponseDraft.findUnique({
      where: { id: draft.id }, select: { complianceJson: true }
    })
    const existingCompliance = (current?.complianceJson as any) || {}
    await prisma.oaResponseDraft.update({
      where: { id: draft.id },
      data: {
        sectionsJson: { objectionReplies, namedSections, inProgress: !finished } as any,
        amendedClaimsJson: { claims: dedupeAmendments(allAmendments) } as any,
        complianceJson: { ...existingCompliance, judgmentFlags } as any
      }
    })
  }

  let stopped = false
  for (const { doc, row, globalOrder } of workItems) {
    if (alreadyDrafted.has(row.id)) continue      // resumed run: keep what is already paid for

    // Pause point. Checked here, between objections, so a stop never lands in
    // the middle of a paid stage and never leaves a half-written section.
    if (opts.shouldStop && await opts.shouldStop()) { stopped = true; break }

    // The run is minutes long and every stage below is real work the attorney is
    // paying for; report each one as it starts so the wait is legible.
    const who = `Objection ${done + 1} of ${workItems.length} · ${objectionName(row.canonicalCode, row.subTypeId)}`
    await progress(who, done + 1, totalSteps)

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
          return {
            label: c.label, kind: c.kind,
            title: f.title, abstract: f.abstract, claims: f.claims, description: f.description,
            // A document the attorney uploaded is the whole document; one we
            // retrieved may be a partial record. This is what lets an absence
            // finding against a research paper mean anything — a paper has no
            // claims section, so the patent-shaped completeness test would
            // otherwise mark every cited paper incomplete.
            suppliedAsCompleteDocument: c.resolvedVia === 'manual' || Boolean(f.providedByAttorney)
          }
        })

      const objection: ClassifiedObjection & { id: string } = {
        id: row.id, sortOrder: globalOrder, canonicalCode: row.canonicalCode as any,
        subTypeId: row.subTypeId || undefined, localBasis: row.localBasis || undefined,
        officeNumber: (row.analysisJson as any)?.officeNumber || undefined,
        examinerText: row.examinerText, quoteVerified: row.quoteVerified,
        claimsAffected: toClaimNumbers(row.claimsAffected), citationLabels: (row.citationLabels as any) || []
      }

      // A procedural requirement takes neither a chart nor a strategy — there is
      // nothing to distinguish and nothing to amend, only something to file.
      // Skipping both saves two paid calls per formal objection.
      const procedural = isProceduralObjection(profile, objection.canonicalCode)
      if (procedural) await progress(`${who} — procedural requirement, no drafting needed`, done + 1, totalSteps)

      // ---- claim chart (only for citation-driven objections) ----
      let chart
      const usesCitations = !procedural && (objection.citationLabels || []).length > 0 && citationTexts.length > 0
      // ONLY the documents this objection actually cites. Falling back to every
      // resolved citation on the communication charted the claims against art the
      // examiner never applied here, and fed those "distinctions" to strategy as
      // features absent from all cited documents — an argument against the wrong
      // references, while the objection's own citation stayed unanalyzed.
      const relevant = usesCitations
        ? citationTexts.filter(c => objection.citationLabels!.includes(c.label))
        : []
      if (usesCitations && oaCase.claimsText && relevant.length) {
        await progress(`${who} — charting the claims against ${relevant.map(c => c.label).join(', ')}`, done + 1, totalSteps)
        const built = await buildClaimChart(profile, {
          claimsText: oaCase.claimsText,
          claimNumbers: (objection.claimsAffected as number[]) || [],
          citations: relevant
        }, { tenantId: opts.tenantId, userId: opts.userId, requestHeaders: opts.requestHeaders }, opts.gateway)
        if (built.chart) {
          chart = built.chart
          await persistClaimChart(doc.id, built.chart)
        }
      }

      // ---- strategy (+ deterministic s.59 basis guard) ----
      if (!procedural) {
        await progress(`${who} — searching the specification as filed for the passages that answer this objection`, done + 1, totalSteps)
        await progress(`${who} — checking your supporting material for evidence on this point`, done + 1, totalSteps)
        await progress(`${who} — applying ${profile.meta.lawVersion || profile.meta.office} and the authorities on record`, done + 1, totalSteps)
        await progress(`${who} — weighing argue / amend against the cited art`, done + 1, totalSteps)
      }
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
        if (strategy.amendments.length) {
          const passed = strategy.basisVerdicts.filter(v => v.verdict === 'pass').length
          const risky = strategy.basisVerdicts.filter(v => v.verdict === 'risk').length
          const failed = strategy.basisVerdicts.filter(v => v.verdict === 'fail').length
          const parts = [`${passed} with located basis`]
          if (risky) parts.push(`${risky} needing your check`)
          if (failed) parts.push(`${failed} without basis`)
          await progress(
            `${who} — ${strategy.amendments.length} claim amendment${strategy.amendments.length === 1 ? '' : 's'} proposed: ${parts.join(', ')}`,
            done + 1, totalSteps)
        }
        /**
         * EVERY proposed amendment reaches the draft, with what we established
         * about its basis attached.
         *
         * These used to be filtered to the ones that passed the textual-support
         * check, so an amendment whose basis did not resolve simply disappeared
         * — no section in the reply, no note, nothing. The attorney could not
         * accept it, reject it, or fix its basis, because they never knew the
         * model had proposed it. Deciding what goes into the filing is their
         * job; ours is to show them the options and what we could verify.
         */
        // Verdicts are computed positionally (basisVerdicts[i] checks
        // amendments[i]), so pair them positionally. Looking the verdict up by
        // claim number always returned the FIRST verdict for that claim, and the
        // prompt asks for 2–3 options — so a second, unsupported amendment to the
        // same claim inherited the first one's "pass" and reached the attorney
        // labelled as having located basis.
        strategy.amendments.forEach((a, i) => {
          const verdict = strategy.basisVerdicts[i]?.claimNumber === a.claimNumber
            ? strategy.basisVerdicts[i]
            : strategy.basisVerdicts.find(v => v.claimNumber === a.claimNumber)
          allAmendments.push({
            claimNumber: a.claimNumber, markedText: a.markedText, cleanText: a.cleanText,
            basisRefs: verdict?.refsResolved ? a.basisRefs : [],
            basisVerdict: verdict?.verdict,
            basisNote: verdict?.note
          })
        })
        // Deduped: a resumed run seeds judgmentFlags from the persisted draft, so
        // retrying a failed objection re-pushed the same flag every time.
        if (strategy.judgmentFlag && !judgmentFlags.some(f => f.objectionId === row.id && f.flag === strategy.judgmentFlag)) {
          judgmentFlags.push({ objectionId: row.id, flag: strategy.judgmentFlag })
        }
      }

      // ---- draft the objection reply ----
      if (!procedural) await progress(`${who} — drafting the submission, citing the specification paragraph by paragraph`, done + 1, totalSteps)
      const drafted = await draftObjectionReply(ctxBase as any, objection)
      objectionReplies.push(drafted)
      await progress(
        `${who} — section drafted (${(drafted.bodyText || '').split(/\s+/).filter(Boolean).length} words)`,
        done + 1, totalSteps)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[OA prepare] objection ${row.id} (${row.canonicalCode}) failed:`, message)
      // Record the failure as a section so the attorney sees which one to write,
      // and so a later run retries only this objection.
      objectionReplies.push({
        objectionId: row.id,
        sortOrder: globalOrder,
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
  await progress('Writing the preliminary submissions and the prayer', totalSteps - 1, totalSteps)
  /**
   * Draft only the sections that are actually missing.
   *
   * These used to be overwritten unconditionally on every run, so a resume threw
   * away text the attorney had edited via the draft route and re-bought the LLM
   * call to replace it with a fresh generation.
   */
  const NAMED_SECTION_BRIEFS: Array<{ key: string; brief: string }> = [
    { key: 'preliminarySubmissions', brief: 'Acknowledge the report, summarize the invention in two sentences, and state that each objection is answered in turn.' },
    { key: 'conclusionAndPrayer', brief: 'Close with the prayer for grant and a request for a hearing if any objection remains.' }
  ]
  for (const { key, brief } of NAMED_SECTION_BRIEFS) {
    if ((namedSections[key] || '').trim()) continue
    try {
      const text = await draftNamedSection(ctxBase as any, key, brief)
      if ((text || '').trim()) namedSections[key] = text
    } catch (err) {
      console.error(`[OA prepare] named section ${key} failed:`, err instanceof Error ? err.message : err)
    }
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

/**
 * Short human name for an objection, for the progress line. The attorney should
 * read "Inventive step", not "INVENTIVE_STEP".
 */
function objectionName(code: string, subTypeId?: string | null): string {
  const label: Record<string, string> = {
    NOVELTY: 'Novelty', INVENTIVE_STEP: 'Inventive step', ELIGIBILITY: 'Non-patentability',
    SUFFICIENCY: 'Sufficiency', CLARITY: 'Clarity', UNITY: 'Unity',
    PROCEDURAL_DISCLOSURE: 'Statutory disclosures', FORMALITIES: 'Formalities', OTHER: 'Other requirements'
  }
  return `${label[code] || code}${subTypeId ? ` (${subTypeId})` : ''}`
}

/** Last amendment per claim number wins (later objections may refine the same claim). */
function dedupeAmendments(list: AmendedClaim[]): AmendedClaim[] {
  const byClaim = new Map<number, AmendedClaim>()
  for (const a of list) byClaim.set(a.claimNumber, a)
  return Array.from(byClaim.values()).sort((a, b) => a.claimNumber - b.claimNumber)
}
