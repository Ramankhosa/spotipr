#!/usr/bin/env node

/**
 * PRODUCTION FIX: Complete Plan & Feature Setup
 * 
 * This script ensures:
 * 1. All plans exist (FREE_PLAN, PRO_PLAN, ENTERPRISE_PLAN, TRIAL)
 * 2. All features exist (including IDEATION)
 * 3. All plans have the correct features assigned
 * 4. All workflow stages exist for IDEATION
 * 5. All plans have model configs for IDEATION stages
 * 6. All tenants have a TenantPlan assigned
 * 
 * Safe to run multiple times (idempotent).
 * 
 * Usage: node scripts/fix-production-plans-complete.js
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// =============================================================================
// CONFIGURATION
// =============================================================================

const FEATURES = [
  { code: 'PRIOR_ART_SEARCH', name: 'Patent and Literature Search', unit: 'queries' },
  { code: 'PATENT_DRAFTING', name: 'AI-Assisted Patent Drafting', unit: 'tokens' },
  { code: 'DIAGRAM_GENERATION', name: 'Technical Diagram Generation', unit: 'diagrams' },
  { code: 'IDEA_BANK', name: 'Idea Bank Access', unit: 'reservations' },
  { code: 'PERSONA_SYNC', name: 'PersonaSync Style Learning', unit: 'trainings' },
  { code: 'IDEATION', name: 'Patent Ideation Engine', unit: 'sessions' }
]

const PLANS = [
  { code: 'FREE_PLAN', name: 'Basic Plan', cycle: 'MONTHLY', status: 'ACTIVE' },
  { code: 'PRO_PLAN', name: 'Professional Plan', cycle: 'MONTHLY', status: 'ACTIVE' },
  { code: 'ENTERPRISE_PLAN', name: 'Enterprise Plan', cycle: 'MONTHLY', status: 'ACTIVE' },
  { code: 'TRIAL', name: 'Trial Plan', cycle: 'MONTHLY', status: 'ACTIVE' }
]

// Feature quotas per plan
// NOTE: PRIOR_ART_SEARCH is for patent filing pipeline, NOVELTY_SEARCH is standalone feature (separate quotas)
const PLAN_FEATURES = {
  'FREE_PLAN': [
    { featureCode: 'PRIOR_ART_SEARCH', monthlyQuota: 50, dailyQuota: 10 },
    { featureCode: 'NOVELTY_SEARCH', monthlyQuota: 0, dailyQuota: 0 }, // Disabled for FREE plan
    { featureCode: 'PATENT_DRAFTING', monthlyQuota: 1000, dailyQuota: 100 }
  ],
  'PRO_PLAN': [
    { featureCode: 'PRIOR_ART_SEARCH', monthlyQuota: 1000, dailyQuota: 100 },
    { featureCode: 'NOVELTY_SEARCH', monthlyQuota: 5, dailyQuota: 2 }, // Very limited to conserve PQAI API
    { featureCode: 'PATENT_DRAFTING', monthlyQuota: 10000, dailyQuota: 1000 },
    { featureCode: 'DIAGRAM_GENERATION', monthlyQuota: 200, dailyQuota: 40 },
    { featureCode: 'IDEA_BANK', monthlyQuota: 50, dailyQuota: 10 },
    { featureCode: 'IDEATION', monthlyQuota: 500, dailyQuota: 50, monthlyTokenLimit: 5000000, dailyTokenLimit: 500000 }
  ],
  'ENTERPRISE_PLAN': [
    { featureCode: 'PRIOR_ART_SEARCH', monthlyQuota: 5000, dailyQuota: 500 },
    { featureCode: 'NOVELTY_SEARCH', monthlyQuota: 20, dailyQuota: 5 }, // Limited to conserve PQAI API
    { featureCode: 'PATENT_DRAFTING', monthlyQuota: 50000, dailyQuota: 5000 },
    { featureCode: 'DIAGRAM_GENERATION', monthlyQuota: 500, dailyQuota: 100 },
    { featureCode: 'IDEA_BANK', monthlyQuota: 200, dailyQuota: 50 },
    { featureCode: 'PERSONA_SYNC', monthlyQuota: 50, dailyQuota: 10 },
    { featureCode: 'IDEATION', monthlyQuota: 2000, dailyQuota: 200, monthlyTokenLimit: 20000000, dailyTokenLimit: 2000000 }
  ],
  'TRIAL': [
    { featureCode: 'PRIOR_ART_SEARCH', monthlyQuota: 100, dailyQuota: 20 },
    { featureCode: 'NOVELTY_SEARCH', monthlyQuota: 3, dailyQuota: 1 }, // Very limited for trial
    { featureCode: 'PATENT_DRAFTING', monthlyQuota: 5000, dailyQuota: 500 },
    { featureCode: 'DIAGRAM_GENERATION', monthlyQuota: 50, dailyQuota: 10 },
    { featureCode: 'IDEA_BANK', monthlyQuota: 20, dailyQuota: 5 },
    { featureCode: 'IDEATION', monthlyQuota: 100, dailyQuota: 20, monthlyTokenLimit: 2000000, dailyTokenLimit: 200000 }
  ]
}

// IDEATION workflow stages and their model assignments
const IDEATION_STAGES = [
  { code: 'IDEATION_NORMALIZE', name: 'Seed Normalization', model: 'gemini-2.5-flash-lite', maxIn: 20000, maxOut: 8192 },
  { code: 'IDEATION_CLASSIFY', name: 'Classification', model: 'gemini-2.5-flash-lite', maxIn: 20000, maxOut: 8192 },
  { code: 'IDEATION_CONTRADICTION_MAPPING', name: 'Contradiction Mapping', model: 'gemini-2.5-pro', maxIn: 30000, maxOut: 8192 },
  { code: 'IDEATION_EXPAND', name: 'Dimension Expansion', model: 'gemini-2.5-flash-lite', maxIn: 30000, maxOut: 8192 },
  { code: 'IDEATION_OBVIOUSNESS_FILTER', name: 'Obviousness Filter', model: 'gemini-2.5-pro', maxIn: 30000, maxOut: 8192 },
  { code: 'IDEATION_GENERATE', name: 'Idea Generation', model: 'gemini-2.5-pro', maxIn: 40000, maxOut: 16000 },
  { code: 'IDEATION_NOVELTY', name: 'Novelty Assessment', model: 'gemini-2.5-pro', maxIn: 50000, maxOut: 16000 }
]

// =============================================================================
// MAIN SCRIPT
// =============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  PRODUCTION FIX: Complete Plan & Feature Setup')
  console.log('═══════════════════════════════════════════════════════════════\n')

  try {
    // Step 1: Ensure all features exist
    console.log('1️⃣  Ensuring features exist...\n')
    const featuresByCode = {}
    for (const def of FEATURES) {
      const feature = await prisma.feature.upsert({
        where: { code: def.code },
        update: { name: def.name, unit: def.unit },
        create: def
      })
      featuresByCode[def.code] = feature
      console.log(`   ✅ ${def.code}`)
    }

    // Step 2: Ensure all plans exist
    console.log('\n2️⃣  Ensuring plans exist...\n')
    const plansByCode = {}
    for (const def of PLANS) {
      const plan = await prisma.plan.upsert({
        where: { code: def.code },
        update: { name: def.name, cycle: def.cycle, status: def.status },
        create: def
      })
      plansByCode[def.code] = plan
      console.log(`   ✅ ${def.code} (${plan.id})`)
    }

    // Step 3: Ensure all plan features are assigned
    console.log('\n3️⃣  Ensuring plan features are assigned...\n')
    for (const [planCode, features] of Object.entries(PLAN_FEATURES)) {
      const plan = plansByCode[planCode]
      if (!plan) {
        console.log(`   ⚠️  Plan ${planCode} not found, skipping`)
        continue
      }
      
      console.log(`   ${planCode}:`)
      for (const featureDef of features) {
        const feature = featuresByCode[featureDef.featureCode]
        if (!feature) {
          console.log(`      ⚠️  Feature ${featureDef.featureCode} not found`)
          continue
        }
        
        const updateData = {
          monthlyQuota: featureDef.monthlyQuota,
          dailyQuota: featureDef.dailyQuota
        }
        if (featureDef.monthlyTokenLimit) updateData.monthlyTokenLimit = featureDef.monthlyTokenLimit
        if (featureDef.dailyTokenLimit) updateData.dailyTokenLimit = featureDef.dailyTokenLimit
        
        await prisma.planFeature.upsert({
          where: {
            planId_featureId: { planId: plan.id, featureId: feature.id }
          },
          update: updateData,
          create: {
            planId: plan.id,
            featureId: feature.id,
            ...updateData
          }
        })
        console.log(`      ✅ ${featureDef.featureCode}`)
      }
    }

    // Step 4: Ensure IDEATION workflow stages exist
    console.log('\n4️⃣  Ensuring IDEATION workflow stages exist...\n')
    const stagesByCode = {}
    for (const stageDef of IDEATION_STAGES) {
      let stage = await prisma.workflowStage.findUnique({
        where: { code: stageDef.code }
      })
      
      if (!stage) {
        stage = await prisma.workflowStage.create({
          data: {
            code: stageDef.code,
            name: stageDef.name,
            featureCode: 'IDEATION',
            isActive: true
          }
        })
        console.log(`   ✅ Created ${stageDef.code}`)
      } else {
        // Ensure it's active
        await prisma.workflowStage.update({
          where: { code: stageDef.code },
          data: { isActive: true }
        })
        console.log(`   ✅ ${stageDef.code} (exists)`)
      }
      stagesByCode[stageDef.code] = stage
    }

    // Step 5: Ensure model configs for IDEATION stages on all plans
    console.log('\n5️⃣  Ensuring model configs for IDEATION stages...\n')
    
    // Get all available models
    const models = await prisma.lLMModel.findMany()
    const modelsByCode = {}
    for (const m of models) {
      modelsByCode[m.code] = m
    }
    
    if (models.length === 0) {
      console.log('   ⚠️  No LLM models found in database!')
      console.log('   → Run the LLM models seed script first: node Seed/seed-llm-models.js')
    } else {
      console.log(`   Found ${models.length} LLM models: ${models.map(m => m.code).join(', ')}`)
      
      // Configure for all plans that have IDEATION feature
      const plansWithIdeation = ['PRO_PLAN', 'ENTERPRISE_PLAN', 'TRIAL']
      
      for (const planCode of plansWithIdeation) {
        const plan = plansByCode[planCode]
        if (!plan) continue
        
        console.log(`\n   ${planCode}:`)
        
        for (const stageDef of IDEATION_STAGES) {
          const stage = stagesByCode[stageDef.code]
          if (!stage) continue
          
          let model = modelsByCode[stageDef.model]
          
          // Fallback to any available model
          if (!model && models.length > 0) {
            // Try gemini-2.5-flash-lite or any flash model
            model = models.find(m => m.code.includes('flash')) || models[0]
            console.log(`      ⚠️  ${stageDef.model} not found, using ${model?.code}`)
          }
          
          if (!model) {
            console.log(`      ❌ No model available for ${stageDef.code}`)
            continue
          }
          
          await prisma.planStageModelConfig.upsert({
            where: {
              planId_stageId: { planId: plan.id, stageId: stage.id }
            },
            update: {
              modelId: model.id,
              maxTokensIn: stageDef.maxIn,
              maxTokensOut: stageDef.maxOut,
              isActive: true
            },
            create: {
              planId: plan.id,
              stageId: stage.id,
              modelId: model.id,
              maxTokensIn: stageDef.maxIn,
              maxTokensOut: stageDef.maxOut,
              isActive: true
            }
          })
          console.log(`      ✅ ${stageDef.code} → ${model.code}`)
        }
      }
    }

    // Step 6: Fix tenants without TenantPlan
    console.log('\n6️⃣  Checking tenants without TenantPlan...\n')
    
    const tenantsWithoutPlan = await prisma.tenant.findMany({
      where: {
        NOT: {
          tenantPlans: {
            some: { status: 'ACTIVE' }
          }
        }
      }
    })
    
    if (tenantsWithoutPlan.length === 0) {
      console.log('   ✅ All tenants have active TenantPlan')
    } else {
      console.log(`   Found ${tenantsWithoutPlan.length} tenant(s) without active TenantPlan:`)
      
      // Default to ENTERPRISE_PLAN for missing tenants (safer for production)
      const defaultPlan = plansByCode['ENTERPRISE_PLAN'] || plansByCode['FREE_PLAN']
      
      for (const tenant of tenantsWithoutPlan) {
        // Try to determine the right plan from ATI token
        const atiToken = await prisma.aTIToken.findFirst({
          where: { tenantId: tenant.id },
          orderBy: { createdAt: 'desc' }
        })
        
        let targetPlan = defaultPlan
        if (atiToken?.planTier) {
          const tierUpper = atiToken.planTier.toUpperCase().replace(/[\s-]+/g, '_')
          const aliases = {
            'ENTERPRISE': plansByCode['ENTERPRISE_PLAN'],
            'ENTERPRISE_PLAN': plansByCode['ENTERPRISE_PLAN'],
            'PRO': plansByCode['PRO_PLAN'],
            'PRO_PLAN': plansByCode['PRO_PLAN'],
            'FREE': plansByCode['FREE_PLAN'],
            'FREE_PLAN': plansByCode['FREE_PLAN'],
            'BASIC': plansByCode['FREE_PLAN'],
            'TRIAL': plansByCode['TRIAL']
          }
          targetPlan = aliases[tierUpper] || defaultPlan
        }
        
        await prisma.tenantPlan.create({
          data: {
            tenantId: tenant.id,
            planId: targetPlan.id,
            status: 'ACTIVE',
            effectiveFrom: new Date()
          }
        })
        console.log(`   ✅ ${tenant.name} (${tenant.atiId}) → ${targetPlan.code}`)
      }
    }

    // Step 7: Summary
    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('  ✅ PRODUCTION FIX COMPLETE')
    console.log('═══════════════════════════════════════════════════════════════\n')
    
    // Show final state
    const planCount = await prisma.plan.count({ where: { status: 'ACTIVE' } })
    const featureCount = await prisma.feature.count()
    const stageCount = await prisma.workflowStage.count({ where: { featureCode: 'IDEATION' } })
    const tenantPlanCount = await prisma.tenantPlan.count({ where: { status: 'ACTIVE' } })
    
    console.log(`   Active Plans: ${planCount}`)
    console.log(`   Features: ${featureCount}`)
    console.log(`   IDEATION Stages: ${stageCount}`)
    console.log(`   Active TenantPlans: ${tenantPlanCount}`)
    console.log('')
    console.log('Next steps:')
    console.log('1. Users should log out and log back in to get fresh JWT')
    console.log('2. New signups should now get correct plan assignment')
    console.log('')

  } catch (error) {
    console.error('\n❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

