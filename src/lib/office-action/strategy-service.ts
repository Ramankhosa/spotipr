import type { OfficeActionProfile } from './oa-profile-schema'
import { runOaStage, type OaGateway } from './oa-llm-service'
import { renderDigest, type InventionDigest } from './invention-digest'
import { retrieveContext, renderContextBlock, retrieveSupplementaryContext, renderSupplementaryBlock } from './context-budget'
import type { ClassifiedObjection } from './objection-classifier'
import type { ClaimChart } from './claim-chart-service'
import { resolveBasisRefs, type Paragraph } from './document-intake'
import { renderObjectionDoctrine } from './objection-doctrine'

/**
 * Office Action Studio — Strategy stage (OA_STRATEGY)
 *
 * Per objection: assess the examiner's position, propose argue / amend / both
 * options with tradeoffs, and — when an amendment is proposed — attach the
 * specification basis for every inserted feature. The basis is then checked
 * DETERMINISTICALLY against the as-filed paragraphs (the s.59 guard): an
 * amendment whose basis does not resolve, or whose inserted words are not
 * supported by the cited paragraph, is marked failing and cannot be used.
 */

export interface StrategyOption {
  id: string                    // "A" | "B" | "C"
  kind: 'ARGUE' | 'AMEND' | 'BOTH'
  title: string
  rationale: string
  pros: string[]
  cons: string[]
  recommended?: boolean
}

export interface ProposedAmendment {
  claimNumber: number
  markedText: string            // with <ins>/<del> markup
  cleanText: string
  basisRefs: string[]           // ¶ ids
}

export interface BasisVerdict {
  claimNumber: number
  refsResolved: boolean         // every cited ¶ resolves in the as-filed spec
  supported: boolean            // inserted wording is supported by those ¶s
  unsupportedInsertions: string[]
  /**
   * What the check ESTABLISHED, named honestly.
   *
   * This is a textual-support heuristic — word overlap against the cited
   * paragraphs. It can still pass an unsupported combination of features drawn
   * from separate parts of the specification, so calling its output a Section 59
   * clearance would overclaim. Combination support and added-matter compliance
   * remain the attorney's judgement.
   */
  verdict: 'pass' | 'risk' | 'fail'
  note: string
}

export interface ObjectionStrategy {
  objectionId: string
  assessment: string
  options: StrategyOption[]
  selectedOptionId?: string
  amendments: ProposedAmendment[]
  basisVerdicts: BasisVerdict[]
  judgmentFlag?: string         // e.g. missing efficacy data — attorney must decide
}

const INS_RE = /<ins>([\s\S]*?)<\/ins>/g

function words(s: string): string[] {
  return (s || '').toLowerCase().normalize('NFKC').match(/[a-z0-9]+/g) || []
}

/**
 * s.59 guard (deterministic): every basis ¶ must exist, and the words inserted
 * by the amendment must actually appear in those paragraphs. Rejects amendments
 * that cite basis which does not support them.
 */
