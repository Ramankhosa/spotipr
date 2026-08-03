import crypto from 'crypto'
import fs from 'fs/promises'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { buildSourceFactLedgerEntries } from '@/lib/source-fact-ledger'
import { recordServiceCompletion } from '@/lib/service-completion'
import { coerceSupportDataSources } from '@/lib/support-data-sources'
import { EXTREME_ASPECT_RATIO_MAXIMUM, EXTREME_ASPECT_RATIO_MINIMUM } from '@/lib/plantuml-renderer'
import { renderAndWriteDiagramArtifacts, resolveDiagramPagePolicy } from './artifacts'
import { buildPatentDiagram } from './builders'
import { decomposePatentDiagram } from './complexity'
import { normalizePatentDiagram } from './normalize'
import { PATENT_DIAGRAM_COMPLEXITY } from './policy'
import { PATENT_DIAGRAM_STYLE } from './style'
import { validatePatentDiagram } from './validation'
import { buildDiagramDetailPrompt, buildFigureSetPlanningPrompt, extractJsonObject } from './prompts'
import {
  buildCoverageExtractionPrompt,
  buildDisclosureCoverageLedger,
  coverageEvidenceEntries,
  coverageExtractionSchema,
  evaluateCoverageLedger,
  materializeCoverageLedger,
  normalizeCoverageClaims,
  repairFigureSetCoverage,
  stageCoverageComponentAdditions,
  uncoveredClaimLimitations,
} from './coverage'
import {
  figureSetPlanSchema,
  patentDiagramSchema,
  type BuiltPatentDiagram,
  type FigureSetPlan,
  type FigureSetPlanItem,
  type FigureCoverageLedger,
  type PatentDiagram,
  type PatentDiagramComponent,
} from './types'

const GENERATED_FIGURE_LIMIT = 900
// Six is the planning target, not a truncation limit. Coverage repair and
// filing-scale decomposition may exceed it, subject to the per-run safety cap.
const AUTO_MODE_FIGURE_TARGET = 6
const MAXIMUM_MANAGED_FIGURES_PER_RUN = 20

export class PatentDiagramPipelineError extends Error {
  status: number
  details?: unknown
  code: string
  stage: 'COVERAGE' | 'PLAN' | 'DETAIL' | 'VALIDATION' | 'RENDER' | 'PERSIST' | 'GENERAL'
  retryable: boolean
  actions: string[]
  automaticCorrection?: { attempted: boolean; attempts: number; result: 'FAILED' | 'NOT_ATTEMPTED' }

  constructor(message: string, status = 400, details?: unknown, options?: {
    code?: string
    stage?: PatentDiagramPipelineError['stage']
    retryable?: boolean
    actions?: string[]
    automaticCorrection?: PatentDiagramPipelineError['automaticCorrection']
  }) {
    super(message)
    this.name = 'PatentDiagramPipelineError'
    this.status = status
    this.details = details
    this.code = options?.code || 'PATENT_DIAGRAM_PIPELINE_ERROR'
    this.stage = options?.stage || 'GENERAL'
    this.retryable = options?.retryable ?? status >= 500
    this.actions = options?.actions || ['Try the operation again.', 'If it repeats, simplify the requested figure and review the technical details.']
    this.automaticCorrection = options?.automaticCorrection
  }
}

// Stage 0 stores richer claim-support metadata than figure planning needs; only
// the two fields that decide coverage are carried through. Anything unparseable
// becomes null, which downstream code reads as "unknown", not "not claimed".
function normalizeComponentClaimSupport(value: any): PatentDiagramComponent['claimSupport'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const matchedClaims: number[] = Array.isArray(value.matchedClaims)
    ? Array.from(new Set<number>(value.matchedClaims
        .map((claim: unknown) => Number(claim))
        .filter((claim: number) => Number.isInteger(claim) && claim > 0)))
      .sort((a, b) => a - b)
    : []
  const claimRole = value.claimRole === 'claim_1' || value.claimRole === 'dependent_claim'
    ? value.claimRole
    : null
  if (!matchedClaims.length && !claimRole) return null
  return { matchedClaims, claimRole }
}

export function extractReferenceMapComponents(referenceMap: any): PatentDiagramComponent[] {
  const stored = referenceMap?.components
  const rows = Array.isArray(stored)
    ? stored
    : Array.isArray(stored?.components)
      ? stored.components
      : []
  const candidates: Array<PatentDiagramComponent & { parentName: string | null }> = rows.flatMap((component: any, index: number) => {
    const id = String(component?.id || '').trim()
    const name = String(component?.name || '').trim()
    if (!id || !name) return []
    return [{
      id,
      name,
      type: component?.type ? String(component.type) : null,
      description: component?.description ? String(component.description) : null,
      referenceLabel: String(component?.referenceLabel || component?.numeral || component?.range || index + 1),
      parentId: component?.parentId ? String(component.parentId) : component?.parent?.id ? String(component.parent.id) : null,
      parentName: typeof component?.parent === 'string' ? component.parent.trim() : null,
      // Stage 0 already works out which components the claims name; this
      // extraction used to drop that, so figure planning had no idea which
      // components the claims actually depend on.
      claimSupport: normalizeComponentClaimSupport(component?.claimSupport),
    }]
  })
  const idByName = new Map(candidates.map(component => [component.name.toLowerCase(), component.id]))
  return candidates.map(({ parentName, ...component }) => ({
    ...component,
    parentId: component.parentId || (parentName ? idByName.get(parentName.toLowerCase()) || null : null),
  }))
}

// Semantic models round-trip through Postgres JSONB, which normalizes object
// key order. Checksums must therefore hash a canonical (sorted-key) form, or
// a freshly generated figure would immediately compare as stale at export.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function semanticChecksum(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function claimsContextFromIdea(idea: any): unknown {
  return idea?.claimsStructuredFinal
    || idea?.claimsStructured
    || idea?.claimsFinal
    || idea?.claims
    || []
}

function evidenceCatalogFromIdea(idea: any): Array<{ id: string; value: string }> {
  const sourceFacts = buildSourceFactLedgerEntries(idea?.sourceFactLedger).map(entry => ({
    id: entry.id,
    value: entry.value,
  }))
  const supportSources = coerceSupportDataSources(idea?.supportDataSources)
    .filter(source => source.status !== 'deleted'
      && source.status !== 'unsupported'
      && source.status !== 'not_stated'
      && source.figureUse !== 'do_not_show'
      && source.claimUse !== 'do_not_claim')
    .map(source => ({ id: source.id, value: source.value || source.label }))
  return Array.from(new Map([...sourceFacts, ...supportSources].map(entry => [entry.id, entry])).values())
}

async function loadPipelineContext(userId: string, patentId: string, sessionId: string) {
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId },
    include: {
      referenceMap: true,
      ideaRecord: true,
      figurePlans: { orderBy: { figureNo: 'asc' } },
      diagramSources: true,
    },
  })
  if (!session) throw new PatentDiagramPipelineError('Session not found or access denied', 404)
  const components = extractReferenceMapComponents(session.referenceMap)
  if (!components.length) throw new PatentDiagramPipelineError('Save a valid Component Plan before generating figures')
  if (session.referenceMap && session.referenceMap.isValid === false) {
    throw new PatentDiagramPipelineError('The Component Plan is stale or invalid. Re-save it before generating figures')
  }
  const idea = (session.ideaRecord?.normalizedData as any) || {}
  const countryCode = session.activeJurisdiction || session.draftingJurisdictions[0] || 'US'
  const evidenceCatalog = evidenceCatalogFromIdea(idea)
  const storedReferenceMap = (session.referenceMap?.components as any) || {}
  const storedComponents = Array.isArray(storedReferenceMap)
    ? storedReferenceMap
    : Array.isArray(storedReferenceMap?.components)
      ? storedReferenceMap.components
      : []
  const numberingStyle = String(storedReferenceMap?.numberingStyle || 'NUMERIC_BUCKET')
  const existingFigures = session.figurePlans
    .filter(figure => figure.figureNo < GENERATED_FIGURE_LIMIT)
    .map(figure => {
      const semantic = figure.semanticModel && typeof figure.semanticModel === 'object' ? figure.semanticModel as any : null
      const componentIds = Array.from(new Set<string>([
        ...(Array.isArray(semantic?.components) ? semantic.components.map((item: any) => item?.componentId) : []),
        ...(Array.isArray(semantic?.participants) ? semantic.participants.map((item: any) => item?.componentId) : []),
        ...(Array.isArray(semantic?.nodes) ? semantic.nodes.flatMap((item: any) => [item?.componentId, ...(item?.relatedComponentIds || [])]) : []),
        ...(Array.isArray(semantic?.constituents) ? semantic.constituents.map((item: any) => item?.componentId) : []),
      ].filter(Boolean)))
      return {
        figureNo: figure.figureNo,
        title: figure.title,
        kind: figure.diagramType,
        componentIds,
        coverageRequirementIds: Array.isArray(semantic?.coverageRequirementIds) ? semantic.coverageRequirementIds.filter((id: unknown) => typeof id === 'string') : [],
      }
    })
  return {
    session,
    components,
    referenceMapChecksum: semanticChecksum((session.referenceMap as any)?.components || []),
    idea,
    claims: claimsContextFromIdea(idea),
    evidenceCatalog,
    supportedEvidenceIds: new Set(evidenceCatalog.map(entry => entry.id)),
    pagePolicy: await resolveDiagramPagePolicy(countryCode),
    countryCode,
    storedComponents,
    numberingStyle,
    existingFigures,
  }
}

