import { z } from 'zod'
import {
  buildNoveltyAttorneyReportModel,
  type AttorneyReportCitation,
  type AttorneyReportModel,
  type AttorneyReportPatentComparison,
} from './novelty-attorney-report'

/**
 * Projection of the novelty attorney report into the shapes the drafting pipeline consumes.
 *
 * Everything here is derived from `buildNoveltyAttorneyReportModel` so the professional PDF and
 * the drafting handoff can never disagree about what the assessment found. No Prisma access —
 * the API routes own persistence, this module stays pure and unit-testable.
 */

// Matches RelatedArtNoveltyThreat in ./drafting-related-art-review
export type NoveltyHandoffThreat = 'anticipates' | 'obvious' | 'adjacent' | 'remote' | 'unknown'

export interface NoveltyHandoffCitation {
  patentNumber: string
  title: string
  link: string
  abstract: string
  snippet: string
  score: number | null
  publicationDate: string
  filingDate: string
  applicationNumber: string
  cpcCodes: string[]
  ipcCodes: string[]
  inventors: string[]
  assignees: string[]
  referenceType: 'patent' | 'paper'
  noveltyThreat: NoveltyHandoffThreat
  overlapRiskLevel: string
  aiSummary: string
  noveltyComparison: string
  relevantParts: string[]
  irrelevantParts: string[]
  coverageScore: number
  /** true when the reference went through Stage 3.5 feature mapping */
  analysed: boolean
}

export interface NoveltyDraftingOpportunity {
  title: string
  opportunityType: string
  linkedFeatures: string[]
  explanation: string
}

export interface NoveltyClaimGuidance {
  primaryClaimFocus: string
  secondaryClaimFocus: string
  remainingInventiveCore: string
  whyStillDistinguishable: string
  weakClaimAreas: string[]
  avoidRelyingSolelyOn: string[]
  independentClaimFocus: string
  dependentClaimIdeas: string[]
  fallbackClaimIdeas: string[]
  reviewBeforeDrafting: string[]
  draftingOpportunities: NoveltyDraftingOpportunity[]
  mainDifferentiator: string
  overallDraftingDirection: string
}

export interface NoveltyHandoffRisk {
  noveltyRisk: string
  headline: string
  assessmentConfidence: string
  decision: string
  confidence: string
}

export interface NoveltyDraftingPayload {
  searchId: string
  title: string
  jurisdiction: string
  searchQuery: string
  inventionFeatures: string[]
  /** Feature-mapped references — these drive drafting */
  citations: NoveltyHandoffCitation[]
  /** Shortlisted but never feature-mapped — visible for reference, not selected */
  shortlisted: NoveltyHandoffCitation[]
  claimGuidance: NoveltyClaimGuidance
  findingsDigest: string
  risk: NoveltyHandoffRisk
}

const PLACEHOLDER_VALUES = new Set(['-', 'n/a', 'na', 'none', 'not available', 'unknown', 'not applicable'])

function cleanValue(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text || PLACEHOLDER_VALUES.has(text.toLowerCase())) return ''
  return text
}

/**
 * The report model stores classifications, inventors and assignees as display strings
 * ("A01B 1/00, A01B 3/00" or "-"), while RelatedArtSelection stores String[].
 */
export function splitEntityList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(item => cleanValue(item)).filter(Boolean)))
  }
  const text = cleanValue(value)
  if (!text) return []
  return Array.from(new Set(
    text
      .split(/[;,|]+|\s{2,}/)
      .map(part => part.trim())
      .filter(part => Boolean(cleanValue(part)))
  ))
}

/**
 * `AttorneyReportPatentComparison.noveltyThreat` is a human-facing label
 * ("High mapped-overlap risk"), not the drafting vocabulary. `rawNoveltyThreat` holds the
 * underlying decision, and `overlapRiskLevel` is the fallback when the raw value is unassessed.
 */
