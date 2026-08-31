/**
 * Scenario harness: drives the REAL diagram pipeline with a dummy invention.
 * Only two boundaries are stubbed — Postgres and the PlantUML render server —
 * so planning, prompting, batched generation, normalization, validation and the
 * replace/append persistence paths all run for real.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { llmGateway } from '@/lib/metering/gateway'
import { addManagedFigures, generateManagedFigureSet, planManagedFigureSet, splitManagedFigure } from '@/lib/patent-diagrams/pipeline'

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
]

const DISCLOSED_PROCESS_STEPS = [
  'Measure volumetric water content of the root zone',
  'Receive forecast precipitation from the weather data interface',
  'Compare measured moisture against a configured threshold',
  'Derive a watering window from moisture and forecast',
  'Open the supply valve for the derived window',
  'Measure delivered water volume with the flow meter',
]

const IDEA = {
  title: 'Adaptive Soil-Moisture Irrigation Control System',
  problemStatement: 'Fixed-interval irrigation over-waters when rainfall is imminent.',
  solutionSummary: 'A controller fuses soil moisture with forecast precipitation to derive watering windows and verifies delivery with a flow meter.',
  sourceFactLedger: { processSteps: DISCLOSED_PROCESS_STEPS },
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

vi.spyOn(llmGateway, 'executeLLMOperation').mockImplementation(async (_ctx: any, request: any) => {
  const call = { stageCode: String(request.stageCode), prompt: String(request.prompt), metadata: request.metadata }
  llmCalls.push(call)
  if (call.stageCode === 'DRAFT_FIGURE_PLANNER') {
    return { success: true, response: { output: planResponder(call) } } as any
  }
  const key = String(request.metadata?.figureKeys || '')
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
  renderAndWriteDiagramArtifacts: vi.fn(),
}))

vi.mock('@/lib/service-completion', () => ({ recordServiceCompletion: vi.fn(async () => ({ counted: true })) }))

const unlinkedPaths: string[] = []
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises')
  return {
    ...actual,
    default: { ...actual, unlink: vi.fn(async (path: string) => { unlinkedPaths.push(String(path)) }) },
    unlink: vi.fn(async (path: string) => { unlinkedPaths.push(String(path)) }),
  }
})

// ------------------------------------------------------------------ DB stub
const db = {
  figurePlans: [] as any[],
  diagramSources: [] as any[],
  sessionUpdates: [] as any[],
  deleteManyCalls: [] as Array<{ table: string; where: any }>,
}

const txClient = {
  diagramSource: {
    deleteMany: vi.fn(async (args: any) => { db.deleteManyCalls.push({ table: 'diagramSource', where: args.where }); return { count: 0 } }),
    create: vi.fn(async (args: any) => { db.diagramSources.push(args.data); return { id: `src-${db.diagramSources.length}`, ...args.data } }),
    upsert: vi.fn(async (args: any) => ({ id: 'src', ...args.create })),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  figurePlan: {
    deleteMany: vi.fn(async (args: any) => { db.deleteManyCalls.push({ table: 'figurePlan', where: args.where }); return { count: 0 } }),
    create: vi.fn(async (args: any) => { db.figurePlans.push(args.data); return { id: `plan-${db.figurePlans.length}`, ...args.data } }),
    update: vi.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
  },
  draftingSession: {
    findUnique: vi.fn(async () => ({ aiAnalysisData: sessionAnalysisData })),
    update: vi.fn(async (args: any) => { db.sessionUpdates.push(args.data); return {} }),
  },
}

let existingFigurePlans: any[] = []
let existingDiagramSources: any[] = []
let sessionAnalysisData: any = null
/** Lets a test attach Stage 0 claim matches to the registry. */
let sessionComponents: any[] = COMPONENTS

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
        aiAnalysisData: sessionAnalysisData,
        referenceMap: { isValid: true, components: sessionComponents },
        ideaRecord: { title: IDEA.title, normalizedData: IDEA },
        figurePlans: existingFigurePlans,
        diagramSources: existingDiagramSources,
      })),
      update: vi.fn(async (args: any) => { db.sessionUpdates.push(args.data); return {} }),
    },
    user: { findUnique: vi.fn(async () => ({ tenantId: 'tenant-1' })) },
    $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(txClient) : Promise.all(arg))),
  },
}))

// ------------------------------------------------------------ canned outputs
const KIND_ORDER = ['COMPONENT', 'PROCESS', 'SEQUENCE', 'CONSTITUENT'] as const

