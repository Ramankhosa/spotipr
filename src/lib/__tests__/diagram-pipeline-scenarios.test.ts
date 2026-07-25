/**
 * Scenario harness: drives the REAL diagram pipeline with a dummy invention.
 * Only two boundaries are stubbed - Postgres and the PlantUML render server -
 * so planning, prompting, normalization, validation, decomposition, the
 * auto-mode cap and the replace/append persistence paths all run for real.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { llmGateway } from '@/lib/metering/gateway'
import { addManagedFigures, generateManagedFigureSet, planManagedFigureSet } from '@/lib/patent-diagrams/pipeline'

// ---------------------------------------------------------------- dummy idea
const COMPONENTS = [
  { id: 'c1', name: 'Soil Moisture Sensor', type: 'SENSOR', referenceLabel: '100', description: 'Measures volumetric water content of the root zone' },
  { id: 'c2', name: 'Weather Data Interface', type: 'MODULE', referenceLabel: '110', description: 'Receives forecast precipitation data' },
  { id: 'c3', name: 'Irrigation Controller', type: 'PROCESSOR', referenceLabel: '120', description: 'Computes an irrigation schedule' },
  { id: 'c4', name: 'Valve Actuator', type: 'ACTUATOR', referenceLabel: '130', description: 'Opens and closes the supply valve' },
  { id: 'c5', name: 'Flow Meter', type: 'SENSOR', referenceLabel: '140', description: 'Measures delivered water volume' },
  { id: 'c6', name: 'Data Store', type: 'STORAGE', referenceLabel: '150', description: 'Stores measured and scheduled values' },
  { id: 'c7', name: 'Scheduling Engine', type: 'MODULE', referenceLabel: '160', description: 'Derives watering windows' },
  { id: 'c8', name: 'Operator Terminal', type: 'INTERFACE', referenceLabel: '170', description: 'Displays schedule and accepts overrides' },
  // Filler entries so a figure can be made dense enough to trip the split
  // policy without reusing IDs (which would fail as DUPLICATE_COMPONENT).
  ...Array.from({ length: 16 }, (_, index) => ({
    id: `c${index + 9}`,
    name: `Zone Manifold ${index + 1}`,
    type: 'MODULE',
    referenceLabel: String(180 + index * 10),
    description: `Distributes water to irrigation zone ${index + 1}`,
  })),
]

const IDEA = {
  title: 'Adaptive Soil-Moisture Irrigation Control System',
  problemStatement: 'Fixed-interval irrigation over-waters when rainfall is imminent.',
  solutionSummary: 'A controller fuses soil moisture with forecast precipitation to derive watering windows and verifies delivery with a flow meter.',
  claimsStructuredFinal: [
    { number: 1, text: 'An irrigation control system comprising a soil moisture sensor, a weather data interface, and an irrigation controller configured to derive a watering window.' },
    { number: 2, text: 'The system of claim 1, further comprising a flow meter verifying a delivered water volume.' },
  ],
}

// ------------------------------------------------------------- LLM stub plumbing
type LlmCall = { stageCode: string; prompt: string; metadata: any }
const llmCalls: LlmCall[] = []
let planResponder: (call: LlmCall) => string
let detailResponder: (call: LlmCall, attempt: number) => string
const detailAttempts = new Map<string, number>()

// executeStructured reaches the gateway through a DYNAMIC import, and two
// figures detail concurrently. Concurrent dynamic imports race past vitest's
// mock registry into the real module, so vi.mock is unreliable here. Spying on
// the exported singleton intercepts every import path instead.
vi.spyOn(llmGateway, 'executeLLMOperation').mockImplementation(async (_ctx: any, request: any) => {
  const call = { stageCode: String(request.stageCode), prompt: String(request.prompt), metadata: request.metadata }
  llmCalls.push(call)
  if (call.stageCode === 'DRAFT_FIGURE_PLANNER') {
    return { success: true, response: { output: planResponder(call) } } as any
  }
  const key = String(request.metadata?.figureKey || '')
  const attempt = (detailAttempts.get(key) || 0) + 1
  detailAttempts.set(key, attempt)
  return { success: true, response: { output: detailResponder(call, attempt) } } as any
})

// -------------------------------------------------------------- render stub
vi.mock('@/lib/patent-diagrams/artifacts', () => ({
  resolveDiagramPagePolicy: vi.fn(async () => ({
    paperSize: 'A4', marginTopCm: 2.5, marginBottomCm: 1, marginLeftCm: 2.5, marginRightCm: 1.5,
    minimumTextSizePt: 8, maximumElementsByType: {},
  })),
  // The SVG embeds the PlantUML source so every reference numeral the renderer
  // check looks for is present; elementBounds is omitted so the stub does not
  // have to fake Graphviz geometry.
  renderAndWriteDiagramArtifacts: vi.fn(async (input: any) => ({
    artifacts: {
      svg: { filename: `figure_${input.figureNo}.svg`, path: `/tmp/figure_${input.figureNo}.svg`, checksum: 'svg-sum', contentType: 'image/svg+xml', width: 800, height: 600 },
      png: { filename: `figure_${input.figureNo}.png`, path: `/tmp/figure_${input.figureNo}.png`, checksum: 'png-sum', contentType: 'image/png' },
    },
    svg: { buffer: Buffer.from(`<svg>${input.plantumlCode}</svg>`), checksum: 'svg-sum', contentType: 'image/svg+xml', width: 800, height: 600, elementBounds: undefined },
    png: { buffer: Buffer.from('png'), checksum: 'png-sum', contentType: 'image/png' },
    effectiveFontSizePt: 10,
  })),
}))

vi.mock('@/lib/service-completion', () => ({ recordServiceCompletion: vi.fn(async () => ({ counted: true })) }))

// ------------------------------------------------------------------ DB stub
const db = {
  figurePlans: [] as any[],
  diagramSources: [] as any[],
  sessionUpdates: [] as any[],
  deleteManyCalls: [] as string[],
}

const txClient = {
  diagramSource: {
    deleteMany: vi.fn(async (args: any) => { db.deleteManyCalls.push('diagramSource'); db.diagramSources = []; return { count: 0 } }),
    create: vi.fn(async (args: any) => { db.diagramSources.push(args.data); return { id: `src-${db.diagramSources.length}`, ...args.data } }),
    upsert: vi.fn(async (args: any) => ({ id: 'src', ...args.create })),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  figurePlan: {
    deleteMany: vi.fn(async () => { db.deleteManyCalls.push('figurePlan'); db.figurePlans = []; return { count: 0 } }),
    create: vi.fn(async (args: any) => { db.figurePlans.push(args.data); return { id: `plan-${db.figurePlans.length}`, ...args.data } }),
    update: vi.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
  },
  draftingSession: { update: vi.fn(async (args: any) => { db.sessionUpdates.push(args.data); return {} }) },
}

let existingFigurePlans: any[] = []

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftingSession: {
      findFirst: vi.fn(async () => ({
        id: 'session-1',
        patentId: 'patent-1',
        userId: 'user-1',
        patentTypePrimary: 'SYSTEM',
        activeJurisdiction: 'US',
        draftingJurisdictions: ['US'],
        aiAnalysisData: null,
        referenceMap: { isValid: true, components: COMPONENTS },
        ideaRecord: { title: IDEA.title, normalizedData: IDEA },
        figurePlans: existingFigurePlans,
        diagramSources: [],
      })),
      update: vi.fn(async (args: any) => { db.sessionUpdates.push(args.data); return {} }),
    },
    user: { findUnique: vi.fn(async () => ({ tenantId: 'tenant-1' })) },
    $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(txClient) : Promise.all(arg))),
  },
}))

// ------------------------------------------------------------ canned outputs
const planFigure = (index: number) => ({
  key: `figure-${index}`,
  kind: 'COMPONENT',
  title: `System Architecture ${index}`,
  purpose: `Show the disclosed irrigation control architecture, view ${index}`,
  detailLevel: 'DETAIL',
  direction: 'TB',
  componentIds: ['c1', 'c2', 'c3', 'c4'],
  claimCriticalComponentIds: ['c3'],
  orderedGroups: [
    { id: 'sensing', label: 'Sensing Subsystem', componentIds: ['c1', 'c2'] },
    { id: 'control', label: 'Control Subsystem', componentIds: ['c3'] },
    { id: 'actuation', label: 'Actuation Subsystem', componentIds: ['c4'] },
  ],
  phaseHints: [],
})

const componentDetail = (key: string) => JSON.stringify({
  schemaVersion: 1, kind: 'COMPONENT', key, title: 'System Architecture', purpose: 'Show the disclosed irrigation control architecture',
  detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: ['c3'], evidenceIds: [],
  systemBoundaryLabel: 'Irrigation Control System',
  groups: [
    { id: 'sensing', label: 'Sensing Subsystem', rows: [{ componentIds: ['c1', 'c2'] }] },
    { id: 'control', label: 'Control Subsystem', rows: [{ componentIds: ['c3'] }] },
    { id: 'actuation', label: 'Actuation Subsystem', rows: [{ componentIds: ['c4'] }] },
  ],
  components: [{ componentId: 'c1' }, { componentId: 'c2' }, { componentId: 'c3' }, { componentId: 'c4' }],
  relationships: [
    { fromId: 'c1', toId: 'c3', label: 'moisture signal', category: 'DATA_INPUT' },
    { fromId: 'c2', toId: 'c3', label: 'forecast data', category: 'DATA_INPUT' },
    { fromId: 'c3', toId: 'c4', label: 'valve command', category: 'CONTROL' },
  ],
})

/** A flowchart whose steps are all anchored to the Component Planner. */
const groundedProcess = (key: string) => JSON.stringify({
  schemaVersion: 1, kind: 'PROCESS', key, title: 'Irrigation Control Method', purpose: 'Show the disclosed control method',
  detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: ['c3'], evidenceIds: [],
  nodes: [
    { key: 'measure', kind: 'STEP', componentId: 'c1', label: 'Measure soil moisture' },
    { key: 'receive', kind: 'STEP', componentId: 'c2', label: 'Receive forecast precipitation' },
    { key: 'below', kind: 'DECISION', componentId: 'c3', label: 'Moisture below threshold' },
    { key: 'derive', kind: 'STEP', componentId: 'c7', label: 'Derive watering window' },
    { key: 'open', kind: 'STEP', componentId: 'c4', label: 'Open supply valve' },
    { key: 'verify', kind: 'STEP', componentId: 'c5', label: 'Verify delivered volume' },
  ],
  transitions: [
    { fromId: 'measure', toId: 'below', label: '', category: 'PRIMARY' },
    { fromId: 'receive', toId: 'below', label: '', category: 'PRIMARY' },
    { fromId: 'below', toId: 'derive', label: 'yes', category: 'PRIMARY' },
    { fromId: 'derive', toId: 'open', label: '', category: 'PRIMARY' },
    { fromId: 'open', toId: 'verify', label: '', category: 'PRIMARY' },
  ],
})

