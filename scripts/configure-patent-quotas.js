/**
 * Configure patent drafting quotas properly:
 * 
 * 1. Set LLM completion quotas to NULL (unlimited) for PATENT_DRAFTING
 *    - This allows unlimited LLM API calls for patent drafting
 * 
 * 2. The ACTUAL patent count limit will be controlled by:
 *    - TenantFeatureOverride table (per-tenant limits)
 *    - OR a new field we'll add to PlanFeature
 * 
 * For now, we'll set LLM limits high enough that they don't block,
 * and create TenantFeatureOverride records to control patent counts.
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('='.repeat(80))
  console.log('CONFIGURING PATENT DRAFTING QUOTAS')
  console.log('='.repeat(80))
  console.log('')

  // Get all plans
  const plans = await prisma.plan.findMany({
    include: {
      planFeatures: {
        include: { feature: true }
      }
    }
  })

  console.log('CURRENT PLAN CONFIGURATION:')
  console.log('-'.repeat(40))

  for (const plan of plans) {
    const pf = plan.planFeatures.find(f => f.feature.code === 'PATENT_DRAFTING')
    if (pf) {
      console.log(`${plan.name} (${plan.code}):`)
      console.log(`  dailyQuota (LLM calls): ${pf.dailyQuota}`)
      console.log(`  monthlyQuota (LLM calls): ${pf.monthlyQuota}`)
      console.log('')
    }
  }

  console.log('')
  console.log('PROPOSED SOLUTION:')
  console.log('-'.repeat(40))
  console.log('1. Set LLM completion quotas to NULL (unlimited) for PATENT_DRAFTING')
  console.log('2. Use TenantFeatureOverride for per-tenant patent count limits')
  console.log('3. Modify PatentDraftingTracker to use a separate limit source')
  console.log('')

  // For now, let's just show what the configuration should be
  const recommendedConfig = {
    'TRIAL': { llmCalls: null, patentCount: 2 },
    'FREE_PLAN': { llmCalls: null, patentCount: 2 },
    'BASIC_PLAN': { llmCalls: null, patentCount: 1 },
    'PRO_PLAN': { llmCalls: null, patentCount: 4 },
    'ENTERPRISE_PLAN': { llmCalls: null, patentCount: 15 },
  }

  console.log('RECOMMENDED CONFIGURATION:')
  console.log('-'.repeat(40))
  console.log('Plan | LLM Calls (dailyQuota) | Patent Count Limit')
  console.log('-'.repeat(60))
  for (const [planCode, config] of Object.entries(recommendedConfig)) {
    console.log(`${planCode.padEnd(20)} | ${(config.llmCalls ?? 'unlimited').toString().padStart(20)} | ${config.patentCount}`)
  }
  console.log('')

  // Ask user if they want to apply
  console.log('To properly fix this, we need to:')
  console.log('1. Add a new field "monthlyPatentLimit" to PlanFeature schema')
  console.log('2. Update PatentDraftingTracker to read from that field')
  console.log('3. Update super-admin UI to configure patent count separately')
  console.log('')
  console.log('For a QUICK FIX, run with --apply flag to:')
  console.log('- Set dailyQuota to NULL (unlimited LLM calls)')
  console.log('- Set monthlyQuota to high value (10000) for LLM calls')
  console.log('- Create TenantFeatureOverride records for patent count limits')

  if (process.argv.includes('--apply')) {
    console.log('')
    console.log('APPLYING QUICK FIX...')
    console.log('-'.repeat(40))

    // Get PATENT_DRAFTING feature
    const feature = await prisma.feature.findUnique({
      where: { code: 'PATENT_DRAFTING' }
    })

    if (!feature) {
      console.log('ERROR: PATENT_DRAFTING feature not found')
      return
    }

    // Update all plan features to have high LLM limits
    for (const plan of plans) {
      const pf = plan.planFeatures.find(f => f.feature.code === 'PATENT_DRAFTING')
      if (pf) {
        await prisma.planFeature.update({
          where: { id: pf.id },
          data: {
            dailyQuota: null,    // Unlimited daily LLM calls
            monthlyQuota: 10000  // 10000 monthly LLM calls (effectively unlimited)
          }
        })
        console.log(`Updated ${plan.code}: dailyQuota=unlimited, monthlyQuota=10000`)
      }
    }

    console.log('')
    console.log('DONE! LLM call limits have been raised.')
    console.log('')
    console.log('NOTE: The patent COUNT limit is still controlled by the same fields.')
    console.log('To properly separate these concerns, a schema change is needed.')
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