const planFigure = (index: number, kind: string = KIND_ORDER[index % 4]) => ({
  key: `figure-${index + 1}`,
  kind,
  title: `${kind} view ${index + 1}`,
  purpose: `Show the disclosed irrigation control ${kind.toLowerCase()} view ${index + 1}`,
  detailLevel: 'DETAIL',
  direction: kind === 'SEQUENCE' ? 'LR' : 'TB',
  componentIds: ['c1', 'c2', 'c3', 'c4'],
  claimCriticalComponentIds: ['c3'],
  orderedGroups: [
    { id: 'sensing', label: 'Sensing Subsystem', componentIds: ['c1', 'c2'] },
    { id: 'control', label: 'Control Subsystem', componentIds: ['c3'] },
  ],
  phaseHints: [],
  evidenceIds: [],
})

const defaultPlan = (count = 4) => JSON.stringify({
  schemaVersion: 3,
  figures: Array.from({ length: count }, (_, index) => planFigure(index)),
})

const diagramOfKind = (kind: string, key: string): any => {
  const common = {
    schemaVersion: 3, key, title: 'ignored — the server owns the heading', purpose: 'ignored',
    detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: ['c3'], evidenceIds: [],
  }
  if (kind === 'COMPONENT') {
    return {
      ...common, kind: 'COMPONENT', systemBoundaryLabel: 'Irrigation Control System',
      groups: [
        { id: 'sensing', label: 'Sensing Subsystem', rows: [{ componentIds: ['c1', 'c2'] }] },
        { id: 'control', label: 'Control Subsystem', rows: [{ componentIds: ['c3', 'c4'] }] },
      ],
      components: [{ componentId: 'c1' }, { componentId: 'c2' }, { componentId: 'c3' }, { componentId: 'c4' }],
      relationships: [
        { fromId: 'c1', toId: 'c3', category: 'DATA_INPUT' },
        { fromId: 'c3', toId: 'c4', category: 'CONTROL' },
      ],
    }
  }
  if (kind === 'PROCESS') {
    return {
      ...common, kind: 'PROCESS',
      nodes: [
        { key: 'measure', kind: 'STEP', componentId: 'c1', label: 'Measure soil moisture', evidenceIds: ['SF-processSteps-1'] },
        { key: 'below', kind: 'DECISION', componentId: 'c3', label: 'Moisture below threshold', evidenceIds: ['SF-processSteps-3'] },
        { key: 'open', kind: 'STEP', componentId: 'c4', label: 'Open supply valve', evidenceIds: ['SF-processSteps-5'] },
      ],
      transitions: [
        { fromId: 'measure', toId: 'below', label: '', category: 'PRIMARY' },
        { fromId: 'below', toId: 'open', label: 'yes', category: 'PRIMARY' },
      ],
    }
  }
  if (kind === 'SEQUENCE') {
    return {
      ...common, kind: 'SEQUENCE',
      participants: [{ componentId: 'c1' }, { componentId: 'c3' }, { componentId: 'c4' }],
      interactions: [
        { order: 1, fromId: 'c1', toId: 'c3', label: 'moisture reading', category: 'PRIMARY' },
        { order: 2, fromId: 'c3', toId: 'c4', label: 'valve command', category: 'CONTROL' },
      ],
    }
  }
  return {
    ...common, kind: 'CONSTITUENT', boundaryLabel: 'Irrigation Assembly',
    constituents: [
      { componentId: 'c1', technicalRole: 'sensing element' },
      { componentId: 'c4', technicalRole: 'flow control element' },
    ],
    relationships: [{ fromId: 'c1', toId: 'c4', category: 'ASSOCIATION' }],
  }
}

/** Answers a batch prompt with one diagram per planned figure, in order. */
const batchFor = (call: LlmCall) => {
  const keys = String(call.metadata?.figureKeys || '').split(',').filter(Boolean)
  const kinds = Array.from(call.prompt.matchAll(/<(COMPONENT|PROCESS|SEQUENCE|CONSTITUENT) for key "([^"]+)"/g))
  return JSON.stringify({ diagrams: kinds.map(([, kind, key]) => diagramOfKind(kind, key || keys.shift() || '')) })
}

const INPUT = { userId: 'user-1', patentId: 'patent-1', sessionId: 'session-1', requestHeaders: {} }

