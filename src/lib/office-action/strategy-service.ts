import type { OfficeActionProfile } from './oa-profile-schema'
import { runOaStage, type OaGateway } from './oa-llm-service'
import { renderDigest, type InventionDigest } from './invention-digest'
import { retrieveContext, renderContextBlock } from './context-budget'
import type { ClassifiedObjection } from './objection-classifier'
import type { ClaimChart } from './claim-chart-service'
import type { Paragraph } from './document-intake'

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
  refsResolved: boolean         // every ¶ id exists in the as-filed spec
  supported: boolean            // inserted wording is supported by those ¶s
  unsupportedInsertions: string[]
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
  const byId = new Map(paragraphs.map(p => [p.id, p.text]))
  const refs = amendment.basisRefs || []
  const refsResolved = refs.length > 0 && refs.every(r => byId.has(r))

  if (!refsResolved) {
    return {
      claimNumber: amendment.claimNumber, refsResolved: false, supported: false,
      unsupportedInsertions: [], verdict: 'fail',
      note: refs.length === 0 ? 'No specification basis cited for the amendment (Section 59).'
                              : `Cited basis not found in the specification as filed: ${refs.filter(r => !byId.has(r)).join(', ')}`
    }
  }

  const basisWords = new Set(refs.flatMap(r => words(byId.get(r) || '')))
  const insertions = Array.from(amendment.markedText.matchAll(INS_RE)).map(m => m[1])
  const unsupported: string[] = []

  for (const ins of insertions) {
    const w = words(ins).filter(x => x.length > 3)     // ignore stopword-ish short tokens
    if (!w.length) continue
    const covered = w.filter(x => basisWords.has(x)).length / w.length
    if (covered < minCoverage) unsupported.push(ins.trim())
  }

  const supported = unsupported.length === 0
  return {
    claimNumber: amendment.claimNumber, refsResolved: true, supported,
    unsupportedInsertions: unsupported,
    verdict: supported ? 'pass' : 'fail',
    note: supported
      ? `Amendment supported by ${refs.join(', ')}; within the scope of the claims as filed (Section 59).`
      : `Inserted wording is not supported by the cited basis (${refs.join(', ')}). Cite the correct paragraph or revise the amendment — new matter is not permitted (Section 59).`
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
  // Retrieve only the spec basis this objection needs (as-filed material only).
  const basis = await retrieveContext({
    caseId: ctx.caseId,
    query: `${objection.canonicalCode} ${objection.localBasis || ''} ${objection.examinerText}`.slice(0, 800),
    kinds: ['SPECIFICATION'], newMatterSafeOnly: true
  })

  const distinctions = chart?.distinctions?.map(d => `claim ${d.claimNumber}: ${d.feature}`) || []

  const input = [
    `Invention digest:\n${renderDigest(ctx.digest)}`,
    distinctions.length ? `\nFeatures absent from ALL cited documents (your distinctions):\n- ${distinctions.join('\n- ')}` : '',
    basis.length ? `\nSpecification basis available (cite these ¶ tags for any amendment):\n${renderContextBlock(basis)}` : '',
    `\nObjection (${objection.canonicalCode}${objection.localBasis ? `, ${objection.localBasis}` : ''}):\n"${objection.examinerText}"`,
    '',
    'Assess the examiner position and propose 2–3 response options with tradeoffs. If you propose a claim amendment, mark insertions with <ins></ins> and deletions with <del></del>, and cite the ¶ ids that support EVERY inserted feature — only from the basis supplied above. If the record lacks the evidence the objection requires (e.g. comparative efficacy data), do NOT invent it: set judgmentFlag describing the gap.',
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