/** The failure mode being fixed: lifecycle steps with no registry linkage. */
const hallucinatedProcess = (key: string) => JSON.stringify({
  schemaVersion: 1, kind: 'PROCESS', key, title: 'Irrigation Control Method', purpose: 'Show the disclosed control method',
  detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: ['c3'], evidenceIds: [],
  nodes: [
    { key: 'start', kind: 'STEP', label: 'Start system' },
    { key: 'login', kind: 'STEP', label: 'User logs in' },
    { key: 'measure', kind: 'STEP', componentId: 'c1', label: 'Measure soil moisture' },
    { key: 'deploy', kind: 'STEP', componentId: 'cloud-service-99', label: 'Deploy to cloud' },
    { key: 'below', kind: 'DECISION', componentId: 'c3', label: 'Moisture below threshold' },
    { key: 'open', kind: 'STEP', componentId: 'c4', label: 'Open supply valve' },
  ],
  transitions: [
    { fromId: 'start', toId: 'login', label: '', category: 'PRIMARY' },
    { fromId: 'login', toId: 'measure', label: '', category: 'PRIMARY' },
    { fromId: 'measure', toId: 'deploy', label: '', category: 'PRIMARY' },
    { fromId: 'deploy', toId: 'below', label: '', category: 'PRIMARY' },
    { fromId: 'below', toId: 'open', label: 'yes', category: 'PRIMARY' },
  ],
})

