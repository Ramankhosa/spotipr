/**
 * Set proper patent COUNT limits for each plan.
 * 
 * After the metering fix (bypassing LLM completion quotas for PATENT_DRAFTING),
 * the dailyQuota/monthlyQuota fields now represent PATENT COUNTS, not LLM calls.
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Patent count limits per plan
const PATENT_LIMITS = {
  'TRIAL': { daily: null, monthly: 2 },      // 2 patents/month for trial
  'FREE_PLAN': { daily: null, monthly: 2 },  // 2 patents/month for free
  'BASIC_PLAN': { daily: null, monthly: 1 }, // 1 patent/month for basic
  'PRO_PLAN': { daily: null, monthly: 4 },   // 4 patents/month for pro
  'ENTERPRISE_PLAN': { daily: null, monthly: 15 }, // 15 patents/month for enterprise
}

async function main() {
  console.log('='.repeat(80))
  console.log('SETTING PATENT COUNT LIMITS')
  console.log('='.repeat(80))
  console.log('')
  console.log('These quotas represent NUMBER OF COMPLETE PATENTS, not LLM calls.')
  console.log('LLM calls for PATENT_DRAFTING are now unlimited (handled in metering.ts).')
  console.log('')

  // Get PATENT_DRAFTING feature
  const feature = await prisma.feature.findUnique({
    where: { code: 'PATENT_DRAFTING' }
  })

  if (!feature) {
    console.log('ERROR: PATENT_DRAFTING feature not found')
    return
  }

  // Update each plan
  for (const [planCode, limits] of Object.entries(PATENT_LIMITS)) {
    const plan = await prisma.plan.findFirst({
      where: { code: planCode }
    })

    if (!plan) {
      console.log(`Plan ${planCode} not found, skipping...`)
      continue
    }

    const planFeature = await prisma.planFeature.findFirst({
      where: { planId: plan.id, featureId: feature.id }
    })

    if (!planFeature) {
      console.log(`PlanFeature for ${planCode} not found, skipping...`)
      continue
    }

    await prisma.planFeature.update({
      where: { id: planFeature.id },
      data: {
        dailyQuota: limits.daily,
        monthlyQuota: limits.monthly
      }
    })

    console.log(`${planCode}: daily=${limits.daily ?? 'unlimited'}, monthly=${limits.monthly ?? 'unlimited'} patents`)
  }

  console.log('')
  console.log('DONE! Patent count limits have been set.')
  console.log('')

  // Verify the settings
  console.log('VERIFICATION:')
  console.log('-'.repeat(40))

  const plans = await prisma.plan.findMany({
    include: {
      planFeatures: {
        where: { featureId: feature.id }
      }
    }
  })

  for (const plan of plans) {
    const pf = plan.planFeatures[0]
    if (pf) {
      console.log(`${plan.code.padEnd(20)}: daily=${(pf.dailyQuota ?? 'unlimited').toString().padStart(10)}, monthly=${(pf.monthlyQuota ?? 'unlimited').toString().padStart(10)}`)
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