export function checkAmendmentBasis(
  amendment: ProposedAmendment,
  paragraphs: Paragraph[],
  minCoverage = 0.7
): BasisVerdict {
  const refs = amendment.basisRefs || []

  // Accept every form the drafting stages actually emit.
  //
  // Retrieval labels each chunk with a RANGE — "[¶0038-¶0041]" — and the prompt
  // tells the model to cite those tags. A model that does exactly as instructed
  // returned "¶0038-¶0041", which a plain map lookup rejected, so the amendment
  // was marked unsupported and silently dropped from the reply. resolveBasisRefs
  // expands ranges and tolerates "0038" / "[0038]" as well.
  const { resolved, unresolved } = resolveBasisRefs(refs, paragraphs)
  const refsResolved = refs.length > 0 && unresolved.length === 0 && resolved.length > 0

  /**
   * A deletion needs no basis paragraph.
   *
   * Section 59 governs what may be ADDED — narrowing by cancelling a claim or
   * striking words introduces no new matter, so there is nothing to support.
   * Condemning a cancellation as "without basis" told the attorney a perfectly
   * valid amendment was legally defective.
   */
  const insertedText = Array.from(amendment.markedText.matchAll(INS_RE)).map(m => m[1]).join(' ')
  if (!insertedText.trim() && /<del>/i.test(amendment.markedText)) {
    return {
      claimNumber: amendment.claimNumber, refsResolved: true, supported: true,
      unsupportedInsertions: [], verdict: 'pass',
      note: 'Deletion only — no new matter is introduced, so no Section 59 basis is required.'
    }
  }

  if (!resolved.length) {
    return {
      claimNumber: amendment.claimNumber, refsResolved: false, supported: false,
      unsupportedInsertions: [], verdict: 'fail',
      note: refs.length === 0 ? 'No specification basis cited for the amendment (Section 59).'
                              : `Cited basis not found in the specification as filed: ${unresolved.join(', ')}`
    }
  }

  const basisWords = new Set(resolved.flatMap(p => words(p.text)))
  const insertions = Array.from(amendment.markedText.matchAll(INS_RE)).map(m => m[1])
  const unsupported: string[] = []

  for (const ins of insertions) {
    const w = words(ins).filter(x => x.length > 3)     // ignore stopword-ish short tokens
    if (!w.length) continue
    const covered = w.filter(x => basisWords.has(x)).length / w.length
    if (covered < minCoverage) unsupported.push(ins.trim())
  }

  const supported = unsupported.length === 0
  const cited = resolved.map(p => p.id).join(', ')

  // Some refs resolved and some did not, or the basis spans widely separated
  // parts of the specification: real textual support, but a combination the
  // attorney has to stand behind. Neither a clean pass nor a rejection.
  const partial = unresolved.length > 0
  const indexes = resolved.map(p => p.index)
  const spread = indexes.length > 1 && (Math.max(...indexes) - Math.min(...indexes)) > 15

  if (supported && (partial || spread)) {
    return {
      claimNumber: amendment.claimNumber, refsResolved, supported: true,
      unsupportedInsertions: [],
      verdict: 'risk',
      note: partial
        ? `Textual support located at ${cited}, but ${unresolved.join(', ')} could not be resolved. Check the basis before filing.`
        : `Textual support located, but it is drawn from widely separated parts of the specification (${cited}). Potential combination-support risk — confirm the features are disclosed together.`
    }
  }

  return {
    claimNumber: amendment.claimNumber, refsResolved, supported,
    unsupportedInsertions: unsupported,
    verdict: supported ? 'pass' : 'fail',
    note: supported
      ? `Textual basis located at ${cited}. Combination support and added-matter compliance still need your review (Section 59).`
      : `Inserted wording is not supported by the cited basis (${cited}). Cite the correct paragraph or revise the amendment — new matter is not permitted (Section 59).`
  }
}

export interface StrategyCtx {
  profile: OfficeActionProfile
  caseId: string
  digest: InventionDigest
  paragraphs: Paragraph[]         // as-filed spec paragraphs (for the s.59 guard)
  tenantId?: string
  userId?: string
  requestHeaders?: Record<string, string>
  gateway?: OaGateway
}

