/**
 * Seed script for Ideation Engine workflow stages
 * 
 * Run with: npx tsx scripts/seed-ideation-workflow-stages.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🚀 Seeding Ideation workflow stages...')

  // Ideation workflow stages - NEW PIPELINE (SRS-compliant)
  // Pipeline: SEED_INPUT → SEMANTIC_GROUNDING → INVENTIVE_FRAMING → 
  //   DIMENSION_DISCOVERY → DIMENSION_EXPANSION → IDEA_GENERATION → PRELIMINARY_NOVELTY_ASSESSMENT
  const ideationStages = [
    {
      code: 'IDEATION_NORMALIZE',
      displayName: 'Seed Normalization',
      featureCode: 'IDEATION',
      description: 'Semantic Grounding: understands the idea WITHOUT inventing, reframing, or solving. Extracts core entity, user intent, constraints, assumptions, and clarification questions.',
      sortOrder: 1,
    },
    {
      code: 'IDEATION_CLASSIFY',
      displayName: 'Invention Classification',
      featureCode: 'IDEATION',
      description: 'Inventive Framing: identifies genuine inventive tensions ONLY if they exist. Does NOT force TRIZ-style conflicts.',
      sortOrder: 2,
    },
    {
      code: 'IDEATION_CONTRADICTION_MAPPING',
      displayName: 'Contradiction Mapping (Stage 2.5)',
      featureCode: 'IDEATION',
      description: '⚠️ LEGACY - No longer used. Contradiction detection moved to Inventive Framing stage.',
      sortOrder: 3,
    },
    {
      code: 'IDEATION_EXPAND',
      displayName: 'Dimension Expansion',
      featureCode: 'IDEATION',
      description: 'Dimension Discovery & Expansion: discovers invention-specific dimensions (not from templates) and generates assumption-breaking moves (REMOVE | INVERT | DECOUPLE | RELOCATE | DELAY).',
      sortOrder: 4,
    },
    {
      code: 'IDEATION_OBVIOUSNESS_FILTER',
      displayName: 'Obviousness Filter (Stage 3.5)',
      featureCode: 'IDEATION',
      description: '⚠️ LEGACY - No longer used. Obviousness gating logic has been removed per SRS.',
      sortOrder: 5,
    },
    {
      code: 'IDEATION_GENERATE',
      displayName: 'Idea Frame Generation',
      featureCode: 'IDEATION',
      description: 'Mechanism-Pure Idea Generation: generates patent ideas with EXACTLY ONE causal mechanism. Ideas with multiple mechanisms are rejected.',
      sortOrder: 6,
    },
    {
      code: 'IDEATION_NOVELTY',
      displayName: 'Novelty Assessment',
      featureCode: 'IDEATION',
      description: 'Preliminary Novelty Assessment (LLM-only): assesses conceptual originality and novelty risk. NO patent databases searched. NO legal novelty claims.',
      sortOrder: 7,
    },
  ]

  for (const stage of ideationStages) {
    await prisma.workflowStage.upsert({
      where: { code: stage.code },
      update: {
        displayName: stage.displayName,
        featureCode: stage.featureCode,
        description: stage.description,
        sortOrder: stage.sortOrder,
        isActive: true,
      },
      create: stage,
    })
    console.log(`  ✅ Created/updated stage: ${stage.code}`)
  }

  // Get the default model (or create mapping for plans)
  const defaultModel = await prisma.lLMModel.findFirst({
    where: { isDefault: true, isActive: true },
  })

  if (!defaultModel) {
    console.log('⚠️  No default LLM model found. Skipping plan-stage configuration.')
    console.log('   Run the LLM model seeding script first, then re-run this script.')
  } else {
    // Get all active plans
    const plans = await prisma.plan.findMany({
      where: { status: 'ACTIVE' },
    })

    console.log(`\n📋 Configuring ${plans.length} plans with ideation stages...`)

    for (const plan of plans) {
      // Get lightweight model for frequent tasks
      const lightweightModel = await prisma.lLMModel.findFirst({
        where: {
          OR: [
            { code: { contains: 'flash' } },
            { code: { contains: 'mini' } },
            { code: { contains: 'haiku' } },
          ],
          isActive: true,
        },
      }) || defaultModel

      // Get advanced model for heavy tasks
      const advancedModel = await prisma.lLMModel.findFirst({
        where: {
          OR: [
            { code: { contains: 'pro' } },
            { code: { contains: 'sonnet' } },
            { code: { contains: 'gpt-4o' } },
          ],
          isActive: true,
        },
      }) || defaultModel

      for (const stage of ideationStages) {
        const workflowStage = await prisma.workflowStage.findUnique({
          where: { code: stage.code },
        })

        if (!workflowStage) continue

        // Use lightweight model for normalize, classify, contradiction mapping, expand, obviousness filter
        // Use advanced model for generate, novelty (heavy reasoning tasks)
        const modelToUse = ['IDEATION_GENERATE', 'IDEATION_NOVELTY'].includes(stage.code)
          ? advancedModel
          : lightweightModel

        await prisma.planStageModelConfig.upsert({
          where: {
            planId_stageId: {
              planId: plan.id,
              stageId: workflowStage.id,
            },
          },
          update: {
            modelId: modelToUse.id,
            maxTokensIn: stage.code === 'IDEATION_GENERATE' ? 8000 : 4000,
            maxTokensOut: stage.code === 'IDEATION_GENERATE' ? 8192 : 4096,
            temperature: 0.7,
            isActive: true,
          },
          create: {
            planId: plan.id,
            stageId: workflowStage.id,
            modelId: modelToUse.id,
            maxTokensIn: stage.code === 'IDEATION_GENERATE' ? 8000 : 4000,
            maxTokensOut: stage.code === 'IDEATION_GENERATE' ? 8192 : 4096,
            temperature: 0.7,
            isActive: true,
          },
        })
      }

      console.log(`  ✅ Configured plan: ${plan.name}`)
    }
  }

  // Ensure the IDEATION feature exists
  const ideationFeature = await prisma.feature.upsert({
    where: { code: 'IDEATION' },
    update: {},
    create: {
      code: 'IDEATION',
      name: 'Patent Ideation Engine',
      unit: 'sessions',
    },
  })
  console.log(`\n✅ Feature: ${ideationFeature.code}`)

  // Create ideation tasks - names reflect new SRS pipeline
  const tasks = [
    { code: 'IDEATION_NORMALIZE', name: 'Semantic Grounding' },
    { code: 'IDEATION_CLASSIFY', name: 'Inventive Framing' },
    { code: 'IDEATION_CONTRADICTION_MAPPING', name: 'Contradiction Mapping (LEGACY)' },
    { code: 'IDEATION_EXPAND', name: 'Dimension Discovery & Expansion' },
    { code: 'IDEATION_OBVIOUSNESS_FILTER', name: 'Obviousness Filter (LEGACY)' },
    { code: 'IDEATION_GENERATE', name: 'Mechanism-Pure Idea Generation' },
    { code: 'IDEATION_NOVELTY', name: 'Preliminary Novelty Assessment' },
  ]

  for (const task of tasks) {
    await prisma.task.upsert({
      where: { code: task.code as any },
      update: {
        name: task.name,
        linkedFeatureId: ideationFeature.id,
      },
      create: {
        code: task.code as any,
        name: task.name,
        linkedFeatureId: ideationFeature.id,
      },
    })
    console.log(`  ✅ Task: ${task.code}`)
  }

  console.log('\n✨ Ideation workflow stages seeded successfully!')
}

main()
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