const defaultRenderImpl = async (input: any) => ({
  artifacts: {
    svg: { filename: `figure_${input.figureNo}.svg`, path: `/tmp/figure_${input.figureNo}.svg`, checksum: 'svg-sum', contentType: 'image/svg+xml', width: 800, height: 600 },
    png: { filename: `figure_${input.figureNo}.png`, path: `/tmp/figure_${input.figureNo}.png`, checksum: 'png-sum', contentType: 'image/png' },
  },
  svg: { buffer: Buffer.from(`<svg>${input.plantumlCode}</svg>`), checksum: 'svg-sum', contentType: 'image/svg+xml', width: 800, height: 600 },
  png: { buffer: Buffer.from('png'), checksum: 'png-sum', contentType: 'image/png' },
  effectiveFontSizePt: 10,
})

beforeEach(async () => {
  const artifacts = await import('@/lib/patent-diagrams/artifacts')
  ;(artifacts.renderAndWriteDiagramArtifacts as any).mockImplementation(defaultRenderImpl)
  llmCalls.length = 0
  unlinkedPaths.length = 0
  detailAttempts.clear()
  db.figurePlans = []
  db.diagramSources = []
  db.sessionUpdates = []
  db.deleteManyCalls = []
  existingFigurePlans = []
  existingDiagramSources = []
  sessionAnalysisData = null
  sessionComponents = COMPONENTS
  planResponder = () => defaultPlan()
  detailResponder = batchFor
})

const stageCounts = () => ({
  plan: llmCalls.filter(call => call.stageCode === 'DRAFT_FIGURE_PLANNER').length,
  detail: llmCalls.filter(call => call.stageCode === 'DRAFT_DIAGRAM_GENERATION').length,
})

describe('two-stage shape: one plan, two figures per generation call', () => {
  test('a default run is one planning call plus two generation calls', async () => {
    const result = await generateManagedFigureSet({ ...INPUT })

    expect(stageCounts()).toEqual({ plan: 1, detail: 2 })
    expect(result.figures).toHaveLength(4)
    expect(result.figures.map(figure => figure.kind)).toEqual(['COMPONENT', 'PROCESS', 'SEQUENCE', 'CONSTITUENT'])
    expect(result.figures.map(figure => figure.figureNo)).toEqual([1, 2, 3, 4])
  })

  test('each generation call is asked for exactly two figures', async () => {
    await generateManagedFigureSet({ ...INPUT })
    const detailCalls = llmCalls.filter(call => call.stageCode === 'DRAFT_DIAGRAM_GENERATION')
    detailCalls.forEach(call => {
      expect(String(call.metadata.figureKeys).split(',')).toHaveLength(2)
      expect(call.prompt).toContain('return exactly 2 diagram(s)')
      // The numbering contract is stated to the model, not enforced by a gate.
      expect(call.prompt).toContain('MUST set componentId')
    })
  })

  test('an odd figure count leaves a final single-figure call', async () => {
    planResponder = () => defaultPlan(5)
    const result = await generateManagedFigureSet({ ...INPUT, figureCount: 5 })

    expect(stageCounts()).toEqual({ plan: 1, detail: 3 })
    expect(result.figures).toHaveLength(5)
    // Kinds cycle through the default four.
    expect(result.figures.map(figure => figure.kind)).toEqual(['COMPONENT', 'PROCESS', 'SEQUENCE', 'CONSTITUENT', 'COMPONENT'])
  })

  test('there is no coverage-extraction stage left to run', async () => {
    await generateManagedFigureSet({ ...INPUT })
    expect(llmCalls.some(call => call.stageCode === 'DRAFT_FIGURE_COVERAGE')).toBe(false)
    expect(llmCalls.every(call => ['DRAFT_FIGURE_PLANNER', 'DRAFT_DIAGRAM_GENERATION'].includes(call.stageCode))).toBe(true)
  })
})

