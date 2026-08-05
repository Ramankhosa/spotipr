/**
 * Live latency harness for the managed PlantUML figure pipeline.
 *
 * Runs planning and generation against the REAL configured LLM providers and
 * PlantUML renderer, using a synthetic invention so no client disclosure leaves
 * the machine (the renderer falls back to the public plantuml.com server when
 * PLANTUML_BASE_URL is unset).
 *
 * Creates a throwaway tenant/user/project/patent/session, runs the pipeline,
 * prints per-call timings, then deletes everything it created.
 *
 *   npx tsx scripts/diagnose-figure-pipeline-latency.ts --plan BASIC_PLAN
 *   npx tsx scripts/diagnose-figure-pipeline-latency.ts --plan BASIC_PLAN --coverage-model gpt-5-mini
 *
 * --coverage-model temporarily points the plan's DRAFT_FIGURE_COVERAGE stage at
 * the named model (row removed during cleanup) so the split-stage fast path can
 * be measured without disturbing any real plan configuration.
 */
import 'dotenv/config'
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'

const prisma = new PrismaClient()

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index > 0 ? process.argv[index + 1] : undefined
}
const KEEP = process.argv.includes('--keep')
const PLAN_CODE = flag('--plan') || 'BASIC_PLAN'
const COVERAGE_MODEL = flag('--coverage-model')
const FIGURE_COUNT = flag('--figures') ? Number(flag('--figures')) : null
// Coverage extraction chunks claims at ~3k tokens and runs the chunks
// concurrently. A short claim set is one chunk and never exercises that, so
// --extra-claims pads the set to measure the multi-chunk path.
const EXTRA_CLAIMS = flag('--extra-claims') ? Number(flag('--extra-claims')) : 0

const RUN_ID = crypto.randomBytes(4).toString('hex')
const MARKER = `figlatency-${RUN_ID}`

// Synthetic invention: entirely fabricated, safe to send to a public renderer.
const COMPONENTS = [
  { id: 'c1', name: 'Soil moisture sensor', type: 'SENSOR', referenceLabel: '110', description: 'Measures volumetric water content of the root zone', claimSupport: { matchedClaims: [1], claimRole: 'claim_1' } },
  { id: 'c2', name: 'Forecast receiver', type: 'MODULE', referenceLabel: '120', description: 'Receives precipitation forecast data over a network', claimSupport: { matchedClaims: [1], claimRole: 'claim_1' } },
  { id: 'c3', name: 'Irrigation controller', type: 'CONTROLLER', referenceLabel: '130', description: 'Compares moisture readings against a threshold and derives a watering window', claimSupport: { matchedClaims: [1, 2], claimRole: 'claim_1' } },
  { id: 'c4', name: 'Supply valve', type: 'ACTUATOR', referenceLabel: '140', description: 'Opens and closes the water supply line to the distribution manifold', claimSupport: { matchedClaims: [1], claimRole: 'claim_1' } },
  { id: 'c5', name: 'Flow meter', type: 'SENSOR', referenceLabel: '150', description: 'Measures delivered water volume downstream of the supply valve', claimSupport: { matchedClaims: [3], claimRole: 'dependent_claim' } },
  { id: 'c6', name: 'Irrigation log store', type: 'STORAGE', referenceLabel: '160', description: 'Persists per-zone watering records and delivered volumes', claimSupport: { matchedClaims: [3], claimRole: 'dependent_claim' } },
]

const CLAIMS = [
  { number: 1, type: 'independent', text: 'A weather-adaptive irrigation system comprising: a soil moisture sensor configured to measure a moisture level of a root zone; a forecast receiver configured to receive precipitation forecast data; an irrigation controller configured to compare the measured moisture level to a moisture threshold and to determine a watering window from the precipitation forecast data; and a supply valve configured to open during the watering window when the measured moisture level falls below the moisture threshold.' },
  { number: 2, type: 'dependent', dependsOn: 1, text: 'The system of claim 1, wherein the irrigation controller is further configured to suppress the watering window when the precipitation forecast data indicates precipitation exceeding a rainfall threshold within a suppression interval.' },
  { number: 3, type: 'dependent', dependsOn: 1, text: 'The system of claim 1, further comprising a flow meter configured to measure a delivered water volume and an irrigation log store configured to record the delivered water volume for each watering window.' },
]

