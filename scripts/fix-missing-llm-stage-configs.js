#!/usr/bin/env node

/**
 * Backfill missing Super Admin LLM configs for active plans.
 *
 * Primary use case: deployments that have both BASIC_PLAN and legacy FREE_PLAN.
 * If tenants are assigned to one plan while Super Admin configured the other,
 * stage-coded LLM calls fail after strict model resolution is enabled.
 *
 * Usage:
 *   node scripts/fix-missing-llm-stage-configs.js
 *   node scripts/fix-missing-llm-stage-configs.js --source=ENTERPRISE_PLAN --target=FREE_PLAN
 *   node scripts/fix-missing-llm-stage-configs.js --source=BASIC_PLAN --targetId=cmjm...
 */

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

function argValue(name) {
  const prefix = `--${name}=`
  const arg = process.argv.slice(2).find(value => value.startsWith(prefix))
  return arg ? arg.slice(prefix.length).trim() : null
}

async function copyMissingStageConfigs(sourcePlan, targetPlan) {
  const sourceConfigs = await prisma.planStageModelConfig.findMany({
    where: { planId: sourcePlan.id, isActive: true },
    include: { stage: { select: { code: true } } }
  })

  let copied = 0
  for (const config of sourceConfigs) {
    const existing = await prisma.planStageModelConfig.findUnique({
      where: {
        planId_stageId: {
          planId: targetPlan.id,
          stageId: config.stageId
        }
      }
    })
    if (existing) continue

    await prisma.planStageModelConfig.create({
      data: {
        planId: targetPlan.id,
        stageId: config.stageId,
        modelId: config.modelId,
        fallbackModelIds: config.fallbackModelIds,
        maxTokensIn: config.maxTokensIn,
        maxTokensOut: config.maxTokensOut,
        temperature: config.temperature,
        isActive: true,
        priority: config.priority
      }
    })
    copied += 1
    console.log(`  stage ${config.stage.code}: ${sourcePlan.code} -> ${targetPlan.code}`)
  }
  return copied
}

async function copyMissingTaskConfigs(sourcePlan, targetPlan) {
  const sourceConfigs = await prisma.planTaskModelConfig.findMany({
    where: { planId: sourcePlan.id, isActive: true }
  })

  let copied = 0
  for (const config of sourceConfigs) {
    const existing = await prisma.planTaskModelConfig.findUnique({
      where: {
        planId_taskCode: {
          planId: targetPlan.id,
          taskCode: config.taskCode
        }
      }
    })
    if (existing) continue

    await prisma.planTaskModelConfig.create({
      data: {
        planId: targetPlan.id,
        taskCode: config.taskCode,
        modelId: config.modelId,
        fallbackModelIds: config.fallbackModelIds,
        maxTokensIn: config.maxTokensIn,
        maxTokensOut: config.maxTokensOut,
        temperature: config.temperature,
        isActive: true,
        priority: config.priority
      }
    })
    copied += 1
    console.log(`  task ${config.taskCode}: ${sourcePlan.code} -> ${targetPlan.code}`)
  }
  return copied
}

async function findPlan(codeOrId) {
  if (!codeOrId) return null
  return prisma.plan.findFirst({
    where: {
      OR: [
        { code: codeOrId },
        { id: codeOrId }
      ]
    }
  })
}

async function main() {
  const sourceCode = argValue('source')
  const targetCode = argValue('target')
  const sourceId = argValue('sourceId')
  const targetId = argValue('targetId')

  const pairs = []
  if (sourceCode || targetCode || sourceId || targetId) {
    const source = await findPlan(sourceCode || sourceId)
    const target = await findPlan(targetCode || targetId)
    if (!source || !target) {
      throw new Error(`Invalid source or target plan: source=${sourceCode || sourceId}, target=${targetCode || targetId}`)
    }
    pairs.push([source, target])
  } else {
    const [basic, free] = await Promise.all([
      findPlan('BASIC_PLAN'),
      findPlan('FREE_PLAN')
    ])

    if (basic && free) {
      pairs.push([basic, free], [free, basic])
    }
  }

  if (pairs.length === 0) {
    console.log('No plan pairs found to reconcile.')
    return
  }

  let totalStages = 0
  let totalTasks = 0
  for (const [source, target] of pairs) {
    console.log(`Reconciling ${source.code} -> ${target.code}`)
    totalStages += await copyMissingStageConfigs(source, target)
    totalTasks += await copyMissingTaskConfigs(source, target)
  }

  console.log(`Done. Copied ${totalStages} stage config(s) and ${totalTasks} task config(s).`)
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
