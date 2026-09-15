import { createHash } from 'node:crypto'
import { Prisma, TaskCode } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { patentSearchOrchestrator } from '@/lib/patent-search/orchestrator'
import type { SearchLaneDiagnostic } from '@/lib/patent-search/types'
import { parseModelJson, type WhitespaceLLMContext } from '../llm'
import type { RunReporter } from '../run-reporter'
import { WhitespacePermanentError } from '../run-lease'
import type { WhitespaceScope } from '../types'
import { briefContentSchema, officeAssessmentSchema, proposalSchema, type MinerOffice } from './contracts'
import { minerRetrievalIdentity } from './retrieval-identity'
import { gradeQuote } from './citations'
import { parseGeneratedClaimsFromLLMOutput } from '@/lib/draft-claims-parser'
import { resolveClaimRuleProfile, runOfficeFormLint } from '@/lib/claim-rules'
import {
  assertMinerStagesConfigured,
  MINER_BRIEF_STAGE_CODE,
  MINER_EVIDENCE_MAP_STAGE_CODE,
  MINER_EXCLUSION_SCREEN_STAGE_CODE,
  MINER_INVENTIVE_STEP_STAGE_CODE,
  MINER_PROPOSE_STAGE_CODE,
  MINER_RETRIEVAL_PLAN_STAGE_CODE,
  runMinerLLM,
} from './llm'

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
const RULE_PROFILES: Record<MinerOffice, { version: string; sources: string[]; checks: string[]; guidance: string[] }> = {
  IN: {
    version: 'IN-Patents-Act-1970-2026.1',
    sources: ['https://ipindia.gov.in/acts/patent-act-1970'],
    checks: ['novelty', 'inventive step', 'Patents Act section 3 exclusions', 'clarity, enablement and support'],
    guidance: [
      'Apply the invention and inventive-step definitions in Patents Act section 2(1)(j) and 2(1)(ja).',
      'Screen the statutory exclusions in section 3 separately from novelty and inventive step.',
      'Treat section 10 disclosure, clarity and support as separate checks; do not infer support from prior art.',
      'Use section 13 anticipation research as a bounded preliminary search, not a grant or validity decision.',
    ],
  },
  US: {
    version: 'US-MPEP-2106-2141-2026.1',
    sources: ['https://www.uspto.gov/web/offices/pac/mpep/s2141.html', 'https://www.uspto.gov/web/offices/pac/mpep/s2106.html'],
    checks: ['novelty', 'obviousness under MPEP 2141', 'eligibility under MPEP 2106', 'written description and enablement'],
    guidance: [
      'Analyze obviousness under 35 U.S.C. 103 using the Graham factual inquiries and an articulated record; avoid hindsight.',
      'Keep single-reference anticipation separate from multi-reference obviousness reasoning.',
      'For eligibility, apply Step 2A to the claim as a whole, including practical-application analysis, and Step 2B when required.',
      'Keep written description and enablement distinct from eligibility and obviousness.',
    ],
  },
  EP: {
    version: 'EP-Guidelines-G-VII-2026.1',
    sources: ['https://www.epo.org/en/legal/guidelines-epc/2026/g_vii.html'],
    checks: ['novelty', 'inventive step using the problem-solution approach', 'EPC exclusions', 'clarity, sufficiency and support'],
    guidance: [
      'Apply Article 56 EPC through the Guidelines G-VII problem-solution approach.',
      'Identify the closest prior art, distinguishing features, objective technical problem and whether the claimed solution would have been obvious.',
      'Record any combination of prior-art teachings as inventive-step reasoning, never as single-reference novelty disclosure.',
      'Keep EPC exclusions, clarity, sufficiency and support as separately reported checks.',
    ],
  },
}

type StageBase = {
  runId: string
  workerId: string
  reporter: RunReporter
  studyId: string
  scope: WhitespaceScope
  llmContext: WhitespaceLLMContext
}

