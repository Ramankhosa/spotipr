/**
 * Whitespace Studio setup: registers the WHITESPACE_ANALYSIS feature, its six
 * LLM tasks, and the workflow stages that Super Admin > LLM Config edits.
 *
 * Why this is needed: stage-coded model resolution is FAIL-CLOSED
 * (src/lib/metering/model-resolver.ts throws when no PlanStageModelConfig row
 * exists for the plan + stage). The module falls back to task-only routing so it
 * works without this script, but then every stage shares one model and the
 * cost-routing design — cheap for scope/labels, mid for extraction, premium for
 * hypothesis generation and red-team — cannot be expressed. Run this to get
 * real per-stage control.
 *
 * Seeds each plan's stage rows by mirroring an existing configured stage, so
 * plans start with a working model rather than a blank row.
 *
 * Idempotent. Run with: node scripts/add-whitespace-stages.js
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

/**
 * tier is advisory — it records the intent from the plan (Section 9.7) so an
 * admin editing Super Admin knows which stages deserve a premium model.
 * Only WS_HYPOTHESIZE and WS_REDTEAM are premium; reasoning quality is the
 * product at exactly those two stages and nowhere else.
 */
const STAGES = [
  {
    task: 'WS_SCOPE',
    taskName: 'Whitespace: Scope Compile',
    code: 'WHITESPACE_SCOPE_COMPILE',
    displayName: 'Whitespace: Scope Compile',
    description: 'Turns a plain-language brief into a reviewable research scope (concepts, synonyms, CPC candidates, exclusions, stated assumptions).',
    tier: 'cheap',
    sortOrder: 0,
  },
  {
    task: 'WS_CLUSTER_LABEL',
    taskName: 'Whitespace: Cluster Labelling',
    code: 'WHITESPACE_CLUSTER_LABEL',
    displayName: 'Whitespace: Cluster Labelling',
    description: 'Names a technology cluster from its medoid documents and CPC mix.',
    tier: 'cheap',
    sortOrder: 1,
  },
  {
    task: 'WS_CLAIM_ELEMENTS',
    taskName: 'Whitespace: Claim-Element Extraction',
    code: 'WHITESPACE_CLAIM_ELEMENTS',
    displayName: 'Whitespace: Claim-Element Extraction',
    description: 'Extracts claim elements from retrieved independent claims. High volume, structured output.',
    tier: 'mid',
    sortOrder: 2,
  },
  {
    task: 'WS_HYPOTHESIZE',
    taskName: 'Whitespace: Hypothesis Generation',
    code: 'WHITESPACE_HYPOTHESIZE',
    displayName: 'Whitespace: Hypothesis Generation',
    description: 'Synthesises whitespace hypotheses from signals and claim-element rarity. PREMIUM — reasoning quality is the product here.',
    tier: 'premium',
    sortOrder: 3,
  },
  {
    task: 'WS_VALIDATE',
    taskName: 'Whitespace: Validation Mapping',
    code: 'WHITESPACE_VALIDATE',
    displayName: 'Whitespace: Validation Mapping',
    description: 'Element-maps disproof candidates against a hypothesis during adversarial validation.',
    tier: 'mid',
    sortOrder: 4,
  },
  {
    task: 'WS_REDTEAM',
    taskName: 'Whitespace: Red Team',
    code: 'WHITESPACE_REDTEAM',
    displayName: 'Whitespace: Red Team',
    description: 'Adversarial pass: reads the surviving evidence and names the strongest remaining attack. PREMIUM.',
    tier: 'premium',
    sortOrder: 5,
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
    where: { code: 'WHITESPACE_ANALYSIS' },
    update: { name: 'Whitespace Studio', unit: 'analyses' },
    create: { code: 'WHITESPACE_ANALYSIS', name: 'Whitespace Studio', unit: 'analyses' },
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
        featureCode: 'WHITESPACE_ANALYSIS',
        description: definition.description,
        isActive: true,
      },
      create: {
        code: definition.code,
        displayName: definition.displayName,
        featureCode: 'WHITESPACE_ANALYSIS',
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
      if (existing) continue
      await prisma.planStageModelConfig.create({
        data: {
          planId: cfg.planId,
          stageId: stage.id,
          modelId: cfg.modelId,
          fallbackModelIds: cfg.fallbackModelIds,
          maxTokensIn: cfg.maxTokensIn,
          maxTokensOut: cfg.maxTokensOut,
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
  console.log('  cheap   -> WHITESPACE_SCOPE_COMPILE, WHITESPACE_CLUSTER_LABEL')
  console.log('  mid     -> WHITESPACE_CLAIM_ELEMENTS, WHITESPACE_VALIDATE')
  console.log('  premium -> WHITESPACE_HYPOTHESIZE, WHITESPACE_REDTEAM')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
