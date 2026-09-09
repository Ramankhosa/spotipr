/**
 * Claim strategy stage: registers the DRAFT_CLAIM_STRATEGY workflow stage so
 * Super Admin > LLM Config can route it, and so stage-coded model resolution
 * finds a row for every plan.
 *
 * Why this is needed: stage-coded resolution is FAIL-CLOSED (src/lib/metering/
 * model-resolver.ts throws when no PlanStageModelConfig row exists for the plan
 * + stage). Run this BEFORE deploying code that calls the stage, or every claim
 * strategy run fails with CONFIGURATION_ERROR and the claims stage falls back
 * to drafting without a strategy.
 *
 * The strategy is structured planning (about 800 tokens of JSON), not
 * drafting, so it mirrors DRAFT_CLAIM_REFINEMENT's model per plan: the fast,
 * non-reasoning tier. Mirroring the claims model (a thinking model) put a
 * 60-90 second call on the path; do not do that again.
 *
 * Idempotent. Run with: node scripts/add-claim-strategy-stage.js
 * To re-point rows created earlier (e.g. ones mirrored from the reasoning
 * model): node scripts/add-claim-strategy-stage.js --update-model
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const STAGE_CODE = 'DRAFT_CLAIM_STRATEGY'
const MIRROR_SOURCE = 'DRAFT_CLAIM_REFINEMENT'
const MAX_TOKENS_OUT = 6000
const UPDATE_MODEL = process.argv.includes('--update-model')

async function main() {
  const stage = await prisma.workflowStage.upsert({
    where: { code: STAGE_CODE },
    update: {
      displayName: 'Claim Strategy',
      featureCode: 'PATENT_DRAFTING',
      description: 'Plans the claim set before drafting: inventive concept, essential features, category plan per office, eligibility mitigation, terminology. Runs in the background after Stage 0.',
      isActive: true,
    },
    create: {
      code: STAGE_CODE,
      displayName: 'Claim Strategy',
      featureCode: 'PATENT_DRAFTING',
      description: 'Plans the claim set before drafting: inventive concept, essential features, category plan per office, eligibility mitigation, terminology. Runs in the background after Stage 0.',
      isActive: true,
      sortOrder: 2,
    },
  })
  console.log(`Stage ready: ${stage.code}`)

  const source = await prisma.workflowStage.findUnique({ where: { code: MIRROR_SOURCE } })
  if (!source) {
    console.warn(`! Mirror source ${MIRROR_SOURCE} not found — configure this stage manually in Super Admin.`)
    await prisma.$disconnect()
    return
  }

  const sourceConfigs = await prisma.planStageModelConfig.findMany({ where: { stageId: source.id } })
  let created = 0
  let updated = 0
  for (const config of sourceConfigs) {
    const { id, stageId, createdAt, updatedAt, ...rest } = config
    const data = {
      ...rest,
      stageId: stage.id,
      ...(typeof rest.maxTokensOut === 'number' ? { maxTokensOut: Math.min(rest.maxTokensOut, MAX_TOKENS_OUT) } : {}),
    }
    const existing = await prisma.planStageModelConfig.findFirst({
      where: { planId: config.planId, stageId: stage.id },
    })
    if (existing) {
      if (!UPDATE_MODEL) continue
      const { planId, ...updates } = data
      await prisma.planStageModelConfig.update({ where: { id: existing.id }, data: updates })
      updated++
      continue
    }
    await prisma.planStageModelConfig.create({ data })
    created++
  }
  console.log(`Mirrored ${created} new and re-pointed ${updated} existing plan stage config(s) from ${MIRROR_SOURCE} (${sourceConfigs.length} plan(s) checked).`)
  if (!UPDATE_MODEL && created === 0) {
    console.log('All plans already had a row. Re-run with --update-model to re-point them to the fast tier.')
  }

  await prisma.$disconnect()
}

main().catch(async (error) => {
  console.error(error)
  await prisma.$disconnect()
  process.exit(1)
})