export async function executeStructured<S extends z.ZodTypeAny>(input: {
  userHeaders: Record<string, string>
  stageCode: 'DRAFT_FIGURE_PLANNER' | 'DRAFT_DIAGRAM_GENERATION'
  prompt: string
  schema: S
  metadata: Record<string, unknown>
}): Promise<z.output<S>> {
  const { llmGateway } = await import('@/lib/metering/gateway')
  let prompt = input.prompt
  let previousOutput = ''
  let previousErrors = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) {
      const boundedErrors = previousErrors.slice(0, 4_000)
      const boundedOutput = previousOutput.slice(0, 12_000)
      prompt = `${input.prompt}\n\nYour previous JSON was invalid. Correct it without changing supported semantics.\nVALIDATION ERRORS:\n${boundedErrors}\nPREVIOUS OUTPUT (bounded):\n${boundedOutput}`
    }
    const result = await llmGateway.executeLLMOperation({ headers: input.userHeaders || {} }, {
      taskCode: 'LLM3_DIAGRAM',
      stageCode: input.stageCode,
      prompt,
      idempotencyKey: crypto.randomUUID(),
      inputTokens: Math.ceil(prompt.length / 4),
      metadata: { ...input.metadata, structuredDiagram: true, attempt: attempt + 1 },
    })
    if (!result.success || !result.response?.output) {
      throw new PatentDiagramPipelineError(result.error?.message || 'Diagram LLM request failed', 502, result.error, {
        code: 'DIAGRAM_PROVIDER_FAILED', stage: input.stageCode === 'DRAFT_FIGURE_PLANNER' ? 'PLAN' : 'DETAIL', retryable: true,
        actions: ['Try again.', 'If it repeats, ask an administrator to verify the configured diagram model and token limits.'],
      })
    }
    previousOutput = result.response.output
    try {
      const parsed = input.schema.safeParse(extractJsonObject(previousOutput))
      if (parsed.success) return parsed.data
      previousErrors = parsed.error.issues.map(issue => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('\n')
    } catch (error) {
      previousErrors = error instanceof Error ? error.message : 'Invalid JSON'
    }
  }
  throw new PatentDiagramPipelineError('The diagram model answered twice, but neither reply matched the required structured format.', 422, previousErrors, {
    code: 'INVALID_STRUCTURED_DIAGRAM', stage: input.stageCode === 'DRAFT_FIGURE_PLANNER' ? 'PLAN' : 'DETAIL', retryable: true,
    actions: ['Try again to request a fresh structured reply.', 'If it repeats, simplify the figure instructions or verify the Component Plan.', 'Ask an administrator to check the model output-token limit.'],
    automaticCorrection: { attempted: true, attempts: 1, result: 'FAILED' },
  })
}

function assertPlanComponentIds(plan: FigureSetPlan, components: PatentDiagramComponent[]) {
  const known = new Set(components.map(component => component.id))
  const unknown = plan.figures.flatMap(figure => [
    ...figure.componentIds,
    ...figure.claimCriticalComponentIds,
    ...figure.orderedGroups.flatMap(group => group.componentIds),
  ]).filter(id => !known.has(id))
  if (unknown.length) throw new PatentDiagramPipelineError(`Figure plan referenced unknown Component Planner IDs: ${Array.from(new Set(unknown)).join(', ')}`, 422)
}

export interface PatentDiagramPipelineInput {
  userId: string
  patentId: string
  sessionId: string
  requestHeaders: Record<string, string>
  figureCount?: number | null
  instructions?: string
  includeExistingFigures?: boolean
  mode?: 'ai' | 'manual'
}

export interface FigureSetPlanCoverage {
  /** Claim-named components that no planned figure depicts. */
  missing: Array<{ id: string; name: string; referenceLabel: string; matchedClaims: number[] }>
  /** False when Stage 0 claim matching has not run, so coverage is unknown. */
  evaluated: boolean
}

// Coverage is reported, never enforced. Validation already checks that each
// figure delivers the claim-critical components it declared, but nothing checked
// the set as a whole — a claimed component the planner simply never mentioned
// was invisible. This closes that, as information for the attorney approving the
// plan rather than as a gate: claim matching is optional upstream, so a hard
// failure here would block figures for anyone who has not run it.
export function evaluateFigureSetClaimCoverage(
  plan: { figures: Array<{ componentIds: string[]; orderedGroups: Array<{ componentIds: string[] }> }> },
  components: PatentDiagramComponent[],
): FigureSetPlanCoverage {
  const claimed = components.filter(component => (component.claimSupport?.matchedClaims?.length || 0) > 0)
  if (!claimed.length) return { missing: [], evaluated: false }
  const depicted = new Set(plan.figures.flatMap(figure => [
    ...figure.componentIds,
    ...figure.orderedGroups.flatMap(group => group.componentIds),
  ]))
  return {
    evaluated: true,
    missing: claimed
      .filter(component => !depicted.has(component.id))
      .map(component => ({
        id: component.id,
        name: component.name,
        referenceLabel: component.referenceLabel,
        matchedClaims: component.claimSupport?.matchedClaims || [],
      })),
  }
}

function planningContextChecksum(
  context: Awaited<ReturnType<typeof loadPipelineContext>>,
  input?: Pick<PatentDiagramPipelineInput, 'instructions'>,
): string {
  return semanticChecksum({
    claims: normalizeCoverageClaims(context.claims),
    inventionFacts: context.idea,
    components: context.storedComponents,
    evidenceCatalog: context.evidenceCatalog,
    jurisdiction: context.countryCode,
    instructions: input?.instructions || null,
    existingFigures: context.existingFigures,
  })
}

function persistedAutomaticComponent(addition: FigureSetPlan['pendingComponentAdditions'][number]) {
  return {
    ...addition,
    autoGenerated: true,
    autoGeneratedBy: 'CLAIM_COVERAGE',
    sourceRefs: addition.requirementIds,
    claimSupport: {
      source: 'frozen_claims',
      basis: 'stage0_component_claim_match',
      matchedClaims: addition.claimNumbers,
      claimRole: addition.claimNumbers.includes(1) ? 'claim_1' : 'dependent_claim',
      confidence: 'high',
      matchedText: addition.sourceText,
      reason: 'Automatically added to complete managed-figure claim coverage.',
    },
  }
}

function claimChunks(claims: ReturnType<typeof normalizeCoverageClaims>, maximumTokens = 3_000) {
  const chunks: typeof claims[] = []
  let current: typeof claims = []
  let tokens = 0
  for (const claim of claims) {
    // Conservative tokenizer-independent estimate. Claims remain atomic: a
    // large claim gets its own chunk and is never cut mid-limitation or JSON row.
    const claimTokens = Math.ceil((claim.text.length + 120) / 4)
    if (current.length && tokens + claimTokens > maximumTokens) {
      chunks.push(current)
      current = []
      tokens = 0
    }
    current.push(claim)
    tokens += claimTokens
  }
  if (current.length) chunks.push(current)
  return chunks
}

async function buildCoverageLedger(
  input: PatentDiagramPipelineInput,
  context: Awaited<ReturnType<typeof loadPipelineContext>>,
): Promise<{ ledger: FigureCoverageLedger; additions: FigureSetPlan['pendingComponentAdditions'] }> {
  const contextChecksum = planningContextChecksum(context, input)
  const cached = figureSetPlanSchema.safeParse((context.session.aiAnalysisData as any)?.figurePlan)
  if (cached.success && cached.data.contextChecksum === contextChecksum && cached.data.coverageLedger?.contextChecksum === contextChecksum) {
    return { ledger: cached.data.coverageLedger, additions: cached.data.pendingComponentAdditions }
  }

  const claims = normalizeCoverageClaims(context.claims)
  let ledger: FigureCoverageLedger
  if (!claims.length) {
    ledger = buildDisclosureCoverageLedger({ contextChecksum, evidenceCatalog: context.evidenceCatalog, components: context.components })
  } else {
    const requirements: any[] = []
    for (const chunk of claimChunks(claims)) {
      const claimByNumber = new Map(chunk.map(claim => [claim.number, claim]))
      const knownIds = new Set(context.components.map(component => component.id))
      const schema = coverageExtractionSchema.superRefine((value, validationContext) => {
        value.requirements.forEach((requirement, index) => {
          const claim = claimByNumber.get(requirement.claimNumber)
          if (!claim) {
            validationContext.addIssue({ code: z.ZodIssueCode.custom, path: ['requirements', index, 'claimNumber'], message: `Unknown claim ${requirement.claimNumber}` })
            return
          }
          const source = requirement.sourceText.replace(/\s+/g, ' ').trim()
          if (!claim.text.replace(/\s+/g, ' ').trim().includes(source)) {
            validationContext.addIssue({ code: z.ZodIssueCode.custom, path: ['requirements', index, 'sourceText'], message: 'Must be an exact contiguous excerpt from the identified claim' })
          }
          requirement.componentIds.filter(id => !knownIds.has(id)).forEach(id => validationContext.addIssue({
            code: z.ZodIssueCode.custom, path: ['requirements', index, 'componentIds'], message: `Unknown Component Plan ID: ${id}`,
          }))
          if (!requirement.componentIds.length && !requirement.componentCandidate) {
            validationContext.addIssue({ code: z.ZodIssueCode.custom, path: ['requirements', index], message: 'A Component Plan anchor or componentCandidate is required' })
          }
        })
        uncoveredClaimLimitations(chunk, value.requirements).forEach(missing => validationContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requirements'],
          message: `Missing drawing-relevant limitation from claim ${missing.claimNumber}: ${missing.limitation}`,
        }))
      })
      const extracted = await executeStructured({
        userHeaders: input.requestHeaders,
        stageCode: 'DRAFT_FIGURE_PLANNER',
        prompt: buildCoverageExtractionPrompt({ claims: chunk, components: context.components }),
        schema,
        metadata: { patentId: input.patentId, sessionId: input.sessionId, purpose: 'extract_figure_coverage', claimNumbers: chunk.map(claim => claim.number) },
      })
      requirements.push(...extracted.requirements)
    }
    try {
      ledger = materializeCoverageLedger({ contextChecksum, claims, extraction: { requirements }, components: context.components })
    } catch (error) {
      throw new PatentDiagramPipelineError(error instanceof Error ? error.message : 'Claim coverage could not be validated', 422, undefined, {
        code: 'INVALID_COVERAGE_LEDGER', stage: 'COVERAGE', retryable: true,
        actions: ['Try planning again.', 'If the issue repeats, review the claims and Component Plan for ambiguous or missing terminology.'],
      })
    }
  }

  try {
    const staged = stageCoverageComponentAdditions({ ledger, storedComponents: context.storedComponents, numberingStyle: context.numberingStyle })
    return { ledger: staged.ledger, additions: staged.additions }
  } catch (error) {
    throw new PatentDiagramPipelineError(error instanceof Error ? error.message : 'The Component Plan could not be extended without renumbering existing entries.', 409, undefined, {
      code: 'COMPONENT_NUMBERING_UNSTABLE', stage: 'COVERAGE', retryable: false,
      actions: ['Open the Component Plan and correct duplicate or missing reference labels.', 'Save the Component Plan, then plan the figures again.'],
      automaticCorrection: { attempted: true, attempts: 1, result: 'FAILED' },
    })
  }
}