export async function buildObjectionStrategy(
  ctx: StrategyCtx,
  objection: ClassifiedObjection & { id?: string },
  chart?: ClaimChart
): Promise<{ success: boolean; strategy?: ObjectionStrategy; error?: string }> {
  const query = `${objection.canonicalCode} ${objection.localBasis || ''} ${objection.examinerText}`.slice(0, 800)
  // Retrieve only the spec basis this objection needs (as-filed material only).
  const basis = await retrieveContext({
    caseId: ctx.caseId,
    query,
    kinds: ['SPECIFICATION'], newMatterSafeOnly: true
  })
  // Attorney-provided evidence for this objection (post-filing — argument only).
  const supp = await retrieveSupplementaryContext({
    caseId: ctx.caseId, objectionCode: objection.canonicalCode, query
  })

  const distinctions = chart?.distinctions?.map(d => `claim ${d.claimNumber}: ${d.feature}`) || []

  // The office's own law for THIS objection — statute, sub-clause guidance,
  // doctrine steps and the exhaustive authority whitelist.
  const doctrine = renderObjectionDoctrine(ctx.profile, objection)

  const input = [
    `Invention digest:\n${renderDigest(ctx.digest)}`,
    doctrine ? `\n${doctrine}` : '',
    distinctions.length ? `\nFeatures absent from ALL cited documents (your distinctions):\n- ${distinctions.join('\n- ')}` : '',
    basis.length ? `\nSpecification basis available (cite these ¶ tags for any amendment):\n${renderContextBlock(basis)}` : '',
    (supp.chunks.length || supp.notes.length) ? `\n${renderSupplementaryBlock(supp)}` : '',
    `\nObjection (${objection.canonicalCode}${objection.localBasis ? `, ${objection.localBasis}` : ''}):\n"${objection.examinerText}"`,
    '',
    'Assess the examiner position and propose 2–3 response options with tradeoffs. If you propose a claim amendment, mark insertions with <ins></ins> and deletions with <del></del>, and cite the ¶ ids that support EVERY inserted feature — only from the specification basis supplied above (attorney-provided supporting material is post-filing evidence and is NOT amendment basis). If the record lacks the evidence the objection requires (e.g. comparative efficacy data) and none was provided above, do NOT invent it: set judgmentFlag describing the gap.',
    'Return JSON: { assessment, options:[{id,kind,title,rationale,pros:[],cons:[],recommended}], amendments:[{claimNumber,markedText,cleanText,basisRefs:[]}], judgmentFlag? }.'
  ].filter(Boolean).join('\n')

  const res = await runOaStage<any>(
    { stageCode: 'OA_STRATEGY', profile: ctx.profile, input,
      tenantId: ctx.tenantId, userId: ctx.userId, requestHeaders: ctx.requestHeaders, purpose: 'office_action:strategy' },
    ctx.gateway
  )
  if (!res.success || !res.data) return { success: false, error: res.error || 'Strategy failed' }

  const amendments: ProposedAmendment[] = (Array.isArray(res.data.amendments) ? res.data.amendments : []).map((a: any) => ({
    claimNumber: Number(a?.claimNumber) || 0,
    markedText: String(a?.markedText || ''),
    cleanText: String(a?.cleanText || ''),
    basisRefs: Array.isArray(a?.basisRefs) ? a.basisRefs.map(String) : []
  })).filter((a: ProposedAmendment) => a.claimNumber > 0 && a.markedText)

  // Deterministic s.59 verification of every proposed amendment.
  const basisVerdicts = amendments.map(a => checkAmendmentBasis(a, ctx.paragraphs))

  const options: StrategyOption[] = (Array.isArray(res.data.options) ? res.data.options : []).map((o: any, i: number) => ({
    id: String(o?.id || String.fromCharCode(65 + i)),
    kind: ['ARGUE', 'AMEND', 'BOTH'].includes(o?.kind) ? o.kind : 'ARGUE',
    title: String(o?.title || ''), rationale: String(o?.rationale || ''),
    pros: Array.isArray(o?.pros) ? o.pros.map(String) : [],
    cons: Array.isArray(o?.cons) ? o.cons.map(String) : [],
    recommended: Boolean(o?.recommended)
  }))

  return {
    success: true,
    strategy: {
      objectionId: objection.id || String(objection.sortOrder),
      assessment: String(res.data.assessment || ''),
      options,
      selectedOptionId: options.find(o => o.recommended)?.id,
      amendments,
      basisVerdicts,
      judgmentFlag: typeof res.data.judgmentFlag === 'string' && res.data.judgmentFlag.trim() ? res.data.judgmentFlag : undefined
    }
  }
}

/** Amendments that passed the s.59 guard — the only ones allowed into the reply. */
export function usableAmendments(strategy: ObjectionStrategy): ProposedAmendment[] {
  const ok = new Set(strategy.basisVerdicts.filter(v => v.verdict === 'pass').map(v => v.claimNumber))
  return strategy.amendments.filter(a => ok.has(a.claimNumber))
}
