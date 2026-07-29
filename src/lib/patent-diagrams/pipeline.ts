import crypto from 'crypto'
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
  figureSetPlanSchema,
  patentDiagramSchema,
  type BuiltPatentDiagram,
  type FigureSetPlan,
  type FigureSetPlanItem,
  type PatentDiagram,
  type PatentDiagramComponent,
} from './types'

const GENERATED_FIGURE_LIMIT = 900
// When the user leaves the figure count on Auto, the plan is capped at this
// many base figures. The prompt asks for it too, but the model is not trusted
// to comply — excess figures are dropped from the tail of the plan.
//
// Because automatic decomposition no longer runs in the generate/add paths
// (one planned figure renders as exactly one sheet), this is also the hard
// ceiling on rendered figures in auto mode.
const AUTO_MODE_FIGURE_LIMIT = 6

export class PatentDiagramPipelineError extends Error {
  status: number
  details?: unknown

  constructor(message: string, status = 400, details?: unknown) {
    super(message)
    this.name = 'PatentDiagramPipelineError'
    this.status = status
    this.details = details
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
  return {
    session,
    components,
    referenceMapChecksum: semanticChecksum((session.referenceMap as any)?.components || []),
    idea,
    claims: claimsContextFromIdea(idea),
    evidenceCatalog,
    supportedEvidenceIds: new Set(evidenceCatalog.map(entry => entry.id)),
    pagePolicy: await resolveDiagramPagePolicy(countryCode),
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
      prompt = `${input.prompt}\n\nYour previous JSON was invalid. Correct it without changing supported semantics.\nVALIDATION ERRORS:\n${previousErrors}\nPREVIOUS OUTPUT:\n${previousOutput}`
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
      throw new PatentDiagramPipelineError(result.error?.message || 'Diagram LLM request failed')
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
  throw new PatentDiagramPipelineError('Diagram LLM returned invalid structured data', 422, previousErrors)
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
  plan: FigureSetPlan,
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

export async function planManagedFigureSet(input: PatentDiagramPipelineInput): Promise<FigureSetPlan> {
  const context = await loadPipelineContext(input.userId, input.patentId, input.sessionId)
  const prompt = buildFigureSetPlanningPrompt({
    inventionTitle: context.session.ideaRecord?.title || context.idea?.title || 'Untitled invention',
    patentType: context.session.patentTypePrimary,
    inventionContext: context.idea,
    claimsContext: context.claims,
    components: context.components,
    evidenceCatalog: context.evidenceCatalog,
    figureCount: input.figureCount,
    instructions: input.instructions,
  })
  const knownIds = new Set(context.components.map(component => component.id))
  const constrainedPlanSchema = figureSetPlanSchema.superRefine((value, ctx) => {
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
  })
  const plan = await executeStructured({
    userHeaders: input.requestHeaders,
    stageCode: 'DRAFT_FIGURE_PLANNER',
    prompt,
    schema: constrainedPlanSchema,
    metadata: { patentId: input.patentId, sessionId: input.sessionId, purpose: 'plan_figures_structured' },
  })
  if (!input.figureCount && plan.figures.length > AUTO_MODE_FIGURE_LIMIT) {
    plan.figures = plan.figures.slice(0, AUTO_MODE_FIGURE_LIMIT)
  }
  assertPlanComponentIds(plan, context.components)
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
  existingDiagram?: PatentDiagram | null
}): Promise<PatentDiagram> {
  const prompt = buildDiagramDetailPrompt({
    plan: input.plan,
    inventionContext: input.context.idea,
    claimsContext: input.context.claims,
    components: input.context.components,
    evidenceCatalog: input.context.evidenceCatalog,
    existingDiagram: input.existingDiagram,
    instructions: input.pipeline.instructions,
  })
  // Grounding findings are warnings in the base validator so figures persisted
  // before these rules still translate and re-render, but a NEW generation must
  // anchor every process step to the Component Planner and cite the disclosure
  // it paraphrases. Both are the signature of an invented step, so here they
  // block and re-prompt the model like any other defect.
  const GROUNDING_CODES = ['UNGROUNDED_STEP', 'UNCITED_STEP', 'UNKNOWN_STEP_EVIDENCE']
  const blocksGeneration = (issue: { severity: string; code: string }) =>
    (issue.severity === 'error' || GROUNDING_CODES.includes(issue.code)) && issue.code !== 'SPLIT_REQUIRED'
  // Validate what the pipeline will actually build. Re-prompting the model for
  // a defect the normalizer repairs anyway wastes a call and can fail the
  // figure outright when the retry reproduces it.
  const constrainedDiagramSchema = (enforceDensityBudget: boolean) => patentDiagramSchema.superRefine((value, ctx) => {
    const { diagram } = normalizePatentDiagram(value, input.context.components, input.context.supportedEvidenceIds)
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
    diagram = await executeDetail(false)
  }
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
  return mapWithConcurrency(builtFigures, 2, async (built, index) => {
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
    return { built, svg, png, figureNo, svgFilename, pngFilename, svgPath, pngPath }
  })
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
  options: { replace: boolean },
) {
  const saved = await prisma.$transaction(async tx => {
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
          renderStatus: 'SUCCESS',
          renderError: null,
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
      data: { figureSequence: null as any, figureSequenceFinalized: false, figuresSkipped: false, figuresSkippedAt: null },
    })
    return saved
  })

  // Outside the transaction: metering must never roll back a persisted figure set.
  await recordFigureCompletions(input, figures)

  return saved
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

// A residual SPLIT_REQUIRED means the detail stage's density budget could not
// persuade the model to draw a figure that fits (e.g. process branch depth,
// which shedding nodes cannot change). The figure ships as one dense sheet
// with a review warning rather than being split automatically — automatic
// splitting is what turned a 4-figure plan into 10 sheets. The user splits the
// figures they choose via Modify, which proposes a split and asks to approve.
function relaxResidualSplitIssues(built: BuiltPatentDiagram[]) {
  for (const figure of built) {
    figure.validation.issues = figure.validation.issues.map(issue =>
      issue.code === 'SPLIT_REQUIRED' && issue.severity === 'error'
        ? { ...issue, severity: 'warning' as const, message: `${issue.message} — this figure is denser than the filing guideline. Use Modify on it and approve the proposed split to divide it.` }
        : issue)
    figure.validation.filingReady = !figure.validation.issues.some(issue => issue.severity === 'error')
  }
}

function assertBuiltFigures(built: BuiltPatentDiagram[], message: string) {
  relaxResidualSplitIssues(built)
  const invalid = built.flatMap((figure, index) => figure.validation.issues
    .filter(issue => issue.severity === 'error')
    .map(issue => ({ figure: index + 1, ...issue })))
  if (invalid.length) throw new PatentDiagramPipelineError(message, 422, invalid)
}

// A page-fit shortfall ships with a review warning rather than hard-failing:
// ordinary 3-4 column diagrams routinely scale a little below the printed
// minimum. Automatic splitting is deliberately NOT the response — it is what
// turned a 4-figure plan into 10 sheets. The user splits the figures they
// choose through the approve-split flow in regenerateManagedFigure.
function softenPageFitIssues(builtFigures: BuiltPatentDiagram[]) {
  for (const figure of builtFigures) {
    figure.validation.issues = figure.validation.issues.map(issue =>
      issue.code === 'PAGE_FIT_MINIMUM_TEXT' && issue.severity === 'error'
        ? { ...issue, severity: 'warning' as const, message: `${issue.message}. Use Modify on this figure and approve the proposed split if full filing-scale text is required.` }
        : issue)
    figure.validation.filingReady = !figure.validation.issues.some(issue => issue.severity === 'error')
  }
}

// One diagram in, one rendered sheet out. Nothing here may change the figure
// count: the auto-mode ceiling holds by construction rather than by discarding
// content, and regenerateManagedFigure's allocateFigureNumbers throws a 409 if
// the count ever shifts underneath it.
async function buildAndRenderAdaptive(input: {
  patentId: string
  diagrams: PatentDiagram[]
  components: PatentDiagramComponent[]
  supportedEvidenceIds?: Set<string>
  pagePolicy: Awaited<ReturnType<typeof resolveDiagramPagePolicy>>
  allocateFigureNumbers?: (count: number) => number[]
}) {
  const built = input.diagrams.map(diagram => buildPatentDiagram(diagram, input.components, input.supportedEvidenceIds))
  assertBuiltFigures(built, 'Generated figure set is not filing-ready')
  const numbers = input.allocateFigureNumbers?.(built.length)
  const rendered = await renderManagedFigures(input.patentId, built, numbers, input.pagePolicy)
  softenPageFitIssues(rendered.map(figure => figure.built))
  const renderedInvalid = rendered.flatMap(figure => figure.built.validation.issues.filter(issue => issue.severity === 'error'))
  if (renderedInvalid.length) throw new PatentDiagramPipelineError('Rendered figure set is not filing-ready', 422, renderedInvalid)
  return rendered
}

export async function generateManagedFigureSet(
  input: PatentDiagramPipelineInput & { plan?: FigureSetPlan | null },
) {
  const context = await loadPipelineContext(input.userId, input.patentId, input.sessionId)
  // Sessions planned before this pipeline stored a {count, diagrams} plan.
  // Parsing that strictly threw a raw ZodError and made diagram generation
  // impossible for every pre-existing session, so an unusable stored plan is
  // simply re-planned.
  const storedPlan = (context.session.aiAnalysisData as any)?.figurePlan
  const parsedStoredPlan = storedPlan ? figureSetPlanSchema.safeParse(storedPlan) : null
  const plan = input.plan
    || (parsedStoredPlan?.success ? parsedStoredPlan.data : await planManagedFigureSet(input))
  assertPlanComponentIds(plan, context.components)
  // A stored plan predates the auto cap, so re-clamp it here too.
  if (!input.figureCount && plan.figures.length > AUTO_MODE_FIGURE_LIMIT) {
    plan.figures = plan.figures.slice(0, AUTO_MODE_FIGURE_LIMIT)
  }
  const detailed = await mapWithConcurrency(plan.figures, 2, planItem => detailManagedFigure({ plan: planItem, context, pipeline: input }))
  const rendered = await buildAndRenderAdaptive({
    patentId: input.patentId,
    diagrams: detailed,
    components: context.components,
    supportedEvidenceIds: context.supportedEvidenceIds,
    pagePolicy: context.pagePolicy,
  })
  // Tripwire: nothing between planning and rendering may multiply figures any
  // more. If fan-out is ever reintroduced, fail loudly instead of silently
  // shipping 10-15 sheets again.
  if (!input.figureCount && rendered.length > AUTO_MODE_FIGURE_LIMIT) {
    throw new PatentDiagramPipelineError(`Auto mode produced ${rendered.length} figures, above the ${AUTO_MODE_FIGURE_LIMIT}-figure ceiling`, 500)
  }
  const saved = await persistManagedFigureSet(input, context.referenceMapChecksum, rendered, { replace: true })
  return {
    plan,
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
  const context = await loadPipelineContext(input.userId, input.patentId, input.sessionId)
  const plan = input.plan || await planManagedFigureSet(input)
  assertPlanComponentIds(plan, context.components)
  const occupied = new Set(context.session.figurePlans.map(figure => figure.figureNo))
  // Auto mode caps the whole session, not each call: appending twice used to
  // stack two full sets and reach 12 figures. An explicit figureCount is a
  // deliberate user request (add-one-figure, add-from-instructions) and is
  // never clamped.
  if (!input.figureCount) {
    const existing = Array.from(occupied).filter(value => value < GENERATED_FIGURE_LIMIT).length
    const headroom = AUTO_MODE_FIGURE_LIMIT - existing
    if (headroom <= 0) {
      throw new PatentDiagramPipelineError(
        `This session already has ${existing} generated figures, the maximum for automatic generation. Replace the existing figures, or delete one before adding another.`,
        409,
      )
    }
    if (plan.figures.length > headroom) plan.figures = plan.figures.slice(0, headroom)
  }
  const detailed = await mapWithConcurrency(plan.figures, 2, planItem => detailManagedFigure({ plan: planItem, context, pipeline: input }))

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
  const saved = await persistManagedFigureSet(input, context.referenceMapChecksum, rendered, { replace: false })
  return {
    plan,
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

export async function regenerateManagedFigure(input: PatentDiagramPipelineInput & { figureNo: number; approveSplit?: boolean }) {
  const context = await loadPipelineContext(input.userId, input.patentId, input.sessionId)
  const existingPlan = context.session.figurePlans.find(figure => figure.figureNo === input.figureNo)
  if (!existingPlan) throw new PatentDiagramPipelineError('Figure plan not found', 404)
  const source = context.session.diagramSources.find(item => item.figureNo === input.figureNo && item.language === 'en')
  const existingDiagram = existingPlan.semanticModel
    ? patentDiagramSchema.safeParse(existingPlan.semanticModel)
    : null
  const previous = existingDiagram?.success ? existingDiagram.data : null
  const kind = previous?.kind || String(existingPlan.diagramType || 'COMPONENT') as PatentDiagram['kind']
  const componentIds = previous
    ? Array.from(new Set(
      previous.kind === 'COMPONENT' ? previous.components.map(node => node.componentId)
        : previous.kind === 'SEQUENCE' ? previous.participants.map(node => node.componentId)
          : previous.kind === 'PROCESS' ? previous.nodes.flatMap(node => [node.componentId, ...node.relatedComponentIds].filter(Boolean) as string[])
            : previous.constituents.map(node => node.componentId),
    ))
    : context.components.map(component => component.id).slice(0, 12)
  const plan: FigureSetPlanItem = {
    key: previous?.key || `figure-${input.figureNo}`,
    kind,
    title: existingPlan.title,
    purpose: existingPlan.description || input.instructions || `Regenerated Figure ${input.figureNo}`,
    detailLevel: previous?.detailLevel || 'DETAIL',
    direction: previous?.direction || 'TB',
    componentIds,
    claimCriticalComponentIds: previous?.claimCriticalComponentIds || [],
    orderedGroups: previous?.kind === 'COMPONENT'
      ? previous.groups.map(group => ({ id: group.id, label: group.label, componentIds: group.rows.flatMap(row => row.componentIds) }))
      : [],
    phaseHints: [],
    // A regeneration keeps the disclosed operations the figure already cites, so
    // redrawing it cannot quietly widen its factual basis.
    evidenceIds: previous?.evidenceIds || [],
  }
  const diagram = await detailManagedFigure({ plan, context, pipeline: input, existingDiagram: previous })
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
            semanticChecksum: semanticHash, referenceMapChecksum: context.referenceMapChecksum, renderArtifacts: artifacts as any, renderStatus: 'SUCCESS',
            imageFilename: item.pngFilename, imagePath: item.pngPath, imageChecksum: item.png.checksum, imageUploadedAt: new Date(),
          },
          update: {
            plantumlCode: item.built.plantumlCode, checksum: crypto.createHash('sha256').update(item.built.plantumlCode).digest('hex'),
            sourceMode: 'MANAGED', semanticChecksum: semanticHash, referenceMapChecksum: context.referenceMapChecksum, renderArtifacts: artifacts as any, renderStatus: 'SUCCESS', renderError: null,
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
  relaxResidualSplitIssues([built])
  if (!built.validation.filingReady) throw new PatentDiagramPipelineError('Regenerated figure is not filing-ready', 422, built.validation.issues)
  const rendered = (await renderManagedFigures(input.patentId, [built], [input.figureNo], context.pagePolicy))[0]
  if (!rendered.built.validation.filingReady) {
    const forced = decomposePatentDiagram(diagram, true)
    if (forced.length > 1) return { status: 'SPLIT_REQUIRED' as const, splitProposal: forced.map(item => ({ title: item.title, kind: item.kind, semanticModel: item })) }
    softenPageFitIssues([rendered.built])
    if (!rendered.built.validation.filingReady) {
      throw new PatentDiagramPipelineError('Rendered revision is not filing-ready', 422, rendered.built.validation.issues)
    }
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
        sourceMode: 'MANAGED', semanticChecksum: semanticHash, referenceMapChecksum: context.referenceMapChecksum, renderArtifacts: renderArtifacts as any, renderStatus: 'SUCCESS',
        labelMap: built.labelMap as any,
        imageFilename: rendered.pngFilename, imagePath: rendered.pngPath, imageChecksum: rendered.png.checksum, imageUploadedAt: new Date(),
      },
      update: {
        plantumlCode: built.plantumlCode, checksum: crypto.createHash('sha256').update(built.plantumlCode).digest('hex'),
        sourceMode: 'MANAGED', semanticChecksum: semanticHash, referenceMapChecksum: context.referenceMapChecksum, renderArtifacts: renderArtifacts as any,
        labelMap: built.labelMap as any,
        renderStatus: 'SUCCESS', renderError: null,
        imageFilename: rendered.pngFilename, imagePath: rendered.pngPath, imageChecksum: rendered.png.checksum, imageUploadedAt: new Date(),
      },
    }),
    prisma.diagramSource.updateMany({
      where: { sessionId: input.sessionId, figureNo: input.figureNo, language: { not: 'en' } },
      data: { renderStatus: 'STALE', translatedFromChecksum: source?.checksum || null },
    }),
  ])
  return { status: 'SUCCESS' as const, figure: { figureNo: input.figureNo, plantuml: built.plantumlCode, semanticModel: built.diagram, validation: built.validation, renderArtifacts } }
}
