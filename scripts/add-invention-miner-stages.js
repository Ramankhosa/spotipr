/**
 * Invention Miner setup: registers the INVENTION_MINER feature, its three LLM
 * tasks, and the workflow stages that Super Admin > LLM Config edits.
 *
 * Why this is needed: stage-coded model resolution is FAIL-CLOSED
 * (src/lib/metering/model-resolver.ts throws when no PlanStageModelConfig row
 * exists for the plan + stage). The module falls back to task-only routing so it
 * works without this script, but then extraction and the inventive-step gate
 * share one model and the cost-routing design — cheap for the batched extraction
 * and lead naming, mid for the exclusion screen, premium for inventive step and
 * the brief — cannot be expressed. Run this to get real per-stage control.
 *
 * Seeds each plan's stage rows by mirroring an existing configured stage, so
 * plans start with a working model rather than a blank row.
 *
 * Idempotent. Run with: node scripts/add-invention-miner-stages.js
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

/**
 * tier is advisory — it records the intent so an admin editing Super Admin knows
 * which stages deserve a premium model. Only MINER_INVENTIVE_STEP and
 * MINER_BRIEF are premium: an obviousness argument and the brief that carries it
 * are the two places where reasoning quality is the product.
 *
 * maxTokensIn/maxTokensOut are set here rather than mirrored from the source
 * stage, which is the one deliberate difference from add-whitespace-stages.js.
 * The mirror sources are short novelty-query prompts; the miner's prompts are
 * not. MINER_EXTRACT sends two patents' text per call and MINER_INVENTIVE_STEP
 * sends a closest-prior-art passage plus up to five secondary passages. The
 * gateway pre-flights against the configured maxTokensIn and FAILS the call when
 * it is exceeded (gateway.ts preflightCheck), and the miner swallows that as
 * "one batch failed" — so an inherited 4k ceiling would let a stage report
 * success having read nothing at all.
 */
const STAGES = [
  {
    task: 'IM_EXTRACT',
    taskName: 'Invention Miner: Signal Extraction',
    code: 'MINER_EXTRACT',
    displayName: 'Invention Miner: Signal Extraction',
    description:
      'Reads patent text in batches and extracts admitted problems, mechanisms, teaching-away statements and claimed scope. High volume, structured output.',
    tier: 'cheap',
    maxTokensIn: 12000,
    maxTokensOut: 4000,
    sortOrder: 0,
  },
  {
    task: 'IM_EXTRACT',
    taskName: 'Invention Miner: Signal Extraction',
    code: 'MINER_LEAD_TITLES',
    displayName: 'Invention Miner: Lead Naming',
    description:
      'Names a candidate lead from the engine output that produced it. Short prompt, short answer — the engines are SQL, only the label is a model call.',
    tier: 'cheap',
    maxTokensIn: 4000,
    maxTokensOut: 2000,
    sortOrder: 1,
  },
  {
    task: 'IM_GATE',
    taskName: 'Invention Miner: Grant-Worthiness Gate',
    code: 'MINER_INVENTIVE_STEP',
    displayName: 'Invention Miner: Inventive Step',
    description:
      'EPO problem-solution pass over the closest prior art plus secondary references. PREMIUM — this call decides whether a lead is worth an attorney reading it.',
    tier: 'premium',
    maxTokensIn: 24000,
    maxTokensOut: 4000,
    sortOrder: 2,
  },
  {
    task: 'IM_GATE',
    taskName: 'Invention Miner: Grant-Worthiness Gate',
    code: 'MINER_EXCLUSION_SCREEN',
    displayName: 'Invention Miner: Exclusion Screen',
    description:
      'Screens a surviving lead against statutory exclusions (s.3 and equivalents). Reads the lead, not the corpus, so it stays mid-tier.',
    tier: 'mid',
    maxTokensIn: 8000,
    maxTokensOut: 2000,
    sortOrder: 3,
  },
  {
    task: 'IM_BRIEF',
    taskName: 'Invention Miner: Invention Brief',
    code: 'MINER_BRIEF',
    displayName: 'Invention Miner: Invention Brief',
    description:
      'Writes the invention brief: problem, mechanism, delta over the closest art, inventive-step argument and a drafted claim set. PREMIUM — this is the deliverable.',
    tier: 'premium',
    maxTokensIn: 24000,
    maxTokensOut: 6000,
    sortOrder: 4,
  },
]

/** Mirror model config from an existing stage so plans are not left blank. */
const SOURCE_STAGE_BY_TIER = {
  cheap: 'NOVELTY_QUERY_GENERATION',
  mid: 'NOVELTY_FEATURE_ANALYSIS',
  premium: 'NOVELTY_CONSOLIDATED_ANALYSIS',
}