const INPUT = {
  userId: 'user-1', patentId: 'patent-1', sessionId: 'session-1', requestHeaders: {},
}

/** Default render stub; re-applied per test because one test overrides it. */
const defaultRenderImpl = async (input: any) => ({
  artifacts: {
    svg: { filename: `figure_${input.figureNo}.svg`, path: `/tmp/figure_${input.figureNo}.svg`, checksum: 'svg-sum', contentType: 'image/svg+xml', width: 800, height: 600 },
    png: { filename: `figure_${input.figureNo}.png`, path: `/tmp/figure_${input.figureNo}.png`, checksum: 'png-sum', contentType: 'image/png' },
  },
  svg: { buffer: Buffer.from(`<svg>${input.plantumlCode}</svg>`), checksum: 'svg-sum', contentType: 'image/svg+xml', width: 800, height: 600, elementBounds: undefined },
  png: { buffer: Buffer.from('png'), checksum: 'png-sum', contentType: 'image/png' },
  effectiveFontSizePt: 10,
})

beforeEach(async () => {
  const artifacts = await import('@/lib/patent-diagrams/artifacts')
  ;(artifacts.renderAndWriteDiagramArtifacts as any).mockImplementation(defaultRenderImpl)
  llmCalls.length = 0
  detailAttempts.clear()
  db.figurePlans = []
  db.diagramSources = []
  db.sessionUpdates = []
  db.deleteManyCalls = []
  existingFigurePlans = []
  planResponder = () => JSON.stringify({ schemaVersion: 1, figures: [planFigure(1)] })
  detailResponder = call => componentDetail(String(call.metadata?.figureKey || 'figure-1'))
})

