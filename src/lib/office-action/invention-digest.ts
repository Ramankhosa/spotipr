import type { OfficeActionProfile } from './oa-profile-schema'
import { runOaStage, type OaGateway } from './oa-llm-service'
import { normalizeInvention, type NormalizedInvention } from './document-intake'

/**
 * Office Action Studio — invention digest (cost lever 1)
 *
 * Reads the full specification ONCE and distills a compact, reusable summary
 * that every objection's strategy/argument/draft stage consumes instead of the
 * full spec. Each field carries paragraph pointers (¶IDs) so the digest stays
 * citable. Built once per case and cached on OfficeActionCase.inventionDigest.
 */

export interface InventionDigest {
  problem: string
  solution: string
  keyFeatures: Array<{ feature: string; basis?: string }>       // basis = ¶ id
  technicalAdvance: Array<{ statement: string; basis?: string }> // s.2(1)(ja) raw material
  efficacyOrData: Array<{ statement: string; basis?: string }>   // s.3(d)/sufficiency raw material
  independentClaims: Array<{ claimNumber: number; elements: string[] }>
  builtFrom: 'llm' | 'imported'
}

/**
 * Build the digest with a single LLM pass over the (paragraph-numbered) spec.
 * Uses the cheap OA_INTAKE_PARSE stage tier — this is the only time the full
 * spec is sent to a model; everything downstream uses the digest + retrieval.
 */
export async function buildInventionDigest(
  profile: OfficeActionProfile,
  normalized: NormalizedInvention,
  opts: { tenantId?: string; userId?: string; requestHeaders?: Record<string, string> } = {},
  gateway?: OaGateway
): Promise<{ success: boolean; digest?: InventionDigest; error?: string }> {
  // Present the spec with paragraph IDs so the model can cite basis.
  const numbered = normalized.paragraphs.map(p => `${p.id} ${p.text}`).join('\n\n')
  const claimList = normalized.claimElements
    .filter(c => c.isIndependent)
    .reduce<Record<number, string[]>>((acc, c) => {
      (acc[c.claimNumber] ||= []).push(c.text); return acc
    }, {})

  const input = [
    'Distill this patent specification into a compact digest for use when replying to office-action objections. Cite paragraph IDs (¶NNNN) as basis wherever possible. Be concise — this digest is reused for every objection, so keep each item to one sentence.',
    '',
    'Independent claims (already parsed):',
    JSON.stringify(claimList),
    '',
    'Return JSON: { problem, solution, keyFeatures:[{feature,basis}], technicalAdvance:[{statement,basis}], efficacyOrData:[{statement,basis}], independentClaims:[{claimNumber,elements:[...]}] }.',
    'technicalAdvance = statements supporting inventive step (s.2(1)(ja)); efficacyOrData = any comparative/experimental/efficacy statements (s.3(d), sufficiency).',
    '',
    'Specification (paragraph-numbered):',
    '"""',
    numbered,
    '"""'
  ].join('\n')

  const result = await runOaStage<Omit<InventionDigest, 'builtFrom'>>(
    { stageCode: 'OA_INTAKE_PARSE', profile, input, tenantId: opts.tenantId, userId: opts.userId, requestHeaders: opts.requestHeaders, purpose: 'office_action:invention_digest' },
    gateway
  )

  if (!result.success || !result.data) {
    return { success: false, error: result.error || 'Digest build failed' }
  }
  return { success: true, digest: { ...normalizeDigest(result.data), builtFrom: 'llm' } }
}

/**
 * Build the digest for free from an imported spotipr drafting project's already
 * structured data (idea normalization + claims). No LLM call.
 */
export function digestFromSpotiprDraft(input: {
  problem?: string
  solution?: string
  keyFeatures?: string[]
  advantages?: string[]
  independentClaims?: Array<{ claimNumber: number; elements: string[] }>
}): InventionDigest {
  return {
    problem: input.problem || '',
    solution: input.solution || '',
    keyFeatures: (input.keyFeatures || []).map(feature => ({ feature })),
    technicalAdvance: (input.advantages || []).map(statement => ({ statement })),
    efficacyOrData: [],
    independentClaims: input.independentClaims || [],
    builtFrom: 'imported'
  }
}

function normalizeDigest(d: any): Omit<InventionDigest, 'builtFrom'> {
  const arr = (x: any) => (Array.isArray(x) ? x : [])
  return {
    problem: String(d?.problem || ''),
    solution: String(d?.solution || ''),
    keyFeatures: arr(d?.keyFeatures).map((f: any) => ({ feature: String(f?.feature ?? f ?? ''), basis: f?.basis })),
    technicalAdvance: arr(d?.technicalAdvance).map((f: any) => ({ statement: String(f?.statement ?? f ?? ''), basis: f?.basis })),
    efficacyOrData: arr(d?.efficacyOrData).map((f: any) => ({ statement: String(f?.statement ?? f ?? ''), basis: f?.basis })),
    independentClaims: arr(d?.independentClaims).map((c: any) => ({ claimNumber: Number(c?.claimNumber) || 0, elements: arr(c?.elements).map(String) }))
  }
}

/** Render the digest as a compact prompt block (reused across all objections). */
export function renderDigest(d: InventionDigest): string {
  const feat = d.keyFeatures.map(f => `- ${f.feature}${f.basis ? ` [${f.basis}]` : ''}`).join('\n')
  const adv = d.technicalAdvance.map(f => `- ${f.statement}${f.basis ? ` [${f.basis}]` : ''}`).join('\n')
  const eff = d.efficacyOrData.map(f => `- ${f.statement}${f.basis ? ` [${f.basis}]` : ''}`).join('\n')
  return [
    `Problem: ${d.problem}`,
    `Solution: ${d.solution}`,
    feat && `Key features:\n${feat}`,
    adv && `Technical advance:\n${adv}`,
    eff && `Efficacy / data:\n${eff}`
  ].filter(Boolean).join('\n')
}
