#!/usr/bin/env node

/**
 * Fix User Plan for Ideation Access
 * 
 * This script diagnoses and fixes user plan issues when IDEATION feature is not accessible.
 * 
 * Usage: node scripts/fix-user-plan-ideation.js <email>
 * 
 * What it does:
 * 1. Finds the user by email
 * 2. Checks their tenant and current plan assignment
 * 3. If plan doesn't have IDEATION, either:
 *    a. Updates the existing plan to include IDEATION feature
 *    b. Or reassigns the tenant to a plan that has IDEATION
 * 4. Ensures IDEATION workflow stages and model configs exist
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Model assignments for IDEATION stages
const IDEATION_STAGE_MODELS = {
  'IDEATION_NORMALIZE': 'gemini-2.5-flash-lite',
  'IDEATION_CLASSIFY': 'gemini-2.5-flash-lite',
  'IDEATION_CONTRADICTION_MAPPING': 'gemini-2.5-pro',
  'IDEATION_EXPAND': 'gemini-2.5-flash-lite',
  'IDEATION_OBVIOUSNESS_FILTER': 'gemini-2.5-pro',
  'IDEATION_GENERATE': 'gemini-2.5-pro',
  'IDEATION_NOVELTY': 'gemini-2.5-pro',
}

const IDEATION_TOKEN_LIMITS = {
  'IDEATION_NORMALIZE': { maxTokensIn: 20000, maxTokensOut: 8192 },
  'IDEATION_CLASSIFY': { maxTokensIn: 20000, maxTokensOut: 8192 },
  'IDEATION_CONTRADICTION_MAPPING': { maxTokensIn: 30000, maxTokensOut: 8192 },
  'IDEATION_EXPAND': { maxTokensIn: 30000, maxTokensOut: 8192 },
  'IDEATION_OBVIOUSNESS_FILTER': { maxTokensIn: 30000, maxTokensOut: 8192 },
  'IDEATION_GENERATE': { maxTokensIn: 40000, maxTokensOut: 16000 },
  'IDEATION_NOVELTY': { maxTokensIn: 50000, maxTokensOut: 16000 },
}

async function fixUserPlanIdeation(email) {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  FIX USER PLAN FOR IDEATION ACCESS')
  console.log('═══════════════════════════════════════════════════════════════\n')

  // 1. Find the user
  console.log(`1️⃣  Finding user: ${email}...\n`)
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      tenant: {
        include: {
          tenantPlans: {
            where: { status: 'ACTIVE' },
            include: { plan: true },
            orderBy: { effectiveFrom: 'desc' },
            take: 1
          }
        }
      }
    }
  })

  if (!user) {
    console.log(`   ❌ User "${email}" not found!`)
    await prisma.$disconnect()
    return
  }

  console.log(`   ✅ User found:`)
  console.log(`      ID: ${user.id}`)
  console.log(`      Name: ${user.name || 'N/A'}`)
  console.log(`      Tenant ID: ${user.tenantId || 'NONE'}`)
  console.log('')

  // 2. Check tenant
  if (!user.tenant) {
    console.log('   ❌ User has no tenant assigned!')
    console.log('   → Need to assign a tenant first.')
    await prisma.$disconnect()
    return
  }

  console.log(`2️⃣  Checking tenant: ${user.tenant.name}...\n`)
  console.log(`   Tenant ID: ${user.tenant.id}`)
  console.log(`   Tenant Status: ${user.tenant.status}`)
  console.log(`   ATI ID: ${user.tenant.atiId || 'NONE'}`)
  console.log('')

  // 3. Check current plan
  const currentTenantPlan = user.tenant.tenantPlans[0]
  
  if (!currentTenantPlan) {
    console.log('   ❌ Tenant has NO ACTIVE TenantPlan!')
    console.log('   → Need to assign a plan to this tenant.')
    console.log('')
    
    // Find ENTERPRISE_PLAN and assign it
    console.log('3️⃣  Assigning ENTERPRISE_PLAN to tenant...\n')
    const enterprisePlan = await prisma.plan.findUnique({
      where: { code: 'ENTERPRISE_PLAN' }
    })
    
    if (!enterprisePlan) {
      console.log('   ❌ ENTERPRISE_PLAN not found! Run seed-production-plans.js first.')
      await prisma.$disconnect()
      return
    }
    
    await prisma.tenantPlan.create({
      data: {
        tenantId: user.tenant.id,
        planId: enterprisePlan.id,
        status: 'ACTIVE',
        effectiveFrom: new Date()
      }
    })
    console.log(`   ✅ Assigned ENTERPRISE_PLAN to tenant ${user.tenant.name}`)
    
    // Re-fetch the current plan
    const newTenantPlan = await prisma.tenantPlan.findFirst({
      where: { tenantId: user.tenant.id, status: 'ACTIVE' },
      include: { plan: true }
    })
    
    await ensureIdeationOnPlan(newTenantPlan.plan)
  } else {
    console.log(`3️⃣  Current plan: ${currentTenantPlan.plan.code}...\n`)
    console.log(`   Plan ID: ${currentTenantPlan.planId}`)
    console.log(`   Plan Name: ${currentTenantPlan.plan.name}`)
    console.log(`   Plan Status: ${currentTenantPlan.plan.status}`)
    console.log('')
    
    await ensureIdeationOnPlan(currentTenantPlan.plan)
  }

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  ✅ COMPLETE!')
  console.log('═══════════════════════════════════════════════════════════════\n')
  console.log('Next steps:')
  console.log('1. User should log out and log back in to get a fresh JWT')
  console.log('2. Try the ideation feature again')
  console.log('')

  await prisma.$disconnect()
}

async function ensureIdeationOnPlan(plan) {
  console.log(`4️⃣  Checking IDEATION feature on plan ${plan.code}...\n`)
  
  // 4a. Ensure IDEATION feature exists
  let ideationFeature = await prisma.feature.findUnique({
    where: { code: 'IDEATION' }
  })
  
  if (!ideationFeature) {
    console.log('   Creating IDEATION feature...')
    ideationFeature = await prisma.feature.create({
      data: {
        code: 'IDEATION',
        name: 'Patent Ideation Engine',
        unit: 'sessions'
      }
    })
    console.log('   ✅ IDEATION feature created')
  } else {
    console.log('   ✅ IDEATION feature exists')
  }
  
  // 4b. Ensure PlanFeature for IDEATION exists
  let planFeature = await prisma.planFeature.findUnique({
    where: {
      planId_featureId: {
        planId: plan.id,
        featureId: ideationFeature.id
      }
    }
  })
  
  if (!planFeature) {
    console.log(`   Creating PlanFeature for IDEATION on ${plan.code}...`)
    planFeature = await prisma.planFeature.create({
      data: {
        planId: plan.id,
        featureId: ideationFeature.id,
        monthlyQuota: 2000,
        dailyQuota: 200,
        monthlyTokenLimit: 20000000,
        dailyTokenLimit: 2000000
      }
    })
    console.log('   ✅ PlanFeature created with generous quotas')
  } else {
    console.log(`   ✅ PlanFeature for IDEATION exists (monthly: ${planFeature.monthlyQuota}, daily: ${planFeature.dailyQuota})`)
  }
  
  console.log('')
  
  // 4c. Ensure IDEATION workflow stages exist
  console.log(`5️⃣  Checking IDEATION workflow stages...\n`)
  
  for (const [stageCode, modelCode] of Object.entries(IDEATION_STAGE_MODELS)) {
    let stage = await prisma.workflowStage.findUnique({
      where: { code: stageCode }
    })
    
    if (!stage) {
      console.log(`   Creating stage ${stageCode}...`)
      stage = await prisma.workflowStage.create({
        data: {
          code: stageCode,
          name: stageCode.replace('IDEATION_', '').replace(/_/g, ' '),
          featureCode: 'IDEATION',
          isActive: true
        }
      })
      console.log(`   ✅ Stage ${stageCode} created`)
    }
  }
  console.log('   ✅ All IDEATION stages exist')
  console.log('')
  
  // 4d. Ensure PlanStageModelConfig for each IDEATION stage
  console.log(`6️⃣  Checking model configs for IDEATION stages on ${plan.code}...\n`)
  
  for (const [stageCode, modelCode] of Object.entries(IDEATION_STAGE_MODELS)) {
    const stage = await prisma.workflowStage.findUnique({
      where: { code: stageCode }
    })
    
    if (!stage) continue
    
    const model = await prisma.lLMModel.findFirst({
      where: { code: modelCode }
    })
    
    if (!model) {
      console.log(`   ⚠️  Model ${modelCode} not found - skipping ${stageCode}`)
      continue
    }
    
    const limits = IDEATION_TOKEN_LIMITS[stageCode] || { maxTokensIn: 20000, maxTokensOut: 8192 }
    
    const existingConfig = await prisma.planStageModelConfig.findUnique({
      where: {
        planId_stageId: {
          planId: plan.id,
          stageId: stage.id
        }
      }
    })
    
    if (!existingConfig) {
      await prisma.planStageModelConfig.create({
        data: {
          planId: plan.id,
          stageId: stage.id,
          modelId: model.id,
          maxTokensIn: limits.maxTokensIn,
          maxTokensOut: limits.maxTokensOut,
          isActive: true
        }
      })
      console.log(`   ✅ Created config: ${stageCode} → ${modelCode}`)
    } else {
      console.log(`   ✅ Config exists: ${stageCode} → ${model.code}`)
    }
  }
  console.log('')
}

// Main execution
const email = process.argv[2]

if (!email) {
  console.log('Usage: node scripts/fix-user-plan-ideation.js <email>')
  console.log('Example: node scripts/fix-user-plan-ideation.js trialaccount@gmail.com')
  process.exit(1)
}

fixUserPlanIdeation(email).catch(err => {
  console.error('Error:', err)
  process.exit(1)
})