describe('auto-mode figure cap', () => {
  test('caps an over-eager 8-figure auto plan at 5 and details only those 5', async () => {
    planResponder = () => JSON.stringify({
      schemaVersion: 1,
      figures: Array.from({ length: 8 }, (_, index) => planFigure(index + 1)),
    })

    const result = await generateManagedFigureSet({ ...INPUT })

    expect(result.plan.figures).toHaveLength(5)
    expect(result.figures).toHaveLength(5)
    expect(result.figures.map(f => f.figureNo)).toEqual([1, 2, 3, 4, 5])
    // The cap must apply BEFORE detailing, or the extra figures still cost LLM calls.
    expect(llmCalls.filter(c => c.stageCode === 'DRAFT_DIAGRAM_GENERATION')).toHaveLength(5)
    expect(db.figurePlans).toHaveLength(5)
  })

  test('an explicit user count is respected and not capped', async () => {
    planResponder = () => JSON.stringify({
      schemaVersion: 1,
      figures: Array.from({ length: 7 }, (_, index) => planFigure(index + 1)),
    })
    const plan = await planManagedFigureSet({ ...INPUT, figureCount: 7 })
    expect(plan.figures).toHaveLength(7)
  })

  test('the auto-mode prompt states the 5-figure ceiling', async () => {
    await planManagedFigureSet({ ...INPUT })
    const prompt = llmCalls.find(c => c.stageCode === 'DRAFT_FIGURE_PLANNER')!.prompt
    expect(prompt).toContain('never more than 5 figures')
    expect(prompt).not.toContain('2 to 6 figures')
  })
})

