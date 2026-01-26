/**
 * Diagnostic script to check Basic Plan quota configuration and usage
 * 
 * Run: node scripts/check-basic-plan-quota.js [planId]
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const planId = process.argv[2] || 'cmkryww8q000015hn6kkib8va'
  
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  BASIC PLAN QUOTA INVESTIGATION')
  console.log('═══════════════════════════════════════════════════════════════\n')
  
  console.log(`Checking plan: ${planId}\n`)

  // 1. Get plan details
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    include: {
      planFeatures: {
        include: {
          feature: true
        }
      }
    }
  })

  if (!plan) {
    console.log('❌ Plan not found!')
    return
  }

  console.log('📋 Plan Details:')
  console.log(`   Code: ${plan.code}`)
  console.log(`   Name: ${plan.name}`)
  console.log(`   Status: ${plan.status}`)
  console.log(`   Cycle: ${plan.cycle}\n`)

  // 2. Check PATENT_DRAFTING feature quotas
  const patentDraftingFeature = plan.planFeatures.find(
    pf => pf.feature.code === 'PATENT_DRAFTING'
  )

  if (!patentDraftingFeature) {
    console.log('❌ PATENT_DRAFTING feature not found in plan!')
    console.log('\nAvailable features:')
    plan.planFeatures.forEach(pf => {
      console.log(`   - ${pf.feature.code}: monthly=${pf.monthlyQuota}, daily=${pf.dailyQuota}`)
    })
    return
  }

  console.log('✅ PATENT_DRAFTING Feature Quotas:')
  console.log(`   Monthly Quota: ${patentDraftingFeature.monthlyQuota}`)
  console.log(`   Daily Quota: ${patentDraftingFeature.dailyQuota}`)
  console.log(`   Feature ID: ${patentDraftingFeature.featureId}\n`)

  // 3. Get all tenants on this plan
  const tenantPlans = await prisma.tenantPlan.findMany({
    where: {
      planId: planId,
      status: 'ACTIVE'
    },
    include: {
      tenant: true
    },
    take: 5 // Just show first 5
  })

  console.log(`📊 Found ${tenantPlans.length} active tenant(s) on this plan\n`)

  if (tenantPlans.length > 0) {
    // Check usage for first tenant
    const tenantId = tenantPlans[0].tenantId
    console.log(`Checking usage for tenant: ${tenantId}\n`)

    // Get current period keys
    const now = new Date()
    const dailyKey = now.toISOString().split('T')[0] // YYYY-MM-DD
    const monthlyKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` // YYYY-MM

    // Check usage meters (BUG: This uses featureCode string instead of featureId!)
    const dailyMeter = await prisma.usageMeter.findFirst({
      where: {
        tenantId,
        featureId: 'PATENT_DRAFTING', // BUG: This is wrong - should be featureId UUID!
        periodType: 'DAILY',
        periodKey: dailyKey
      }
    })

    const monthlyMeter = await prisma.usageMeter.findFirst({
      where: {
        tenantId,
        featureId: 'PATENT_DRAFTING', // BUG: This is wrong - should be featureId UUID!
        periodType: 'MONTHLY',
        periodKey: monthlyKey
      }
    })

    console.log('📈 Usage Meters (using featureCode - WRONG):')
    console.log(`   Daily: ${dailyMeter?.currentUsage || 0} (limit: ${patentDraftingFeature.dailyQuota})`)
    console.log(`   Monthly: ${monthlyMeter?.currentUsage || 0} (limit: ${patentDraftingFeature.monthlyQuota})`)

    // Check usage meters with correct featureId
    const dailyMeterCorrect = await prisma.usageMeter.findFirst({
      where: {
        tenantId,
        featureId: patentDraftingFeature.featureId, // CORRECT: Use actual featureId UUID
        periodType: 'DAILY',
        periodKey: dailyKey
      }
    })

    const monthlyMeterCorrect = await prisma.usageMeter.findFirst({
      where: {
        tenantId,
        featureId: patentDraftingFeature.featureId, // CORRECT: Use actual featureId UUID
        periodType: 'MONTHLY',
        periodKey: monthlyKey
      }
    })

    console.log('\n📈 Usage Meters (using featureId UUID - CORRECT):')
    console.log(`   Daily: ${dailyMeterCorrect?.currentUsage || 0} (limit: ${patentDraftingFeature.dailyQuota})`)
    console.log(`   Monthly: ${monthlyMeterCorrect?.currentUsage || 0} (limit: ${patentDraftingFeature.monthlyQuota})`)

    // Check all usage meters for this tenant
    const allMeters = await prisma.usageMeter.findMany({
      where: {
        tenantId,
        featureId: patentDraftingFeature.featureId
      },
      orderBy: [
        { periodType: 'asc' },
        { periodKey: 'desc' }
      ],
      take: 10
    })

    console.log('\n📊 All Usage Meters for PATENT_DRAFTING:')
    allMeters.forEach(meter => {
      console.log(`   ${meter.periodType} (${meter.periodKey}): ${meter.currentUsage}`)
    })

    // Check usage logs
    const usageLogs = await prisma.usageLog.findMany({
      where: {
        tenantId,
        featureId: patentDraftingFeature.featureId
      },
      orderBy: {
        startedAt: 'desc'
      },
      take: 5
    })

    console.log(`\n📝 Recent Usage Logs (last 5):`)
    usageLogs.forEach(log => {
      const date = new Date(log.startedAt).toISOString().split('T')[0]
      console.log(`   ${date}: ${log.status} - ${log.inputTokens || 0} in, ${log.outputTokens || 0} out tokens`)
    })
  }

  // 4. Check if there's a BASIC_PLAN vs FREE_PLAN confusion
  console.log('\n\n🔍 Checking for BASIC_PLAN vs FREE_PLAN:')
  const basicPlan = await prisma.plan.findUnique({
    where: { code: 'BASIC_PLAN' },
    include: {
      planFeatures: {
        include: { feature: true }
      }
    }
  })

  const freePlan = await prisma.plan.findUnique({
    where: { code: 'FREE_PLAN' },
    include: {
      planFeatures: {
        include: { feature: true }
      }
    }
  })

  if (basicPlan) {
    console.log('\n✅ BASIC_PLAN exists:')
    const pf = basicPlan.planFeatures.find(p => p.feature.code === 'PATENT_DRAFTING')
    if (pf) {
      console.log(`   PATENT_DRAFTING: monthly=${pf.monthlyQuota}, daily=${pf.dailyQuota}`)
    } else {
      console.log('   ❌ PATENT_DRAFTING feature not configured')
    }
  } else {
    console.log('\n❌ BASIC_PLAN does not exist')
  }

  if (freePlan) {
    console.log('\n✅ FREE_PLAN exists:')
    const pf = freePlan.planFeatures.find(p => p.feature.code === 'PATENT_DRAFTING')
    if (pf) {
      console.log(`   PATENT_DRAFTING: monthly=${pf.monthlyQuota}, daily=${pf.dailyQuota}`)
    } else {
      console.log('   ❌ PATENT_DRAFTING feature not configured')
    }
  } else {
    console.log('\n❌ FREE_PLAN does not exist')
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