async function loadLeadInputs(studyId: string, leadId: string, snapshotId: string, proposalRevisionId?: string) {
  const [lead, snapshot, proposal, study] = await Promise.all([
    prisma.inventionLead.findFirst({ where: { id: leadId, studyId } }),
    prisma.minerFieldSnapshot.findFirst({ where: { id: snapshotId, studyId } }),
    proposalRevisionId ? prisma.minerProposalRevision.findUnique({ where: { id: proposalRevisionId } }) : null,
    prisma.whitespaceStudy.findUnique({ where: { id: studyId }, select: { scope: true } }),
  ])
  if (!lead) throw new WhitespacePermanentError('The selected Miner lead no longer exists.')
  if (!snapshot?.approvedAt) throw new WhitespacePermanentError('Approve the field and workload before continuing.')
  if (lead.snapshotId !== snapshot.id) throw new WhitespacePermanentError('This lead belongs to an older field snapshot. Run the lead engines for the approved field and select a current lead.')
  if (!study || minerRetrievalIdentity(study.scope as unknown as WhitespaceScope) !== snapshot.retrievalIdentity) throw new WhitespacePermanentError('The approved field is stale. Run and approve preflight again.')
  if (proposalRevisionId && (!proposal || proposal.leadId !== lead.id || proposal.snapshotId !== snapshot.id || !proposal.approvedAt)) {
    throw new WhitespacePermanentError('Approve the exact proposal revision before assessment or briefing.')
  }
  if (proposalRevisionId && lead.currentProposalId !== proposalRevisionId) throw new WhitespacePermanentError('The proposal changed. Assess the currently approved revision.')
  return { lead, snapshot, proposal }
}

export async function runMinerProposeStage(input: StageBase & { leadId: string; snapshotId: string }) {
  const { lead, snapshot } = await loadLeadInputs(input.studyId, input.leadId, input.snapshotId)
  await input.reporter.plan([{ key: 'propose', label: 'Developing concrete solution alternatives' }], [])
  await input.reporter.step('propose', 'Applying the approved field, focus problems and feasibility constraints')
  const configured = await assertMinerStagesConfigured(input.llmContext, [{ taskCode: TaskCode.IM_EXTRACT, stageCode: MINER_PROPOSE_STAGE_CODE }])
  const study = await prisma.whitespaceStudy.findUnique({ where: { id: input.studyId }, select: { inventionJson: true } })
  const brief = study?.inventionJson && typeof study.inventionJson === 'object' ? study.inventionJson : {}
  const answer = await runMinerLLM({
    taskCode: TaskCode.IM_EXTRACT,
    stageCode: MINER_PROPOSE_STAGE_CODE,
    context: input.llmContext,
    prompt: `You are developing invention proposals, not reporting experimental facts.
Return JSON only: {"proposals":[up to 3 objects]}.
Each object must have title, problem, mechanism, elements (2-8 strings), relationships (1-8 strings), intendedEffects (strings explicitly phrased as hypotheses), constraints, assumptions, experimentsNeeded, provenance (SOURCE_DISCLOSURE|USER_ASSERTION|AI_PROPOSAL), sourceRefs, outsideFieldInspiration.
Do not claim that an unbuilt mechanism works. Outside-field inspiration must be labelled and must not change field membership.
Approved field snapshot: ${JSON.stringify({ id: snapshot.id, limitations: snapshot.limitations, retrievalIdentity: snapshot.retrievalIdentity })}
User focus and constraints: ${JSON.stringify(brief)}
Lead: ${JSON.stringify({ title: lead.title, problem: lead.problemStatement, mechanism: lead.proposedMechanism, elements: lead.elements, rationale: lead.rationale, sourceRefs: lead.sourceRefs })}`,
  })
  const raw = parseModelJson<{ proposals?: unknown[] }>(answer.output, 'Solution proposal generation')
  const proposals = (raw.proposals ?? []).map(item => proposalSchema.safeParse(item)).filter(result => result.success).map(result => result.data).slice(0, 3)
  if (!proposals.length) throw new Error('Proposal generation returned no usable concrete mechanism.')
  input.reporter.done()
  return { contractVersion: 2, snapshotId: snapshot.id, leadId: lead.id, proposals, resolvedModels: configured }
}

function compactReference(result: Awaited<ReturnType<typeof patentSearchOrchestrator.search>>['results'][number], id: string, familyKey?: string | null) {
  const passage = String(result.abstract || result.snippet || '').trim().slice(0, 3000)
  return {
    id,
    familyKey: familyKey || result.publicationNumber,
    publicationNumber: result.publicationNumber,
    title: result.title,
    publicationDate: result.publicationDate ?? null,
    filingDate: result.filingDate ?? null,
    sourceUrl: result.sourceUrl ?? result.link ?? null,
    sourcePageNumber: result.sourcePageNumber ?? null,
    providers: result.sourceProviders ?? [result.sourceProvider],
    passage,
    sourceHash: createHash('sha256').update(passage).digest('hex'),
    availableDepth: passage ? 'abstract-or-snippet' : 'metadata-only',
    readDepth: passage ? 'complete-returned-passage' : 'none',
    truncated: passage.length >= 3000,
  }
}