describe('ungrounded flowchart steps', () => {
  test('rejects hallucinated lifecycle steps and re-prompts with the defect', async () => {
    planResponder = () => JSON.stringify({ schemaVersion: 1, figures: [{ ...planFigure(1), kind: 'PROCESS', key: 'method' }] })
    detailResponder = (call, attempt) =>
      attempt === 1 ? hallucinatedProcess('method') : groundedProcess('method')

    const result = await generateManagedFigureSet({ ...INPUT })

    const detailCalls = llmCalls.filter(c => c.stageCode === 'DRAFT_DIAGRAM_GENERATION')
    expect(detailCalls).toHaveLength(2)
    // The retry must tell the model exactly which steps were unacceptable.
    expect(detailCalls[1].prompt).toContain('UNGROUNDED_STEP')
    expect(detailCalls[1].prompt).toContain('Start system')
    expect(detailCalls[1].prompt).toContain('Deploy to cloud')

    const semantic: any = result.figures[0].semanticModel
    expect(semantic.nodes.map((n: any) => n.label)).toEqual([
      'Measure soil moisture', 'Receive forecast precipitation', 'Moisture below threshold',
      'Derive watering window', 'Open supply valve', 'Verify delivered volume',
    ])
    expect(result.figures[0].validation.filingReady).toBe(true)
  })

  test('fails the figure when the model keeps inventing steps', async () => {
    planResponder = () => JSON.stringify({ schemaVersion: 1, figures: [{ ...planFigure(1), kind: 'PROCESS', key: 'method' }] })
    detailResponder = () => hallucinatedProcess('method')

    await expect(generateManagedFigureSet({ ...INPUT })).rejects.toThrow(/invalid structured data/i)
    expect(db.figurePlans).toHaveLength(0)
  })

  test('the detail prompt demands registry anchoring', async () => {
    planResponder = () => JSON.stringify({ schemaVersion: 1, figures: [{ ...planFigure(1), kind: 'PROCESS', key: 'method' }] })
    detailResponder = () => groundedProcess('method')
    await generateManagedFigureSet({ ...INPUT })
    const prompt = llmCalls.find(c => c.stageCode === 'DRAFT_DIAGRAM_GENERATION')!.prompt
    expect(prompt).toContain('MUST be anchored to the Component Planner registry')
    expect(prompt).toContain('it is not part of this invention — omit it')
    expect(prompt).not.toContain('optional component ID')
  })
})

describe('interrupted-run retry behaviour', () => {
  test('replace path clears the previous set instead of appending', async () => {
    // A prior run persisted 5 figures before the client gave up.
    existingFigurePlans = [1, 2, 3, 4, 5].map(figureNo => ({ figureNo, id: `plan-${figureNo}` }))
    planResponder = () => JSON.stringify({
      schemaVersion: 1, figures: Array.from({ length: 4 }, (_, index) => planFigure(index + 1)),
    })

    const result = await generateManagedFigureSet({ ...INPUT })

    expect(db.deleteManyCalls).toEqual(['diagramSource', 'figurePlan'])
    expect(result.figures.map(f => f.figureNo)).toEqual([1, 2, 3, 4])
    expect(db.figurePlans).toHaveLength(4)
  })

  test('append path is what produced 10+ figures, and still numbers after the survivors', async () => {
    existingFigurePlans = [1, 2, 3, 4, 5].map(figureNo => ({ figureNo, id: `plan-${figureNo}` }))
    planResponder = () => JSON.stringify({
      schemaVersion: 1, figures: Array.from({ length: 5 }, (_, index) => planFigure(index + 1)),
    })

    const result = await addManagedFigures({ ...INPUT })

    expect(db.deleteManyCalls).toEqual([])
    expect(result.figures.map(f => f.figureNo)).toEqual([6, 7, 8, 9, 10])
  })
})