async function main() {
  // Feature carries only code/name/unit — no description or isActive columns.
  // `unit` must match FEATURE_DEFINITIONS in src/lib/plans/catalog.ts.
  const feature = await prisma.feature.upsert({
    where: { code: 'INVENTION_MINER' },
    update: { name: 'Invention Miner', unit: 'operations' },
    create: { code: 'INVENTION_MINER', name: 'Invention Miner', unit: 'operations' },
  })
  console.log(`Feature ready: ${feature.code} (unit: ${feature.unit})`)

  // Resolve the mirror sources once. A missing source is not fatal — it just
  // means those plans need manual configuration in Super Admin.
  const sourceStages = {}
  for (const [tier, code] of Object.entries(SOURCE_STAGE_BY_TIER)) {
    const stage = await prisma.workflowStage.findUnique({ where: { code } })
    if (stage) {
      sourceStages[tier] = stage
    } else {
      console.warn(`  ! Mirror source for "${tier}" tier not found (${code}) — those stages start unconfigured.`)
    }
  }

  let stagesReady = 0
  let configsCreated = 0

  for (const definition of STAGES) {
    await prisma.task.upsert({
      where: { code: definition.task },
      update: { name: definition.taskName, linkedFeatureId: feature.id },
      create: { code: definition.task, name: definition.taskName, linkedFeatureId: feature.id },
    })

    const stage = await prisma.workflowStage.upsert({
      where: { code: definition.code },
      update: {
        displayName: definition.displayName,
        featureCode: 'INVENTION_MINER',
        description: definition.description,
        isActive: true,
      },
      create: {
        code: definition.code,
        displayName: definition.displayName,
        featureCode: 'INVENTION_MINER',
        description: definition.description,
        sortOrder: definition.sortOrder,
        isActive: true,
      },
    })
    stagesReady += 1

    const source = sourceStages[definition.tier]
    if (!source) continue

    const sourceConfigs = await prisma.planStageModelConfig.findMany({
      where: { stageId: source.id, isActive: true },
    })
    for (const cfg of sourceConfigs) {
      const existing = await prisma.planStageModelConfig.findUnique({
        where: { planId_stageId: { planId: cfg.planId, stageId: stage.id } },
      })
      // Never re-write an existing row: an admin may have tuned it in Super Admin,
      // and this script has to be safe to re-run after that.
      if (existing) continue
      await prisma.planStageModelConfig.create({
        data: {
          planId: cfg.planId,
          stageId: stage.id,
          modelId: cfg.modelId,
          fallbackModelIds: cfg.fallbackModelIds,
          // Token ceilings come from the definition, not the mirror source. See the
          // note on STAGES above — inheriting a novelty-query ceiling here would
          // pre-flight-fail every real miner call.
          maxTokensIn: definition.maxTokensIn,
          maxTokensOut: definition.maxTokensOut,
          temperature: cfg.temperature,
          priority: cfg.priority,
          isActive: true,
        },
      })
      configsCreated += 1
    }
  }

  console.log(`Stages ready: ${stagesReady}`)
  console.log(`Plan/stage model configs created: ${configsCreated}`)
  console.log('')
  console.log('Review in Super Admin > LLM Config. Intended routing:')
  console.log('  cheap   -> MINER_EXTRACT, MINER_LEAD_TITLES')
  console.log('  mid     -> MINER_EXCLUSION_SCREEN')
  console.log('  premium -> MINER_INVENTIVE_STEP, MINER_BRIEF')
  console.log('')

  // Print what is actually in the database, not what we intended to write. A row an
  // admin has already tuned is left alone above, so this is the only honest report of
  // the ceilings the gateway will pre-flight against.
  console.log('Resolved token limits per plan (maxTokensIn / maxTokensOut):')
  for (const definition of STAGES) {
    const stage = await prisma.workflowStage.findUnique({
      where: { code: definition.code },
      include: {
        stageConfigs: { include: { plan: { select: { code: true } } } },
      },
    })
    const configs = (stage?.stageConfigs ?? []).sort((a, b) => a.plan.code.localeCompare(b.plan.code))
    console.log(`  ${definition.code} (${definition.tier}, intended ${definition.maxTokensIn}/${definition.maxTokensOut})`)
    if (configs.length === 0) {
      console.log('    ! no plan configured — resolution will fail closed for every plan')
      continue
    }
    for (const cfg of configs) {
      const drift = cfg.maxTokensIn !== definition.maxTokensIn || cfg.maxTokensOut !== definition.maxTokensOut ? '  <- differs from intended' : ''
      console.log(`    ${cfg.plan.code.padEnd(18)} ${String(cfg.maxTokensIn ?? 'null')} / ${String(cfg.maxTokensOut ?? 'null')}${drift}`)
    }
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