describe('the four diagram kinds are the default set', () => {
  test('planning asks for one figure of each kind when no count is given', async () => {
    const plan = await planManagedFigureSet({ ...INPUT })
    expect(plan.figures.map(figure => figure.kind)).toEqual(['COMPONENT', 'PROCESS', 'SEQUENCE', 'CONSTITUENT'])
  })

  test('a short plan is kept as planned, never padded with synthesized figures', async () => {
    planResponder = () => JSON.stringify({ schemaVersion: 3, figures: [planFigure(0)] })
    const plan = await planManagedFigureSet({ ...INPUT })

    // The planner chose one figure the disclosure supports; padding used to
    // fabricate generic figures (e.g. a "Composition" for a software idea).
    expect(plan.figures).toHaveLength(1)
    expect(plan.figures[0].kind).toBe('COMPONENT')
  })

  test('an over-long plan is trimmed to the requested count', async () => {
    planResponder = () => defaultPlan(9)
    const plan = await planManagedFigureSet({ ...INPUT, figureCount: 2 })
    expect(plan.figures).toHaveLength(2)
  })

  test('every kind renders monochrome filing PlantUML', async () => {
    const result = await generateManagedFigureSet({ ...INPUT })
    result.figures.forEach(figure => {
      expect(figure.plantuml).toContain('@startuml')
      expect(figure.plantuml).toContain('skinparam monochrome true')
      expect(figure.validation.filingReady).toBe(true)
    })
    // Reference numerals come from the Component Planner, not the model.
    expect(result.figures[0].plantuml).toContain('(100)')
    expect(result.figures[0].plantuml).toContain('(120)')
    // PROCESS boxes carry the numeral of the component performing each step.
    expect(result.figures[1].plantuml).toContain('(100)')
    expect(result.figures[1].plantuml).toContain('(130)')
  })
})

describe('imperfect model output does not fail the run', () => {
  test('invented component IDs in the plan are dropped, not rejected', async () => {
    planResponder = () => JSON.stringify({
      schemaVersion: 3,
      figures: [{ ...planFigure(0), componentIds: ['c1', 'ghost-42'], claimCriticalComponentIds: ['ghost-42'] }],
    })
    const plan = await planManagedFigureSet({ ...INPUT })
    expect(plan.figures[0].componentIds).toEqual(['c1'])
    expect(plan.figures[0].claimCriticalComponentIds).toEqual([])
  })

  test('invented component IDs in a diagram are normalized away and still drawn', async () => {
    detailResponder = call => {
      const kinds = Array.from(call.prompt.matchAll(/<(COMPONENT|PROCESS|SEQUENCE|CONSTITUENT) for key "([^"]+)"/g))
      return JSON.stringify({
        diagrams: kinds.map(([, kind, key]) => {
          const diagram = diagramOfKind(kind, key)
          if (kind === 'COMPONENT') {
            diagram.components.push({ componentId: 'cloud-service-99' })
            diagram.groups[0].rows[0].componentIds.push('cloud-service-99')
          }
          return diagram
        }),
      })
    }
    const result = await generateManagedFigureSet({ ...INPUT })
    expect(result.figures).toHaveLength(4)
    expect(result.figures[0].plantuml).not.toContain('cloud-service-99')
    expect(result.figures[0].validation.filingReady).toBe(true)
  })

  test('a batch that answers for only one of its two figures still saves the rest', async () => {
    detailResponder = call => {
      const kinds = Array.from(call.prompt.matchAll(/<(COMPONENT|PROCESS|SEQUENCE|CONSTITUENT) for key "([^"]+)"/g))
      const [first] = kinds
      return JSON.stringify({ diagrams: [diagramOfKind(first[1], first[2])] })
    }
    const result = await generateManagedFigureSet({ ...INPUT })

    // One figure per batch came back; the run completes with what it got.
    expect(result.figures).toHaveLength(2)
    expect(result.figures.map(figure => figure.kind)).toEqual(['COMPONENT', 'SEQUENCE'])
  })

  test('a dense figure is drawn with a review note instead of being split', async () => {
    detailResponder = call => {
      const kinds = Array.from(call.prompt.matchAll(/<(COMPONENT|PROCESS|SEQUENCE|CONSTITUENT) for key "([^"]+)"/g))
      return JSON.stringify({
        diagrams: kinds.map(([, kind, key]) => {
          const diagram = diagramOfKind(kind, key)
          if (kind === 'COMPONENT') {
            diagram.groups = COMPONENTS.map((component, index) => ({
              id: `g${index}`, label: `Subsystem ${index}`, rows: [{ componentIds: [component.id] }],
            }))
            diagram.components = COMPONENTS.map(component => ({ componentId: component.id }))
          }
          return diagram
        }),
      })
    }
    const result = await generateManagedFigureSet({ ...INPUT })

    // Eight bands is well over the four-band guideline, and it stays ONE figure.
    expect(result.figures).toHaveLength(4)
    const component = result.figures[0]
    expect(component.validation.filingReady).toBe(true)
    expect(component.validation.issues.map(issue => issue.code)).toContain('DENSE_FIGURE')
    expect(component.validation.issues.every(issue => issue.severity !== 'error')).toBe(true)
  })

  test('the run survives a first reply that fails the contract', async () => {
    detailResponder = (call, attempt) => attempt === 1 ? '{"diagrams":[]}' : batchFor(call)
    const result = await generateManagedFigureSet({ ...INPUT })
    expect(result.figures).toHaveLength(4)
    expect(stageCounts().detail).toBe(4) // two batches, each retried once
  })
})