function contextWithStagedPlan(
  context: Awaited<ReturnType<typeof loadPipelineContext>>,
  plan: FigureSetPlan,
): Awaited<ReturnType<typeof loadPipelineContext>> {
  const additions = plan.pendingComponentAdditions || []
  const components = [
    ...context.components,
    ...additions.map(addition => ({
      id: addition.id,
      name: addition.name,
      type: addition.type,
      description: addition.description,
      referenceLabel: addition.referenceLabel,
      parentId: addition.parentId || null,
      claimSupport: { matchedClaims: addition.claimNumbers, claimRole: addition.claimNumbers.includes(1) ? 'claim_1' as const : 'dependent_claim' as const },
    })),
  ]
  const claimEvidence = plan.coverageLedger ? coverageEvidenceEntries(plan.coverageLedger) : []
  const evidenceCatalog = Array.from(new Map([...context.evidenceCatalog, ...claimEvidence].map(entry => [entry.id, entry])).values())
  const stagedComponents = [
    ...context.storedComponents,
    ...additions.map(persistedAutomaticComponent),
  ]
  const persistedReferenceMapValue = additions.length
    ? { components: stagedComponents, numberingStyle: context.numberingStyle }
    : (context.session.referenceMap as any)?.components || []
  return {
    ...context,
    components,
    evidenceCatalog,
    supportedEvidenceIds: new Set(evidenceCatalog.map(entry => entry.id)),
    referenceMapChecksum: semanticChecksum(persistedReferenceMapValue),
    storedComponents: stagedComponents,
  }
}

export function evaluateManagedPlanCoverage(plan: FigureSetPlan, existingCoveredRequirementIds: Iterable<string> = []) {
  return evaluateCoverageLedger({ ledger: plan.coverageLedger, figures: plan.figures, existingCoveredRequirementIds })
}

function legacyExistingFigureCoversRequirement(
  requirement: FigureCoverageLedger['requirements'][number],
  figure: { kind?: string | null; componentIds: string[] },
): boolean {
  // A v1 component-only semantic model can prove that a claimed component was
  // shown, but mere presence cannot prove an interaction, condition, method
  // step, quantity, role, or relationship. Those need explicit v2 coverage IDs.
  return ['COMPONENT', 'DATA_STRUCTURE'].includes(requirement.type)
    && figure.kind === 'COMPONENT'
    && requirement.componentIds.length > 0
    && requirement.componentIds.every(id => figure.componentIds.includes(id))
}

export async function planManagedFigureSet(input: PatentDiagramPipelineInput): Promise<FigureSetPlan> {
  const baseContext = await loadPipelineContext(input.userId, input.patentId, input.sessionId)
  const coverage = await buildCoverageLedger(input, baseContext)
  const contextChecksum = planningContextChecksum(baseContext, input)
  const stagedSeed = figureSetPlanSchema.parse({
    schemaVersion: 2,
    contextChecksum,
    coverageLedger: coverage.ledger,
    pendingComponentAdditions: coverage.additions,
    figures: [{
      key: 'staging-placeholder', kind: 'COMPONENT', title: 'Staging placeholder', purpose: 'Temporary planning context',
      componentIds: [baseContext.components[0].id], claimCriticalComponentIds: [], orderedGroups: [], phaseHints: [], evidenceIds: [], coverageRequirementIds: [],
    }],
  })
  const context = contextWithStagedPlan(baseContext, stagedSeed)
  const existingFigures = input.includeExistingFigures ? context.existingFigures : []
  const existingCoveredRequirementIds = new Set(existingFigures.flatMap(figure => figure.coverageRequirementIds))
  coverage.ledger.requirements.forEach(requirement => {
    if (existingFigures.some(figure => legacyExistingFigureCoversRequirement(requirement, figure))) {
      existingCoveredRequirementIds.add(requirement.id)
    }
  })
  const prompt = buildFigureSetPlanningPrompt({
    inventionTitle: context.session.ideaRecord?.title || context.idea?.title || 'Untitled invention',
    patentType: context.session.patentTypePrimary,
    inventionContext: context.idea,
    claimsContext: context.claims,
    components: context.components,
    evidenceCatalog: context.evidenceCatalog,
    coverageLedger: coverage.ledger,
    existingFigures,
    figureCount: input.figureCount,
    exactFigureCount: input.mode === 'manual',
    instructions: input.instructions,
  })
  const knownIds = new Set(context.components.map(component => component.id))
  const knownCoverageIds = new Set(coverage.ledger.requirements.map(requirement => requirement.id))
  const constrainedPlanSchema = figureSetPlanSchema.superRefine((value, ctx) => {
    const keys = value.figures.map(figure => figure.key)
    keys.filter((key, index) => keys.indexOf(key) !== index).forEach(key => ctx.addIssue({
      code: z.ZodIssueCode.custom, message: `Duplicate figure key: ${key}`,
    }))
    if (input.mode === 'manual' && input.figureCount && value.figures.length !== input.figureCount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Manual generation requires exactly ${input.figureCount} figure(s)` })
    }
    value.figures.flatMap(figure => [
      ...figure.componentIds,
      ...figure.claimCriticalComponentIds,
      ...figure.orderedGroups.flatMap(group => group.componentIds),
    ]).filter(id => !knownIds.has(id)).forEach(id => ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unknown Component Planner ID: ${id}`,
    }))
    // A planned step ID the catalog does not contain is the plan-time form of an
    // invented step: the detailer would be told to cite something that does not
    // exist. Rejecting it here costs one re-ask instead of a wasted render.
    value.figures.flatMap(figure => figure.evidenceIds)
      .filter(id => !context.supportedEvidenceIds.has(id))
      .forEach(id => ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown disclosed-step ID: ${id}`,
      }))
    value.figures.flatMap(figure => figure.coverageRequirementIds)
      .filter(id => !knownCoverageIds.has(id))
      .forEach(id => ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown coverage requirement ID: ${id}` }))
  })
  const llmPlan = await executeStructured({
    userHeaders: input.requestHeaders,
    stageCode: 'DRAFT_FIGURE_PLANNER',
    prompt,
    schema: constrainedPlanSchema,
    metadata: { patentId: input.patentId, sessionId: input.sessionId, purpose: 'plan_figures_structured' },
  })
  const seedPlan = figureSetPlanSchema.parse({
    ...llmPlan,
    schemaVersion: 2,
    contextChecksum,
    coverageLedger: coverage.ledger,
    pendingComponentAdditions: coverage.additions,
  })
  let plan: FigureSetPlan
  try {
    plan = repairFigureSetCoverage({
      plan: seedPlan,
      ledger: coverage.ledger,
      existingCoveredRequirementIds,
      manualExactCount: input.mode === 'manual',
    }).plan
  } catch (error) {
    throw new PatentDiagramPipelineError(error instanceof Error ? error.message : 'The figure plan could not be repaired for complete coverage', 422, undefined, {
      code: 'COVERAGE_REPAIR_FAILED', stage: 'COVERAGE', retryable: true,
      actions: ['Try planning again.', 'Simplify an unusually broad claim set or divide manual requests into smaller batches.'],
      automaticCorrection: { attempted: true, attempts: 1, result: 'FAILED' },
    })
  }
  assertPlanComponentIds(plan, context.components)
  const coverageReport = evaluateManagedPlanCoverage(plan, existingCoveredRequirementIds)
  if (input.mode !== 'manual' && coverageReport.status === 'INCOMPLETE') {
    throw new PatentDiagramPipelineError('Automatic planning could not assign every required claim concept to a figure.', 422, coverageReport.missing, {
      code: 'INCOMPLETE_CLAIM_COVERAGE', stage: 'COVERAGE', retryable: true,
      actions: ['Try planning again.', 'Review the Component Plan and claim terminology if the same concepts remain uncovered.'],
      automaticCorrection: { attempted: true, attempts: 1, result: 'FAILED' },
    })
  }
  if (plan.figures.length > MAXIMUM_MANAGED_FIGURES_PER_RUN) {
    throw new PatentDiagramPipelineError(`The repaired plan requires ${plan.figures.length} figures, above the ${MAXIMUM_MANAGED_FIGURES_PER_RUN}-figure safety limit.`, 422, undefined, {
      code: 'FIGURE_SET_TOO_LARGE', stage: 'PLAN', retryable: false,
      actions: ['Divide the requested drawing set into smaller batches.', 'Review whether optional embodiments can be drawn separately.'],
    })
  }
  const previousAnalysis = context.session.aiAnalysisData && typeof context.session.aiAnalysisData === 'object'
    ? context.session.aiAnalysisData as Record<string, unknown>
    : {}
  await prisma.draftingSession.update({
    where: { id: input.sessionId },
    data: { aiAnalysisData: { ...previousAnalysis, figurePlan: plan } as any },
  })
  return plan
}