export function normalizeHandoffThreat(rawThreat: unknown, overlapRiskLevel?: unknown): NoveltyHandoffThreat {
  const text = String(rawThreat ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim()

  // Ordering mirrors safeOverlapLabel in ./novelty-attorney-report so the same input can never
  // classify one way in the report and another way in drafting. The `high`/`low` arms also
  // absorb the display labels ("High mapped-overlap risk") in case a caller passes one.
  if (/(anticipat|not novel|high)/.test(text)) return 'anticipates'
  if (/(obvious|partial)/.test(text)) return 'obvious'
  if (/(adjacent|related|medium|moderate)/.test(text)) return 'adjacent'
  if (/(remote|novel|low)/.test(text)) return 'remote'

  const level = String(overlapRiskLevel ?? '').toLowerCase().trim()
  if (level === 'high') return 'anticipates'
  if (level === 'medium') return 'adjacent'
  if (level === 'low') return 'remote'
  return 'unknown'
}

/** Tag applied to RelatedArtSelection rows so the drafting UI badges match an in-app AI review. */
export function threatTag(threat: NoveltyHandoffThreat): string {
  switch (threat) {
    case 'anticipates': return 'AI_ANTICIPATES'
    case 'obvious': return 'AI_OBVIOUS'
    case 'adjacent': return 'AI_ADJACENT'
    case 'remote': return 'AI_REMOTE'
    default: return 'AI_ANALYSIS_UNKNOWN'
  }
}

function comparisonToCitation(comparison: AttorneyReportPatentComparison): NoveltyHandoffCitation {
  const rows = Array.isArray(comparison.rows) ? comparison.rows : []
  const relevantParts = rows
    .filter(row => row.status === 'Present' || row.status === 'Partial')
    .map(row => cleanValue(row.userFeature))
    .filter(Boolean)
  const irrelevantParts = rows
    .filter(row => row.status === 'Absent')
    .map(row => cleanValue(row.userFeature))
    .filter(Boolean)

  return {
    patentNumber: comparison.publicationNumber,
    title: cleanValue(comparison.title) || 'Untitled Patent',
    link: cleanValue(comparison.link),
    abstract: cleanValue(comparison.technicalDisclosure),
    snippet: cleanValue(comparison.technicalDisclosure),
    score: comparison.relevanceScore ?? null,
    publicationDate: cleanValue(comparison.publicationDate),
    filingDate: cleanValue(comparison.filingDate),
    applicationNumber: cleanValue(comparison.applicationNumber),
    cpcCodes: splitEntityList(comparison.cpcCodes),
    ipcCodes: splitEntityList(comparison.ipcCodes),
    inventors: splitEntityList(comparison.inventors),
    assignees: splitEntityList(comparison.assignees),
    referenceType: comparison.referenceType,
    noveltyThreat: normalizeHandoffThreat(comparison.rawNoveltyThreat, comparison.overlapRiskLevel),
    overlapRiskLevel: comparison.overlapRiskLevel,
    aiSummary: cleanValue(comparison.summary),
    noveltyComparison: cleanValue(comparison.claimImpactSummary),
    relevantParts,
    irrelevantParts,
    coverageScore: comparison.coverage?.score ?? 0,
    analysed: true,
  }
}

function shortlistToCitation(citation: AttorneyReportCitation): NoveltyHandoffCitation {
  return {
    patentNumber: citation.publicationNumber,
    title: cleanValue(citation.title) || 'Untitled Patent',
    link: '',
    abstract: '',
    snippet: '',
    score: citation.relevanceScore ?? null,
    publicationDate: '',
    filingDate: '',
    applicationNumber: '',
    cpcCodes: [],
    ipcCodes: [],
    inventors: [],
    assignees: [],
    referenceType: citation.referenceType,
    noveltyThreat: 'unknown',
    overlapRiskLevel: 'Needs Review',
    aiSummary: '',
    noveltyComparison: '',
    relevantParts: [],
    irrelevantParts: [],
    coverageScore: 0,
    analysed: false,
  }
}

function bulletList(items: string[], limit = 8): string {
  return items.filter(Boolean).slice(0, limit).map(item => `- ${item}`).join('\n')
}

/**
 * Prose block summarising what the assessment found. Written for an LLM audience: the idea
 * refiner reads it as context, and it is stored on the session for the user to review.
 */
export function buildFindingsDigest(model: AttorneyReportModel): string {
  const sections: string[] = []

  sections.push(`OVERALL: ${model.riskAssessment.headline} (novelty risk: ${model.riskAssessment.noveltyRisk}, confidence: ${model.riskAssessment.assessmentConfidence}).`)

  if (model.finalAssessment?.summary) {
    sections.push(`SUMMARY:\n${model.finalAssessment.summary}`)
  }

  const closest = model.mainComparisons?.length ? model.mainComparisons : model.comparisons
  if (closest?.length) {
    const refLines = closest.slice(0, 5).map(item => {
      const present = (item.rows || []).filter(row => row.status === 'Present').map(row => row.userFeature)
      const absent = (item.rows || []).filter(row => row.status === 'Absent').map(row => row.userFeature)
      const parts = [
        `${item.publicationNumber} — ${item.title} [${item.overlapRiskLevel} overlap]`,
        item.summary ? `  ${item.summary}` : '',
        present.length ? `  Teaches: ${present.slice(0, 6).join('; ')}` : '',
        absent.length ? `  Does not teach: ${absent.slice(0, 6).join('; ')}` : '',
      ]
      return parts.filter(Boolean).join('\n')
    })
    sections.push(`CLOSEST REFERENCES:\n${refLines.join('\n')}`)
  }

  if (model.potentialDifferentiationSpace) {
    sections.push(`DIFFERENTIATION SPACE:\n${model.potentialDifferentiationSpace}`)
  }

  if (model.finalAssessment?.risks?.length) {
    sections.push(`RISKS:\n${bulletList(model.finalAssessment.risks)}`)
  }

  if (model.finalAssessment?.recommendations?.length) {
    sections.push(`RECOMMENDATIONS:\n${bulletList(model.finalAssessment.recommendations)}`)
  }

  return sections.filter(Boolean).join('\n\n')
}

function buildClaimGuidance(model: AttorneyReportModel): NoveltyClaimGuidance {
  const positioning = model.claimPositioningAnalysis
  const considerations = model.claimDraftingConsiderations

  return {
    primaryClaimFocus: cleanValue(positioning?.primaryClaimFocus),
    secondaryClaimFocus: cleanValue(positioning?.secondaryClaimFocus),
    remainingInventiveCore: cleanValue(positioning?.remainingInventiveCore),
    whyStillDistinguishable: cleanValue(positioning?.whyStillDistinguishable),
    weakClaimAreas: (positioning?.weakClaimAreas || []).map(cleanValue).filter(Boolean),
    avoidRelyingSolelyOn: (positioning?.avoidRelyingSolelyOn || []).map(cleanValue).filter(Boolean),
    independentClaimFocus: cleanValue(considerations?.independentClaimFocus),
    dependentClaimIdeas: (considerations?.dependentClaimIdeas || []).map(cleanValue).filter(Boolean),
    fallbackClaimIdeas: (considerations?.fallbackClaimIdeas || []).map(cleanValue).filter(Boolean),
    reviewBeforeDrafting: (considerations?.reviewBeforeDrafting || []).map(cleanValue).filter(Boolean),
    draftingOpportunities: (model.draftingOpportunities || []).map(item => ({
      title: cleanValue(item.title),
      opportunityType: item.opportunityType,
      linkedFeatures: (item.linkedFeatures || []).map(cleanValue).filter(Boolean),
      explanation: cleanValue(item.explanation),
    })).filter(item => item.title || item.explanation),
    mainDifferentiator: cleanValue(model.mainDifferentiator),
    overallDraftingDirection: cleanValue(model.overallDraftingDirection),
  }
}

export function buildNoveltyDraftingPayload(searchRun: any): NoveltyDraftingPayload {
  const model = buildNoveltyAttorneyReportModel(searchRun)
  const stage0 = searchRun?.stage0Results || searchRun?.stage0 || {}

  const citations = (model.comparisons || []).map(comparisonToCitation)
  const analysedKeys = new Set(citations.map(item => canonicalHandoffPatentNumber(item.patentNumber)))
  const shortlisted = (model.otherShortlistedCitations || [])
    .map(shortlistToCitation)
    .filter(item => {
      const key = canonicalHandoffPatentNumber(item.patentNumber)
      return Boolean(key) && !analysedKeys.has(key)
    })

  return {
    searchId: String(searchRun?.id || ''),
    title: cleanValue(searchRun?.title) || model.inventionTitle,
    jurisdiction: cleanValue(searchRun?.jurisdiction) || 'IN',
    searchQuery: cleanValue(stage0?.searchQuery) || model.searchQuery,
    inventionFeatures: Array.isArray(stage0?.inventionFeatures)
      ? stage0.inventionFeatures.map(cleanValue).filter(Boolean)
      : model.inventionFeatures,
    citations,
    shortlisted,
    claimGuidance: buildClaimGuidance(model),
    findingsDigest: buildFindingsDigest(model),
    risk: {
      noveltyRisk: model.riskAssessment.noveltyRisk,
      headline: model.riskAssessment.headline,
      assessmentConfidence: model.riskAssessment.assessmentConfidence,
      decision: model.finalAssessment.decision,
      confidence: model.finalAssessment.confidence,
    },
  }
}

export function canonicalHandoffPatentNumber(value: unknown): string {
  const text = String(value || '').trim()
  if (!text || PLACEHOLDER_VALUES.has(text.toLowerCase())) return ''
  return text.toUpperCase().replace(/[^A-Z0-9:]/g, '')
}

/**
 * Prompt block injected into preliminary-claim generation and claim refinement so the drafted
 * claims track the positioning the assessment established instead of rediscovering it.
 */
export function buildNoveltyGuidanceBlock(guidance: NoveltyClaimGuidance | null | undefined): string {
  if (!guidance) return ''

  const lines: string[] = []
  if (guidance.primaryClaimFocus) lines.push(`Primary claim focus: ${guidance.primaryClaimFocus}`)
  if (guidance.secondaryClaimFocus) lines.push(`Secondary claim focus: ${guidance.secondaryClaimFocus}`)
  if (guidance.remainingInventiveCore) lines.push(`Remaining inventive core: ${guidance.remainingInventiveCore}`)
  if (guidance.whyStillDistinguishable) lines.push(`Why still distinguishable: ${guidance.whyStillDistinguishable}`)
  if (guidance.mainDifferentiator) lines.push(`Main differentiator: ${guidance.mainDifferentiator}`)
  if (guidance.independentClaimFocus) lines.push(`Independent claim focus: ${guidance.independentClaimFocus}`)

  const blocks: string[] = []
  if (lines.length) blocks.push(lines.join('\n'))
  if (guidance.avoidRelyingSolelyOn.length) {
    blocks.push(`DO NOT rely on these alone for novelty (mapped to cited prior art):\n${bulletList(guidance.avoidRelyingSolelyOn)}`)
  }
  if (guidance.weakClaimAreas.length) {
    blocks.push(`Weak claim areas — narrow or support these:\n${bulletList(guidance.weakClaimAreas)}`)
  }
  if (guidance.dependentClaimIdeas.length) {
    blocks.push(`Dependent claim ideas:\n${bulletList(guidance.dependentClaimIdeas)}`)
  }
  if (guidance.fallbackClaimIdeas.length) {
    blocks.push(`Fallback claim positions:\n${bulletList(guidance.fallbackClaimIdeas)}`)
  }
  if (guidance.draftingOpportunities.length) {
    const opportunities = guidance.draftingOpportunities
      .slice(0, 8)
      .map(item => `- [${item.opportunityType}] ${item.title}: ${item.explanation}`)
      .join('\n')
    blocks.push(`Drafting opportunities:\n${opportunities}`)
  }

  if (!blocks.length) return ''

  return `NOVELTY ASSESSMENT CLAIM GUIDANCE (derived from a completed prior-art assessment of THIS invention — treat as authoritative positioning input)
${blocks.join('\n\n')}

Draft the independent claim around the primary claim focus and the remaining inventive core. Do not build the independent claim solely on any element listed under "DO NOT rely on these alone". This guidance informs scope; it never overrides source support or enablement.`
}

// ── Idea refinement ────────────────────────────────────────────────────────────────────────

export interface IdeaRefinementInput {
  originalTitle: string
  originalDescription: string
  payload: NoveltyDraftingPayload
}

export function buildIdeaRefinementPrompt(input: IdeaRefinementInput): string {
  const { originalTitle, originalDescription, payload } = input
  const guidance = buildNoveltyGuidanceBlock(payload.claimGuidance)

  const featureBlock = payload.inventionFeatures.length
    ? `EXTRACTED INVENTION FEATURES:\n${bulletList(payload.inventionFeatures, 20)}`
    : ''

  return `You are a senior patent attorney refining an invention disclosure before drafting begins.

A prior-art novelty assessment has already been run on this invention. Your job is to rewrite the
disclosure so that it leads with what the assessment confirmed is distinguishable, and stops leading
with what the assessment showed is already taught by the cited art. You are NOT inventing new subject
matter and you are NOT deleting the invention's substance.

ORIGINAL TITLE:
${originalTitle}

ORIGINAL INVENTION DESCRIPTION:
${originalDescription}

${featureBlock}

NOVELTY ASSESSMENT FINDINGS:
${payload.findingsDigest}

${guidance}

RULES:
- Preserve every technical fact present in the original description. You may reorder, re-emphasise
  and clarify; you may NOT add technical facts, numbers, materials, or results that are not in the
  original. If something is needed for support but absent, list it under "openQuestions" instead.
- Lead the description with the differentiating combination: the elements the assessment found
  Absent or only partially mapped in the cited references, and the relationships between them.
- Keep features that the assessment found already taught, but frame them as context or as part of a
  combination rather than as the point of novelty.
- Do not mention the assessment, the cited patents, or this instruction inside refinedDescription.
  It must read as a clean standalone invention disclosure.
- The refined title must be 15 words or fewer and must not use marketing language.
- Write refinedDescription as flowing technical prose, 250-700 words.

Return ONLY valid JSON, no markdown fences, in exactly this shape:
{
  "refinedTitle": "string, <= 15 words",
  "refinedDescription": "string, 250-700 words of technical prose",
  "abstract": "string, single paragraph <= 150 words",
  "keyFeatures": ["technical feature phrases, 3-10 items"],
  "potentialApplications": ["application areas, 2-6 items"],
  "domainTags": ["lowercase domain tags, 2-6 items"],
  "technicalField": "string, short field label",
  "changeLog": ["what changed vs the original and which finding drove it, 2-8 items"],
  "openQuestions": ["support gaps the inventor must fill before drafting, 0-6 items"]
}`
}

const NonEmptyString = z.string().transform(value => value.trim()).refine(Boolean, 'Required')

const StringListSchema = z.preprocess(
  value => (Array.isArray(value) ? value : []),
  z.array(z.string().transform(value => value.trim()).refine(Boolean)).max(20),
)

export const IdeaRefinementResponseSchema = z.object({
  refinedTitle: NonEmptyString,
  refinedDescription: NonEmptyString,
  abstract: z.string().transform(value => value.trim()).optional().default(''),
  keyFeatures: StringListSchema.optional().default([]),
  potentialApplications: StringListSchema.optional().default([]),
  domainTags: StringListSchema.optional().default([]),
  technicalField: z.string().transform(value => value.trim()).optional().default(''),
  changeLog: StringListSchema.optional().default([]),
  openQuestions: StringListSchema.optional().default([]),
})

export type IdeaRefinementResponse = z.infer<typeof IdeaRefinementResponseSchema>

/**
 * Tolerates the usual LLM envelope drift: markdown fences, leading prose, trailing commentary.
 */
export function parseIdeaRefinementResponse(raw: unknown): {
  success: true
  data: IdeaRefinementResponse
} | {
  success: false
  error: string
} {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')
  if (!text.trim()) return { success: false, error: 'Empty response from the refinement model.' }

  let candidate: unknown = null

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const jsonSlice = fenced
    ? fenced[1]
    : (() => {
        const start = text.indexOf('{')
        const end = text.lastIndexOf('}')
        return start >= 0 && end > start ? text.slice(start, end + 1) : ''
      })()

  if (!jsonSlice.trim()) return { success: false, error: 'Refinement response contained no JSON object.' }

  try {
    candidate = JSON.parse(jsonSlice)
  } catch {
    return { success: false, error: 'Refinement response was not valid JSON.' }
  }

  const parsed = IdeaRefinementResponseSchema.safeParse(candidate)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { success: false, error: `Refinement response failed validation: ${issue?.path.join('.') || 'root'} ${issue?.message || ''}`.trim() }
  }

  const titleWords = parsed.data.refinedTitle.split(/\s+/).filter(Boolean)
  if (titleWords.length > 15) {
    parsed.data.refinedTitle = titleWords.slice(0, 15).join(' ')
  }

  return { success: true, data: parsed.data }
}