describe('persistence', () => {
  test('a replace run deletes only generated figures, never imported ones', async () => {
    existingFigurePlans = [{ figureNo: 1, title: 'Old', diagramType: 'COMPONENT', semanticModel: null }]
    existingDiagramSources = [
      { figureNo: 1, language: 'en', sourceMode: 'MANAGED', imagePath: '/tmp/old_generated.png', renderArtifacts: { svg: { path: '/tmp/old_generated.svg' } } },
      // A user-uploaded figure parked in the high band.
      { figureNo: 900, language: 'en', sourceMode: 'IMPORTED_IMAGE', imagePath: '/uploads/patents/patent-1/imported_900.png', originalImagePath: '/uploads/patents/patent-1/imported_900_original.png', renderArtifacts: null },
    ]

    await generateManagedFigureSet({ ...INPUT })

    expect(db.deleteManyCalls.every(call => call.where.figureNo?.lt === 900)).toBe(true)
    // The imported upload survives: its row is not deleted, so its file must not be either.
    expect(unlinkedPaths).toContain('/tmp/old_generated.png')
    expect(unlinkedPaths.some(path => path.includes('imported_900'))).toBe(false)
  })

  test('appending allocates the next free generated slots', async () => {
    existingFigurePlans = [{ figureNo: 1, title: 'Existing', diagramType: 'COMPONENT', semanticModel: null }]
    planResponder = () => defaultPlan(2)
    const result = await addManagedFigures({ ...INPUT, figureCount: 2 })

    expect(result.figures.map(figure => figure.figureNo)).toEqual([2, 3])
    expect(db.deleteManyCalls).toHaveLength(0)
  })

  test('a saved plan is reused instead of re-planning', async () => {
    const plan = await planManagedFigureSet({ ...INPUT })
    sessionAnalysisData = { figurePlan: plan }
    llmCalls.length = 0

    await generateManagedFigureSet({ ...INPUT })
    expect(stageCounts().plan).toBe(0)
    expect(stageCounts().detail).toBe(2)
  })
})

describe('post-generation claim coverage warnings', () => {
  test('names a claim-recited component that no figure depicts', async () => {
    sessionComponents = COMPONENTS.map(component => component.id === 'c5'
      ? { ...component, claimSupport: { matchedClaims: [2], claimRole: 'dependent_claim' } }
      : component)
    const result = await generateManagedFigureSet({ ...INPUT })

    expect(result.claimCoverage.evaluated).toBe(true)
    expect(result.claimCoverage.missing).toEqual([
      { id: 'c5', name: 'Flow Meter', referenceLabel: '140', matchedClaims: [2] },
    ])
    // A warning, never a block: the full set still generated and saved.
    expect(result.figures).toHaveLength(4)
    expect(db.figurePlans).toHaveLength(4)
  })

  test('is satisfied when the claimed component is drawn', async () => {
    sessionComponents = COMPONENTS.map(component => component.id === 'c1'
      ? { ...component, claimSupport: { matchedClaims: [1], claimRole: 'claim_1' } }
      : component)
    const result = await generateManagedFigureSet({ ...INPUT })
    expect(result.claimCoverage).toEqual({ evaluated: true, missing: [] })
  })

  test('reports unevaluated when Stage 0 claim matching has not run', async () => {
    const result = await generateManagedFigureSet({ ...INPUT })
    // Absence of matching data must never read as "coverage complete".
    expect(result.claimCoverage.evaluated).toBe(false)
    expect(result.claimCoverage.missing).toEqual([])
  })
})

