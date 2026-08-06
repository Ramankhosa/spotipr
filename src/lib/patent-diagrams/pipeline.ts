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
import { buildDiagramBatchPrompt, buildFigureSetPlanningPrompt, buildFigureSplitPrompt, extractJsonObject } from './prompts'
import { FIGURE_SET_PLAN_RESPONSE_SCHEMA, diagramBatchResponseSchema } from './response-schemas'
import { PATENT_DIAGRAM_COMPLEXITY } from './policy'
import {
  DEFAULT_FIGURE_KINDS,
  figureSetPlanSchema,
  patentDiagramBatchSchema,
  patentDiagramSchema,
  type BuiltPatentDiagram,
  type DiagramKind,
  type FigureSetPlan,
  type FigureSetPlanItem,
  type PatentDiagram,
  type PatentDiagramComponent,
} from './types'

/**
 * Managed patent figure pipeline.
 *
 * Two LLM stages, and nothing else between the attorney and a drawing:
 *
 *   1. ONE planning call produces the whole figure set. The default set is one
 *      figure of each supported kind (COMPONENT, PROCESS, SEQUENCE,
 *      CONSTITUENT); an explicit figureCount cycles through those kinds.
 *   2. Generation calls detail the planned figures TWO AT A TIME, run
 *      concurrently up to the tenant's metered limit.
 *
 * Everything after that is deterministic: normalize the model's output, build
 * PlantUML, render, save. There is no coverage ledger, no automatic figure
 * decomposition, no density gate and no filing-readiness veto — a figure that
 * parses gets drawn, and validation findings are advisory notes attached to the
 * saved figure rather than reasons to fail a run the attorney is waiting on.
 */

// Figures at or above this number are user-imported and are never touched by
// managed generation — not their rows and not their files.
const GENERATED_FIGURE_LIMIT = 900
const MAXIMUM_FIGURES_PER_RUN = 20
const FIGURES_PER_GENERATION_CALL = 2

export class PatentDiagramPipelineError extends Error {
  status: number
  details?: unknown
  code: string
  stage: 'PLAN' | 'DETAIL' | 'RENDER' | 'PERSIST' | 'GENERAL'
  retryable: boolean
  actions: string[]

  constructor(message: string, status = 400, details?: unknown, options?: {
    code?: string
    stage?: PatentDiagramPipelineError['stage']
    retryable?: boolean
    actions?: string[]
  }) {
    super(message)
    this.name = 'PatentDiagramPipelineError'
    this.status = status
    this.details = details
    this.code = options?.code || 'PATENT_DIAGRAM_PIPELINE_ERROR'
    this.stage = options?.stage || 'GENERAL'
    this.retryable = options?.retryable ?? status >= 500
    this.actions = options?.actions || ['Try the operation again.']
  }
}

// Stage 0 stores richer claim-support metadata than figure planning needs; only
// the two fields that matter are carried through. Anything unparseable becomes
// null, which downstream code reads as "unknown", not "not claimed".
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
  const idea = (session.ideaRecord?.normalizedData as any) || {}
  const countryCode = session.activeJurisdiction || session.draftingJurisdictions[0] || 'US'
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
      return { figureNo: figure.figureNo, title: figure.title, kind: figure.diagramType, componentIds }
    })
  return {
    session,
    components,
    referenceMapChecksum: semanticChecksum((session.referenceMap as any)?.components || []),
    idea,
    claims: claimsContextFromIdea(idea),
    evidenceCatalog: evidenceCatalogFromIdea(idea),
    pagePolicy: await resolveDiagramPagePolicy(countryCode),
    countryCode,
    existingFigures,
  }
}

type PipelineContext = Awaited<ReturnType<typeof loadPipelineContext>>

// OpenAI strict structured outputs cannot express "omit this key", so optional
// fields arrive as explicit nulls. The Zod contracts use .optional(), which
// rejects null, and no LLM-facing diagram field assigns meaning to null —
// dropping null-valued keys before validation makes both worlds agree.
function withoutNullValues<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutNullValues) as unknown as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== null)
        .map(([key, entryValue]) => [key, withoutNullValues(entryValue)]),
    ) as unknown as T
  }
  return value
}

type StructuredStageCode = 'DRAFT_FIGURE_PLANNER' | 'DRAFT_DIAGRAM_GENERATION'

interface StructuredStageInput<S extends z.ZodTypeAny> {
  userHeaders: Record<string, string>
  stageCode: StructuredStageCode
  prompt: string
  schema: S
  metadata: Record<string, unknown>
  /** Strict OpenAI json_schema for the reply; providers without support ignore it. */
  responseSchema?: { name: string; schema: Record<string, unknown> }
  /** Session-stable key so same-prefix prompts land on the same provider cache shard. */
  promptCacheKey?: string
  maxAttempts?: number
}