// Padding claims for the multi-chunk path. Each is a self-contained dependent
// claim of roughly filing length, anchored on registry components so coverage
// extraction has real limitations to find rather than filler prose.
const PADDING_TEMPLATES = [
  (n: number) => `The system of claim 1, wherein the irrigation controller is further configured to derive a zone-specific moisture threshold for a zone ${n} of the root zone from a soil composition value stored in the irrigation log store, to compare the measured moisture level of said zone against the zone-specific moisture threshold, and to open the supply valve for a partial watering window when the measured moisture level of said zone falls below the zone-specific moisture threshold by less than a predetermined margin, whereby a partially dry zone receives a reduced delivered water volume.`,
  (n: number) => `The system of claim 1, wherein the forecast receiver is further configured to receive a forecast confidence value together with the precipitation forecast data for a forecast horizon ${n}, and the irrigation controller is further configured to suppress the watering window only when the forecast confidence value exceeds a confidence threshold, and to otherwise open the supply valve for a reduced watering window proportional to the forecast confidence value.`,
  (n: number) => `The system of claim 1, further comprising a flow meter configured to measure a delivered water volume during watering window ${n}, wherein the irrigation controller is further configured to compare the delivered water volume against an expected water volume derived from the watering window, and to record a discrepancy indication in the irrigation log store when the delivered water volume differs from the expected water volume by more than a tolerance value.`,
  (n: number) => `The system of claim 1, wherein the soil moisture sensor comprises a plurality of sensing elements disposed at respective depths ${n} within the root zone, and the irrigation controller is further configured to compute the measured moisture level as a depth-weighted aggregate of readings from the plurality of sensing elements, whereby a shallow drying front does not trigger the supply valve when deeper soil retains moisture.`,
]

function paddingClaims(count: number, startNumber: number) {
  return Array.from({ length: count }, (_, index) => ({
    number: startNumber + index,
    type: 'dependent' as const,
    dependsOn: 1,
    text: PADDING_TEMPLATES[index % PADDING_TEMPLATES.length](index + 1),
  }))
}

const ALL_CLAIMS = EXTRA_CLAIMS > 0 ? [...CLAIMS, ...paddingClaims(EXTRA_CLAIMS, CLAIMS.length + 1)] : CLAIMS

const IDEA = {
  title: 'Weather-adaptive irrigation controller',
  technicalProblem: 'Scheduled irrigation systems water on a fixed timetable and waste water by irrigating shortly before rainfall.',
  technicalSolution: 'Combining a root-zone moisture measurement with a precipitation forecast so the controller opens the supply valve only when the soil is dry and no qualifying rainfall is expected.',
  novelFeatures: ['Forecast-based suppression of a scheduled watering window', 'Closed-loop verification of delivered volume against the derived window'],
  advantages: ['Reduced water consumption', 'Avoids irrigating immediately before rainfall'],
  processSteps: [
    'The soil moisture sensor measures a moisture level of the root zone',
    'The forecast receiver receives precipitation forecast data for the zone',
    'The irrigation controller compares the measured moisture level to a moisture threshold',
    'The irrigation controller suppresses the watering window when forecast precipitation exceeds a rainfall threshold',
    'The irrigation controller derives a watering window from the forecast data',
    'The supply valve opens during the derived watering window',
    'The flow meter measures the delivered water volume',
    'The irrigation log store records the delivered volume for the watering window',
  ],
  relationships: [
    'The soil moisture sensor reports the moisture level to the irrigation controller',
    'The forecast receiver supplies precipitation forecast data to the irrigation controller',
    'The irrigation controller issues an open command to the supply valve',
    'The flow meter reports delivered volume to the irrigation log store',
  ],
  claimsStructuredFinal: ALL_CLAIMS,
}

const created: { tenantId?: string; userId?: string; projectId?: string; patentId?: string; sessionId?: string; coverageConfigId?: string } = {}

async function configureCoverageStage(planId: string) {
  if (!COVERAGE_MODEL) return
  const stage = await prisma.workflowStage.findUnique({ where: { code: 'DRAFT_FIGURE_COVERAGE' } })
  if (!stage) throw new Error('DRAFT_FIGURE_COVERAGE stage row is missing. Run: npm run seed:llm-models')
  const model = await prisma.lLMModel.findFirst({ where: { code: COVERAGE_MODEL } })
  if (!model) throw new Error(`Model ${COVERAGE_MODEL} not in the LLMModel catalog`)
  const existing = await prisma.planStageModelConfig.findUnique({ where: { planId_stageId: { planId, stageId: stage.id } } })
  if (existing) { console.log(`  coverage stage already configured for this plan (${COVERAGE_MODEL} requested) — leaving as-is`); return }
  const config = await prisma.planStageModelConfig.create({
    data: { planId, stageId: stage.id, modelId: model.id, maxTokensIn: 30000, maxTokensOut: 16000, isActive: true },
  })
  created.coverageConfigId = config.id
  console.log(`  temporary DRAFT_FIGURE_COVERAGE -> ${COVERAGE_MODEL} config created (removed at cleanup)`)
}

