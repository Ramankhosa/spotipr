/**
 * Filing forms setup: registers the FILING_INVENTOR_PARSE task and its workflow stage so
 * Super Admin > LLM Config can route it, and so stage-coded model resolution finds a row.
 *
 * Why this is needed: stage-coded resolution is FAIL-CLOSED (src/lib/metering/
 * model-resolver.ts throws when no PlanStageModelConfig row exists for the plan + stage).
 * Without this the inventor extractor falls back to task-only routing, which works but
 * cannot be tuned per plan.
 *
 * This is cheap, mechanical extraction — a small model is the right default, which is why
 * it mirrors the same source stage the other "cheap" tier stages use.
 *
 * The task is linked to PATENT_DRAFTING rather than getting its own feature: filing forms
 * accompany a draft, and an attorney who can draft can already produce the paperwork.
 *
 * Idempotent. Run with: node scripts/add-filing-stages.js
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const TASK = 'FILING_INVENTOR_PARSE'
const STAGE_CODE = 'FILING_INVENTOR_PARSE'
const MIRROR_SOURCE = 'NOVELTY_QUERY_GENERATION' // the established "cheap" tier source

async function main() {
  const feature = await prisma.feature.findUnique({ where: { code: 'PATENT_DRAFTING' } })
  if (!feature) {
    console.error('! PATENT_DRAFTING feature not found — seed the plan catalog first.')
    process.exit(1)
  }

  await prisma.task.upsert({
    where: { code: TASK },
    update: { name: 'Filing: Inventor Extraction', linkedFeatureId: feature.id },
    create: { code: TASK, name: 'Filing: Inventor Extraction', linkedFeatureId: feature.id },
  })
  console.log(`Task ready: ${TASK}`)

  const stage = await prisma.workflowStage.upsert({
    where: { code: STAGE_CODE },
    update: {
      displayName: 'Filing: Inventor Extraction',
      featureCode: 'PATENT_DRAFTING',
      description: 'Turns a pasted block of inventor details (e-mail, disclosure form, spreadsheet) into structured rows the attorney reviews before saving. Cheap, mechanical extraction.',
      isActive: true,
    },
    create: {
      code: STAGE_CODE,
      displayName: 'Filing: Inventor Extraction',
      featureCode: 'PATENT_DRAFTING',
      description: 'Turns a pasted block of inventor details (e-mail, disclosure form, spreadsheet) into structured rows the attorney reviews before saving. Cheap, mechanical extraction.',
      isActive: true,
      sortOrder: 90,
    },
  })
  console.log(`Stage ready: ${stage.code}`)

  // Mirror an existing configured stage so plans start with a working model rather than a
  // blank row that would fail closed at call time.
  const source = await prisma.workflowStage.findUnique({ where: { code: MIRROR_SOURCE } })
  if (!source) {
    console.warn(`! Mirror source ${MIRROR_SOURCE} not found — configure this stage manually in Super Admin.`)
    await prisma.$disconnect()
    return
  }

  const sourceConfigs = await prisma.planStageModelConfig.findMany({ where: { stageId: source.id } })
  let created = 0
  for (const config of sourceConfigs) {
    const existing = await prisma.planStageModelConfig.findFirst({
      where: { planId: config.planId, stageId: stage.id },
    })
    if (existing) continue
    const { id, stageId, createdAt, updatedAt, ...rest } = config
    await prisma.planStageModelConfig.create({ data: { ...rest, stageId: stage.id } })
    created++
  }
  console.log(`Mirrored ${created} plan stage config(s) from ${MIRROR_SOURCE}.`)

  await prisma.$disconnect()
}

main().catch(async err => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