describe('figure-count inflation after the plan is capped', () => {
  /** A COMPONENT figure dense enough that the complexity policy demands a split. */
  const denseComponent = (key: string) => {
    // 22 components across 3 bands: above the 20-component split threshold, so
    // the decomposer turns this single planned figure into several sheets.
    const ids = COMPONENTS.slice(0, 22).map(c => c.id)
    return JSON.stringify({
      schemaVersion: 1, kind: 'COMPONENT', key, title: 'Dense Architecture', purpose: 'Dense fixture',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [], evidenceIds: [],
      systemBoundaryLabel: 'Irrigation Control System',
      groups: [
        { id: 'g1', label: 'Sensing Subsystem', rows: [{ componentIds: ids.slice(0, 8) }] },
        { id: 'g2', label: 'Control Subsystem', rows: [{ componentIds: ids.slice(8, 16) }] },
        { id: 'g3', label: 'Distribution Subsystem', rows: [{ componentIds: ids.slice(16, 22) }] },
      ],
      components: ids.map(id => ({ componentId: id })),
      relationships: [
        { fromId: 'c1', toId: 'c3', label: 'moisture signal', category: 'DATA_INPUT' },
        { fromId: 'c2', toId: 'c3', label: 'forecast data', category: 'DATA_INPUT' },
        { fromId: 'c3', toId: 'c4', label: 'valve command', category: 'CONTROL' },
        { fromId: 'c5', toId: 'c6', label: 'volume record', category: 'STORAGE' },
        { fromId: 'c7', toId: 'c8', label: 'schedule view', category: 'RESPONSE' },
      ],
    })
  }

  test('re-prompts an over-dense figure instead of splitting it into extra sheets', async () => {
    planResponder = () => JSON.stringify({
      schemaVersion: 1, figures: Array.from({ length: 5 }, (_, index) => planFigure(index + 1)),
    })
    // The model first returns figures dense enough to require a split, then
    // complies with the budget once the defect is fed back.
    detailResponder = (call, attempt) => attempt === 1
      ? denseComponent(String(call.metadata?.figureKey || 'figure-1'))
      : componentDetail(String(call.metadata?.figureKey || 'figure-1'))

    const result = await generateManagedFigureSet({ ...INPUT })
    console.log(`\n[auto-mode] planned=${result.plan.figures.length} rendered=${result.figures.length}`)

    // Figures detail concurrently, so retries interleave - find them by content.
    const retries = llmCalls.filter(c => c.stageCode === 'DRAFT_DIAGRAM_GENERATION' && c.prompt.includes('SPLIT_REQUIRED'))
    expect(retries.length).toBe(5)
    expect(result.plan.figures).toHaveLength(5)
    // Was 15 before the density budget became binding.
    expect(result.figures).toHaveLength(5)
  })

  test('falls back to decomposition when the model cannot meet the budget', async () => {
    planResponder = () => JSON.stringify({ schemaVersion: 1, figures: [planFigure(1)] })
    detailResponder = call => denseComponent(String(call.metadata?.figureKey || 'figure-1'))

    const result = await generateManagedFigureSet({ ...INPUT })
    const detailCalls = llmCalls.filter(c => c.stageCode === 'DRAFT_DIAGRAM_GENERATION')
    console.log(`\n[fallback] detailCalls=${detailCalls.length} rendered=${result.figures.length}`)

    // Strict pass burns both attempts, then the tolerant pass accepts the
    // dense figure so no disclosed content is lost.
    expect(detailCalls.map(c => c.metadata.densityBudget)).toEqual(['enforced', 'enforced', 'relaxed'])
    expect(result.figures.length).toBeGreaterThan(1)
    result.figures.forEach(figure => expect(figure.validation.filingReady).toBe(true))
  })

  test('aesthetic layout warnings no longer trigger an extra decomposition pass', async () => {
    const artifacts = await import('@/lib/patent-diagrams/artifacts')
    const renderSpy = artifacts.renderAndWriteDiagramArtifacts as any
    // Sibling boxes with wildly different widths -> SIBLING_DIMENSION_VARIANCE.
    renderSpy.mockImplementation(async (input: any) => ({
      artifacts: {
        svg: { filename: `f${input.figureNo}.svg`, path: `/tmp/f${input.figureNo}.svg`, checksum: 's', contentType: 'image/svg+xml', width: 800, height: 600 },
        png: { filename: `f${input.figureNo}.png`, path: `/tmp/f${input.figureNo}.png`, checksum: 'p', contentType: 'image/png' },
      },
      svg: {
        buffer: Buffer.from(`<svg>${input.plantumlCode}</svg>`), checksum: 's', contentType: 'image/svg+xml', width: 800, height: 600,
        elementBounds: Object.fromEntries([
          ['SYSTEM', { x: 0, y: 0, width: 800, height: 600, strokeWidth: 1.8 }],
          ['BAND1', { x: 0, y: 0, width: 700, height: 150, strokeWidth: 1.3 }],
          ['BAND2', { x: 0, y: 200, width: 700, height: 150, strokeWidth: 1.3 }],
          ['BAND3', { x: 0, y: 400, width: 700, height: 150, strokeWidth: 1.3 }],
          // Every component alias gets a compliant stroke; widths differ hugely.
          ...(input.plantumlCode.match(/as (C[0-9A-F]+)/g) || []).map((match: string, index: number) => {
            const alias = match.replace('as ', '')
            return [alias, { x: 0, y: 0, width: index % 2 ? 400 : 80, height: index % 2 ? 200 : 60, strokeWidth: 1.0 }]
          }),
        ]),
      },
      png: { buffer: Buffer.from('png'), checksum: 'p', contentType: 'image/png' },
      effectiveFontSizePt: 10,
    }))

    planResponder = () => JSON.stringify({ schemaVersion: 1, figures: [planFigure(1)] })
    detailResponder = () => componentDetail('figure-1')

    const result = await generateManagedFigureSet({ ...INPUT })
    const codes = result.figures[0].validation.issues.map(i => `${i.severity}:${i.code}`)
    console.log(`\n[layout] rendered=${result.figures.length} issues=${JSON.stringify(codes)}`)

    // One planned figure stays one figure: the variance is reported, not split.
    expect(result.figures).toHaveLength(1)
    expect(codes.some(code => code.startsWith('warning:SIBLING_DIMENSION_VARIANCE'))).toBe(true)
    expect(result.figures[0].validation.filingReady).toBe(true)
  })
})