export async function executeStructured<S extends z.ZodTypeAny>(input: StructuredStageInput<S>): Promise<z.output<S>> {
  const { llmGateway } = await import('@/lib/metering/gateway')
  let prompt = input.prompt
  let previousOutput = ''
  let previousErrors = ''
  const maxAttempts = Math.max(1, input.maxAttempts ?? 2)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt) {
      const boundedErrors = previousErrors.slice(0, 4_000)
      const boundedOutput = previousOutput.slice(0, 12_000)
      prompt = `${input.prompt}\n\nYour previous JSON was invalid. Correct it without changing supported semantics.\nVALIDATION ERRORS:\n${boundedErrors}\nPREVIOUS OUTPUT (bounded):\n${boundedOutput}`
    }
    const startedAt = Date.now()
    const result = await llmGateway.executeLLMOperation({ headers: input.userHeaders || {} }, {
      taskCode: 'LLM3_DIAGRAM',
      stageCode: input.stageCode,
      prompt,
      idempotencyKey: crypto.randomUUID(),
      inputTokens: Math.ceil(prompt.length / 4),
      // Diagram stages are structured extraction against a validated schema, not
      // open-ended judgment, so high thinking budgets only buy latency. Providers
      // ignore keys they do not understand.
      parameters: {
        thinking_level: 'low',
        reasoning_effort: 'low',
        temperature: 0.2,
        ...(input.responseSchema ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: input.responseSchema.name, strict: true, schema: input.responseSchema.schema },
          },
        } : {}),
        ...(input.promptCacheKey ? { prompt_cache_key: input.promptCacheKey } : {}),
      },
      metadata: { ...input.metadata, structuredDiagram: true, attempt: attempt + 1 },
    })
    console.log(`[DiagramPipeline] ${input.stageCode} purpose=${String(input.metadata.purpose || 'unknown')} attempt=${attempt + 1} model=${result.response?.modelClass || 'unresolved'} ms=${Date.now() - startedAt}`)
    if (!result.success || !result.response?.output) {
      throw new PatentDiagramPipelineError(result.error?.message || 'Diagram LLM request failed', 502, result.error, {
        code: 'DIAGRAM_PROVIDER_FAILED', stage: input.stageCode === 'DRAFT_FIGURE_PLANNER' ? 'PLAN' : 'DETAIL', retryable: true,
        actions: ['Try again.', 'If it repeats, ask an administrator to verify the configured diagram model and token limits.'],
      })
    }
    previousOutput = result.response.output
    try {
      const parsed = input.schema.safeParse(withoutNullValues(extractJsonObject(previousOutput)))
      if (parsed.success) return parsed.data
      previousErrors = parsed.error.issues.map(issue => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('\n')
    } catch (error) {
      previousErrors = error instanceof Error ? error.message : 'Invalid JSON'
    }
    // A rejected reply costs a full extra round trip, so the reason is logged:
    // a defect that shows up on most first attempts is a prompt bug, not model
    // noise, and is the cheapest latency to remove.
    console.warn(`[DiagramPipeline] ${input.stageCode} purpose=${String(input.metadata.purpose || 'unknown')} attempt=${attempt + 1} REJECTED: ${previousErrors.slice(0, 600).replace(/\n/g, ' | ')}`)
  }
  throw new PatentDiagramPipelineError(`The diagram model answered ${maxAttempts} times, but no reply matched the required structured format.`, 422, previousErrors, {
    code: 'INVALID_STRUCTURED_DIAGRAM', stage: input.stageCode === 'DRAFT_FIGURE_PLANNER' ? 'PLAN' : 'DETAIL', retryable: true,
    actions: ['Try again to request a fresh structured reply.', 'Ask an administrator to check the model output-token limit if it repeats.'],
  })
}

export interface PatentDiagramPipelineInput {
  userId: string
  patentId: string
  sessionId: string
  requestHeaders: Record<string, string>
  figureCount?: number | null
  instructions?: string
  includeExistingFigures?: boolean
}

function exactFigureCount(figureCount?: number | null): number | null {
  return figureCount && Number.isInteger(figureCount) && figureCount > 0
    ? Math.min(figureCount, MAXIMUM_FIGURES_PER_RUN)
    : null
}

/**
 * Auto-mode anchor for the planner: one figure per kind, plus one extra figure
 * for each planning-target's worth of components or disclosed steps beyond the
 * first. This is a SUGGESTION in the prompt, not a bound — the planner may
 * exceed it, and the repair floor only guarantees kind coverage and the cap.
 * It exists because a fixed default of four squeezed complex inventions into
 * dense figures readable only at high zoom.
 */
function suggestedFigureCount(context: PipelineContext): number {
  const targets = PATENT_DIAGRAM_COMPLEXITY.planningTargets
  const componentCount = context.components.length
  const stepCount = context.evidenceCatalog.filter(entry => entry.id.startsWith('SF-processSteps-')).length
  const extra = Math.ceil(Math.max(0, componentCount - targets.components) / targets.components)
    + Math.ceil(Math.max(0, stepCount - targets.steps) / targets.steps)
  return Math.min(MAXIMUM_FIGURES_PER_RUN, DEFAULT_FIGURE_KINDS.length + extra)
}