export async function runMinerGateStage(input: StageBase & {
  leadId: string
  snapshotId: string
  proposalRevisionId: string
  office: MinerOffice
  researchCutoff?: string
}) {
  const { lead, snapshot, proposal } = await loadLeadInputs(input.studyId, input.leadId, input.snapshotId, input.proposalRevisionId)
  const profile = RULE_PROFILES[input.office]
  await input.reporter.plan([
    { key: 'plan', label: 'Planning the prior-art search' },
    { key: 'retrieve', label: 'Retrieving prior art beyond the mined field' },
    { key: 'map', label: 'Mapping elements and relationships' },
    { key: 'assess', label: `Applying the ${input.office} rule profile` },
  ], [])
  const configured = await assertMinerStagesConfigured(input.llmContext, [
    { taskCode: TaskCode.IM_GATE, stageCode: MINER_RETRIEVAL_PLAN_STAGE_CODE },
    { taskCode: TaskCode.IM_GATE, stageCode: MINER_EVIDENCE_MAP_STAGE_CODE },
    { taskCode: TaskCode.IM_GATE, stageCode: MINER_INVENTIVE_STEP_STAGE_CODE },
    { taskCode: TaskCode.IM_GATE, stageCode: MINER_EXCLUSION_SCREEN_STAGE_CODE },
  ])
  const content = proposal!.content as Record<string, unknown>
  await input.reporter.step('plan', 'Building four bounded query variants')
  const planned = await runMinerLLM({
    taskCode: TaskCode.IM_GATE, stageCode: MINER_RETRIEVAL_PLAN_STAGE_CODE, context: input.llmContext,
    prompt: `Return JSON only: {"queries":[1 to 4 concise patent-search queries]}. Preserve the mechanism's interacting elements and relationships. Do not limit the search to the mined field. Proposal: ${JSON.stringify(content)}`,
  })
  const queryJson = parseModelJson<{ queries?: unknown[] }>(planned.output, 'Miner retrieval planning')
  const fallback = [String(content.mechanism || lead.proposedMechanism || lead.problemStatement)]
  const queries = (queryJson.queries ?? []).filter((q): q is string => typeof q === 'string' && !!q.trim()).map(q => q.trim().slice(0, 500)).slice(0, 4)
  if (!queries.length) queries.push(...fallback)
  await input.reporter.step('retrieve', `Running ${queries.length} bounded search variants`)
  const laneDiagnostics: SearchLaneDiagnostic[] = []
  const researchCutoff = input.researchCutoff && /^\d{4}-\d{2}-\d{2}$/.test(input.researchCutoff) ? input.researchCutoff : new Date().toISOString().slice(0, 10)
  const searches = []
  for (const query of queries) {
    const response = await patentSearchOrchestrator.search({
      query, inventionText: JSON.stringify(content), limit: 25, candidateLimit: 25,
      sourceMode: 'LOCAL_CORPUS', llmExpansion: false, laneDiagnostics,
      filters: { publicationDateTo: researchCutoff },
      requestHeaders: 'headers' in input.llmContext ? input.llmContext.headers : undefined, suppressSensitiveLogging: true,
    })
    searches.push({ query, response })
  }
  const byPublication = new Map<string, Awaited<ReturnType<typeof patentSearchOrchestrator.search>>['results'][number]>()
  for (const search of searches) for (const result of search.response.results) {
    if (!byPublication.has(result.publicationNumber)) byPublication.set(result.publicationNumber, result)
  }
  const familyRows = await prisma.localPatent.findMany({
    where: { publicationNumber: { in: Array.from(byPublication.keys()) } },
    select: { publicationNumber: true, familyId: true },
  })
  const familyByPublication = new Map(familyRows.map(row => [row.publicationNumber, row.familyId]))
  const seenFamilies = new Set<string>()
  const references: ReturnType<typeof compactReference>[] = []
  for (const result of Array.from(byPublication.values())) {
    const familyKey = familyByPublication.get(result.publicationNumber) || result.publicationNumber
    if (seenFamilies.has(familyKey)) continue
    const reference = compactReference(result, `R${references.length + 1}`, familyKey)
    if (reference.passage) {
      seenFamilies.add(familyKey)
      references.push(reference)
    }
    if (references.length >= 12) break
  }
  if (!references.length) {
    input.reporter.skip('map', 'No readable passages were returned')
    input.reporter.skip('assess', 'The search did not return evidence that can support an assessment')
    input.reporter.done()
    return officeAssessmentSchema.parse({
      contractVersion: 2, leadId: lead.id, office: input.office, outcome: 'UNASSESSED', snapshotId: snapshot.id,
      proposalRevisionId: proposal!.id, assessmentDate: new Date().toISOString(), researchCutoff,
      ruleProfile: profile, queries, limits: { queryVariants: 4, resultsPerVariant: 25, mappedFamilies: 12, secondaryReferences: 5 },
      references: [], laneDiagnostics, limitations: ['No readable prior-art passage was returned; no novelty or inventive-step conclusion was made.'],
      resolvedModels: configured,
    })
  }
  await input.reporter.step('map', `Mapping the proposal against ${references.length} readable families`)
  const mapped = await runMinerLLM({
    taskCode: TaskCode.IM_GATE, stageCode: MINER_EVIDENCE_MAP_STAGE_CODE, context: input.llmContext,
    prompt: `Return JSON only with: closestReferenceId, elementMap [{element,relationship,referenceId,verdict (DISCLOSED|PARTIAL|NOT_FOUND),quote,reason}], secondaryReferenceIds (max 5), novelty {result,reason}, inventiveStep {result,reason}, eligibility {result,reason}, disclosureSupport {result,reason}, contradictoryEvidence, missingEvidence, questions, overallOutcome (SUPPORTED_FOR_REVIEW|CONDITIONAL|BLOCKED|UNASSESSED), fullMatchReferenceId or null.
Use only reference IDs supplied below. Every DISCLOSED or PARTIAL row must include an exact contiguous quote from that reference's supplied passage; quote and paraphrased reason are separate. A full match requires ONE dated reference that discloses every element AND relationship. Separate documents may support inventive-step reasoning but never anticipation. Missing dates, uncertain wording, altered numbers, units, negation, conditions, causal order, or partial text cannot produce a decisive full match. Never say grantable and never give a probability.
Office: ${input.office}. Rule profile: ${JSON.stringify(profile)}.
Proposal: ${JSON.stringify(content)}
References with verbatim returned passages: ${JSON.stringify(references)}`,
  })
  const analysis = parseModelJson<Record<string, unknown>>(mapped.output, 'Miner evidence mapping')
  const ids = new Set(references.map(ref => ref.id))
  const fullId = typeof analysis.fullMatchReferenceId === 'string' && ids.has(analysis.fullMatchReferenceId) ? analysis.fullMatchReferenceId : null
  const suppliedMaps = Array.isArray(analysis.elementMap) ? analysis.elementMap.filter(row => row && typeof row === 'object' && ids.has(String((row as Record<string, unknown>).referenceId || ''))).slice(0, 40) : []
  const elementMap = suppliedMaps.flatMap(row => {
    const record = row as Record<string, unknown>
    if (record.verdict !== 'DISCLOSED' && record.verdict !== 'PARTIAL') return [record]
    const reference = references.find(ref => ref.id === String(record.referenceId || ''))
    const quote = typeof record.quote === 'string' ? record.quote : ''
    if (!reference || quote.split(/\s+/).length < 4 || gradeQuote(quote, reference.passage) !== 'exact') return []
    const pattern = quote.trim().split(/\s+/).map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
    const located = new RegExp(pattern, 'i').exec(reference.passage)
    if (!located) return []
    return [{ ...record, quote: located[0], quoteStart: located.index, quoteEnd: located.index + located[0].length }]
  })
  const droppedMappings = suppliedMaps.length - elementMap.length
  const inventiveResponse = await runMinerLLM({
    taskCode: TaskCode.IM_GATE, stageCode: MINER_INVENTIVE_STEP_STAGE_CODE, context: input.llmContext,
    prompt: `Return JSON only with result (SUPPORTED_FOR_REVIEW|CONDITIONAL|UNASSESSED), reasoning, closestReferenceId, secondaryReferenceIds, differences, limitations. Apply only this office profile; do not reuse an EPO analysis for another office and never say grantable. Office profile: ${JSON.stringify(profile)}. Approved proposal: ${JSON.stringify(content)}. Exact-quote-verified element map: ${JSON.stringify(elementMap)}. References: ${JSON.stringify(references.slice(0, 6))}`,
  })
  const inventiveStep = parseModelJson<Record<string, unknown>>(inventiveResponse.output, `${input.office} inventive-step assessment`)
  const exclusionResponse = await runMinerLLM({
    taskCode: TaskCode.IM_GATE, stageCode: MINER_EXCLUSION_SCREEN_STAGE_CODE, context: input.llmContext,
    prompt: `Return JSON only with result (SUPPORTED_FOR_REVIEW|CONDITIONAL|UNASSESSED), reasoning, issues, limitations. Screen this exact proposal under the office-specific eligibility/exclusion and disclosure-support checks below. Do not make a grant prediction. Office profile: ${JSON.stringify(profile)}. Proposal: ${JSON.stringify(content)}`,
  })
  const exclusion = parseModelJson<Record<string, unknown>>(exclusionResponse.output, `${input.office} exclusion assessment`)
  const proposalElements = Array.isArray(content.elements) ? content.elements.map(String) : []
  const proposalRelationships = Array.isArray(content.relationships) ? content.relationships.map(String) : []
  const fullRows = fullId ? elementMap.filter(row => String((row as Record<string, unknown>).referenceId) === fullId && (row as Record<string, unknown>).verdict === 'DISCLOSED') : []
  const fullReference = references.find(ref => ref.id === fullId)
  const norm = (value: unknown) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const disclosedElements = new Set(fullRows.map(row => norm((row as Record<string, unknown>).element)))
  const disclosedRelationships = new Set(fullRows.map(row => norm((row as Record<string, unknown>).relationship)).filter(Boolean))
  const verifiedFullMatch = !!fullReference?.publicationDate && proposalElements.length > 0 && proposalRelationships.length > 0 &&
    proposalElements.every(element => disclosedElements.has(norm(element))) && proposalRelationships.every(relationship => disclosedRelationships.has(norm(relationship)))
  const officeResults = [String(inventiveStep.result || ''), String(exclusion.result || '')]
  const requestedOutcome = officeResults.includes('UNASSESSED') ? 'UNASSESSED' : officeResults.includes('CONDITIONAL') ? 'CONDITIONAL' : String(analysis.overallOutcome || 'UNASSESSED')
  const outcome = verifiedFullMatch ? 'BLOCKED' : requestedOutcome === 'BLOCKED' && !verifiedFullMatch ? 'CONDITIONAL' :
    ['SUPPORTED_FOR_REVIEW', 'CONDITIONAL', 'BLOCKED', 'UNASSESSED'].includes(requestedOutcome) ? requestedOutcome : 'UNASSESSED'
  await input.reporter.step('assess', `Recording the ${input.office} assessment with its limits`)
  input.reporter.done()
  return officeAssessmentSchema.parse({
    contractVersion: 2, leadId: lead.id, office: input.office, outcome, verifiedFullMatch, snapshotId: snapshot.id,
    proposalRevisionId: proposal!.id, assessmentDate: new Date().toISOString(), researchCutoff,
    ruleProfile: profile, queries, limits: { queryVariants: 4, resultsPerVariant: 25, mappedFamilies: 12, secondaryReferences: 5 },
    references, laneDiagnostics, analysis: { ...analysis, elementMap, droppedMappings, inventiveStep, exclusion },
    limitations: ['Patent research is bounded to the recorded sources, dates, queries and text returned above.', ...(droppedMappings ? [`${droppedMappings} mapping row(s) were discarded because their supporting quote was not an exact supplied passage.`] : []), 'Patent-filing activity is an interest signal, not proof of market demand.', 'No new non-patent-literature provider is included in this release.'],
    resolvedModels: configured,
  })
}