describe('generated artefacts', () => {
  test('emits filing-ready monochrome PlantUML for the dummy invention', async () => {
    planResponder = () => JSON.stringify({
      schemaVersion: 1,
      figures: [planFigure(1), { ...planFigure(2), kind: 'PROCESS', key: 'method' }],
    })
    detailResponder = call =>
      call.metadata?.figureKey === 'method' ? groundedProcess('method') : componentDetail('figure-1')

    const result = await generateManagedFigureSet({ ...INPUT })

    console.log('\n===== FIG. 1 (COMPONENT) =====\n' + result.figures[0].plantuml)
    console.log('\n===== FIG. 2 (PROCESS) =====\n' + result.figures[1].plantuml)
    console.log('\n===== VALIDATION =====')
    result.figures.forEach(figure => console.log(
      `FIG. ${figure.figureNo} ${figure.kind} filingReady=${figure.validation.filingReady} ` +
      `issues=${JSON.stringify(figure.validation.issues.map(i => `${i.severity}:${i.code}`))} ` +
      `corrections=${JSON.stringify(figure.validation.corrections)}`,
    ))

    result.figures.forEach(figure => {
      expect(figure.validation.filingReady).toBe(true)
      expect(figure.plantuml).toContain('@startuml')
      expect(figure.plantuml).toContain('skinparam monochrome true')
    })
    // Reference numerals come from the Component Planner, not the model.
    expect(result.figures[0].plantuml).toContain('(100)')
    expect(result.figures[0].plantuml).toContain('(120)')
  })
})