function planningContextChecksum(context: PipelineContext, input?: Pick<PatentDiagramPipelineInput, 'instructions' | 'figureCount'>): string {
  return semanticChecksum({
    claims: context.claims,
    inventionFacts: context.idea,
    components: context.components,
    jurisdiction: context.countryCode,
    instructions: input?.instructions || null,
    figureCount: exactFigureCount(input?.figureCount) ?? 'auto',
  })
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

function fallbackPlanItem(kind: DiagramKind, index: number, components: PatentDiagramComponent[]): FigureSetPlanItem {
  const titleByKind: Record<DiagramKind, string> = {
    COMPONENT: 'System Architecture',
    PROCESS: 'Method of Operation',
    SEQUENCE: 'Interaction Sequence',
    CONSTITUENT: 'Composition',
  }
  return {
    key: `figure-${index + 1}-${kind.toLowerCase()}`,
    kind,
    title: titleByKind[kind],
    purpose: `Depicts the ${titleByKind[kind].toLowerCase()} of the disclosed invention.`,
    detailLevel: 'DETAIL',
    direction: kind === 'SEQUENCE' ? 'LR' : 'TB',
    componentIds: components.map(component => component.id).slice(0, 16),
    claimCriticalComponentIds: [],
    orderedGroups: [],
    phaseHints: [],
    evidenceIds: [],
  }
}

/**
 * Makes a model-authored plan usable instead of rejecting it.
 *
 * Unknown component IDs are dropped, duplicate keys are made unique, and a
 * figure left with no components inherits the registry. In manual mode the set
 * is trimmed or padded to the exact requested count (cycling the default
 * kinds); in auto mode the planner's chosen count is kept, capped at the
 * per-run maximum, with missing kinds padded in so the four-kind floor always
 * holds. Nothing here can fail.
 */
function repairPlanFigures(
  figures: FigureSetPlanItem[],
  components: PatentDiagramComponent[],
  options: { exactCount: number | null },
): FigureSetPlanItem[] {
  const known = new Set(components.map(component => component.id))
  const allIds = components.map(component => component.id)
  const usedKeys = new Set<string>()
  const limit = options.exactCount ?? MAXIMUM_FIGURES_PER_RUN
  const repaired = figures.slice(0, limit).map(figure => {
    let key = figure.key
    while (usedKeys.has(key)) key = `${figure.key}-${usedKeys.size + 1}`
    usedKeys.add(key)
    const componentIds = figure.componentIds.filter(id => known.has(id))
    return {
      ...figure,
      key,
      componentIds: componentIds.length ? componentIds : allIds.slice(0, 16),
      claimCriticalComponentIds: figure.claimCriticalComponentIds.filter(id => known.has(id)),
      orderedGroups: figure.orderedGroups
        .map(group => ({ ...group, componentIds: group.componentIds.filter(id => known.has(id)) }))
        .filter(group => group.componentIds.length),
    }
  })
  if (options.exactCount != null) {
    for (let index = repaired.length; index < options.exactCount; index++) {
      repaired.push(fallbackPlanItem(DEFAULT_FIGURE_KINDS[index % DEFAULT_FIGURE_KINDS.length], index, components))
    }
    return repaired
  }
  for (const kind of DEFAULT_FIGURE_KINDS) {
    if (repaired.length >= MAXIMUM_FIGURES_PER_RUN) break
    if (!repaired.some(figure => figure.kind === kind)) {
      repaired.push(fallbackPlanItem(kind, repaired.length, components))
    }
  }
  return repaired
}

/** The single planning LLM call for a figure set. */
export async function planManagedFigureSet(input: PatentDiagramPipelineInput): Promise<FigureSetPlan> {
  const context = await loadPipelineContext(input.userId, input.patentId, input.sessionId)
  const exactCount = exactFigureCount(input.figureCount)
  const contextChecksum = planningContextChecksum(context, input)
  const prompt = buildFigureSetPlanningPrompt({
    inventionTitle: context.session.ideaRecord?.title || context.idea?.title || 'Untitled invention',
    patentType: context.session.patentTypePrimary,
    inventionContext: context.idea,
    claimsContext: context.claims,
    components: context.components,
    evidenceCatalog: context.evidenceCatalog,
    existingFigures: input.includeExistingFigures ? context.existingFigures : [],
    figureCount: exactCount ?? suggestedFigureCount(context),
    exactFigureCount: exactCount != null,
    instructions: input.instructions,
  })
  const llmPlan = await executeStructured({
    userHeaders: input.requestHeaders,
    stageCode: 'DRAFT_FIGURE_PLANNER',
    prompt,
    schema: figureSetPlanSchema,
    responseSchema: { name: 'figure_set_plan', schema: FIGURE_SET_PLAN_RESPONSE_SCHEMA },
    promptCacheKey: `patent-diagrams:${input.sessionId}`,
    metadata: { patentId: input.patentId, sessionId: input.sessionId, purpose: 'plan_figures_structured' },
  })
  const plan = figureSetPlanSchema.parse({
    schemaVersion: 3,
    contextChecksum,
    figures: repairPlanFigures(llmPlan.figures, context.components, { exactCount }),
  })
  const previousAnalysis = context.session.aiAnalysisData && typeof context.session.aiAnalysisData === 'object'
    ? context.session.aiAnalysisData as Record<string, unknown>
    : {}
  await prisma.draftingSession.update({
    where: { id: input.sessionId },
    data: { aiAnalysisData: { ...previousAnalysis, figurePlan: plan } as any },
  })
  return plan
}

/**
 * One generation call for a batch of planned figures (the pipeline sends two).
 *
 * Returned diagrams are matched back to their plan item by key, falling back to
 * position. A plan item the model did not answer for is simply left out — the
 * attorney gets the figures that worked rather than an error for the set.
 */
async function detailFigureBatch(input: {
  plans: FigureSetPlanItem[]
  context: PipelineContext
  pipeline: PatentDiagramPipelineInput
  existingDiagrams?: PatentDiagram[]
}): Promise<PatentDiagram[]> {
  const prompt = buildDiagramBatchPrompt({
    plans: input.plans,
    inventionContext: input.context.idea,
    claimsContext: input.context.claims,
    components: input.context.components,
    evidenceCatalog: input.context.evidenceCatalog,
    existingDiagrams: input.existingDiagrams,
    instructions: input.pipeline.instructions,
  })
  const batch = await executeStructured({
    userHeaders: input.pipeline.requestHeaders,
    stageCode: 'DRAFT_DIAGRAM_GENERATION',
    prompt,
    schema: patentDiagramBatchSchema,
    responseSchema: {
      name: 'patent_diagram_batch',
      schema: diagramBatchResponseSchema(input.plans.map(plan => plan.kind)),
    },
    promptCacheKey: `patent-diagrams:${input.pipeline.sessionId}`,
    metadata: {
      patentId: input.pipeline.patentId,
      sessionId: input.pipeline.sessionId,
      figureKeys: input.plans.map(plan => plan.key).join(','),
      purpose: 'detail_figures_structured',
    },
  })
  // Match by key, then fall back to whatever is left over in order, so a model
  // that renames or reorders its diagrams still produces the planned figures.
  const byKey = new Map(batch.diagrams.map(diagram => [diagram.key, diagram]))
  const spare = batch.diagrams.filter(diagram => !input.plans.some(plan => plan.key === diagram.key))
  return input.plans.flatMap(plan => {
    const diagram = byKey.get(plan.key) ?? spare.shift()
    if (!diagram || diagram.kind !== plan.kind) {
      console.warn(`[DiagramPipeline] no ${plan.kind} diagram returned for planned figure ${plan.key}; skipping it`)
      return []
    }
    // Plan identity and headings are server-owned so the saved figure always
    // matches the plan the attorney approved, whatever the model echoed back.
    return [{
      ...diagram,
      schemaVersion: 3,
      key: plan.key,
      title: plan.title,
      purpose: plan.purpose,
      detailLevel: plan.detailLevel,
      direction: plan.direction,
    } as PatentDiagram]
  })
}

// Metering caps concurrent LLM3_DIAGRAM reservations per tenant (a per-plan
// policy rule, default 2). Fanning out wider than that does not run faster — it
// throws CONCURRENCY_LIMIT and fails the whole figure set. So the pipeline asks
// for the tenant's real limit instead of hardcoding one.
const DIAGRAM_CONCURRENCY_FALLBACK = 2

async function resolveDiagramConcurrency(requestHeaders: Record<string, string>): Promise<number> {
  const { llmGateway } = await import('@/lib/metering/gateway')
  const limit = await llmGateway.getTaskConcurrencyLimit({ headers: requestHeaders || {} }, 'LLM3_DIAGRAM')
  return Math.max(1, limit ?? DIAGRAM_CONCURRENCY_FALLBACK)
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

/** Details every planned figure, two per LLM call, batches running concurrently. */
async function detailPlannedFigures(plan: FigureSetPlan, context: PipelineContext, pipeline: PatentDiagramPipelineInput): Promise<PatentDiagram[]> {
  const batches = chunk(plan.figures, FIGURES_PER_GENERATION_CALL)
  const concurrency = await resolveDiagramConcurrency(pipeline.requestHeaders)
  const detailed = await mapWithConcurrency(batches, concurrency, plans => detailFigureBatch({ plans, context, pipeline }))
  const diagrams = detailed.flat()
  if (!diagrams.length) {
    throw new PatentDiagramPipelineError('The diagram model did not return any usable figures.', 422, undefined, {
      code: 'NO_FIGURES_GENERATED', stage: 'DETAIL', retryable: true,
      actions: ['Try generating again.', 'If it repeats, re-save the Component Plan and confirm the invention facts.'],
    })
  }
  return diagrams
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

// Rendering is an HTTP round trip to the PlantUML server, not a metered LLM
// call, so it is bounded by that server rather than by any plan policy.
function renderConcurrency(): number {
  const configured = Number(process.env.DIAGRAM_RENDER_CONCURRENCY)
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 4
}

async function renderManagedFigures(
  patentId: string,
  builtFigures: BuiltPatentDiagram[],
  figureNumbers?: number[],
  pagePolicy?: PipelineContext['pagePolicy'],
): Promise<RenderedManagedFigure[]> {
  const outcomes = await mapWithConcurrency(builtFigures, renderConcurrency(), async (built, index) => {
    try {
      const figureNo = figureNumbers?.[index] ?? index + 1
      const rendered = await renderAndWriteDiagramArtifacts({ patentId, figureNo, plantumlCode: built.plantumlCode, pagePolicy })
      const { svg, png, artifacts } = rendered
      built.validation.render = {
        width: svg.width,
        height: svg.height,
        viewBox: svg.viewBox,
        aspectRatio: svg.width && svg.height ? svg.width / svg.height : undefined,
        effectiveFontSizePt: rendered.effectiveFontSizePt,
      }
      // Layout findings are review notes. A wide drawing or one that would need
      // shrinking to fit the page is still a drawing; the attorney decides.
      const aspectRatio = built.validation.render.aspectRatio
      if (aspectRatio && (aspectRatio > EXTREME_ASPECT_RATIO_MAXIMUM || aspectRatio < EXTREME_ASPECT_RATIO_MINIMUM)) {
        built.validation.issues.push({
          code: 'EXTREME_ASPECT_RATIO', severity: 'warning',
          message: `Rendered aspect ratio ${aspectRatio.toFixed(2)} is outside the preferred filing range; consider dividing the figure`,
        })
      }
      if (rendered.effectiveFontSizePt != null && pagePolicy && rendered.effectiveFontSizePt < pagePolicy.minimumTextSizePt) {
        built.validation.issues.push({
          code: 'PAGE_FIT_MINIMUM_TEXT', severity: 'warning',
          message: `Page fitting would reduce text to ${rendered.effectiveFontSizePt.toFixed(1)} pt, below the ${pagePolicy.minimumTextSizePt} pt guideline`,
        })
      }
      return {
        ok: true as const,
        value: {
          built, svg, png, figureNo,
          svgFilename: artifacts.svg.filename!,
          pngFilename: artifacts.png.filename!,
          svgPath: artifacts.svg.path!,
          pngPath: artifacts.png.path!,
        },
      }
    } catch (error) {
      return { ok: false as const, error }
    }
  })
  const completed = outcomes.flatMap(outcome => outcome.ok ? [outcome.value] : [])
  const failure = outcomes.find(outcome => !outcome.ok)
  if (failure && !failure.ok) {
    await Promise.allSettled(completed.flatMap(figure => [figure.svgPath, figure.pngPath]).map(path => fs.unlink(path)))
    throw new PatentDiagramPipelineError('The drawing set could not be rendered, so no partial set was saved.', 422, failure.error instanceof Error ? failure.error.message : failure.error, {
      code: 'DIAGRAM_RENDER_FAILED', stage: 'RENDER', retryable: true,
      actions: ['Retry generation.', 'Ask an administrator to verify the PlantUML renderer if it repeats.'],
    })
  }
  return completed
}

/**
 * Count rendered figures against the tenant's DIAGRAM_GENERATION quota. One
 * completion per figure, keyed on session + figure number so regenerating an
 * existing figure does not burn quota twice.
 */
async function recordFigureCompletions(input: PatentDiagramPipelineInput, figures: RenderedManagedFigure[]) {
  if (!figures.length) return
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { tenantId: true } })
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

function renderStatusFor(built: BuiltPatentDiagram) {
  const errors = built.validation.issues.filter(issue => issue.severity === 'error')
  return {
    renderStatus: errors.length ? 'REVIEW_REQUIRED' : 'SUCCESS',
    renderError: errors.length ? errors.map(issue => issue.message).join('; ') : null,
  }
}

async function persistManagedFigureSet(
  input: PatentDiagramPipelineInput,
  referenceMapChecksum: string,
  figures: RenderedManagedFigure[],
  options: { replace: boolean; plan: FigureSetPlan; baseContext: PipelineContext },
) {
  // Only generated figures are replaced, so only generated artifacts may be
  // deleted. Imported figures live at GENERATED_FIGURE_LIMIT and above; their
  // rows survive the delete below, so unlinking their uploads would strand them.
  const supersededPaths = options.replace
    ? Array.from(new Set(options.baseContext.session.diagramSources
        .filter(source => source.figureNo < GENERATED_FIGURE_LIMIT)
        .flatMap(source => [
          source.imagePath,
          source.originalImagePath,
          (source.renderArtifacts as any)?.svg?.path,
          (source.renderArtifacts as any)?.png?.path,
        ].filter((value): value is string => typeof value === 'string' && value.length > 0))))
    : []
  let saved: any[]
  try {
    saved = await prisma.$transaction(async tx => {
      if (options.replace) {
        await tx.diagramSource.deleteMany({ where: { sessionId: input.sessionId, figureNo: { lt: GENERATED_FIGURE_LIMIT } } })
        await tx.figurePlan.deleteMany({ where: { sessionId: input.sessionId, figureNo: { lt: GENERATED_FIGURE_LIMIT } } })
      }
      const rows: any[] = []
      for (const figure of figures) {
        const semantic = figure.built.diagram
        const semanticHash = semanticChecksum({ referenceMapChecksum, semantic })
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
            ...renderStatusFor(figure.built),
            semanticChecksum: semanticHash,
            referenceMapChecksum,
            imageFilename: figure.pngFilename,
            imagePath: figure.pngPath,
            imageChecksum: figure.png.checksum,
            imageUploadedAt: new Date(),
          },
        })
        rows.push({ plan, source, validation: figure.built.validation, renderArtifacts })
      }
      const session = await tx.draftingSession.findUnique({ where: { id: input.sessionId }, select: { aiAnalysisData: true } })
      await tx.draftingSession.update({
        where: { id: input.sessionId },
        data: {
          figureSequence: null as any, figureSequenceFinalized: false, figuresSkipped: false, figuresSkippedAt: null,
          // Re-read inside the transaction: generation takes minutes, and other
          // stages write to this shared blob while it runs.
          aiAnalysisData: {
            ...((session?.aiAnalysisData && typeof session.aiAnalysisData === 'object') ? session.aiAnalysisData as Record<string, unknown> : {}),
            figurePlan: options.plan,
          } as any,
        },
      })
      return rows
    })
  } catch (error) {
    await Promise.allSettled(figures.flatMap(figure => [figure.svgPath, figure.pngPath]).map(path => fs.unlink(path)))
    throw new PatentDiagramPipelineError('The figures rendered, but the drawing set could not be saved. Temporary artifacts were cleaned up.', 500, error instanceof Error ? error.message : error, {
      code: 'DIAGRAM_PERSIST_FAILED', stage: 'PERSIST', retryable: true,
      actions: ['Try generation again; the previous saved drawing set was left unchanged.'],
    })
  }

  await Promise.allSettled(supersededPaths.map(path => fs.unlink(path)))
  // Outside the transaction: metering must never roll back a persisted figure set.
  await recordFigureCompletions(input, figures)
  return saved
}

