/**
 * Prior-Art Studio setup: registers the "Advanced Manual Search Query Generator"
 * LLM task + workflow stage under NOVELTY_SEARCH, and gives every plan that has
 * a model configured for NOVELTY_QUERY_GENERATION the same model for the new
 * stage (stage-coded model resolution is fail-closed, so each plan needs a row).
 *
 * Idempotent. Run with: node scripts/add-advanced-manual-search-stage.js
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const feature = await prisma.feature.findUnique({ where: { code: 'NOVELTY_SEARCH' } })
  if (!feature) throw new Error('NOVELTY_SEARCH feature not found — run the feature seeds first.')

  const task = await prisma.task.upsert({
    where: { code: 'LLM7_ADVANCED_MANUAL_SEARCH' },
    update: { name: 'Advanced Manual Search Query Generator', linkedFeatureId: feature.id },
    create: {
      code: 'LLM7_ADVANCED_MANUAL_SEARCH',
      name: 'Advanced Manual Search Query Generator',
      linkedFeatureId: feature.id,
    },
  })
  console.log(`Task ready: ${task.code}`)

  const stage = await prisma.workflowStage.upsert({
    where: { code: 'ADVANCED_MANUAL_SEARCH_QUERY_GENERATOR' },
    update: {
      displayName: 'Advanced Manual Search Query Generator',
      featureCode: 'NOVELTY_SEARCH',
      isActive: true,
    },
    create: {
      code: 'ADVANCED_MANUAL_SEARCH_QUERY_GENERATOR',
      displayName: 'Advanced Manual Search Query Generator',
      featureCode: 'NOVELTY_SEARCH',
      description:
        'Prior-Art Studio: draft the query canvas (concept blocks, synonyms, CPCs, claim elements) from an invention description',
      sortOrder: 0,
      isActive: true,
    },
  })
  console.log(`Stage ready: ${stage.code}`)

  // Mirror each plan's NOVELTY_QUERY_GENERATION model config onto the new stage.
  const sourceStage = await prisma.workflowStage.findUnique({ where: { code: 'NOVELTY_QUERY_GENERATION' } })
  if (!sourceStage) {
    console.warn('NOVELTY_QUERY_GENERATION stage not found — configure plan models for the new stage in Super Admin.')
    return
  }
  const sourceConfigs = await prisma.planStageModelConfig.findMany({ where: { stageId: sourceStage.id, isActive: true } })
  let created = 0
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
        maxTokensIn: cfg.maxTokensIn ?? 20000,
        maxTokensOut: cfg.maxTokensOut ?? 8000,
        temperature: cfg.temperature ?? 0.4,
        isActive: true,
      },
    })
    created += 1
  }
  console.log(`Plan stage configs mirrored from NOVELTY_QUERY_GENERATION: ${created} created, ${sourceConfigs.length - created} already present.`)
}

main()
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