// ── Drafting-session seeding helpers ───────────────────────────────────────────────────────

/**
 * Shape mirrors `toDraftingRelatedArtResult` in the drafting route (which is private to that
 * file). RelatedArtStage hydrates its results table straight from `RelatedArtRun.resultsJson`,
 * so every alias it reads has to be present.
 */
export function toRelatedArtResultSeed(citation: NoveltyHandoffCitation): Record<string, unknown> {
  const pn = citation.patentNumber
  return {
    publicationNumber: pn,
    publication_number: pn,
    patent_number: pn,
    pn,
    id: pn,
    title: citation.title,
    abstract: citation.abstract,
    snippet: citation.snippet || citation.abstract,
    publicationDate: citation.publicationDate,
    publication_date: citation.publicationDate,
    filingDate: citation.filingDate,
    filing_date: citation.filingDate,
    applicationNumber: citation.applicationNumber,
    score: citation.score,
    relevance: citation.score,
    cpc_codes: citation.cpcCodes,
    cpcCodes: citation.cpcCodes,
    ipc_codes: citation.ipcCodes,
    ipcCodes: citation.ipcCodes,
    inventors: citation.inventors,
    assignees: citation.assignees,
    providerId: 'novelty-search',
    sourceProvider: 'Novelty Assessment',
    sourceProviders: ['Novelty Assessment'],
    provider: 'Novelty Assessment',
    link: citation.link,
    sourceUrl: citation.link,
    referenceType: citation.referenceType,
    noveltyThreat: citation.noveltyThreat,
    aiSummary: citation.aiSummary,
    noveltyComparison: citation.noveltyComparison,
  }
}