async function detailManagedFigure(input: {
  plan: FigureSetPlanItem
  context: Awaited<ReturnType<typeof loadPipelineContext>>
  pipeline: PatentDiagramPipelineInput
  coverageLedger?: FigureCoverageLedger
  existingDiagram?: PatentDiagram | null
}): Promise<PatentDiagram> {
  const prompt = buildDiagramDetailPrompt({
    plan: input.plan,
    inventionContext: input.context.idea,
    claimsContext: input.context.claims,
    components: input.context.components,
    evidenceCatalog: input.context.evidenceCatalog,
    coverageLedger: input.coverageLedger,
    existingDiagram: input.existingDiagram,
    instructions: input.pipeline.instructions,
  })
  // Grounding findings are warnings in the base validator so figures persisted
  // before these rules still translate and re-render, but a NEW generation must
  // anchor every process step to the Component Planner and cite the disclosure
  // it paraphrases. Both are the signature of an invented step, so here they
  // block and re-prompt the model like any other defect.
  const GROUNDING_CODES = [
    'UNGROUNDED_STEP', 'UNCITED_STEP', 'UNKNOWN_STEP_EVIDENCE',
    'UNCITED_SEMANTIC_ELEMENT', 'UNKNOWN_SEMANTIC_EVIDENCE',
  ]
  const blocksGeneration = (issue: { severity: string; code: string }) =>
    (issue.severity === 'error' || GROUNDING_CODES.includes(issue.code)) && issue.code !== 'SPLIT_REQUIRED'
  // Validate what the pipeline will actually build. Re-prompting the model for
  // a defect the normalizer repairs anyway wastes a call and can fail the
  // figure outright when the retry reproduces it.
  const constrainedDiagramSchema = (enforceDensityBudget: boolean) => patentDiagramSchema.superRefine((value, ctx) => {
    const { diagram } = normalizePatentDiagram(value, input.context.components, input.context.supportedEvidenceIds)
    const plannedCoverage = new Set(input.plan.coverageRequirementIds)
    const plannedEvidence = new Set(input.plan.evidenceIds)
    const semanticComponentIds = new Set(
      diagram.kind === 'COMPONENT' ? diagram.components.map(item => item.componentId)
        : diagram.kind === 'SEQUENCE' ? diagram.participants.map(item => item.componentId)
          : diagram.kind === 'PROCESS' ? diagram.nodes.flatMap(item => [item.componentId, ...item.relatedComponentIds].filter(Boolean) as string[])
            : diagram.constituents.map(item => item.componentId),
    )
    const atomicCoverageIds = new Set<string>([
      ...(diagram.kind === 'COMPONENT' ? diagram.components.flatMap(item => item.coverageRequirementIds) : []),
      ...(diagram.kind === 'COMPONENT' || diagram.kind === 'CONSTITUENT' ? diagram.relationships.flatMap(item => item.coverageRequirementIds) : []),
      ...(diagram.kind === 'SEQUENCE' ? diagram.interactions.flatMap(item => item.coverageRequirementIds) : []),
      ...(diagram.kind === 'PROCESS' ? diagram.nodes.flatMap(item => item.coverageRequirementIds) : []),
      ...(diagram.kind === 'PROCESS' ? diagram.transitions.flatMap(item => item.coverageRequirementIds) : []),
      ...(diagram.kind === 'CONSTITUENT' ? diagram.constituents.flatMap(item => item.coverageRequirementIds) : []),
    ])
    const mismatch = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message })
    if (diagram.key !== input.plan.key) mismatch(`Diagram key must remain ${input.plan.key}`)
    if (diagram.kind !== input.plan.kind) mismatch(`Diagram kind must remain ${input.plan.kind}`)
    if (diagram.title !== input.plan.title) mismatch('Diagram title must match the approved plan')
    if (diagram.purpose !== input.plan.purpose) mismatch('Diagram purpose must match the approved plan')
    if (diagram.detailLevel !== input.plan.detailLevel || diagram.direction !== input.plan.direction) mismatch('Diagram detail level and direction must match the approved plan')
    input.plan.componentIds.filter(id => !semanticComponentIds.has(id)).forEach(id => mismatch(`Planned Component Plan ID is missing from the detailed diagram: ${id}`))
    input.plan.claimCriticalComponentIds.filter(id => !diagram.claimCriticalComponentIds.includes(id)).forEach(id => mismatch(`Claim-critical Component Plan ID is missing: ${id}`))
    Array.from(plannedCoverage).filter(id => !diagram.coverageRequirementIds.includes(id) || !atomicCoverageIds.has(id)).forEach(id => mismatch(`Planned coverage requirement is not represented by a semantic element: ${id}`))
    diagram.coverageRequirementIds.filter(id => !plannedCoverage.has(id)).forEach(id => mismatch(`Unplanned coverage requirement: ${id}`))
    Array.from(atomicCoverageIds).filter(id => !plannedCoverage.has(id)).forEach(id => mismatch(`Semantic element cites unplanned coverage requirement: ${id}`))
    Array.from(plannedEvidence).filter(id => !diagram.evidenceIds.includes(id)).forEach(id => mismatch(`Planned evidence ID is missing: ${id}`))
    validatePatentDiagram(diagram, input.context.components, input.context.supportedEvidenceIds).issues
      .filter(issue => blocksGeneration(issue) || (enforceDensityBudget && issue.code === 'SPLIT_REQUIRED'))
      .forEach(issue => ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${issue.code}: ${issue.message}` }))
  })
  const executeDetail = (enforceDensityBudget: boolean) => executeStructured({
    userHeaders: input.pipeline.requestHeaders,
    stageCode: 'DRAFT_DIAGRAM_GENERATION',
    prompt,
    schema: constrainedDiagramSchema(enforceDensityBudget),
    metadata: {
      patentId: input.pipeline.patentId, sessionId: input.pipeline.sessionId,
      figureKey: input.plan.key, purpose: 'detail_figure_structured',
      densityBudget: enforceDensityBudget ? 'enforced' : 'relaxed',
    },
  })
  // An over-dense figure is not a defect the builder can repair - the
  // decomposer splits it into an overview plus detail sheets, which is how a
  // 5-figure plan turned into 15 rendered sheets. So the first pass makes the
  // published complexity budget binding and re-prompts the model to draw a
  // figure that fits. Only when it cannot (process branch depth, say, which
  // chunking genuinely cannot reduce) does the tolerant pass run and hand the
  // figure to the decomposer. Content is never dropped to hit a figure count.
  let diagram: PatentDiagram
  try {
    diagram = await executeDetail(true)
  } catch (error) {
    if (!(error instanceof PatentDiagramPipelineError) || error.status !== 422) throw error
    if (input.pipeline.mode === 'manual') {
      throw new PatentDiagramPipelineError(`The manual instruction for "${input.plan.title}" could not be rendered as one filing-scale figure.`, 422, error.details, {
        code: 'MANUAL_FIGURE_NEEDS_SIMPLIFICATION', stage: 'DETAIL', retryable: true,
        actions: ['Simplify this instruction so it fits on one figure.', 'Create a second manual instruction if the subject should be divided across two figures.'],
        automaticCorrection: { attempted: true, attempts: 1, result: 'FAILED' },
      })
    }
    diagram = await executeDetail(false)
  }
  diagram = { ...diagram, schemaVersion: 2 } as PatentDiagram
  const built = buildPatentDiagram(diagram, input.context.components, input.context.supportedEvidenceIds)
  const deterministicDefects = built.validation.issues.filter(blocksGeneration)
  if (deterministicDefects.length) {
    throw new PatentDiagramPipelineError(`Deterministic builder failed for ${input.plan.title}`, 500, deterministicDefects)
  }
  return built.diagram
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length)
  let nextIndex = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex++
      if (index >= items.length) return
      result[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return result
}

interface RenderedManagedFigure {
  built: BuiltPatentDiagram
  svg: Awaited<ReturnType<typeof renderAndWriteDiagramArtifacts>>['svg']
  png: Awaited<ReturnType<typeof renderAndWriteDiagramArtifacts>>['png']
  figureNo: number
  svgFilename: string
  pngFilename: string
  svgPath: string
  pngPath: string
}

function applyRenderedLayoutValidation(built: BuiltPatentDiagram, svg: Awaited<ReturnType<typeof renderAndWriteDiagramArtifacts>>['svg']) {
  const svgText = svg.buffer.toString('utf8')
  const expectedReferences = built.nodes.flatMap(node => {
    const raw = String(node.referenceLabel || node.identifier || '').trim()
    if (!raw) return []
    return [/^\(.+\)$/.test(raw) || /^[SD]\d+$/i.test(raw) ? raw : `(${raw})`]
  })
  expectedReferences.forEach(reference => {
    if (!svgText.includes(reference)) {
      built.validation.issues.push({ code: 'MISSING_RENDERED_REFERENCE', severity: 'error', message: `Rendered SVG is missing reference ${reference}` })
    }
  })
  if (built.diagram.kind !== 'COMPONENT' || !svg.elementBounds) {
    built.validation.filingReady = !built.validation.issues.some(issue => issue.severity === 'error')
    return
  }
  const approximately = (actual: number | undefined, expected: number) => actual != null && Math.abs(actual - expected) <= 0.05
  for (let groupIndex = 0; groupIndex < built.diagram.groups.length; groupIndex++) {
    const group = built.diagram.groups[groupIndex]
    for (let rowIndex = 0; rowIndex < group.rows.length; rowIndex++) {
      const row = group.rows[rowIndex]
      const bounds = row.componentIds.flatMap(componentId => {
        const alias = Object.entries(built.labelMap).find(([, id]) => id === componentId)?.[0]
        const box = alias ? svg.elementBounds?.[alias] : undefined
        return box ? [box] : []
      })
      if (bounds.length < 2) continue
      const widths = bounds.map(box => box.width)
      const heights = bounds.map(box => box.height)
      const widthVariance = (Math.max(...widths) - Math.min(...widths)) / Math.min(...widths)
      const heightVariance = (Math.max(...heights) - Math.min(...heights)) / Math.min(...heights)
      // Layout findings below are aesthetic preferences that Graphviz does not
      // guarantee and the builder cannot force. A drawing that is merely less
      // tidy is not an unfileable drawing, so they are reported for manual
      // review rather than treated as fatal or used to trigger decomposition.
      if (widthVariance > PATENT_DIAGRAM_COMPLEXITY.siblingDimensionVariance || heightVariance > PATENT_DIAGRAM_COMPLEXITY.siblingDimensionVariance) {
        built.validation.issues.push({
          code: 'SIBLING_DIMENSION_VARIANCE', severity: 'warning',
          message: `Subsystem ${group.label}, row ${rowIndex + 1} exceeds the 20% sibling-size tolerance`,
          path: `groups.${groupIndex}.rows.${rowIndex}`,
        })
      }
    }
  }
  const bands = built.diagram.groups.map((_group, index) => svg.elementBounds?.[`BAND${index + 1}`]).filter(Boolean) as Array<{ x?: number; y?: number; width: number; height: number }>
  if (bands.length === built.diagram.groups.length) {
    for (let index = 1; index < bands.length; index++) {
      if ((bands[index].y ?? 0) <= (bands[index - 1].y ?? 0)) {
        built.validation.issues.push({ code: 'BAND_ORDER', severity: 'warning', message: 'Rendered subsystem bands are not monotonically top-to-bottom' })
        break
      }
    }
    if (bands.some(band => band.width <= band.height)) {
      built.validation.issues.push({ code: 'BAND_ASPECT', severity: 'warning', message: 'A rendered subsystem band is not horizontally rectangular' })
    }
  }
  const system = svg.elementBounds.SYSTEM
  if (!approximately(system?.strokeWidth, PATENT_DIAGRAM_STYLE.systemBorderThickness)) {
    built.validation.issues.push({ code: 'SYSTEM_BORDER_THICKNESS', severity: 'error', message: 'Rendered system boundary does not use the centralized border thickness' })
  }
  built.diagram.groups.forEach((_group, index) => {
    const band = svg.elementBounds?.[`BAND${index + 1}`]
    if (!approximately(band?.strokeWidth, PATENT_DIAGRAM_STYLE.subsystemBorderThickness)) {
      built.validation.issues.push({ code: 'SUBSYSTEM_BORDER_THICKNESS', severity: 'error', message: `Rendered subsystem ${index + 1} does not use the centralized border thickness` })
    }
  })
  Object.keys(built.labelMap).forEach(alias => {
    if (!approximately(svg.elementBounds?.[alias]?.strokeWidth, PATENT_DIAGRAM_STYLE.componentBorderThickness)) {
      built.validation.issues.push({ code: 'COMPONENT_BORDER_THICKNESS', severity: 'error', message: `Rendered component ${built.labelMap[alias]} does not use the centralized border thickness`, componentId: built.labelMap[alias] })
    }
  })
  built.validation.filingReady = !built.validation.issues.some(issue => issue.severity === 'error')
}

async function renderManagedFigures(
  patentId: string,
  builtFigures: BuiltPatentDiagram[],
  figureNumbers?: number[],
  pagePolicy?: Awaited<ReturnType<typeof resolveDiagramPagePolicy>>,
): Promise<RenderedManagedFigure[]> {
  const outcomes = await mapWithConcurrency(builtFigures, 2, async (built, index) => {
    try {
      const figureNo = figureNumbers?.[index] ?? index + 1
      const rendered = await renderAndWriteDiagramArtifacts({ patentId, figureNo, plantumlCode: built.plantumlCode, pagePolicy })
      const { svg, png, artifacts } = rendered
      applyRenderedLayoutValidation(built, svg)
      const svgFilename = artifacts.svg.filename!
      const pngFilename = artifacts.png.filename!
      const svgPath = artifacts.svg.path!
      const pngPath = artifacts.png.path!
      built.validation.render = {
        width: svg.width,
        height: svg.height,
        viewBox: svg.viewBox,
        aspectRatio: svg.width && svg.height ? svg.width / svg.height : undefined,
        effectiveFontSizePt: rendered.effectiveFontSizePt,
      }
      const aspectRatio = built.validation.render.aspectRatio
      if (aspectRatio && (aspectRatio > EXTREME_ASPECT_RATIO_MAXIMUM || aspectRatio < EXTREME_ASPECT_RATIO_MINIMUM)) {
        built.validation.issues.push({
          code: 'EXTREME_ASPECT_RATIO', severity: 'warning',
          message: `Rendered aspect ratio ${aspectRatio.toFixed(2)} is outside the preferred filing range; consider splitting the figure`,
        })
      }
      if (rendered.effectiveFontSizePt != null && pagePolicy && rendered.effectiveFontSizePt < pagePolicy.minimumTextSizePt) {
        built.validation.issues.push({
          code: 'PAGE_FIT_MINIMUM_TEXT', severity: 'error',
          message: `Page fitting would reduce text to ${rendered.effectiveFontSizePt.toFixed(1)} pt below the ${pagePolicy.minimumTextSizePt} pt minimum`,
        })
        built.validation.filingReady = false
      }
      return { ok: true as const, value: { built, svg, png, figureNo, svgFilename, pngFilename, svgPath, pngPath } }
    } catch (error) {
      return { ok: false as const, error }
    }
  })
  const completed = outcomes.flatMap(outcome => outcome.ok ? [outcome.value] : [])
  const failure = outcomes.find(outcome => !outcome.ok)
  if (failure && !failure.ok) {
    await Promise.allSettled(completed.flatMap(figure => [figure.svgPath, figure.pngPath]).map(path => fs.unlink(path)))
    throw new PatentDiagramPipelineError('The complete drawing set could not be rendered, so no partial set was saved.', 422, failure.error instanceof Error ? failure.error.message : failure.error, {
      code: 'DIAGRAM_RENDER_FAILED', stage: 'RENDER', retryable: true,
      actions: ['Retry the failed render.', 'If it repeats for one figure, use Modify to simplify that figure.', 'Ask an administrator to verify the PlantUML renderer.'],
    })
  }
  return completed
}

/**
 * Count rendered figures against the tenant's DIAGRAM_GENERATION quota.
 *
 * One completion per figure, keyed on session + figure number so that regenerating an
 * existing figure does not burn quota twice - only genuinely new figures count.
 */
async function recordFigureCompletions(
  input: PatentDiagramPipelineInput,
  figures: RenderedManagedFigure[],
) {
  if (figures.length === 0) return

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { tenantId: true },
  })
  if (!user?.tenantId) return

  for (const figure of figures) {
    await recordServiceCompletion({
      tenantId: user.tenantId,
      userId: input.userId,
      serviceType: 'DIAGRAM_GENERATION',
      operationId: `${input.sessionId}:fig:${figure.figureNo}`,
      operationType: 'MANAGED_FIGURE',
      metadata: { patentId: input.patentId, figureNo: figure.figureNo },
    })
  }
}

async function persistManagedFigureSet(
  input: PatentDiagramPipelineInput,
  referenceMapChecksum: string,
  figures: RenderedManagedFigure[],
  options: {
    replace: boolean
    plan: FigureSetPlan
    baseContext: Awaited<ReturnType<typeof loadPipelineContext>>
  },
) {
  const supersededPaths = options.replace
    ? Array.from(new Set(options.baseContext.session.diagramSources.flatMap(source => [
        source.imagePath,
        source.originalImagePath,
        (source.renderArtifacts as any)?.svg?.path,
        (source.renderArtifacts as any)?.png?.path,
      ].filter((value): value is string => typeof value === 'string' && value.length > 0))))
    : []
  let saved: any[]
  try {
    saved = await prisma.$transaction(async tx => {
    if (options.plan.pendingComponentAdditions.length) {
      const components = [
        ...options.baseContext.storedComponents,
        ...options.plan.pendingComponentAdditions.map(persistedAutomaticComponent),
      ]
      await tx.referenceMap.update({
        where: { sessionId: input.sessionId },
        data: { components: { components, numberingStyle: options.baseContext.numberingStyle } as any, isValid: true, validationErrors: undefined },
      })
      await tx.auditLog.create({
        data: {
          actorUserId: input.userId,
          tenantId: options.baseContext.session.tenantId || null,
          action: 'FIGURE_COVERAGE_COMPONENTS_AUTO_ADDED',
          resource: `DraftingSession:${input.sessionId}`,
          meta: {
            patentId: input.patentId,
            additions: options.plan.pendingComponentAdditions.map(item => ({ id: item.id, name: item.name, referenceLabel: item.referenceLabel, claimNumbers: item.claimNumbers, requirementIds: item.requirementIds })),
          } as any,
        },
      })
    }
    if (options.replace) {
      await tx.diagramSource.deleteMany({ where: { sessionId: input.sessionId, figureNo: { lt: GENERATED_FIGURE_LIMIT } } })
      await tx.figurePlan.deleteMany({ where: { sessionId: input.sessionId, figureNo: { lt: GENERATED_FIGURE_LIMIT } } })
    }
    const overviewFigureByRoot = new Map<string, number>()
    figures.forEach(figure => {
      const match = figure.built.diagram.key.match(/^(.*)-overview$/)
      if (match) overviewFigureByRoot.set(match[1], figure.figureNo)
    })
    const saved: any[] = []
    for (const figure of figures) {
      const semantic = figure.built.diagram
      const semanticHash = semanticChecksum({ referenceMapChecksum, semantic })
      const detailRoot = semantic.key.match(/^(.*)-(?:detail|interface)-\d+$/)?.[1]
      const plan = await tx.figurePlan.create({
        data: {
          sessionId: input.sessionId,
          figureNo: figure.figureNo,
          title: semantic.title,
          description: semantic.purpose,
          nodes: figure.built.nodes as any,
          edges: figure.built.edges as any,
          diagramType: semantic.kind,
          semanticSchemaVersion: semantic.schemaVersion,
          semanticModel: semantic as any,
          semanticChecksum: semanticHash,
          referenceMapChecksum,
          validationReport: figure.built.validation as any,
          detailOfFigureNo: detailRoot ? overviewFigureByRoot.get(detailRoot) || null : null,
        },
      })
      const renderArtifacts = {
        svg: { filename: figure.svgFilename, path: figure.svgPath, checksum: figure.svg.checksum, contentType: figure.svg.contentType, width: figure.svg.width, height: figure.svg.height },
        png: { filename: figure.pngFilename, path: figure.pngPath, checksum: figure.png.checksum, contentType: figure.png.contentType },
      }
      const source = await tx.diagramSource.create({
        data: {
          sessionId: input.sessionId,
          figureNo: figure.figureNo,
          language: 'en',
          plantumlCode: figure.built.plantumlCode,
          checksum: crypto.createHash('sha256').update(figure.built.plantumlCode).digest('hex'),
          sourceMode: 'MANAGED',
          labelMap: figure.built.labelMap as any,
          renderArtifacts: renderArtifacts as any,
          renderStatus: figure.built.validation.filingReady ? 'SUCCESS' : 'REVIEW_REQUIRED',
          renderError: figure.built.validation.filingReady
            ? null
            : figure.built.validation.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join('; '),
          semanticChecksum: semanticHash,
          referenceMapChecksum,
          imageFilename: figure.pngFilename,
          imagePath: figure.pngPath,
          imageChecksum: figure.png.checksum,
          imageUploadedAt: new Date(),
        },
      })
      saved.push({ plan, source, validation: figure.built.validation, renderArtifacts })
    }
    await tx.draftingSession.update({
      where: { id: input.sessionId },
      data: {
        figureSequence: null as any, figureSequenceFinalized: false, figuresSkipped: false, figuresSkippedAt: null,
        aiAnalysisData: {
          ...((options.baseContext.session.aiAnalysisData && typeof options.baseContext.session.aiAnalysisData === 'object')
            ? options.baseContext.session.aiAnalysisData as Record<string, unknown>
            : {}),
          figurePlan: options.plan,
          figureCoverage: evaluateManagedPlanCoverage(options.plan),
        } as any,
      },
    })
    return saved
  })
  } catch (error) {
    await Promise.allSettled(figures.flatMap(figure => [figure.svgPath, figure.pngPath]).map(path => fs.unlink(path)))
    throw new PatentDiagramPipelineError('The figures rendered, but the completed drawing set could not be saved. Temporary artifacts were cleaned up.', 500, error instanceof Error ? error.message : error, {
      code: 'DIAGRAM_PERSIST_FAILED', stage: 'PERSIST', retryable: true,
      actions: ['Try generation again; the previous saved drawing set was left unchanged.'],
    })
  }

  await Promise.allSettled(supersededPaths.map(path => fs.unlink(path)))

  // Outside the transaction: metering must never roll back a persisted figure set.
  await recordFigureCompletions(input, figures)

  return saved
}

function countAdjustment(requested: number | null | undefined, generated: number) {
  return {
    requested: requested ?? null,
    generated,
    adjusted: requested != null ? requested !== generated : generated > AUTO_MODE_FIGURE_TARGET,
    reason: requested != null && requested !== generated
      ? 'Coverage or filing-scale decomposition required a different figure count.'
      : generated > AUTO_MODE_FIGURE_TARGET
        ? `Complete coverage required more than the ${AUTO_MODE_FIGURE_TARGET}-figure target.`
        : null,
  }
}

function realizedRepairSummary(plan: FigureSetPlan, figures: RenderedManagedFigure[]) {
  const summary = plan.repairSummary
  if (!summary) return undefined
  return {
    ...summary,
    figureChanges: summary.figureChanges.map(change => ({
      ...change,
      generatedFigureNumbers: figures
        .filter(figure => figure.built.diagram.key === change.figureKey || figure.built.diagram.key.startsWith(`${change.figureKey}-`))
        .map(figure => figure.figureNo),
    })),
  }
}

function summarizeFilingReadiness(figures: RenderedManagedFigure[]) {
  const blockingIssues = figures.flatMap(figure => figure.built.validation.issues
    .filter(issue => issue.severity === 'error')
    .map(issue => ({ figureNo: figure.figureNo, code: issue.code, message: issue.message })))
  return {
    status: blockingIssues.length ? 'REVIEW_REQUIRED' as const : 'READY' as const,
    ready: blockingIssues.length === 0,
    blockingIssues,
  }
}

function visibleElementCount(diagram: PatentDiagram): number {
  if (diagram.kind === 'COMPONENT') return diagram.components.length
  if (diagram.kind === 'SEQUENCE') return diagram.participants.length
  if (diagram.kind === 'PROCESS') return diagram.nodes.length
  return diagram.constituents.length
}

function jurisdictionElementLimit(diagram: PatentDiagram, policy: Awaited<ReturnType<typeof resolveDiagramPagePolicy>>): number | undefined {
  const aliases = diagram.kind === 'COMPONENT' ? ['COMPONENT', 'BLOCK', 'SCHEMATIC']
    : diagram.kind === 'PROCESS' ? ['PROCESS', 'FLOW', 'FLOWCHART', 'ACTIVITY']
      : [diagram.kind]
  return aliases.map(key => policy.maximumElementsByType[key]).find(value => Number.isFinite(value) && value > 0)
}

function decomposeForResolvedPolicy(diagram: PatentDiagram, policy: Awaited<ReturnType<typeof resolveDiagramPagePolicy>>): PatentDiagram[] {
  const limit = jurisdictionElementLimit(diagram, policy)
  return decomposePatentDiagram(diagram, !!limit && visibleElementCount(diagram) > limit)
}

function assertBuiltFigures(built: BuiltPatentDiagram[], message: string) {
  const invalid = built.flatMap((figure, index) => figure.validation.issues
    .filter(issue => issue.severity === 'error')
    .map(issue => ({ figure: index + 1, ...issue })))
  if (invalid.length) throw new PatentDiagramPipelineError(message, 422, invalid)
}

// Generation renders the complete filing-scale replacement set before any
// database record is swapped. Decomposition may increase the figure count;
// coverage is checked before those parts are accepted.
async function buildAndRenderAdaptive(input: {
  patentId: string
  diagrams: PatentDiagram[]
  components: PatentDiagramComponent[]
  supportedEvidenceIds?: Set<string>
  pagePolicy: Awaited<ReturnType<typeof resolveDiagramPagePolicy>>
  allocateFigureNumbers?: (count: number) => number[]
}) {
  const decomposed = input.diagrams.flatMap(diagram => {
    const parts = decomposeForResolvedPolicy(diagram, input.pagePolicy)
    const preserved = new Set(parts.flatMap(part => part.coverageRequirementIds))
    const missing = diagram.coverageRequirementIds.filter(id => !preserved.has(id))
    if (missing.length) throw new PatentDiagramPipelineError('Filing-scale decomposition would lose claim coverage.', 422, missing, {
      code: 'DECOMPOSITION_COVERAGE_LOSS', stage: 'VALIDATION', retryable: false,
      actions: ['Simplify the affected figure or divide it manually while preserving the listed claim requirements.'],
    })
    return parts
  })
  if (decomposed.length > MAXIMUM_MANAGED_FIGURES_PER_RUN) {
    throw new PatentDiagramPipelineError(`Filing-scale decomposition requires ${decomposed.length} figures, above the ${MAXIMUM_MANAGED_FIGURES_PER_RUN}-figure safety limit.`, 422, undefined, {
      code: 'FIGURE_SET_TOO_LARGE', stage: 'VALIDATION', retryable: false,
      actions: ['Split the drawing request into smaller batches.', 'Simplify dense figures before generating again.'],
    })
  }
  const built = decomposed.map(diagram => buildPatentDiagram(diagram, input.components, input.supportedEvidenceIds))
  assertBuiltFigures(built, 'Generated figure set is not filing-ready')
  const numbers = input.allocateFigureNumbers?.(built.length)
  const rendered = await renderManagedFigures(input.patentId, built, numbers, input.pagePolicy)
  const renderedInvalid = rendered.flatMap(figure => figure.built.validation.issues
    .filter(issue => issue.severity === 'error' && issue.code !== 'PAGE_FIT_MINIMUM_TEXT'))
  if (renderedInvalid.length) throw new PatentDiagramPipelineError('Rendered figure set is not filing-ready', 422, renderedInvalid)
  return rendered
}

export async function generateManagedFigureSet(
  input: PatentDiagramPipelineInput & { plan?: FigureSetPlan | null },
) {
  const baseContext = await loadPipelineContext(input.userId, input.patentId, input.sessionId)
  // Sessions planned before this pipeline stored a {count, diagrams} plan.
  // Parsing that strictly threw a raw ZodError and made diagram generation
  // impossible for every pre-existing session, so an unusable stored plan is
  // simply re-planned.
  const storedPlan = (baseContext.session.aiAnalysisData as any)?.figurePlan
  const parsedStoredPlan = storedPlan ? figureSetPlanSchema.safeParse(storedPlan) : null
  const currentChecksum = planningContextChecksum(baseContext, input)
  const storedIsCurrent = parsedStoredPlan?.success
    && parsedStoredPlan.data.schemaVersion === 2
    && parsedStoredPlan.data.contextChecksum === currentChecksum
  const plan = input.plan
    || (storedIsCurrent ? parsedStoredPlan.data : await planManagedFigureSet(input))
  const context = contextWithStagedPlan(baseContext, plan)
  assertPlanComponentIds(plan, context.components)
  const coverage = evaluateManagedPlanCoverage(plan)
  if (input.mode !== 'manual' && coverage.status === 'INCOMPLETE') {
    throw new PatentDiagramPipelineError('The saved figure plan is missing required claim coverage and could not be generated safely.', 409, coverage.missing, {
      code: 'STALE_OR_INCOMPLETE_PLAN', stage: 'COVERAGE', retryable: true,
      actions: ['Plan the figures again so missing claim concepts can be added automatically.'],
    })
  }
  const detailed = await mapWithConcurrency(plan.figures, 2, planItem => detailManagedFigure({ plan: planItem, context, pipeline: input, coverageLedger: plan.coverageLedger }))
  const rendered = await buildAndRenderAdaptive({
    patentId: input.patentId,
    diagrams: detailed,
    components: context.components,
    supportedEvidenceIds: context.supportedEvidenceIds,
    pagePolicy: context.pagePolicy,
  })
  const saved = await persistManagedFigureSet(input, context.referenceMapChecksum, rendered, { replace: true, plan, baseContext })
  const filingReadiness = summarizeFilingReadiness(rendered)
  return {
    plan,
    coverage,
    repairSummary: realizedRepairSummary(plan, rendered),
    countAdjusted: countAdjustment(input.figureCount, rendered.length),
    filingReadiness,
    figures: rendered.map(figure => ({
      figureNo: figure.figureNo,
      title: figure.built.diagram.title,
      purpose: figure.built.diagram.purpose,
      kind: figure.built.diagram.kind,
      plantuml: figure.built.plantumlCode,
      semanticModel: figure.built.diagram,
      validation: figure.built.validation,
    })),
    saved,
  }
}

export async function addManagedFigures(
  input: PatentDiagramPipelineInput & { plan?: FigureSetPlan | null },
) {
  const baseContext = await loadPipelineContext(input.userId, input.patentId, input.sessionId)
  const plan = input.plan || await planManagedFigureSet(input)
  const context = contextWithStagedPlan(baseContext, plan)
  assertPlanComponentIds(plan, context.components)
  const occupied = new Set(context.session.figurePlans.map(figure => figure.figureNo))
  if (plan.figures.length > MAXIMUM_MANAGED_FIGURES_PER_RUN) throw new PatentDiagramPipelineError(`A single append operation can create at most ${MAXIMUM_MANAGED_FIGURES_PER_RUN} managed figures`, 422)
  const detailed = await mapWithConcurrency(plan.figures, 2, planItem => detailManagedFigure({ plan: planItem, context, pipeline: input, coverageLedger: plan.coverageLedger }))

  const allocateFigureNumbers = (count: number) => {
    const used = new Set(occupied)
    const figureNumbers: number[] = []
    let candidate = Math.max(0, ...Array.from(used).filter(value => value < GENERATED_FIGURE_LIMIT)) + 1
    for (let index = 0; index < count; index++) {
      while (used.has(candidate)) candidate++
      if (candidate >= GENERATED_FIGURE_LIMIT) throw new PatentDiagramPipelineError('No generated figure slots remain before the imported-figure range', 409)
      figureNumbers.push(candidate)
      used.add(candidate++)
    }
    return figureNumbers
  }
  const rendered = await buildAndRenderAdaptive({
    patentId: input.patentId,
    diagrams: detailed,
    components: context.components,
    supportedEvidenceIds: context.supportedEvidenceIds,
    pagePolicy: context.pagePolicy,
    allocateFigureNumbers,
  })
  const saved = await persistManagedFigureSet(input, context.referenceMapChecksum, rendered, { replace: false, plan, baseContext })
  const appendExistingCoverage = new Set(input.includeExistingFigures ? context.existingFigures.flatMap(figure => figure.coverageRequirementIds) : [])
  if (input.includeExistingFigures && plan.coverageLedger) {
    plan.coverageLedger.requirements.forEach(requirement => {
      if (context.existingFigures.some(figure => legacyExistingFigureCoversRequirement(requirement, figure))) {
        appendExistingCoverage.add(requirement.id)
      }
    })
  }
  const coverage = evaluateManagedPlanCoverage(plan, appendExistingCoverage)
  return {
    plan,
    coverage,
    repairSummary: realizedRepairSummary(plan, rendered),
    countAdjusted: countAdjustment(input.figureCount, rendered.length),
    filingReadiness: summarizeFilingReadiness(rendered),
    figures: rendered.map(figure => ({
      figureNo: figure.figureNo,
      title: figure.built.diagram.title,
      purpose: figure.built.diagram.purpose,
      kind: figure.built.diagram.kind,
      plantuml: figure.built.plantumlCode,
      semanticModel: figure.built.diagram,
      validation: figure.built.validation,
    })),
    saved,
  }
}

export async function rebuildManagedFigureSource(input: PatentDiagramPipelineInput & { figureNo: number }) {
  const context = await loadPipelineContext(input.userId, input.patentId, input.sessionId)
  const figurePlan = context.session.figurePlans.find(figure => figure.figureNo === input.figureNo)
  const source = context.session.diagramSources.find(item => item.figureNo === input.figureNo && item.language === 'en')
  if (!figurePlan || !source) throw new PatentDiagramPipelineError('Managed figure not found', 404, undefined, { code: 'MANAGED_FIGURE_NOT_FOUND', stage: 'RENDER' })
  if (source.sourceMode !== 'MANAGED') {
    throw new PatentDiagramPipelineError('This figure is a raw override and requires raw-source repair.', 409, undefined, { code: 'RAW_REPAIR_REQUIRED', stage: 'RENDER' })
  }
  if (figurePlan.referenceMapChecksum && figurePlan.referenceMapChecksum !== context.referenceMapChecksum) {
    throw new PatentDiagramPipelineError('The Component Plan changed after this figure was generated.', 409, undefined, {
      code: 'STALE_MANAGED_SEMANTICS', stage: 'RENDER', retryable: true,
      actions: ['Regenerate the managed figure from its plan and current Component Plan.'],
    })
  }
  const parsed = patentDiagramSchema.safeParse(figurePlan.semanticModel)
  if (!parsed.success) {
    throw new PatentDiagramPipelineError('The stored semantic model is missing or invalid.', 409, parsed.error.issues, {
      code: 'STALE_MANAGED_SEMANTICS', stage: 'RENDER', retryable: true,
      actions: ['Regenerate the managed figure from its saved plan.'],
    })
  }
  const built = buildPatentDiagram(parsed.data, context.components, context.supportedEvidenceIds)
  const semanticErrors = built.validation.issues.filter(issue => issue.severity === 'error' && issue.code !== 'SPLIT_REQUIRED')
  if (semanticErrors.length) throw new PatentDiagramPipelineError('The semantic figure must be regenerated before it can be rendered.', 422, semanticErrors, {
    code: 'STALE_MANAGED_SEMANTICS', stage: 'VALIDATION', retryable: true,
    actions: ['Regenerate the managed figure so its semantics can be corrected.'],
  })
  let rendered: Awaited<ReturnType<typeof renderAndWriteDiagramArtifacts>>
  try {
    rendered = await renderAndWriteDiagramArtifacts({ patentId: input.patentId, figureNo: input.figureNo, plantumlCode: built.plantumlCode, pagePolicy: context.pagePolicy })
  } catch (error) {
    throw new PatentDiagramPipelineError('The managed source was rebuilt, but rendering still failed.', 422, error instanceof Error ? error.message : error, {
      code: 'MANAGED_RENDER_FAILED', stage: 'RENDER', retryable: true,
      actions: ['Use Modify to simplify the semantic figure.', 'If it repeats, ask an administrator to check the PlantUML renderer.'],
      automaticCorrection: { attempted: true, attempts: 1, result: 'FAILED' },
    })
  }
  applyRenderedLayoutValidation(built, rendered.svg)
  if (rendered.effectiveFontSizePt != null && rendered.effectiveFontSizePt < context.pagePolicy.minimumTextSizePt) {
    built.validation.issues.push({
      code: 'PAGE_FIT_MINIMUM_TEXT', severity: 'error',
      message: `Page fitting would reduce text to ${rendered.effectiveFontSizePt.toFixed(1)} pt below the ${context.pagePolicy.minimumTextSizePt} pt minimum`,
    })
    built.validation.filingReady = false
  }
  const semanticHash = semanticChecksum({ referenceMapChecksum: context.referenceMapChecksum, semantic: built.diagram })
  const renderArtifacts = rendered.artifacts
  const checksum = crypto.createHash('sha256').update(built.plantumlCode).digest('hex')
  const updated = await prisma.$transaction(async tx => {
    await tx.figurePlan.update({
      where: { id: figurePlan.id },
      data: { nodes: built.nodes as any, edges: built.edges as any, validationReport: built.validation as any, semanticChecksum: semanticHash, referenceMapChecksum: context.referenceMapChecksum },
    })
    return tx.diagramSource.update({
      where: { id: source.id },
      data: {
        plantumlCode: built.plantumlCode, checksum, labelMap: built.labelMap as any,
        renderArtifacts: renderArtifacts as any,
        renderStatus: built.validation.filingReady ? 'SUCCESS' : 'REVIEW_REQUIRED',
        renderError: built.validation.filingReady ? null : built.validation.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join('; '),
        semanticChecksum: semanticHash, referenceMapChecksum: context.referenceMapChecksum,
        imageFilename: renderArtifacts.png.filename, imagePath: renderArtifacts.png.path,
        imageChecksum: rendered.png.checksum, imageUploadedAt: new Date(),
      },
    })
  })
  const previousPaths = [
    source.imagePath,
    (source.renderArtifacts as any)?.svg?.path,
    (source.renderArtifacts as any)?.png?.path,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
  await Promise.allSettled(previousPaths.filter(path => path !== renderArtifacts.svg.path && path !== renderArtifacts.png.path).map(path => fs.unlink(path)))
  return { fixedCode: built.plantumlCode, diagramSource: updated, validationReport: built.validation, renderArtifacts, repairMode: 'SEMANTIC_REBUILD' as const }
}

export async function regenerateManagedFigure(input: PatentDiagramPipelineInput & { figureNo: number; approveSplit?: boolean }) {
  const context = await loadPipelineContext(input.userId, input.patentId, input.sessionId)
  const existingPlan = context.session.figurePlans.find(figure => figure.figureNo === input.figureNo)
  if (!existingPlan) throw new PatentDiagramPipelineError('Figure plan not found', 404)
  const source = context.session.diagramSources.find(item => item.figureNo === input.figureNo && item.language === 'en')
  const existingDiagram = existingPlan.semanticModel
    ? patentDiagramSchema.safeParse(existingPlan.semanticModel)
    : null
  const previous = existingDiagram?.success ? existingDiagram.data : null
  const storedFigureSet = figureSetPlanSchema.safeParse((context.session.aiAnalysisData as any)?.figurePlan)
  const savedPlanItem = storedFigureSet.success
    ? storedFigureSet.data.figures.find(item => item.key === previous?.key)
      || storedFigureSet.data.figures.find(item => item.title === existingPlan.title)
    : undefined
  const kind = savedPlanItem?.kind || previous?.kind || String(existingPlan.diagramType || 'COMPONENT') as PatentDiagram['kind']
  const componentIds = savedPlanItem?.componentIds || (previous
    ? Array.from(new Set(
      previous.kind === 'COMPONENT' ? previous.components.map(node => node.componentId)
        : previous.kind === 'SEQUENCE' ? previous.participants.map(node => node.componentId)
          : previous.kind === 'PROCESS' ? previous.nodes.flatMap(node => [node.componentId, ...node.relatedComponentIds].filter(Boolean) as string[])
            : previous.constituents.map(node => node.componentId),
    ))
    : context.components.map(component => component.id).slice(0, 12))
  const plan: FigureSetPlanItem = {
    key: savedPlanItem?.key || previous?.key || `figure-${input.figureNo}`,
    kind,
    title: savedPlanItem?.title || existingPlan.title,
    purpose: savedPlanItem?.purpose || existingPlan.description || input.instructions || `Regenerated Figure ${input.figureNo}`,
    detailLevel: savedPlanItem?.detailLevel || previous?.detailLevel || 'DETAIL',
    direction: savedPlanItem?.direction || previous?.direction || 'TB',
    componentIds,
    claimCriticalComponentIds: savedPlanItem?.claimCriticalComponentIds || previous?.claimCriticalComponentIds || [],
    orderedGroups: savedPlanItem?.orderedGroups || (previous?.kind === 'COMPONENT'
      ? previous.groups.map(group => ({ id: group.id, label: group.label, componentIds: group.rows.flatMap(row => row.componentIds) }))
      : []),
    phaseHints: savedPlanItem?.phaseHints || [],
    // A regeneration keeps the disclosed operations the figure already cites, so
    // redrawing it cannot quietly widen its factual basis.
    evidenceIds: savedPlanItem?.evidenceIds || previous?.evidenceIds || [],
    coverageRequirementIds: savedPlanItem?.coverageRequirementIds || previous?.coverageRequirementIds || [],
  }
  const diagram = await detailManagedFigure({ plan, context, pipeline: input, coverageLedger: storedFigureSet.success ? storedFigureSet.data.coverageLedger : undefined, existingDiagram: previous })
  const decomposed = decomposeForResolvedPolicy(diagram, context.pagePolicy)
  if (decomposed.length > 1) {
    const splitProposal = decomposed.map(item => ({ title: item.title, kind: item.kind, semanticModel: item }))
    if (!input.approveSplit) return { status: 'SPLIT_REQUIRED' as const, splitProposal }

    const occupied = new Set(context.session.figurePlans.map(figure => figure.figureNo))
    const extraNumbers: number[] = []
    let candidate = Math.max(0, ...Array.from(occupied).filter(value => value < GENERATED_FIGURE_LIMIT)) + 1
    for (let index = 1; index < decomposed.length; index++) {
      while (occupied.has(candidate)) candidate++
      if (candidate >= GENERATED_FIGURE_LIMIT) throw new PatentDiagramPipelineError('No generated figure slots remain for the approved split', 409)
      extraNumbers.push(candidate)
      occupied.add(candidate++)
    }
    const figureNumbers = [input.figureNo, ...extraNumbers]
    const renderedSplit = await buildAndRenderAdaptive({
      patentId: input.patentId,
      diagrams: decomposed,
      components: context.components,
      supportedEvidenceIds: context.supportedEvidenceIds,
      pagePolicy: context.pagePolicy,
      allocateFigureNumbers: count => {
        if (count !== figureNumbers.length) throw new PatentDiagramPipelineError('The approved split requires further decomposition; review a new split proposal', 409)
        return figureNumbers
      },
    })
    await prisma.$transaction(async tx => {
      for (let index = 0; index < renderedSplit.length; index++) {
        const item = renderedSplit[index]
        const semanticHash = semanticChecksum({ referenceMapChecksum: context.referenceMapChecksum, semantic: item.built.diagram })
        const artifacts = {
          svg: { filename: item.svgFilename, path: item.svgPath, checksum: item.svg.checksum, contentType: item.svg.contentType, width: item.svg.width, height: item.svg.height },
          png: { filename: item.pngFilename, path: item.pngPath, checksum: item.png.checksum, contentType: item.png.contentType },
        }
        if (index === 0) {
          await tx.figurePlan.update({
            where: { id: existingPlan.id },
            data: {
              title: item.built.diagram.title, description: item.built.diagram.purpose,
              nodes: item.built.nodes as any, edges: item.built.edges as any,
              diagramType: item.built.diagram.kind, semanticSchemaVersion: item.built.diagram.schemaVersion,
              semanticModel: item.built.diagram as any, semanticChecksum: semanticHash, referenceMapChecksum: context.referenceMapChecksum,
              validationReport: item.built.validation as any, detailOfFigureNo: null,
            },
          })
        } else {
          await tx.figurePlan.create({
            data: {
              sessionId: input.sessionId, figureNo: item.figureNo, title: item.built.diagram.title,
              description: item.built.diagram.purpose, nodes: item.built.nodes as any, edges: item.built.edges as any,
              diagramType: item.built.diagram.kind, semanticSchemaVersion: item.built.diagram.schemaVersion,
              semanticModel: item.built.diagram as any, semanticChecksum: semanticHash, referenceMapChecksum: context.referenceMapChecksum,
              validationReport: item.built.validation as any, detailOfFigureNo: input.figureNo,
            },
          })
        }
        await tx.diagramSource.upsert({
          where: { sessionId_figureNo_language: { sessionId: input.sessionId, figureNo: item.figureNo, language: 'en' } },
          create: {
            sessionId: input.sessionId, figureNo: item.figureNo, language: 'en', plantumlCode: item.built.plantumlCode,
            checksum: crypto.createHash('sha256').update(item.built.plantumlCode).digest('hex'), sourceMode: 'MANAGED',
            labelMap: item.built.labelMap as any,
            semanticChecksum: semanticHash, referenceMapChecksum: context.referenceMapChecksum, renderArtifacts: artifacts as any,
            renderStatus: item.built.validation.filingReady ? 'SUCCESS' : 'REVIEW_REQUIRED',
            renderError: item.built.validation.filingReady ? null : item.built.validation.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join('; '),
            imageFilename: item.pngFilename, imagePath: item.pngPath, imageChecksum: item.png.checksum, imageUploadedAt: new Date(),
          },
          update: {
            plantumlCode: item.built.plantumlCode, checksum: crypto.createHash('sha256').update(item.built.plantumlCode).digest('hex'),
            sourceMode: 'MANAGED', semanticChecksum: semanticHash, referenceMapChecksum: context.referenceMapChecksum, renderArtifacts: artifacts as any,
            renderStatus: item.built.validation.filingReady ? 'SUCCESS' : 'REVIEW_REQUIRED',
            renderError: item.built.validation.filingReady ? null : item.built.validation.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join('; '),
            labelMap: item.built.labelMap as any,
            imageFilename: item.pngFilename, imagePath: item.pngPath, imageChecksum: item.png.checksum, imageUploadedAt: new Date(),
          },
        })
      }
      await tx.diagramSource.updateMany({
        where: { sessionId: input.sessionId, figureNo: input.figureNo, language: { not: 'en' } },
        data: { renderStatus: 'STALE', translatedFromChecksum: source?.checksum || null },
      })
      await tx.draftingSession.update({
        where: { id: input.sessionId },
        data: { figureSequence: null as any, figureSequenceFinalized: false },
      })
    })
    return {
      status: 'SUCCESS' as const,
      splitApproved: true,
      figures: renderedSplit.map(item => ({ figureNo: item.figureNo, plantuml: item.built.plantumlCode, semanticModel: item.built.diagram, validation: item.built.validation })),
    }
  }
  const built = buildPatentDiagram(diagram, context.components, context.supportedEvidenceIds)
  if (!built.validation.filingReady) throw new PatentDiagramPipelineError('The regenerated semantic figure still has filing-readiness errors.', 422, built.validation.issues, {
    code: 'REGENERATED_FIGURE_INVALID', stage: 'VALIDATION', retryable: true,
    actions: ['Modify the figure to reduce density or correct the listed semantic issue.', 'Create a separate detail figure if all content cannot fit safely.'],
  })
  const rendered = (await renderManagedFigures(input.patentId, [built], [input.figureNo], context.pagePolicy))[0]
  if (!rendered.built.validation.filingReady) {
    const forced = decomposePatentDiagram(diagram, true)
    if (forced.length > 1) return { status: 'SPLIT_REQUIRED' as const, splitProposal: forced.map(item => ({ title: item.title, kind: item.kind, semanticModel: item })) }
  }
  const semanticHash = semanticChecksum({ referenceMapChecksum: context.referenceMapChecksum, semantic: built.diagram })
  const renderArtifacts = {
    svg: { filename: rendered.svgFilename, path: rendered.svgPath, checksum: rendered.svg.checksum, contentType: rendered.svg.contentType, width: rendered.svg.width, height: rendered.svg.height },
    png: { filename: rendered.pngFilename, path: rendered.pngPath, checksum: rendered.png.checksum, contentType: rendered.png.contentType },
  }
  await prisma.$transaction([
    prisma.figurePlan.update({
      where: { id: existingPlan.id },
      data: {
        title: built.diagram.title,
        description: built.diagram.purpose,
        nodes: built.nodes as any,
        edges: built.edges as any,
        diagramType: built.diagram.kind,
        semanticSchemaVersion: built.diagram.schemaVersion,
        semanticModel: built.diagram as any,
        semanticChecksum: semanticHash,
        referenceMapChecksum: context.referenceMapChecksum,
        validationReport: built.validation as any,
      },
    }),
    prisma.diagramSource.upsert({
      where: { sessionId_figureNo_language: { sessionId: input.sessionId, figureNo: input.figureNo, language: 'en' } },
      create: {
        sessionId: input.sessionId, figureNo: input.figureNo, language: 'en',
        plantumlCode: built.plantumlCode, checksum: crypto.createHash('sha256').update(built.plantumlCode).digest('hex'),
        sourceMode: 'MANAGED', semanticChecksum: semanticHash, referenceMapChecksum: context.referenceMapChecksum, renderArtifacts: renderArtifacts as any,
        renderStatus: built.validation.filingReady ? 'SUCCESS' : 'REVIEW_REQUIRED',
        renderError: built.validation.filingReady ? null : built.validation.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join('; '),
        labelMap: built.labelMap as any,
        imageFilename: rendered.pngFilename, imagePath: rendered.pngPath, imageChecksum: rendered.png.checksum, imageUploadedAt: new Date(),
      },
      update: {
        plantumlCode: built.plantumlCode, checksum: crypto.createHash('sha256').update(built.plantumlCode).digest('hex'),
        sourceMode: 'MANAGED', semanticChecksum: semanticHash, referenceMapChecksum: context.referenceMapChecksum, renderArtifacts: renderArtifacts as any,
        labelMap: built.labelMap as any,
        renderStatus: built.validation.filingReady ? 'SUCCESS' : 'REVIEW_REQUIRED',
        renderError: built.validation.filingReady ? null : built.validation.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join('; '),
        imageFilename: rendered.pngFilename, imagePath: rendered.pngPath, imageChecksum: rendered.png.checksum, imageUploadedAt: new Date(),
      },
    }),
    prisma.diagramSource.updateMany({
      where: { sessionId: input.sessionId, figureNo: input.figureNo, language: { not: 'en' } },
      data: { renderStatus: 'STALE', translatedFromChecksum: source?.checksum || null },
    }),
  ])
  return {
    status: built.validation.filingReady ? 'SUCCESS' as const : 'REVIEW_REQUIRED' as const,
    figure: { figureNo: input.figureNo, plantuml: built.plantumlCode, semanticModel: built.diagram, validation: built.validation, renderArtifacts },
  }
}