export async function runMinerBriefStage(input: StageBase & {
  leadId: string
  snapshotId: string
  proposalRevisionId: string
  assessmentRunId: string
  office: MinerOffice
}) {
  const { lead, snapshot, proposal } = await loadLeadInputs(input.studyId, input.leadId, input.snapshotId, input.proposalRevisionId)
  const assessmentRun = await prisma.whitespaceRun.findFirst({ where: { id: input.assessmentRunId, studyId: input.studyId, stage: 'MINER_GATE', status: 'COMPLETED' } })
  const assessment = assessmentRun?.results as Record<string, unknown> | null
  if (!assessment || assessment.office !== input.office || assessment.proposalRevisionId !== proposal!.id || assessment.snapshotId !== snapshot.id) {
    throw new WhitespacePermanentError('The selected assessment does not match this proposal, field, and office.')
  }
  const assessmentRunId = assessmentRun!.id
  if (assessment.outcome === 'BLOCKED' || proposal!.reviews && Array.isArray(proposal!.reviews) && proposal!.reviews.some((r: any) => r?.verdict === 'REJECTED')) {
    throw new WhitespacePermanentError('A rejected proposal or verified full prior-art match needs a revised proposal and reassessment.')
  }
  if (assessment.outcome === 'CONDITIONAL') {
    const reviewed = Array.isArray(proposal!.reviews) && proposal!.reviews.some((r: any) => r?.assessmentRunId === assessmentRunId && String(r?.note || '').trim())
    if (!reviewed) throw new WhitespacePermanentError('Record a review note for the unresolved assessment risks before preparing a conditional brief.')
  }
  await input.reporter.plan([{ key: 'brief', label: `Preparing the ${input.office} invention brief and preliminary claims` }], [])
  await input.reporter.step('brief', 'Writing one evidence-backed report model')
  const configured = await assertMinerStagesConfigured(input.llmContext, [{ taskCode: TaskCode.IM_BRIEF, stageCode: MINER_BRIEF_STAGE_CODE }])
  const response = await runMinerLLM({
    taskCode: TaskCode.IM_BRIEF, stageCode: MINER_BRIEF_STAGE_CODE, context: input.llmContext,
    prompt: `Return JSON only with title, executiveSummary, citedProblem, approvedMechanism, differencesFromPriorArt, officeAssessment, preliminaryClaims (array of strings), assumptions, missingExperiments, coverageLimitations, questions.
Use Standard claim scope: include the concrete essential interacting elements supported by the approved proposal, but do not add invented embodiments, numerical ranges, performance results or user confirmations. Prior-art references are context, never a source of features for the invention. If mechanism detail is insufficient, return preliminaryClaims as [] and add explicit questions. English only.
Office: ${input.office}; rule profile: ${JSON.stringify(RULE_PROFILES[input.office])}.
Lead: ${JSON.stringify({ title: lead.title, problem: lead.problemStatement })}
Approved immutable proposal revision ${proposal!.revision}: ${JSON.stringify(proposal!.content)}
Assessment snapshot ${assessmentRunId}: ${JSON.stringify(assessment)}`,
  })
  const brief = briefContentSchema.parse(parseModelJson<Record<string, unknown>>(response.output, 'Miner brief'))
  const rawClaims = Array.isArray(brief.preliminaryClaims) ? brief.preliminaryClaims.map(String).filter(Boolean) : []
  let claimsStructured: ReturnType<typeof parseGeneratedClaimsFromLLMOutput> = []
  let claimFormFindings: ReturnType<typeof runOfficeFormLint> = []
  if (rawClaims.length) {
    try {
      claimsStructured = parseGeneratedClaimsFromLLMOutput(rawClaims.map((claim, index) => `${index + 1}. ${claim.replace(/^\s*\d+\s*[.):\-]\s*/, '')}`).join('\n'))
      const claimRules = resolveClaimRuleProfile(input.office).rules
      claimFormFindings = runOfficeFormLint(claimsStructured, { rules: claimRules, context: { components: Array.isArray((proposal!.content as any).elements) ? (proposal!.content as any).elements : [] } })
      brief.preliminaryClaims = claimsStructured.map(claim => `${claim.number}. ${claim.text}`)
    } catch {
      brief.preliminaryClaims = []
      brief.questions = [...(Array.isArray(brief.questions) ? brief.questions : []), 'The preliminary claim set could not be parsed reliably and must be supplied or regenerated.']
    }
  }
  input.reporter.done()
  return {
    contractVersion: 2, leadId: lead.id, office: input.office, snapshotId: snapshot.id, proposalRevisionId: proposal!.id,
    assessmentRunId, generatedAt: new Date().toISOString(), claimScope: 'STANDARD', language: 'en',
    brief, claimsStructured, claimFormFindings, ruleProfile: RULE_PROFILES[input.office], resolvedModels: configured,
  }
}

export function minerResultIdentity(result: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify({ snapshotId: result.snapshotId, proposalRevisionId: result.proposalRevisionId, office: result.office, assessmentRunId: result.assessmentRunId })).digest('hex')
}
