/**
 * Rename FREE_PLAN to BASIC_PLAN
 * 
 * This script renames the FREE_PLAN to BASIC_PLAN for consistency with the
 * four-tier plan structure: TRIAL, BASIC, PRO, ENTERPRISE
 * 
 * Run: npx tsx scripts/rename-free-to-basic-plan.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  RENAMING FREE_PLAN TO BASIC_PLAN')
  console.log('═══════════════════════════════════════════════════════════════\n')

  // Check if FREE_PLAN exists
  const freePlan = await prisma.plan.findUnique({
    where: { code: 'FREE_PLAN' }
  })

  if (!freePlan) {
    console.log('❌ FREE_PLAN not found. Checking if BASIC_PLAN already exists...')
    
    const basicPlan = await prisma.plan.findUnique({
      where: { code: 'BASIC_PLAN' }
    })
    
    if (basicPlan) {
      console.log('✅ BASIC_PLAN already exists. No action needed.')
      return
    }
    
    console.log('Creating BASIC_PLAN from scratch...')
    await prisma.plan.create({
      data: {
        code: 'BASIC_PLAN',
        name: 'Basic Plan',
        cycle: 'MONTHLY',
        status: 'ACTIVE'
      }
    })
    console.log('✅ BASIC_PLAN created.')
    return
  }

  // Check if BASIC_PLAN already exists (avoid conflict)
  const existingBasic = await prisma.plan.findUnique({
    where: { code: 'BASIC_PLAN' }
  })

  if (existingBasic) {
    console.log('⚠️  BASIC_PLAN already exists. Will merge FREE_PLAN into BASIC_PLAN.')
    
    // Update any TenantPlans pointing to FREE_PLAN to point to BASIC_PLAN
    const updated = await prisma.tenantPlan.updateMany({
      where: { planId: freePlan.id },
      data: { planId: existingBasic.id }
    })
    console.log(`   Updated ${updated.count} tenant plan associations.`)
    
    // Delete the FREE_PLAN (cascade will handle related records)
    // But first, move PlanFeatures if needed
    const freeFeatures = await prisma.planFeature.findMany({
      where: { planId: freePlan.id }
    })
    
    for (const ff of freeFeatures) {
      const existingBasicFeature = await prisma.planFeature.findUnique({
        where: {
          planId_featureId: {
            planId: existingBasic.id,
            featureId: ff.featureId
          }
        }
      })
      
      if (!existingBasicFeature) {
        // Move the feature to BASIC_PLAN
        await prisma.planFeature.update({
          where: { id: ff.id },
          data: { planId: existingBasic.id }
        })
        console.log(`   Moved PlanFeature ${ff.id} to BASIC_PLAN`)
      }
    }
    
    // Now we can deprecate FREE_PLAN instead of deleting it
    await prisma.plan.update({
      where: { id: freePlan.id },
      data: { status: 'DEPRECATED' }
    })
    console.log('✅ FREE_PLAN deprecated. BASIC_PLAN is now the canonical plan.')
    return
  }

  // Simple rename: update the code and name
  console.log('Renaming FREE_PLAN to BASIC_PLAN...')
  
  await prisma.plan.update({
    where: { code: 'FREE_PLAN' },
    data: {
      code: 'BASIC_PLAN',
      name: 'Basic Plan'
    }
  })

  console.log('✅ Successfully renamed FREE_PLAN to BASIC_PLAN')
  
  // Verify the change
  const verifyPlan = await prisma.plan.findUnique({
    where: { code: 'BASIC_PLAN' },
    include: {
      planFeatures: {
        include: { feature: true }
      }
    }
  })
  
  if (verifyPlan) {
    console.log('\n📋 BASIC_PLAN details:')
    console.log(`   ID: ${verifyPlan.id}`)
    console.log(`   Code: ${verifyPlan.code}`)
    console.log(`   Name: ${verifyPlan.name}`)
    console.log(`   Status: ${verifyPlan.status}`)
    console.log(`   Features: ${verifyPlan.planFeatures.length}`)
    verifyPlan.planFeatures.forEach(pf => {
      console.log(`     - ${pf.feature.code}: monthly=${pf.monthlyQuota}, daily=${pf.dailyQuota}`)
    })
  }

  // List all plans for verification
  console.log('\n📋 All plans after migration:')
  const allPlans = await prisma.plan.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { code: 'asc' }
  })
  
  allPlans.forEach(p => {
    console.log(`   - ${p.code} (${p.name})`)
  })
}

main()
  .catch((e) => {
    console.error('❌ Migration failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