/**
 * Shape mirrors what RelatedArtStage writes via `save_ai_analysis`, so imported analysis renders
 * identically to an in-app AI review.
 */
export function buildAiAnalysisMap(citations: NoveltyHandoffCitation[]): Record<string, unknown> {
  const map: Record<string, unknown> = {}
  for (const citation of citations) {
    if (!citation.analysed || !citation.patentNumber) continue
    map[citation.patentNumber] = {
      aiSummary: citation.aiSummary,
      noveltyThreat: citation.noveltyThreat,
      relevantParts: citation.relevantParts,
      irrelevantParts: citation.irrelevantParts,
      noveltyComparison: citation.noveltyComparison,
      source: 'novelty_assessment',
    }
  }
  return map
}

const THREAT_PRIORITY: Record<NoveltyHandoffThreat, number> = {
  anticipates: 0,
  obvious: 1,
  adjacent: 2,
  remote: 3,
  unknown: 4,
}

/** Highest-threat references first, then strongest feature coverage. */
export function rankCitationsForClaimRefinement(
  citations: NoveltyHandoffCitation[],
  limit = 5,
): NoveltyHandoffCitation[] {
  return [...citations]
    .filter(citation => citation.analysed)
    .sort((a, b) => {
      const byThreat = THREAT_PRIORITY[a.noveltyThreat] - THREAT_PRIORITY[b.noveltyThreat]
      if (byThreat !== 0) return byThreat
      return (b.coverageScore || 0) - (a.coverageScore || 0)
    })
    .slice(0, Math.max(0, limit))
}

/** Shape read by DraftingService.generateSections via priorArtConfig.priorArtForDrafting. */
export function toSelectedPatentEntry(citation: NoveltyHandoffCitation): Record<string, unknown> {
  return {
    patentNumber: citation.patentNumber,
    title: citation.title,
    snippet: citation.snippet || citation.abstract,
    score: citation.score,
    publicationDate: citation.publicationDate,
    cpcCodes: citation.cpcCodes,
    ipcCodes: citation.ipcCodes,
    inventors: citation.inventors,
    assignees: citation.assignees,
    aiSummary: citation.aiSummary,
    noveltyComparison: citation.noveltyComparison,
    noveltyThreat: citation.noveltyThreat,
    source: 'novelty_assessment',
  }
}