export interface ClaimComponentCoverage {
  /** False when Stage 0 claim matching has not run — unknown is not "complete". */
  evaluated: boolean
  missing: Array<{ id: string; name: string; referenceLabel: string; matchedClaims: number[] }>
}

/**
 * Post-generation check: does every claim-recited component appear in at least
 * one drawn figure? Deterministic, no LLM call, and purely informational — the
 * result is returned as a warning alongside the saved figures, never used to
 * fail or block a run.
 */
export function claimComponentCoverage(
  diagrams: PatentDiagram[],
  components: PatentDiagramComponent[],
): ClaimComponentCoverage {
  const claimed = components.filter(component => (component.claimSupport?.matchedClaims?.length || 0) > 0)
  if (!claimed.length) return { evaluated: false, missing: [] }
  const depicted = new Set(diagrams.flatMap(diagram =>
    diagram.kind === 'COMPONENT' ? diagram.components.map(node => node.componentId)
      : diagram.kind === 'SEQUENCE' ? diagram.participants.map(node => node.componentId)
        : diagram.kind === 'PROCESS' ? diagram.nodes.flatMap(node => [node.componentId, ...node.relatedComponentIds].filter(Boolean) as string[])
          : diagram.constituents.map(node => node.componentId)))
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

function summarizeReview(figures: RenderedManagedFigure[]) {
  const notes = figures.flatMap(figure => figure.built.validation.issues
    .filter(issue => issue.severity === 'warning')
    .map(issue => ({ figureNo: figure.figureNo, code: issue.code, message: issue.message })))
  return { status: 'READY' as const, ready: true, reviewNotes: notes }
}

function figureResponse(figure: RenderedManagedFigure) {
  return {
    figureNo: figure.figureNo,
    title: figure.built.diagram.title,
    purpose: figure.built.diagram.purpose,
    kind: figure.built.diagram.kind,
    plantuml: figure.built.plantumlCode,
    semanticModel: figure.built.diagram,
    validation: figure.built.validation,
  }
}

async function buildAndRender(input: {
  patentId: string
  diagrams: PatentDiagram[]
  components: PatentDiagramComponent[]
  pagePolicy: PipelineContext['pagePolicy']
  figureNumbers?: number[]
}) {
  const built = input.diagrams.map(diagram => buildPatentDiagram(diagram, input.components))
  return renderManagedFigures(input.patentId, built, input.figureNumbers, input.pagePolicy)
}

/** Plan (if needed), detail two figures per call, render and replace the set. */
export async function generateManagedFigureSet(input: PatentDiagramPipelineInput & { plan?: FigureSetPlan | null }) {
  const baseContext = await loadPipelineContext(input.userId, input.patentId, input.sessionId)
  const storedPlan = (baseContext.session.aiAnalysisData as any)?.figurePlan
  const parsedStoredPlan = storedPlan ? figureSetPlanSchema.safeParse(storedPlan) : null
  const currentChecksum = planningContextChecksum(baseContext, input)
  const storedIsCurrent = parsedStoredPlan?.success && parsedStoredPlan.data.contextChecksum === currentChecksum
  const plan = input.plan
    || (storedIsCurrent ? parsedStoredPlan.data : await planManagedFigureSet(input))
  const detailed = await detailPlannedFigures(plan, baseContext, input)
  const rendered = await buildAndRender({
    patentId: input.patentId,
    diagrams: detailed,
    components: baseContext.components,
    pagePolicy: baseContext.pagePolicy,
  })
  const saved = await persistManagedFigureSet(input, baseContext.referenceMapChecksum, rendered, { replace: true, plan, baseContext })
  return {
    plan,
    filingReadiness: summarizeReview(rendered),
    // Computed on what was actually drawn, not on the plan.
    claimCoverage: claimComponentCoverage(rendered.map(figure => figure.built.diagram), baseContext.components),
    figures: rendered.map(figureResponse),
    saved,
  }
}

/** Same as generation, but appends to the existing set instead of replacing it. */
export async function addManagedFigures(input: PatentDiagramPipelineInput & { plan?: FigureSetPlan | null }) {
  const baseContext = await loadPipelineContext(input.userId, input.patentId, input.sessionId)
  const plan = input.plan || await planManagedFigureSet(input)
  const detailed = await detailPlannedFigures(plan, baseContext, input)

  const occupied = new Set(baseContext.session.figurePlans.map(figure => figure.figureNo))
  const figureNumbers: number[] = []
  let candidate = Math.max(0, ...Array.from(occupied).filter(value => value < GENERATED_FIGURE_LIMIT)) + 1
  for (let index = 0; index < detailed.length; index++) {
    while (occupied.has(candidate)) candidate++
    if (candidate >= GENERATED_FIGURE_LIMIT) {
      throw new PatentDiagramPipelineError('No generated figure slots remain before the imported-figure range', 409)
    }
    figureNumbers.push(candidate)
    occupied.add(candidate++)
  }

  const rendered = await buildAndRender({
    patentId: input.patentId,
    diagrams: detailed,
    components: baseContext.components,
    pagePolicy: baseContext.pagePolicy,
    figureNumbers,
  })
  const saved = await persistManagedFigureSet(input, baseContext.referenceMapChecksum, rendered, { replace: false, plan, baseContext })
  return {
    plan,
    filingReadiness: summarizeReview(rendered),
    claimCoverage: claimComponentCoverage(rendered.map(figure => figure.built.diagram), baseContext.components),
    figures: rendered.map(figureResponse),
    saved,
  }
}

async function replaceFigureRecords(input: {
  sessionId: string
  figureNo: number
  built: BuiltPatentDiagram
  rendered: { svg: { checksum: string; contentType: string; width?: number; height?: number }; png: { checksum: string; contentType: string } }
  artifacts: { svg: { filename?: string; path?: string }; png: { filename?: string; path?: string } }
  referenceMapChecksum: string
  figurePlanId?: string
  previousSourceChecksum?: string | null
}) {
  const semanticHash = semanticChecksum({ referenceMapChecksum: input.referenceMapChecksum, semantic: input.built.diagram })
  const checksum = crypto.createHash('sha256').update(input.built.plantumlCode).digest('hex')
  const renderArtifacts = {
    svg: { filename: input.artifacts.svg.filename, path: input.artifacts.svg.path, checksum: input.rendered.svg.checksum, contentType: input.rendered.svg.contentType, width: input.rendered.svg.width, height: input.rendered.svg.height },
    png: { filename: input.artifacts.png.filename, path: input.artifacts.png.path, checksum: input.rendered.png.checksum, contentType: input.rendered.png.contentType },
  }
  const sourceData = {
    plantumlCode: input.built.plantumlCode,
    checksum,
    sourceMode: 'MANAGED' as const,
    labelMap: input.built.labelMap as any,
    renderArtifacts: renderArtifacts as any,
    ...renderStatusFor(input.built),
    semanticChecksum: semanticHash,
    referenceMapChecksum: input.referenceMapChecksum,
    imageFilename: input.artifacts.png.filename,
    imagePath: input.artifacts.png.path,
    imageChecksum: input.rendered.png.checksum,
    imageUploadedAt: new Date(),
  }
  await prisma.$transaction(async tx => {
    const planData = {
      title: input.built.diagram.title,
      description: input.built.diagram.purpose,
      nodes: input.built.nodes as any,
      edges: input.built.edges as any,
      diagramType: input.built.diagram.kind,
      semanticSchemaVersion: input.built.diagram.schemaVersion,
      semanticModel: input.built.diagram as any,
      semanticChecksum: semanticHash,
      referenceMapChecksum: input.referenceMapChecksum,
      validationReport: input.built.validation as any,
    }
    if (input.figurePlanId) {
      await tx.figurePlan.update({ where: { id: input.figurePlanId }, data: planData })
    } else {
      await tx.figurePlan.create({ data: { sessionId: input.sessionId, figureNo: input.figureNo, ...planData } })
    }
    await tx.diagramSource.upsert({
      where: { sessionId_figureNo_language: { sessionId: input.sessionId, figureNo: input.figureNo, language: 'en' } },
      create: { sessionId: input.sessionId, figureNo: input.figureNo, language: 'en', ...sourceData },
      update: sourceData,
    })
    await tx.diagramSource.updateMany({
      where: { sessionId: input.sessionId, figureNo: input.figureNo, language: { not: 'en' } },
      data: { renderStatus: 'STALE', translatedFromChecksum: input.previousSourceChecksum || null },
    })
  })
  return { renderArtifacts }
}

/** Re-renders a saved semantic figure without asking the model again. */
export async function rebuildManagedFigureSource(input: PatentDiagramPipelineInput & { figureNo: number }) {
  const context = await loadPipelineContext(input.userId, input.patentId, input.sessionId)
  const figurePlan = context.session.figurePlans.find(figure => figure.figureNo === input.figureNo)
  const source = context.session.diagramSources.find(item => item.figureNo === input.figureNo && item.language === 'en')
  if (!figurePlan || !source) throw new PatentDiagramPipelineError('Managed figure not found', 404, undefined, { code: 'MANAGED_FIGURE_NOT_FOUND', stage: 'RENDER' })
  if (source.sourceMode !== 'MANAGED') {
    throw new PatentDiagramPipelineError('This figure is a raw override and requires raw-source repair.', 409, undefined, { code: 'RAW_REPAIR_REQUIRED', stage: 'RENDER' })
  }
  const parsed = patentDiagramSchema.safeParse(figurePlan.semanticModel)
  if (!parsed.success) {
    throw new PatentDiagramPipelineError('The stored semantic model is missing or invalid.', 409, parsed.error.issues, {
      code: 'STALE_MANAGED_SEMANTICS', stage: 'RENDER', retryable: true,
      actions: ['Regenerate the managed figure.'],
    })
  }
  const built = buildPatentDiagram(parsed.data, context.components)
  let rendered: Awaited<ReturnType<typeof renderAndWriteDiagramArtifacts>>
  try {
    rendered = await renderAndWriteDiagramArtifacts({ patentId: input.patentId, figureNo: input.figureNo, plantumlCode: built.plantumlCode, pagePolicy: context.pagePolicy })
  } catch (error) {
    throw new PatentDiagramPipelineError('The managed source was rebuilt, but rendering still failed.', 422, error instanceof Error ? error.message : error, {
      code: 'MANAGED_RENDER_FAILED', stage: 'RENDER', retryable: true,
      actions: ['Use Modify to simplify the figure.', 'Ask an administrator to check the PlantUML renderer if it repeats.'],
    })
  }
  const { renderArtifacts } = await replaceFigureRecords({
    sessionId: input.sessionId,
    figureNo: input.figureNo,
    built,
    rendered,
    artifacts: rendered.artifacts,
    referenceMapChecksum: context.referenceMapChecksum,
    figurePlanId: figurePlan.id,
    previousSourceChecksum: source.checksum,
  })
  const previousPaths = [
    source.imagePath,
    (source.renderArtifacts as any)?.svg?.path,
    (source.renderArtifacts as any)?.png?.path,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
  await Promise.allSettled(previousPaths
    .filter(path => path !== renderArtifacts.svg.path && path !== renderArtifacts.png.path)
    .map(path => fs.unlink(path)))
  const updated = await prisma.diagramSource.findUnique({ where: { id: source.id } })
  return { fixedCode: built.plantumlCode, diagramSource: updated, validationReport: built.validation, renderArtifacts, repairMode: 'SEMANTIC_REBUILD' as const }
}

/** Re-asks the model for one figure, keeping its plan entry and figure number. */
export async function regenerateManagedFigure(input: PatentDiagramPipelineInput & { figureNo: number }) {
  const context = await loadPipelineContext(input.userId, input.patentId, input.sessionId)
  const existingPlan = context.session.figurePlans.find(figure => figure.figureNo === input.figureNo)
  if (!existingPlan) throw new PatentDiagramPipelineError('Figure plan not found', 404)
  const source = context.session.diagramSources.find(item => item.figureNo === input.figureNo && item.language === 'en')
  const parsedExisting = existingPlan.semanticModel ? patentDiagramSchema.safeParse(existingPlan.semanticModel) : null
  const previous = parsedExisting?.success ? parsedExisting.data : null
  const storedFigureSet = figureSetPlanSchema.safeParse((context.session.aiAnalysisData as any)?.figurePlan)
  const savedPlanItem = storedFigureSet.success
    ? storedFigureSet.data.figures.find(item => item.key === previous?.key)
      || storedFigureSet.data.figures.find(item => item.title === existingPlan.title)
    : undefined
  const kind = (savedPlanItem?.kind || previous?.kind || String(existingPlan.diagramType || 'COMPONENT')) as DiagramKind
  const componentIds = savedPlanItem?.componentIds || (previous
    ? Array.from(new Set(
      previous.kind === 'COMPONENT' ? previous.components.map(node => node.componentId)
        : previous.kind === 'SEQUENCE' ? previous.participants.map(node => node.componentId)
          : previous.kind === 'PROCESS' ? previous.nodes.flatMap(node => [node.componentId, ...node.relatedComponentIds].filter(Boolean) as string[])
            : previous.constituents.map(node => node.componentId),
    ))
    : context.components.map(component => component.id).slice(0, 16))
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
    evidenceIds: savedPlanItem?.evidenceIds || previous?.evidenceIds || [],
  }
  const [diagram] = await detailFigureBatch({
    plans: [plan],
    context,
    pipeline: input,
    existingDiagrams: previous ? [previous] : undefined,
  })
  if (!diagram) {
    throw new PatentDiagramPipelineError('The diagram model did not return a usable figure.', 422, undefined, {
      code: 'NO_FIGURES_GENERATED', stage: 'DETAIL', retryable: true,
      actions: ['Try again.', 'Simplify the modification instruction if it repeats.'],
    })
  }
  const built = buildPatentDiagram(diagram, context.components)
  const rendered = (await renderManagedFigures(input.patentId, [built], [input.figureNo], context.pagePolicy))[0]
  const { renderArtifacts } = await replaceFigureRecords({
    sessionId: input.sessionId,
    figureNo: input.figureNo,
    built: rendered.built,
    rendered: rendered,
    artifacts: { svg: { filename: rendered.svgFilename, path: rendered.svgPath }, png: { filename: rendered.pngFilename, path: rendered.pngPath } },
    referenceMapChecksum: context.referenceMapChecksum,
    figurePlanId: existingPlan.id,
    previousSourceChecksum: source?.checksum,
  })
  const previousPaths = [
    source?.imagePath,
    (source?.renderArtifacts as any)?.svg?.path,
    (source?.renderArtifacts as any)?.png?.path,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
  await Promise.allSettled(previousPaths
    .filter(path => path !== rendered.svgPath && path !== rendered.pngPath)
    .map(path => fs.unlink(path)))
  return {
    status: 'SUCCESS' as const,
    figure: {
      figureNo: input.figureNo,
      plantuml: rendered.built.plantumlCode,
      semanticModel: rendered.built.diagram,
      validation: rendered.built.validation,
      renderArtifacts,
    },
  }
}

function diagramComponentIdsOf(diagram: PatentDiagram): string[] {
  return diagram.kind === 'COMPONENT' ? diagram.components.map(node => node.componentId)
    : diagram.kind === 'SEQUENCE' ? diagram.participants.map(node => node.componentId)
      : diagram.kind === 'PROCESS' ? diagram.nodes.flatMap(node => [node.componentId, ...node.relatedComponentIds].filter(Boolean) as string[])
        : diagram.constituents.map(node => node.componentId)
}

/**
 * User-directed split: one managed figure becomes `parts` figures of the same
 * kind, re-detailed semantically by the model rather than partitioned
 * mechanically. The first part keeps the original figure number; the rest take
 * the next free generated slots. Content completeness is checked afterwards and
 * reported as a review note — the split itself is never blocked on it.
 */
export async function splitManagedFigure(input: PatentDiagramPipelineInput & { figureNo: number; parts: number }) {
  const parts = Number(input.parts)
  if (!Number.isInteger(parts) || parts < 2 || parts > 6) {
    throw new PatentDiagramPipelineError('A figure can be split into 2 to 6 parts.', 400, undefined, {
      code: 'INVALID_SPLIT_PARTS', stage: 'PLAN', retryable: false,
      actions: ['Choose between 2 and 6 parts.'],
    })
  }
  const context = await loadPipelineContext(input.userId, input.patentId, input.sessionId)
  const existingPlan = context.session.figurePlans.find(figure => figure.figureNo === input.figureNo)
  if (!existingPlan) throw new PatentDiagramPipelineError('Figure plan not found', 404)
  const source = context.session.diagramSources.find(item => item.figureNo === input.figureNo && item.language === 'en')
  if (source && source.sourceMode !== 'MANAGED') {
    throw new PatentDiagramPipelineError('Only managed figures can be split. Return this figure to managed mode first.', 409, undefined, {
      code: 'RAW_REPAIR_REQUIRED', stage: 'PLAN', retryable: false,
      actions: ['Use Modify to regenerate the figure as a managed figure, then split it.'],
    })
  }
  const parsed = patentDiagramSchema.safeParse(existingPlan.semanticModel)
  if (!parsed.success) {
    throw new PatentDiagramPipelineError('Only a managed figure with a saved semantic model can be split.', 409, parsed.error.issues, {
      code: 'STALE_MANAGED_SEMANTICS', stage: 'PLAN', retryable: false,
      actions: ['Regenerate the figure first, then split it.'],
    })
  }
  const original = parsed.data
  const prompt = buildFigureSplitPrompt({
    original,
    parts,
    otherFigures: context.existingFigures.filter(figure => figure.figureNo !== input.figureNo),
    inventionContext: context.idea,
    claimsContext: context.claims,
    components: context.components,
    evidenceCatalog: context.evidenceCatalog,
    instructions: input.instructions,
  })
  const splitSchema = patentDiagramBatchSchema.superRefine((value, ctx) => {
    if (value.diagrams.length !== parts) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Return exactly ${parts} diagrams` })
    }
    value.diagrams.forEach((diagram, index) => {
      if (diagram.kind !== original.kind) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Diagram ${index + 1} must be kind ${original.kind}` })
      }
    })
  })
  const batch = await executeStructured({
    userHeaders: input.requestHeaders,
    stageCode: 'DRAFT_DIAGRAM_GENERATION',
    prompt,
    schema: splitSchema,
    responseSchema: { name: 'patent_diagram_split', schema: diagramBatchResponseSchema([original.kind]) },
    promptCacheKey: `patent-diagrams:${input.sessionId}`,
    metadata: { patentId: input.patentId, sessionId: input.sessionId, figureNo: input.figureNo, parts, purpose: 'split_figure_structured' },
  })
  // Part identity is server-owned; titles and purposes are the model's split
  // decisions and are kept.
  const diagrams = batch.diagrams.map((diagram, index) => ({
    ...diagram,
    schemaVersion: 3,
    key: `${original.key}-part-${index + 1}`,
    detailLevel: 'DETAIL',
    direction: original.direction,
  } as PatentDiagram))

  const occupied = new Set(context.session.figurePlans.map(figure => figure.figureNo))
  const figureNumbers = [input.figureNo]
  let candidate = Math.max(0, ...Array.from(occupied).filter(value => value < GENERATED_FIGURE_LIMIT)) + 1
  for (let index = 1; index < diagrams.length; index++) {
    while (occupied.has(candidate)) candidate++
    if (candidate >= GENERATED_FIGURE_LIMIT) throw new PatentDiagramPipelineError('No generated figure slots remain before the imported-figure range', 409)
    figureNumbers.push(candidate)
    occupied.add(candidate++)
  }

  const rendered = await buildAndRender({
    patentId: input.patentId,
    diagrams,
    components: context.components,
    pagePolicy: context.pagePolicy,
    figureNumbers,
  })
  for (let index = 0; index < rendered.length; index++) {
    const item = rendered[index]
    await replaceFigureRecords({
      sessionId: input.sessionId,
      figureNo: item.figureNo,
      built: item.built,
      rendered: item,
      artifacts: { svg: { filename: item.svgFilename, path: item.svgPath }, png: { filename: item.pngFilename, path: item.pngPath } },
      referenceMapChecksum: context.referenceMapChecksum,
      figurePlanId: index === 0 ? existingPlan.id : undefined,
      previousSourceChecksum: index === 0 ? source?.checksum : undefined,
    })
  }
  await prisma.draftingSession.update({
    where: { id: input.sessionId },
    data: { figureSequence: null as any, figureSequenceFinalized: false },
  })
  const keptPaths = new Set(rendered.flatMap(item => [item.svgPath, item.pngPath]))
  const previousPaths = [
    source?.imagePath,
    (source?.renderArtifacts as any)?.svg?.path,
    (source?.renderArtifacts as any)?.png?.path,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
  await Promise.allSettled(previousPaths.filter(path => !keptPaths.has(path)).map(path => fs.unlink(path)))
  // Parts beyond the first are net-new figures and count against quota; the
  // first reuses the original's slot and is not double-charged.
  await recordFigureCompletions(input, rendered.slice(1))

  // Deterministic completeness check: every element of the original must land
  // in some part. A gap is a review note, never a failure.
  const partIds = new Set(rendered.flatMap(item => diagramComponentIdsOf(item.built.diagram)))
  const missingFromSplit = Array.from(new Set(diagramComponentIdsOf(original))).filter(id => !partIds.has(id))
  const reviewNotes = [
    ...summarizeReview(rendered).reviewNotes,
    ...(missingFromSplit.length ? [{
      figureNo: input.figureNo, code: 'SPLIT_CONTENT_MISSING',
      message: `Elements of the original figure are missing from every part: ${missingFromSplit.join(', ')}`,
    }] : []),
  ]
  // Coverage is evaluated across the WHOLE updated drawing set, not just the
  // parts — a split must never make set-level coverage look worse than it is.
  const remainingSemantics = context.session.figurePlans
    .filter(figure => figure.figureNo !== input.figureNo && figure.figureNo < GENERATED_FIGURE_LIMIT)
    .flatMap(figure => {
      const semantic = patentDiagramSchema.safeParse(figure.semanticModel)
      return semantic.success ? [semantic.data] : []
    })
  const claimCoverage = claimComponentCoverage(
    [...remainingSemantics, ...rendered.map(item => item.built.diagram)],
    context.components,
  )
  return {
    status: 'SUCCESS' as const,
    filingReadiness: { status: 'READY' as const, ready: true, reviewNotes },
    claimCoverage,
    figures: rendered.map(figureResponse),
  }
}