async function setup() {
  const plan = await prisma.plan.findFirst({ where: { code: PLAN_CODE } })
  if (!plan) throw new Error(`Plan ${PLAN_CODE} not found`)
  await configureCoverageStage(plan.id)

  const tenant = await prisma.tenant.create({
    data: { name: `Figure Latency Harness ${RUN_ID}`, atiId: MARKER, type: 'ENTERPRISE', status: 'ACTIVE' },
  })
  created.tenantId = tenant.id
  await prisma.tenantPlan.create({
    data: { tenantId: tenant.id, planId: plan.id, effectiveFrom: new Date(Date.now() - 60_000), status: 'ACTIVE' },
  })

  const user = await prisma.user.create({
    data: {
      email: `${MARKER}@local.test`, name: 'Figure Latency Harness',
      passwordHash: crypto.randomBytes(16).toString('hex'),
      tenantId: tenant.id, roles: ['ANALYST'], status: 'ACTIVE', emailVerified: true,
    },
  })
  created.userId = user.id

  const project = await prisma.project.create({ data: { name: `Harness ${RUN_ID}`, userId: user.id } })
  created.projectId = project.id

  const patent = await prisma.patent.create({ data: { projectId: project.id, title: IDEA.title, createdBy: user.id } })
  created.patentId = patent.id

  const session = await prisma.draftingSession.create({
    data: {
      patentId: patent.id, userId: user.id, tenantId: tenant.id,
      patentTypePrimary: 'SYSTEM', activeJurisdiction: 'US', draftingJurisdictions: ['US'],
      ideaRecord: { create: { title: IDEA.title, rawInput: IDEA.technicalProblem, normalizedData: IDEA as any } },
      referenceMap: { create: { components: { components: COMPONENTS, numberingStyle: 'NUMERIC_BUCKET' } as any, isValid: true } },
    },
  })
  created.sessionId = session.id

  const token = jwt.sign(
    { sub: user.id, email: user.email, tenant_id: tenant.id, roles: ['ANALYST'], ati_id: null, tenant_ati_id: null, scope: 'tenant' },
    process.env.JWT_SECRET!, { expiresIn: '2h' },
  )
  return { headers: { authorization: `Bearer ${token}` } }
}

async function cleanup() {
  if (KEEP) { console.log(`\n--keep set; leaving records: ${JSON.stringify(created)}`); return }
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn() } catch (error) { console.warn(`  cleanup(${label}) skipped: ${error instanceof Error ? error.message.split('\n')[0] : error}`) }
  }
  if (created.sessionId) {
    await step('diagramSource', () => prisma.diagramSource.deleteMany({ where: { sessionId: created.sessionId } }))
    await step('figurePlan', () => prisma.figurePlan.deleteMany({ where: { sessionId: created.sessionId } }))
    await step('draftingSession', () => prisma.draftingSession.deleteMany({ where: { id: created.sessionId } }))
  }
  if (created.patentId) await step('patent', () => prisma.patent.deleteMany({ where: { id: created.patentId } }))
  if (created.projectId) await step('project', () => prisma.project.deleteMany({ where: { id: created.projectId } }))
  if (created.tenantId) {
    const where = { where: { tenantId: created.tenantId } }
    await step('auditLog', () => prisma.auditLog.deleteMany(where))
    await step('usageLog', () => prisma.usageLog.deleteMany(where))
    await step('usageReservation', () => prisma.usageReservation.deleteMany(where))
    await step('usageMeter', () => prisma.usageMeter.deleteMany(where))
    await step('quotaAlert', () => prisma.quotaAlert.deleteMany(where))
    await step('serviceCompletionUsage', () => prisma.serviceCompletionUsage.deleteMany(where))
    await step('diagramGenerationUsage', () => prisma.diagramGenerationUsage.deleteMany(where))
    await step('patentDraftingUsage', () => prisma.patentDraftingUsage.deleteMany(where))
    await step('tenantPlan', () => prisma.tenantPlan.deleteMany(where))
  }
  if (created.userId) await step('user', () => prisma.user.deleteMany({ where: { id: created.userId } }))
  if (created.tenantId) await step('tenant', () => prisma.tenant.deleteMany({ where: { id: created.tenantId } }))
  if (created.coverageConfigId) await step('coverageConfig', () => prisma.planStageModelConfig.deleteMany({ where: { id: created.coverageConfigId } }))
  console.log('Cleanup complete.')
}