describe('auto mode sizes the figure set to the disclosure', () => {
  test('keeps a planner-chosen 9-figure set instead of trimming to four', async () => {
    planResponder = () => defaultPlan(9)
    const result = await generateManagedFigureSet({ ...INPUT })

    expect(result.figures).toHaveLength(9)
    // 9 figures = 5 paired generation calls (4 pairs + 1 single).
    expect(stageCounts()).toEqual({ plan: 1, detail: 5 })
  })

  test('auto prompt offers a range and a suggestion, not fixed slots', async () => {
    await planManagedFigureSet({ ...INPUT })
    const planCall = llmCalls.find(call => call.stageCode === 'DRAFT_FIGURE_PLANNER')!
    expect(planCall.prompt).toContain('at least 4 and at most 20 figures')
    expect(planCall.prompt).not.toContain('plan exactly')
  })

  test('an explicit count still pins the set exactly', async () => {
    planResponder = () => defaultPlan(9)
    const plan = await planManagedFigureSet({ ...INPUT, figureCount: 3 })
    expect(plan.figures).toHaveLength(3)
    const planCall = llmCalls.find(call => call.stageCode === 'DRAFT_FIGURE_PLANNER')!
    expect(planCall.prompt).toContain('plan exactly 3 figure(s)')
  })

  test('auto mode keeps the model count and kinds without padding in missing ones', async () => {
    // Model plans 5 COMPONENT figures and nothing else.
    planResponder = () => JSON.stringify({
      schemaVersion: 3,
      figures: Array.from({ length: 5 }, (_, index) => planFigure(index, 'COMPONENT')),
    })
    const plan = await planManagedFigureSet({ ...INPUT })
    expect(plan.figures).toHaveLength(5)
    expect(plan.figures.every(figure => figure.kind === 'COMPONENT')).toBe(true)
  })

  test('a manual-count shortfall reports a planning note instead of padding', async () => {
    planResponder = () => JSON.stringify({
      schemaVersion: 3,
      figures: [planFigure(0, 'COMPONENT'), planFigure(1, 'PROCESS')],
    })
    const plan = await planManagedFigureSet({ ...INPUT, figureCount: 5 })
    expect(plan.figures).toHaveLength(2)
    expect((plan as any).planningNotes?.join(' ')).toContain('Planned 2 of the requested 5 figures')
  })

  test('a plan whose figures all reference unknown components fails instead of synthesizing', async () => {
    planResponder = () => JSON.stringify({
      schemaVersion: 3,
      figures: [{ ...planFigure(0), componentIds: ['ghost-1', 'ghost-2'] }],
    })
    await expect(planManagedFigureSet({ ...INPUT })).rejects.toMatchObject({ code: 'EMPTY_FIGURE_PLAN' })
  })
})

describe('user-directed figure split', () => {
  const originalSemantic = () => diagramOfKind('COMPONENT', 'arch')
  const partOf = (key: string, componentIds: string[]) => ({
    schemaVersion: 3, kind: 'COMPONENT', key,
    title: `Architecture — ${componentIds.join('/')}`, purpose: `Depicts ${componentIds.join(', ')}`,
    detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [], evidenceIds: [],
    systemBoundaryLabel: 'Irrigation Control System',
    groups: [{ id: `g-${key}`, label: 'Subsystem', rows: [{ componentIds }] }],
    components: componentIds.map(componentId => ({ componentId })),
    relationships: [],
  })

  beforeEach(() => {
    existingFigurePlans = [
      { id: 'plan-1', figureNo: 1, title: 'Architecture', diagramType: 'COMPONENT', semanticModel: originalSemantic(), description: 'Architecture overview' },
      { id: 'plan-2', figureNo: 2, title: 'Method', diagramType: 'PROCESS', semanticModel: diagramOfKind('PROCESS', 'method') },
    ]
    existingDiagramSources = [
      { id: 'src-1', figureNo: 1, language: 'en', sourceMode: 'MANAGED', checksum: 'old-sum', imagePath: '/tmp/old_1.png', renderArtifacts: { svg: { path: '/tmp/old_1.svg' }, png: { path: '/tmp/old_1.png' } } },
    ]
    detailResponder = () => JSON.stringify({ diagrams: [partOf('a', ['c1', 'c2']), partOf('b', ['c3', 'c4'])] })
  })

  test('splits into the user-set number of parts, aware of the other figures', async () => {
    const result = await splitManagedFigure({ ...INPUT, figureNo: 1, parts: 2 })

    expect(result.status).toBe('SUCCESS')
    expect(result.figures).toHaveLength(2)
    // Part 1 keeps the original number; part 2 takes the next free slot (2 is occupied).
    expect(result.figures.map(figure => figure.figureNo)).toEqual([1, 3])
    expect(result.figures.every(figure => figure.kind === 'COMPONENT')).toBe(true)
    // No content lost, so no completeness note.
    expect(result.filingReadiness.reviewNotes.some(note => note.code === 'SPLIT_CONTENT_MISSING')).toBe(false)

    const splitCall = llmCalls.find(call => call.metadata?.purpose === 'split_figure_structured')!
    expect(splitCall.prompt).toContain('exactly 2')
    expect(splitCall.prompt).toContain('OTHER FIGURES IN THIS DRAWING SET')
    expect(splitCall.prompt).toContain('Method')
    // The original's files are superseded and removed.
    expect(unlinkedPaths).toContain('/tmp/old_1.png')
  })

  test('reports dropped content as a review note, never a failure', async () => {
    detailResponder = () => JSON.stringify({ diagrams: [partOf('a', ['c1', 'c2']), partOf('b', ['c3'])] })
    const result = await splitManagedFigure({ ...INPUT, figureNo: 1, parts: 2 })

    expect(result.status).toBe('SUCCESS')
    const note = result.filingReadiness.reviewNotes.find(item => item.code === 'SPLIT_CONTENT_MISSING')
    expect(note?.message).toContain('c4')
  })

  test('rejects an out-of-range part count without an LLM call', async () => {
    await expect(splitManagedFigure({ ...INPUT, figureNo: 1, parts: 9 })).rejects.toMatchObject({ code: 'INVALID_SPLIT_PARTS' })
    expect(llmCalls).toHaveLength(0)
  })
})