async function main() {
  const claimChars = ALL_CLAIMS.reduce((total, claim) => total + claim.text.length, 0)
  console.log(`=== Live figure-pipeline latency run ${RUN_ID} | plan=${PLAN_CODE} | coverageModel=${COVERAGE_MODEL || '(unconfigured -> fallback)'} | claims=${ALL_CLAIMS.length} (${(claimChars / 1000).toFixed(1)}k chars) ===\n`)
  const { headers } = await setup()
  const { planManagedFigureSet, generateManagedFigureSet } = await import('../src/lib/patent-diagrams/pipeline')
  const input = {
    userId: created.userId!, patentId: created.patentId!, sessionId: created.sessionId!,
    requestHeaders: headers, figureCount: FIGURE_COUNT, mode: 'ai' as const,
  }

  const planStart = Date.now()
  const plan = await planManagedFigureSet(input)
  const planMs = Date.now() - planStart
  console.log(`\n>>> PLANNING TOTAL: ${planMs} ms — ${plan.figures.length} figures`)
  plan.figures.forEach(f => console.log(`      ${f.kind.padEnd(11)} ${f.title} (${f.componentIds.length} components)`))

  const generateStart = Date.now()
  const result = await generateManagedFigureSet({ ...input, plan })
  const generateMs = Date.now() - generateStart
  console.log(`\n>>> GENERATION TOTAL: ${generateMs} ms — ${result.figures.length} figures rendered`)
  result.figures.forEach(f => console.log(`      FIG.${f.figureNo} ${f.kind.padEnd(11)} ${f.title} — ${f.plantuml.split('\n').length} PlantUML lines`))
  if (result.filingReadiness.reviewNotes.length) console.log('      review notes:', JSON.stringify(result.filingReadiness.reviewNotes))

  // Numbering audit. Only drawn element boxes are checked: their aliases are
  // hashed (C/M/P/K + 12 hex), so the SYSTEM and BAND container rectangles —
  // which correctly carry no numeral — are excluded automatically.
  console.log('\n>>> NUMBERING AUDIT (every drawn element must carry a reference sign)')
  let unnumberedTotal = 0
  for (const figure of result.figures) {
    const declarations = Array.from(figure.plantuml.matchAll(/^\s*(?:rectangle|participant)\s+"((?:\\.|[^"\\])*)"\s+as\s+([CMPK][0-9A-F]{12}\w*)/gm))
    const unnumbered = declarations.filter(([, label]) => !/\((?:[^()]+)\)|\\n[SD]\d+|^[SD]\d+/i.test(label))
    unnumberedTotal += unnumbered.length
    console.log(`      FIG.${figure.figureNo} ${figure.kind.padEnd(11)} ${declarations.length} elements, ${unnumbered.length} without a sign${unnumbered.length ? ` -> ${unnumbered.map(m => JSON.stringify(m[1])).join(', ')}` : ''}`)
  }
  console.log(`      ${unnumberedTotal === 0 ? 'PASS — every drawn element is numbered' : `FAIL — ${unnumberedTotal} unnumbered element(s)`}`)

  console.log('\n>>> CLAIM COMPONENT COVERAGE (warning only, never blocks)')
  if (!result.claimCoverage.evaluated) {
    console.log('      not evaluated (no Stage 0 claim matching on this registry)')
  } else if (!result.claimCoverage.missing.length) {
    console.log('      PASS — every claim-recited component appears in at least one figure')
  } else {
    result.claimCoverage.missing.forEach(m => console.log(`      MISSING: ${m.name} (${m.referenceLabel}) — claim(s) ${m.matchedClaims.join(', ')}`))
  }

  console.log(`\n>>> END-TO-END: ${planMs + generateMs} ms (plan ${planMs} + generate ${generateMs})`)

  result.figures.forEach(f => console.log(`\n===== FIG.${f.figureNo} (${f.kind}) — ${f.title} =====\n${f.plantuml}`))
}

main()
  .catch(error => {
    console.error('\nRUN FAILED:', error?.message || error)
    if (error?.details) console.error('details:', JSON.stringify(error.details).slice(0, 2000))
    process.exitCode = 1
  })
  .finally(async () => { await cleanup(); await prisma.$disconnect() })