describe('metered fan-out', () => {
  /**
   * Runs a generation with the metered limit forced to `limit` and reports how
   * many generation calls were ever in flight at once. The calls are made to
   * overlap by suspending inside the gateway stub — measuring the stub's
   * synchronous body would report 1 no matter what the pipeline did.
   *
   * `observedAtStart` records what each call saw in flight as it began, which is
   * what distinguishes "ran alone" from merely "ran first": a call that starts
   * while an earlier one is still open observes 2, not 1.
   */
  async function peakDetailConcurrency(limit: number, figureCount: number) {
    vi.spyOn(llmGateway, 'getTaskConcurrencyLimit').mockResolvedValue(limit)
    const gateway = llmGateway.executeLLMOperation as any
    const baseImplementation = gateway.getMockImplementation()
    let inFlight = 0
    let peak = 0
    const observedAtStart: number[] = []
    gateway.mockImplementation(async (context: any, request: any) => {
      if (request.stageCode !== 'DRAFT_DIAGRAM_GENERATION') return baseImplementation(context, request)
      inFlight++
      peak = Math.max(peak, inFlight)
      observedAtStart.push(inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      try { return await baseImplementation(context, request) } finally { inFlight-- }
    })
    try {
      planResponder = () => defaultPlan(figureCount)
      const result = await generateManagedFigureSet({ ...INPUT, figureCount })
      return { peak, observedAtStart, figures: result.figures.length }
    } finally {
      gateway.mockImplementation(baseImplementation)
      vi.mocked(llmGateway.getTaskConcurrencyLimit).mockRestore?.()
    }
  }

  test('generation calls never exceed the tenant limit', async () => {
    const { peak, figures } = await peakDetailConcurrency(2, 8)
    expect(figures).toBe(8)
    expect(peak).toBeLessThanOrEqual(2)
  })

  test('a raised limit widens fan-out without a code change', async () => {
    const { peak, figures } = await peakDetailConcurrency(4, 8)
    expect(figures).toBe(8)
    expect(peak).toBeGreaterThan(2)
    expect(peak).toBeLessThanOrEqual(4)
  })

  // Providers write a prompt cache entry when a request COMPLETES. Every generation
  // call in a run shares a multi-thousand-token preamble, so fanning out immediately
  // puts the whole first wave in flight before any of them has written that entry and
  // every one pays full input price. One call must land before the rest start.
  test('the first generation call runs alone so the rest find a warm prompt cache', async () => {
    const { observedAtStart, peak, figures } = await peakDetailConcurrency(4, 8)

    expect(figures).toBe(8)
    // Call 2 seeing only itself in flight is what proves call 1 had already finished.
    expect(observedAtStart.slice(0, 2)).toEqual([1, 1])
    // ...and the remaining batches still overlap rather than running one by one.
    expect(peak).toBeGreaterThan(1)
  })
})
